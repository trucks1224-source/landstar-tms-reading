const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { closeSuccessfulUploadConfirmation } = require('./upload-completion');

function fakePage(text, { button = true, backdrop = true } = {}) {
  let clicked = 0;
  const done = { innerText: 'Done', disabled: false, click: () => { clicked += 1; backdrop = false; } };
  const dialog = { innerText: text, querySelectorAll: () => button ? [done] : [] };
  const document = {
    querySelector: () => backdrop ? {} : null,
    querySelectorAll: () => text ? [dialog] : []
  };
  return {
    get clicked() { return clicked; },
    waitForFunction: async callback => {
      const value = vm.runInNewContext(`(${callback.toString()})()`, { document });
      if (!value) throw new Error('Timeout 180000ms exceeded.');
      return { jsonValue: async () => value };
    },
    evaluate: async callback => vm.runInNewContext(`(${callback.toString()})()`, { document, Array, Set })
  };
}

test('closes the confirmation only after all loads were created', async () => {
  const page = fakePage('TMS Loads Upload Complete\n10 of 10 Loads were successfully created');
  assert.equal((await closeSuccessfulUploadConfirmation(page)).state, 'confirmed');
  assert.equal(page.clicked, 1);
});

test('incomplete or unrecognized results stay in review', async () => {
  for (const text of [
    'TMS Loads Upload Complete\n9 of 10 Loads were successfully created',
    'TMS Loads Upload Complete\n0 of 0 Loads were successfully created',
    'TMS Loads Upload Complete\nUnexpected result'
  ]) {
    const page = fakePage(text);
    await assert.rejects(closeSuccessfulUploadConfirmation(page), /did not confirm every load/);
    assert.equal(page.clicked, 0);
  }
});

test('a partially complete upload is returned for the draft check, not clicked', async () => {
  const page = fakePage('TMS Loads Upload Partially Complete\n14 of 15 Loads were successfully created\nCORRECT POSTING ERRORS');
  assert.equal((await closeSuccessfulUploadConfirmation(page)).state, 'partial');
  assert.equal(page.clicked, 0);
});

test('missing Done button and other overlays do not count as success', async () => {
  const page = fakePage('TMS Loads Upload Complete\n10 of 10 Loads were successfully created', { button: false });
  await assert.rejects(closeSuccessfulUploadConfirmation(page), /Done button was unavailable/);
  await assert.rejects(closeSuccessfulUploadConfirmation(fakePage('Other dialog')), /never showed the upload result/);
});

test('no result window yet is not success (11/23: 224 loads left as drafts)', async () => {
  await assert.rejects(closeSuccessfulUploadConfirmation(fakePage('', { backdrop: false })), /never showed the upload result/);
});

test('a timed-out upload says what Landstar showed instead (AMERI, 2026-11-25)', async () => {
  await assert.rejects(closeSuccessfulUploadConfirmation(fakePage('Upload Failed\n  Customer   18347 is not valid')),
    /never showed the upload result.*Landstar showed: Upload Failed Customer 18347 is not valid/);
  await assert.rejects(closeSuccessfulUploadConfirmation(fakePage('', { backdrop: false })), /No Landstar message was on screen/);
});

test('"TMS Loads Upload Unsuccessful" is a rejection, reported at once and left on screen', async () => {
  const page = fakePage('TMS Loads Upload Unsuccessful We found issues with your 1 loads. CORRECT POSTING ERRORS');
  await assert.rejects(closeSuccessfulUploadConfirmation(page), /Landstar rejected the upload: TMS Loads Upload Unsuccessful We found issues with your 1 loads/);
  assert.equal(page.clicked, 0, 'Correct Posting Errors is not clicked');
});
