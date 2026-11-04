import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = await readFile(new URL('./cloudSync.js', import.meta.url), 'utf8');
const { code: moduleCode } = await transform(source, { loader: 'js', format: 'cjs' });
// Each run gets its own scope, so the module can be loaded twice into one page.
const code = `(function (module, exports) {
${moduleCode}
})(module, module.exports);`;

// Loads cloudSync.js against an in-memory browser and app_data table.
function setup(appData) {
  const store = new Map();
  class Storage {
    getItem(key) { return store.has(key) ? store.get(key) : null; }
    setItem(key, value) { store.set(key, String(value)); }
    removeItem(key) { store.delete(key); }
  }
  const localStorage = new Storage();
  const events = [];
  const handlers = [];
  const window = {
    localStorage,
    dispatchEvent: event => events.push(event.type),
    setTimeout: () => 0,
    clearTimeout: () => {}
  };
  const query = rows => {
    const filters = [];
    const builder = {
      select: () => builder,
      eq(col, val) { filters.push(row => row[col] === val); return builder; },
      order: () => builder,
      range: async () => ({ data: [], error: null }),
      async maybeSingle() { return { data: rows.find(row => filters.every(f => f(row))) || null, error: null }; },
      then: resolve => resolve({ data: rows.filter(row => filters.every(f => f(row))), error: null }),
      async upsert(newRows) {
        newRows.forEach(newRow => {
          const existing = rows.find(row => row.user_id === newRow.user_id && row.key === newRow.key);
          if (existing) Object.assign(existing, newRow);
          else rows.push({ ...newRow });
        });
        return { error: null };
      }
    };
    return builder;
  };
  const supabase = {
    from: table => query(table === 'app_data' ? appData : []),
    channel() {
      const channel = { on(_type, _filter, handler) { handlers.push(handler); return channel; }, subscribe: () => channel };
      return channel;
    },
    removeChannel() {}
  };
  const ctx = {
    module: { exports: {} },
    window,
    Storage,
    Event: class { constructor(type) { this.type = type; } },
    console,
    require(name) {
      if (name === './supabase.js') return { supabase };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  // Loads a fresh copy of the module into the same page, like a dev-server code update.
  const reload = () => {
    ctx.module = { exports: {} };
    vm.runInContext(code, ctx);
    return ctx.module.exports;
  };
  return { sync: ctx.module.exports, localStorage, events, handlers, appData, reload };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const ordersKey = 'landstar_customerOrdersMap';

test('a realtime change with its large value left out is read from the database, never cleared', async () => {
  const appData = [{ user_id: 'u1', key: ordersKey, value: '{"RXO":[{"id":"1"}]}' }];
  const { sync, localStorage, events, handlers } = setup(appData);
  await sync.startCloudSync('u1');
  sync.subscribeToRemoteChanges('u1');
  // Another browser saves a big list; realtime sends the row without its value.
  appData[0].value = '{"RXO":[{"id":"1"},{"id":"2"}]}';
  handlers[0]({ new: { user_id: 'u1', key: ordersKey } });
  await settle();
  await settle();
  assert.equal(localStorage.getItem(ordersKey), '{"RXO":[{"id":"1"},{"id":"2"}]}');
  assert.deepEqual(events, ['landstar-data-changed']);
});

test('echoes of this browser\'s own saves never roll back a newer local list', async () => {
  const appData = [{ user_id: 'u1', key: ordersKey, value: '{"RXO":[]}' }];
  const { sync, localStorage, events } = setup(appData);
  await sync.startCloudSync('u1');
  localStorage.setItem(ordersKey, '{"RXO":[{"id":"1"}]}');
  await sync.flushCloudSyncNow();
  localStorage.setItem(ordersKey, '{"RXO":[{"id":"1"},{"id":"2"}]}');
  await sync.flushCloudSyncNow();
  // The echo of the first save arrives late.
  assert.equal(sync.applyRemoteValue(ordersKey, '{"RXO":[{"id":"1"}]}'), false);
  assert.equal(sync.applyRemoteValue(ordersKey, undefined), false);
  assert.equal(localStorage.getItem(ordersKey), '{"RXO":[{"id":"1"},{"id":"2"}]}');
  // A different list from another browser is still taken.
  assert.equal(sync.applyRemoteValue(ordersKey, '{"RXO":[{"id":"9"}]}'), true);
  assert.equal(localStorage.getItem(ordersKey), '{"RXO":[{"id":"9"}]}');
  assert.deepEqual(events, ['landstar-data-changed']);
});

test('after the sync code is reloaded in place, saves still reach the cloud', async () => {
  const appData = [{ user_id: 'u1', key: ordersKey, value: '{"RXO":[]}' }];
  const { sync, localStorage, reload } = setup(appData);
  await sync.startCloudSync('u1');
  // A code update replaces the module: the old copy stops, the new one starts.
  sync.stopCloudSync();
  const fresh = reload();
  await fresh.startCloudSync('u1');
  localStorage.setItem(ordersKey, '{"RXO":[{"id":"1"}]}');
  await fresh.flushCloudSyncNow();
  assert.equal(appData[0].value, '{"RXO":[{"id":"1"}]}');
});
