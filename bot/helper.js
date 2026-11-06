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
const { setStatus, readAssignQueue, readTrackingWatch, readTrackingBills, reportTrackingResults, readMercuryGateQueue, HELPER_STATUS_FILE } = require('./status-server');
const { openBoard } = require('./rate-check');
const { processAssignQueue } = require('./assign');
const { checkTracking } = require('./clarity');
const { runNextMercuryGateJob } = require('./mercurygate-job');

const PROFILE_DIR = path.join(__dirname, 'browser-profile-helper');
const LOOP_MS = 5000;
const TRACKING_CHECK_MS = 5 * 60 * 1000;
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

const off = () => { try { fs.writeFileSync(HELPER_STATUS_FILE, JSON.stringify({ state: 'off', message: 'Helper bot is off', at: Date.now() })); } catch { /* ignore */ } };

(async () => {
  console.log('Landstar HELPER bot: ON (Assign Capacity, Clarity, MercuryGate)');
  console.log('Close its browser window to turn it off.\n');
  const context = await launch();
  let closed = false;
  context.on('close', () => {
    closed = true;
    off();
    setTimeout(() => { console.log('Helper bot window closed. Helper bot: OFF'); process.exit(0); }, 3000);
  });
  process.on('SIGINT', async () => { closed = true; off(); await context.close().catch(() => {}); process.exit(0); });

  await openBoard(context); // sign in to Landstar (the first time Daniel signs in in this window)
  setStatus('logged-in', 'Ready');
  console.log(`[${timeNow()}] Helper signed in. Waiting for tasks...`);

  let trackingDueAt = Date.now() + 30 * 1000;
  let lastActivity = Date.now();
  while (!closed) {
    try {
      if (readAssignQueue().length) {
        setStatus('working', 'Assigning capacity');
        console.log(`\n[${timeNow()}] Assigning capacity on booked loads...`);
        await processAssignQueue(context, { log: line => console.log(line) });
        lastActivity = Date.now();
      } else if (readMercuryGateQueue().length) {
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
