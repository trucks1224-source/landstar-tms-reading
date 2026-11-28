// Removes duplicate Landstar postings, keeping the newest copy of each load.
//
// Re-importing a customer's list and exporting again posts every still-open load
// again, and Landstar keeps the older posting live too, so copies pile up. This
// scans the load board for your bulk-uploaded postings (SourceSystemID PORTAL)
// under your own posting codes, groups them by lane, pickup day and trailer type,
// and cancels every posting older than the newest upload of that lane. Postings
// you made by hand are never touched.
//
// Used by upload.js after uploads and while idle. Can also run on its own:
//   node dedupe.js            <- report only, removes nothing
//   node dedupe.js --apply    <- remove the older copies

const { chromium } = require('playwright');
const path = require('path');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');
const { setStatus } = require('./status-server');
const { isBotPosting, uploadedSignatures } = require('./bot-postings');

// Every posting listPostings has read, by load ID: cancelPostings checks each one is the bot's.
const seenPostings = new Map();

const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const PORTAL_LOADS_URL = 'https://portal.landstaronline.com/agent/available-loads';
const MAX_ROWS = 2000;
const CANCEL_BATCH = 100;
const STATES = ['AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA',
  'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY', 'AK', 'HI', 'ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB'];

// ---------- pure helpers (tested in dedupe.test.js) ----------

const postedAt = load => Number(String(load.OrderDate || '').match(/-?\d+/)?.[0] || 0);

// Same load = same agency, lane, pickup day and trailer types. Re-exports often shift the
// pickup start, the delivery window or the weight a little (seen 2026-11-23: 24 copies
// survived an exact-match check), so those are not part of the key.
function postingKey(load) {
  return [
    String(load.Agency || '').trim().toUpperCase(),
    load.OriginCityState, load.DestinationCityState,
    String(load.PickupThruDateForDisplay || load.PickupFromDateForDisplay || '').trim().split(' ')[0],
    (load.TrailerTypes || []).map(type => String(type).trim()).sort().join('+')
  ].join('|');
}

// One bulk upload posts its loads a second or two apart; the next file or a re-upload
// starts after a longer pause. Postings split by gaps of more than BULK_GAP_MS form one
// upload: several loads on one lane and day in the same upload are separate loads on the
// customer's list, not copies. (A 60-second window kept a file uploaded twice 20 s apart.)
const BULK_GAP_MS = 3000;
function uploadGroups(postings) {
  const sorted = postings
    .filter(load => String(load.SourceSystemID || '').toUpperCase() === 'PORTAL')
    .sort((a, b) => postedAt(a) - postedAt(b));
  const groupOf = new Map();
  let group = 0;
  sorted.forEach((load, i) => {
    if (i > 0 && postedAt(load) - postedAt(sorted[i - 1]) > BULK_GAP_MS) group += 1;
    groupOf.set(String(load.LoadId), group);
  });
  return groupOf;
}

// Returns { keep: [...], remove: [...] } load IDs. For each lane and pickup day, the postings
// of the newest upload are kept and every older posting is removed.
function planDuplicateRemoval(postings) {
  const uploadOf = uploadGroups(postings);
  const groups = new Map();
  postings
    .filter(load => String(load.SourceSystemID || '').toUpperCase() === 'PORTAL')
    .forEach(load => {
      const key = postingKey(load);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(load);
    });
  const keep = [];
  const remove = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => postedAt(b) - postedAt(a) || Number(b.LoadId) - Number(a.LoadId));
    const newest = uploadOf.get(String(group[0].LoadId));
    const older = group.filter(load => uploadOf.get(String(load.LoadId)) !== newest);
    if (!older.length) continue;
    group.filter(load => !older.includes(load)).forEach(load => keep.push(load.LoadId));
    older.forEach(load => remove.push(load.LoadId));
  }
  return { keep, remove };
}

// Postings that came in a bulk upload (posted seconds apart from other loads); a hand Quick
// Post is one load on its own. Recognises the bot's uploads after their spreadsheet is gone.
function bulkUploadedIds(postings) {
  const uploadOf = uploadGroups(postings);
  const size = new Map();
  uploadOf.forEach(group => size.set(group, (size.get(group) || 0) + 1));
  return new Set([...uploadOf].filter(([, group]) => size.get(group) > 1).map(([id]) => id));
}

// ---------- board and portal ----------

function searchCriteria(agency, originState) {
  return {
    FreightBillNumber: null, SearchCriteriaId: null, DefaultSearchCriteria: false, Name: '', IsEnabled: false, IsAutomated: false,
    Devices: [], TractorNumber: 'None', CSA: '', Destination: { cityName: '', states: [], radius: 0 }, DestinationCountry: '',
    MaximumRows: MAX_ROWS, Miles: { Max: '', Min: '' }, MinRevenue: '', MinRPM: '',
    Origin: { cityName: '', states: [originState], radius: 0 }, OriginCountry: '', Preloaded: '', Team: '',
    Weight: { Max: '', Min: '' }, AdditionalStopCount: '', Agency: agency, Brokerable: '', CODOnCommodity: '', Company: '',
    Dimensions: { height: '', heightOperator: 4, includeWithoutDimensions: 'true', length: '', lengthOperator: 4, width: '', widthOperator: 4 },
    DriverCollect: '', Hazmat: '', HighRisk: '', JIT: '', LTL: '', DirectShipper: '', AgentAssist: '',
    DeliveryDate: '', DeliveryDateEnd: '', DeliveryDateRange: '0', PickupDate: '', PickupDateEnd: '', PickupDateRange: '0', TrailerTypes: []
  };
}

// Every posting under the given agency codes, one origin state at a time
// (a single search is capped at 2,000 results).
async function listPostings(boardPage, agencies, log, states = STATES) {
  const all = [];
  for (const agency of agencies) {
    for (const state of states) {
      const loads = await boardPage.evaluate(async ({ body, agencyCode, originState }) => {
        await fetch('/Loads/Load/PerformSearch', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify(body)
        });
        const html = await (await fetch('/Loads/Load/SearchResults', { credentials: 'include' })).text();
        const match = html.match(/var embeddedJSON = (\{.*\});?\s*$/m);
        if (!match) throw new Error('Board results could not be read (logged out?)');
        return (JSON.parse(match[1]).Loads || []).filter(load =>
          String(load.Agency || '').trim().toUpperCase() === agencyCode && String(load.OriginState || '').trim() === originState);
      }, { body: searchCriteria(agency, state), agencyCode: agency, originState: state });
      if (loads.length >= MAX_ROWS) log(`  ! ${agency} ${state}: ${MAX_ROWS}-posting limit reached; some duplicates may be missed this round`);
      loads.forEach(load => seenPostings.set(String(load.LoadId), load));
      all.push(...loads);
    }
  }
  return all;
}

// Opens the portal and returns { token, userId } from its sign-in data.
async function portalSession(page) {
  await page.goto(PORTAL_LOADS_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const session = await page.evaluate(() => {
      if (!/portal\.landstaronline\.com$/.test(location.host)) return null;
      for (const store of [sessionStorage, localStorage]) {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          if (!/oidc\.user/i.test(key)) continue;
          try {
            const user = JSON.parse(store.getItem(key));
            // Skip a token that has expired or is about to (the portal renews it shortly).
            const fresh = !user?.expires_at || user.expires_at * 1000 > Date.now() + 60000;
            if (user?.access_token && user.profile?.ls_unique_id && fresh) return { token: user.access_token, userId: Number(user.profile.ls_unique_id) };
          } catch { /* keep looking */ }
        }
      }
      return null;
    }).catch(() => null);
    if (session) return session;
    await page.waitForTimeout(1000);
  }
  throw new Error('Could not read the Landstar portal sign-in (logged out?)');
}

// Load numbers the bot must never remove (protected-loads.json); only you take them off.
function protectedLoadIds() {
  try {
    const list = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'protected-loads.json'), 'utf8'));
    return new Set((Array.isArray(list) ? list : []).map(item => String(item?.loadId ?? item).trim()));
  } catch {
    return new Set();
  }
}

// Which requested load numbers may be removed (before the "uploaded by the bot" check).
// protected-loads.json always wins, even for a confirmed "remove all of mine" run
// (remove-customer.js --include-hand-posted, clear-board-all-once.js).
function filterRemovable(requestedIds, { protectedIds, postings, confirmedAllOwnAvailable = false, ownCodes = OWN_POSTING_CODES, isStillProtected = () => false }) {
  return requestedIds.filter(id => {
    if (protectedIds.has(String(id))) return false;
    const posting = postings.get(String(id));
    if (confirmedAllOwnAvailable) {
      return Boolean(posting) && ownCodes.includes(String(posting.Agency || '').trim().toUpperCase());
    }
    return !posting || !isStillProtected(posting);
  });
}

// olderCopies: every requested posting is an older copy whose newest copy stays live, so the load is
// still posted: neither the TMS protection nor the hand-posted check keeps it (protected-loads.json still does).
async function cancelPostings(page, requestedIds, log = console.log, { refreshLoad, confirmedAllOwnAvailable = false, olderCopies = false } = {}) {
  const { readSnapshot, isProtectedPosting, refreshIsCurrent, postingKey } = require('./posting-maintenance');
  const snapshot = readSnapshot();
  const refreshAllowed = refreshLoad && refreshIsCurrent(refreshLoad, snapshot);
  const protectedIds = protectedLoadIds();
  const unprotected = filterRemovable(requestedIds, {
    protectedIds, postings: seenPostings, confirmedAllOwnAvailable,
    isStillProtected: posting => {
      if (olderCopies || !isProtectedPosting(posting, snapshot)) return false;
      if (!refreshAllowed) return true;
      const key = require('./bot-postings').postingSignature(posting);
      // A refresh may replace its own protected posting, never another protected load.
      return !snapshot.loads.filter(item => postingKey(item.posting) === key)
        .every(item => `${item.customer}|${item.loadId}` === `${refreshLoad.customer}|${refreshLoad.loadId}`);
    }
  });
  if (unprotected.length < requestedIds.length) {
    log(`  Kept ${requestedIds.length - unprotected.length} protected posting(s): ${requestedIds.filter(id => protectedIds.has(String(id))).join(', ')}`);
  }
  // Only the bot's own bulk uploads are ever removed: loads posted by hand (Quick Post)
  // stay up even when they are not on the customer's list. See bot-postings.js.
  const signatures = uploadedSignatures();
  const bulk = bulkUploadedIds([...seenPostings.values()]);
  const isOwn = id => seenPostings.has(String(id))
    && (isBotPosting(seenPostings.get(String(id)), signatures) || bulk.has(String(id)));
  // An older copy goes even if it was posted by hand: the newest copy keeps the load on the board.
  const loadIds = confirmedAllOwnAvailable || olderCopies ? unprotected : unprotected.filter(isOwn);
  if (loadIds.length < unprotected.length) {
    log(`  Kept ${unprotected.length - loadIds.length} posting(s) not uploaded by the bot (posted by hand): ${unprotected.filter(id => !isOwn(id)).join(', ')}`);
  }
  if (!loadIds.length) return 0;
  let { token, userId } = await portalSession(page);
  let cancelled = 0;
  const failed = {};
  for (let i = 0; i < loadIds.length; i += CANCEL_BATCH) {
    const batch = loadIds.slice(i, i + CANCEL_BATCH);
    // The portal sometimes reloads itself mid-run; wait for it and send the batch again.
    const sendBatch = async attempt => page.evaluate(async ({ batch, token, userId }) => {
      const response = await fetch('/loadboards/v1/availableLoadsCancel', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, loadIdsToCancel: batch })
      });
      const text = await response.text();
      let body = {};
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      return { ok: response.ok, status: response.status, errors: body.cancelErrors || {}, text: text.slice(0, 200) };
    }, { batch, token, userId }).catch(async error => {
      if (attempt >= 3 || !/context was destroyed|navigation/i.test(error.message)) throw error;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(3000);
      return sendBatch(attempt + 1);
    });
    let result = await sendBatch(1);
    // The sign-in token expired mid-run (long removal lists): get a fresh one and resend once.
    if (result.status === 401) {
      log('  Landstar sign-in expired during removal; refreshing it and retrying...');
      ({ token, userId } = await portalSession(page));
      result = await sendBatch(1);
    }
    if (!result.ok) throw new Error(`Landstar refused the removal (HTTP ${result.status}): ${result.text}`);
    Object.assign(failed, result.errors);
    cancelled += batch.length - Object.keys(result.errors).length;
  }
  if (Object.keys(failed).length) log(`  ! ${Object.keys(failed).length} older copies could not be removed: ${JSON.stringify(failed).slice(0, 300)}`);
  return cancelled;
}

// Full pass: find duplicates and (with apply) remove the older copies.
async function removeDuplicatePostings(context, { apply = true, log = console.log } = {}) {
  setStatus('logged-in', 'Checking Landstar for duplicate postings');
  log('Checking Landstar for duplicate postings...');
  // Pass the log through so "ACTION NEEDED: log in" is shown if the session expired.
  const boardPage = await openBoard(context, log);
  const postings = await listPostings(boardPage, OWN_POSTING_CODES, log);
  // Uploads Landstar never confirmed: cleared from the review folder once they are on the board.
  try { require('./review-settle').settleReviewFiles(postings, { log }); } catch (error) { log(`  ! Review folder check failed: ${error.message}`); }
  const { keep, remove } = planDuplicateRemoval(postings);
  if (!remove.length) {
    log(`  No duplicates (${postings.length} postings checked).`);
    return 0;
  }
  log(`  ${remove.length} older duplicate posting(s) of ${keep.length} load(s) found (${postings.length} postings checked).`);
  if (!apply) {
    log('  Report only: nothing removed. Run "node dedupe.js --apply" to remove them.');
    return 0;
  }
  setStatus('logged-in', `Removing ${remove.length} duplicate posting(s)`);
  const cancelled = await cancelPostings(boardPage, remove, log, { olderCopies: true });
  log(`  Removed ${cancelled} older duplicate posting(s); the newest posting of each load is still live.`);
  return cancelled;
}

module.exports = { removeDuplicatePostings, planDuplicateRemoval, bulkUploadedIds, postingKey, listPostings, cancelPostings, protectedLoadIds, filterRemovable, STATES };

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  (async () => {
    const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: null });
    try {
      await removeDuplicatePostings(context, { apply });
    } finally {
      await context.close();
    }
  })().catch(error => { console.error('Duplicate check failed:', error.message); process.exit(1); });
}
