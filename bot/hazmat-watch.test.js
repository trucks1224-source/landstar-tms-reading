const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
// The tests' own posting codes, so this PC's bot/agent-config.json never changes the result.
process.env.AGENT_CONFIG_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hazmat-watch-')), 'agent-config.json');
fs.writeFileSync(process.env.AGENT_CONFIG_FILE, JSON.stringify({ postingCodes: ['ANQ', 'QNX'] }));
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
  assert.equal(isHazmatPosting(posting(3, { Agency: 'QNX' })), true, 'every one of your codes');
  assert.equal(isHazmatPosting(posting(6, { Agency: 'SNB' })), false, "SNB is Ivan's (2026-11-27), not yours");
  assert.equal(isHazmatPosting(posting(5, { Agency: 'XYZ' })), false, 'another agency is not yours');
  assert.equal(isHazmatPosting(posting(4, { SourceSystemID: 'AW' })), false, 'hand-posted loads are left alone');
});

test('recurring rate check selects verified PARA and RXO only, with hazmat first', () => {
  const van = posting(1, { CommodityCode: 'CGAPP', Weight: 1 });
  const hazmat = posting(2, { Weight: 2 });
  const ambiguous = posting(3, { Weight: 3 });
  const unknown = posting(4, { Weight: 4 });
  const otherAgency = posting(5, { Agency: 'XYZ', Weight: 5 });
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

function editContext(label, status = 204, { shows, sentRate } = {}) {
  let onResponse;
  const calls = [];
  let typed = '';
  const page = {
    on(event, handler) { if (event === 'response') onResponse = handler; },
    async goto() {},
    async waitForURL() {},
    locator(selector) {
      assert.equal(selector, 'input[formcontrolname="flatRate"]');
      return {
        async waitFor() {},
        async click() {},
        async press(key) { if (key === 'Backspace') typed = ''; },
        async pressSequentially(rate) { typed = rate; calls.push(['rate', rate]); },
        async inputValue() { return shows ?? `$${Number(typed).toLocaleString('en-US', { minimumFractionDigits: 2 })}`; },
        async blur() {},
        // "set directly" passes the value; the evidence step reads the box's attributes.
        async evaluate(fn, value) { if (value !== undefined) { typed = value; calls.push(['set', value]); } return 'formcontrolname="flatRate"'; }
      };
    },
    async screenshot() { calls.push(['screenshot']); },
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
            request: () => ({ method: () => 'PATCH', postData: () => JSON.stringify({ loadId: 123, rate: { flatRate: sentRate ?? Number(typed) } }) }),
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

test('a rate box that does not show the new rate is never saved (old rate + $0.01 bug, 2026-11-23)', async () => {
  const { context, calls } = editContext('Save Changes', 204, { shows: '$8,225.01' });
  await assert.rejects(raisePostingRate(context, 123, 8275),
    /would not take \$8275 \(typed: \$8225\.01; cleared then typed with cents: \$8225\.01; set directly: \$8225\.01\); nothing was saved/);
  assert.equal(calls.some(([kind]) => kind === 'save'), false);
  assert.ok(calls.some(([kind]) => kind === 'screenshot'), 'a screenshot of the form is kept');
});

test('when typing does not register, the next way of entering the rate is used', async () => {
  let attempt = 0;
  const { context, calls } = editContext('Save Changes');
  const page = await context.newPage();
  const box = page.locator('input[formcontrolname="flatRate"]');
  const realType = box.pressSequentially;
  page.locator = () => ({ ...box, async pressSequentially(rate) { attempt += 1; await realType(attempt === 1 ? '8225.01' : rate); } });
  context.newPage = async () => page;
  assert.equal(await raisePostingRate(context, 123, 8275), true);
  assert.deepEqual(calls.filter(([kind]) => kind !== 'closed').map(([kind, value]) => `${kind}:${value}`), ['rate:8225.01', 'rate:8275.00', 'save:Save Changes']);
});

test('a save that Landstar received without the new rate counts as not raised', async () => {
  const { context } = editContext('Save Changes', 204, { sentRate: 8225.01 });
  await assert.rejects(raisePostingRate(context, 123, 8275), /saved load #123 without the new rate \$8275/);
});

test('the same load re-posted from towns within 25 miles still counts (HUC Perrysburg, 2026-11-20)', () => {
  const ours = posting(1, {
    CommodityCode: 'CGAPP', OriginCity: 'LUCKEY', OriginState: 'OH', OriginZipCode: '43443',
    DestinationCity: 'WARREN', DestinationState: 'AR', DestinationZipCode: '71671',
    PickupFromDateForDisplay: '11/22/26 08:00', Weight: 42000, TotalRevenue: 2925
  });
  const huc = {
    ...ours, LoadId: 2, Agency: 'HUC', OriginCity: 'PERRYSBURG', OriginZipCode: '43551',
    DestinationCity: 'MONTICELLO', DestinationZipCode: '71655', PickupFromDateForDisplay: '11/22/26 07:00',
    TrailerTypes: ['53VN'], TotalRevenue: 3000
  };
  assert.deepEqual(findCompetitors(ours, [huc], trailerGroup).map(b => b.Agency), ['HUC']);
  assert.equal(planRaise(ours, findCompetitors(ours, [huc], trailerGroup)).to, 3025, 'back on top at $3,025');

  // HUC's real McGehee, AR delivery is ~39 miles from Warren: outside the 25-mile limit.
  assert.deepEqual(findCompetitors(ours, [{ ...huc, DestinationCity: 'MCGEHEE', DestinationZipCode: '71654' }], trailerGroup), []);
  const lighter = { ...huc, Weight: 20000 };
  const farAway = { ...huc, OriginCity: 'COLUMBUS', OriginZipCode: '43215' };
  const otherDay = { ...huc, PickupFromDateForDisplay: '11/23/26 07:00' };
  const reefer = { ...huc, TrailerTypes: ['REFR'] };
  for (const other of [lighter, farAway, otherDay, reefer]) {
    assert.deepEqual(findCompetitors(ours, [other], trailerGroup), [], 'a different load is not matched');
  }
});

test('a saved raise is reported to the TMS with the posting details it matches loads by', () => {
  const { rateRaiseReport } = require('./hazmat-watch');
  const mine = posting(190228717, {
    OriginZipCode: '07102', DestinationZipCode: '45801', PickupThruDateForDisplay: '11/27/26 08:00', Weight: 42000,
    OriginCityStateForDisplay: 'NEWARK, NJ', DestinationCityStateForDisplay: 'LIMA, OH', TotalRevenue: 1760
  });
  const report = rateRaiseReport(mine, { from: 1760, to: 1945, top: { Agency: 'GGL', TotalRevenue: 1920 } });
  assert.deepEqual(report, {
    landstarLoadId: '190228717',
    posting: { originZip: '07102', destZip: '45801', pickupThru: '11/27/26 08:00', weight: 42000 },
    lane: 'NEWARK, NJ -> LIMA, OH', from: 1760, to: 1945, competitor: 'GGL', competitorRate: 1920, hazmat: true
  });
});
