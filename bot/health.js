// Morning system check for the TMS header: is every piece of the local Landstar stack
// running, and what to do about anything that isn't. buildHealthReport is pure (tested in
// health.test.js); vite.config.js gathers the inputs and serves GET /api/health.
const fs = require('fs');
const path = require('path');

const WATCHDOG_STATUS_FILE = process.env.WATCHDOG_STATUS_FILE || path.join(__dirname, 'watchdog-status.json');
// The watchdog writes its heartbeat every check (10 s); older than this means it stopped.
const WATCHDOG_FRESH_MS = 60 * 1000;
// A restart within this window is shown on the check (e.g. an overnight Windows update).
const RECENT_RESTART_MS = 18 * 60 * 60 * 1000;
// A bot still signing in after this long is waiting for Daniel to sign in to Landstar.
const SIGN_IN_GRACE_MS = 2 * 60 * 1000;

function writeWatchdogHeartbeat(now = Date.now()) {
  const temp = `${WATCHDOG_STATUS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ at: now, pid: process.pid }));
  fs.renameSync(temp, WATCHDOG_STATUS_FILE);
}

function readWatchdogStatus(now = Date.now()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(WATCHDOG_STATUS_FILE, 'utf8'));
    return now - Number(parsed.at) < WATCHDOG_FRESH_MS ? { state: 'running', at: parsed.at } : { state: 'off', at: parsed.at };
  } catch {
    return { state: 'off' };
  }
}

const timeOf = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// One bot's row. status = { state, message, at, signingInSince? } or null when unreachable.
function botRow(id, label, status, { botsEnabled, expected = true, now, offFix }) {
  const state = status?.state || 'off';
  if (state === 'off') {
    if (!expected) return { id, label, level: 'ok', detail: 'Turned off on purpose' };
    if (!botsEnabled) return { id, label, level: 'warn', detail: 'Paused (the bot switch is off)', fix: 'Turn on the bot switch in the header when you want it running.' };
    return { id, label, level: 'bad', detail: 'Not running', fix: offFix };
  }
  if (state === 'blocked') return { id, label, level: 'bad', detail: status.message || 'Stopped on a problem', fix: 'Look at its window for the message.' };
  if (state === 'signing-in' || state === 'starting') {
    const since = Number(status.signingInSince) || 0;
    if (since && now - since > SIGN_IN_GRACE_MS) {
      return { id, label, level: 'warn', detail: 'Waiting for Landstar sign-in', fix: 'Sign in to Landstar in its bot window (far-left screen).' };
    }
    return { id, label, level: 'info', detail: 'Starting up' };
  }
  return { id, label, level: 'ok', detail: status.message || 'Running' };
}

// inputs: { now, bootedAt, botsEnabled, postingEnabled, watchdog, upload, helper, removal, rates }
function buildHealthReport(inputs) {
  const { now = Date.now(), bootedAt, botsEnabled = true, postingEnabled = true, watchdog = {}, upload, helper, removal, rates } = inputs;
  const restartHint = 'The watchdog brings it back within about a minute.';
  const rows = [
    { id: 'tms', label: 'TMS server', level: 'ok', detail: 'Running' },
    watchdog.state === 'running'
      ? { id: 'watchdog', label: 'Watchdog', level: 'ok', detail: 'Running (restarts anything that stops)' }
      : { id: 'watchdog', label: 'Watchdog', level: 'bad', detail: 'Not running: stopped bots will not come back by themselves', fix: 'Double-click "Start Everything (watchdog)" in the project folder.' },
    botRow('upload', 'Posting bot', upload, { botsEnabled, expected: postingEnabled, now, offFix: watchdog.state === 'running' ? restartHint : 'Click the bot light in the header, or start the watchdog.' }),
    botRow('helper', 'Helper bot', helper, { botsEnabled, now, offFix: watchdog.state === 'running' ? restartHint : 'Start the watchdog, or double-click "Start Helper Bot" in the bot folder.' }),
    botRow('removal', 'Removal bot', removal, { botsEnabled, now, offFix: watchdog.state === 'running' ? restartHint : 'Start the watchdog, or double-click "Start Removal Bot" in the bot folder.' }),
    botRow('rates', 'Rate worker', rates, { botsEnabled, now, offFix: watchdog.state === 'running' ? restartHint : 'Start the watchdog, or double-click "Start Rate Worker" in the bot folder.' })
  ];
  if (!botsEnabled) {
    rows.splice(1, 0, { id: 'switch', label: 'Bot switch', level: 'warn', detail: 'Off: the bots are paused', fix: 'Turn on the bot switch in the header to start posting and tracking.' });
  }
  if (Number.isFinite(bootedAt) && now - bootedAt < RECENT_RESTART_MS) {
    rows.push({ id: 'restart', label: 'PC restart', level: 'info', detail: `This PC restarted at ${timeOf(bootedAt)}${new Date(bootedAt).toDateString() !== new Date(now).toDateString() ? ' yesterday' : ''}.` });
  }
  const rank = { ok: 0, info: 1, warn: 2, bad: 3 };
  const worst = rows.reduce((level, row) => (rank[row.level] > rank[level] ? row.level : level), 'ok');
  return { at: now, worst, rows };
}

module.exports = { buildHealthReport, writeWatchdogHeartbeat, readWatchdogStatus, WATCHDOG_STATUS_FILE, SIGN_IN_GRACE_MS };
