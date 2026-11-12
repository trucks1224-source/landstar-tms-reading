// Explicit manual operation only. Never called by an automatic worker.
process.env.BOT_NO_STATUS = '1';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');
const { listPostings, cancelPostings } = require('./dedupe');

async function main() {
  if (!process.argv.includes('--confirm-all-own-postings')) {
    throw new Error('Requires --confirm-all-own-postings. This removes ALL available postings under your own configured posting codes, including protected/manual postings.');
  }
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'automation-policy.json'), 'utf8'));
  if (policy.automaticPostingEnabled !== false) throw new Error('Pause automatic posting before taking down all postings.');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), {
    headless: false, viewport: null, args: ['--start-maximized']
  });
  try {
    const board = await openBoard(context);
    console.log(`Scanning AVAILABLE postings only, posting codes: ${OWN_POSTING_CODES.join(', ')}.`);
    const before = await listPostings(board, OWN_POSTING_CODES, console.log);
    const ids = [...new Set(before.map(load => load.LoadId))];
    console.log(`Found ${ids.length} available posting(s) to take down.`);
    if (ids.length) {
      const removed = await cancelPostings(board, ids, console.log, { confirmedAllOwnAvailable: true });
      console.log(`Cancellation accepted for ${removed} posting(s).`);
    }
    const verify = await openBoard(context);
    const after = await listPostings(verify, OWN_POSTING_CODES, console.log);
    console.log(`VERIFIED remaining available postings: ${new Set(after.map(load => String(load.LoadId))).size}`);
    if (after.length) throw new Error('Some available postings remain. Automatic posting stays paused.');
    console.log('All own available postings are down. Automatic posting remains paused. Saved TMS loads and booked shipments were not edited.');
  } finally {
    await context.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
