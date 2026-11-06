// Read-only: saves Landstar's details (including error reasons) for every unposted
// bulk-upload draft. Stop the bot first.
//   node read-error-details.js <output.json>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { openBoard } = require('./rate-check');

(async () => {
  const out = process.argv[2];
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  await openBoard(browser, console.log);
  const page = await browser.newPage();
  await page.goto('https://portal.landstaronline.com/agent/bulk-postings', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL(/portal\.landstaronline\.com\/agent\/bulk-postings/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);
  const result = await page.evaluate(async () => {
    let token = null;
    let userId = null;
    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (!/oidc\.user/i.test(key)) continue;
        try {
          const user = JSON.parse(store.getItem(key));
          token = user.access_token;
          userId = String(user.profile?.ls_unique_id || '');
        } catch { /* keep looking */ }
      }
    }
    if (!token) return { error: 'no sign-in token' };
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const list = await (await fetch('/loadboards/v1/bulkUpload/unpostedDrafts?pageIndex=0&pageSize=200', {
      method: 'POST', headers,
      body: JSON.stringify({ loadStatuses: ['Active'], userId, sortColumn: 'PostingNumber', sortType: 'Desc', lockedInRate: false })
    })).json();
    const drafts = list.data || [];
    const details = [];
    for (const draft of drafts) {
      const response = await fetch(`/loadboards/v1/bulkUpload/batch/${draft.batchId}/draft/${draft.draftId}/details`, { headers });
      details.push({ batchId: draft.batchId, draftId: draft.draftId, status: response.status, body: await response.text() });
    }
    return { count: drafts.length, details };
  });
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
  console.log(result.error || `Saved details for ${result.count} drafts.`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
