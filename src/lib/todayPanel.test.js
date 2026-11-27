import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleProblems, newProblems, summarizeTodayByAccount, todayTotals, todayTimeline, PROBLEM_SNOOZE_MS } from './todayPanel.js';

const now = new Date(2026, 10, 27, 13, 0).getTime();
const at = (h, m) => new Date(2026, 10, 27, h, m).getTime();
const iso = (h, m, day = 27) => new Date(2026, 10, day, h, m).toISOString();

test('hidden problems come back after 30 minutes; only new ones sound the alarm', () => {
  const problems = [{ key: 'a' }, { key: 'b' }];
  assert.deepEqual(visibleProblems(problems, { a: now - 60000 }, now).map(item => item.key), ['b']);
  assert.deepEqual(visibleProblems(problems, { a: now - PROBLEM_SNOOZE_MS - 1 }, now).map(item => item.key), ['a', 'b']);
  assert.deepEqual(newProblems(problems, new Set(['a'])).map(item => item.key), ['b']);
});

const today = {
  uploads: [
    { at: at(9, 21), file: 'Landstar_Bulk_R_X_O_2429200___ATZ_R.xlsx', account: { name: 'R X O 2429200 - ATZ R', key: 'RXO2429200ATZR' }, ok: true },
    { at: at(10, 35), file: 'Landstar_Bulk_CH_593772__ATZ_H____2.xlsx', account: { name: 'CH 593772 - ATZ H', key: 'CH593772ATZH' }, ok: false, message: 'Uploads stopped: window did not open' },
    { at: at(10, 37), file: 'Landstar_Bulk_CH_593772__ATZ_H____2.xlsx', account: { name: 'CH 593772 - ATZ H', key: 'CH593772ATZH' }, ok: false, message: 'Uploads stopped: window did not open' },
    { at: at(10, 57), file: 'Landstar_Bulk_CH_593772__ATZ_H____2.xlsx', account: { name: 'CH 593772 - ATZ H', key: 'CH593772ATZH' }, ok: true },
    { at: at(8, 40), file: '', account: { name: '', key: '' }, ok: false, signIn: true, message: 'sign-in' }
  ],
  rates: { RXO2429200ATZH: { name: 'R X O 2429200 - ATZ H', checked: 19, raised: 9, skippedAtz: 1 } },
  reviews: [{ file: 'x.xlsx' }],
  chat: [{ at: at(11, 42), chat: 'LANDJA18 (RXO)', label: 'this is whats been booked this week', type: 'spreadsheet' }]
};
const ordersMap = {
  'CH 593772- ATZ H': [
    { id: '1', status: 'ENT', landstarExportedAt: iso(10, 30) },
    { id: '2', status: 'BOOKED', bookedAt: iso(12, 0), landstarExportedAt: iso(9, 0, 26) },
    { id: '3', status: 'OPEN', hot: true }
  ],
  'Para 1522166 - ATZ': [{ id: '4', status: 'ENT', landstarExportedAt: iso(9, 0, 26) }]
};

test('accounts: exported and booked today from the TMS, files and rates from the bots', () => {
  const rows = summarizeTodayByAccount(today, ordersMap, load => Boolean(load.hot), now);
  const ch = rows.find(row => row.key === 'CH593772ATZH');
  assert.equal(ch.name, 'CH 593772- ATZ H', "the TMS's own spelling of the account");
  assert.deepEqual([ch.exported, ch.booked, ch.onHotLane, ch.filesPosted, ch.filesFailed], [1, 1, 1, 1, 2]);
  const atzH = rows.find(row => row.key === 'RXO2429200ATZH');
  assert.deepEqual([atzH.checked, atzH.raised, atzH.skippedAtz], [19, 9, 1]);
  assert.equal(rows.some(row => row.name === 'Para 1522166 - ATZ'), false, 'nothing today: not listed');
  assert.equal(rows[0].key, 'CH593772ATZH', 'most activity first');
  const totals = todayTotals(today, rows);
  assert.deepEqual([totals.filesPosted, totals.filesFailed, totals.raised, totals.reviews, totals.chat, totals.booked], [2, 2, 9, 1, 1, 1]);
});

test('timeline: newest first, a run of the same failure folded into one line', () => {
  const items = todayTimeline(today);
  assert.deepEqual(items.map(item => item.kind), ['chat', 'posted', 'failed', 'posted', 'failed']);
  const failedRun = items[2];
  assert.equal(failedRun.count, 2);
  assert.equal(failedRun.lastAt, at(10, 37));
  assert.equal(items[4].message, 'sign-in');
});
