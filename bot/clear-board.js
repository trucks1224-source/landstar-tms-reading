// Removes every bulk-uploaded posting under your own posting codes (ANQ), then checks
// the board again. Hand-posted loads are left alone. Stop the bot first: this uses
// its browser profile.
//   node clear-board.js
const { chromium } = require('playwright');
const path = require('path');
const { listPostings, cancelPostings } = require('./dedupe');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');

const bulkOnly = postings => postings.filter(load => String(load.SourceSystemID || '').toUpperCase() === 'PORTAL');

(async () => {
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const page = await openBoard(browser, console.log);
  const before = await listPostings(page, OWN_POSTING_CODES, console.log);
  const ids = [...new Set(bulkOnly(before).map(load => load.LoadId))];
  console.log(`Found ${before.length} postings under ${OWN_POSTING_CODES.join(', ')}; ${ids.length} bulk-uploaded.`);
  const removed = ids.length ? await cancelPostings(page, ids, console.log) : 0;
  console.log(`Removed ${removed} of ${ids.length}.`);
  const after = await listPostings(page, OWN_POSTING_CODES, console.log);
  console.log(`Left on the board: ${bulkOnly(after).length} bulk-uploaded, ${after.length - bulkOnly(after).length} hand-posted.`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
