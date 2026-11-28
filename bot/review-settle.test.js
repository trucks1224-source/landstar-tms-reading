const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { settleReviewFiles } = require('./review-settle');

const header = ['Origin ZipCode', 'Destination ZipCode', 'Pickup Date (Thru)', 'Weight'];
function writeExport(folder, name, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Sheet1');
  XLSX.writeFile(workbook, path.join(folder, name));
}
const posting = (origin, dest, thru, weight) => ({ OriginZipCode: origin, DestinationZipCode: dest, PickupThruDateForDisplay: thru, Weight: weight });

test('a review file whose loads are all on the board is cleared; one with a load missing stays', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-'));
  const review = path.join(root, 'review');
  const uploaded = path.join(root, 'uploaded');
  const archive = path.join(root, 'archive');
  fs.mkdirSync(review);
  writeExport(review, 'Landstar_Bulk_A.xlsx', [['35673', '93608', '12/04/26 20:00', 42000], ['60007', '76063', '12/05/26 13:00', 41000]]);
  fs.writeFileSync(path.join(review, 'Landstar_Bulk_A - Landstar reply.txt'), '504');
  writeExport(review, 'Landstar_Bulk_B.xlsx', [['35673', '93608', '12/04/26 20:00', 42000], ['80202', '76063', '12/05/26 13:00', 40000]]);
  const board = [posting('35673', '93608', '12/04/26 20:00', 42000), posting('60007', '76063', '12/05/26 13:00', 41000)];
  const result = settleReviewFiles(board, { reviewFolder: review, uploadedFolder: uploaded, archiveFolder: archive });
  assert.deepEqual(result.settled, ['Landstar_Bulk_A.xlsx']);
  assert.deepEqual(result.waiting, [{ file: 'Landstar_Bulk_B.xlsx', found: 1, total: 2 }]);
  assert.deepEqual(fs.readdirSync(review).sort(), ['Landstar_Bulk_B.xlsx']);
  assert.deepEqual(fs.readdirSync(uploaded), ['Landstar_Bulk_A.xlsx']);
  assert.deepEqual(fs.readdirSync(archive), ['Landstar_Bulk_A - Landstar reply.txt']);
  assert.deepEqual(settleReviewFiles([], { reviewFolder: review, uploadedFolder: uploaded, archiveFolder: archive }).settled, [], 'an empty board settles nothing');
});
