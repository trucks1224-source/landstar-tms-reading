// RXO's "big list" (R X O 2429200 - VAN, the old ATZ V) is shared with Ivan (agent SNB), Daniel
// 2026-11-27: "I do any loads originating in Texas and every load over 500 miles; the 500 miles
// does not include Texas" - a Texas pickup is Daniel's at any distance. Everything else goes to
// R X O 2429200 - SNB. A load whose miles are unknown stays with Daniel, so nothing is lost.
// Tested in bigListSplit.test.js.

export const BIG_LIST_MILES = 500;

const milesOf = load => Number(String(load?.miles ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0]) || 0;

export function isDanielsBigListLoad(load) {
  if (String(load?.origSt || '').trim().toUpperCase() === 'TX') return true;
  const miles = milesOf(load);
  return miles === 0 || miles > BIG_LIST_MILES;
}

// { mine, snb }: the loads that stay with Daniel and the ones that go to SNB.
export function splitBigList(loads) {
  const mine = [];
  const snb = [];
  for (const load of loads || []) (isDanielsBigListLoad(load) ? mine : snb).push(load);
  return { mine, snb };
}

// SNB's list plus the new loads (a load already there, by order #, is left as it is).
export function addToSnbList(existing, loads) {
  const key = load => String(load?.id ?? '').trim().replace(/-ALT[A-Z]+$/i, '');
  const have = new Set((existing || []).map(key));
  const added = (loads || []).filter(load => key(load) && !have.has(key(load)));
  return { list: [...added, ...(existing || [])], added: added.length };
}

// Daniel's priority lanes on his part of the big list (2026-11-27): into Texas, into Florida
// and out of Texas sort to the top of the R X O 2429200 - VAN list.
export function isPriorityBigListLane(load) {
  const st = value => String(value || '').trim().toUpperCase();
  return st(load?.origSt) === 'TX' || st(load?.destSt) === 'TX' || st(load?.destSt) === 'FL';
}
