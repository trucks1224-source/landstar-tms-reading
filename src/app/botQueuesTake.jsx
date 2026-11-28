// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { readUnpostQueue, writeUnpostQueue, assignQueueKey, readAssignQueue } from './botQueues.jsx';

function addToUnpostQueue(droppedPostings) {
  const queue = readUnpostQueue();
  const seen = new Set(queue.map(item => `${item.customer}|${item.loadId}`));
  droppedPostings.forEach(item => {
    if (item?.posting && !seen.has(`${item.customer}|${item.loadId}`)) {
      queue.push({ ...item, queuedAt: new Date().toISOString() });
      seen.add(`${item.customer}|${item.loadId}`);
    }
  });
  writeUnpostQueue(queue);
  return queue.length;
}

const assignSeenKey = 'landstar_assignSeenAt';

// ---------- Rate raises from the bot's board-rate watch (bot/hazmat-watch.js) ----------
const rateRaiseSeenKey = 'landstar_rateRaiseSeenAt';

function takeNewRateRaises(raises) {
  if (!Array.isArray(raises) || !raises.length) return [];
  let seenAt = 0;
  try { seenAt = Number(localStorage.getItem(rateRaiseSeenKey)) || 0; } catch { /* first time */ }
  const fresh = raises.filter(raise => Number(raise?.at) > seenAt);
  if (fresh.length) {
    try { localStorage.setItem(rateRaiseSeenKey, String(Math.max(...fresh.map(raise => Number(raise.at))))); } catch { /* shown again next time */ }
  }
  return fresh;
}

// ---------- Bulk Postings error drafts the bot deleted (bot/error-drafts.js) ----------
const errorDraftSeenKey = 'landstar_errorDraftSeenAt';

function takeNewErrorDrafts(drafts) {
  if (!Array.isArray(drafts) || !drafts.length) return [];
  let seenAt = 0;
  try { seenAt = Number(localStorage.getItem(errorDraftSeenKey)) || 0; } catch { /* first time */ }
  const fresh = drafts.filter(draft => Number(draft?.at) > seenAt);
  if (fresh.length) {
    try { localStorage.setItem(errorDraftSeenKey, String(Math.max(...fresh.map(draft => Number(draft.at))))); } catch { /* shown again next time */ }
  }
  return fresh;
}

// ---------- Landstar removals (bot/unpost.js) ----------
// A load sent to the removal bot shows "⏳ SENT TO REMOVAL BOT"; when the bot reports back it
// shows RMOV (removed, or no longer on the board) or "NOT REMOVED" (remove it by hand).
const removalSeenKey = 'landstar_removalSeenAt';

function readRemovalSeenAt() {
  try { return Number(localStorage.getItem(removalSeenKey)) || 0; } catch { return 0; }
}

function takeNewRemovalResults(results) {
  if (!Array.isArray(results) || !results.length) return [];
  const seenAt = readRemovalSeenAt();
  const fresh = results.filter(result => Number(result?.at) > seenAt);
  if (fresh.length) {
    try { localStorage.setItem(removalSeenKey, String(Math.max(...fresh.map(result => Number(result.at))))); } catch { /* shown again next time */ }
  }
  return fresh;
}

function addToAssignQueue(item) {
  const key = `${item.customer}|${item.loadId}`;
  const queue = readAssignQueue().filter(existing => `${existing.customer}|${existing.loadId}` !== key);
  try {
    localStorage.setItem(assignQueueKey, JSON.stringify([...queue, { ...item, queuedAt: new Date().toISOString() }]));
  } catch (error) {
    console.error('Could not save the Landstar assign queue:', error);
  }
}

// Results the bot reports that this browser hasn't shown yet.
function takeNewAssignResults(results) {
  if (!Array.isArray(results) || !results.length) return [];
  let seenAt = 0;
  try { seenAt = Number(localStorage.getItem(assignSeenKey)) || 0; } catch { /* first time */ }
  const fresh = results.filter(result => Number(result?.at) > seenAt);
  if (fresh.length) {
    try { localStorage.setItem(assignSeenKey, String(Math.max(...fresh.map(result => Number(result.at))))); } catch { /* shown again next time */ }
  }
  return fresh;
}

export {
  addToUnpostQueue,
  assignSeenKey,
  rateRaiseSeenKey,
  takeNewRateRaises,
  errorDraftSeenKey,
  takeNewErrorDrafts,
  removalSeenKey,
  readRemovalSeenAt,
  takeNewRemovalResults,
  addToAssignQueue,
  takeNewAssignResults
};
