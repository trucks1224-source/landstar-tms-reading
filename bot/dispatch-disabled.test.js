const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-disabled-'));
process.env.MG_QUEUE_FILE = path.join(dir, 'queue.json');
const { runMercuryGateJob, runNextMercuryGateJob, hasDueMercuryGateJob } = require('./mercurygate-job');
const { enqueueMercuryGate } = require('./status-server');

test('disabled dispatch rejects new jobs and cannot run existing jobs or direct dispatch', async () => {
  const queue = JSON.stringify([{ loadId: '2283184', step: 'booked', mode: 'save' }]);
  fs.writeFileSync(process.env.MG_QUEUE_FILE, queue);
  assert.throws(() => enqueueMercuryGate([{ loadId: '2283184' }]), /dispatch is disabled/i);
  assert.equal(hasDueMercuryGateJob(), false);
  assert.equal(await runNextMercuryGateJob(null), undefined);
  await assert.rejects(runMercuryGateJob(null, { loadId: '2283184' }), /dispatch is disabled/i);
  assert.equal(fs.readFileSync(process.env.MG_QUEUE_FILE, 'utf8'), queue);
});

test('direct dispatch CLI exits before opening a browser', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'mercurygate-job.js'), '2283184', 'test', '--save'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dispatch is disabled/i);
});

test.after(() => {
  fs.rmSync(process.env.MG_QUEUE_FILE, { force: true });
  fs.rmdirSync(dir);
});
