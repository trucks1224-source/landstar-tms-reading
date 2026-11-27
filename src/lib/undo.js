// ↩ Undo for big changes to an account's load list (Daniel 2026-11-27: "a wrong-account import
// or a large removal should be one click to undo"). The TMS compares each account's list
// before and after every change; a big one gets a notice with an Undo button that puts the
// account back exactly as it was. Pure, tested in undo.test.js.

// Big = an account lost 3+ loads, gained 5+ loads, or was deleted.
export const UNDO_MIN_REMOVED = 3;
export const UNDO_MIN_ADDED = 5;

const ids = loads => new Set((loads || []).map(load => String(load?.id)));

// [{ customer, added, removed, deleted, before }] for each account that changed a lot.
// before = the account's loads before the change (what Undo restores).
export function findBigListChanges(previous, next) {
  const changes = [];
  if (!previous || !next || previous === next) return changes;
  for (const [customer, before] of Object.entries(previous)) {
    const after = next[customer];
    if (after === before) continue;
    const beforeIds = ids(before);
    if (after === undefined) {
      if (beforeIds.size) changes.push({ customer, added: 0, removed: beforeIds.size, deleted: true, before });
      continue;
    }
    const afterIds = ids(after);
    const removed = [...beforeIds].filter(id => !afterIds.has(id)).length;
    const added = [...afterIds].filter(id => !beforeIds.has(id)).length;
    if (removed >= UNDO_MIN_REMOVED || added >= UNDO_MIN_ADDED) changes.push({ customer, added, removed, deleted: false, before });
  }
  for (const [customer, after] of Object.entries(next)) {
    if (customer in previous) continue;
    const added = ids(after).size;
    if (added >= UNDO_MIN_ADDED) changes.push({ customer, added, removed: 0, deleted: false, before: [], created: true });
  }
  return changes;
}

// "RXO ATZ V: 183 loads added, 12 removed"
export function describeListChange(change) {
  if (change.deleted) return `${change.customer} deleted (${change.removed} load${change.removed === 1 ? '' : 's'})`;
  const parts = [
    change.added ? `${change.added} load${change.added === 1 ? '' : 's'} added` : '',
    change.removed ? `${change.removed} removed` : ''
  ].filter(Boolean);
  return `${change.customer}: ${parts.join(', ')}`;
}

// Loads Undo brings back that had a Landstar posting: the change may have sent those postings
// to the removal bot, so they could already be off the board (re-export them).
export function restoredPostedLoads(change, current) {
  const now = ids(current);
  return (change.before || []).filter(load => load?.landstarPosting && !now.has(String(load.id)));
}
