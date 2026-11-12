const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'landstar-control-'));
const file = path.join(directory, 'control.json');
process.env.LOCAL_BOT_CONTROL_FILE = file;
const { readBotControl, writeBotControl } = require('./local-bot-control');

test('local control persists on and off without changing posting policy', () => {
  assert.equal(readBotControl(), true);
  writeBotControl(false);
  assert.equal(readBotControl(), false);
  writeBotControl(true);
  assert.equal(readBotControl(), true);
  assert.throws(() => writeBotControl('false'), /on or off/);
});

test('corrupt local control fails closed rather than silently enabling bots', () => {
  fs.writeFileSync(file, '{"enabled":"yes"}');
  assert.throws(() => readBotControl(), /Invalid local bot control/);
});

test.after(() => {
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
});
