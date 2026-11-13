const assert = require('node:assert/strict');
const test = require('node:test');
const { findCompetitors, planRaise, isHazmatPosting, raisePostingRate, selectRateWatchPostings, eligibleExport } = require('./hazmat-watch');
const { postingSignature } = require('./bot-postings');

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

test('recurring rate check selects verified PARA and RXO only, with hazmat first', () => {
  const van = posting(1, { CommodityCode: 'CGAPP', Weight: 1 });
  const hazmat = posting(2, { Weight: 2 });
  const ambiguous = posting(3, { Weight: 3 });
  const unknown = posting(4, { Weight: 4 });
  const otherAgency = posting(5, { Agency: 'SNB', Weight: 5 });
  const eligible = new Set([van, hazmat, ambiguous, otherAgency].map(postingSignature));
  const other = new Set([postingSignature(ambiguous)]);
  assert.deepEqual(selectRateWatchPostings([van, ambiguous, unknown, otherAgency, hazmat], eligible, other).map(p => p.LoadId), [2, 1]);
  assert.equal(eligibleExport('Landstar_Bulk_Para_1522166___ATZ_H.xlsx'), true);
  assert.equal(eligibleExport('Landstar_Bulk_R_X_O_2429200___ATZ_R_1of26.xlsx'), true);
  assert.equal(eligibleExport('Landstar_Bulk_Nolan_965974___ATZ_H.xlsx'), false);
  assert.equal(eligibleExport('Landstar_Bulk_Para_15221660.xlsx'), false);
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

function editContext(label, status = 204) {
  let onResponse;
  const calls = [];
  const page = {
    on(event, handler) { if (event === 'response') onResponse = handler; },
    async goto() {},
    async waitForURL() {},
    locator(selector) {
      assert.equal(selector, 'input[formcontrolname="flatRate"]');
      return {
        async waitFor() {},
        async fill(rate) { calls.push(['rate', rate]); },
        async blur() {}
      };
    },
    getByRole(role, { name }) {
      assert.equal(role, 'button');
      if (name.test('Edit')) return { first: () => ({ async click() {} }) };
      assert.ok(name.test(label), `must recognize ${label}`);
      for (const other of ['Save Search', 'Save Template', 'Post', 'Cancel']) {
        assert.equal(name.test(other), false, `must not click ${other}`);
      }
      return {
        async click() {
          calls.push(['save', label]);
          if (status !== null) onResponse({
            url: () => 'https://portal.landstaronline.com/loadboards/v1/availableLoad',
            request: () => ({ method: () => 'PATCH' }),
            status: () => status
          });
        }
      };
    },
    async waitForTimeout() {},
    async close() { calls.push(['closed']); }
  };
  return { context: { async newPage() { return page; } }, calls };
}

for (const label of ['Save', 'Save Changes']) {
  test(`rate edit handles the responsive "${label}" button and requires confirmation`, async () => {
    const { context, calls } = editContext(label);
    assert.equal(await raisePostingRate(context, 123, 3225), true);
    assert.deepEqual(calls, [['rate', '3225'], ['save', label], ['closed']]);
  });
}

for (const status of [400, 403, 500, null]) {
  test(`rate edit surfaces ${status === null ? 'missing confirmation' : `HTTP ${status}`} and closes its page`, async () => {
    const { context, calls } = editContext('Save', status);
    await assert.rejects(raisePostingRate(context, 123, 3225), /did not confirm saving rate for load #123/);
    assert.deepEqual(calls.at(-1), ['closed']);
  });
}
