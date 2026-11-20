// Read-only: for every unposted Bulk Postings draft, is the same load already posted on the
// board under this computer's posting code? (Same origin/destination ZIP, pickup and delivery
// end, weight - how the bot identifies its postings.) Stop the bot whose browser you borrow.
//   node check-drafts-posted.js <output.json> [--profile=browser-profile-helper]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');
const { listPostings } = require('./dedupe');
const { findMatchingPostings } = require('./unpost');

// "2026-12-02T16:00:00" -> "12/02/26 16:00" (the board's display format).
const boardTime = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)} ${m[4]}:${m[5]}` : '';
};

(async () => {
  const out = process.argv[2];
  const profile = (process.argv.find(arg => arg.startsWith('--profile=')) || '--profile=browser-profile').slice(10);
  const context = await chromium.launchPersistentContext(path.join(__dirname, profile), { headless: false, viewport: null });
  try {
    const board = await openBoard(context, console.log);
    const portal = await context.newPage();
    await portal.goto('https://portal.landstaronline.com/agent/bulk-postings', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await portal.waitForURL(/portal\.landstaronline\.com\/agent\/bulk-postings/, { timeout: 60000 }).catch(() => {});
    await portal.waitForTimeout(6000);
    const drafts = await portal.evaluate(async () => {
      let token = null; let userId = null;
      for (const store of [sessionStorage, localStorage]) {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          if (!/oidc\.user/i.test(key)) continue;
          const user = JSON.parse(store.getItem(key));
          if (user?.access_token) { token = user.access_token; userId = String(user.profile?.ls_unique_id || ''); }
        }
      }
      const response = await fetch('/loadboards/v1/bulkUpload/unpostedDrafts?pageIndex=0&pageSize=200', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ loadStatuses: ['Active'], userId, sortColumn: 'PostingNumber', sortType: 'Desc', lockedInRate: false })
      });
      return (await response.json()).data || [];
    });
    const states = [...new Set(drafts.map(draft => draft.originRegion).filter(Boolean))];
    const postings = await listPostings(board, OWN_POSTING_CODES, console.log, states);
    const report = drafts.map(draft => {
      const posting = {
        originZip: String(draft.originZipCode || '').trim(), destZip: String(draft.destinationZipCode || '').trim(),
        pickupThru: boardTime(draft.pickupEndDateTime), deliveryThru: boardTime(draft.deliveryEndDateTime), weight: draft.weight
      };
      const matches = findMatchingPostings(postings, posting);
      return {
        draftId: draft.draftId, batchId: draft.batchId, customer: draft.customerName,
        lane: `${draft.originLocality}, ${draft.originRegion} -> ${draft.destinationLocality}, ${draft.destinationRegion || draft.destinationCountry}`,
        posting, onBoard: matches.map(load => ({ loadId: load.LoadId, revenue: load.TotalRevenue }))
      };
    });
    fs.writeFileSync(out, JSON.stringify(report, null, 1));
    const posted = report.filter(item => item.onBoard.length).length;
    console.log(`${report.length} drafts: ${posted} already on the board, ${report.length - posted} not posted.`);
  } finally {
    await context.close();
  }
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
