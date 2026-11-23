const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A one-off script that signs in to Landstar through the shared bot code must not open the
// posting bot's status address (it used to, and passed for the posting bot while it was down).
test('a one-off script never opens the posting bot status address', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-port-'));
  const script = path.join(dir, 'analyze.js');
  fs.writeFileSync(script, `
    const status = require(${JSON.stringify(path.join(__dirname, 'status-server.js'))});
    status.setStatus('logged-in', 'pretending to be the posting bot');
    status.setProgress({ uploaded: 1, waiting: 2 });
    console.log(status.servingStatus() ? 'SERVING' : 'NOT SERVING');
  `);
  const env = { ...process.env };
  delete env.BOT_NO_STATUS;
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 20000 });
  assert.match(result.stdout, /NOT SERVING/, result.stderr || result.stdout);
});
