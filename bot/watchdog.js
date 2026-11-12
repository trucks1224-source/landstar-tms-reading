// Watchdog: keeps the whole local Landstar stack running.
//
// Every few seconds it checks the local workers and restarts any that died:
//   - the TMS dev server (Vite, http://127.0.0.1:5173)
//   - the upload bot      (bot/status-server.js on http://127.0.0.1:47615)
//   - the helper bot      (bot/helper-status.json, written every few seconds)
//   - the removal bot     (bot/removal-status.json, written every few seconds)
//   - the rate worker     (bot/rates-status.json, written every few seconds)
//
// Run it and leave it open:   node watchdog.js
// (or double-click "Start Everything (watchdog).bat" in the project folder)
//
// It only restarts a piece after it has been down for a little while, so a slow
// login or a browser restart is not mistaken for a crash. Closing a bot's own
// browser window still turns that bot off - the watchdog brings it back on the
// next check unless you close the watchdog window first.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BOT_DIR = __dirname;
const HELPER_STATUS_FILE = path.join(BOT_DIR, 'helper-status.json');
const { removalActive, readRatesStatus } = require('./status-server');

const TMS_URL = 'http://127.0.0.1:5173';
const BOT_STATUS_URL = 'http://127.0.0.1:47615/status';

// How long a piece may be unreachable before we restart it (a slow login is fine).
const RESTART_AFTER_MS = 45 * 1000;
// Do not relaunch the same piece twice within this window (it may still be opening).
const RELAUNCH_COOLDOWN_MS = 90 * 1000;
const CHECK_MS = 10 * 1000;

const downSince = { tms: 0, bot: 0, helper: 0, removal: 0, rates: 0 };
const lastLaunch = { tms: 0, bot: 0, helper: 0, removal: 0, rates: 0 };

const log = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);

async function answers(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function helperRunning() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HELPER_STATUS_FILE, 'utf8'));
    return Date.now() - Number(parsed.at) < 90000;
  } catch {
    return false;
  }
}

// Launch a .bat in its own window so it keeps running on its own and can be closed.
function launch(batFile, title) {
  const launcher = path.join(BOT_DIR, batFile);
  const child = spawn('cmd.exe', ['/c', `start "${title}" "${launcher}"`], {
    cwd: BOT_DIR, detached: true, stdio: 'ignore', windowsVerbatimArguments: true
  });
  child.on('error', error => log(`Could not start ${batFile}: ${error.message}`));
  child.unref();
}

function launchTms() {
  const child = spawn('cmd.exe', ['/c', 'start "Landstar TMS" npx vite --port 5173 --strictPort'], {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsVerbatimArguments: true
  });
  child.on('error', error => log(`Could not start the TMS: ${error.message}`));
  child.unref();
}

// Restart a piece only after it has stayed down long enough, and not too often.
function maybeRestart(key, isUp, start, label) {
  const now = Date.now();
  if (isUp) { downSince[key] = 0; return; }
  if (!downSince[key]) { downSince[key] = now; return; }
  if (now - downSince[key] < RESTART_AFTER_MS) return;
  if (now - lastLaunch[key] < RELAUNCH_COOLDOWN_MS) return;
  lastLaunch[key] = now;
  downSince[key] = 0;
  log(`${label} is down - restarting it.`);
  start();
}

async function check() {
  const [tmsUp, botUp] = await Promise.all([answers(TMS_URL), answers(BOT_STATUS_URL)]);
  maybeRestart('tms', tmsUp, launchTms, 'The TMS dev server');
  const postingEnabled = JSON.parse(fs.readFileSync(path.join(BOT_DIR, 'automation-policy.json'), 'utf8')).automaticPostingEnabled !== false;
  if (postingEnabled) maybeRestart('bot', botUp, () => launch('Start Landstar Bot.bat', 'Landstar Bot'), 'The upload bot');
  maybeRestart('helper', helperRunning(), () => launch('Start Helper Bot.bat', 'Landstar Helper Bot'), 'The helper bot');
  maybeRestart('removal', removalActive(), () => launch('Start Removal Bot.bat', 'Landstar Removal Bot'), 'The removal bot');
  const rates = readRatesStatus();
  maybeRestart('rates', rates.state !== 'off', () => launch('Start Rate Worker.bat', 'Landstar Rate Worker'), 'The rate worker');
}

log('Watchdog on. Keeping the TMS, posting, helper, removal and rate workers running.');
log('Close this window to turn the watchdog off.');
void check();
setInterval(check, CHECK_MS);
