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

test('CH same-day posts highest other-agent rate plus $10 even below BIN or from zero', () => {
  const { getChPostingRate } = require('./rate-check');
  const now = new Date(2026, 9, 1, 23, 59);
  const today = { pickupDate: '10/01/2026', rate: 2770 };
  const file = 'Landstar_Bulk_CH_593772___ATZ_H_1of2 (1).xlsx';
  assert.equal(getChPostingRate(file, today, { TotalRevenue: 2000 }, now), 2010);
  assert.equal(getChPostingRate(file, today, { TotalRevenue: '3000' }, now), 3010);
  assert.equal(getChPostingRate(file, { ...today, rate: 0 }, { TotalRevenue: 2000 }, now), 2010);
  assert.equal(getChPostingRate(file, today, null, now), 2770);
  assert.equal(getChPostingRate(file, { ...today, rate: 0 }, null, now), 0);
  for (const rate of [2770, 0]) {
    assert.equal(getChPostingRate(file, { pickupDate: '10/02/2026', rate }, { TotalRevenue: 3000 }, now), rate);
  }
  assert.equal(getChPostingRate('Landstar_Bulk_Para_1522166___ATZ.xlsx', today, { TotalRevenue: 2000 }, now), null);
  assert.equal(getChPostingRate('Landstar_Bulk_CH_5937720___ATZ_H.xlsx', today, { TotalRevenue: 2000 }, now), null);
});

test('CH rate check writes both spreadsheet amounts and keeps future BIN instead of the general +$25 rule', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const XLSX = require('xlsx');
  delete require.cache[require.resolve('./rate-check')];
  const { checkFiles } = require('./rate-check');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-bin-test-'));
  try {
    const now = new Date();
    const day = offset => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const serial = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 8) / 86400000 + 25569;
    const headers = ['Origin City', 'Origin Zipcode', 'Origin Country', 'Destination City', 'Destination Zipcode',
      'Destination Country', 'Pickup Date (From)', 'Load Posting Code', 'Equipment 1', 'Rate', 'Carrier Amt'];
    const row = (offset, rate) => ['Dayton', '45401', 'US', 'Tucker', '30084', 'US', serial(day(offset)), 'ANQ', 'VAN', rate, rate];
    const file = path.join(folder, 'Landstar_Bulk_CH_593772___ATZ_H.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      headers, row(0, 2770), row(0, 0), row(1, 2770), row(1, 0)
    ]), 'Loads');
    XLSX.writeFile(workbook, file);
    const page = { evaluate: async (_fn, options) => {
      if (!options) return [{ text: 'Van', items: [{ text: 'VAN' }, { text: '53VN' }] }];
      return [
        ['XYZ', 1900, 'VAN'], ['ABC', 2000, '53VN'], ['ANQ', 9900, 'VAN'], ['DEF', 8800, 'F']
      ].map(([Agency, TotalRevenue, equipment], index) => board({
        Agency, TotalRevenue, TrailerTypes: [equipment], LoadId: index,
        PickupFromDateForDisplay: `${options.body.PickupDate.replace(/\/\d{2}(\d{2})$/, '/$1')} 08:00`
      }));
    } };
    const [result] = await checkFiles(page, [file], { apply: true, log() {} });
    assert.deepEqual(result.changes, [{ rowNumber: 2, newRate: 2010 }, { rowNumber: 3, newRate: 2010 }]);
    const sheet = XLSX.readFile(file).Sheets.Loads;
    assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 }).slice(1).map(row => row.slice(9)), [
      [2010, 2010], [2010, 2010], [2770, 2770], [0, 0]
    ]);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('a load ATZ already posted (same day and lane) is skipped; others are not', () => {
  assert.equal(isSkipAgencyPosting(board(), load), true);
  assert.equal(isSkipAgencyPosting(board({ Agency: 'atz ' }), load), true);
  assert.equal(isSkipAgencyPosting(board({ Agency: 'ANQ' }), load), false, 'your own posting');
  assert.equal(isSkipAgencyPosting(board({ Agency: 'XYZ' }), load), false, 'another agency competes, it does not block');
  assert.equal(isSkipAgencyPosting(board({ PickupFromDateForDisplay: '11/06/26 08:00' }), load), false, 'different day');
  assert.equal(isSkipAgencyPosting(board({ DestinationCity: 'MACON', DestinationZipCode: '31201' }), load), false, 'different lane');
});

test('an ATZ agent never skips loads because of ATZ postings: they are his own', () => {
  assert.equal(isSkipAgencyPosting(board(), load, ['ATZ']), false, 'computer set up with posting code ATZ');
  assert.equal(isSkipAgencyPosting(board(), { ...load, postingCode: 'ATZ' }), false, 'load exported under ATZ');
  assert.equal(isSkipAgencyPosting(board(), load, ['ANQ']), true, 'an ANQ computer still skips ATZ postings');
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

test('Nolan files follow their own rule: posting rate, or exactly agent RPP\'s rate', () => {
  const { isNolanFile, MATCH_AGENCY_FOR_NOLAN, matchesTopCompetitor } = require('./rate-check');
  assert.equal(isNolanFile('Landstar_Bulk_Nolan_965974___ATZ_H.xlsx'), true);
  assert.equal(isNolanFile('Landstar_Bulk_Nolan_965974___ATZ (10).xlsx'), true);
  assert.equal(isNolanFile('Landstar_Bulk_R_X_O_2429200___ATZ.xlsx'), false);
  assert.equal(MATCH_AGENCY_FOR_NOLAN, 'RPP');
  assert.equal(matchesTopCompetitor('Landstar_Bulk_Nolan_965974___ATZ_H.xlsx', { equipment: 'VAN', hazmat: false }), false);
});

test('AMERI 18347- ATZ posts at its contract rate even when ATZ or AAZ has the load: no skip, no raise', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const XLSX = require('xlsx');
  delete require.cache[require.resolve('./rate-check')];
  const { checkFiles, isContractRateFile } = require('./rate-check');
  for (const name of ['Landstar_Bulk_AMERI_18347__ATZ.xlsx', 'Landstar_Bulk_AMERI_18347__ATZ_2of3.xlsx',
    'Landstar_Bulk_AMERI_18347__ATZ (1).xlsx', 'Landstar_Bulk_AMERI_18347__ATZ_1.xlsx']) {
    assert.equal(isContractRateFile(name), true, name);
  }
  assert.equal(isContractRateFile('Landstar_Bulk_AMERI_18347__ATZ_H.xlsx'), false, 'exact account only');
  assert.equal(isContractRateFile('Landstar_Bulk_Para_1522166___ATZ.xlsx'), false);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ameri-test-'));
  try {
    const now = new Date();
    const serial = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8) / 86400000 + 25569;
    const headers = ['Origin City', 'Origin Zipcode', 'Origin Country', 'Destination City', 'Destination Zipcode',
      'Destination Country', 'Pickup Date (From)', 'Load Posting Code', 'Equipment 1', 'Rate', 'Carrier Amt'];
    const file = path.join(folder, 'Landstar_Bulk_AMERI_18347__ATZ.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      headers, ['Dayton', '45401', 'US', 'Tucker', '30084', 'US', serial, 'ANQ', 'VAN', 4500, 0]
    ]), 'Loads');
    XLSX.writeFile(workbook, file);
    const page = { evaluate: async (_fn, options) => {
      if (!options) return [{ text: 'Van', items: [{ text: 'VAN' }] }];
      return [['ATZ', 4500], ['AAZ', 5000]].map(([Agency, TotalRevenue], index) => board({
        Agency, TotalRevenue, TrailerTypes: ['VAN'], LoadId: index,
        PickupFromDateForDisplay: `${options.body.PickupDate.replace(/\/\d{2}(\d{2})$/, '/$1')} 08:00`
      }));
    } };
    const [result] = await checkFiles(page, [file], { apply: true, log() {} });
    assert.deepEqual([...result.skips], [], 'not skipped for ATZ');
    assert.deepEqual([...result.changes], [], 'not raised over ATZ or AAZ');
    assert.equal(result.remaining, 1);
    const rows = XLSX.utils.sheet_to_json(XLSX.readFile(file).Sheets.Loads, { header: 1 });
    assert.deepEqual(rows[1].slice(9), [4500, 0], 'contract rate and $0 Carrier Amt unchanged');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
