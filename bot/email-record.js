// The email record: one entry per real email (key = the TMS draft id, e.g.
// "Para 1522166 - ATZ|2283600|departed" or "driver|...|podReminder2"), shared by every
// process that sends: the TMS server today, the email bot later (stage 2 of the email-bot
// plan). Every send claims its key first, so the same email never goes out twice, even
// when two senders run at once or one crashes mid-send.
//
//   sending  claimed, Gmail call in progress
//   sent     Gmail accepted it
//   skipped  Daniel clicked "Don't send"
//   unknown  a send was claimed but never finished (crash): may or may not have gone out.
//            Never sent again automatically; Daniel settles it in the system check.
const fs = require('fs');
const path = require('path');

const RECORD_FILE = process.env.EMAIL_RECORD_FILE || path.join(__dirname, 'email-record.json');
const LOCK_FILE = `${RECORD_FILE}.lock`;
// A send that hasn't finished after this long crashed or hung: its result is unknown.
const SENDING_TIMEOUT_MS = 10 * 60 * 1000;
// A lock older than this was left by a crashed process.
const STALE_LOCK_MS = 15 * 1000;
// Entries are kept this long (the TMS never re-sends a load's emails after that).
const KEEP_DAYS = 60;

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(work) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(LOCK_FILE, 'wx'));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > STALE_LOCK_MS) { fs.rmSync(LOCK_FILE, { force: true }); continue; }
      } catch { continue; }
      if (Date.now() > deadline) throw new Error('The email record is busy. Try again in a moment.');
      sleep(25);
    }
  }
  try {
    return work();
  } finally {
    fs.rmSync(LOCK_FILE, { force: true });
  }
}

function readRecord() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RECORD_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    // A damaged record must not silently allow re-sends.
    throw new Error(`The email record (${RECORD_FILE}) could not be read: ${error.message}`);
  }
}

function writeRecord(record, now) {
  const cutoff = now - KEEP_DAYS * 86400000;
  for (const [key, entry] of Object.entries(record)) {
    if (Number(entry.at) < cutoff && entry.state !== 'unknown') delete record[key];
  }
  const temp = `${RECORD_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record, null, 1));
  fs.renameSync(temp, RECORD_FILE);
}

// A "sending" entry that never finished becomes "unknown".
function settleTimedOut(record, now) {
  let changed = false;
  for (const entry of Object.values(record)) {
    if (entry.state === 'sending' && now - Number(entry.at) > SENDING_TIMEOUT_MS) {
      entry.state = 'unknown';
      changed = true;
    }
  }
  return changed;
}

const describe = entry => {
  const when = new Date(Number(entry.at)).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (entry.state === 'sent') return `Already sent ${when} (email record). Not sent again.`;
  if (entry.state === 'skipped') return `You chose "Don't send" for this email ${when} (email record).`;
  if (entry.state === 'sending') return `This email is being sent right now by ${entry.by || 'another sender'}. Not sent twice.`;
  return `A send of this email started ${when} but never finished, so it may or may not have gone out. Check Gmail's Sent folder, then settle it in the System check.`;
};

// Claims a key before sending. { ok: true } or { ok: false, state, message }.
function claimEmail(key, meta = {}, { now = Date.now(), by = 'TMS server' } = {}) {
  if (!key) throw new Error('An email record key is required.');
  return withLock(() => {
    const record = readRecord();
    const timedOut = settleTimedOut(record, now);
    const entry = record[key];
    if (entry) {
      if (timedOut) writeRecord(record, now);
      return { ok: false, state: entry.state, message: describe(entry) };
    }
    record[key] = { state: 'sending', at: now, by, ...meta };
    writeRecord(record, now);
    return { ok: true };
  });
}

// Gmail accepted it.
function markEmailSent(key, { now = Date.now() } = {}) {
  withLock(() => {
    const record = readRecord();
    record[key] = { ...(record[key] || {}), state: 'sent', at: now };
    writeRecord(record, now);
  });
}

// The send failed before Gmail accepted it: free the key so it can be tried again.
function releaseEmail(key, { now = Date.now() } = {}) {
  withLock(() => {
    const record = readRecord();
    if (record[key]?.state === 'sending') delete record[key];
    writeRecord(record, now);
  });
}

// Daniel clicked "Don't send": never sent automatically later.
function markEmailSkipped(key, meta = {}, { now = Date.now() } = {}) {
  withLock(() => {
    const record = readRecord();
    if (record[key]?.state === 'sent') return;
    record[key] = { ...(record[key] || {}), ...meta, state: 'skipped', at: now };
    writeRecord(record, now);
  });
}

// Daniel checked Gmail for an "unknown" send: it went out (sent) or it didn't (cleared).
function settleUnknownEmail(key, wentOut, { now = Date.now() } = {}) {
  withLock(() => {
    const record = readRecord();
    if (record[key]?.state !== 'unknown') return;
    if (wentOut) record[key] = { ...record[key], state: 'sent', at: now, settledByDaniel: true };
    else delete record[key];
    writeRecord(record, now);
  });
}

// Sends that need Daniel: [{ key, at, ...meta }].
function listUnknownEmails({ now = Date.now() } = {}) {
  return withLock(() => {
    const record = readRecord();
    if (settleTimedOut(record, now)) writeRecord(record, now);
    return Object.entries(record).filter(([, entry]) => entry.state === 'unknown').map(([key, entry]) => ({ key, ...entry }));
  });
}

// Runs one send under the record: claim, send, then sent (ok) or released (failed).
// send() returns { status, body } like handleParamountEmail.
async function sendOnce(key, meta, send, options = {}) {
  const claim = claimEmail(key, meta, options);
  if (!claim.ok) return { status: 409, body: { error: claim.message, emailRecord: claim.state } };
  let result;
  try {
    result = await send();
  } catch (error) {
    releaseEmail(key);
    throw error;
  }
  if (result && result.status >= 200 && result.status < 300) markEmailSent(key);
  else releaseEmail(key);
  return result;
}

const SEND_ACTIONS = new Set(['send', 'rxoSend', 'customerSend', 'driverSend', 'sendPaperwork', 'checkCallSend', 'driverStatusSend', 'dailyCustomerSend']);

module.exports = {
  claimEmail, markEmailSent, releaseEmail, markEmailSkipped, settleUnknownEmail, listUnknownEmails, sendOnce,
  readRecord, SEND_ACTIONS, RECORD_FILE, SENDING_TIMEOUT_MS
};
