// The helper bot: a second Landstar bot in its own browser window (its own profile, signed in
// once), so the main bot can keep uploading while this one handles:
//   - Assign Capacity for loads booked in the TMS (assign.js)
//   - Clarity checks for the tracking emails (clarity.js)
//   - MercuryGate for booked Paramount loads (mercurygate-job.js)
// The TMS still talks only to the main bot's address (127.0.0.1:47615); the two bots share the
// queue and result files in this folder, and the helper's light comes from helper-status.json.
// While the helper runs, the main bot leaves these tasks to it.
//
//   node helper.js      (or double-click "Start Helper Bot.bat"; close its browser window to stop)

process.env.BOT_ROLE = 'helper'; // before status-server is loaded: no server, own light

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { setStatus, readHelperStatus, readAssignQueue, readTrackingWatch, readTrackingBills, reportTrackingResults, readMercuryGateQueue, reportDuplicateBills, HELPER_STATUS_FILE } = require('./status-server');
const { openBoard } = require('./rate-check');
const { readBotControl } = require('./local-bot-control');
const { processAssignQueue } = require('./assign');
const { checkTracking } = require('./clarity');
const { runNextMercuryGateJob, hasDueMercuryGateJob } = require('./mercurygate-job');
const { openMercuryGate, findRoutes } = require('./mercurygate');
const { checkFiles } = require('./rate-check');
const { isPrechecked, markPrechecked, isLockedByHelper, claim, release } = require('./prechecked');
const os = require('os');

// ---------- Helping with big exports ----------
// When idle, the helper rate-checks export files from the BACK of the list (the main bot
// uploads from the front), a few at a time; the main bot then uploads them without checking.
const DOWNLOADS = path.join(os.homedir(), 'Downloads');
const FILE_PATTERN = /^Landstar_Bulk_.*\.(xlsx|xls)$/i;
const HELP_BATCH = 3;
const HELP_MIN_WAITING = 6; // only when an export is big enough to be worth sharing

function filesToHelpWith() {
  let names = [];
  try { names = fs.readdirSync(DOWNLOADS).filter(name => FILE_PATTERN.test(name)); } catch { return []; }
  const files = names.map(name => path.join(DOWNLOADS, name)).filter(file => {
    try {
      const stat = fs.statSync(file);
      return stat.isFile() && stat.size > 0 && Date.now() - stat.mtimeMs > 5000;
    } catch { return false; }
  }).sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
  if (files.length < HELP_MIN_WAITING) return [];
  // Leave the front of the list to the main bot.
  return files.slice(HELP_BATCH * 2).filter(file => !isPrechecked(file) && !isLockedByHelper(file)).slice(-HELP_BATCH);
}

async function helpWithExports(context, log) {
  const files = filesToHelpWith().filter(claim);
  if (!files.length) return false;
  try {
    log(`  Rate-checking ${files.length} file(s) for the main bot: ${files.map(file => path.basename(file)).join(', ')}`);
    const boardPage = await openBoard(context, () => {});
    const results = await checkFiles(boardPage, files, { apply: true, log: () => {} });
    const skippedFolder = path.join(DOWNLOADS, 'landstar-skipped-atz');
    for (const result of results) {
      if (result.remaining === 0 && result.skips && result.skips.length) {
        // Every load already posted by ATZ: not uploaded (same as the main bot does).
        fs.mkdirSync(skippedFolder, { recursive: true });
        fs.renameSync(result.filePath, path.join(skippedFolder, path.basename(result.filePath)));
        log(`  ${path.basename(result.filePath)}: every load is already posted by ATZ; not uploaded.`);
      } else {
        markPrechecked(result.filePath);
      }
    }
    return true;
  } finally {
    files.forEach(release);
  }
}

const PROFILE_DIR = path.join(__dirname, 'browser-profile-helper');
const LOOP_MS = 5000;
const TRACKING_CHECK_MS = 5 * 60 * 1000;
const DUPLICATE_CHECK_MS = 30 * 60 * 1000;
const KEEP_ALIVE_MS = 15 * 60 * 1000;
const timeNow = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Same left screen as the main bot (the screen Daniel doesn't use), a little offset.
function leftScreen() {
  try {
    const out = require('child_process').execSync(
      'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; '
      + '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { \'{0},{1}\' -f $_.Bounds.X,$_.Bounds.Y }"',
      { encoding: 'utf8', timeout: 15000, windowsHide: true }
    );
    const screens = out.trim().split(/\r?\n/).map(line => line.split(',').map(Number)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (screens.length < 2) return null;
    const [x, y] = screens.sort((a, b) => a[0] - b[0])[0];
    return { x, y };
  } catch {
    return null;
  }
}

// A freight bill with more than one MercuryGate route tenders the BCO twice (it happened
// twice on 2026-11-09). Recent bills are checked every half hour; the TMS shows a banner.
async function checkDuplicateBills(context, log) {
  const bills = readTrackingBills().slice(0, 15);
  if (!bills.length) return;
  const page = await context.newPage();
  try {
    await openMercuryGate(page, log);
    const duplicates = [];
    for (const bill of bills) {
      const routes = await findRoutes(page, bill).catch(() => []);
      if (routes.length > 1) duplicates.push({ bill: String(bill), routes: routes.length, at: Date.now() });
    }
    reportDuplicateBills(duplicates);
    log(duplicates.length
      ? `  DUPLICATED freight bill(s): ${duplicates.map(item => `${item.bill} (${item.routes} routes)`).join(', ')}`
      : `  No duplicated freight bills (${bills.length} checked).`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function launch() {
  const screen = leftScreen();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: [...(screen ? [`--window-position=${screen.x + 80},${screen.y + 80}`] : []), '--start-maximized']
  });
  const page = context.pages()[0] || await context.newPage();
  let session = null;
  try {
    session = await context.newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  } catch { /* leave it as opened */ } finally {
    if (session) await session.detach().catch(() => {});
  }
  return context;
}

const off = () => {
  if (readHelperStatus().pid === process.pid) setStatus('off', 'Helper bot is off');
};

(async () => {
  console.log('Landstar HELPER bot: ON (Assign Capacity, Clarity; dispatch is manual)');
  console.log('Close its browser window to turn it off.\n');
  const context = await launch();
  setStatus('starting', 'Opening helper worker');
  const heartbeat = setInterval(() => {
    const status = readHelperStatus();
    setStatus(status.state, status.message);
  }, 10000);
  let closed = false;
  context.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    off();
    setTimeout(() => { console.log('Helper bot window closed. Helper bot: OFF'); process.exit(0); }, 3000);
  });
  process.on('SIGINT', async () => { closed = true; off(); await context.close().catch(() => {}); process.exit(0); });

  await openBoard(context); // sign in to Landstar (the first time Daniel signs in in this window)
  setStatus('logged-in', 'Ready');
  console.log(`[${timeNow()}] Helper signed in. Waiting for tasks...`);

  let trackingDueAt = Date.now() + 30 * 1000;
  let duplicatesDueAt = Date.now() + 2 * 60 * 1000;
  let lastActivity = Date.now();
  while (!closed) {
    try {
      if (!readBotControl()) {
        setStatus('logged-in', 'Local bots paused');
        await sleep(LOOP_MS);
        continue;
      }
      if (readAssignQueue().length) {
        setStatus('working', 'Assigning capacity');
        console.log(`\n[${timeNow()}] Assigning capacity on booked loads...`);
        await processAssignQueue(context, { log: line => console.log(line) });
        lastActivity = Date.now();
      } else if (hasDueMercuryGateJob()) {
        setStatus('working', 'Filling in MercuryGate');
        console.log(`\n[${timeNow()}] MercuryGate: filling in a booked Paramount load...`);
        await runNextMercuryGateJob(context, line => console.log(line));
        lastActivity = Date.now();
      } else if (Date.now() >= trackingDueAt && readTrackingWatch().length) {
        trackingDueAt = Date.now() + TRACKING_CHECK_MS;
        setStatus('working', 'Checking Clarity');
        console.log(`\n[${timeNow()}] Checking Clarity for booked loads...`);
        reportTrackingResults(await checkTracking(context, readTrackingWatch(), { log: line => console.log(line), candidateBills: readTrackingBills() }));
        lastActivity = Date.now();
      } else if (Date.now() >= duplicatesDueAt && readTrackingBills().length) {
        duplicatesDueAt = Date.now() + DUPLICATE_CHECK_MS;
        setStatus('working', 'Checking MercuryGate for duplicated freight bills');
        console.log(`\n[${timeNow()}] MercuryGate: checking recent freight bills for duplicates...`);
        await checkDuplicateBills(context, line => console.log(line));
        lastActivity = Date.now();
      } else if (!process.argv.includes('--dedicated-rates') && filesToHelpWith().length) {
        setStatus('working', 'Rate-checking an export');
        await helpWithExports(context, line => console.log(line));
        lastActivity = Date.now();
      } else if (Date.now() - lastActivity > KEEP_ALIVE_MS) {
        await openBoard(context, () => {}); // keeps the Landstar sign-in alive
        lastActivity = Date.now();
      }
    } catch (error) {
      if (closed) break;
      console.error(`[${timeNow()}] Helper task failed: ${error.message}. It will try again.`);
    }
    if (closed) break;
    setStatus('logged-in', `Ready · last check ${timeNow()}`);
    await sleep(LOOP_MS);
  }
  off();
  process.exit(0);
})().catch(error => {
  off();
  console.error('Helper bot failed:', error.message);
  process.exit(1);
});
