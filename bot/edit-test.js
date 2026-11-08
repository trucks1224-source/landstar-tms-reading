// One-off check of Landstar's Edit form: opens a posting, saves it with the given flat
// rate and records the request the portal sends. Stop the bot first.
//   node edit-test.js <loadId> <rate> <output-folder>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { openBoard } = require('./rate-check');

(async () => {
  const [loadId, rate, out] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: { width: 1600, height: 1000 } });
  await openBoard(browser, console.log);
  const page = await browser.newPage();
  const log = [];
  page.on('request', request => {
    if (/loadboards\/v1\/availableLoad(\?|$|s\/duplicateCheck)/.test(request.url()) && request.method() !== 'GET') {
      log.push({ method: request.method(), url: request.url(), body: request.postData() });
    }
  });
  page.on('response', async response => {
    if (/loadboards\/v1\/availableLoad(\?|$|s\/duplicateCheck)/.test(response.url()) && response.request().method() !== 'GET') {
      log.push({ response: response.status(), url: response.url(), body: await response.text().catch(() => '') });
    }
  });
  await page.goto(`https://portal.landstaronline.com/agent/detail/PORTAL/${loadId}/LRGR`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL(/portal\.landstaronline\.com\/agent\/detail/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(out, '1-detail.png') });
  await page.getByRole('button', { name: /edit/i }).first().click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(out, '2-edit.png'), fullPage: true });
  const fields = await page.$$eval('[formcontrolname]', els => els.map(e => ({
    name: e.getAttribute('formcontrolname'), tag: e.tagName, type: e.type, value: e.value
  })));
  fs.writeFileSync(path.join(out, 'fields.json'), JSON.stringify(fields, null, 1));
  const flat = page.locator('input[formcontrolname="flatRate"]');
  if (!(await flat.count())) throw new Error('No flat rate field on the edit form (see fields.json).');
  await flat.fill(String(rate));
  await flat.blur();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(out, '3-filled.png'), fullPage: true });
  const buttons = await page.locator('button').allInnerTexts();
  fs.writeFileSync(path.join(out, 'buttons.json'), JSON.stringify(buttons));
  const submit = page.getByRole('button', { name: /^(post|update|save|submit)/i }).last();
  await submit.click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(out, '4-after.png'), fullPage: true });
  fs.writeFileSync(path.join(out, 'requests.json'), JSON.stringify(log, null, 1));
  console.log(`Captured ${log.length} request/response entries.`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
