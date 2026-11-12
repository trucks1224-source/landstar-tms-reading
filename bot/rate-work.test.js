const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-worker-'));
process.env.PRECHECKED_FILE = path.join(root, 'prepared.json');
process.env.BOT_NO_STATUS = '1';
const { claim, release, isPrechecked, isLockedByHelper, markPrechecked } = require('./prechecked');
const { pendingRateFiles, prepareRateFile, withExportOwnership, dedicatedRatesReady } = require('./rate-work');
const { submitFileOnce } = require('./upload-safety');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
function fileFor(t, name = 'Landstar_Bulk_test.xlsx') {
  const folder = fs.mkdtempSync(path.join(root, 'case-'));
  const file = path.join(folder, name);
  fs.writeFileSync(file, 'export');
  const modified = new Date(Date.now() - 10000);
  fs.utimesSync(file, modified, modified);
  return { file, folder, skippedFolder: path.join(folder, 'skipped') };
}
const resultFor = file => [{ filePath: file, remaining: 1, skips: [], warnings: [], changes: [] }];

test('only settled Landstar exports without verified handoffs are prepared, in numeric order', t => {
  const { file, folder } = fileFor(t, 'Landstar_Bulk_test_10of20.xlsx');
  const second = path.join(folder, 'Landstar_Bulk_test_2of20.xlsx');
  fs.copyFileSync(file, second);
  const old = new Date(Date.now() - 10000);
  fs.utimesSync(second, old, old);
  fs.writeFileSync(path.join(folder, 'Landstar_Bulk_new.xlsx'), 'downloading');
  fs.writeFileSync(path.join(folder, 'Landstar_Bulk_empty.xlsx'), '');
  fs.writeFileSync(path.join(folder, 'other.xlsx'), 'unrelated');
  assert.deepEqual(pendingRateFiles(folder), [second, file]);
  markPrechecked(second);
  assert.deepEqual(pendingRateFiles(folder), [file]);
});

test('a live file owner never expires, and another claimant cannot release its lock', t => {
  const { file } = fileFor(t);
  assert.equal(claim(file), true);
  try {
    const old = new Date(Date.now() - 24 * 3600000);
    fs.utimesSync(`${file}.helper-lock`, old, old);
    assert.equal(isLockedByHelper(file), true);
    assert.equal(claim(file), false);
    const child = spawnSync(process.execPath, ['-e',
      'const p=require(process.argv[1]); p.release(process.argv[2]); process.exit(p.claim(process.argv[2]) ? 1 : 0);',
      path.join(__dirname, 'prechecked.js'), file], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(isLockedByHelper(file), true);
  } finally { release(file); }
  assert.equal(isLockedByHelper(file), false);
});

test('unknown legacy locks and interrupted acquisition guards fail closed', async t => {
  const paths = fileFor(t);
  const lock = `${paths.file}.helper-lock`;
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 24 * 3600000);
  fs.utimesSync(lock, old, old);
  assert.equal(claim(paths.file), false, 'an old unknown owner is not proof it stopped');
  let calls = 0;
  assert.deepEqual(await prepareRateFile(paths.file, {
    ...paths, check: () => { calls++; }
  }), { state: 'busy' });
  assert.equal(calls, 0);
  fs.unlinkSync(lock);
  fs.writeFileSync(`${lock}.guard`, 'interrupted acquisition');
  assert.equal(claim(paths.file), false);
  assert.equal(isLockedByHelper(paths.file), true);
});

test('a confirmed dead owner can be recovered without trusting an age-based timeout', t => {
  const { file } = fileFor(t);
  const child = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  fs.writeFileSync(`${file}.helper-lock`, JSON.stringify({ pid: child.pid, token: 'dead-owner' }));
  assert.equal(claim(file), true);
  release(file);
});

test('ready markers require the exact contents, not just file size and timestamp', t => {
  const { file } = fileFor(t);
  markPrechecked(file);
  const stat = fs.statSync(file);
  assert.equal(isPrechecked(file), true);
  fs.writeFileSync(file, 'edited');
  fs.utimesSync(file, stat.atime, stat.mtime);
  assert.equal(fs.statSync(file).size, stat.size);
  assert.equal(isPrechecked(file), false);
});

test('legacy stamp-only ready markers and malformed manifests cannot bypass rate checks', t => {
  const { file } = fileFor(t);
  const saved = fs.existsSync(process.env.PRECHECKED_FILE) ? fs.readFileSync(process.env.PRECHECKED_FILE) : null;
  try {
    const stat = fs.statSync(file);
    fs.writeFileSync(process.env.PRECHECKED_FILE, JSON.stringify({
      [path.resolve(file)]: { stamp: `${stat.size}|${Math.round(stat.mtimeMs)}`, at: Date.now() }
    }));
    assert.equal(isPrechecked(file), false);
    fs.writeFileSync(process.env.PRECHECKED_FILE, 'truncated');
    assert.throws(() => isPrechecked(file), /Cannot read rate-check handoff/);
  } finally {
    if (saved) fs.writeFileSync(process.env.PRECHECKED_FILE, saved);
    else fs.unlinkSync(process.env.PRECHECKED_FILE);
  }
});

test('failed or unrelated rate results never publish a ready marker and always release ownership', async t => {
  const paths = fileFor(t);
  await assert.rejects(prepareRateFile(paths.file, {
    ...paths, check: async () => { throw new Error('board unavailable'); }
  }), /board unavailable/);
  assert.equal(isPrechecked(paths.file), false);
  assert.equal(isLockedByHelper(paths.file), false);
  await assert.rejects(prepareRateFile(paths.file, {
    ...paths, check: async () => resultFor('different export')
  }), /did not confirm the requested export/);
  assert.equal(isPrechecked(paths.file), false);
});

test('fully skipped exports are archived collision-safely without becoming upload candidates', async t => {
  const paths = fileFor(t);
  fs.mkdirSync(paths.skippedFolder);
  fs.writeFileSync(path.join(paths.skippedFolder, path.basename(paths.file)), 'previous export');
  const result = await prepareRateFile(paths.file, {
    ...paths, check: async file => [{ filePath: file, remaining: 0, skips: [2] }]
  });
  assert.equal(result.state, 'skipped');
  assert.equal(fs.existsSync(paths.file), false);
  assert.equal(fs.readdirSync(paths.skippedFolder).length, 2);
  assert.equal(fs.readFileSync(path.join(paths.skippedFolder, path.basename(paths.file)), 'utf8'), 'previous export');
});

test('posting owns the prepared export through final validation and reservation, then archives once', async t => {
  const paths = fileFor(t);
  const reviewFolder = path.join(paths.folder, 'review');
  const uploadedFolder = path.join(paths.folder, 'uploaded');
  const prepared = await prepareRateFile(paths.file, { ...paths, check: async file => {
    assert.equal(claim(file), false, 'posting cannot take a file during preparation');
    fs.writeFileSync(file, 'rate-adjusted export');
    return resultFor(file);
  } });
  assert.equal(prepared.state, 'ready');
  assert.equal(isPrechecked(paths.file), true);
  let submissions = 0;
  await withExportOwnership([paths.file], () => submitFileOnce({ evaluate: async () => 0 }, paths.file, {
    reviewFolder, uploadedFolder,
    verify: file => assert.equal(isPrechecked(file), true),
    submit: async (_page, reserved) => {
      submissions++;
      assert.equal(claim(paths.file), false, 'no rate edit during upload');
      assert.equal(path.dirname(reserved), reviewFolder);
      assert.equal(fs.readFileSync(reserved, 'utf8'), 'rate-adjusted export');
    }
  }));
  assert.equal(submissions, 1);
  assert.equal(fs.existsSync(paths.file), false);
  assert.equal(fs.readdirSync(uploadedFolder).length, 1);
  assert.equal(isLockedByHelper(paths.file), false);
});

test('a file changed while checking portal errors is not submitted or reserved', async t => {
  const paths = fileFor(t);
  markPrechecked(paths.file);
  let submitted = false;
  const page = { evaluate: async () => { fs.writeFileSync(paths.file, 'new contents'); return 0; } };
  await assert.rejects(withExportOwnership([paths.file], () => submitFileOnce(page, paths.file, {
    reviewFolder: path.join(paths.folder, 'review'), uploadedFolder: path.join(paths.folder, 'uploaded'),
    verify: file => { if (!isPrechecked(file)) throw new Error('Export changed after its rate check'); },
    submit: async () => { submitted = true; }
  })), /Export changed/);
  assert.equal(submitted, false);
  assert.equal(fs.existsSync(paths.file), true);
  assert.equal(isLockedByHelper(paths.file), false);
});

test('batch ownership releases earlier claims when a later export is owned elsewhere', async t => {
  const first = fileFor(t).file;
  const second = fileFor(t).file;
  assert.equal(claim(second), true);
  try {
    await assert.rejects(withExportOwnership([first, second], async () => assert.fail('must not run')), /already owned/);
    assert.equal(isLockedByHelper(first), false);
    assert.equal(isLockedByHelper(second), true);
  } finally { release(second); }
});

test('migration waits for dedicated posting and a dedicated or stopped helper', () => {
  assert.equal(dedicatedRatesReady({}), false);
  assert.equal(dedicatedRatesReady({ coordination: { dedicatedRates: false } }), false);
  const posting = { coordination: { dedicatedRates: true } };
  assert.equal(dedicatedRatesReady(posting), true);
  assert.equal(dedicatedRatesReady({ ...posting, helper: { state: 'working' } }), false);
  assert.equal(dedicatedRatesReady({ ...posting, helper: { state: 'starting' } }), false);
  assert.equal(dedicatedRatesReady({ ...posting, helper: { state: 'off' } }), true);
  assert.equal(dedicatedRatesReady({ ...posting, helper: { state: 'working', dedicatedRates: true } }), true);
});
