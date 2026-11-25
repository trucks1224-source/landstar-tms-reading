// Team-wide data (Daniel, 2026-11-25): teammates see the owner's 🔥 hot lanes and ⬆ RAISED badges
// "just like mine". The owner's TMS publishes them to the team_data table
// (supabase/team-data.sql); every teammate's TMS keeps a local copy under these keys, which
// src/App.jsx reads next to their own data.

export const teamHotLanesKey = 'landstar_team_hotLanes';
export const teamRateRaisesKey = 'landstar_team_rateRaises';
const remoteKeys = { hotLanes: teamHotLanesKey, rateRaises: teamRateRaisesKey };
const publishEveryMs = 60 * 1000;

const parse = text => {
  try { return JSON.parse(text); } catch { return null; }
};

// { loadId: rateRaise } for every load the bot raised, from a customerOrdersMap.
export function collectRateRaises(ordersMap) {
  const raises = {};
  Object.values(ordersMap && typeof ordersMap === 'object' ? ordersMap : {}).forEach(loads => {
    (Array.isArray(loads) ? loads : []).forEach(load => {
      if (load?.id && load.rateRaise && typeof load.rateRaise === 'object') raises[String(load.id)] = load.rateRaise;
    });
  });
  return raises;
}

// The newer of two hot lane imports (by importedAt); either may be missing.
export function newerHotLanes(a, b) {
  const time = value => Date.parse(value?.importedAt || '') || 0;
  if (!a?.lanes) return b?.lanes ? b : null;
  if (!b?.lanes) return a;
  return time(b) > time(a) ? b : a;
}

// The team's raise for a load (cached so the load list doesn't re-read it for every card).
let raisesCache = { text: null, map: {} };
export function getTeamRateRaise(loadId, storage = globalThis.localStorage) {
  let text = null;
  try { text = storage?.getItem(teamRateRaisesKey) ?? null; } catch { return null; }
  if (text !== raisesCache.text) raisesCache = { text, map: parse(text) || {} };
  return raisesCache.map[String(loadId)] || null;
}

// Starts the team data for a signed-in user: reads it now, keeps it current, and (owner only)
// publishes the owner's hot lanes and raises. Returns a stop function.
export function startTeamData({ supabase, userId, isOwner, onChange }) {
  let stopped = false;
  const lastPublished = {};

  const store = (key, value) => {
    const localKey = remoteKeys[key];
    if (!localKey || typeof value !== 'string') return false;
    if (localStorage.getItem(localKey) === value) return false;
    localStorage.setItem(localKey, value);
    return true;
  };

  const load = async () => {
    const { data, error } = await supabase.from('team_data').select('key, value');
    if (error || stopped) return;
    let changed = false;
    (data || []).forEach(row => {
      lastPublished[row.key] = row.value;
      if (store(row.key, row.value)) changed = true;
    });
    if (changed) onChange?.();
  };

  const publish = async (key, value) => {
    if (stopped || lastPublished[key] === value) return;
    const { error } = await supabase.from('team_data')
      .upsert({ key, value, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { console.error(`Could not share ${key} with the team:`, error); return; }
    lastPublished[key] = value;
    store(key, value);
  };

  const publishOwnerData = async () => {
    if (!isOwner || stopped) return;
    const mine = parse(localStorage.getItem('landstar_hotLanes'));
    const team = parse(localStorage.getItem(teamHotLanesKey));
    if (mine?.lanes && newerHotLanes(team, mine) === mine && mine !== team) {
      const text = JSON.stringify(mine);
      if (text !== localStorage.getItem(teamHotLanesKey)) await publish('hotLanes', text);
    }
    const raises = collectRateRaises(parse(localStorage.getItem('landstar_customerOrdersMap')));
    await publish('rateRaises', JSON.stringify(raises));
  };

  const channel = supabase.channel(`team-data-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_data' }, () => { load(); })
    .subscribe();
  const ready = load().then(publishOwnerData);
  const timer = isOwner ? setInterval(publishOwnerData, publishEveryMs) : null;

  return {
    ready,
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      supabase.removeChannel(channel);
    }
  };
}
