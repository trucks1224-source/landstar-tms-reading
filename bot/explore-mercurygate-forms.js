// Read-only: opens MercuryGate's edit windows for one load (stop editor, Add Reference,
// Special Instructions, Handoff to CorpAdmin -> Add Document) and saves the full page HTML
// and screenshots, then closes each with Cancel / X. Nothing is saved in MercuryGate.
// Stop the bot first: this uses its browser profile.
//   node explore-mercurygate-forms.js <freightBill> <stopName> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MG = 'https://landstar.mercurygate.net/MercuryGate/dashboard/wide/dashboardFrameless.jsp#/routeList';

(async () => {
  const [freightBill, stopName, outDir] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const log = [];
  const save = async (p, name) => {
    await p.screenshot({ path: path.join(outDir, `${name}.png`) }).catch(() => {});
    const parts = [];
    for (const frame of p.frames()) {
      const html = await frame.content().catch(() => '');
      parts.push(`<!-- FRAME ${frame.url()} -->\n${html}`);
    }
    fs.writeFileSync(path.join(outDir, `${name}.html`), parts.join('\n\n'));
    log.push(`saved ${name} (${p.frames().length} frames)`);
  };
  const clickCancel = async p => {
    for (const frame of p.frames()) {
      for (const name of [/^\s*cancel\s*$/i, /^\s*close\s*$/i]) {
        const button = frame.getByRole('button', { name }).first();
        if (await button.isVisible().catch(() => false)) { await button.click().catch(() => {}); await p.waitForTimeout(1500); return true; }
        const text = frame.getByText(name).first();
        if (await text.isVisible().catch(() => false)) { await text.click().catch(() => {}); await p.waitForTimeout(1500); return true; }
      }
    }
    return false;
  };

  const { openMercuryGate } = require('./mercurygate'); // eslint-disable-line
  const page = context.pages()[0] || await context.newPage();
  await openMercuryGate(page, line => log.push(line));
  const { openLoadWindow } = require('./mercurygate');
  const loadPage = await openLoadWindow(context, page, freightBill);
  await save(page, 'a-results');
  await loadPage.waitForLoadState('domcontentloaded');
  await loadPage.waitForTimeout(15000);
  // Scroll everything that scrolls, so the Plan stops render.
  for (let i = 0; i < 6; i++) {
    await loadPage.mouse.move(600, 600);
    await loadPage.mouse.wheel(0, 1500);
    await loadPage.waitForTimeout(1500);
  }
  await save(loadPage, 'b-plan-full');

  // Stop editor: the pencil next to the stop's location name.
  const nameCell = loadPage.getByText(stopName, { exact: false }).first();
  if (await nameCell.isVisible().catch(() => false)) {
    await nameCell.scrollIntoViewIfNeeded().catch(() => {});
    const box = await nameCell.boundingBox();
    log.push(`stop name box ${JSON.stringify(box)}`);
    // The pencil sits just left of the name.
    if (box) {
      await loadPage.mouse.click(box.x - 10, box.y + box.height / 2);
      await loadPage.waitForTimeout(6000);
      await save(loadPage, 'c-stop-editor');
      log.push(`cancel: ${await clickCancel(loadPage)}`);
    }
  } else log.push('stop name not visible');

  // References -> + Reference.
  const refsNav = loadPage.getByText(/^\s*References\s*$/).first();
  if (await refsNav.isVisible().catch(() => false)) {
    await refsNav.click();
    await loadPage.waitForTimeout(5000);
    await save(loadPage, 'd-references');
    const addRef = loadPage.locator('text=/^\\s*Reference\\s*$/').last();
    if (await addRef.isVisible().catch(() => false)) {
      await addRef.click();
      await loadPage.waitForTimeout(5000);
      await save(loadPage, 'e-add-reference');
      log.push(`cancel: ${await clickCancel(loadPage)}`);
    } else log.push('+ Reference not visible');
  } else log.push('References nav not visible');
  await loadPage.close().catch(() => {});

  // Handoff to CorpAdmin -> Documents add icon -> Add Document (cancelled; window closed).
  const handoff = page.getByText(/Handoff to CorpAdmin/).first();
  if (await handoff.isVisible().catch(() => false)) {
    await handoff.click();
    await page.waitForTimeout(12000);
    await save(page, 'f-handoff');
  } else log.push('Handoff link not visible');

  fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'));
  console.log(log.join('\n'));
  console.log('Nothing was saved in MercuryGate.');
  await context.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
