// "Today" in the TMS (Daniel 2026-11-27): what the bots did today and what needs attention,
// read from their logs and folders. The TMS server serves it at GET /api/today.
//
//   uploads   every file the upload bot sent to Landstar today, and every failure
//   rates     per account: loads checked on the board, rates raised, loads skipped (ATZ has it)
//   reviews   files waiting in Downloads/landstar-upload-review (uploads whose result is unknown)
//   chat      what came in from Google Chat today (bot/chat-inbox and its done folder)
//   problems  what Daniel must look at now (the TMS shows them in a red banner, with a sound)
//
// The parse* functions are pure (tested in today.test.js).
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_DIR = process.env.BOT_LOG_DIR || path.join(__dirname, 'logs');
const REVIEW_DIR = process.env.UPLOAD_REVIEW_DIR || path.join(os.homedir(), 'Downloads', 'landstar-upload-review');
const CHAT_INBOX_DIR = process.env.CHAT_INBOX_DIR || path.join(__dirname, 'chat-inbox');

// Uploads failing for this long in a row (no file got through) is a problem.
const UPLOAD_FAILING_AFTER_MS = 3 * 60 * 1000;

const dayStamp = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// "Landstar_Bulk_R_X_O_2429200___ATZ_P_1of2__1.xlsx" -> "R X O 2429200 - ATZ P". The export
// file name is the account with every space and dash turned into "_", so a run of 2+ "_" was
// " - " (or "- ") and a single "_" a space. key = letters and digits only, for matching.
function accountFromFile(fileName) {
  const base = String(fileName || '').replace(/\.(xlsx|xls|csv)$/i, '')
    .replace(/^Landstar_Bulk_/i, '')
    .replace(/(?:\s*\(\d+\))+$/, '')
    .replace(/_+\d+$/, '')
    .replace(/_\d+of\d+$/i, '')
    .replace(/_+$/, '');
  const name = base.replace(/_{2,}/g, ' - ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return { name, key: name.toUpperCase().replace(/[^A-Z0-9]/g, '') };
}

// The time a bot log line was written: "[09:20:41] ..." on `day` -> ms.
function lineTime(line, day) {
  const match = String(line).match(/^\[(\d{2}):(\d{2}):(\d{2})\]/);
  if (!match) return 0;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, Number(match[1]), Number(match[2]), Number(match[3])).getTime();
}

// Upload bot log -> [{ at, file, account, ok, message }] in time order.
function parseUploadLog(text, day) {
  const events = [];
  let current = '';
  let lastAt = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    // A message that starts on a new line (">>> ACTION NEEDED ...") has no time of its own:
    // it was written with the line above.
    const at = lineTime(line, day) || lastAt;
    lastAt = at;
    const uploading = line.match(/Uploading:\s*(\S.*\.xlsx)\s*$/i);
    if (uploading) { current = uploading[1].trim(); continue; }
    const done = line.match(/Done:\s*(\S.*\.xlsx)\s*$/i);
    if (done) {
      const file = done[1].trim();
      events.push({ at, file, account: accountFromFile(file), ok: true, message: 'Posted on Landstar' });
      current = '';
      continue;
    }
    const failed = line.match(/ERROR\s+(?:\[[^\]]*\]\s*)?(?:!\s*)?(Uploads stopped:|Submission outcome unknown:)\s*(.*)$/i);
    if (failed) {
      const message = `${failed[1]} ${failed[2]}`.replace(/\s+/g, ' ').replace(/(Check C:\\\S+.*)$/i, '').trim();
      events.push({ at, file: current, account: accountFromFile(current), ok: false, unknown: /outcome unknown/i.test(failed[1]), message: message.slice(0, 300) });
      continue;
    }
    if (/ACTION NEEDED: .*Landstar login page|ACTION NEEDED: log in to Landstar/i.test(line)) {
      events.push({ at, file: '', account: accountFromFile(''), ok: false, signIn: true, message: 'The upload bot is waiting for the Landstar sign-in' });
    }
    if (/LOGGED IN TO LANDSTAR|Logged in\. Waiting for exports/i.test(line)) {
      events.push({ at, file: '', account: accountFromFile(''), ok: true, signedIn: true, message: 'Signed in to Landstar' });
    }
  }
  return events;
}

// Rate-check log -> { accountKey: { name, checked, raised, skippedAtz, raises: [...] } }.
function parseRatesLog(text) {
  const byAccount = {};
  let current = null;
  const entry = account => {
    byAccount[account.key] = byAccount[account.key] || { name: account.name, checked: 0, raised: 0, skippedAtz: 0, raises: [] };
    return byAccount[account.key];
  };
  for (const line of String(text || '').split(/\r?\n/)) {
    const header = line.match(/Rate check:\s*(\S.*\.xlsx)/i);
    if (header) { current = entry(accountFromFile(header[1])); continue; }
    if (!current || !/\brow \d+:/i.test(line)) continue;
    current.checked += 1;
    if (/SKIPPED - already posted by ATZ/i.test(line)) current.skippedAtz += 1;
    const raise = line.match(/row \d+:\s*(.+?)\s+on\s+\S+\s+\$(\d+)\s*->\s*\$(\d+)\s*\(top:\s*(\w+)/i);
    if (raise) {
      current.raised += 1;
      if (current.raises.length < 20) current.raises.push({ lane: raise[1], from: Number(raise[2]), to: Number(raise[3]), agency: raise[4] });
    }
  }
  return byAccount;
}

// What needs Daniel now, from the parsed day. health = the system check report (rows).
// [{ key, level: 'bad'|'warn', title, detail }]
function findProblems({ uploads = [], reviews = [], health = null, chatBot = null, now = Date.now() }) {
  const problems = [];
  // Uploads failing: the newest upload event is a failure and nothing got through since.
  const fileEvents = uploads.filter(event => event.file || event.signIn || event.signedIn);
  const last = fileEvents[fileEvents.length - 1];
  if (last && !last.ok) {
    let firstFailure = last.at;
    for (let index = fileEvents.length - 1; index >= 0 && !fileEvents[index].ok; index -= 1) firstFailure = fileEvents[index].at;
    if (last.signIn) {
      problems.push({ key: `upload-signin-${firstFailure}`, level: 'bad', title: 'Upload bot needs the Landstar sign-in', detail: 'Sign in to Landstar in the upload bot window (far-left screen). Nothing posts until then.' });
    } else if (now - firstFailure >= UPLOAD_FAILING_AFTER_MS || last.unknown) {
      const failures = fileEvents.filter(event => !event.ok && event.at >= firstFailure).length;
      problems.push({
        key: `upload-failing-${firstFailure}`, level: 'bad',
        title: last.unknown ? `Upload of ${last.account.name || 'a file'} may not have posted` : `Uploads to Landstar are failing (${failures} in a row since ${new Date(firstFailure).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})`,
        detail: `${last.message}${last.file ? ` (${last.file})` : ''}`
      });
    }
  }
  if (reviews.length) {
    problems.push({
      key: `reviews-${reviews.map(item => item.file).sort().join('|')}`, level: 'warn',
      title: `${reviews.length} upload${reviews.length === 1 ? '' : 's'} to check on Landstar`,
      detail: `Landstar never confirmed these; check Bulk Postings, then delete them from Downloads\\landstar-upload-review: ${reviews.map(item => item.account.name || item.file).join(', ')}`
    });
  }
  for (const row of health?.rows || []) {
    if (!['bad', 'warn'].includes(row.level) || row.id === 'restart') continue;
    problems.push({ key: `health-${row.id}-${row.detail}`, level: row.level, title: `${row.label}: ${row.detail}`, detail: row.fix || '' });
  }
  if (chatBot && chatBot.state === 'signing-in') {
    problems.push({ key: `chat-signin-${chatBot.pid}`, level: 'warn', title: 'Google Chat bot needs the Google sign-in', detail: chatBot.message || 'Sign in in the Chrome window it opened, then close that window.' });
  } else if (chatBot && chatBot.state === 'blocked') {
    problems.push({ key: `chat-blocked-${chatBot.message}`, level: 'bad', title: 'Google Chat bot stopped', detail: chatBot.message || '' });
  }
  return problems;
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

// Upload files waiting for review (the .xlsx files; their screenshots and replies sit beside them).
function readReviews(dir = REVIEW_DIR) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(name => /\.xlsx$/i.test(name)).map(name => {
    let at = 0;
    try { at = fs.statSync(path.join(dir, name)).mtimeMs; } catch { /* unknown */ }
    return { file: name, at, account: accountFromFile(name) };
  }).sort((a, b) => a.at - b.at);
}

// Google Chat items saved today (waiting and done), newest first.
function readChatToday(day, dir = CHAT_INBOX_DIR) {
  const items = [];
  for (const [folder, done] of [[dir, false], [path.join(dir, 'done'), true]]) {
    let names = [];
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names.filter(item => item.endsWith('.json'))) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
        if (dayStamp(new Date(meta.savedAt)) !== day) continue;
        items.push({ at: meta.savedAt, chat: meta.chat, type: meta.type, label: meta.label || meta.fileName || '', done });
      } catch { /* skip */ }
    }
  }
  return items.sort((a, b) => b.at - a.at);
}

// Everything for the TMS: { day, uploads, rates, reviews, chat, problems }.
function readToday({ health = null, chatBot = null, now = Date.now() } = {}) {
  const day = dayStamp(new Date(now));
  const uploads = parseUploadLog(readText(path.join(LOG_DIR, `upload-${day}.log`)), day);
  const rates = parseRatesLog(readText(path.join(LOG_DIR, `rates-${day}.log`)));
  const reviews = readReviews();
  const chat = readChatToday(day);
  return { day, at: now, uploads, rates, reviews, chat, problems: findProblems({ uploads, reviews, health, chatBot, now }) };
}

module.exports = { accountFromFile, parseUploadLog, parseRatesLog, findProblems, readToday, UPLOAD_FAILING_AFTER_MS };
