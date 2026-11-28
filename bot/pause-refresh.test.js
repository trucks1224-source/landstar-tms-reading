const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  selectDue, leftPaused, pauseAndUnpause, AMERI_EXPORT, buttonName, AMERI_REFRESH_MS, HAZMAT_REFRESH_MS
} = require('./pause-refresh');
const { postingSignature } = require('./bot-postings');

const NOW = Date.parse('2026-11-25T23:00:00Z');
const posting = (id, extra = {}) => ({
  LoadId: id, SourceSystemID: 'PORTAL', Agency: 'ANQ', OriginZipCode: '82710', DestinationZipCode: '52641',
  PickupThruDateForDisplay: '12/04/26 23:00', Weight: 41500, CommodityCode: 'CGAPP',
  OrderDate: `/Date(${NOW - 60 * 60 * 1000})/`, ...extra
});

test('only AMERI postings are paused and unpaused, every 5 minutes (hazmat no longer, 2026-11-27)', () => {
  assert.equal(AMERI_REFRESH_MS, 5 * 60 * 1000);
  assert.equal(HAZMAT_REFRESH_MS, 30 * 60 * 1000);
  const ameri = posting('1');
  const hazmat = posting('2', { OriginZipCode: '45401', CommodityCode: 'HAZMAT' });
  const plain = posting('3', { OriginZipCode: '30301' });
  const ameriSignatures = new Set([postingSignature(ameri)]);
  const state = { 1: { refreshedAt: NOW - 4 * 60 * 1000 }, 2: { refreshedAt: NOW - 29 * 60 * 1000 } };
  const ownCodes = ['ANQ', 'SNB', 'QNX'];
  assert.deepEqual(selectDue([ameri, hazmat, plain], { ameriSignatures, ownCodes, state, now: NOW }), [], 'not yet');
  const later = selectDue([ameri, hazmat, plain], { ameriSignatures, ownCodes, state, now: NOW + 60 * 1000 });
  assert.deepEqual(later.map(d => [d.loadId, d.group]), [['1', 'AMERI']], 'hazmat loads are not paused any more');
  // A fresh posting counts from when it was posted.
  const fresh = posting('4', { OrderDate: `/Date(${NOW - 2 * 60 * 1000})/` });
  assert.deepEqual(selectDue([fresh], { ameriSignatures: new Set([postingSignature(fresh)]), ownCodes, now: NOW }), []);
  // AMERI hazmat loads use the AMERI 5 minutes.
  const ameriHazmat = posting('5', { CommodityCode: 'HAZMAT' });
  assert.equal(selectDue([ameriHazmat], { ameriSignatures, ownCodes, now: NOW })[0].group, 'AMERI');
  // Other agencies' postings and test mode.
  assert.deepEqual(selectDue([posting('6', { Agency: 'ATZ', CommodityCode: 'HAZMAT' })], { ameriSignatures, ownCodes, now: NOW }), []);
  assert.deepEqual(selectDue([ameri, hazmat], { ameriSignatures, ownCodes, now: NOW, onlyLoadId: '1' }).map(d => d.loadId), ['1']);
  assert.deepEqual(selectDue([ameri, hazmat], { ameriSignatures, ownCodes, now: NOW, onlyLoadId: '2' }), [], 'a hazmat load, even in test mode');
});

test('AMERI exports are recognized by file name (exact account); PAUSE never matches UNPAUSE', () => {
  for (const name of ['Landstar_Bulk_AMERI_18347__ATZ.xlsx', 'Landstar_Bulk_AMERI_18347__ATZ__7.xlsx',
    'Landstar_Bulk_AMERI_18347__ATZ_2of3.xlsx', 'Landstar_Bulk_AMERI_18347__ATZ (1).xlsx']) {
    assert.equal(AMERI_EXPORT.test(name), true, name);
  }
  assert.equal(AMERI_EXPORT.test('Landstar_Bulk_AMERI_18347__ATZ_H.xlsx'), false);
  assert.equal(buttonName('pause').test('visibility_off PAUSE'), true);
  assert.equal(buttonName('pause').test('UNPAUSE'), false);
  assert.equal(buttonName('unpause').test('UNPAUSE'), true);
});

test('a load the bot paused but did not confirm unpaused is found first', () => {
  assert.deepEqual(leftPaused({
    1: { pausedAt: 10, unpausedAt: 20 }, 2: { pausedAt: 30, unpausedAt: 20 }, 3: { pausedAt: 40 }, 4: { refreshedAt: 5 }
  }), ['2', '3']);
});

// A fake Landstar detail page: PAUSE -> CONFIRM -> paused (UNPAUSE shown) -> UNPAUSE -> active.
function fakeContext({ startPaused = false, unpauseWorks = true } = {}) {
  const landstar = { paused: startPaused, confirmOpen: false, clicks: [] };
  const visible = name => {
    if (name === 'confirm') return landstar.confirmOpen;
    if (name === 'pause') return !landstar.paused && !landstar.confirmOpen;
    if (name === 'unpause') return landstar.paused;
    return false;
  };
  const nameOf = regex => ['unpause', 'pause', 'confirm'].find(name => regex.test(name.toUpperCase()));
  const page = {
    goto: async () => {}, waitForURL: async () => {}, waitForTimeout: async () => {}, close: async () => {},
    getByRole: (_role, { name }) => {
      const which = nameOf(name);
      const locator = {
        first: () => locator,
        isVisible: async () => visible(which),
        waitFor: async () => { if (!visible(which)) throw new Error('timeout'); },
        click: async () => {
          if (!visible(which)) throw new Error('not visible');
          landstar.clicks.push(which);
          if (which === 'pause') landstar.confirmOpen = true;
          if (which === 'confirm') { landstar.confirmOpen = false; landstar.paused = true; }
          if (which === 'unpause' && unpauseWorks) landstar.paused = false;
        }
      };
      return locator;
    }
  };
  return { landstar, context: { newPage: async () => page } };
}

const tempState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pause-')), 'state.json');

test('pause, confirm, unpause: the load ends active and the refresh is recorded', async () => {
  const { landstar, context } = fakeContext();
  const statePath = tempState();
  assert.equal(await pauseAndUnpause(context, '190923604', { statePath, settleMs: 0, log() {} }), 'refreshed');
  assert.deepEqual(landstar.clicks, ['pause', 'confirm', 'unpause']);
  assert.equal(landstar.paused, false);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))['190923604'];
  assert.ok(state.pausedAt && state.unpausedAt >= state.pausedAt && state.refreshedAt);
  assert.deepEqual(leftPaused(JSON.parse(fs.readFileSync(statePath, 'utf8'))), []);
});

test('a load already paused (maybe by Daniel) is never touched', async () => {
  const { landstar, context } = fakeContext({ startPaused: true });
  assert.equal(await pauseAndUnpause(context, '1', { statePath: tempState(), settleMs: 0, log() {} }), 'skipped');
  assert.deepEqual(landstar.clicks, []);
  assert.equal(landstar.paused, true);
});

test('a load that will not unpause is reported and stays on the list to unpause first', async () => {
  const { landstar, context } = fakeContext({ unpauseWorks: false });
  const statePath = tempState();
  await assert.rejects(pauseAndUnpause(context, '7', { statePath, settleMs: 0, log() {} }), /PAUSED on Landstar and would not unpause.*midnight/);
  assert.equal(landstar.paused, true);
  assert.deepEqual(leftPaused(JSON.parse(fs.readFileSync(statePath, 'utf8'))), ['7']);
});

test('the refresh bot writes and reads its own status file', () => {
  const { execFileSync } = require('node:child_process');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-status-')), 'refresh-status.json');
  const env = { ...process.env, BOT_ROLE: 'refresh', REFRESH_STATUS_FILE: file };
  execFileSync(process.execPath, ['-e', "require('./status-server').setStatus('working', 'Refreshing AMERI and hazmat postings (pause/unpause)')"], { cwd: __dirname, env });
  const status = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(status.state, 'working');
  const read = JSON.parse(execFileSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./status-server').readRefreshStatus()))"], { cwd: __dirname, env }).toString());
  assert.equal(read.message, 'Refreshing AMERI and hazmat postings (pause/unpause)');
});
