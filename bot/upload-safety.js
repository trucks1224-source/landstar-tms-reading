const fs = require('fs');
const path = require('path');

async function readBulkErrors(page) {
  return page.evaluate(async () => {
    let user;
    for (const storage of [sessionStorage, localStorage]) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!/^oidc\.user:/i.test(key)) continue;
        const candidate = JSON.parse(storage.getItem(key));
        if (candidate?.access_token && candidate.profile?.ls_unique_id) user = candidate;
      }
    }
    if (!user) throw new Error('Cannot check bulk errors: Landstar sign-in is missing.');
    const response = await fetch('/loadboards/v1/bulkUpload/unpostedDrafts?pageIndex=0&pageSize=1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loadStatuses: ['Active'], userId: String(user.profile.ls_unique_id),
        sortColumn: 'PostingNumber', sortType: 'Desc', lockedInRate: false,
      }),
    });
    if (!response.ok) throw new Error(`Cannot check bulk errors: HTTP ${response.status}.`);
    const result = await response.json();
    if (!Number.isInteger(result.count) || result.count < 0 || !Array.isArray(result.data)) {
      throw new Error('Cannot check bulk errors: unexpected Landstar response.');
    }
    return result.count;
  });
}

function reviewFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder)
    .filter(name => /\.(xlsx|xls)$/i.test(name))
    .map(name => path.join(folder, name))
    .filter(file => fs.statSync(file).isFile());
}

async function assertUploadReady(page, reviewFolder) {
  if (reviewFiles(reviewFolder).length) {
    throw new Error(`Uploads paused: check Landstar for the export in ${reviewFolder} before moving it out of review.`);
  }
  const count = await readBulkErrors(page);
  if (count) throw new Error(`Uploads paused: ${count} Landstar bulk error draft(s) need review. No new file was submitted.`);
}

function uniqueTarget(folder, file) {
  fs.mkdirSync(folder, { recursive: true });
  const name = path.basename(file);
  let target = path.join(folder, name);
  for (let i = 1; fs.existsSync(target); i += 1) {
    target = path.join(folder, `${path.basename(name, path.extname(name))}__${i}${path.extname(name)}`);
  }
  return target;
}

async function submitFileOnce(page, file, { reviewFolder, uploadedFolder, submit, verify }) {
  await assertUploadReady(page, reviewFolder);
  if (verify) verify(file);
  const reserved = uniqueTarget(reviewFolder, file);
  // Reserve before attaching: a crash or timeout must not replay a possibly accepted file.
  fs.renameSync(file, reserved);
  try {
    await submit(page, reserved);
    const count = await readBulkErrors(page);
    if (count) throw new Error(`Landstar reports ${count} bulk error draft(s); upload acceptance is not posting success.`);
    fs.renameSync(reserved, uniqueTarget(uploadedFolder, file));
  } catch (error) {
    throw new Error(`Uploads paused: ${error.message} Check the submitted file in ${reviewFolder}; it will not be automatically resent.`, { cause: error });
  }
}

module.exports = { readBulkErrors, reviewFiles, assertUploadReady, submitFileOnce };
