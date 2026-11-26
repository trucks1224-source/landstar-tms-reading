// Keeps chosen Landstar postings fresh on DAT by pausing and unpausing them (Daniel, 2026-11-25).
//
// Landstar sends brokerable postings to DAT. Pausing a posting (PAUSE -> CONFIRM on its detail
// page) and unpausing it (UNPAUSE) makes it show as fresh there, with the same Landstar load #:
// nothing is reposted or cancelled.
//   - AMERI 18347- ATZ postings: every 5 minutes
//   - hazmat postings (any customer): every 30 minutes
// Run by the rate worker between export checks (new exports always go first).
//
// Landstar's warning: "All paused loads will be immediately removed from the load board and
// deleted at midnight today." So a pause is written down before it is clicked, and a load is
// unpaused (and checked) before anything else; a load the bot cannot unpause is retried on every
// pass and reported. A posting that was already paused (maybe by Daniel) is never touched.
//
// Settings: pause-refresh-settings.json { "enabled": true, "onlyLoadId": "" }.
// onlyLoadId limits it to one Landstar load # (for the first test).
const fs = require('fs');
const path = require('path');
const { uploadedSignatures, postingSignature } = require('./bot-postings');

const AMERI_REFRESH_MS = 5 * 60 * 1000;
const HAZMAT_REFRESH_MS = 30 * 60 * 1000; // was 10; Daniel, 2026-11-25
const STATE_FILE = process.env.PAUSE_REFRESH_STATE_FILE || path.join(__dirname, 'pause-refresh-state.json');
const SETTINGS_FILE = process.env.PAUSE_REFRESH_SETTINGS_FILE || path.join(__dirname, 'pause-refresh-settings.json');
const DETAIL_URL = loadId => `https://portal.landstaronline.com/agent/detail/PORTAL/${loadId}/LRGR`;
// Uploaded AMERI 18347- ATZ exports (exact account, not ATZ H), including renamed copies
// ("..._3of9.xlsx", "... (1).xlsx", "..._1.xlsx", "...__7.xlsx").
const AMERI_EXPORT = /^Landstar_Bulk_AMERI_18347__ATZ(?:_\d+of\d+)?(?:_{1,2}\d+)?(?: \(\d+\))?\.xlsx$/i;

const clean = value => String(value ?? '').trim().toUpperCase();
const postedAt = load => Number(String(load.OrderDate || '').match(/-?\d+/)?.[0] || 0);
const isHazmat = load => clean(load.CommodityCode) === 'HAZMAT';

function readJson(file, fallback) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : fallback;
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJson(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, file);
}

const readState = (file = STATE_FILE) => readJson(file, {});
const readSettings = (file = SETTINGS_FILE) => ({ enabled: true, onlyLoadId: '', ...readJson(file, {}) });

// Which of your board postings are due a pause/unpause now. AMERI wins over hazmat (5 minutes).
function selectDue(postings, { ameriSignatures, ownCodes, state = {}, now = Date.now(), onlyLoadId = '' }) {
  const own = new Set(ownCodes.map(clean));
  const due = [];
  for (const posting of postings) {
    const loadId = String(posting.LoadId || '').trim();
    if (!loadId || clean(posting.SourceSystemID) !== 'PORTAL' || !own.has(clean(posting.Agency))) continue;
    if (onlyLoadId && loadId !== String(onlyLoadId).trim()) continue;
    const group = ameriSignatures.has(postingSignature(posting)) ? 'AMERI' : isHazmat(posting) ? 'HAZMAT' : '';
    if (!group) continue;
    const every = group === 'AMERI' ? AMERI_REFRESH_MS : HAZMAT_REFRESH_MS;
    const last = Math.max(postedAt(posting), Number(state[loadId]?.refreshedAt) || 0);
    if (now - last >= every) due.push({ loadId, group, posting });
  }
  // AMERI first (it must keep its 5 minutes), then longest-waiting first.
  return due.sort((a, b) => Number(b.group === 'AMERI') - Number(a.group === 'AMERI')
    || (Number(state[a.loadId]?.refreshedAt) || postedAt(a.posting))
    - (Number(state[b.loadId]?.refreshedAt) || postedAt(b.posting)));
}

// Loads the bot paused and has not confirmed unpaused (must be unpaused before anything else).
function leftPaused(state) {
  return Object.entries(state).filter(([, entry]) => entry.pausedAt && !(entry.unpausedAt >= entry.pausedAt))
    .map(([loadId]) => loadId);
}

// Matches the button's last word, so an icon's text in front of it does not matter, and "pause"
// never matches UNPAUSE (no space before "pause" there).
const buttonName = name => new RegExp(`(?:^|\\s)${name}\\s*$`, 'i');
const button = (page, name) => page.getByRole('button', { name: buttonName(name) }).first();

async function waitVisible(locator, timeout) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function openDetail(page, loadId) {
  await page.goto(DETAIL_URL(loadId), { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL(/portal\.landstaronline\.com\/agent\/detail/, { timeout: 60000 }).catch(() => {});
  // The page is ready once it shows PAUSE or UNPAUSE.
  const pause = button(page, 'pause');
  const unpause = button(page, 'unpause');
  for (let i = 0; i < 60; i += 1) {
    if (await unpause.isVisible().catch(() => false)) return 'paused';
    if (await pause.isVisible().catch(() => false)) return 'active';
    await page.waitForTimeout(500);
  }
  return 'unknown';
}

// Clicks UNPAUSE (and its confirmation, if Landstar asks) until PAUSE is back. True when confirmed.
async function unpause(page, loadId, log) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const shown = attempt === 1 ? 'paused' : await openDetail(page, loadId);
    if (shown === 'active') return true;
    if (shown !== 'paused') continue;
    await button(page, 'unpause').click({ timeout: 15000 }).catch(() => {});
    const confirm = button(page, 'confirm');
    if (await waitVisible(confirm, 3000)) await confirm.click({ timeout: 10000 }).catch(() => {});
    if (await waitVisible(button(page, 'pause'), 20000)) return true;
    log(`    ! #${loadId}: UNPAUSE not confirmed (try ${attempt} of 3)`);
  }
  return false;
}

// One pause/unpause on one posting. Returns 'refreshed', 'skipped' (already paused / not found)
// or throws when the load may be left paused.
async function pauseAndUnpause(context, loadId, { log = console.log, statePath = STATE_FILE, settleMs = 3000 } = {}) {
  const page = await context.newPage();
  const save = patch => {
    const state = readState(statePath);
    state[loadId] = { ...state[loadId], ...patch };
    writeJson(statePath, state);
  };
  try {
    const shown = await openDetail(page, loadId);
    if (shown === 'paused') {
      log(`    #${loadId}: already paused on Landstar (not by this refresh); left alone.`);
      return 'skipped';
    }
    if (shown !== 'active') {
      log(`    #${loadId}: its Landstar page did not show PAUSE; skipped.`);
      return 'skipped';
    }
    // Written down before the click: if anything stops now, the next pass unpauses it.
    save({ pausedAt: Date.now(), error: '' });
    await button(page, 'pause').click({ timeout: 15000 });
    const confirm = button(page, 'confirm');
    if (!(await waitVisible(confirm, 10000))) throw new Error('Landstar did not ask to confirm the pause');
    await confirm.click({ timeout: 10000 });
    if (!(await waitVisible(button(page, 'unpause'), 20000))) {
      // Not shown as paused: make sure it is active before moving on.
      const now = await openDetail(page, loadId);
      if (now === 'active') { save({ unpausedAt: Date.now() }); return 'skipped'; }
    }
    await page.waitForTimeout(settleMs);
    if (!(await unpause(page, loadId, log))) {
      throw new Error(`Load #${loadId} is PAUSED on Landstar and would not unpause. Unpause it by hand: Landstar deletes paused loads at midnight.`);
    }
    save({ unpausedAt: Date.now(), refreshedAt: Date.now(), error: '' });
    return 'refreshed';
  } catch (error) {
    save({ error: error.message, errorAt: Date.now() });
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}

// One pass. Unpauses anything left paused first, then refreshes the due postings.
// shouldYield: checked between loads; true stops the pass (new exports are waiting).
async function runPauseRefresh(context, { log = console.log, shouldYield, statePath = STATE_FILE, settingsPath = SETTINGS_FILE } = {}) {
  const settings = readSettings(settingsPath);
  if (settings.enabled === false) return { refreshed: 0, problems: [] };
  const { openBoard, OWN_POSTING_CODES } = require('./rate-check');
  const { listPostings } = require('./dedupe');
  const problems = [];

  // 1. Never leave a load paused.
  for (const loadId of leftPaused(readState(statePath))) {
    const page = await context.newPage();
    try {
      log(`  Pause refresh: #${loadId} was left paused; unpausing it first.`);
      const shown = await openDetail(page, loadId);
      const ok = shown === 'active' || (shown === 'paused' && await unpause(page, loadId, log));
      const state = readState(statePath);
      if (ok) state[loadId] = { ...state[loadId], unpausedAt: Date.now(), error: '' };
      else problems.push(`Load #${loadId} is still PAUSED on Landstar; unpause it by hand (deleted at midnight).`);
      writeJson(statePath, state);
    } finally {
      await page.close().catch(() => {});
    }
  }

  // 2. Refresh what is due.
  const board = await openBoard(context, log, { reuse: true });
  const postings = await listPostings(board, OWN_POSTING_CODES, () => {});
  const ameriSignatures = uploadedSignatures(undefined, undefined, AMERI_EXPORT);
  const due = selectDue(postings, {
    ameriSignatures, ownCodes: OWN_POSTING_CODES, state: readState(statePath), onlyLoadId: settings.onlyLoadId
  });
  if (!due.length) return { refreshed: 0, problems };
  log(`  Pause refresh: ${due.length} posting(s) due (${due.filter(d => d.group === 'AMERI').length} AMERI, ${due.filter(d => d.group === 'HAZMAT').length} hazmat).`);
  let refreshed = 0;
  const done = new Set();
  // Before each load, an AMERI posting that has come due since the pass started goes first, so a
  // long hazmat pass never holds AMERI past its 5 minutes.
  const nextLoad = () => {
    const ameriNow = selectDue(postings, {
      ameriSignatures, ownCodes: OWN_POSTING_CODES, state: readState(statePath), onlyLoadId: settings.onlyLoadId
    }).find(item => item.group === 'AMERI' && !done.has(item.loadId));
    return ameriNow || due.find(item => !done.has(item.loadId));
  };
  for (let item = nextLoad(); item; item = nextLoad()) {
    const { loadId, group, posting } = item;
    done.add(loadId);
    if (shouldYield?.()) { log('  Pause refresh: paused for new exports; it continues after them.'); break; }
    const lane = `${posting.OriginCity || ''}, ${posting.OriginState || ''} -> ${posting.DestinationCity || ''}, ${posting.DestinationState || ''}`;
    try {
      const result = await pauseAndUnpause(context, loadId, { log, statePath });
      if (result === 'refreshed') {
        refreshed += 1;
        log(`    #${loadId} ${group} ${lane}: paused and unpaused (fresh on DAT).`);
      }
    } catch (error) {
      problems.push(error.message);
      log(`    ! #${loadId} ${group} ${lane}: ${error.message}`);
    }
  }
  return { refreshed, problems };
}

module.exports = {
  runPauseRefresh, pauseAndUnpause, selectDue, leftPaused, readSettings, AMERI_EXPORT, buttonName,
  AMERI_REFRESH_MS, HAZMAT_REFRESH_MS
};
