// Keeps your hazmat postings the highest-paying load on their lane.
//
// Several times a day (see upload.js), for every hazmat posting under your own posting
// codes (any customer), the bot searches the Landstar board for other agencies' postings
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
  openBoard, searchBoard, sameCity, getTrailerGroups, boardPickupDate, OWN_POSTING_CODES, OUTBID_BY
} = require('./rate-check');
const { setStatus } = require('./status-server');
const { uploadedSignatures, postingSignature } = require('./bot-postings');

const clean = value => String(value ?? '').trim().toUpperCase();
const isHazmatPosting = load => clean(load.CommodityCode) === 'HAZMAT'
  && clean(load.SourceSystemID) === 'PORTAL'
  && OWN_POSTING_CODES.includes(clean(load.Agency));

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
    && sameZipOrCity(b.OriginZipCode, b.OriginCity, mine.OriginZipCode, mine.OriginCity)
    && sameZipOrCity(b.DestinationZipCode, b.DestinationCity, mine.DestinationZipCode, mine.DestinationCity)
    && (b.TrailerTypes || []).some(t => myGroups.has(trailerGroup(t)))
    && Number(b.TotalRevenue) > 0);
}

// The raise for one posting, or null when it already pays the most on its lane.
function planRaise(mine, competitors, outbidBy = OUTBID_BY) {
  const top = competitors.reduce((best, b) => (!best || Number(b.TotalRevenue) > Number(best.TotalRevenue) ? b : best), null);
  if (!top || Number(top.TotalRevenue) < Number(mine.TotalRevenue)) return null;
  return { loadId: mine.LoadId, from: Number(mine.TotalRevenue), to: Number(top.TotalRevenue) + outbidBy, top };
}

// Changes one posting's flat rate with the portal's Edit form; true when Landstar saved it.
async function raisePostingRate(context, loadId, rate, log) {
  const page = await context.newPage();
  try {
    let saved = null;
    page.on('response', response => {
      if (/\/loadboards\/v1\/availableLoad$/.test(response.url()) && response.request().method() === 'PATCH') {
        saved = response.status();
      }
    });
    await page.goto(`https://portal.landstaronline.com/agent/detail/PORTAL/${loadId}/LRGR`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForURL(/portal\.landstaronline\.com\/agent\/detail/, { timeout: 60000 }).catch(() => {});
    await page.getByRole('button', { name: /^\s*edit\s*$/i }).first().click({ timeout: 30000 });
    const flat = page.locator('input[formcontrolname="flatRate"]');
    await flat.waitFor({ timeout: 30000 });
    await flat.fill(String(rate));
    await flat.blur();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /save changes/i }).click();
    for (let i = 0; i < 30 && saved === null; i += 1) await page.waitForTimeout(500);
    if (saved !== 204) log(`  ! Landstar did not save load #${loadId} (${saved === null ? 'no answer' : `HTTP ${saved}`}).`);
    return saved === 204;
  } finally {
    await page.close().catch(() => {});
  }
}

// One full pass. Returns the raises made (or planned, without apply).
async function checkHazmatRates(context, { apply = true, log = console.log } = {}) {
  setStatus('logged-in', 'Checking hazmat rates on the board');
  const board = await openBoard(context, log);
  // Nolan postings keep their posting rate (or RPP's, set at upload): never raised here.
  const nolan = uploadedSignatures(undefined, undefined, /^Landstar_Bulk_Nolan_965974/i);
  const mine = (await listPostings(board, OWN_POSTING_CODES, log)).filter(isHazmatPosting)
    .filter(posting => !nolan.has(postingSignature(posting)));
  if (!mine.length) {
    log('  No hazmat postings to check.');
    return [];
  }
  const trailerGroup = await getTrailerGroups(board);
  const searches = new Map();
  const raises = [];
  for (const posting of mine) {
    const date = boardPickupDate(posting);
    const key = `${posting.OriginState}|${posting.DestinationState}|${date}`;
    if (!searches.has(key)) searches.set(key, await searchBoard(board, posting.OriginState, posting.DestinationState, date));
    const raise = planRaise(posting, findCompetitors(posting, searches.get(key), trailerGroup));
    const lane = `${posting.OriginCityStateForDisplay} -> ${posting.DestinationCityStateForDisplay} ${posting.PickupFromDateForDisplay}`;
    if (!raise) continue;
    log(`  #${raise.loadId} ${lane}: $${raise.from} -> $${raise.to} (${raise.top.Agency} pays $${raise.top.TotalRevenue})`);
    if (apply) raise.saved = await raisePostingRate(context, raise.loadId, raise.to, log);
    raises.push(raise);
  }
  const saved = raises.filter(r => r.saved).length;
  log(`  Hazmat rate check: ${mine.length} posting(s), ${raises.length} outbid${apply ? `, ${saved} raised` : ' (report only)'}.`);
  return raises;
}

module.exports = { checkHazmatRates, findCompetitors, planRaise, isHazmatPosting };

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
