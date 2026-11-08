// Read-only: opens Landstar Clarity's freight list and one freight bill page, and saves the
// data calls the pages make (to learn where the tracking link, stops and ETAs come from).
// Clicks nothing that changes anything. Stop the bot first: this uses its browser profile.
//   node explore-clarity.js <freightBill> <output.json>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { openBoard } = require('./rate-check');

(async () => {
  const [freightBill, out] = process.argv.slice(2);
  if (!freightBill || !out) throw new Error('Usage: node explore-clarity.js <freightBill> <output.json>');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  await openBoard(context, console.log); // signs in to Landstar (Clarity uses the same sign-in)
  const page = await context.newPage();
  const calls = [];
  page.on('response', async response => {
    const request = response.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return;
    const url = response.url();
    if (/google|clarity\.ms|launchdarkly|sentry|applicationinsights|analytics/i.test(url) && !/landstaronline/.test(url)) return;
    let body = '';
    try { body = (await response.text()).slice(0, 20000); } catch { /* streamed */ }
    calls.push({ page: page.url(), method: request.method(), url, status: response.status(), requestBody: (request.postData() || '').slice(0, 3000), body });
  });
  await page.goto('https://clarity.landstaronline.com/freight/list', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  await page.goto(`https://clarity.landstaronline.com/freight/${freightBill}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  // The tracking-link box as shown on the page (read only).
  const shareBox = await page.locator('input[value*="clarity.landstaronline"], a[href*="clarity.landstaronline"]').first()
    .evaluate(el => el.value || el.href).catch(() => '');
  fs.writeFileSync(out, JSON.stringify({ shareBox, calls }, null, 1));
  console.log(`Saved ${calls.length} calls to ${out}. Nothing was changed.`);
  await context.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
