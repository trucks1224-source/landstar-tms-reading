const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { readBulkErrors, assertUploadReady, submitFileOnce, reviewFiles } = require('./upload-safety');

function fakePage(counts = [0], { status = 200, signedIn = true, body } = {}) {
  const session = JSON.stringify({ access_token: 'test-token', profile: { ls_unique_id: 123 } });
  const storage = {
    length: signedIn ? 1 : 0, key: () => 'oidc.user:test',
    getItem: () => session,
  };
  return {
    evaluate: callback => vm.runInNewContext(`(${callback.toString()})()`, {
      sessionStorage: storage, localStorage: { length: 0 },
      fetch: async (url, options) => {
        assert.match(url, /unpostedDrafts\?pageIndex=0&pageSize=1$/);
        assert.equal(options.method, 'POST');
        assert.equal(JSON.parse(options.body).userId, '123');
        const count = counts.length > 1 ? counts.shift() : counts[0];
        return { ok: status === 200, status, json: async () => body || { count, data: [] } };
      },
    }),
  };
}

function folders(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-safety-'));
  const reviewFolder = path.join(root, 'review');
  const uploadedFolder = path.join(root, 'uploaded');
  const file = path.join(root, 'Landstar_Bulk_test.xlsx');
  fs.writeFileSync(file, 'export');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file, reviewFolder, uploadedFolder };
}

test('reads the total error count, not the first page length', async () => {
  assert.equal(await readBulkErrors(fakePage([15])), 15);
});

test('missing sign-in, failed requests and malformed counts fail closed', async () => {
  await assert.rejects(readBulkErrors(fakePage([0], { signedIn: false })), /sign-in is missing/);
  await assert.rejects(readBulkErrors(fakePage([0], { status: 429 })), /HTTP 429/);
  await assert.rejects(readBulkErrors(fakePage([0], { body: { data: [] } })), /unexpected/);
  await assert.rejects(readBulkErrors(fakePage([0], { body: { count: -1, data: [] } })), /unexpected/);
});

test('existing error drafts do not prevent submission but are not reported as success', async t => {
  const paths = folders(t);
  let calls = 0;
  const result = await submitFileOnce(fakePage([2]), paths.file, {
    ...paths, submit: async () => { calls += 1; },
  });
  assert.equal(result.state, 'drafts');
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(result.file), true);
  assert.equal(reviewFiles(paths.reviewFolder).length, 0);
});

test('successful submission is reserved first then archived without overwriting', async t => {
  const paths = folders(t);
  fs.mkdirSync(paths.uploadedFolder);
  fs.writeFileSync(path.join(paths.uploadedFolder, path.basename(paths.file)), 'old export');
  await submitFileOnce(fakePage([0, 0]), paths.file, {
    ...paths, submit: async (_page, reserved) => {
      assert.equal(path.dirname(reserved), paths.reviewFolder);
      assert.equal(fs.existsSync(paths.file), false);
      assert.equal(fs.readFileSync(reserved, 'utf8'), 'export');
    },
  });
  assert.equal(reviewFiles(paths.reviewFolder).length, 0);
  assert.equal(fs.readdirSync(paths.uploadedFolder).length, 2);
});

test('timeout preserves the submitted file without blocking later files', async t => {
  const paths = folders(t);
  let calls = 0;
  await assert.rejects(submitFileOnce(fakePage([0]), paths.file, {
    ...paths, submit: async () => { calls += 1; throw new Error('timeout after sending'); },
  }), /will not be automatically resent/);
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(paths.file), false);
  assert.equal(reviewFiles(paths.reviewFolder).length, 1);
  await assertUploadReady(fakePage([0]), paths.reviewFolder);
  const next = path.join(paths.root, 'Landstar_Bulk_next.xlsx');
  fs.writeFileSync(next, 'next export');
  const result = await submitFileOnce(fakePage([0]), next, {
    ...paths, submit: async () => { calls += 1; },
  });
  assert.equal(result.state, 'uploaded');
  assert.equal(calls, 2);
  assert.equal(reviewFiles(paths.reviewFolder).length, 1);
});

test('new error drafts preserve the file separately without stopping the batch', async t => {
  const paths = folders(t);
  const result = await submitFileOnce(fakePage([0, 3]), paths.file, {
    ...paths, submit: async () => {},
  });
  assert.equal(result.state, 'drafts');
  assert.equal(result.count, 3);
  assert.equal(reviewFiles(paths.reviewFolder).length, 0);
  assert.equal(fs.existsSync(result.file), true);
  assert.equal(fs.existsSync(paths.uploadedFolder), false);
  const report = JSON.parse(fs.readFileSync(`${result.file}.review.json`, 'utf8'));
  assert.equal(report.observedCount, 3);
  assert.match(report.captureError, /.+/);
});

test('draft diagnostics save count, page and details without credentials', async t => {
  const paths = folders(t);
  let calls = 0;
  const page = {
    evaluate: async () => {
      calls += 1;
      if (calls === 1) return 0;
      if (calls === 2) return 2;
      return { count: 2, truncated: false, pageText: '2 Errors', drafts: [{ batchId: 7, draftId: 8, details: { reason: 'Invalid date' } }] };
    },
  };
  const result = await submitFileOnce(page, paths.file, { ...paths, submit: async () => {} });
  assert.match(result.message, /Details saved to/);
  const report = JSON.parse(fs.readFileSync(`${result.file}.review.json`, 'utf8'));
  assert.equal(report.observedCount, 2);
  assert.equal(report.landstar.drafts[0].details.reason, 'Invalid date');
  assert.equal(report.landstar.pageText, '2 Errors');
  assert.equal(reviewFiles(paths.reviewFolder).length, 0);
});
test('failed post-submit error check is uncertain, not a successful upload', async t => {
  const paths = folders(t);
  const page = fakePage([0]);
  await assert.rejects(submitFileOnce(page, paths.file, {
    ...paths, submit: async () => { page.evaluate = async () => { throw new Error('disconnected'); }; },
  }), /disconnected/);
  assert.equal(reviewFiles(paths.reviewFolder).length, 1);
});
