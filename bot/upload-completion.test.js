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
    querySelectorAll: () => [dialog]
  };
  return {
    get clicked() { return clicked; },
    waitForFunction: async callback => {
      const value = vm.runInNewContext(`(${callback.toString()})()`, { document });
      if (!value) throw new Error('timed out');
      return { jsonValue: async () => value };
    }
  };
}

test('closes the confirmation only after all loads were created', async () => {
  const page = fakePage('TMS Loads Upload Complete\n10 of 10 Loads were successfully created');
  await closeSuccessfulUploadConfirmation(page);
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

test('missing Done button and other overlays do not count as success', async () => {
  const page = fakePage('TMS Loads Upload Complete\n10 of 10 Loads were successfully created', { button: false });
  await assert.rejects(closeSuccessfulUploadConfirmation(page), /Done button was unavailable/);
  await assert.rejects(closeSuccessfulUploadConfirmation(fakePage('Other dialog')), /timed out/);
  await closeSuccessfulUploadConfirmation(fakePage('', { backdrop: false }));
});
