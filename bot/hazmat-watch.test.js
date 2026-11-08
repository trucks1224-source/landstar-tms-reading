const assert = require('node:assert/strict');
const test = require('node:test');
const { findCompetitors, planRaise, isHazmatPosting } = require('./hazmat-watch');

const trailerGroup = code => ({ VAN: 'VAN', '53VN': 'VAN', REFR: 'REEFER' }[String(code).trim().toUpperCase()] || String(code).trim().toUpperCase());
const posting = (id, extra = {}) => ({
  LoadId: id, Agency: 'ANQ', SourceSystemID: 'PORTAL', CommodityCode: 'HAZMAT',
  OriginCity: 'DAYTON', OriginState: 'OH', OriginZipCode: '45401',
  DestinationCity: 'TUCKER', DestinationState: 'GA', DestinationZipCode: '30084',
  PickupFromDateForDisplay: '11/05/26 08:00', TrailerTypes: ['VAN '], TotalRevenue: 3025, ...extra
});

test('only your own bulk-posted hazmat loads are watched, for every customer', () => {
  assert.equal(isHazmatPosting(posting(1)), true);
  assert.equal(isHazmatPosting(posting(2, { CommodityCode: 'CGAPP' })), false);
  assert.equal(isHazmatPosting(posting(3, { Agency: 'SNB' })), false, 'SNB is not yours');
  assert.equal(isHazmatPosting(posting(4, { SourceSystemID: 'AW' })), false, 'hand-posted loads are left alone');
});

test('competitors are other agencies on the same lane, day and trailer group', () => {
  const mine = posting(1);
  const board = [
    mine,
    posting(2, { Agency: 'XYZ', TotalRevenue: 3200 }),
    posting(3, { Agency: 'ANQ', TotalRevenue: 9000 }),
    posting(4, { Agency: 'XYZ', PickupFromDateForDisplay: '11/06/26 08:00', TotalRevenue: 9000 }),
    posting(5, { Agency: 'XYZ', DestinationCity: 'MACON', DestinationZipCode: '31201', TotalRevenue: 9000 }),
    posting(6, { Agency: 'XYZ', TrailerTypes: ['REFR'], TotalRevenue: 9000 }),
    posting(7, { Agency: 'QRS', TrailerTypes: ['53VN'], CommodityCode: 'CGAPP', TotalRevenue: 3100 })
  ];
  assert.deepEqual(findCompetitors(mine, board, trailerGroup).map(b => b.LoadId), [2, 7]);
});

test('raise to the top rate + $25 when someone pays the same or more; otherwise leave it', () => {
  const mine = posting(1);
  assert.deepEqual(
    (({ loadId, from, to }) => ({ loadId, from, to }))(planRaise(mine, [posting(2, { Agency: 'XYZ', TotalRevenue: 3200 }), posting(3, { Agency: 'Q', TotalRevenue: 3100 })])),
    { loadId: 1, from: 3025, to: 3225 }
  );
  assert.equal(planRaise(mine, [posting(2, { Agency: 'XYZ', TotalRevenue: 3025 })]).to, 3050, 'a tie is raised');
  assert.equal(planRaise(mine, [posting(2, { Agency: 'XYZ', TotalRevenue: 3000 })]), null, 'already the highest');
  assert.equal(planRaise(mine, []), null);
});
