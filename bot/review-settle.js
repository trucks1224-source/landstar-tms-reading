// Uploads Landstar never confirmed (2026-11-27: six files where Landstar's last step answered
// "504 Gateway Timeout") wait in Downloads\landstar-upload-review, and the TMS shows "uploads to
// check on Landstar" until someone deletes them. When the duplicate check reads the board,
// every file whose loads are ALL posted did go through: it moves to landstar-uploaded (so it
// counts as posted) and its screenshot/reply notes go to the review archive. A file with any
// load missing stays for Daniel to check. Tested in review-settle.test.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { postingSignature, fileSignatures, UPLOADED_FOLDER } = require('./bot-postings');

const REVIEW_FOLDER = path.join(os.homedir(), 'Downloads', 'landstar-upload-review');
const ARCHIVE_FOLDER = path.join(os.homedir(), 'Downloads', 'landstar-upload-review-archive');

function moveInto(file, folder) {
  fs.mkdirSync(folder, { recursive: true });
  let target = path.join(folder, path.basename(file));
  if (fs.existsSync(target)) {
    const { name, ext } = path.parse(target);
    target = path.join(folder, `${name} (${Date.now()})${ext}`);
  }
  fs.renameSync(file, target);
  return target;
}

// { settled: [file names], waiting: [{ file, found, total }] }
function settleReviewFiles(postings, {
  reviewFolder = REVIEW_FOLDER, uploadedFolder = UPLOADED_FOLDER, archiveFolder = ARCHIVE_FOLDER, log = () => {}
} = {}) {
  const result = { settled: [], waiting: [] };
  if (!fs.existsSync(reviewFolder) || !Array.isArray(postings) || !postings.length) return result;
  const board = new Set(postings.map(postingSignature));
  const names = fs.readdirSync(reviewFolder);
  for (const name of names.filter(item => /\.(xlsx|xls)$/i.test(item))) {
    const file = path.join(reviewFolder, name);
    let signatures = [];
    try { signatures = fileSignatures(file); } catch { continue; }
    if (!signatures.length) continue;
    const found = signatures.filter(signature => board.has(signature)).length;
    if (found < signatures.length) {
      result.waiting.push({ file: name, found, total: signatures.length });
      continue;
    }
    moveInto(file, uploadedFolder);
    const base = name.replace(/\.(xlsx|xls)$/i, '');
    names.filter(item => item !== name && item.startsWith(`${base} - Landstar`))
      .forEach(item => { try { moveInto(path.join(reviewFolder, item), archiveFolder); } catch { /* stays */ } });
    result.settled.push(name);
    log(`  ${name}: all ${signatures.length} load(s) are on the board, so it did post. Cleared from the review folder.`);
  }
  if (result.waiting.length) {
    log(`  Still to check on Landstar: ${result.waiting.map(item => `${item.file} (${item.found} of ${item.total} on the board)`).join('; ')}.`);
  }
  return result;
}

module.exports = { settleReviewFiles, REVIEW_FOLDER, ARCHIVE_FOLDER };
