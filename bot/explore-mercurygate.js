// Read-only: opens Landstar's MercuryGate TMS in the bot's browser, the "Booked by anq" list
// and one load, and saves what the pages show and the data calls they make (to learn how to
// fill in stops and references). Saves nothing in MercuryGate; edit windows are cancelled.
// Stop the bot first: this uses its browser profile.
//   node explore-mercurygate.js <freightBill> <output.json>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MG = 'https://landstar.mercurygate.net/MercuryGate/dashboard/wide/dashboardFrameless.jsp#/routeList';

(async () => {
  const [freightBill, out] = process.argv.slice(2);
  if (!freightBill || !out) throw new Error('Usage: node explore-mercurygate.js <freightBill> <output.json>');
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const calls = [];
  const shots = [];
  const watch = page => page.on('response', async response => {
    const request = response.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return;
    const url = response.url();
    if (!/mercurygate/i.test(url)) return;
    let body = '';
    try { body = (await response.text()).slice(0, 6000); } catch { /* streamed */ }
    calls.push({ page: page.url(), method: request.method(), url, status: response.status(), requestBody: (request.postData() || '').slice(0, 2000), body });
  });
  context.on('page', watch);
  const page = context.pages()[0] || await context.newPage();
  watch(page);
  const snap = async (p, name) => {
    const file = path.join(path.dirname(out), `mg-${name}.png`);
    await p.screenshot({ path: file }).catch(() => {});
    shots.push({ name, url: p.url(), file, text: (await p.locator('body').innerText().catch(() => '')).slice(0, 4000) });
  };
  await page.goto(MG, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  // Login page: use Single Sign-on (the bot's Landstar sign-in); never types a password.
  const sso = page.getByText('Single Sign-on', { exact: false }).first();
  if (/login/i.test(page.url()) && await sso.isVisible().catch(() => false)) {
    await sso.click();
    await page.waitForTimeout(15000);
    if (!/routeList|dashboard/i.test(page.url())) {
      await page.goto(MG, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(12000);
    }
  }
  await snap(page, '1-start');
  const signedIn = /routeList|dashboard/i.test(page.url()) && !/login|signin|identity/i.test(page.url());
  if (signedIn) {
    // Search the freight bill in the top search box (read-only).
    const search = page.locator('input[placeholder="Search..."]').first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill(freightBill);
      await search.press('Enter');
      await page.waitForTimeout(10000);
      await snap(page, '2-search');
      // Open the execution load (EL) like Daniel does: it opens in its own window.
      const elLink = page.getByText(/^\s*EL\d{6,}\s*$/).first();
      if (await elLink.isVisible().catch(() => false)) {
        const [popup] = await Promise.all([
          context.waitForEvent('page', { timeout: 30000 }).catch(() => null),
          elLink.click()
        ]);
        const loadPage = popup || page;
        await loadPage.waitForLoadState('domcontentloaded').catch(() => {});
        await loadPage.waitForTimeout(15000);
        await snap(loadPage, '3-load');
        // The stop blocks (Pickup / Drop) and their edit pencils, as HTML, to learn the selectors.
        const stops = await loadPage.evaluate(() => {
          const found = [...document.querySelectorAll('*')].filter(el => /^(Pickup|Drop)$/.test((el.textContent || '').trim()) && el.children.length === 0);
          return found.slice(0, 4).map(el => {
            let box = el;
            for (let i = 0; i < 6 && box.parentElement; i++) box = box.parentElement;
            return box.outerHTML.replace(/\s+/g, ' ').slice(0, 6000);
          });
        });
        fs.writeFileSync(path.join(path.dirname(out), 'mg-stops.html'), stops.join('\n\n<!-- next -->\n\n'));
        const nav = await loadPage.evaluate(() => [...document.querySelectorAll('a, button, [role=button]')]
          .map(el => `${el.tagName} ${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)} | ${el.className}`.slice(0, 160))
          .filter(line => /Reference|Plan|Edit|Save|Cancel/i.test(line)).slice(0, 60));
        fs.writeFileSync(path.join(path.dirname(out), 'mg-nav.txt'), nav.join('\n'));
      }
    }
  }
  fs.writeFileSync(out, JSON.stringify({ signedIn, url: page.url(), shots, calls }, null, 1));
  console.log(`Signed in: ${signedIn}. Saved ${calls.length} calls and ${shots.length} screenshots. Nothing was changed.`);
  await context.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
