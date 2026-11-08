// Read-only: opens (then cancels) MercuryGate's Special Instructions, Handoff to CorpAdmin ->
// Add Document, and References -> Add Reference windows for one load, saving their HTML and
// screenshots. Nothing is saved in MercuryGate. Stop the bot first (uses its browser profile).
//   node explore-mercurygate-forms2.js <freightBill> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { openMercuryGate, openLoadWindow } = require('./mercurygate');

(async () => {
  const [freightBill, outDir] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const log = [];
  const save = async (p, name) => {
    await p.screenshot({ path: path.join(outDir, `${name}.png`) }).catch(() => {});
    const parts = [];
    for (const frame of p.frames()) parts.push(`<!-- FRAME ${frame.url()} -->\n${await frame.content().catch(() => '')}`);
    fs.writeFileSync(path.join(outDir, `${name}.html`), parts.join('\n\n'));
    log.push(`saved ${name}`);
  };
  // ExtJS buttons are <a class="x-btn"> with the label inside.
  const clickButton = async (p, label) => {
    for (const frame of p.frames()) {
      const button = frame.locator('a.x-btn, button, input[type=button]').filter({ hasText: label }).last();
      if (await button.isVisible().catch(() => false)) { await button.click().catch(() => {}); await p.waitForTimeout(2000); return true; }
    }
    return false;
  };
  const page = context.pages()[0] || await context.newPage();
  await openMercuryGate(page, line => log.push(line));
  const search = page.locator('input[placeholder="Search..."]').first();
  await search.fill(freightBill);
  await search.press('Enter');
  await page.getByText(/FREIGHT BILL NUMBER/i).first().waitFor({ state: 'visible', timeout: 45000 });
  await page.waitForTimeout(3000);

  // Special Instructions (route level, like Daniel's list icon).
  const special = page.locator('[title="Add Special Instructions"], [title*="Special Instructions"]').first();
  if (await special.isVisible().catch(() => false)) {
    await special.click();
    await page.waitForTimeout(5000);
    await save(page, 'g-special-instructions');
    log.push(`cancel special: ${await clickButton(page, /^\s*Cancel\s*$/) || await clickButton(page, /Close/)}`);
    await page.keyboard.press('Escape').catch(() => {});
  } else log.push('special instructions icon not visible');

  // Handoff to CorpAdmin -> Documents -> add document icon -> Add Document (cancel), then close.
  const handoff = page.locator('[title="Handoff to CorpAdmin"]').first();
  if (await handoff.isVisible().catch(() => false)) {
    await handoff.click();
    await page.waitForTimeout(12000);
    await save(page, 'h-handoff');
    let added = false;
    for (const frame of page.frames()) {
      const docs = frame.getByText(/^\s*Documents\s*$/).first();
      if (!(await docs.isVisible().catch(() => false))) continue;
      const box = await docs.boundingBox();
      // The add-document icon sits right under the "Documents" label.
      if (box) { await page.mouse.click(box.x + 6, box.y + box.height + 12); added = true; }
      break;
    }
    await page.waitForTimeout(5000);
    if (added) await save(page, 'i-add-document');
    log.push(`cancel add document: ${await clickButton(page, /^\s*Cancel\s*$/)}`);
    log.push(`close handoff: ${await clickButton(page, /^\s*Close\s*$/)}`);
  } else log.push('handoff not visible');

  // References -> + Reference (cancel).
  await page.keyboard.press('Escape').catch(() => {});
  const loadPage = await openLoadWindow(context, page, freightBill);
  await loadPage.waitForTimeout(12000);
  const refsNav = loadPage.locator('.details-menu-item').filter({ hasText: /^\s*References\s*$/ }).first();
  if (await refsNav.isVisible().catch(() => false)) {
    await refsNav.click();
    await loadPage.waitForTimeout(5000);
    const addRef = loadPage.locator('.mg-link').filter({ hasText: /^\s*Reference\s*$/ }).first();
    if (await addRef.isVisible().catch(() => false)) {
      await addRef.click();
      await loadPage.waitForTimeout(5000);
      await save(loadPage, 'j-add-reference');
      log.push(`cancel reference: ${await clickButton(loadPage, /^\s*Cancel\s*$/)}`);
    } else { log.push('+ Reference not visible'); await save(loadPage, 'j-references-page'); }
  } else log.push('References menu not visible');

  fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'));
  console.log(log.join('\n'));
  console.log('Nothing was saved in MercuryGate.');
  await context.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
