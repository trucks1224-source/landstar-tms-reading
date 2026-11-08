const assert = require('node:assert/strict');
const test = require('node:test');
const { isBotPosting, signature, serialToBoardTime } = require('./bot-postings');

test('only postings that match a spreadsheet the bot uploaded count as the bot\'s', () => {
  // 11/10/2026 14:00 as an Excel serial, the way the exported spreadsheet stores it.
  const pickupThru = 46336 + 14 / 24;
  assert.equal(serialToBoardTime(pickupThru), '11/10/26 14:00');
  const uploaded = new Set([signature(7036, '29730', serialToBoardTime(pickupThru), 41675)]);
  const board = { OriginZipCode: '07036', DestinationZipCode: '29730', PickupThruDateForDisplay: '11/10/26 14:00', Weight: 41675 };
  assert.equal(isBotPosting(board, uploaded), true, 'ZIPs lose their leading zero in Excel');
  assert.equal(isBotPosting({ ...board, Weight: 30000 }, uploaded), false, 'a Quick Post load is not in any upload');
  assert.equal(isBotPosting({ ...board, PickupThruDateForDisplay: '11/10/26 15:00' }, uploaded), false);
});
