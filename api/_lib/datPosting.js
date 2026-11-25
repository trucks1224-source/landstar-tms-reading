// DAT load-board posting (DAT Freight API, /posting/v2/loads).
//
// Runs only inside the local TMS server (vite.config.js, 127.0.0.1): it posts under your
// DAT account, so it is never a public Vercel function. The server remembers every
// posting it makes in bot/dat-postings.json and, while it runs, reposts each load every
// DAT_REPOST_MINUTES (the old posting deleted, then the same load posted again right away,
// so its age starts over) and takes it down once its pickup window has ended. The old one
// has to go first: DAT refuses a second posting with the same referenceId (staging,
// 2026-11-25: "The referenceId is already in use").
// Daniel chose delete-and-repost over DAT's refresh (2026-11-25): DAT only allows a refresh
// every 15 minutes, and a refresh does not make the posting new.
//
// Endpoints follow DAT's "Playing with REST" Postman collection (2026-10-30):
//   POST   {freight}/posting/v2/loads              create a load posting
//   DELETE {freight}/posting/v2/loads/{id}         remove one posting
// Auth is the same two-step org/user token the rate lookup uses (api/dat-rate.js).
import fs from 'node:fs';
import path from 'node:path';
import { getDatConfig, getOrgToken, getUserToken, datPartnerHeaders } from '../dat-rate.js';

export const DAT_REPOST_MINUTES = 5;
const defaultFreightBase = 'https://freight.api.staging.dat.com';
const datEquipmentTypes = new Set(['V', 'R', 'F', 'SD', 'VR']);

export function getDatPostingConfig(env = process.env) {
  return { ...getDatConfig(env), freightBase: (env.DAT_FREIGHT_BASE || defaultFreightBase).replace(/\/+$/, '') };
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);

function toDatPlace(place) {
  const city = text(place?.city, 60);
  const stateProv = text(place?.state, 2).toUpperCase();
  const postalCode = text(place?.zip, 10);
  if (!city || !/^[A-Z]{2}$/.test(stateProv)) return null;
  return postalCode ? { city, stateProv, postalCode } : { city, stateProv };
}

// Turns the TMS's posting (built by buildDatPosting in App.jsx) into DAT's request body.
// Returns { body } or { error }.
export function buildDatLoadBody(posting) {
  const origin = toDatPlace(posting?.origin);
  const destination = toDatPlace(posting?.destination);
  if (!origin) return { error: 'origin city and state' };
  if (!destination) return { error: 'destination city and state' };
  const equipmentType = text(posting?.equipmentType, 4).toUpperCase();
  if (!datEquipmentTypes.has(equipmentType)) return { error: `equipment DAT can take (got "${posting?.equipmentType || ''}")` };
  const earliest = Date.parse(posting?.earliestAvailabilityWhen || '');
  const latest = Date.parse(posting?.latestAvailabilityWhen || '');
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || latest < earliest) return { error: 'pickup date' };
  const weightPounds = Math.round(Number(posting?.weightPounds) || 0);
  const lengthFeet = Math.round(Number(posting?.lengthFeet) || 0);
  const rateUsd = Math.round(Number(posting?.rateUsd) || 0);
  const comments = (Array.isArray(posting?.comments) ? posting.comments : [])
    .map(comment => text(comment, 70)).filter(Boolean).slice(0, 2);

  const loadBoard = { includesExtendedNetwork: false };
  if (rateUsd > 0) loadBoard.transactionDetails = { loadOfferRateUsd: rateUsd, transactionType: 'NONBOOKABLE_OFFER_RATE' };
  const freight = { equipmentType, fullPartial: 'FULL' };
  if (lengthFeet > 0) freight.lengthFeet = lengthFeet;
  if (weightPounds > 0) freight.weightPounds = weightPounds;
  if (comments.length) freight.comments = comments.map(comment => ({ comment }));
  const body = {
    exposure: {
      audience: { loadBoard },
      earliestAvailabilityWhen: new Date(earliest).toISOString(),
      latestAvailabilityWhen: new Date(latest).toISOString(),
      preferredContactMethod: 'PRIMARY_PHONE'
    },
    freight,
    lane: { origin, destination }
  };
  // DAT takes at most 8 characters here (staging 422, 2026-11-25); the TMS keeps the full
  // load # in its own posting record.
  const referenceId = String(posting?.referenceId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  if (referenceId) body.referenceId = referenceId;
  return { body };
}

// DAT answers a create with the new posting; the id field name is not in the Postman
// collection, so take the usual names and fall back to the Location header.
export function readPostingId(result, location = '') {
  const id = result?.id || result?.postingId || result?.assetId || result?.posting?.id;
  if (id) return String(id);
  const fromLocation = String(location || '').split('?')[0].split('/').filter(Boolean).pop();
  return fromLocation && fromLocation !== 'loads' ? fromLocation : '';
}

function errorMessage(result, status, fallback) {
  const first = result?.errors?.[0];
  if (first?.message) return `${first.dataPath ? `${first.dataPath.replace(/^\//, '')} ` : ''}${first.message.replace(/^:\s*/, '')}`;
  return result?.message || result?.error || `${fallback} (${status})`;
}

// Calls the DAT Freight API with a cached user token.
export function createDatRequest(config, fetchImpl = fetch) {
  return async (method, apiPath, body) => {
    const orgToken = await getOrgToken(config.authBase, config.username, config.password);
    const userToken = await getUserToken(config.authBase, orgToken, config.userUsername);
    const response = await fetchImpl(`${config.freightBase}${apiPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, ...datPartnerHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const raw = await response.text().catch(() => '');
    let result = {};
    try { result = raw ? JSON.parse(raw) : {}; } catch { result = { message: raw.slice(0, 200) }; }
    return { ok: response.ok, status: response.status, result, location: response.headers?.get?.('location') || '' };
  };
}

function readStore(storePath) {
  try {
    const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeStore(storePath, store) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const temp = `${storePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2));
  fs.renameSync(temp, storePath);
}

// request(method, path, body) -> { ok, status, result, location }; injectable for tests.
export function createDatPostingService({ request, storePath, now = () => Date.now(), repostMinutes = DAT_REPOST_MINUTES }) {
  const load = () => readStore(storePath);
  const save = store => writeStore(storePath, store);

  async function remove(postingId) {
    const id = String(postingId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return { postingId: id, ok: false, error: 'not a DAT posting id' };
    const { ok, status, result } = await request('DELETE', `/posting/v2/loads/${encodeURIComponent(id)}`);
    // Already gone on DAT (expired or removed there) counts as removed.
    if (!ok && status !== 404) return { postingId: id, ok: false, error: errorMessage(result, status, 'DAT would not remove the posting') };
    const store = load();
    delete store[id];
    save(store);
    return { postingId: id, ok: true };
  }

  async function post(posting) {
    const { body, error } = buildDatLoadBody(posting);
    const referenceId = text(posting?.referenceId, 30);
    if (error) return { referenceId, ok: false, error: `missing or invalid ${error}` };
    // Posting a load again replaces its earlier DAT posting (same customer + load #).
    const customer = text(posting?.customer, 80);
    const earlier = Object.values(load()).filter(record => referenceId && record.referenceId === referenceId && record.customer === customer);
    for (const record of earlier) await remove(record.postingId);

    const { ok, status, result, location } = await request('POST', '/posting/v2/loads', body);
    if (!ok) return { referenceId, ok: false, error: errorMessage(result, status, 'DAT would not take the posting') };
    const postingId = readPostingId(result, location);
    if (!postingId) return { referenceId, ok: false, error: 'DAT took the posting but did not return its id' };
    const at = new Date(now()).toISOString();
    const store = load();
    store[postingId] = {
      postingId, referenceId, customer,
      latestAvailabilityWhen: body.exposure.latestAvailabilityWhen,
      firstPostedAt: at, postedAt: at, body
    };
    save(store);
    return { referenceId, ok: true, postingId, postedAt: at };
  }

  // Reposts loads posted repostMinutes or more ago: deletes the old posting, then posts the
  // same load again. If the new post fails, the load is marked offBoard and the next pass
  // (30 seconds later) posts it again. Takes down postings whose pickup window has ended.
  // Returns what it did, for the server log.
  async function repostDue() {
    const summary = { reposted: 0, removed: 0, failed: [] };
    const time = now();
    const label = record => record.referenceId || record.postingId;
    const markError = (record, fields) => {
      const store = load();
      if (store[record.postingId]) { store[record.postingId] = { ...store[record.postingId], ...fields }; save(store); }
    };
    for (const record of Object.values(load())) {
      if (Date.parse(record.latestAvailabilityWhen) < time) {
        const removed = await remove(record.postingId);
        if (removed.ok) summary.removed += 1;
        else summary.failed.push(`${label(record)}: ${removed.error}`);
        continue;
      }
      if (!record.body) continue;
      if (!record.offBoard && time - Date.parse(record.postedAt || 0) < repostMinutes * 60_000) continue;
      if (!record.offBoard) {
        const gone = await request('DELETE', `/posting/v2/loads/${encodeURIComponent(record.postingId)}`);
        if (!gone.ok && gone.status !== 404) {
          // Old posting is still up, so the load is still on the board; try again next pass.
          const error = errorMessage(gone.result, gone.status, 'DAT would not remove the old posting');
          markError(record, { lastError: error });
          summary.failed.push(`${label(record)}: ${error}`);
          continue;
        }
      }
      const { ok, status, result, location } = await request('POST', '/posting/v2/loads', record.body);
      const postingId = ok ? readPostingId(result, location) : '';
      if (!postingId) {
        const error = ok ? 'DAT took the repost but did not return its id' : errorMessage(result, status, 'DAT would not take the repost');
        markError(record, { offBoard: true, lastError: error });
        summary.failed.push(`${label(record)}: off DAT, reposting next pass: ${error}`);
        continue;
      }
      const store = load();
      const { lastError, offBoard, ...kept } = store[record.postingId] || record;
      delete store[record.postingId];
      store[postingId] = { ...kept, postingId, postedAt: new Date(time).toISOString() };
      save(store);
      summary.reposted += 1;
    }
    return summary;
  }

  // Postings the TMS is keeping on DAT (without the request bodies).
  const list = () => Object.values(load()).map(({ body, ...record }) => record);
  return { post, remove, repostDue, list };
}
