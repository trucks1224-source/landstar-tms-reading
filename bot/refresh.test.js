const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landstar-refresh-test-'));
process.env.BOT_NO_STATUS = '1';
process.env.POSTING_MAINTENANCE_FILE = path.join(dir, 'snapshot.json');
process.env.POSTING_REFRESH_STATE_FILE = path.join(dir, 'state.json');
const maintenance = require('./posting-maintenance');
const { buildRefreshWorkbook, findSource, readRefreshStatus } = require('./refresh');
const posting = { originZip: '30349', destZip: '92504', pickupThru: '11/20/26 20:00', weight: 42000 };
const item = { customer: 'Test', loadId: '123', posting, status: 'OPEN', truck: '', refresh: true };
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('protected posting snapshots survive stale heartbeats, but refresh requires a current unchanged OPEN/ENT load', () => {
  const now = Date.now();
  maintenance.saveSnapshot([item], undefined, now);
  const snapshot = maintenance.readSnapshot();
  const saved = snapshot.loads[0];
  assert.equal(maintenance.refreshIsCurrent(saved, snapshot, now + 1000), true);
  assert.equal(maintenance.refreshIsCurrent(saved, snapshot, now + 90001), false);
  const board = { OriginZipCode: '30349', DestinationZipCode: '92504', PickupThruDateForDisplay: posting.pickupThru, Weight: 42000 };
  assert.equal(maintenance.isProtectedPosting(board, snapshot), true);
  assert.equal(maintenance.isProtectedPosting({ ...board, Weight: 44000 }, snapshot), false);
  for (const status of ['BOOKED', 'OFFER', 'ON HOLD']) {
    assert.equal(maintenance.canRefresh({ ...saved, status }), false);
  }
  assert.equal(maintenance.canRefresh({ ...saved, truck: '429036' }), false);
  assert.equal(maintenance.refreshIsCurrent(saved, { ...snapshot, loads: [{ ...saved, pickupTime: 'changed' }] }, now), false);
  assert.throws(() => maintenance.saveSnapshot([{ loadId: 'invalid' }]), /exported posting details/);
  assert.equal(maintenance.readSnapshot().loads.length, 1, 'bad snapshots do not replace protection');
});

const headers = [
  'Origin Zipcode(Required)', 'Destination Zipcode(Required)', 'Pickup Date (From)(Required)',
  'Pickup Date (Thru)(Required)', 'Delivery Date (From)(Required)', 'Delivery Date (Thru)(Required)',
  'Weight(Required)', 'Load Posting Code', 'Rate(Required)', 'Carrier Amt', 'Comments'
];
const serial = (day, hour) => (Date.UTC(2026, 10, day, hour) - Date.UTC(1899, 11, 30)) / 86400000;
const sourceRow = ['30349', '92504', serial(20, 6), serial(20, 20), serial(22, 8), serial(22, 12), 42000, 'ANQ', 3000, 3000, 'Keep original details'];
function sourceWorkbook(rows = [sourceRow]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Loads');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Keep this sheet']]), 'Comments');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

test('refresh copies only the exact archived load, preserves template sheets and uses the current board rate', async () => {
  fs.writeFileSync(path.join(dir, 'uploaded.xlsx'), sourceWorkbook([
    ['10001', '90210', serial(20, 6), serial(20, 20), serial(22, 8), serial(22, 12), 44000, 'ANQ', 1111, 1111, 'Unrelated'],
    sourceRow
  ]));
  const source = findSource(dir, item);
  assert.equal(source.number, 3);
  const now = new Date(2026, 10, 20, 8, 0).getTime();
  const result = XLSX.read(await buildRefreshWorkbook(source, 3250, now));
  const rows = XLSX.utils.sheet_to_json(result.Sheets.Loads, { header: 1 });
  assert.equal(rows.length, 2, 'no unrelated load is reposted');
  assert.equal(rows[1][0], '30349');
  assert.equal(rows[1][8], 3250);
  assert.equal(rows[1][9], 3250);
  assert.equal(rows[1][10], 'Keep original details');
  assert.ok(Math.abs(rows[1][2] - (serial(20, 8) + 15 / 1440)) < 0.000001);
  assert.equal(XLSX.utils.sheet_to_json(result.Sheets.Comments, { header: 1 })[0][0], 'Keep this sheet');
  await assert.rejects(buildRefreshWorkbook(source, 0, now), /current board rate/);
  await assert.rejects(buildRefreshWorkbook(source, 3250, new Date(2026, 10, 21, 8).getTime()), /Pickup window/);
});

test('missing or ambiguous archived sources never produce a refresh upload', () => {
  assert.throws(() => findSource(dir, { ...item, posting: { ...posting, originZip: '99999' } }), /No matching uploaded/);
  const duplicateDir = path.join(dir, 'duplicates');
  fs.mkdirSync(duplicateDir);
  fs.writeFileSync(path.join(duplicateDir, 'duplicate.xlsx'), sourceWorkbook([sourceRow, sourceRow]));
  assert.throws(() => findSource(duplicateDir, item), /Multiple export rows/);
  assert.deepEqual(readRefreshStatus(), []);
});
