// Removes the Landstar postings listed in a JSON file ([{ loadId }, ...]).
// Uses the bot's browser profile, so stop the bot first.
//   node remove-postings.js <plan.json>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { cancelPostings, listPostings } = require('./dedupe');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node remove-postings.js <plan.json>');
  const ids = [...new Set(JSON.parse(fs.readFileSync(file, 'utf8')).map(item => Number(item.loadId)).filter(Boolean))];
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const page = await openBoard(browser, console.log);
  // Read the board first: removals only go through for postings the bot uploaded.
  await listPostings(page, OWN_POSTING_CODES, console.log);
  console.log(`Removing ${ids.length} postings...`);
  const removed = await cancelPostings(page, ids, console.log);
  console.log(`Removed ${removed} of ${ids.length} postings.`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
