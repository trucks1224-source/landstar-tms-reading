// Exports saved to the Desktop (Daniel 2026-11-27: agent AAQ's Chrome saves downloads to his
// Desktop, so his bot, which watches Downloads, never saw them). Before the bots look for
// exports, new Landstar_Bulk_... files on the Desktop are moved into Downloads, and from there
// everything works as usual (rate check, upload, uploaded / review folders).
//
// Only fresh, finished files: saved in the last 12 hours and unchanged for 5 seconds, so an old
// export left on a Desktop is never posted by surprise and a download still being written is
// left alone. The Desktop is found where Windows really keeps it (OneDrive moves it).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE_PATTERN = /^Landstar_Bulk_.*\.(xlsx|xls)$/i;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SETTLE_MS = 5000;

// Windows' own Desktop setting (OneDrive changes it to ...\OneDrive\Desktop).
function registryDesktop() {
  if (process.platform !== 'win32') return '';
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Desktop'], { encoding: 'utf8', windowsHide: true });
    const value = out.match(/Desktop\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)?.[1]?.trim() || '';
    return value.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
  } catch {
    return '';
  }
}

let cachedFolders = null;
// Every Desktop folder this person may have, that exists (checked once per run).
function desktopFolders() {
  if (cachedFolders) return cachedFolders;
  const candidates = [
    registryDesktop(),
    path.join(os.homedir(), 'Desktop'),
    ...['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'].map(name => (process.env[name] ? path.join(process.env[name], 'Desktop') : ''))
  ].filter(Boolean);
  const seen = new Set();
  cachedFolders = candidates.filter(folder => {
    const key = path.resolve(folder).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    try { return fs.statSync(folder).isDirectory(); } catch { return false; }
  });
  return cachedFolders;
}

// A name not taken in the folder: "x.xlsx", then "x (desktop 2).xlsx", ...
function freeName(folder, name) {
  if (!fs.existsSync(path.join(folder, name))) return name;
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length);
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (desktop ${n})${ext}`;
    if (!fs.existsSync(path.join(folder, candidate))) return candidate;
  }
}

// Moves fresh exports from the Desktop folders into targetFolder. Returns the moved names.
// Under the test runner the real Desktop is never touched unless a test names its folders.
function collectDesktopExports(targetFolder, { now = Date.now(), folders = process.env.NODE_TEST_CONTEXT ? [] : desktopFolders(), maxAgeMs = MAX_AGE_MS, settleMs = SETTLE_MS } = {}) {
  const moved = [];
  const target = path.resolve(targetFolder).toLowerCase();
  for (const folder of folders) {
    if (path.resolve(folder).toLowerCase() === target) continue;
    let names = [];
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names.filter(item => FILE_PATTERN.test(item))) {
      const from = path.join(folder, name);
      try {
        const stat = fs.statSync(from);
        if (!stat.isFile() || stat.size === 0) continue;
        const age = now - stat.mtimeMs;
        if (age > maxAgeMs || age < settleMs) continue;
        fs.mkdirSync(targetFolder, { recursive: true });
        const to = path.join(targetFolder, freeName(targetFolder, name));
        try {
          fs.renameSync(from, to);
        } catch (error) {
          if (error.code !== 'EXDEV') throw error;
          fs.copyFileSync(from, to);
          fs.unlinkSync(from);
        }
        moved.push(path.basename(to));
      } catch (error) {
        // Another bot moved it first, or the file is still locked: try again next check.
        if (!['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      }
    }
  }
  return moved;
}

module.exports = { collectDesktopExports, desktopFolders };
