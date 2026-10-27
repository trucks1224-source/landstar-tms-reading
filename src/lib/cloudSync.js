import { supabase } from './supabase.js';

export const syncedKeys = [
  'landstar_brokers',
  'landstar_customerOrdersMap',
  'landstar_laneRates',
  'landstar_exportedLoads'
];

const pushDelayMs = 800;
const nativeSetItem = Storage.prototype.setItem;

const lastSynced = {};
const pending = {};
let pushTimer = null;
let mirrorActive = false;
let status = 'idle';
const statusListeners = new Set();

function setStatus(next) {
  status = next;
  statusListeners.forEach(listener => listener(status));
}

export function onSyncStatus(listener) {
  statusListeners.add(listener);
  listener(status);
  return () => statusListeners.delete(listener);
}

function writeLocal(key, value) {
  nativeSetItem.call(window.localStorage, key, value);
}

async function flushPending() {
  window.clearTimeout(pushTimer);
  pushTimer = null;
  const keys = Object.keys(pending);
  if (!keys.length) return;
  const rows = keys.map(key => ({ key, value: pending[key], updated_at: new Date().toISOString() }));
  setStatus('saving');
  const { error } = await supabase.from('app_data').upsert(rows, { onConflict: 'key' });
  if (error) {
    console.error('Could not save to the cloud database:', error);
    setStatus('error');
    pushTimer = window.setTimeout(flushPending, 5000);
    return;
  }
  rows.forEach(row => {
    lastSynced[row.key] = row.value;
    if (pending[row.key] === row.value) delete pending[row.key];
  });
  setStatus(Object.keys(pending).length ? 'saving' : 'synced');
  if (Object.keys(pending).length) pushTimer = window.setTimeout(flushPending, pushDelayMs);
}

function queuePush(key, value) {
  if (!mirrorActive || lastSynced[key] === value) return;
  pending[key] = value;
  setStatus('saving');
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(flushPending, pushDelayMs);
}

// The app saves through localStorage in several places, so mirroring there covers
// every save path (loads, rates, exported history, backup restore) without changing them.
function installMirror() {
  if (Storage.prototype.setItem.__cloudMirror) return;
  const patched = function setItem(key, value) {
    nativeSetItem.call(this, key, value);
    if (this === window.localStorage && syncedKeys.includes(key)) queuePush(key, String(value));
  };
  patched.__cloudMirror = true;
  Storage.prototype.setItem = patched;
}

// Loads the shared data into this browser before the app starts. The first
// device to sign in uploads its existing local data (the migration).
export async function startCloudSync() {
  const { data, error } = await supabase.from('app_data').select('key, value');
  if (error) throw error;

  const remote = Object.fromEntries((data || []).map(row => [row.key, row.value]));
  const toUpload = [];

  if (Object.keys(remote).length) {
    syncedKeys.forEach(key => {
      const local = window.localStorage.getItem(key);
      if (key in remote) {
        if (local !== null && local !== remote[key]) {
          nativeSetItem.call(window.localStorage, `tms_premerge_${key}`, local);
        }
        writeLocal(key, remote[key]);
        lastSynced[key] = remote[key];
      } else if (local !== null) {
        toUpload.push([key, local]);
      }
    });
  } else {
    syncedKeys.forEach(key => {
      const local = window.localStorage.getItem(key);
      if (local !== null) toUpload.push([key, local]);
    });
  }

  installMirror();
  mirrorActive = true;
  toUpload.forEach(([key, value]) => queuePush(key, value));
  if (!toUpload.length) setStatus('synced');
}

// Calls onRemoteChange after a teammate (or another tab) changes shared data.
export function subscribeToRemoteChanges(onRemoteChange) {
  const channel = supabase
    .channel('app-data-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_data' }, payload => {
      const row = payload.new;
      if (!row?.key || !syncedKeys.includes(row.key)) return;
      if (row.value === window.localStorage.getItem(row.key)) return;
      // Local edits waiting to upload win; they will overwrite the remote value shortly.
      if (row.key in pending) return;
      writeLocal(row.key, row.value);
      lastSynced[row.key] = row.value;
      onRemoteChange();
    })
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function flushCloudSyncNow() {
  return flushPending();
}

export function stopCloudSync() {
  mirrorActive = false;
  Object.keys(pending).forEach(key => delete pending[key]);
  window.clearTimeout(pushTimer);
  setStatus('idle');
}
