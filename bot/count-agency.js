// Read-only: lists the board postings of one agency code and which of your postings
// duplicate them (same pickup day and lane). Stop the bot first.
//   node count-agency.js ATZ <output.json>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { listPostings } = require('./dedupe');
const { openBoard, OWN_POSTING_CODES, sameCity, boardPickupDate } = require('./rate-check');

(async () => {
  const [agency, out] = process.argv.slice(2);
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const page = await openBoard(browser, console.log);
  const theirs = await listPostings(page, [agency.toUpperCase()], console.log);
  const mine = await listPostings(page, OWN_POSTING_CODES, console.log);
  const same = (a, b) => boardPickupDate(a) === boardPickupDate(b)
    && a.OriginState === b.OriginState && a.DestinationState === b.DestinationState
    && (a.OriginZipCode === b.OriginZipCode || sameCity(a.OriginCity, b.OriginCity))
    && (a.DestinationZipCode === b.DestinationZipCode || sameCity(a.DestinationCity, b.DestinationCity));
  const overlaps = mine.filter(m => theirs.some(t => same(t, m)))
    .map(m => ({ loadId: m.LoadId, lane: `${m.OriginCityStateForDisplay} -> ${m.DestinationCityStateForDisplay}`, pickup: m.PickupFromDateForDisplay, rate: m.TotalRevenue }));
  fs.writeFileSync(out, JSON.stringify({ agency, theirs: theirs.length, mine: mine.length, overlaps }, null, 1));
  console.log(`${agency}: ${theirs.length} postings; yours: ${mine.length}; yours that duplicate a ${agency} posting: ${overlaps.length}`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
