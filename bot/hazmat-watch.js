// Keeps eligible PARA and RXO postings competitive, checking hazmat first.
//
// Every 15 minutes, the bot searches the Landstar board for other agencies' postings
// on the same lane and pickup date with a matching trailer type, exactly like the
// upload-time rate check. When another agency pays the same or more, the posting is
// raised to their rate + $25 through Landstar's own Edit form (Save Changes).
//
// Run on its own (stop the bot first):
//   node hazmat-watch.js          <- report only, changes nothing
//   node hazmat-watch.js --apply  <- also raises the rates

const path = require('path');
const { listPostings } = require('./dedupe');
const {
  openBoard, searchBoard, sameCity, getTrailerGroups, boardPickupDate, OWN_POSTING_CODES, OUTBID_BY, isSameLoadNearby
} = require('./rate-check');
const { setStatus, reportRateRaise } = require('./status-server');

// What the TMS needs to find the load and show the raise: the same posting details the TMS
// saved when it exported the load (origin ZIP, destination ZIP, pickup end, weight).
function rateRaiseReport(posting, raise) {
  return {
    landstarLoadId: String(posting.LoadId),
    posting: {
      originZip: String(posting.OriginZipCode || '').trim(),
      destZip: String(posting.DestinationZipCode || '').trim(),
      pickupThru: String(posting.PickupThruDateForDisplay || '').trim(),
      weight: Number(posting.Weight) || 0
    },
    lane: `${posting.OriginCityStateForDisplay || ''} -> ${posting.DestinationCityStateForDisplay || ''}`.trim(),
    from: raise.from,
    to: raise.to,
    competitor: raise.top?.Agency || '',
    competitorRate: Number(raise.top?.TotalRevenue) || 0,
    hazmat: isHazmatPosting(posting)
  };
}
const { uploadedSignatures, postingSignature } = require('./bot-postings');

const clean = value => String(value ?? '').trim().toUpperCase();
const eligibleExport = name => /^Landstar_Bulk_(?:Para_1522166|R_X_O_2429200)(?:_|\.xlsx$)/i.test(name);
const isHazmatPosting = load => clean(load.CommodityCode) === 'HAZMAT'
  && clean(load.SourceSystemID) === 'PORTAL'
  && OWN_POSTING_CODES.includes(clean(load.Agency));

// Daniel 2026-11-27: "make sure I'm the highest paid on the board for hazmat loads" - every
// hazmat posting the bot uploaded is checked, whatever the customer, except accounts whose rate
// is fixed by the customer (AMERI's contract rates, CH's own rate).
const fixedRateExport = name => /^Landstar_Bulk_(?:AMERI_18347|CH_593772)(?:_|\.xlsx$)/i.test(name);

function selectRateWatchPostings(postings, eligible, other, hazmatEligible = new Set(), fixedRate = new Set()) {
  return postings.filter(posting => {
    const signature = postingSignature(posting);
    if (clean(posting.SourceSystemID) !== 'PORTAL' || !OWN_POSTING_CODES.includes(clean(posting.Agency))) return false;
    if (eligible.has(signature) && !other.has(signature)) return true;
    return isHazmatPosting(posting) && hazmatEligible.has(signature) && !fixedRate.has(signature);
  }).sort((a, b) => Number(isHazmatPosting(b)) - Number(isHazmatPosting(a)));
}

// Other agencies' postings that compete with `mine` (same lane, pickup date and trailer group).
function findCompetitors(mine, boardLoads, trailerGroup, ownCodes = OWN_POSTING_CODES) {
  const own = new Set(ownCodes.map(clean));
  const myGroups = new Set((mine.TrailerTypes || []).map(t => trailerGroup(t)));
  const sameZipOrCity = (zip, city, myZip, myCity) =>
    (clean(zip) && clean(zip) === clean(myZip)) || sameCity(city, myCity) || clean(city) === clean(myCity);
  return boardLoads.filter(b =>
    !own.has(clean(b.Agency))
    && b.LoadId !== mine.LoadId
    && boardPickupDate(b) === boardPickupDate(mine)
    && clean(b.OriginState) === clean(mine.OriginState)
    && clean(b.DestinationState) === clean(mine.DestinationState)
    && ((sameZipOrCity(b.OriginZipCode, b.OriginCity, mine.OriginZipCode, mine.OriginCity)
      && sameZipOrCity(b.DestinationZipCode, b.DestinationCity, mine.DestinationZipCode, mine.DestinationCity))
      // The same load re-posted from neighboring towns to hide it (rate-check.js isSameLoadNearby).
      || isSameLoadNearby({
        originZip: mine.OriginZipCode, originCity: mine.OriginCity, originState: mine.OriginState,
        destZip: mine.DestinationZipCode, destCity: mine.DestinationCity, destState: mine.DestinationState, weight: mine.Weight
      }, b))
    && (b.TrailerTypes || []).some(t => myGroups.has(trailerGroup(t)))
    && Number(b.TotalRevenue) > 0);
}

// The raise for one posting, or null when it already pays the most on its lane.
function planRaise(mine, competitors, outbidBy = OUTBID_BY) {
  const top = competitors.reduce((best, b) => (!best || Number(b.TotalRevenue) > Number(best.TotalRevenue) ? b : best), null);
  if (!top || Number(top.TotalRevenue) < Number(mine.TotalRevenue)) return null;
  return { loadId: mine.LoadId, from: Number(mine.TotalRevenue), to: Number(top.TotalRevenue) + outbidBy, top };
}

// "$8,275.00" -> 8275
const moneyValue = text => Number(String(text ?? '').replace(/[^0-9.]/g, ''));

// Every number in a saved request body, to confirm the new rate is really in it.
function numbersIn(value, out = []) {
  if (value && typeof value === 'object') Object.values(value).forEach(v => numbersIn(v, out));
  else if (value !== null && value !== '' && Number.isFinite(Number(value))) out.push(Number(value));
  return out;
}

// Changes one posting's flat rate with the portal's Edit form; true when Landstar saved it.
// The rate is typed key by key (a value set directly is not always picked up by Landstar's
// form, which then saved the old rate + $0.01 instead of the raise, 2026-11-23), checked in
// the box before saving, and checked again in the request Landstar receives.
async function raisePostingRate(context, loadId, rate, log) {
  const page = await context.newPage();
  try {
    let saved = null;
    let sentBody = null;
    page.on('response', response => {
      if (/\/loadboards\/v1\/availableLoad$/.test(response.url()) && response.request().method() === 'PATCH') {
        saved = response.status();
        try { sentBody = JSON.parse(response.request().postData() || 'null'); } catch { sentBody = null; }
      }
    });
    await page.goto(`https://portal.landstaronline.com/agent/detail/PORTAL/${loadId}/LRGR`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForURL(/portal\.landstaronline\.com\/agent\/detail/, { timeout: 60000 }).catch(() => {});
    await page.getByRole('button', { name: /^\s*edit\s*$/i }).first().click({ timeout: 30000 });
    const flat = page.locator('input[formcontrolname="flatRate"]');
    await flat.waitFor({ timeout: 30000 });
    // Landstar's rate box reformats typed digits (typing 1945 left "$1760.02", 2026-11-23), so
    // try a few ways to enter the rate and keep the first one the box really shows.
    const target = Number(rate);
    const shows = async () => moneyValue(await flat.inputValue().catch(() => ''));
    const tried = [];
    const ways = [
      ['typed', async () => {
        await flat.click();
        await flat.press('Control+A');
        await flat.press('Backspace');
        await flat.pressSequentially(String(rate), { delay: 40 });
      }],
      ['cleared then typed with cents', async () => {
        await flat.click({ clickCount: 3 });
        await flat.press('Delete');
        for (let i = 0; i < 12; i += 1) await flat.press('Backspace');
        await flat.pressSequentially(target.toFixed(2), { delay: 40 });
      }],
      ['set directly', async () => {
        await flat.evaluate((el, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          el.focus();
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, target.toFixed(2));
      }]
    ];
    let entered = false;
    for (const [name, enter] of ways) {
      await enter();
      await flat.blur();
      await page.waitForTimeout(500);
      const value = await shows();
      tried.push(`${name}: $${value}`);
      if (Math.abs(value - target) < 0.005) { entered = true; break; }
    }
    if (!entered) {
      // Evidence for fixing this: what the box is and what each way left in it.
      const box = await flat.evaluate(el => [...el.attributes].map(a => `${a.name}="${a.value}"`).join(' ')).catch(() => '');
      const shot = path.join(__dirname, 'logs', `rate-box-${loadId}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      throw new Error(`The rate box for load #${loadId} would not take $${rate} (${tried.join('; ')}); nothing was saved. Box: ${box.slice(0, 400)}. Screenshot: ${shot}`);
    }
    const save = page.getByRole('button', { name: /^\s*save(?:\s+changes)?\s*$/i });
    await save.click({ timeout: 15000 });
    for (let i = 0; i < 30 && saved === null; i += 1) await page.waitForTimeout(500);
    if (saved !== 204) {
      throw new Error(`Landstar did not confirm saving rate for load #${loadId} (${saved === null ? 'no answer; verify before retrying' : `HTTP ${saved}`}).`);
    }
    if (sentBody && !numbersIn(sentBody).some(n => Math.abs(n - Number(rate)) < 0.005)) {
      throw new Error(`Landstar saved load #${loadId} without the new rate $${rate} (sent: ${JSON.stringify(sentBody).slice(0, 300)}).`);
    }
    return true;
  } finally {
    await page.close().catch(() => {});
  }
}

// One full pass. Returns the raises made (or planned, without apply).
// shouldYield: checked before each posting; when it returns true the pass stops early and the
// result is marked yielded (raises already saved stay saved; the next pass picks up the rest).
async function checkHazmatRates(context, { apply = true, log = console.log, shouldYield } = {}) {
  setStatus('logged-in', 'Checking board rates: every hazmat load, plus PARA and RXO');
  const board = await openBoard(context, log);
  const eligible = uploadedSignatures(undefined, undefined, { test: eligibleExport });
  const other = uploadedSignatures(undefined, undefined, { test: name => !eligibleExport(name) });
  const hazmatEligible = uploadedSignatures(undefined, undefined, { test: name => !fixedRateExport(name) });
  const fixedRate = uploadedSignatures(undefined, undefined, { test: fixedRateExport });
  const mine = selectRateWatchPostings(await listPostings(board, OWN_POSTING_CODES, log), eligible, other, hazmatEligible, fixedRate);
  if (!mine.length) {
    log('  No verified PARA or RXO postings to check; unmatched or ambiguous postings are left unchanged.');
    return [];
  }
  const trailerGroup = await getTrailerGroups(board);
  const searches = new Map();
  const raises = [];
  for (const posting of mine) {
    if (shouldYield && shouldYield()) {
      log(`  PARA/RXO rate check paused for new exports after ${raises.length} raise(s); it starts again once they are prepared.`);
      raises.yielded = true;
      return raises;
    }
    const date = boardPickupDate(posting);
    const key = `${posting.OriginState}|${posting.DestinationState}|${date}`;
    if (!searches.has(key)) searches.set(key, await searchBoard(board, posting.OriginState, posting.DestinationState, date));
    const raise = planRaise(posting, findCompetitors(posting, searches.get(key), trailerGroup));
    const lane = `${posting.OriginCityStateForDisplay} -> ${posting.DestinationCityStateForDisplay} ${posting.PickupFromDateForDisplay}`;
    if (!raise) continue;
    log(`  #${raise.loadId} ${lane}${isHazmatPosting(posting) ? ' [HAZMAT]' : ''}: $${raise.from} -> $${raise.to} (${raise.top.Agency} pays $${raise.top.TotalRevenue})`);
    if (apply) {
      // One load that will not save must not stop the rest of the pass (hazmat first).
      try {
        raise.saved = await raisePostingRate(context, raise.loadId, raise.to, log);
        reportRateRaise(rateRaiseReport(posting, raise));
      } catch (error) {
        raise.saved = false;
        raise.error = error.message.split('\n')[0];
        log(`    ! not raised: ${raise.error}`);
      }
    }
    raises.push(raise);
  }
  const saved = raises.filter(r => r.saved).length;
  const failed = raises.filter(r => r.error).length;
  log(`  Rate check (every hazmat load, plus PARA/RXO): ${mine.length} posting(s) (${mine.filter(isHazmatPosting).length} hazmat), ${raises.length} outbid${apply ? `, ${saved} raised${failed ? `, ${failed} could not be saved` : ''}` : ' (report only)'}.`);
  return raises;
}

module.exports = { checkHazmatRates, findCompetitors, planRaise, isHazmatPosting, raisePostingRate, selectRateWatchPostings, eligibleExport, fixedRateExport, rateRaiseReport };

if (require.main === module) {
  const { chromium } = require('playwright');
  (async () => {
    const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
    await checkHazmatRates(context, { apply: process.argv.includes('--apply') });
    await context.close();
  })().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
