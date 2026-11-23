// Bulk Postings error bot (Daniel, 2026-11-23: "delete it and tell me in the TMS").
//
// Every few minutes it reads Landstar's unposted bulk-upload drafts with their error reasons
// (details.validationErrors, e.g. "Pickup Start Date cannot be in the past", "Invalid
// Destination"). A draft is deleted only when:
//   - Landstar gives at least one error reason for it (drafts WITHOUT a reason are good loads
//     Landstar has not finished posting - 2,605 of them in the saved reports - never touched), and
//   - it has been there for ERROR_DRAFT_MIN_AGE_MS (an upload that is still settling is left alone).
// Each deleted draft is reported to the TMS (/status errorDrafts): a banner with Landstar's reason
// and a LANDSTAR ERROR badge on the matching load, so it can be fixed and exported again.
//
// Run on its own (stop the removal bot first):
//   node error-drafts.js          <- report only, deletes nothing
//   node error-drafts.js --apply  <- also deletes

const fs = require('fs');
const path = require('path');

const BULK_URL = 'https://portal.landstaronline.com/agent/bulk-postings';
const SEEN_FILE = process.env.ERROR_DRAFTS_SEEN_FILE || path.join(__dirname, 'error-drafts-seen.json');
const ERROR_DRAFT_MIN_AGE_MS = 10 * 60 * 1000;

// "2026-11-30T17:00:00" -> "11/30/26 17:00" (the board / TMS posting format).
const boardTime = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)} ${m[4]}:${m[5]}` : '';
};

// Landstar's reasons for one draft: ["Invalid Destination", "TMS load must include calculated Miles"].
function draftReasons(details) {
  const reasons = (details?.validationErrors || []).flatMap(error => (error?.messages || []).map(message => String(message).trim()));
  return [...new Set(reasons.filter(Boolean))];
}

// What the TMS shows and matches the load by.
function describeDraft(draft) {
  const l = draft.listing || {};
  const place = (city, region, country) => [String(city || '').trim(), String(region || country || '').trim()].filter(Boolean).join(', ');
  return {
    draftId: String(draft.draftId),
    batchId: String(draft.batchId),
    customer: String(l.customerName || '').trim(),
    customerNumber: String(l.customerNumber || '').trim(),
    lane: `${place(l.originLocality, l.originRegion, l.originCountry)} -> ${place(l.destinationLocality, l.destinationRegion, l.destinationCountry)}`,
    pickup: boardTime(l.pickupStartDateTime),
    revenue: Number(l.revenue) || 0,
    hazmat: (l.commodityTypes || []).some(type => String(type?.code || '').trim().toUpperCase() === 'HAZMAT'),
    posting: {
      originZip: String(l.originZipCode || '').trim(),
      destZip: String(l.destinationZipCode || '').trim(),
      pickupThru: boardTime(l.pickupEndDateTime),
      deliveryThru: boardTime(l.deliveryEndDateTime),
      weight: Number(l.weight) || 0
    },
    reasons: draftReasons(draft.details)
  };
}

function readSeen(file = SEEN_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSeen(seen, file = SEEN_FILE) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(seen));
  fs.renameSync(temp, file);
}

// Which drafts to delete now. `seen` (draftId -> first time this bot saw it) is updated in place:
// drafts that are gone are forgotten, new ones start their 10-minute wait.
function planErrorDraftCleanup(drafts, seen, now = Date.now(), minAgeMs = ERROR_DRAFT_MIN_AGE_MS) {
  const present = new Set(drafts.map(draft => String(draft.draftId)));
  Object.keys(seen).forEach(id => { if (!present.has(id)) delete seen[id]; });
  const remove = [];
  for (const draft of drafts) {
    const id = String(draft.draftId);
    if (!seen[id]) seen[id] = now;
    if (!draftReasons(draft.details).length) continue; // a good load still posting: never deleted
    if (now - seen[id] < minAgeMs) continue;
    remove.push(draft);
  }
  return remove;
}

// Every unposted draft with its details (error reasons), read through the portal's own API.
async function readErrorDrafts(page) {
  if (!/portal\.landstaronline\.com\/agent/.test(page.url())) {
    await page.goto(BULK_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForURL(/portal\.landstaronline\.com\/agent/, { timeout: 60000 }).catch(() => {});
  }
  // A new tab is signed in by the portal a few seconds after it opens (like dedupe.js portalSession).
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const signedIn = await page.evaluate(() => [sessionStorage, localStorage].some(storage => {
      for (let i = 0; i < storage.length; i += 1) if (/^oidc\.user:/i.test(storage.key(i))) return true;
      return false;
    })).catch(() => false);
    if (signedIn) break;
    await page.waitForTimeout(1000);
  }
  return page.evaluate(async () => {
    let user;
    for (const storage of [sessionStorage, localStorage]) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!/^oidc\.user:/i.test(key)) continue;
        try {
          const candidate = JSON.parse(storage.getItem(key));
          if (candidate?.access_token && candidate.profile?.ls_unique_id) user = candidate;
        } catch { /* keep looking */ }
      }
    }
    if (!user) throw new Error('Cannot read Bulk Postings errors: Landstar sign-in is missing.');
    const headers = { Authorization: `Bearer ${user.access_token}`, 'Content-Type': 'application/json' };
    const list = await fetch('/loadboards/v1/bulkUpload/unpostedDrafts?pageIndex=0&pageSize=200', {
      method: 'POST', headers,
      body: JSON.stringify({ loadStatuses: ['Active'], userId: String(user.profile.ls_unique_id), sortColumn: 'PostingNumber', sortType: 'Desc', lockedInRate: false })
    });
    if (!list.ok) throw new Error(`Cannot read Bulk Postings errors: HTTP ${list.status}.`);
    const result = await list.json();
    const drafts = [];
    for (const listing of result.data || []) {
      const detail = await fetch(`/loadboards/v1/bulkUpload/batch/${encodeURIComponent(listing.batchId)}/draft/${encodeURIComponent(listing.draftId)}/details`, { headers });
      drafts.push({ batchId: listing.batchId, draftId: listing.draftId, listing, details: detail.ok ? await detail.json() : null });
    }
    return drafts;
  });
}

// Deletes the given drafts with the Bulk Postings page's own checkboxes and Delete button,
// then confirms with Landstar's list that they are gone. Returns the draft ids really deleted.
async function deleteDrafts(page, draftIds, log = console.log) {
  if (!draftIds.length) return [];
  page.once('dialog', dialog => dialog.accept().catch(() => {}));
  await page.goto(BULK_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL(/portal\.landstaronline\.com\/agent\/bulk-postings/, { timeout: 60000 }).catch(() => {});
  await page.getByText(/Errors?\s*\|/i).first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const sent = [];
  const onRequest = request => {
    if (/bulkUpload/i.test(request.url()) && !['GET', 'OPTIONS'].includes(request.method())) sent.push(`${request.method()} ${request.url().replace(/^https:\/\/[^/]+/, '')}`);
  };
  page.on('request', onRequest);
  try {
    let checked = 0;
    for (const id of draftIds) {
      // The row that shows "#<draft id>" and its own checkbox. The number may be split across
      // elements ("#" + "8395943"), so take the innermost element whose text contains it.
      const label = `contains(translate(normalize-space(.), ' ', ''), '#${id}')`;
      const box = page.locator(`xpath=//*[${label}][not(*[${label}])]/ancestor::*[.//input[@type='checkbox']][1]//input[@type='checkbox']`).first();
      if (!(await box.count())) {
        // Evidence for fixing this: a screenshot and the page around the number.
        const shot = path.join(__dirname, 'logs', `error-draft-${id}.png`);
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        const around = await page.evaluate(number => {
          const html = document.body.innerHTML;
          const at = html.indexOf(number);
          return at < 0 ? '(number not in the page)' : html.slice(Math.max(0, at - 1500), at + 300).replace(/\s+/g, ' ');
        }, String(id)).catch(() => '');
        fs.writeFileSync(path.join(__dirname, 'logs', `error-draft-${id}.html.txt`), around);
        log(`    ! draft #${id} row was not found on the Bulk Postings page; left alone. Screenshot: ${shot}`);
        continue;
      }
      await box.check({ force: true }).catch(() => {});
      if (await box.isChecked().catch(() => false)) checked += 1;
    }
    if (!checked) return [];
    const remove = page.getByRole('button', { name: /^\s*delete/i }).first();
    await remove.click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const confirm = page.locator('.cdk-overlay-pane, [role="dialog"]').getByRole('button', { name: /^\s*(delete|yes|confirm|ok)\b/i }).last();
    if (await confirm.count()) await confirm.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(6000);
  } finally {
    page.off('request', onRequest);
  }
  if (sent.length) log(`    Landstar delete request: ${[...new Set(sent)].join(', ')}`);
  const left = new Set((await readErrorDrafts(page)).map(draft => String(draft.draftId)));
  return draftIds.filter(id => !left.has(String(id)));
}

// One pass: read, decide, delete, report. Returns the deleted drafts (described).
async function cleanErrorDrafts(page, { apply = true, log = console.log, report = () => {}, seenFile = SEEN_FILE } = {}) {
  const drafts = await readErrorDrafts(page);
  const seen = readSeen(seenFile);
  const due = planErrorDraftCleanup(drafts, seen);
  writeSeen(seen, seenFile);
  const withErrors = drafts.filter(draft => draftReasons(draft.details).length).length;
  if (!due.length) {
    if (withErrors) log(`  Bulk Postings: ${withErrors} error draft(s) waiting out the 10-minute settle time.`);
    return [];
  }
  const described = due.map(describeDraft);
  described.forEach(d => log(`  Error draft #${d.draftId} ${d.customer} ${d.lane} (pickup ${d.pickup}): ${d.reasons.join('; ')}`));
  if (!apply) return described;
  const deleted = new Set((await deleteDrafts(page, described.map(d => d.draftId), log)).map(String));
  const done = described.filter(d => deleted.has(d.draftId));
  described.filter(d => !deleted.has(d.draftId)).forEach(d => log(`    ! draft #${d.draftId} could not be deleted; it will be tried again.`));
  done.forEach(d => report({ ...d, action: 'deleted' }));
  log(`  Bulk Postings: deleted ${done.length} of ${described.length} error draft(s).`);
  return done;
}

module.exports = {
  cleanErrorDrafts, readErrorDrafts, deleteDrafts, planErrorDraftCleanup, describeDraft, draftReasons,
  boardTime, ERROR_DRAFT_MIN_AGE_MS
};

if (require.main === module) {
  const { chromium } = require('playwright');
  const { openBoard } = require('./rate-check');
  (async () => {
    const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile-removal'), { headless: false, viewport: null });
    await openBoard(context);
    const page = await context.newPage();
    await cleanErrorDrafts(page, { apply: process.argv.includes('--apply') });
    await context.close();
  })().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
