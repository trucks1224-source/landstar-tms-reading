// R X O 2429200 - SNB (Ivan) is filled from three lists: "lowes", "$$" and Ivan's part of the big
// list. Each load remembers which list it came from (snbList), and each list replaces only its own
// loads from last time (Daniel 2026-11-28): the Lowes list never touches the $$ or van loads, and
// loads RXO dropped from a list no longer pile up in SNB and get posted by Ivan's TMS.
// Tested in snbLists.test.js.

export const SNB_ACCOUNT_KEY = 'RXO2429200SNB';
export const SNB_LISTS = ['lowes', 'money', 'big'];

// The chat label -> which SNB list it is ('' when it is not one of Ivan's chat lists).
export function snbListOf(label) {
  const text = String(label || '');
  if (/lowe'?s/i.test(text)) return 'lowes';
  if (/\$\s*\$/.test(text)) return 'money';
  return '';
}

const keyOf = load => String(load?.id ?? '').trim().replace(/-ALT[A-Z]+$/i, '');
// Loads someone is working on stay whatever the lists say.
const isWorked = load => load?.status === 'BOOKED' || load?.manualEntry
  || String(load?.truck || '').trim() || String(load?.carrier || '').trim();

// existing: SNB's loads (with this list's new loads already added or updated).
// incoming: the loads on the new list. Loads of this list missing from it: never posted ->
// deleted; posted -> ENT (covered). Loads on it are tagged with this list.
export function replaceSnbList(existing, incoming, list, now = Date.now()) {
  const incomingKeys = new Set((incoming || []).map(keyOf).filter(Boolean));
  const coveredAt = new Date(now).toISOString();
  let removed = 0;
  let covered = 0;
  const loads = [];
  for (const load of existing || []) {
    if (incomingKeys.has(keyOf(load))) {
      loads.push(load.snbList === list ? load : { ...load, snbList: list });
      continue;
    }
    if (load.snbList !== list || isWorked(load)) {
      loads.push(load);
      continue;
    }
    if (load.landstarExportedAt) {
      if (load.status === 'ENT') loads.push(load);
      else {
        covered += 1;
        loads.push({ ...load, status: 'ENT', tag: 'ENT', coveredAt });
      }
      continue;
    }
    removed += 1;
  }
  return { loads, removed, covered };
}

// Loads from before the lists were tagged (no snbList), never posted and not being worked: once
// all three lists have come in tagged, whatever is still untagged is on none of them.
export function clearUntaggedSnbLoads(loads) {
  const kept = (loads || []).filter(load => load.snbList || load.landstarExportedAt || isWorked(load)
    || String(load.status || '').toUpperCase() !== 'OPEN');
  return { loads: kept, removed: (loads || []).length - kept.length };
}
