// Alerts to Daniel's own Gmail when something needs him and he is away (Daniel 2026-11-27: "do
// 4": on 11/27 the Chat bot was stuck 1.5 hours and 16 RXO lists were missed unnoticed).
// Run by the watchdog every check. It emails (through the TMS server's Gmail connection,
// /api/paramount-email action "alertSelf", to the account's own address):
//   - every red/amber problem the Today panel shows (upload bot needs the Landstar sign-in,
//     uploads failing, Chat bot stuck, uploads to check, a bot down...)
//   - Google Chat files waiting more than 15 minutes (a question for you, or the TMS tab
//     is closed so nothing imports)
// A problem is emailed once it has lasted 5 minutes, once per problem (again after 4 hours if
// it is still there), and at most one email every 10 minutes (problems are grouped).
// Settings: alerts-settings.json { "enabled": true }. Tested in alerts.test.js.
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = process.env.ALERTS_SETTINGS_FILE || path.join(__dirname, 'alerts-settings.json');
const STATE_FILE = process.env.ALERTS_STATE_FILE || path.join(__dirname, 'alerts-state.json');
const EMAIL_URL = 'http://127.0.0.1:5173/api/paramount-email';
const LASTS_MS = 5 * 60 * 1000;
const RESEND_MS = 4 * 60 * 60 * 1000;
const GAP_MS = 10 * 60 * 1000;
const CHAT_WAITING_MS = 15 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 1000;

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
};
function saveJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 1));
  fs.renameSync(temp, file);
}

// Loads the TMS reports as NOT CONFIRMED (exported 3+ hours ago, Landstar never confirmed them;
// status-server.js /unconfirmed). A report older than 30 minutes is stale (the TMS tab closed).
const UNCONFIRMED_FILE = process.env.UNCONFIRMED_FILE || path.join(__dirname, 'unconfirmed-loads.json');
function unconfirmedProblem(report, now = Date.now()) {
  const loads = Array.isArray(report?.loads) ? report.loads : [];
  if (!loads.length || now - Number(report.at || 0) > 30 * 60 * 1000) return null;
  const ids = loads.map(load => load.id).sort();
  return {
    key: `unconfirmed-${ids.join(',')}`, level: 'bad',
    title: `${loads.length} load${loads.length === 1 ? '' : 's'} exported 3+ hours ago never reached Landstar`,
    detail: `${loads.slice(0, 8).map(load => `${load.customer} #${load.id}${load.route ? ` (${load.route})` : ''}`).join('; ')}${loads.length > 8 ? `; and ${loads.length - 8} more` : ''}. In the TMS: Landstar -> Errors, then check Bulk Postings or export them again.`
  };
}

// Chat files waiting longer than CHAT_WAITING_MS: one problem.
function chatWaitingProblem(items, now = Date.now()) {
  const old = (items || []).filter(item => now - Number(item.savedAt || item.at || now) >= CHAT_WAITING_MS);
  if (!old.length) return null;
  const oldest = Math.min(...old.map(item => Number(item.savedAt || item.at || now)));
  return {
    key: `chat-waiting-${oldest}`, level: 'warn',
    title: `${old.length} Google Chat file${old.length === 1 ? '' : 's'} waiting for you (oldest ${Math.round((now - oldest) / 60000)} min)`,
    detail: `${old.map(item => `${item.chat || 'Chat'}: ${item.label || item.fileName || item.type}`).join('; ')}. A list with a new name or a picture needs you to pick the account in the TMS; if the TMS tab is closed, nothing imports until it is opened.`
  };
}

// Which problems to email now: { send: [problems], state } (pure, for the tests).
function planAlerts(problems, state = {}, now = Date.now()) {
  const next = { seen: { ...(state.seen || {}) }, sent: { ...(state.sent || {}) }, lastEmailAt: Number(state.lastEmailAt) || 0 };
  const current = new Set(problems.map(problem => problem.key));
  // Forget problems that went away (so they alert again if they come back later).
  for (const key of Object.keys(next.seen)) if (!current.has(key)) delete next.seen[key];
  for (const key of Object.keys(next.sent)) if (!current.has(key)) delete next.sent[key];
  const due = [];
  for (const problem of problems) {
    if (!next.seen[problem.key]) next.seen[problem.key] = now;
    if (now - next.seen[problem.key] < LASTS_MS) continue;
    if (next.sent[problem.key] && now - next.sent[problem.key] < RESEND_MS) continue;
    due.push(problem);
  }
  if (!due.length || now - next.lastEmailAt < GAP_MS) return { send: [], state: next };
  for (const problem of due) next.sent[problem.key] = now;
  next.lastEmailAt = now;
  return { send: due, state: next };
}

function buildAlertEmail(problems, now = Date.now()) {
  const time = new Date(now).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const subject = problems.length === 1
    ? `TMS needs you: ${problems[0].title}`
    : `TMS needs you: ${problems.length} things (${problems[0].title}...)`;
  const text = [
    `As of ${time}, your TMS computer reports:`,
    '',
    ...problems.flatMap(problem => [`${problem.level === 'bad' ? '[!]' : '[ ]'} ${problem.title}`, problem.detail ? `    ${problem.detail}` : '', '']),
    'Open the TMS (Today panel) to see more. You get one email per problem; it comes again after 4 hours if it is still there.',
    'To turn these emails off: bot\\alerts-settings.json -> "enabled": false.'
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
  return { subject, text };
}

let lastCheck = 0;
let running = false;
// One pass (the watchdog calls it every 10 seconds; it runs at most once a minute).
async function checkAlerts({ log = console.log, now = Date.now(), fetchImpl = fetch } = {}) {
  if (running || now - lastCheck < CHECK_EVERY_MS) return [];
  const settings = { enabled: true, ...readJson(SETTINGS_FILE, {}) };
  if (!settings.enabled) return [];
  running = true;
  lastCheck = now;
  try {
    delete require.cache[require.resolve('./today')];
    const { readToday } = require('./today');
    const { readChatStatus } = require('./chat-inbox');
    const problems = [...(readToday({ chatBot: readChatStatus(now), now }).problems || [])];
    try {
      const inbox = require('./chat-inbox');
      const items = typeof inbox.listInbox === 'function' ? inbox.listInbox() : [];
      const waiting = chatWaitingProblem(items, now);
      if (waiting) problems.push(waiting);
    } catch { /* no inbox */ }
    const unconfirmed = unconfirmedProblem(readJson(UNCONFIRMED_FILE, null), now);
    if (unconfirmed) problems.push(unconfirmed);
    const { send, state } = planAlerts(problems, readJson(STATE_FILE, {}), now);
    if (send.length) {
      const { subject, text } = buildAlertEmail(send, now);
      const response = await fetchImpl(EMAIL_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'alertSelf', subject, text }), signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) {
        const reason = await response.text().catch(() => '');
        log(`Alert email could not be sent (HTTP ${response.status}): ${reason.slice(0, 200)}. Trying again in a minute.`);
        return [];
      }
      log(`Alert emailed to you: ${send.map(problem => problem.title).join(' | ')}`);
    }
    saveJson(STATE_FILE, state);
    return send;
  } catch (error) {
    log(`Alert check failed: ${error.message}`);
    return [];
  } finally {
    running = false;
  }
}

module.exports = { checkAlerts, planAlerts, buildAlertEmail, chatWaitingProblem, unconfirmedProblem, LASTS_MS, GAP_MS, RESEND_MS };
