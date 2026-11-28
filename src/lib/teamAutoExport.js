// Teammates' TMS exports by itself (Daniel 2026-11-27: Ivan's RXO loads "should be automatically
// getting imported and exported"; "can this just happen for all my teammates?"; "even the
// accounts that I don't share, when they create their own accounts, I want them to be able to
// work" - he does not want to be bothered, the team should run by itself). New loads go out under
// the teammate's own code, from the teammate's TMS and bot. Tested in teamAutoExport.test.js.

// New loads wait this long with no further change before they export, so a list that arrives in
// several pieces goes out as one export.
export const TEAM_EXPORT_SETTLE_MS = 90 * 1000;

// Accounts a teammate's TMS exports by itself:
//  - shared with them by the TMS owner (Daniel), minus the ones Daniel's own TMS already exports
//    (ownerExports), so nothing is posted twice;
//  - their own accounts (not shared, or shared by them). Hand-added loads there stay manual.
// An account another teammate shares with them is left to that teammate's TMS. Daniel's TMS
// (userId === ownerId) never exports this way.
export function getTeamAutoExportAccounts({ userId, ownerId, sharedCustomers, brokers, ownerExports = () => false }) {
  if (!userId || !ownerId || userId === ownerId) return [];
  const accounts = [];
  for (const name of brokers || []) {
    const shared = sharedCustomers?.[name];
    if (!shared || shared.isOwner) accounts.push({ account: name, own: true });
    else if (shared.ownerId === ownerId && !ownerExports(name)) accounts.push({ account: name, own: false });
  }
  return accounts;
}

// The last date in a pickup window ("12/01/2026 0800 - 12/04/2026 1500") is before today.
export function isPickupPast(load, now = Date.now()) {
  const dates = [...String(load?.pickupTime || '').matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/g)];
  if (!dates.length) return false;
  const [, month, day, year] = dates[dates.length - 1];
  const last = new Date(year.length === 2 ? 2000 + Number(year) : Number(year), Number(month) - 1, Number(day));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return last.getTime() < today.getTime();
}

// Open loads never posted, not taken off Landstar, pickup not past, and not tried yet this
// session (a load whose export failed is not retried in a loop; it waits for the next TMS start).
// skipHandAdded: in a teammate's own accounts a load typed by hand is exported by hand.
export function getLoadsToAutoExport(orders, tried = new Set(), { skipHandAdded = false, now = Date.now() } = {}) {
  return (orders || []).filter(load => load
    && String(load.status || '').trim().toUpperCase() === 'OPEN'
    && !load.landstarExportedAt
    && !load.landstarRemoval
    && !(skipHandAdded && load.manualEntry)
    && !isPickupPast(load, now)
    && !tried.has(String(load.id)));
}
