const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPostingCodes } = require('./agent-config');

function configFile(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'agent-config.json');
  if (contents !== undefined) fs.writeFileSync(file, contents);
  return file;
}

test('reads this computer\'s posting codes, cleaned up', t => {
  assert.deepEqual(readPostingCodes(configFile(t, '{"postingCodes":[" xyz ","XYZ","ab1"]}')), ['XYZ', 'AB1']);
});

test('a missing, empty or malformed setting refuses to guess a code', t => {
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  t.after(() => { if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved; });
  assert.throws(() => readPostingCodes(configFile(t)), /no posting code set up/);
  assert.throws(() => readPostingCodes(configFile(t, '{"postingCodes":[]}')), /needs "postingCodes"/);
  assert.throws(() => readPostingCodes(configFile(t, '{"postingCodes":["A B C"]}')), /needs "postingCodes"/);
  assert.throws(() => readPostingCodes(configFile(t, 'not json')), /Could not read/);
});
