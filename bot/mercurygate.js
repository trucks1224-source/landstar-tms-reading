// Landstar's MercuryGate TMS (landstar.mercurygate.net) for booked Paramount loads, the way
// Daniel does it by hand:
//   1. Customer Reference Number = Paramount order #     (load window -> References -> + Reference)
//   2. Pickup and drop stops from the rate confirmation  (Plan -> pencil by the stop -> Edit Stop)
//   3. Special Instructions (tracking notice)             (search results -> Add Special Instructions)
//   4. After pickup: the rate confirmation PDF as a "Customer Confirmation Sheet"
//                                                         (Handoff to CorpAdmin -> Documents -> add)
// Every step can run as practice (dryRun): it fills the form, takes a screenshot and clicks
// Cancel, so Daniel can check the first few before anything is saved.
// Signing in uses Landstar Online's own TMS link (single sign-on); it never types a password.

const path = require('path');
const fs = require('fs');

const MG_HOME = 'https://landstar.mercurygate.net/MercuryGate/dashboard/wide/dashboardFrameless.jsp#/routeList';
// The link behind Landstar Online's More Items -> TMS -> TMS: signs in with the Landstar
// Online session (no MercuryGate login page), the way Daniel opens it.
const MG_SSO = 'https://landstar.mercurygate.net/MercuryGate/web/sso/login';
const SEARCH_BOX = 'input[placeholder="Search..."]';
const SHOTS_DIR = path.join(__dirname, 'mercurygate-shots');

// Opens the route board through Landstar's single sign-on link (the bot must be signed in to
// Landstar Online). Throws when it still isn't signed in after ~2 minutes.
async function openMercuryGate(page, log = () => {}) {
  const deadline = Date.now() + 120000;
  let triedSso = 0;
  // A background tab doesn't finish drawing MercuryGate's results: keep this one in front.
  await page.bringToFront().catch(() => {});
  await page.goto(MG_SSO, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL(/dashboard/i, { timeout: 60000 }).catch(() => {});
  if (/dashboard/i.test(page.url()) && !/routeList/i.test(page.url())) {
    await page.goto(MG_HOME, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  while (Date.now() < deadline) {
    if (await page.locator(SEARCH_BOX).first().isVisible().catch(() => false)) return page;
    if (/\/login\//i.test(page.url())) {
      const sso = page.getByText('Single Sign-on', { exact: false }).first();
      if (triedSso < 3 && await sso.isVisible().catch(() => false)) {
        triedSso += 1;
        log('  MercuryGate: signing in with Single Sign-on...');
        await sso.click().catch(() => {});
        await page.waitForURL(/dashboard/i, { timeout: 45000 }).catch(() => {});
        if (/dashboard/i.test(page.url()) && !/routeList/i.test(page.url())) await page.goto(MG_HOME, { waitUntil: 'domcontentloaded' }).catch(() => {});
        continue;
      }
    }
    await page.waitForTimeout(2000);
  }
  throw new Error('MercuryGate is not signed in (is the bot signed in to Landstar Online?).');
}

// MercuryGate's id for the load (the "route"), from the search box: its search asks the server
// for matching loads (POST /rest/routes/) and the answer carries the route oid. The result
// cards on screen can stay gray for a long time, so they aren't waited for.
async function findRouteOid(page, freightBill) {
  await page.bringToFront().catch(() => {});
  for (let attempt = 1; attempt <= 3; attempt++) {
    const search = page.locator(SEARCH_BOX).first();
    const answer = page.waitForResponse(response => /\/rest\/routes\/?$/.test(new URL(response.url()).pathname)
      && response.request().method() === 'POST' && /anyRef/.test(response.request().postData() || ''), { timeout: 45000 }).catch(() => null);
    await search.click({ clickCount: 3 });
    await search.fill(String(freightBill));
    await search.press('Enter');
    const response = await answer;
    const routes = response ? await response.json().catch(() => []) : [];
    const route = (Array.isArray(routes) ? routes : []).find(item => item?.oid > 0);
    await page.locator('.icon-close').filter({ visible: true }).first().click().catch(() => {});
    if (route) return String(route.oid);
    await page.waitForTimeout(3000);
  }
  throw new Error(`MercuryGate found no load for freight bill ${freightBill}.`);
}

// Opens the load window directly (what Landstar Online's "SEE IN TMS" button opens).
async function openLoadWindow(context, page, freightBill) {
  const oid = await findRouteOid(page, freightBill);
  const loadPage = await context.newPage();
  await loadPage.bringToFront().catch(() => {});
  await loadPage.goto(`https://landstar.mercurygate.net/MercuryGate/mgreact/reactMultiWindowController.jsp#/${oid}`, { waitUntil: 'domcontentloaded' });
  await loadPage.locator('.event-details-panel').first().waitFor({ state: 'attached', timeout: 60000 }).catch(() => {});
  await loadPage.waitForTimeout(5000);
  return loadPage;
}

// ---------- ExtJS form helpers (MercuryGate's edit windows) ----------
async function visible(locator) {
  return locator.isVisible().catch(() => false);
}

// Clicks an ExtJS button (<a class="x-btn">) by its label in any frame of the page.
async function clickExtButton(page, label) {
  for (const frame of page.frames()) {
    const candidates = [
      frame.locator('a.x-btn >> visible=true, button >> visible=true').filter({ hasText: label }).last(),
      frame.locator('.x-btn-inner >> visible=true').filter({ hasText: label }).last(),
      frame.getByText(label).filter({ visible: true }).last()
    ];
    for (const button of candidates) {
      if (!(await visible(button))) continue;
      await button.click({ force: true }).catch(() => {});
      await page.waitForTimeout(2000);
      // MercuryGate dims the page while a window is open; wait for that to clear.
      await page.locator('.mg-form-overlay-mask').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

// The frame (or page) showing an element that matches (hidden copies don't count).
async function frameWith(page, selector) {
  for (const frame of page.frames()) {
    if (await visible(frame.locator(`${selector} >> visible=true`).first())) return frame;
  }
  return null;
}

// When a MercuryGate window doesn't look as expected: a screenshot and the page's HTML.
async function saveDebug(page, name) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS_DIR, `debug-${name}.png`) }).catch(() => {});
  const parts = [];
  for (const frame of page.frames()) parts.push(`<!-- FRAME ${frame.url()} -->\n${await frame.content().catch(() => '')}`);
  fs.writeFileSync(path.join(SHOTS_DIR, `debug-${name}.html`), parts.join('\n\n'));
}

async function setField(frame, name, value) {
  const field = frame.locator(`[name="${name}"]`).first();
  await field.click({ clickCount: 3 });
  await field.fill(String(value ?? ''));
  await field.press('Tab').catch(() => {});
}

// Picks an entry in an ExtJS combo box: types it, then clicks the matching list item.
async function pickCombo(page, frame, name, text) {
  const field = frame.locator(`[name="${name}"]`).first();
  await field.click({ clickCount: 3 });
  await field.fill('');
  await field.pressSequentially(String(text), { delay: 40 });
  await page.waitForTimeout(1500);
  const item = frame.locator('.x-boundlist-item').filter({ hasText: text }).first();
  if (await visible(item)) await item.click();
  else await field.press('Enter').catch(() => {});
  await page.waitForTimeout(800);
}

async function screenshot(page, name) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

// ---------- The four steps ----------

// 1. Customer Reference Number (load window -> References -> + Reference). Skips it when the
// load already has that reference.
async function addCustomerReference(loadPage, orderNumber, { dryRun = true, shotName = 'reference' } = {}) {
  const nav = loadPage.locator('.details-menu-item').filter({ hasText: /^\s*References\s*$/ }).first();
  await nav.click();
  await loadPage.waitForTimeout(4000);
  const existing = loadPage.locator('tr').filter({ hasText: /Customer Reference Number/i }).filter({ hasText: String(orderNumber) });
  if (await visible(existing.first())) return { skipped: true, message: `Customer Reference Number ${orderNumber} is already on the load.` };
  await loadPage.locator('[title="Add Reference"]').first().click();
  const frame = await waitForFrameWith(loadPage, '.x-window input.x-form-text', 20000).catch(() => null);
  if (!frame) {
    await saveDebug(loadPage, 'add-reference');
    throw new Error('The Add Reference window did not open.');
  }
  // Type and Value: the first combo is Type, the first plain text field after it is Value.
  const typeField = frame.locator('.x-window:visible input[role="combobox"], .x-window:visible input.x-form-text').first();
  await typeField.click();
  await typeField.fill('');
  await typeField.pressSequentially('Customer Reference Number', { delay: 30 });
  await loadPage.waitForTimeout(1500);
  const option = frame.locator('.x-boundlist-item').filter({ hasText: /^Customer Reference Number$/ }).first();
  if (await visible(option)) await option.click();
  await loadPage.waitForTimeout(800);
  const valueField = frame.locator('.x-window:visible input.x-form-text').nth(1);
  await valueField.fill(String(orderNumber));
  const shot = await screenshot(loadPage, shotName);
  await clickExtButton(loadPage, dryRun ? /^\s*Cancel\s*$/ : /^\s*Save\s*$/);
  return { shot, message: `${dryRun ? 'Filled (practice)' : 'Added'} Customer Reference Number ${orderNumber}` };
}

// 2. One stop (0 = pickup, 1 = drop) from the rate confirmation:
//    { name, address, city, state, zip, early: {date, time}, late: {date, time}, comments }
async function fillStop(loadPage, index, stop, { dryRun = true, shotName = `stop-${index}` } = {}) {
  const plan = loadPage.locator('.details-menu-item').filter({ hasText: /^\s*Plan\s*$/ }).first();
  if (await visible(plan)) { await plan.click(); await loadPage.waitForTimeout(3000); }
  const panel = loadPage.locator('.event-details-panel').nth(index);
  await panel.scrollIntoViewIfNeeded();
  await panel.locator('.column-location i.icon-edit-pencil').first().click();
  const frame = await waitForFrameWith(loadPage, '[name="locationEventName"]');
  await setField(frame, 'locationEventName', stop.name);
  await setField(frame, 'locationEventAddress1', stop.address);
  // City / State / Postal are filled by the zip lookup: pick the entry for the stop's city.
  const zip = frame.locator('[name="locationEventPostalSearch"]').first();
  await zip.click();
  await zip.fill('');
  await zip.pressSequentially(String(stop.zip).slice(0, 5), { delay: 60 });
  await loadPage.waitForTimeout(2500);
  const cityPattern = new RegExp(String(stop.city || '').replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).join('\\s+'), 'i');
  const match = frame.locator('.x-boundlist-item').filter({ hasText: cityPattern }).first();
  if (await visible(match)) await match.click();
  else if (await visible(frame.locator('.x-boundlist-item').first())) await frame.locator('.x-boundlist-item').first().click();
  await loadPage.waitForTimeout(1500);
  if (stop.comments) {
    const comments = frame.locator('[name="locationEventComments"]').first();
    await comments.fill(stop.comments);
  }
  await setField(frame, 'targetEarlyDate', stop.early.date);
  await setField(frame, 'targetEarlyTime', stop.early.time);
  await setField(frame, 'targetLateDate', stop.late.date);
  await setField(frame, 'targetLateTime', stop.late.time);
  const filled = {
    city: await frame.locator('[name="locationEventCity"]').first().inputValue().catch(() => ''),
    postal: await frame.locator('[name="locationEventPostal"]').first().inputValue().catch(() => '')
  };
  const shot = await screenshot(loadPage, shotName);
  await clickExtButton(loadPage, dryRun ? /^\s*Cancel\s*$/ : /^\s*Save\s*$/);
  await loadPage.waitForTimeout(3000);
  return { shot, filled, message: `${dryRun ? 'Filled (practice)' : 'Saved'} ${index === 0 ? 'pickup' : 'drop'}: ${stop.name}, ${filled.city} ${filled.postal}` };
}

async function waitForFrameWith(page, selector, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const frame = await frameWith(page, selector);
    if (frame) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error(`MercuryGate window with ${selector} did not open.`);
}

// 3. Special Instructions for the customer load (load window -> "Special Instructions (CL-)",
// the route-level notes Daniel adds from the list icon).
async function addSpecialInstructions(page, text, { dryRun = true, shotName = 'special-instructions' } = {}) {
  await page.bringToFront().catch(() => {});
  const link = page.locator('.mg-link, [title="Add Special Instructions"]').filter({ hasText: /Special Instructions \(CL-\)/ }).first();
  await link.scrollIntoViewIfNeeded().catch(() => {});
  await link.click();
  const frame = await waitForFrameWith(page, 'textarea[name="instructions"]');
  const box = frame.locator('textarea[name="instructions"]').first();
  const current = await box.inputValue().catch(() => '');
  if (current.includes(text.slice(0, 40))) {
    await page.locator('.x-tool-close, [data-qtip="Close"]').first().click().catch(() => {});
    return { skipped: true, message: 'Special instructions are already on the load.' };
  }
  await box.fill(current ? `${current}\n${text}` : text);
  const shot = await screenshot(page, shotName);
  if (dryRun) await page.locator('.x-window:visible .x-tool-close, .x-window:visible [class*="close"]').first().click().catch(() => page.keyboard.press('Escape'));
  else await clickExtButton(page, /^\s*OK\s*$/);
  await page.waitForTimeout(2000);
  return { shot, message: `${dryRun ? 'Filled (practice)' : 'Added'} special instructions` };
}

// 4. After pickup: upload the rate confirmation PDF (Handoff to CorpAdmin -> Documents ->
// add -> "Customer Confirmation Sheet"), then close the window with X (no Submit).
async function uploadConfirmation(page, pdfPath, { dryRun = true, shotName = 'upload' } = {}) {
  await page.bringToFront().catch(() => {});
  await page.locator('[title="Handoff to CorpAdmin"]').first().click();
  const frame = await waitForFrameWith(page, '[id^="mgdocumentsandlinks"]', 30000);
  await frame.locator('[id^="mgdocumentsandlinks"] a.x-btn').first().click();
  await page.waitForTimeout(3000);
  const docFrame = await waitForFrameWith(page, 'input[type="file"]', 15000).catch(() => frame);
  const typeField = docFrame.locator('.x-window:visible input.x-form-text').first();
  await typeField.click();
  await typeField.fill('');
  await typeField.pressSequentially('Customer Confirmation', { delay: 30 });
  await page.waitForTimeout(1500);
  const option = docFrame.locator('.x-boundlist-item').filter({ hasText: /Customer Confirmation Sheet/i }).first();
  if (await visible(option)) await option.click();
  await docFrame.locator('input[type="file"]').first().setInputFiles(pdfPath);
  await page.waitForTimeout(1500);
  const shot = await screenshot(page, shotName);
  await clickExtButton(page, dryRun ? /^\s*Cancel\s*$/ : /^\s*Save\s*$/);
  await page.waitForTimeout(4000);
  // Close the Handoff window with its X (Daniel doesn't Save & Submit).
  await page.locator('.x-window:visible .x-tool-close').first().click().catch(() => {});
  await page.waitForTimeout(2000);
  return { shot, message: `${dryRun ? 'Attached (practice)' : 'Uploaded'} the rate confirmation as Customer Confirmation Sheet` };
}

module.exports = {
  MG_HOME, SHOTS_DIR, openMercuryGate, findRouteOid, openLoadWindow,
  addCustomerReference, fillStop, addSpecialInstructions, uploadConfirmation
};
