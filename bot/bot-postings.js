// Tells the bot's own bulk-uploaded postings apart from loads Daniel posts by hand
// (Quick Post on the Landstar portal). Landstar records both the same way (SourceSystemID
// PORTAL, customer system TMS), so the bot checks its own uploads instead: a posting is
// the bot's only if it matches a row of a spreadsheet the bot uploaded (in Downloads\
// landstar-uploaded) on origin ZIP, destination ZIP, pickup end and weight. The bot never
// removes any other posting, even when the load is not on the customer's list.
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const UPLOADED_FOLDER = path.join(os.homedir(), 'Downloads', 'landstar-uploaded');
// Postings expire long before this; older files are not read.
const MAX_FILE_AGE_MS = 45 * 24 * 60 * 60 * 1000;

const zip = value => {
  const text = String(value ?? '').trim().toUpperCase();
  return /^\d{1,5}$/.test(text) ? text.padStart(5, '0') : text;
};

// Same format as the board's PickupThruDateForDisplay ("11/10/26 14:00").
function serialToBoardTime(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return String(serial ?? '').trim();
  const date = new Date(Math.round(serial * 86400000) + Date.UTC(1899, 11, 30));
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${pad(date.getUTCFullYear() % 100)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

const signature = (originZip, destZip, pickupThru, weight) =>
  [zip(originZip), zip(destZip), String(pickupThru || '').trim(), Number(weight) || 0].join('|');

const postingSignature = posting => signature(
  posting.OriginZipCode, posting.DestinationZipCode, posting.PickupThruDateForDisplay, posting.Weight);

const normalizeHeader = h => String(h || '').replace(/\s+/g, ' ').replace(/\(Required\)/i, '').trim().toLowerCase();

function fileSignatures(filePath) {
  const workbook = XLSX.read(fs.readFileSync(filePath));
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true });
  const header = (rows[0] || []).map(normalizeHeader);
  const col = name => header.indexOf(name);
  const c = { o: col('origin zipcode'), d: col('destination zipcode'), p: col('pickup date (thru)'), w: col('weight') };
  if (Object.values(c).some(i => i < 0)) return [];
  return rows.slice(1)
    .filter(row => row && row[c.o])
    .map(row => signature(row[c.o], row[c.d], serialToBoardTime(row[c.p]), row[c.w]));
}

const cache = new Map(); // file path -> { mtimeMs, signatures }

// Signatures of every load in the spreadsheets the bot uploaded recently.
function uploadedSignatures(folder = UPLOADED_FOLDER, now = Date.now()) {
  const all = new Set();
  let names = [];
  try { names = fs.readdirSync(folder).filter(name => /\.xlsx$/i.test(name)); } catch { return all; }
  for (const name of names) {
    const filePath = path.join(folder, name);
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    if (now - stat.mtimeMs > MAX_FILE_AGE_MS) continue;
    let entry = cache.get(filePath);
    if (!entry || entry.mtimeMs !== stat.mtimeMs) {
      try { entry = { mtimeMs: stat.mtimeMs, signatures: fileSignatures(filePath) }; } catch { entry = { mtimeMs: stat.mtimeMs, signatures: [] }; }
      cache.set(filePath, entry);
    }
    entry.signatures.forEach(s => all.add(s));
  }
  return all;
}

function isBotPosting(posting, signatures = uploadedSignatures()) {
  return signatures.has(postingSignature(posting));
}

module.exports = { isBotPosting, uploadedSignatures, postingSignature, signature, serialToBoardTime, UPLOADED_FOLDER };
