import { supabase } from './supabase.js';

// Personal workspace keys, stored per user in app_data.
export const syncedKeys = [
  'landstar_brokers',
  'landstar_customerOrdersMap',
  'landstar_laneRates',
  'landstar_exportedLoads',
  'landstar_profile'
];

const brokersKey = 'landstar_brokers';
const ordersKey = 'landstar_customerOrdersMap';
const ratesKey = 'landstar_laneRates';
const mergedKeys = [brokersKey, ordersKey, ratesKey];
export const dataChangedEvent = 'landstar-data-changed';

const pushDelayMs = 800;
const pageSize = 1000;
const nativeSetItem = Storage.prototype.setItem;

// Personal values as last saved in app_data, and personal values waiting to upload.
const lastSynced = {};
const pending = {};
// Shared customers as last saved in the database, keyed by customer name:
// { ownerId, memberIds, loadOrder: [loadId], loads: { loadId: json }, rates: { rateKey: rate } }
let shared = {};
// Shared changes waiting to upload. A null value means delete.
const pendingLoads = new Map();
const pendingRates = new Map();
const pendingOrder = new Map();

let pushTimer = null;
let refreshTimer = null;
let mirrorActive = false;
let currentUserId = null;
let chain = Promise.resolve();
let status = 'idle';
const statusListeners = new Set();
const sharedListeners = new Set();

function setStatus(next) {
  status = next;
  statusListeners.forEach(listener => listener(status));
}

export function onSyncStatus(listener) {
  statusListeners.add(listener);
  listener(status);
  return () => statusListeners.delete(listener);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const sharedNames = () => Object.keys(shared);
const opKey = (name, id) => `${name}\n${id}`;

function rateCustomer(rateKey) {
  const parts = parseJson(rateKey, null);
  return Array.isArray(parts) ? parts[0] : null;
}

function writeLocal(key, value) {
  if (value === null) window.localStorage.removeItem(key);
  else nativeSetItem.call(window.localStorage, key, value);
}

function notifyData() {
  window.dispatchEvent(new Event(dataChangedEvent));
}

export function getSharedCustomers() {
  return Object.fromEntries(Object.entries(shared).map(([name, customer]) => [name, {
    ownerId: customer.ownerId,
    memberIds: [...customer.memberIds],
    isOwner: customer.ownerId === currentUserId
  }]));
}

function notifyShared() {
  const snapshot = getSharedCustomers();
  sharedListeners.forEach(listener => listener(snapshot));
}

export function onSharedCustomersChange(listener) {
  sharedListeners.add(listener);
  listener(getSharedCustomers());
  return () => sharedListeners.delete(listener);
}

// Runs database work one step at a time so saves and refreshes never race.
function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

function hasPending() {
  return Boolean(Object.keys(pending).length || pendingLoads.size || pendingRates.size || pendingOrder.size);
}

function scheduleFlush() {
  setStatus('saving');
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => enqueue(doFlush), pushDelayMs);
}

function queuePush(key, value) {
  if (lastSynced[key] === value) delete pending[key];
  else pending[key] = value;
  if (hasPending()) scheduleFlush();
}

function setPendingOp(map, key, op) {
  if (op) map.set(key, op);
  else map.delete(key);
}

// Builds what this browser shows: the personal workspace plus shared customers,
// including shared edits that are still uploading.
function mergedValue(key, localValue) {
  const personal = key in pending ? pending[key] : (lastSynced[key] ?? null);
  const names = sharedNames();
  if (!mergedKeys.includes(key) || !names.length) return personal;

  if (key === brokersKey) {
    const list = parseJson(personal, null);
    const personalNames = Array.isArray(list) ? list.filter(name => !names.includes(name)) : [];
    const wanted = new Set([...personalNames, ...names]);
    const hint = parseJson(localValue, []);
    const ordered = (Array.isArray(hint) ? hint : []).filter(name => wanted.has(name));
    return JSON.stringify(Array.from(new Set([...ordered, ...personalNames, ...names])));
  }

  if (key === ordersKey) {
    const personalMap = parseJson(personal, null);
    const hint = parseJson(localValue, {});
    const result = isPlainObject(personalMap) ? { ...personalMap } : {};
    names.forEach(name => {
      const customer = shared[name];
      // A teammate's private loads under the same customer name join the shared list.
      const byId = new Map((Array.isArray(result[name]) ? result[name] : [])
        .filter(load => load && load.id != null)
        .map(load => [String(load.id), load]));
      Object.entries(customer.loads).forEach(([id, data]) => {
        const load = parseJson(data, null);
        if (load) byId.set(id, load);
      });
      pendingLoads.forEach(op => {
        if (op.name !== name) return;
        if (op.data === null) byId.delete(op.id);
        else byId.set(op.id, parseJson(op.data, null));
      });
      const order = pendingOrder.has(name) ? parseJson(pendingOrder.get(name), []) : customer.loadOrder;
      const hintIds = Array.isArray(hint?.[name]) ? hint[name].map(load => String(load?.id)) : [];
      const loads = [];
      new Set([...order, ...hintIds, ...byId.keys()]).forEach(id => {
        if (byId.get(id)) loads.push(byId.get(id));
      });
      result[name] = loads;
    });
    return JSON.stringify(result);
  }

  const personalRates = parseJson(personal, null);
  const result = isPlainObject(personalRates) ? { ...personalRates } : {};
  names.forEach(name => Object.assign(result, shared[name].rates));
  pendingRates.forEach(op => {
    if (op.rate === null) delete result[op.key];
    else result[op.key] = op.rate;
  });
  return JSON.stringify(result);
}

function queueSharedLoads(name, loads) {
  const customer = shared[name];
  if (!customer || !Array.isArray(loads)) return;
  const local = new Map();
  loads.forEach(load => {
    if (load && load.id != null) local.set(String(load.id), JSON.stringify(load));
  });
  local.forEach((data, id) => {
    setPendingOp(pendingLoads, opKey(name, id), customer.loads[id] === data ? null : { name, id, data });
  });
  Object.keys(customer.loads).forEach(id => {
    if (!local.has(id)) pendingLoads.set(opKey(name, id), { name, id, data: null });
  });
  pendingLoads.forEach((op, key) => {
    if (op.name === name && !local.has(op.id) && !(op.id in customer.loads)) pendingLoads.delete(key);
  });
  const order = JSON.stringify([...local.keys()]);
  if (order === JSON.stringify(customer.loadOrder)) pendingOrder.delete(name);
  else pendingOrder.set(name, order);
}

function queueSharedRates(name, rates) {
  const customer = shared[name];
  if (!customer) return;
  Object.entries(rates).forEach(([key, rate]) => {
    const value = String(rate);
    setPendingOp(pendingRates, opKey(name, key), customer.rates[key] === value ? null : { name, key, rate: value });
  });
  Object.keys(customer.rates).forEach(key => {
    if (!(key in rates)) pendingRates.set(opKey(name, key), { name, key, rate: null });
  });
}

// Splits every save into the personal workspace and the shared customers it touches.
function handleLocalWrite(key, value) {
  if (!mirrorActive) return;
  const names = sharedNames();
  if (!names.length || !mergedKeys.includes(key)) {
    queuePush(key, value);
    return;
  }
  if (key === brokersKey) {
    const list = parseJson(value, null);
    queuePush(key, Array.isArray(list) ? JSON.stringify(list.filter(name => !names.includes(name))) : value);
    return;
  }
  const parsed = parseJson(value, null);
  if (!isPlainObject(parsed)) {
    queuePush(key, value);
    return;
  }
  const personal = {};
  if (key === ordersKey) {
    Object.entries(parsed).forEach(([name, loads]) => {
      if (names.includes(name)) queueSharedLoads(name, loads);
      else personal[name] = loads;
    });
  } else {
    const sharedRates = Object.fromEntries(names.map(name => [name, {}]));
    Object.entries(parsed).forEach(([rateKey, rate]) => {
      const name = rateCustomer(rateKey);
      if (name in sharedRates) sharedRates[name][rateKey] = rate;
      else personal[rateKey] = rate;
    });
    Object.entries(sharedRates).forEach(([name, rates]) => queueSharedRates(name, rates));
  }
  queuePush(key, JSON.stringify(personal));
}

// The app saves through localStorage in several places, so mirroring there covers
// every save path (loads, rates, exported history, backup restore) without changing them.
function installMirror() {
  if (Storage.prototype.setItem.__cloudMirror) return;
  const patched = function setItem(key, value) {
    nativeSetItem.call(this, key, value);
    if (this === window.localStorage && syncedKeys.includes(key)) handleLocalWrite(key, String(value));
  };
  patched.__cloudMirror = true;
  Storage.prototype.setItem = patched;
}

function chunk(items, size = 500) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function clearIfUnchanged(map, key, op) {
  if (map.get(key) === op) map.delete(key);
}

async function flushShared(map, table, idColumn, valueColumn, idField, valueField, cacheField) {
  const ops = [...map.entries()].filter(([key, op]) => {
    if (shared[op.name]) return true;
    map.delete(key);
    return false;
  });
  const upserts = ops.filter(([, op]) => op[valueField] !== null);
  for (const part of chunk(upserts)) {
    const rows = part.map(([, op]) => ({
      customer_name: op.name,
      [idColumn]: op[idField],
      [valueColumn]: op[valueField],
      updated_at: new Date().toISOString(),
      updated_by: currentUserId
    }));
    const { error } = await supabase.from(table).upsert(rows, { onConflict: `customer_name,${idColumn}` });
    if (error) throw error;
    part.forEach(([key, op]) => {
      if (shared[op.name]) shared[op.name][cacheField][op[idField]] = op[valueField];
      clearIfUnchanged(map, key, op);
    });
  }
  const deletesByName = new Map();
  ops.filter(([, op]) => op[valueField] === null).forEach(entry => {
    const list = deletesByName.get(entry[1].name) || [];
    list.push(entry);
    deletesByName.set(entry[1].name, list);
  });
  for (const [name, entries] of deletesByName) {
    for (const part of chunk(entries, 200)) {
      const { error } = await supabase.from(table).delete()
        .eq('customer_name', name).in(idColumn, part.map(([, op]) => op[idField]));
      if (error) throw error;
      part.forEach(([key, op]) => {
        if (shared[name]) delete shared[name][cacheField][op[idField]];
        clearIfUnchanged(map, key, op);
      });
    }
  }
}

async function doFlush() {
  window.clearTimeout(pushTimer);
  pushTimer = null;
  if (!currentUserId || !hasPending()) return;
  setStatus('saving');
  try {
    const keys = Object.keys(pending);
    if (keys.length) {
      const rows = keys.map(key => ({ user_id: currentUserId, key, value: pending[key], updated_at: new Date().toISOString() }));
      const { error } = await supabase.from('app_data').upsert(rows, { onConflict: 'user_id,key' });
      if (error) throw error;
      rows.forEach(row => {
        lastSynced[row.key] = row.value;
        if (pending[row.key] === row.value) delete pending[row.key];
      });
    }
    await flushShared(pendingLoads, 'shared_loads', 'load_id', 'data', 'id', 'data', 'loads');
    await flushShared(pendingRates, 'shared_lane_rates', 'rate_key', 'rate', 'key', 'rate', 'rates');
    for (const [name, order] of [...pendingOrder.entries()]) {
      if (shared[name]) {
        const { error } = await supabase.from('shared_customers').update({ load_order: order }).eq('name', name);
        if (error) throw error;
        shared[name].loadOrder = parseJson(order, []);
      }
      if (pendingOrder.get(name) === order) pendingOrder.delete(name);
    }
  } catch (error) {
    console.error('Could not save to the cloud database:', error);
    setStatus('error');
    // A customer may have stopped being shared; refreshing drops its waiting changes.
    scheduleRefresh(0);
    pushTimer = window.setTimeout(() => enqueue(doFlush), 5000);
    return;
  }
  setStatus(hasPending() ? 'saving' : 'synced');
  if (hasPending()) scheduleFlush();
}

async function selectAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns)
      .order('customer_name').range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function fetchShared() {
  const { data: customers, error } = await supabase.from('shared_customers').select('name, owner_id, load_order');
  if (error) throw error;
  const [members, loads, rates] = await Promise.all([
    selectAll('shared_customer_members', 'customer_name, user_id'),
    selectAll('shared_loads', 'customer_name, load_id, data'),
    selectAll('shared_lane_rates', 'customer_name, rate_key, rate')
  ]);
  const next = {};
  (customers || []).forEach(row => {
    const order = parseJson(row.load_order, []);
    next[row.name] = {
      ownerId: row.owner_id,
      memberIds: [],
      loadOrder: Array.isArray(order) ? order.map(String) : [],
      loads: {},
      rates: {}
    };
  });
  members.forEach(row => next[row.customer_name]?.memberIds.push(row.user_id));
  loads.forEach(row => { if (next[row.customer_name]) next[row.customer_name].loads[row.load_id] = row.data; });
  rates.forEach(row => { if (next[row.customer_name]) next[row.customer_name].rates[row.rate_key] = row.rate; });
  return next;
}

// Rewrites this browser's copy from the personal and shared data. Returns true when it changed.
function applyMerged() {
  let changed = false;
  mergedKeys.forEach(key => {
    const local = window.localStorage.getItem(key);
    const merged = mergedValue(key, local);
    if (merged !== local) {
      writeLocal(key, merged);
      changed = true;
    }
  });
  return changed;
}

async function doRefresh() {
  if (!currentUserId) return;
  let next;
  try {
    next = await fetchShared();
  } catch (error) {
    console.error('Could not load shared customers:', error);
    return;
  }
  [pendingLoads, pendingRates].forEach(map => map.forEach((op, key) => { if (!next[op.name]) map.delete(key); }));
  pendingOrder.forEach((_order, name) => { if (!next[name]) pendingOrder.delete(name); });
  shared = next;
  const changed = applyMerged();
  notifyShared();
  if (changed) notifyData();
}

function scheduleRefresh(delay = 300) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => enqueue(doRefresh), delay);
}

// Loads the signed-in user's workspace and shared customers before the app starts.
// Keys the user has never saved are cleared so a previous user's data on this
// browser never leaks into, or gets uploaded to, another workspace.
export async function startCloudSync(userId) {
  const { data, error } = await supabase.from('app_data').select('key, value').eq('user_id', userId);
  if (error) throw error;
  currentUserId = userId;
  shared = await fetchShared();

  const remote = Object.fromEntries((data || []).map(row => [row.key, row.value]));
  syncedKeys.forEach(key => {
    if (key in remote) lastSynced[key] = remote[key];
    else delete lastSynced[key];
    writeLocal(key, mergedValue(key, null));
  });

  installMirror();
  mirrorActive = true;
  setStatus('synced');
  notifyShared();
}

// Removes the signed-in user's workspace from this browser (used at sign-out).
export function clearLocalWorkspace() {
  syncedKeys.forEach(key => window.localStorage.removeItem(key));
  Object.keys(window.localStorage)
    .filter(key => key.startsWith('tms_premerge_'))
    .forEach(key => window.localStorage.removeItem(key));
}

// Keeps this browser up to date with the user's other browsers and with teammates
// editing shared customers.
export function subscribeToRemoteChanges(userId) {
  const personal = supabase
    .channel(`app-data-sync-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_data', filter: `user_id=eq.${userId}` }, payload => {
      const row = payload.new;
      if (!row?.key || row.user_id !== userId || !syncedKeys.includes(row.key)) return;
      // Local edits waiting to upload win; they will overwrite the remote value shortly.
      if (row.key in pending) return;
      lastSynced[row.key] = row.value;
      const local = window.localStorage.getItem(row.key);
      const merged = mergedValue(row.key, local);
      if (merged === local) return;
      writeLocal(row.key, merged);
      notifyData();
    })
    .subscribe();
  const team = supabase.channel(`shared-customers-sync-${userId}`);
  ['shared_customers', 'shared_customer_members', 'shared_loads', 'shared_lane_rates'].forEach(table => {
    team.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduleRefresh());
  });
  team.subscribe();
  return () => {
    supabase.removeChannel(personal);
    supabase.removeChannel(team);
  };
}

export function flushCloudSyncNow() {
  return enqueue(doFlush);
}

export function stopCloudSync() {
  mirrorActive = false;
  currentUserId = null;
  shared = {};
  Object.keys(pending).forEach(key => delete pending[key]);
  pendingLoads.clear();
  pendingRates.clear();
  pendingOrder.clear();
  window.clearTimeout(pushTimer);
  window.clearTimeout(refreshTimer);
  setStatus('idle');
  notifyShared();
}

function friendlyError(error, fallback) {
  if (error?.code === '23505') return new Error('This customer is already shared by a teammate. Ask them to add you.');
  return new Error(error?.message || fallback);
}

// Everyone signed in to this app, for picking who to share with.
export async function listTeammates() {
  const { data, error } = await supabase.rpc('team_directory');
  if (error) throw friendlyError(error, 'Could not load the teammate list.');
  return (data || []).filter(person => person.id !== currentUserId);
}

function resplitLocal() {
  mergedKeys.forEach(key => {
    const value = window.localStorage.getItem(key);
    if (value !== null) handleLocalWrite(key, value);
  });
}

// Shares one of your customers (its loads and lane rates) with the chosen teammates.
export function shareCustomer(name, memberIds) {
  return enqueue(async () => {
    await doFlush();
    const { error } = await supabase.from('shared_customers').insert({ name, owner_id: currentUserId, load_order: '[]' });
    if (error) throw friendlyError(error, 'Could not share this customer.');
    shared[name] = { ownerId: currentUserId, memberIds: [], loadOrder: [], loads: {}, rates: {} };
    if (memberIds.length) {
      const { error: memberError } = await supabase.from('shared_customer_members')
        .insert(memberIds.map(userId => ({ customer_name: name, user_id: userId })));
      if (memberError) throw friendlyError(memberError, 'Could not add the teammates.');
      shared[name].memberIds = [...memberIds];
    }
    resplitLocal();
    await doFlush();
    notifyShared();
  });
}

export function addSharedMembers(name, memberIds) {
  return enqueue(async () => {
    const { error } = await supabase.from('shared_customer_members')
      .insert(memberIds.map(userId => ({ customer_name: name, user_id: userId })));
    if (error) throw friendlyError(error, 'Could not add the teammates.');
    if (shared[name]) shared[name].memberIds = Array.from(new Set([...shared[name].memberIds, ...memberIds]));
    notifyShared();
  });
}

export function removeSharedMember(name, userId) {
  return enqueue(async () => {
    const { error } = await supabase.from('shared_customer_members')
      .delete().eq('customer_name', name).eq('user_id', userId);
    if (error) throw friendlyError(error, 'Could not remove the teammate.');
    if (shared[name]) shared[name].memberIds = shared[name].memberIds.filter(id => id !== userId);
    notifyShared();
  });
}

// Owner only: the customer goes back to the owner's own workspace with all its loads.
export function stopSharingCustomer(name) {
  return enqueue(async () => {
    await doFlush();
    const { error } = await supabase.from('shared_customers').delete().eq('name', name);
    if (error) throw friendlyError(error, 'Could not stop sharing this customer.');
    delete shared[name];
    [pendingLoads, pendingRates].forEach(map => map.forEach((op, key) => { if (op.name === name) map.delete(key); }));
    pendingOrder.delete(name);
    resplitLocal();
    await doFlush();
    notifyShared();
  });
}

// Teammates only: removes the shared customer from your list.
export function leaveSharedCustomer(name) {
  return enqueue(async () => {
    await doFlush();
    const { error } = await supabase.from('shared_customer_members')
      .delete().eq('customer_name', name).eq('user_id', currentUserId);
    if (error) throw friendlyError(error, 'Could not leave this customer.');
    await doRefresh();
  });
}
