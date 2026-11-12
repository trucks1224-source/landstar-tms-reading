const fs = require('fs');
const path = require('path');
const { signature } = require('./bot-postings');

const SNAPSHOT_FILE = process.env.POSTING_MAINTENANCE_FILE || path.join(__dirname, 'posting-maintenance.json');
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = 90000;
const clean = value => String(value || '').trim();
const postingKey = posting => signature(posting.originZip, posting.destZip, posting.pickupThru, posting.weight);
const loadKey = item => `${item.customer}|${item.loadId}`;

function readSnapshot(file = SNAPSHOT_FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.loads) || !Number.isFinite(data.at)) throw new Error('Invalid posting-maintenance snapshot.');
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return { at: 0, loads: [] };
    throw error;
  }
}

function saveSnapshot(loads, file = SNAPSHOT_FILE, now = Date.now()) {
  if (!Array.isArray(loads)) throw new Error('loads must be a list');
  const next = loads.map(item => {
    if (!item || !clean(item.customer) || !clean(item.loadId) || !item.posting?.originZip
      || !item.posting?.destZip || !item.posting?.pickupThru) {
      throw new Error('Every protected load needs a customer, load number and exported posting details.');
    }
    return {
      customer: clean(item.customer), loadId: clean(item.loadId), posting: item.posting,
      revision: item.revision,
      refresh: item.refresh === true, status: clean(item.status), truck: clean(item.truck),
      pickupTime: clean(item.pickupTime), deliveryTime: clean(item.deliveryTime),
      origCity: clean(item.origCity), origSt: clean(item.origSt),
      destCity: clean(item.destCity), destSt: clean(item.destSt),
      weight: clean(item.weight), eCode: clean(item.eCode)
    };
  });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ at: now, loads: next }));
  fs.renameSync(temp, file);
  return next.length;
}

function isProtectedPosting(posting, snapshot = readSnapshot()) {
  const key = signature(posting.OriginZipCode, posting.DestinationZipCode, posting.PickupThruDateForDisplay, posting.Weight);
  return snapshot.loads.some(item => postingKey(item.posting) === key);
}

function canRefresh(item) {
  return item.refresh === true && ['OPEN', 'ENT'].includes(item.status) && !item.truck;
}

function refreshIsCurrent(item, snapshot = readSnapshot(), now = Date.now()) {
  return snapshot.at > now - SNAPSHOT_MAX_AGE_MS && snapshot.at <= now
    && snapshot.loads.some(current => loadKey(current) === loadKey(item)
      && canRefresh(current) && JSON.stringify(current) === JSON.stringify(item));
}

module.exports = {
  SNAPSHOT_FILE, REFRESH_INTERVAL_MS, SNAPSHOT_MAX_AGE_MS,
  readSnapshot, saveSnapshot, isProtectedPosting, canRefresh, refreshIsCurrent, postingKey, loadKey
};
