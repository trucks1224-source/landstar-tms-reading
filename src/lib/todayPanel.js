// Today panel and problem banner logic (Daniel 2026-11-27). Pure, tested in todayPanel.test.js.
// The data comes from the TMS server's GET /api/today (bot/today.js) plus the TMS's own loads.

export const PROBLEM_SNOOZE_MS = 30 * 60 * 1000;

const accountKey = name => String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sameDay = (ms, now) => {
  if (!Number.isFinite(ms)) return false;
  const a = new Date(ms);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

// Problems to show: not hidden ("Hide 30 min") or hidden longer ago than the snooze.
// hidden = { problemKey: hiddenAtMs }.
export function visibleProblems(problems, hidden = {}, now = Date.now()) {
  return (problems || []).filter(problem => !(now - Number(hidden[problem.key] || 0) < PROBLEM_SNOOZE_MS));
}

// Problems that were not on screen before (they sound the alarm). seenKeys = Set.
export function newProblems(problems, seenKeys) {
  return (problems || []).filter(problem => !seenKeys.has(problem.key));
}

// One row per account with anything today: { name, key, exported, booked, onHotLane, open,
// filesPosted, filesFailed, checked, raised, skippedAtz, lastAt }. Sorted by most activity.
// ordersMap = the TMS's loads by account; isHotLane(load) -> bool.
export function summarizeTodayByAccount(today, ordersMap = {}, isHotLane = () => false, now = Date.now()) {
  const rows = new Map();
  const row = (name, key = accountKey(name)) => {
    if (!rows.has(key)) {
      rows.set(key, { name, key, exported: 0, booked: 0, onHotLane: 0, open: 0, filesPosted: 0, filesFailed: 0, checked: 0, raised: 0, skippedAtz: 0, lastAt: 0 });
    }
    return rows.get(key);
  };
  for (const [name, loads] of Object.entries(ordersMap || {})) {
    let exported = 0;
    let booked = 0;
    let lastAt = 0;
    for (const load of loads || []) {
      const exportedAt = Date.parse(load?.landstarExportedAt || '');
      if (sameDay(exportedAt, now)) { exported += 1; lastAt = Math.max(lastAt, exportedAt); }
      const bookedAt = Date.parse(load?.bookedAt || '');
      if (load?.status === 'BOOKED' && sameDay(bookedAt, now)) { booked += 1; lastAt = Math.max(lastAt, bookedAt); }
    }
    if (!exported && !booked) continue;
    const entry = row(name);
    entry.name = name;
    entry.exported = exported;
    entry.booked = booked;
    entry.lastAt = Math.max(entry.lastAt, lastAt);
    entry.open = (loads || []).filter(load => ['OPEN', 'ENT'].includes(load?.status)).length;
    entry.onHotLane = (loads || []).filter(load => load?.status !== 'BOOKED' && isHotLane(load)).length;
  }
  for (const event of today?.uploads || []) {
    if (!event.file || !event.account?.key) continue;
    const entry = rows.get(event.account.key) || row(matchName(event.account, ordersMap), event.account.key);
    if (event.ok) entry.filesPosted += 1; else entry.filesFailed += 1;
    entry.lastAt = Math.max(entry.lastAt, event.at || 0);
  }
  for (const [key, rates] of Object.entries(today?.rates || {})) {
    const entry = rows.get(key) || row(matchName(rates, ordersMap, key), key);
    entry.checked += rates.checked || 0;
    entry.raised += rates.raised || 0;
    entry.skippedAtz += rates.skippedAtz || 0;
  }
  // Bookings matter most, then what went out; rate raises are background work.
  const activity = entry => entry.booked * 3 + entry.exported + entry.filesPosted * 2 + entry.raised * 0.2;
  return [...rows.values()].sort((a, b) => activity(b) - activity(a) || b.lastAt - a.lastAt);
}

// The TMS's own spelling of an account from the bots' file name ("CH 593772 - ATZ H" ->
// "CH 593772- ATZ H" when that is in the customer list).
function matchName(account, ordersMap, key = account?.key) {
  return Object.keys(ordersMap || {}).find(name => accountKey(name) === key) || account?.name || key;
}

// Totals across accounts for the top of the panel.
export function todayTotals(today, rows) {
  const uploads = (today?.uploads || []).filter(event => event.file);
  return {
    exported: rows.reduce((sum, item) => sum + item.exported, 0),
    booked: rows.reduce((sum, item) => sum + item.booked, 0),
    filesPosted: uploads.filter(event => event.ok).length,
    filesFailed: uploads.filter(event => !event.ok).length,
    raised: rows.reduce((sum, item) => sum + item.raised, 0),
    skippedAtz: rows.reduce((sum, item) => sum + item.skippedAtz, 0),
    reviews: (today?.reviews || []).length,
    chat: (today?.chat || []).length
  };
}

// Timeline, newest first: uploads (posted / failed), Google Chat arrivals. Repeated failures of
// the same file within a run are folded into one line ("failed 12 times, 10:35 - 10:57 AM").
export function todayTimeline(today, limit = 40) {
  const items = [];
  let run = null;
  for (const event of (today?.uploads || []).filter(item => item.file || item.signIn)) {
    if (!event.ok && run && run.file === event.file && run.message === event.message) {
      run.count += 1;
      run.lastAt = event.at;
      continue;
    }
    run = event.ok ? null : { kind: 'failed', at: event.at, lastAt: event.at, file: event.file, account: event.account?.name || '', message: event.message, count: 1 };
    items.push(event.ok
      ? { kind: 'posted', at: event.at, account: event.account?.name || '', file: event.file }
      : run);
  }
  for (const item of today?.chat || []) {
    items.push({ kind: 'chat', at: item.at, account: item.chat, label: item.label, type: item.type });
  }
  return items.sort((a, b) => (b.lastAt || b.at) - (a.lastAt || a.at)).slice(0, limit);
}
