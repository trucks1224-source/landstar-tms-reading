// Bulk Postings error bot (Daniel, 2026-11-23: "delete it and tell me in the TMS").
//
// Every few minutes it reads Landstar's unposted bulk-upload drafts with their error reasons
// (details.validationErrors, e.g. "Pickup Start Date cannot be in the past", "Invalid
// Destination"). A draft is deleted only when:
//   - Landstar gives at least one error reason for it (drafts WITHOUT a reason are good loads
//     Landstar has not finished posting - 2,605 of them in the saved reports - never touched), and
//   - it has been there for ERROR_DRAFT_MIN_AGE_MS (an upload that is still settling is left alone).
// Drafts WITHOUT a reason that are still there after the same wait are "stuck" good loads: they
// are posted with the page's Post button, unless the load is already on the board (deleted: no
// duplicates) or ATZ has it (deleted and reported: the ATZ rule).
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

// Stuck drafts: no Landstar error, but still unposted after the settle time. Landstar sometimes
// leaves good loads of a file as drafts (11/23: 224 loads; 25 RXO reefer loads from 11:38).
// Daniel (2026-11-23): "If there is no Landstar error you can just click post".
function planStuckDrafts(drafts, seen, now = Date.now(), minAgeMs = ERROR_DRAFT_MIN_AGE_MS) {
  return drafts.filter(draft => !draftReasons(draft.details).length
    && seen[String(draft.draftId)] && now - seen[String(draft.draftId)] >= minAgeMs);
}

// What to do with one stuck draft, given what is on the board:
//   'duplicate' - the same load is already posted under your codes: delete the draft (no duplicates)
//   'atz'       - ATZ already has this load: never post it (ATZ rule); delete the draft and say so
//   'post'      - otherwise: post it
function decideStuckDraft(described, ownMatches, atzPosting) {
  if (ownMatches.length) return 'duplicate';
  if (atzPosting) return 'atz';
  return 'post';
}

// Ticks the given drafts' rows on Bulk Postings. Returns how many are ticked.
async function tickDraftRows(page, draftIds, log) {
  page.once('dialog', dialog => dialog.accept().catch(() => {}));
  await page.goto(BULK_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL(/portal\.landstaronline\.com\/agent\/bulk-postings/, { timeout: 60000 }).catch(() => {});
  await page.getByText(/Errors?\s*\|/i).first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  let checked = 0;
  for (const id of draftIds) {
    // The row that shows "#<draft id>" and its own checkbox. The number may be split across
    // elements ("#" + "8395943"), so take the innermost element whose text contains it.
    const label = `contains(translate(normalize-space(.), ' ', ''), '#${id}')`;
    const box = page.locator(`xpath=//*[${label}][not(*[${label}])]/ancestor::*[.//input[@type='checkbox']][1]//input[@type='checkbox']`).first();
    // Bulk Postings only draws the rows near the top (newest first); scroll down until the
    // draft's row is drawn (2026-11-23: #8395943 was row 26 of 26 and never on screen).
    for (let scroll = 0; scroll < 40 && !(await box.count()); scroll += 1) {
      const moved = await page.evaluate(() => {
        let changed = false;
        const scrollers = [document.scrollingElement, ...document.querySelectorAll('*')]
          .filter(el => el && el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'hidden');
        for (const el of scrollers) {
          const before = el.scrollTop;
          el.scrollTop = before + Math.max(400, el.clientHeight * 0.8);
          if (el.scrollTop !== before) changed = true;
        }
        return changed;
      }).catch(() => false);
      await page.waitForTimeout(700);
      if (!moved && !(await box.count())) break;
    }
    if (!(await box.count())) {
      const shot = path.join(__dirname, 'logs', `error-draft-${id}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      log(`    ! draft #${id} row was not found on the Bulk Postings page; left alone. Screenshot: ${shot}`);
      continue;
    }
    await box.check({ force: true }).catch(() => {});
    if (await box.isChecked().catch(() => false)) checked += 1;
  }
  return checked;
}

// Ticks the drafts and uses the page's own Delete or Post button, then checks Landstar's list.
// Returns the draft ids that are no longer unposted drafts.
async function actOnDrafts(page, draftIds, action, log = console.log) {
  if (!draftIds.length) return [];
  const sent = [];
  const onRequest = request => {
    if (/loadboards/i.test(request.url()) && !['GET', 'OPTIONS'].includes(request.method())) sent.push(`${request.method()} ${request.url().replace(/^https:\/\/[^/]+/, '')}`);
  };
  page.on('request', onRequest);
  try {
    if (!(await tickDraftRows(page, draftIds, log))) return [];
    // Exact names only: "Post" must never match the "Quick Post" tab.
    const name = action === 'delete' ? /^\s*delete(\s+selected)?(\s*\(\d+\))?\s*$/i : /^\s*post(\s+selected)?(\s*\(\d+\))?\s*$/i;
    const button = page.getByRole('button', { name }).first();
    if (!(await button.count())) {
      const buttons = (await page.locator('button').allInnerTexts().catch(() => [])).map(text => text.trim()).filter(Boolean);
      const shot = path.join(__dirname, 'logs', `bulk-${action}-buttons.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      log(`    ! no ${action === 'delete' ? 'Delete' : 'Post'} button after ticking the rows (buttons: ${JSON.stringify(buttons).slice(0, 300)}). Screenshot: ${shot}`);
      return [];
    }
    await button.click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const confirmName = action === 'delete' ? /^\s*(delete|yes|confirm|ok)\b/i : /^\s*(post|yes|confirm|ok|submit)\b/i;
    const confirm = page.locator('.cdk-overlay-pane, [role="dialog"]').getByRole('button', { name: confirmName }).last();
    if (await confirm.count()) await confirm.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(action === 'post' ? 10000 : 6000);
  } finally {
    page.off('request', onRequest);
  }
  if (sent.length) log(`    Landstar ${action} request: ${[...new Set(sent)].join(', ')}`);
  const left = new Set((await readErrorDrafts(page)).map(draft => String(draft.draftId)));
  return draftIds.filter(id => !left.has(String(id)));
}

const deleteDrafts = (page, draftIds, log) => actOnDrafts(page, draftIds, 'delete', log);

// The board loads that decide what happens to stuck drafts: your own postings in the drafts'
// origin states, and ATZ's postings on each draft's lane and pickup day.
async function boardChecks(board, stuck, log) {
  const { listPostings } = require('./dedupe');
  const { OWN_POSTING_CODES, searchBoard, isSkipAgencyPosting } = require('./rate-check');
  const { findMatchingPostings } = require('./unpost');
  const states = [...new Set(stuck.map(draft => String(draft.listing?.originRegion || '').trim()).filter(Boolean))];
  const own = await listPostings(board, OWN_POSTING_CODES, log, states);
  const searches = new Map();
  const results = [];
  for (const draft of stuck) {
    const d = describeDraft(draft);
    const l = draft.listing || {};
    const pickupDate = d.pickup ? `${d.pickup.slice(0, 6)}20${d.pickup.slice(6, 8)}` : '';
    const lane = {
      pickupDate, originState: String(l.originRegion || '').trim(), destState: String(l.destinationRegion || '').trim(),
      originCity: String(l.originLocality || '').trim(), destCity: String(l.destinationLocality || '').trim(),
      originZip: d.posting.originZip, destZip: d.posting.destZip
    };
    let atz = null;
    if (lane.originState && lane.destState && pickupDate) {
      const key = `${lane.originState}|${lane.destState}|${pickupDate}`;
      if (!searches.has(key)) searches.set(key, await searchBoard(board, lane.originState, lane.destState, pickupDate).catch(() => []));
      atz = searches.get(key).find(b => isSkipAgencyPosting(b, lane)) || null;
    }
    const ownMatches = findMatchingPostings(own, d.posting);
    results.push({ draft, described: d, decision: decideStuckDraft(d, ownMatches, atz), atz });
  }
  return results;
}

// One pass: error drafts are deleted and reported; stuck drafts with no error are posted (or
// deleted when the load is already on the board, or when ATZ has it). `context` is the bot's
// signed-in browser; it opens its own tab for Bulk Postings.
async function cleanErrorDrafts(context, { apply = true, log = console.log, report = () => {}, seenFile = SEEN_FILE } = {}) {
  const { openBoard } = require('./rate-check');
  const board = await openBoard(context, log); // first: it closes the browser's other tabs
  const page = await context.newPage();
  try {
    const drafts = await readErrorDrafts(page);
    const seen = readSeen(seenFile);
    const due = planErrorDraftCleanup(drafts, seen);
    const stuck = planStuckDrafts(drafts, seen);
    writeSeen(seen, seenFile);
    const waiting = drafts.length - due.length - stuck.length;
    if (!due.length && !stuck.length) {
      if (waiting) log(`  Bulk Postings: ${waiting} draft(s) waiting out the 10-minute settle time.`);
      return { deleted: [], posted: [] };
    }

    // Error drafts.
    const errors = due.map(describeDraft);
    errors.forEach(d => log(`  Error draft #${d.draftId} ${d.customer} ${d.lane} (pickup ${d.pickup}): ${d.reasons.join('; ')}`));

    // Stuck drafts: check the board first.
    const checks = stuck.length ? await boardChecks(board, stuck, log) : [];
    checks.forEach(({ described: d, decision, atz }) => log(`  Stuck draft #${d.draftId} ${d.customer} ${d.lane} (pickup ${d.pickup}): `
      + (decision === 'duplicate' ? 'already on the board - delete the draft'
        : decision === 'atz' ? `ATZ already has it (#${atz.LoadId}) - delete the draft` : 'no Landstar error - post it')));
    if (!apply) return { deleted: errors, posted: checks.filter(c => c.decision === 'post').map(c => c.described) };

    const atzDrafts = checks.filter(c => c.decision === 'atz')
      .map(c => ({ ...c.described, reasons: [`ATZ already has this load on the board (#${c.atz.LoadId}); not posted`] }));
    const duplicates = checks.filter(c => c.decision === 'duplicate').map(c => c.described);
    const toDelete = [...errors, ...atzDrafts, ...duplicates];
    const deletedIds = new Set((await deleteDrafts(page, toDelete.map(d => d.draftId), log)).map(String));
    toDelete.filter(d => !deletedIds.has(d.draftId)).forEach(d => log(`    ! draft #${d.draftId} could not be deleted; it will be tried again.`));
    // Reported to the TMS: errors and ATZ skips (the load is not on Landstar). Duplicates are
    // not: the load is already posted.
    const reported = [...errors, ...atzDrafts].filter(d => deletedIds.has(d.draftId));
    reported.forEach(d => report({ ...d, action: 'deleted' }));

    const toPost = checks.filter(c => c.decision === 'post').map(c => c.described);
    const postedIds = new Set((await actOnDrafts(page, toPost.map(d => d.draftId), 'post', log)).map(String));
    toPost.filter(d => !postedIds.has(d.draftId)).forEach(d => log(`    ! draft #${d.draftId} is still a draft after Post; it will be tried again.`));
    const posted = toPost.filter(d => postedIds.has(d.draftId));

    log(`  Bulk Postings: deleted ${deletedIds.size} draft(s) (${errors.filter(d => deletedIds.has(d.draftId)).length} with errors, `
      + `${duplicates.filter(d => deletedIds.has(d.draftId)).length} already on the board, ${atzDrafts.filter(d => deletedIds.has(d.draftId)).length} ATZ), `
      + `posted ${posted.length} of ${toPost.length} stuck draft(s).`);
    return { deleted: reported, posted };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  cleanErrorDrafts, readErrorDrafts, deleteDrafts, actOnDrafts, planErrorDraftCleanup, planStuckDrafts, decideStuckDraft,
  describeDraft, draftReasons, boardTime, ERROR_DRAFT_MIN_AGE_MS
};

if (require.main === module) {
  const { chromium } = require('playwright');
  (async () => {
    const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile-removal'), { headless: false, viewport: null });
    await cleanErrorDrafts(context, { apply: process.argv.includes('--apply') });
    await context.close();
  })().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
