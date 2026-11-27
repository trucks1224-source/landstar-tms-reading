const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectDesktopExports, desktopFolders } = require('./desktop-exports');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-exports-'));
  const desktop = path.join(root, 'Desktop');
  const downloads = path.join(root, 'Downloads');
  fs.mkdirSync(desktop);
  fs.mkdirSync(downloads);
  return { desktop, downloads };
}
const write = (folder, name, ageMs, now) => {
  const file = path.join(folder, name);
  fs.writeFileSync(file, 'xlsx');
  const when = new Date(now - ageMs);
  fs.utimesSync(file, when, when);
};

test('fresh Landstar exports on the Desktop move to Downloads; nothing else does', () => {
  const { desktop, downloads } = setup();
  const now = Date.now();
  write(desktop, 'Landstar_Bulk_Pha_882255__ATZ.xlsx', 60 * 1000, now);
  write(desktop, 'Landstar_Bulk_Old.xlsx', 13 * 60 * 60 * 1000, now);
  write(desktop, 'Landstar_Bulk_Still_downloading.xlsx', 1000, now);
  write(desktop, 'notes.xlsx', 60 * 1000, now);
  const moved = collectDesktopExports(downloads, { now, folders: [desktop] });
  assert.deepEqual(moved, ['Landstar_Bulk_Pha_882255__ATZ.xlsx']);
  assert.ok(fs.existsSync(path.join(downloads, 'Landstar_Bulk_Pha_882255__ATZ.xlsx')));
  assert.ok(!fs.existsSync(path.join(desktop, 'Landstar_Bulk_Pha_882255__ATZ.xlsx')), 'moved, not copied');
  assert.ok(fs.existsSync(path.join(desktop, 'Landstar_Bulk_Old.xlsx')), 'an old export is never posted by surprise');
  assert.ok(fs.existsSync(path.join(desktop, 'Landstar_Bulk_Still_downloading.xlsx')), 'still being written: next check');
  assert.ok(fs.existsSync(path.join(desktop, 'notes.xlsx')));
});

test('a name already in Downloads is kept: the Desktop copy gets its own name', () => {
  const { desktop, downloads } = setup();
  const now = Date.now();
  write(downloads, 'Landstar_Bulk_X.xlsx', 60 * 1000, now);
  write(desktop, 'Landstar_Bulk_X.xlsx', 60 * 1000, now);
  assert.deepEqual(collectDesktopExports(downloads, { now, folders: [desktop] }), ['Landstar_Bulk_X (desktop 2).xlsx']);
});

test('the Downloads folder itself is never treated as a Desktop', () => {
  const { downloads } = setup();
  const now = Date.now();
  write(downloads, 'Landstar_Bulk_Y.xlsx', 60 * 1000, now);
  assert.deepEqual(collectDesktopExports(downloads, { now, folders: [downloads] }), []);
});

test('finds this PC\'s Desktop folders', () => {
  const folders = desktopFolders();
  assert.ok(Array.isArray(folders));
  folders.forEach(folder => assert.ok(fs.statSync(folder).isDirectory()));
});
