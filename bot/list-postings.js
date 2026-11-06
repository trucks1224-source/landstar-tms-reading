// Read-only: saves every bulk-uploaded posting under your own codes to a JSON file.
// Uses the bot's browser profile (its Landstar sign-in), so stop the bot first. Removes nothing.
//   node list-postings.js <output.json>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { listPostings } = require('./dedupe');
const { OWN_POSTING_CODES, openBoard } = require('./rate-check');

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: node list-postings.js <output.json>');
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const page = await openBoard(browser, console.log);
  const postings = await listPostings(page, OWN_POSTING_CODES, console.log);
  fs.writeFileSync(out, JSON.stringify(postings));
  console.log(`Saved ${postings.length} postings.`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
