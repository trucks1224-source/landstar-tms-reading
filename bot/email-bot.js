// Only the running bot writes bot/logs (tests load this file too).
if (require.main === module) require('./file-log')('emailbot');
// Email bot, DRY RUN (stage 3 of the email-bot plan). Every 2 minutes it reads the loads
// (Supabase, bot/workspace.js) and the Clarity results (bot-results.json), works out which
// customer tracking, driver and daily emails are due with the TMS's own rules
// (src/lib/trackingEmails.js) and the same email ids, and logs them. It sends NOTHING.
//
// It then compares its list with the email record (what the TMS really sent or skipped) and
// keeps a running report in bot/email-bot-report.json:
//   matched  the bot said "due" and the TMS sent (or Daniel skipped) that same email
//   waiting  the bot says due, the TMS hasn't sent it yet (approval pending or timing)
//   botOnly  due for 30+ minutes and the TMS still hasn't sent it: a difference to look at
//   tmsOnly  the TMS sent an email of a kind the bot covers that the bot never found due
//
// Not covered in the dry run (need Gmail): Trucker Tools reminders, the POD "paperwork
// already in?" check, RXO / customer requests, paperwork forwarding, driver ETA / status
// replies, check-call emails. They come in later stages.
//
//   node email-bot.js            (or "Start Email Bot.bat"; the watchdog keeps it running)
const fs = require('fs');
const path = require('path');
const { readWorkspace } = require('./workspace');
const { readResults } = require('./status-server');
const { readRecord } = require('./email-record');
const { readBotControl } = require('./local-bot-control');
const { EMAIL_BOT_STATUS_FILE } = require('./health');

const REPORT_FILE = process.env.EMAIL_BOT_REPORT_FILE || path.join(__dirname, 'email-bot-report.json');
const CHECK_MS = 2 * 60 * 1000;
const BOT_ONLY_AFTER_MS = 30 * 60 * 1000;
// Email ids of the kinds this dry run decides (others belong to later stages).
const COVERED_ID = /^(driver\|[^|]+\|[^|]+\|(dispatch|pickupMorning|pickedUp|deliveryMorning|pod|podReminder)(\||$)|dailyCustomer\||(?!driver\||rxo\||customer\||paperwork\||eta\||driverStatus\||checkCall\||mg\|)[^|]+\|[^|]+\|[a-zA-Z]+$)/;

const log = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);

// Which emails the TMS rules say are due right now. lib = src/lib/trackingEmails.js.
// Returns [{ key, type, kind, customer, loadId, waitsForSend }].
function planDueEmails(lib, map, trackingResults, now = Date.now()) {
  const due = [];
  const findLoad = (customer, loadId) => (map[customer] || []).find(load => String(load.id) === String(loadId));
  // Customer tracking emails (Paramount and RXO threads), from the latest Clarity result.
  for (const info of trackingResults) {
    if (!info?.ok || !lib.getTrackingEmailBroker(info.customer)) continue;
    const load = findLoad(info.customer, info.loadId);
    if (!load || load.status !== 'BOOKED') continue;
    const updated = lib.applyParamountTrackingInfo(load, info);
    for (const kind of lib.getDueParamountEmails(updated, info, now).filter(item => item !== 'location')) {
      due.push({
        key: lib.trackingEmailId(info.customer, load.id, kind, now), type: 'customer', kind, customer: info.customer, loadId: String(load.id),
        waitsForSend: Boolean(lib.getTrackingEmailWarning(kind, info)) || lib.paramountAlwaysAskKinds.has(kind)
      });
    }
  }
  // Driver emails and the daily customer update, for every booked load.
  for (const { customer, load } of lib.getBookedLoads(map)) {
    const tracking = load.paramountTracking || {};
    for (const driverKind of lib.getDueDriverEmails(load, tracking, now)) {
      due.push({ key: lib.driverEmailId(customer, load, driverKind, now), type: 'driver', kind: driverKind, customer, loadId: String(load.id), waitsForSend: false });
    }
    if (lib.isDailyCustomerUpdateDue(load, tracking, now)) {
      due.push({ key: lib.dailyCustomerEmailId(customer, load.id, now), type: 'daily', kind: 'dailyCustomer', customer, loadId: String(load.id), waitsForSend: false });
    }
  }
  return due;
}

// Folds this check's plan into the running report and classifies every email.
function updateReport(report, planned, record, now = Date.now()) {
  const next = { startedAt: report.startedAt || now, checkedAt: now, emails: { ...(report.emails || {}) } };
  for (const item of planned) {
    const known = next.emails[item.key];
    next.emails[item.key] = { ...item, firstDueAt: known?.firstDueAt || now, lastDueAt: now };
  }
  // Emails the TMS sent or skipped since the bot started that the bot covers but never planned.
  for (const [key, entry] of Object.entries(record)) {
    if (next.emails[key] || Number(entry.at) < next.startedAt || !['sent', 'skipped'].includes(entry.state)) continue;
    if (!COVERED_ID.test(key)) continue;
    next.emails[key] = { key, kind: entry.kind || '', customer: entry.customer || '', loadId: entry.loadId || '', tmsOnly: true, firstDueAt: null };
  }
  const summary = { matched: 0, waiting: 0, botOnly: 0, tmsOnly: 0 };
  for (const [key, item] of Object.entries(next.emails)) {
    const entry = record[key];
    if (item.tmsOnly) item.result = 'tmsOnly';
    else if (entry && ['sent', 'skipped'].includes(entry.state)) item.result = 'matched';
    else item.result = now - item.firstDueAt > BOT_ONLY_AFTER_MS ? 'botOnly' : 'waiting';
    item.tms = entry ? { state: entry.state, at: entry.at } : null;
    summary[item.result] += 1;
  }
  next.summary = summary;
  return next;
}

function readReport() {
  try { return JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')); } catch { return {}; }
}

function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 1));
  fs.renameSync(temp, file);
}

function setStatus(state, message) {
  writeJson(EMAIL_BOT_STATUS_FILE, { state, message, mode: 'dry-run', at: Date.now(), pid: process.pid });
}

async function checkOnce(lib) {
  const map = await readWorkspace();
  const tracking = Object.values(readResults().tracking || {});
  const planned = planDueEmails(lib, map, tracking);
  const before = readReport();
  const report = updateReport(before, planned, readRecord());
  for (const item of planned) {
    if (before.emails?.[item.key]) continue;
    log(`WOULD ${item.waitsForSend ? 'draft (waits for Send)' : 'send'}: ${item.type} ${item.kind} · ${item.customer} #${item.loadId}  [${item.key}]`);
  }
  for (const item of Object.values(report.emails)) {
    const was = before.emails?.[item.key]?.result;
    if (item.result !== was && ['matched', 'botOnly', 'tmsOnly'].includes(item.result)) {
      log(`${item.result.toUpperCase()}: ${item.kind} · ${item.customer} #${item.loadId}${item.tms ? ` (TMS ${item.tms.state} ${new Date(item.tms.at).toLocaleTimeString()})` : ''}`);
    }
  }
  writeJson(REPORT_FILE, report);
  const { matched, waiting, botOnly, tmsOnly } = report.summary;
  return `Dry run: ${matched} matched · ${waiting} waiting · ${botOnly} bot only · ${tmsOnly} TMS only`;
}

async function main() {
  const lib = await import('../src/lib/trackingEmails.js');
  log('Email bot started in DRY RUN: it decides which emails are due and logs them. It sends nothing.');
  setStatus('starting', 'Starting (dry run)');
  let message = 'Waiting for the first check';
  setInterval(() => setStatus('logged-in', message), 10000);
  for (;;) {
    try {
      if (!readBotControl()) {
        message = 'Paused (the bot switch is off)';
      } else {
        setStatus('working', 'Checking which emails are due (dry run)');
        message = await checkOnce(lib);
        log(message);
      }
      setStatus('logged-in', message);
    } catch (error) {
      message = `Check failed: ${error.message}`;
      log(message);
      setStatus('blocked', message);
    }
    await new Promise(resolve => setTimeout(resolve, CHECK_MS));
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { planDueEmails, updateReport, COVERED_ID, REPORT_FILE };
