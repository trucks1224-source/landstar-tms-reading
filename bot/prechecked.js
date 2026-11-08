// Sharing big exports between the two bots: the helper rate-checks export files from the back of
// the list while the main bot uploads from the front.
//   - A file the helper is checking has "<file>.helper-lock" next to it; the main bot skips it.
//   - A file the helper finished is listed in prechecked.json with its size and time after the
//     check; the main bot uploads it without checking again (if it is unchanged since).

const fs = require('fs');
const path = require('path');

const PRECHECKED_FILE = process.env.PRECHECKED_FILE || path.join(__dirname, 'prechecked.json');
const LOCK_MAX_AGE_MS = 15 * 60 * 1000; // a lock older than this is from a helper that stopped

const lockPath = file => `${file}.helper-lock`;

function readPrechecked() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PRECHECKED_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
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

// True when the helper checked this file and it hasn't changed since.
function isPrechecked(file) {
  const entry = readPrechecked()[path.resolve(file)];
  return Boolean(entry && entry.stamp === fileStamp(file));
}

function markPrechecked(file) {
  const all = readPrechecked();
  all[path.resolve(file)] = { stamp: fileStamp(file), at: Date.now() };
  // Forget entries older than two days.
  for (const [key, entry] of Object.entries(all)) if (Date.now() - entry.at > 2 * 86400000) delete all[key];
  const temp = `${PRECHECKED_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(all));
  fs.renameSync(temp, PRECHECKED_FILE);
}

function isLockedByHelper(file) {
  try {
    return Date.now() - fs.statSync(lockPath(file)).mtimeMs < LOCK_MAX_AGE_MS;
  } catch {
    return false;
  }
}

// Claims a file for the helper; false if it is already claimed. The lock is created only when
// it doesn't exist, so the two bots can't both get it.
function claim(file) {
  try {
    if (fs.existsSync(lockPath(file)) && !isLockedByHelper(file)) fs.unlinkSync(lockPath(file));
    fs.closeSync(fs.openSync(lockPath(file), 'wx'));
    return true;
  } catch {
    return false;
  }
}

function release(file) {
  try { fs.unlinkSync(lockPath(file)); } catch { /* already gone */ }
}

module.exports = { isPrechecked, markPrechecked, isLockedByHelper, claim, release, PRECHECKED_FILE };
