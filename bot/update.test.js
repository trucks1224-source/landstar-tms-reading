const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyUpdate, updateAvailable } = require('./update');

const remote = files => async url => {
  const name = String(url).split('?')[0].split('/').pop();
  if (!(name in files)) return { ok: false, status: 404, text: async () => '' };
  return { ok: true, status: 200, text: async () => files[name] };
};

test('a teammate bot takes the new files from GitHub, keeps a .bak, never touches private files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teambot-'));
  fs.writeFileSync(path.join(dir, 'upload.js'), 'console.log("old");');
  fs.writeFileSync(path.join(dir, 'rate-check.js'), 'module.exports = 1;');
  fs.writeFileSync(path.join(dir, 'agent-config.json'), '{"postingCodes":["SNB"]}');
  const files = {
    'team-files.json': JSON.stringify({ files: ['upload.js', 'rate-check.js', 'agent-config.json', 'unpost-queue.json'] }),
    'upload.js': 'console.log("new");',
    'rate-check.js': 'module.exports = 1;',
    'agent-config.json': '{"postingCodes":["ANQ"]}',
    'unpost-queue.json': '[]'
  };
  assert.equal(await updateAvailable({ dir, base: 'https://x/bot/', fetchImpl: remote(files) }), true);
  const result = await applyUpdate({ dir, base: 'https://x/bot/', fetchImpl: remote(files), log: () => {} });
  assert.deepEqual(result.changed, ['upload.js']);
  assert.equal(fs.readFileSync(path.join(dir, 'upload.js'), 'utf8'), 'console.log("new");');
  assert.equal(fs.readFileSync(path.join(dir, 'upload.js.bak'), 'utf8'), 'console.log("old");');
  assert.equal(fs.readFileSync(path.join(dir, 'agent-config.json'), 'utf8'), '{"postingCodes":["SNB"]}', 'their posting code is never replaced');
  assert.equal(fs.existsSync(path.join(dir, 'unpost-queue.json')), false, 'queues are never downloaded');
  assert.equal(await updateAvailable({ dir, base: 'https://x/bot/', fetchImpl: remote(files) }), false, 'now up to date');
});

test('one broken file means no update at all (the bot keeps the code it has)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teambot-'));
  fs.writeFileSync(path.join(dir, 'upload.js'), 'console.log("old");');
  fs.writeFileSync(path.join(dir, 'rate-check.js'), 'module.exports = 1;');
  const files = {
    'team-files.json': JSON.stringify({ files: ['upload.js', 'rate-check.js'] }),
    'upload.js': 'console.log("new");',
    'rate-check.js': 'module.exports = {'
  };
  await assert.rejects(applyUpdate({ dir, base: 'https://x/bot/', fetchImpl: remote(files), log: () => {} }));
  assert.equal(fs.readFileSync(path.join(dir, 'upload.js'), 'utf8'), 'console.log("old");', 'nothing was swapped');
  assert.equal(await updateAvailable({ dir, base: 'https://x/bot/', fetchImpl: remote({}) }), false, 'no internet: no update, no crash');
});
