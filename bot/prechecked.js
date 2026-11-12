// Rate-to-posting handoff. The legacy .helper-lock suffix is shared by all export workers.
// Ownership is retained while its process lives; unknown/legacy owners require manual review.
// Prepared files are verified by size, timestamp and content hash immediately before posting.

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');

const PRECHECKED_FILE = process.env.PRECHECKED_FILE || path.join(__dirname, 'prechecked.json');
const ownedLocks = new Map();

const lockPath = file => `${file}.helper-lock`;

function readPrechecked() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PRECHECKED_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Cannot read rate-check handoff: ${error.message}`, { cause: error });
  }
}

function fileStamp(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}|${Math.round(stat.mtimeMs)}`;
  } catch {
    return '';
  }
}

function fileDigest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// True when the helper checked this file and it hasn't changed since.
function isPrechecked(file) {
  const entry = readPrechecked()[path.resolve(file)];
  if (!entry || !entry.digest || entry.stamp !== fileStamp(file)) return false;
  return entry.digest === fileDigest(file);
}

function markPrechecked(file) {
  const all = readPrechecked();
  const stamp = fileStamp(file);
  if (!stamp) throw new Error(`Cannot mark a missing rate-checked export: ${file}`);
  all[path.resolve(file)] = { stamp, digest: fileDigest(file), at: Date.now() };
  // Forget entries older than two days.
  for (const [key, entry] of Object.entries(all)) if (Date.now() - entry.at > 2 * 86400000) delete all[key];
  const temp = `${PRECHECKED_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(all));
  fs.renameSync(temp, PRECHECKED_FILE);
}

function ownerActive(file) {
  try {
    const text = fs.readFileSync(lockPath(file), 'utf8');
    let owner;
    try { owner = JSON.parse(text); } catch { return true; }
    if (!Number.isInteger(owner?.pid) || owner.pid <= 0) return true;
    try { process.kill(owner.pid, 0); return true; } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function isLockedByHelper(file) {
  return fs.existsSync(`${lockPath(file)}.guard`) || ownerActive(file);
}

// Claims a file for the helper; false if it is already claimed. The lock is created only when
// it doesn't exist, so the two bots can't both get it.
function claim(file) {
  const key = path.resolve(file);
  if (ownedLocks.has(key)) return false;
  const guard = `${lockPath(file)}.guard`;
  let descriptor;
  try {
    descriptor = fs.openSync(guard, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  try {
    if (ownerActive(file)) return false;
    if (fs.existsSync(lockPath(file))) fs.unlinkSync(lockPath(file));
    const token = randomUUID();
    fs.writeFileSync(lockPath(file), JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
    ownedLocks.set(key, token);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(guard);
  }
}

function release(file) {
  const key = path.resolve(file);
  const token = ownedLocks.get(key);
  if (!token) return;
  try {
    const current = JSON.parse(fs.readFileSync(lockPath(file), 'utf8'));
    if (current.pid !== process.pid || current.token !== token) {
      throw new Error(`Export ownership changed unexpectedly: ${file}`);
    }
    fs.unlinkSync(lockPath(file));
    ownedLocks.delete(key);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    ownedLocks.delete(key);
  }
}

module.exports = { isPrechecked, markPrechecked, isLockedByHelper, claim, release, PRECHECKED_FILE };
