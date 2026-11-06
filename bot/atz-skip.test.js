const assert = require('node:assert/strict');
const test = require('node:test');
const { isSkipAgencyPosting, removeRowsFromSheetXml } = require('./rate-check');

const load = {
  pickupDate: '11/05/2026', originState: 'OH', destState: 'GA',
  originCity: 'Dayton', originZip: '45401', destCity: 'Tucker', destZip: '30084'
};
const board = extra => ({
  Agency: 'ATZ', PickupFromDateForDisplay: '11/05/26 08:00', OriginState: 'OH', DestinationState: 'GA',
  OriginCity: 'DAYTON', OriginZipCode: '45401', DestinationCity: 'TUCKER', DestinationZipCode: '30084', ...extra
});

test('a load ATZ already posted (same day and lane) is skipped; others are not', () => {
  assert.equal(isSkipAgencyPosting(board(), load), true);
  assert.equal(isSkipAgencyPosting(board({ Agency: 'atz ' }), load), true);
  assert.equal(isSkipAgencyPosting(board({ Agency: 'ANQ' }), load), false, 'your own posting');
  assert.equal(isSkipAgencyPosting(board({ Agency: 'XYZ' }), load), false, 'another agency competes, it does not block');
  assert.equal(isSkipAgencyPosting(board({ PickupFromDateForDisplay: '11/06/26 08:00' }), load), false, 'different day');
  assert.equal(isSkipAgencyPosting(board({ DestinationCity: 'MACON', DestinationZipCode: '31201' }), load), false, 'different lane');
});

test('removing rows deletes them and moves the rows below up', () => {
  const xml = '<worksheet><dimension ref="A1:B4"/><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1</v></c></row>'
    + '<row r="2"><c r="A2"><v>10</v></c><c r="B2"><v>11</v></c></row>'
    + '<row r="3"><c r="A3"><v>20</v></c><c r="B3"><v>21</v></c></row>'
    + '<row r="4" spans="1:2"><c r="A4"><v>30</v></c><c r="B4"><v>31</v></c></row>'
    + '</sheetData></worksheet>';
  const out = removeRowsFromSheetXml(xml, [2]);
  assert.match(out, /<dimension ref="A1:B3"\/>/);
  assert.doesNotMatch(out, /<v>10<\/v>/);
  assert.match(out, /<row r="2"><c r="A2"><v>20<\/v><\/c><c r="B2"><v>21<\/v><\/c><\/row>/);
  assert.match(out, /<row r="3" spans="1:2"><c r="A3"><v>30<\/v><\/c><c r="B3"><v>31<\/v><\/c><\/row>/);
  assert.match(out, /<row r="1"><c r="A1" t="s">/, 'header untouched');
});

test('RXO ATZ van loads post exactly $25 over another agent, even when lower', () => {
  const { matchesTopCompetitor } = require('./rate-check');
  const van = { equipment: 'VAN', hazmat: false };
  assert.equal(matchesTopCompetitor('Landstar_Bulk_R_X_O_2429200___ATZ_3of9.xlsx', van), true);
  assert.equal(matchesTopCompetitor('Landstar_Bulk_R_X_O_2429200___ATZ.xlsx', van), true);
  assert.equal(matchesTopCompetitor('Landstar_Bulk_R_X_O_2429200___ATZ_3of9 (1).xlsx', van), true);
  assert.equal(matchesTopCompetitor('Landstar_Bulk_R_X_O_2429200___ATZ_P_1of2.xlsx', van), false, 'not ATZ P');
  assert.equal(matchesTopCompetitor('Landstar_Bulk_Para_1522166___ATZ.xlsx', van), false);
  assert.equal(matchesTopCompetitor('Landstar_Bulk_R_X_O_2429200___ATZ.xlsx', { equipment: 'R', hazmat: false }), false);
  assert.equal(matchesTopCompetitor('Landstar_Bulk_R_X_O_2429200___ATZ.xlsx', { equipment: 'VAN', hazmat: true }), false);
});

test('Assign Capacity picks only the BCO whose tractor number is exactly the truck, on the newest posting', () => {
  const { isTractorOption, pickPosting } = require('./assign');
  assert.equal(isTractorOption('420371 - LDWY\nRocway Xpress LLC', '420371'), true);
  assert.equal(isTractorOption('4203711 - LDWY\nOther LLC', '420371'), false);
  assert.equal(isTractorOption('0420371 - LDWY', '420371'), true, 'leading zeros');
  const newest = pickPosting([{ LoadId: 1, OrderDate: '/Date(100)/' }, { LoadId: 2, OrderDate: '/Date(300)/' }]);
  assert.equal(newest.LoadId, 2);
});

test('the bot keeps one Assign Capacity request per booked load, the latest truck wins', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  process.env.ASSIGN_QUEUE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'assign-')), 'queue.json');
  delete require.cache[require.resolve('./status-server')];
  const { enqueueAssign, readAssignQueue } = require('./status-server');
  const posting = { originZip: '07032', destZip: '32207', pickupThru: '11/06/26 15:00' };
  enqueueAssign([{ customer: 'Para', loadId: '1', truck: '111', posting }]);
  enqueueAssign([{ customer: 'Para', loadId: '1', truck: '420371', posting }, { customer: 'Para', loadId: '2', truck: '', posting }]);
  const queue = readAssignQueue();
  assert.equal(queue.length, 1, 'no truck = not queued');
  assert.equal(queue[0].truck, '420371');
  delete process.env.ASSIGN_QUEUE_FILE;
  delete require.cache[require.resolve('./status-server')];
});
