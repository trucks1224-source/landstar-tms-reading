// Landstar board rate check.
//
// For every load in an exported Landstar_Bulk_*.xlsx, searches the Landstar
// Available Loads board for other agencies' postings on the same lane and
// pickup date, and raises the load's rate to (highest other posting + $25)
// when someone else is paying the same or more. Rates that already beat the
// board are left alone.
//
// Same lane = same origin city/state and destination city/state (Landstar's
// abbreviated names such as "ELK GRV VLG [CO]" are matched to the full name),
// same pickup date, and a trailer type in the same Landstar trailer group
// (e.g. VAN, 53VN and 48VN are all VAN). The load's own posting code (your
// agency, e.g. ANQ) is never counted as competition.
//
// Used by upload.js before each upload. Can also run on its own as a report:
//   node rate-check.js              <- report only, changes nothing
//   node rate-check.js --apply      <- also writes the new rates into the files
//   node rate-check.js "C:\folder"  <- check files in another folder

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
// These come from the TMS project's node_modules (one folder up).
const JSZip = require('jszip');
const XLSX = require('xlsx');
const zipcodes = require('zipcodes');
const { setStatus } = require('./status-server');
const { raiseWindow } = require('./raise-window');

const BOARD_URL = 'https://www.landstaronline.com/Loads/Load/SearchResults';
const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const OUTBID_BY = 25;
// Your own posting codes. Board postings under any of these are never treated
// as competition (the load's own posting code is always skipped too).
const OWN_POSTING_CODES = ['ANQ'];
const MAX_ROWS = 500;

// ---------- spreadsheet ----------

const normalizeHeader = h => String(h || '').replace(/\s+/g, ' ').replace(/\(Required\)/i, '').trim().toLowerCase();

function readLoads(filePath) {
  const workbook = XLSX.read(fs.readFileSync(filePath));
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  const header = (rows[0] || []).map(normalizeHeader);
  const col = name => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`Column "${name}" not found in ${path.basename(filePath)}`);
    return index;
  };
  const c = {
    originCity: col('origin city'), originZip: col('origin zipcode'), originCountry: col('origin country'),
    destCity: col('destination city'), destZip: col('destination zipcode'), destCountry: col('destination country'),
    pickupFrom: col('pickup date (from)'), postingCode: col('load posting code'),
    equipment: col('equipment 1'), rate: col('rate'), carrierAmt: header.indexOf('carrier amt'),
    attributes: header.indexOf('load attributes'),
  };
  const loads = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    if (!row[c.originZip] && !row[c.originCity]) continue;
    const originZip = String(row[c.originZip] || '').trim();
    const destZip = String(row[c.destZip] || '').trim();
    loads.push({
      rowNumber: r + 1,
      originCity: String(row[c.originCity] || '').trim(),
      originZip,
      originState: zipcodes.lookup(originZip)?.state || '',
      originCountry: String(row[c.originCountry] || '').trim(),
      destCity: String(row[c.destCity] || '').trim(),
      destZip,
      destState: zipcodes.lookup(destZip)?.state || '',
      destCountry: String(row[c.destCountry] || '').trim(),
      pickupDate: excelSerialToDate(row[c.pickupFrom]),
      postingCode: String(row[c.postingCode] || '').trim().toUpperCase(),
      equipment: String(row[c.equipment] || '').trim().toUpperCase(),
      rate: Number(row[c.rate]) || 0,
      hazmat: c.attributes >= 0 && /hazmat/i.test(String(row[c.attributes] || '')),
    });
  }
  return { loads, rateColumn: c.rate, carrierAmtColumn: c.carrierAmt };
}

function excelSerialToDate(serial) {
  if (typeof serial !== 'number') return '';
  const d = new Date(Math.round((serial - 25569) * 86400000));
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

// Rewrites only the numeric value inside the given cells, so the official
// Landstar template (dropdowns, formats, other sheets) is left untouched.
async function writeRates(filePath, rateColumn, carrierAmtColumn, changes) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const firstSheetRid = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/)[1];
  const target = relsXml.match(new RegExp(`<Relationship\\b[^>]*Id="${firstSheetRid}"[^>]*Target="([^"]+)"`))
    || relsXml.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstSheetRid}"`));
  const sheetPath = `xl/${target[1].replace(/^\/?xl\//, '')}`;
  let xml = await zip.file(sheetPath).async('string');

  const setCell = (address, value) => {
    const pattern = new RegExp(`<c r="${address}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    if (!pattern.test(xml)) throw new Error(`Cell ${address} not found`);
    xml = xml.replace(pattern, (_, attrs) => {
      const cleanAttrs = attrs.replace(/\s+t="[^"]*"/, '');
      return `<c r="${address}"${cleanAttrs}><v>${value}</v></c>`;
    });
  };
  for (const { rowNumber, newRate } of changes) {
    setCell(XLSX.utils.encode_cell({ r: rowNumber - 1, c: rateColumn }), newRate);
    if (carrierAmtColumn >= 0) setCell(XLSX.utils.encode_cell({ r: rowNumber - 1, c: carrierAmtColumn }), newRate);
  }
  zip.file(sheetPath, xml);
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(filePath, out);
}

// Deletes whole rows (1-based sheet row numbers) and moves the rows below up, so the
// upload file simply no longer contains those loads. The template is otherwise untouched.
function removeRowsFromSheetXml(xml, rowNumbers) {
  const drop = new Set(rowNumbers.map(Number));
  const sorted = [...drop].sort((a, b) => a - b);
  const shiftFor = r => sorted.filter(n => n < r).length;
  const rowPattern = /<row\b[^>]*\br="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g;
  let out = xml.replace(rowPattern, (rowXml, rText) => {
    const r = Number(rText);
    if (drop.has(r)) return '';
    const shift = shiftFor(r);
    if (!shift) return rowXml;
    const newR = r - shift;
    return rowXml
      .replace(/(<row\b[^>]*\br=")\d+(")/, `$1${newR}$2`)
      .replace(/(<c\b[^>]*\br="[A-Z]+)\d+(")/g, `$1${newR}$2`);
  });
  const lastRow = Math.max(1, ...[...out.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map(m => Number(m[1])));
  out = out.replace(/(<dimension ref="[A-Z]+\d+:[A-Z]+)\d+(")/, `$1${lastRow}$2`);
  return out;
}

async function removeRows(filePath, rowNumbers) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const firstSheetRid = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/)[1];
  const target = relsXml.match(new RegExp(`<Relationship\\b[^>]*Id="${firstSheetRid}"[^>]*Target="([^"]+)"`))
    || relsXml.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstSheetRid}"`));
  const sheetPath = `xl/${target[1].replace(/^\/?xl\//, '')}`;
  const xml = await zip.file(sheetPath).async('string');
  zip.file(sheetPath, removeRowsFromSheetXml(xml, rowNumbers));
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(filePath, out);
}

// Agencies whose postings you never duplicate: when one of them already has the load
// on the board (same pickup day, origin and destination), your copy is not posted.
const SKIP_IF_POSTED_BY = ['ATZ'];

// R X O 2429200 - ATZ (not ATZ P) exports its DAT-priced van loads under the DAT rate. When
// another agent has the load on the board, that discount does not apply: the bot posts
// exactly their rate + $25, even when that is lower than the exported rate.
// Export files: Landstar_Bulk_R_X_O_2429200___ATZ.xlsx, ..._ATZ_3of9.xlsx, "... (1).xlsx".
const RXO_ATZ_FILE = /^Landstar_Bulk_R_X_O_2429200___ATZ(?:_\d+of\d+)?(?: \(\d+\))?\.xlsx$/i;
const VAN_EQUIPMENT = new Set(['VAN', '24VN', '28VN', '48VN', '53VN']);

function matchesTopCompetitor(fileName, load) {
  return RXO_ATZ_FILE.test(fileName) && VAN_EQUIPMENT.has(load.equipment) && !load.hazmat;
}

function isSkipAgencyPosting(board, load) {
  return SKIP_IF_POSTED_BY.includes(String(board.Agency || '').trim().toUpperCase())
    && boardPickupDate(board) === load.pickupDate
    && board.OriginState === load.originState && board.DestinationState === load.destState
    && (sameCity(board.OriginCity, load.originCity) || (board.OriginZipCode && board.OriginZipCode === load.originZip))
    && (sameCity(board.DestinationCity, load.destCity) || (board.DestinationZipCode && board.DestinationZipCode === load.destZip));
}

// ---------- city matching ----------

// "ELK GRV VLG    ,CO" / "ELK GRV VLG [CO]" -> ["ELK","GRV","VLG"]
const boardCityWords = name => String(name || '').toUpperCase()
  .replace(/\[[A-Z]{2}\]/g, ' ').replace(/,\s*[A-Z]{2}\s*$/, ' ')
  .replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
const fullCityWords = name => String(name || '').toUpperCase()
  .replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

// Is `abbr` a Landstar-style abbreviation of `word` (same first letter, letters in order)?
function abbreviates(abbr, word) {
  if (abbr === word) return true;
  if (abbr[0] !== word[0]) return false;
  let i = 0;
  for (const ch of word) if (ch === abbr[i]) i += 1;
  return i === abbr.length;
}

function sameCity(boardName, fullName) {
  const b = boardCityWords(boardName);
  const f = fullCityWords(fullName);
  if (!b.length || !f.length) return false;
  if (b.length === f.length) return b.every((word, i) => abbreviates(word, f[i]));
  // Spacing differences only, e.g. "MCCORDSVILLE" vs "Mc Cordsville".
  return b.join('') === f.join('');
}

// ---------- board ----------

// The bot profile reopens old tabs and Playwright adds a blank one, so the bot
// could end up working in a background tab behind a white page. Keep one tab
// and bring it to the front so you can see what the bot is doing.
async function getWorkPage(context) {
  const [page, ...extra] = context.pages();
  const workPage = page || await context.newPage();
  for (const p of extra) await p.close().catch(() => {});
  await workPage.bringToFront().catch(() => {});
  return workPage;
}

// ---------- logged-in signal ----------

const GREEN = '\x1b[42m\x1b[30m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// Draws a small green "Bot logged in" badge in the bottom-left corner of every
// Landstar page the bot opens (login pages excluded). Only visible in the bot's
// own browser window; it does not change anything on Landstar.
function drawLoggedInBadge() {
  if (!/landstaronline\.com$/i.test(location.host) || window.__tmsBotBadge) return;
  window.__tmsBotBadge = true;
  // The portal switches pages without reloading, so re-check every second and
  // show the badge only on the signed-in Landstar app pages.
  const update = () => {
    if (!document.body) return;
    const onLandstarApp = /^(www\.landstaronline\.com\/loads|portal\.landstaronline\.com\/(agent|loadboards))/i
      .test(location.host + location.pathname);
    let badge = document.getElementById('tms-bot-logged-in');
    if (!onLandstarApp) { if (badge) badge.remove(); return; }
    if (badge) return;
    badge = document.createElement('div');
    badge.id = 'tms-bot-logged-in';
    badge.textContent = '● Bot logged in';
    badge.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none;'
      + 'background:#16a34a;color:#fff;font:600 13px/1 Arial,sans-serif;padding:8px 12px;'
      + 'border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.3);';
    document.body.appendChild(badge);
  };
  update();
  setInterval(update, 1000);
}

const signalledContexts = new WeakSet();
async function showLoggedIn(context, page, log = console.log) {
  if (signalledContexts.has(context)) return;
  signalledContexts.add(context);
  setStatus('logged-in', 'Logged in to Landstar');
  log(`\n${GREEN} ✔ LOGGED IN TO LANDSTAR ${RESET}\n`);
  await context.addInitScript(drawLoggedInBadge).catch(() => {});
  await page.evaluate(drawLoggedInBadge).catch(() => {});
}

async function openBoard(context, log = console.log) {
  const page = await getWorkPage(context);
  const onBoard = () => /www\.landstaronline\.com\/Loads/i.test(page.url());
  const deadline = Date.now() + 300000;
  log(`${YELLOW}Signing in to Landstar...${RESET}`);
  setStatus('signing-in', 'Signing in to Landstar');
  await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded' }).catch(() => {}); // sign-in redirects can abort a load; the loop below re-checks
  let warned = false;
  const autoLoginUntil = Date.now() + 20000; // Landstar often signs in by itself; only ask after this
  while (!onBoard() && Date.now() < deadline) {
    // Window closed: stop waiting. (Otherwise every wait below fails instantly and this loop
    // spins nonstop, freezing the bot so it can't turn itself off.)
    if (page.isClosed()) throw new Error('The bot window was closed.');
    // Landstar's login lands on the portal dashboard; go back to the board.
    if (/portal\.landstaronline\.com\/agent/i.test(page.url())) {
      await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded' }).catch(() => {}); // sign-in redirects can abort a load; the loop below re-checks
      continue;
    }
    if (!warned && Date.now() > autoLoginUntil) {
      setStatus('signing-in', 'Log in to Landstar in the bot window');
      log('\n>>> ACTION NEEDED: log in to Landstar in the bot window. The bot continues by itself.\n');
      await raiseWindow(page);
      warned = true;
    }
    await page.waitForURL(/portal\.landstaronline\.com\/agent|www\.landstaronline\.com\/Loads/i, { timeout: 5000 }).catch(() => {});
  }
  if (!onBoard()) throw new Error('Could not reach the Landstar load board (login timed out).');
  await page.waitForLoadState('networkidle').catch(() => {});
  await showLoggedIn(context, page, log);
  // On the board = logged in; the TMS light should not keep saying "signing in".
  setStatus('logged-in', 'Checking the Landstar board');
  return page;
}

async function getTrailerGroups(page) {
  const groups = await page.evaluate(async () => {
    const res = await fetch('/Loads/MultiSelect/GetTrailerTypes?geoType=', { credentials: 'include' });
    return res.json();
  });
  const groupOf = new Map();
  for (const group of groups) for (const item of group.items || []) groupOf.set(item.text.trim().toUpperCase(), group.text.trim().toUpperCase());
  return code => groupOf.get(String(code || '').trim().toUpperCase()) || String(code || '').trim().toUpperCase();
}

function searchCriteria(originState, destState, pickupDate) {
  return {
    FreightBillNumber: null, SearchCriteriaId: null, DefaultSearchCriteria: false, Name: '',
    IsEnabled: false, IsAutomated: false, Devices: [], TractorNumber: 'None', CSA: '',
    Destination: { cityName: '', states: destState ? [destState] : [], radius: 0 }, DestinationCountry: '',
    MaximumRows: MAX_ROWS, Miles: { Max: '', Min: '' }, MinRevenue: '', MinRPM: '',
    Origin: { cityName: '', states: [originState], radius: 0 }, OriginCountry: '',
    Preloaded: '', Team: '', Weight: { Max: '', Min: '' }, AdditionalStopCount: '', Agency: '',
    Brokerable: '', CODOnCommodity: '', Company: '',
    Dimensions: { height: '', heightOperator: 4, includeWithoutDimensions: 'true', length: '', lengthOperator: 4, width: '', widthOperator: 4 },
    DriverCollect: '', Hazmat: '', HighRisk: '', JIT: '', LTL: '', DirectShipper: '', AgentAssist: '',
    DeliveryDate: '', DeliveryDateEnd: '', DeliveryDateRange: '0',
    PickupDate: pickupDate, PickupDateEnd: '', PickupDateRange: '0', TrailerTypes: [],
  };
}

// Read-only search: same request the board's own Search button sends.
async function searchBoard(page, originState, destState, pickupDate) {
  return page.evaluate(async ({ body, url }) => {
    const search = await fetch('/Loads/Load/PerformSearch', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    });
    if (!search.ok) throw new Error(`Board search failed (HTTP ${search.status})`);
    const html = await (await fetch(url, { credentials: 'include' })).text();
    const match = html.match(/var embeddedJSON = (\{.*\});?\s*$/m);
    if (!match) throw new Error('Board results could not be read (logged out?)');
    return JSON.parse(match[1]).Loads || [];
  }, { body: searchCriteria(originState, destState, pickupDate), url: BOARD_URL });
}

// "11/06/26 11:00" -> "11/06/2026"
const boardPickupDate = load => {
  const m = String(load.PickupFromDateForDisplay || '').match(/^(\d{2})\/(\d{2})\/(\d{2})/);
  return m ? `${m[1]}/${m[2]}/20${m[3]}` : '';
};

// ---------- board searches (fewer, remembered for a while) ----------
// One search per pickup state + pickup date (any delivery state) instead of one per lane: the
// ATZ skip and the competitor rules already compare delivery state/city themselves. A search
// that hits the MAX_ROWS limit could miss postings, so that lane is searched narrowly instead.
// Results are kept for BOARD_CACHE_MS across batches of the same export.
const BOARD_CACHE_MS = 15 * 60 * 1000;
const boardCache = new Map(); // key -> { at, loads }
let wideSearchOk = null; // null = not checked yet this run; false = use per-lane searches

async function cachedSearch(page, originState, destState, pickupDate) {
  const key = `${originState}|${destState || '*'}|${pickupDate}`;
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < BOARD_CACHE_MS) return hit.loads;
  const loads = await searchBoard(page, originState, destState, pickupDate);
  boardCache.set(key, { at: Date.now(), loads });
  return loads;
}

const sameLane = (b, load) => b.OriginState === load.originState && b.DestinationState === load.destState
  && boardPickupDate(b) === load.pickupDate;

// Board postings for a load's lane (pickup state, delivery state, pickup date).
async function boardForLoad(page, load, log = () => {}) {
  if (wideSearchOk !== false) {
    const wide = await cachedSearch(page, load.originState, '', load.pickupDate);
    if (wideSearchOk === null) {
      // First time this run: the narrow search must find the same postings for this lane.
      const narrow = await cachedSearch(page, load.originState, load.destState, load.pickupDate);
      const ids = list => list.filter(b => sameLane(b, load)).map(b => String(b.LoadId)).sort().join(',');
      wideSearchOk = wide.length < MAX_ROWS && ids(wide) === ids(narrow);
      log(wideSearchOk ? '  (board searches: one per pickup state and date)' : '  (board searches: one per lane - the wider search did not match)');
      if (!wideSearchOk) return narrow;
    }
    if (wide.length < MAX_ROWS) return wide; // the rules below compare delivery state and cities
  }
  return cachedSearch(page, load.originState, load.destState, load.pickupDate);
}

// ---------- main check ----------

// Checks every file; returns per-file results. With apply=true, writes new rates.
async function checkFiles(page, files, { apply, log = console.log }) {
  const trailerGroup = await getTrailerGroups(page);
  const results = [];

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    log(`\nRate check: ${fileName}`);
    setStatus('logged-in', `Rate-checking ${fileName.replace(/^Landstar_Bulk_/, '').replace(/\.xlsx$/i, '')}`);
    const { loads, rateColumn, carrierAmtColumn } = readLoads(filePath);
    const changes = [];
    const warnings = [];
    const skips = [];

    for (const load of loads) {
      const lane = `${load.originCity}, ${load.originState} -> ${load.destCity}, ${load.destState} on ${load.pickupDate}`;
      if (!load.originState || !load.destState || !load.pickupDate || load.originCountry !== 'US' || load.destCountry !== 'US') {
        warnings.push(`row ${load.rowNumber}: skipped (${lane}) - only US loads with a known ZIP and pickup date are checked`);
        continue;
      }
      const boardLoads = await boardForLoad(page, load, log);
      if (boardLoads.length >= MAX_ROWS) {
        warnings.push(`${load.originState}->${load.destState} ${load.pickupDate}: board returned the ${MAX_ROWS}-row maximum; some postings may be missed`);
      }

      // A load ATZ already has posted on the board is never posted again by you.
      const atzPosting = boardLoads.find(b => isSkipAgencyPosting(b, load));
      if (atzPosting) {
        skips.push(load.rowNumber);
        log(`  row ${load.rowNumber}: ${lane}  SKIPPED - already posted by ${atzPosting.Agency} (#${atzPosting.LoadId}, $${atzPosting.TotalRevenue})`);
        continue;
      }

      const myGroup = trailerGroup(load.equipment);
      const ownCodes = new Set([...OWN_POSTING_CODES, load.postingCode]);
      const competitors = boardLoads.filter(b =>
        !ownCodes.has(String(b.Agency || '').trim().toUpperCase()) &&
        boardPickupDate(b) === load.pickupDate &&
        b.OriginState === load.originState && b.DestinationState === load.destState &&
        (sameCity(b.OriginCity, load.originCity) || (b.OriginZipCode && b.OriginZipCode === load.originZip)) &&
        (sameCity(b.DestinationCity, load.destCity) || (b.DestinationZipCode && b.DestinationZipCode === load.destZip)) &&
        (b.TrailerTypes || []).some(t => trailerGroup(t) === myGroup) &&
        Number(b.TotalRevenue) > 0
      );
      const top = competitors.reduce((best, b) => (!best || Number(b.TotalRevenue) > Number(best.TotalRevenue) ? b : best), null);

      if (!top) {
        log(`  row ${load.rowNumber}: ${lane}  $${load.rate}  (no other postings)`);
      } else if (Number(top.TotalRevenue) >= load.rate
        || (matchesTopCompetitor(fileName, load) && Number(top.TotalRevenue) + OUTBID_BY !== load.rate)) {
        const newRate = Number(top.TotalRevenue) + OUTBID_BY;
        changes.push({ rowNumber: load.rowNumber, newRate });
        log(`  row ${load.rowNumber}: ${lane}  $${load.rate} -> $${newRate}  (top: ${top.Agency} $${top.TotalRevenue})`);
      } else {
        log(`  row ${load.rowNumber}: ${lane}  $${load.rate}  (already highest; next ${top.Agency} $${top.TotalRevenue})`);
      }
    }

    warnings.forEach(w => log(`  ! ${w}`));
    if (changes.length && apply) {
      await writeRates(filePath, rateColumn, carrierAmtColumn, changes);
      log(`  Updated ${changes.length} rate(s) in ${fileName}`);
    } else if (changes.length) {
      log(`  ${changes.length} rate(s) would change (report only; nothing written)`);
    }
    // Rate changes are written first (they use the original row numbers).
    if (skips.length && apply) {
      await removeRows(filePath, skips);
      log(`  Removed ${skips.length} load(s) already posted by ATZ from ${fileName}`);
    } else if (skips.length) {
      log(`  ${skips.length} load(s) already posted by ATZ would be removed (report only)`);
    }
    results.push({ filePath, changes, warnings, skips, remaining: loads.length - skips.length });
  }
  return results;
}

module.exports = {
  getWorkPage, openBoard, showLoggedIn, searchBoard, boardForLoad, checkFiles, sameCity, abbreviates, OWN_POSTING_CODES,
  getTrailerGroups, boardPickupDate, OUTBID_BY, isSkipAgencyPosting, removeRowsFromSheetXml, SKIP_IF_POSTED_BY,
  matchesTopCompetitor
};

// ---------- standalone report ----------
if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const folder = args.find(a => !a.startsWith('--')) || path.join(os.homedir(), 'Downloads');
  const files = fs.existsSync(folder)
    ? fs.readdirSync(folder).filter(n => /^Landstar_Bulk_.*\.(xlsx|xls)$/i.test(n)).map(n => path.join(folder, n)).sort()
    : [];
  (async () => {
    if (!files.length) { console.log(`No Landstar_Bulk_*.xlsx files in ${folder}`); return; }
    const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: null });
    try {
      const page = await openBoard(context);
      await checkFiles(page, files, { apply });
    } finally {
      await context.close();
    }
  })().catch(err => { console.error('Rate check failed:', err.message); process.exit(1); });
}
