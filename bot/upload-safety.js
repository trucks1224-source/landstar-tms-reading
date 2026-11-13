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

async function readBulkErrorReport(page) {
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
    if (!user) throw new Error('Cannot collect draft details: Landstar sign-in is missing.');
    const headers = { Authorization: `Bearer ${user.access_token}`, 'Content-Type': 'application/json' };
    const response = await fetch('/loadboards/v1/bulkUpload/unpostedDrafts?pageIndex=0&pageSize=200', {
      method: 'POST', headers,
      body: JSON.stringify({
        loadStatuses: ['Active'], userId: String(user.profile.ls_unique_id),
        sortColumn: 'PostingNumber', sortType: 'Desc', lockedInRate: false,
      }),
    });
    if (!response.ok) throw new Error(`Cannot collect draft details: HTTP ${response.status}.`);
    const result = await response.json();
    if (!Number.isInteger(result.count) || result.count < 0 || !Array.isArray(result.data)) {
      throw new Error('Cannot collect draft details: unexpected Landstar response.');
    }
    const drafts = [];
    for (const draft of result.data) {
      const { batchId, draftId } = draft;
      if (batchId == null || draftId == null) throw new Error('Cannot collect draft details: missing draft identifiers.');
      const detail = await fetch(`/loadboards/v1/bulkUpload/batch/${encodeURIComponent(batchId)}/draft/${encodeURIComponent(draftId)}/details`, { headers });
      if (!detail.ok) throw new Error(`Cannot collect draft ${draftId}: HTTP ${detail.status}.`);
      drafts.push({ batchId, draftId, listing: draft, details: await detail.json() });
    }
    return {
      count: result.count,
      truncated: result.count > result.data.length,
      pageText: document.body?.innerText?.slice(0, 10000) || '',
      drafts,
    };
  });
}

async function writeBulkErrorReport(page, reserved, observedCount) {
  const reportPath = `${reserved}.review.json`;
  const report = {
    capturedAt: new Date().toISOString(),
    file: path.basename(reserved),
    observedCount,
  };
  try {
    report.landstar = await readBulkErrorReport(page);
  } catch (error) {
    report.captureError = error.message;
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  return reportPath;
}

function reviewFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder)
    .filter(name => /\.(xlsx|xls)$/i.test(name))
    .map(name => path.join(folder, name))
    .filter(file => fs.statSync(file).isFile());
}

async function assertUploadReady(page, reviewFolder) {
  await readBulkErrors(page);
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
    if (count) {
      const draftFolder = path.join(path.dirname(reviewFolder), 'landstar-upload-errors');
      const draftFile = uniqueTarget(draftFolder, file);
      fs.renameSync(reserved, draftFile);
      let reportMessage;
      try {
        reportMessage = `Details saved to ${await writeBulkErrorReport(page, draftFile, count)}.`;
      } catch (error) {
        reportMessage = `Could not save error details: ${error.message}.`;
      }
      return { state: 'drafts', file: draftFile, count, message: `Landstar reports ${count} bulk error draft(s); posting is not confirmed. ${reportMessage}` };
    }
    fs.renameSync(reserved, uniqueTarget(uploadedFolder, file));
    return { state: 'uploaded' };
  } catch (error) {
    const uncertain = new Error(`Submission outcome unknown: ${error.message} Check ${reserved} on Landstar; it will not be automatically resent.`, { cause: error });
    uncertain.uncertainUpload = true;
    uncertain.file = reserved;
    throw uncertain;
  }
}

module.exports = { readBulkErrors, readBulkErrorReport, reviewFiles, assertUploadReady, submitFileOnce };
