// Read-only: opens Landstar's Assign Capacity page for a posting, types a truck number
// into the BCO search, and saves the network calls and page structure. Never clicks Assign.
// Stop the bot first: this uses its browser profile.
//   node explore-assign.js <loadId> <truckNumber> <output.json>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { openBoard } = require('./rate-check');

(async () => {
  const [loadId, truck, out] = process.argv.slice(2);
  if (!loadId || !truck || !out) throw new Error('Usage: node explore-assign.js <loadId> <truckNumber> <output.json>');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  await openBoard(context, console.log);
  const page = await context.newPage();
  const calls = [];
  const scripts = [];
  page.on('response', async response => {
    const request = response.request();
    const url = response.url();
    if (request.resourceType() === 'script' && /portal\.landstaronline\.com/.test(url)) scripts.push(url);
    if (!['xhr', 'fetch'].includes(request.resourceType())) return;
    let body = '';
    try { body = (await response.text()).slice(0, 4000); } catch { /* streamed */ }
    calls.push({ method: request.method(), url, status: response.status(), requestBody: (request.postData() || '').slice(0, 2000), body });
  });
  await page.goto(`https://portal.landstaronline.com/agent/assign-capacity/PORTAL/${loadId}/LRGR`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  const before = calls.length;
  const search = page.locator('input[placeholder*="Owner Name"], input[placeholder*="Tractor"]').first();
  await search.click();
  await search.pressSequentially(truck, { delay: 120 });
  await page.waitForTimeout(6000);
  const html = await page.content();
  const bundles = [];
  for (const url of scripts) {
    try {
      const text = await (await page.request.get(url)).text();
      const hits = [...new Set(text.match(/["'`][^"'`]{0,80}(assign|capacity|bco|tractor)[^"'`]{0,80}["'`]/gi) || [])].slice(0, 300);
      bundles.push({ url, hits });
    } catch { /* skip */ }
  }
  fs.writeFileSync(out, JSON.stringify({ callsBeforeTyping: before, calls, bundles, html }, null, 1));
  console.log(`Saved ${calls.length} calls (${calls.length - before} after typing) to ${out}. Assign was NOT clicked.`);
  await context.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
