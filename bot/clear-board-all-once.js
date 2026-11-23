// One-time full clear (2026-11-16, Daniel's request): removes EVERY posting under your
// own posting codes (ANQ) — bot-uploaded and hand-posted alike. Stop the bot first:
// this uses its browser profile.
//   node clear-board-all-once.js
const { chromium } = require('playwright');
const path = require('path');
const { listPostings, cancelPostings } = require('./dedupe');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');

(async () => {
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const page = await openBoard(browser, console.log);
  const before = await listPostings(page, OWN_POSTING_CODES, console.log);
  const ids = [...new Set(before.map(load => load.LoadId))];
  console.log(`Found ${before.length} postings under ${OWN_POSTING_CODES.join(', ')}.`);
  const removed = ids.length ? await cancelPostings(page, ids, console.log, { confirmedAllOwnAvailable: true }) : 0;
  console.log(`Removed ${removed} of ${ids.length}.`);
  const after = await listPostings(page, OWN_POSTING_CODES, console.log);
  console.log(`Left on the board: ${after.length}.`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
