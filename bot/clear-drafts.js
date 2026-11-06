// Deletes every unposted (error) draft on Landstar's Bulk Postings page by selecting all
// rows and using the page's own Delete button. Without --apply it only reports what it sees.
// Stop the bot first.
//   node clear-drafts.js <screenshot-folder> [--apply]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { openBoard } = require('./rate-check');

const URL = 'https://portal.landstaronline.com/agent/bulk-postings';

async function errorCount(page) {
  const text = await page.locator('body').innerText().catch(() => '');
  const match = text.match(/(\d+)\s+Errors?\s*\|/i);
  return match ? Number(match[1]) : (/no errors|0 errors/i.test(text) ? 0 : null);
}

(async () => {
  const out = process.argv[2];
  const apply = process.argv.includes('--apply');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: { width: 1600, height: 1000 } });
  await openBoard(browser, console.log);
  const page = await browser.newPage();
  page.on('dialog', dialog => dialog.accept().catch(() => {}));
  await page.goto(URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(10000);
  console.log(`Errors shown: ${await errorCount(page)}`);
  await page.screenshot({ path: path.join(out, '1-before.png') });
  const checkboxes = page.locator('input[type="checkbox"]');
  console.log(`Checkboxes: ${await checkboxes.count()}`);
  const buttons = await page.locator('button').allInnerTexts();
  console.log(`Buttons: ${JSON.stringify(buttons.map(b => b.trim()).filter(Boolean))}`);
  if (!apply) { await browser.close(); return; }

  for (let round = 0; round < 10; round += 1) {
    const before = await errorCount(page);
    if (!before) break;
    // Select every row shown, then use the page's Delete action.
    const boxes = await checkboxes.all();
    for (const box of boxes) await box.check({ force: true }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(out, `2-selected-${round}.png`) });
    const del = page.getByRole('button', { name: /delete/i }).first();
    if (!(await del.count())) { console.log('No Delete button after selecting rows.'); break; }
    await del.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, `3-confirm-${round}.png`) });
    const confirm = page.getByRole('button', { name: /^(delete|yes|confirm|ok)/i }).last();
    if (await confirm.count()) await confirm.click().catch(() => {});
    await page.waitForTimeout(6000);
    await page.goto(URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(8000);
    const after = await errorCount(page);
    console.log(`Round ${round + 1}: ${before} -> ${after}`);
    if (after === before) break;
  }
  await page.screenshot({ path: path.join(out, '4-after.png') });
  console.log(`Errors left: ${await errorCount(page)}`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
