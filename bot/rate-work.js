const fs = require('fs');
const path = require('path');
const { claim, release, isPrechecked, markPrechecked } = require('./prechecked');

function dedicatedRatesReady(status) {
  if (status?.coordination?.dedicatedRates !== true) return false;
  const helper = status.helper;
  return !helper || helper.state === 'off' || helper.dedicatedRates === true;
}

async function withExportOwnership(files, work) {
  const owned = [];
  try {
    for (const file of files) {
      if (!claim(file)) throw new Error(`Export is already owned by another worker: ${path.basename(file)}`);
      owned.push(file);
    }
    return await work();
  } finally {
    for (const file of owned) release(file);
  }
}

function pendingRateFiles(folder, now = Date.now()) {
  return fs.readdirSync(folder)
    .filter(name => /^Landstar_Bulk_.*\.(xlsx|xls)$/i.test(name))
    .map(name => path.join(folder, name))
    .filter(file => {
      try {
        const stat = fs.statSync(file);
        return stat.isFile() && stat.size > 0 && now - stat.mtimeMs >= 5000 && !isPrechecked(file);
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    })
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
}

async function prepareRateFile(file, { check, skippedFolder }) {
  if (!claim(file)) return { state: 'busy' };
  try {
    if (!fs.existsSync(file)) return { state: 'missing' };
    if (isPrechecked(file)) return { state: 'ready' };
    const results = await check(file);
    const result = results?.[0];
    if (results?.length !== 1 || result?.filePath !== file
      || !Number.isInteger(result.remaining) || result.remaining < 0 || !Array.isArray(result.skips)) {
      throw new Error('Rate worker did not confirm the requested export. Posting remains blocked.');
    }
    if (result.remaining === 0) {
      fs.mkdirSync(skippedFolder, { recursive: true });
      const extension = path.extname(file);
      const base = path.basename(file, extension);
      let destination = path.join(skippedFolder, path.basename(file));
      for (let i = 1; fs.existsSync(destination); i++) destination = path.join(skippedFolder, `${base}__${i}${extension}`);
      fs.renameSync(file, destination);
      return { state: 'skipped', result };
    }
    markPrechecked(file);
    return { state: 'ready', result };
  } finally {
    release(file);
  }
}

module.exports = { pendingRateFiles, prepareRateFile, withExportOwnership, dedicatedRatesReady };
