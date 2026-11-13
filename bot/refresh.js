const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const {
  readSnapshot, REFRESH_INTERVAL_MS, canRefresh, refreshIsCurrent, loadKey
} = require('./posting-maintenance');
const { signature, serialToBoardTime } = require('./bot-postings');

const STATE_FILE = process.env.POSTING_REFRESH_STATE_FILE || path.join(__dirname, 'posting-refresh-state.json');
const WORK_DIR = path.join(__dirname, 'refresh-exports');

function readState(file = STATE_FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid posting-refresh state.');
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function writeState(state) {
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state));
  fs.renameSync(temp, STATE_FILE);
}

function readRefreshStatus() {
  return Object.entries(readState()).filter(([, state]) => state.error)
    .map(([key, state]) => ({ key, message: state.error, at: state.at }));
}

const normalize = value => String(value || '').replace(/\s+/g, ' ').replace(/\(Required\)/i, '').trim().toLowerCase();
const boardDate = value => {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/);
  return match ? new Date(2000 + Number(match[3]), Number(match[1]) - 1, Number(match[2]),
    Number(match[4]), Number(match[5])).getTime() : NaN;
};

function findSource(folder, item) {
  const wanted = signature(item.posting.originZip, item.posting.destZip, item.posting.pickupThru, item.posting.weight);
  const files = fs.readdirSync(folder).filter(name => /\.xlsx$/i.test(name))
    .map(name => ({ file: path.join(folder, name), at: fs.statSync(path.join(folder, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const { file } of files) {
    const bytes = fs.readFileSync(file);
    const workbook = XLSX.read(bytes);
    const sheet = workbook.Sheets.Loads;
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: true });
    const headers = rows[0].map(normalize);
    const col = name => headers.indexOf(name);
    const columns = ['origin zipcode', 'destination zipcode', 'pickup date (thru)', 'weight', 'load posting code'].map(col);
    if (columns.some(index => index < 0)) continue;
    const matching = rows.slice(1).map((row, index) => ({ row, number: index + 2 }))
      .filter(({ row }) => row && signature(row[columns[0]], row[columns[1]], serialToBoardTime(row[columns[2]]), row[columns[3]]) === wanted);
    if (matching.length > 1) throw new Error('Multiple export rows match this posting. Re-export this important load by itself.');
    if (matching.length) return { bytes, headers, ...matching[0] };
  }
  throw new Error('No matching uploaded spreadsheet is available. Export this important load once before automatic refresh.');
}

async function buildRefreshWorkbook(source, revenue, now = Date.now()) {
  const { headers, row, number } = source;
  const col = name => {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error(`Refresh source is missing ${name}.`);
    return index;
  };
  const rate = col('rate');
  const carrier = col('carrier amt');
  const pickup = col('pickup date (from)');
  const pickupEnd = Number(row[col('pickup date (thru)')]);
  const delivery = Number(row[col('delivery date (from)')]);
  const local = new Date(now);
  const serial = (Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(),
    local.getHours(), local.getMinutes() + 15) - Date.UTC(1899, 11, 30)) / 86400000;
  const pickupFrom = Math.max(Number(row[pickup]), serial);
  if (!Number.isFinite(pickupFrom) || pickupFrom > pickupEnd || pickupFrom >= delivery) {
    throw new Error('Pickup window has ended or is too close to delivery. Correct the schedule before refreshing.');
  }
  if (!(revenue > 0)) throw new Error('The current board rate could not be verified. No refresh submitted.');
  const zip = await JSZip.loadAsync(source.bytes);
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const sheets = workbookXml.match(/<sheet\b[^>]*\/>/g) || [];
  const sheet = sheets.find(tag => /\bname="Loads"/.test(tag));
  const relationId = sheet?.match(/\br:id="([^"]+)"/)?.[1];
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relation = (rels.match(/<Relationship\b[^>]*\/>/g) || [])
    .find(tag => tag.match(/\bId="([^"]+)"/)?.[1] === relationId);
  const target = relation?.match(/\bTarget="([^"]+)"/)?.[1];
  if (!target) throw new Error('Cannot locate the exported Loads worksheet.');
  const sheetPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`);
  const xml = await zip.file(sheetPath).async('string');
  const rows = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
  const byNumber = n => rows.find(value => Number(value.match(/\br="(\d+)"/)?.[1]) === n);
  const header = byNumber(1);
  let selected = byNumber(number);
  if (!header || !selected || /<f\b/.test(selected)) throw new Error('The refresh source row cannot be safely copied.');
  selected = selected.replace(/\br="([A-Z]*)(\d+)"/g, (_, column) => `r="${column}2"`);
  const setNumber = (column, value) => {
    const address = `${XLSX.utils.encode_col(column)}2`;
    const cell = new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    if (!cell.test(selected)) throw new Error(`Refresh source is missing cell ${address}.`);
    selected = selected.replace(cell, original => {
      const style = original.match(/\bs="([^"]+)"/)?.[1];
      return `<c r="${address}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
    });
  };
  setNumber(rate, revenue);
  setNumber(carrier, revenue);
  setNumber(pickup, pickupFrom);
  zip.file(sheetPath, xml
    .replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:${XLSX.utils.encode_col(headers.length - 1)}2"/>`)
    .replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, `<sheetData>${header}${selected}</sheetData>`));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function processRefresh(context, { uploadedFolder, reviewFolder, openUpload, submit, log = console.log }) {
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'automation-policy.json'), 'utf8'));
  if (policy.automaticPostingEnabled === false) return false;
  const { openBoard, OWN_POSTING_CODES } = require('./rate-check');
  const { listPostings, cancelPostings } = require('./dedupe');
  const { findMatchingPostings, statesFor, claimUnpostQueue } = require('./unpost');
  const { claimAssignQueue } = require('./assign');
  const { submitFileOnce } = require('./upload-safety');
  const snapshot = readSnapshot();
  const state = readState();
  const item = snapshot.loads.find(load => canRefresh(load) && refreshIsCurrent(load, snapshot)
    && Date.now() >= (state[loadKey(load)]?.retryAt || 0)
    && Date.now() - (state[loadKey(load)]?.lastSuccess || 0) >= REFRESH_INTERVAL_MS);
  if (!item) return false;
  const key = loadKey(item);
  const previous = state[key] || {};
  const releaseRemoval = claimUnpostQueue();
  if (!releaseRemoval) return false;
  let releaseAssignment;
  let uploadPage;
  const save = patch => {
    state[key] = { ...state[key], ...patch, at: Date.now() };
    writeState(state);
  };
  try {
    releaseAssignment = claimAssignQueue();
    if (!releaseAssignment) return false;
    const board = await openBoard(context, log);
    const postings = await listPostings(board, OWN_POSTING_CODES, log, statesFor([item]));
    const matches = findMatchingPostings(postings, item.posting);
    if (matches.length === 0) throw new Error('No available board posting matches this important load. Re-export it after confirming capacity is removed on Landstar.');
    if (!previous.submittedAt) {
      if (!Array.isArray(item.posting.refreshDetails) || !Array.isArray(item.revision)
        || JSON.stringify(item.posting.refreshDetails) !== JSON.stringify(item.revision)) {
        throw new Error('Export this important load once with its current details before automatic refresh. An outdated export will not be reposted.');
      }
      if (matches.length !== 1) throw new Error('Multiple board postings match this important load. Review duplicates before refreshing.');
      const postedAt = Number(String(matches[0].OrderDate || '').match(/-?\d+/)?.[0]);
      if (!Number.isFinite(postedAt) || postedAt <= 0) throw new Error('The posting age cannot be verified.');
      if (Date.now() - postedAt < REFRESH_INTERVAL_MS) {
        save({ retryAt: postedAt + REFRESH_INTERVAL_MS, error: '' });
        return false;
      }
      const source = findSource(uploadedFolder, item);
      if (String(source.row[source.headers.indexOf('load posting code')]).trim().toUpperCase()
        !== String(matches[0].Agency).trim().toUpperCase()) {
        throw new Error('The archived export and board posting have different agency codes.');
      }
      if (!(boardDate(item.posting.pickupThru) > Date.now())) throw new Error('Pickup window has ended. No refresh submitted.');
      const bytes = await buildRefreshWorkbook(source, Number(matches[0].TotalRevenue));
      fs.mkdirSync(WORK_DIR, { recursive: true });
      const file = path.join(WORK_DIR, `Landstar_Refresh_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}_${Date.now()}.xlsx`);
      fs.writeFileSync(file, bytes);
      uploadPage = await context.newPage();
      await openUpload(uploadPage);
      const { assertUploadReady } = require('./upload-safety');
      try {
        await assertUploadReady(uploadPage, reviewFolder);
        if (!refreshIsCurrent(item)) throw new Error('Load changed or the local TMS stopped responding. No refresh submitted.');
      } catch (error) {
        fs.unlinkSync(file);
        throw error;
      }
      // Persist before submission: an interrupted upload is never automatically replayed.
      save({ submittedAt: Date.now(), oldIds: matches.map(load => String(load.LoadId)), error: '' });
      const submitted = await submitFileOnce(uploadPage, file, { reviewFolder, uploadedFolder, submit });
      if (submitted.state === 'drafts') throw new Error(`Refresh needs Landstar review: ${submitted.message} Original posting kept.`);
      save({ retryAt: Date.now() + 15000 });
      return true;
    }
    const newPostings = matches.filter(load => !previous.oldIds.includes(String(load.LoadId)));
    if (newPostings.length !== 1) {
      throw new Error('Refresh submitted but a single replacement posting is not confirmed. Original posting kept; check Landstar. No automatic resend.');
    }
    if (!refreshIsCurrent(item)) throw new Error('Load changed during refresh. Original posting kept; review the board.');
    const oldIds = matches.filter(load => previous.oldIds.includes(String(load.LoadId))).map(load => load.LoadId);
    if (oldIds.length) {
      const removed = await cancelPostings(board, oldIds, log, { refreshLoad: item });
      if (removed !== oldIds.length) throw new Error('Replacement is visible, but old posting removal needs review. No automatic resend.');
    }
    save({ submittedAt: null, oldIds: [], lastSuccess: Date.now(), retryAt: 0, error: '' });
    log(`Important load ${item.loadId}: replacement verified; old posting removed. Next refresh in 15 minutes.`);
    return true;
  } catch (error) {
    save({ retryAt: Date.now() + 60000, error: `Important load ${item.loadId}: ${error.message}` });
    log(state[key].error);
    return false;
  } finally {
    if (uploadPage) await uploadPage.close();
    releaseAssignment?.();
    releaseRemoval();
  }
}

module.exports = { readRefreshStatus, findSource, buildRefreshWorkbook, processRefresh, boardDate };
