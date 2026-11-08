const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('the helper claims a file once, and a checked file stays checked until it changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prechecked-'));
  process.env.PRECHECKED_FILE = path.join(dir, 'prechecked.json');
  delete require.cache[require.resolve('./prechecked')];
  const { claim, release, isLockedByHelper, isPrechecked, markPrechecked } = require('./prechecked');
  const file = path.join(dir, 'Landstar_Bulk_X_3of9.xlsx');
  fs.writeFileSync(file, 'a');
  assert.equal(claim(file), true);
  assert.equal(claim(file), false, 'second claim fails: the bots never share a file');
  assert.equal(isLockedByHelper(file), true);
  release(file);
  assert.equal(isLockedByHelper(file), false);
  assert.equal(isPrechecked(file), false);
  markPrechecked(file);
  assert.equal(isPrechecked(file), true);
  fs.writeFileSync(file, 'changed content');
  assert.equal(isPrechecked(file), false, 'a changed file is checked again');
});
