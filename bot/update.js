// Teammates' bots update themselves from GitHub (Daniel 2026-11-27: no more zips to pass
// around; nobody stays on an old copy). Run by a teammate's "Start Landstar Bot" before the
// bot starts, and asked by the running bot every 30 minutes (updateAvailable).
//
// The file list is bot/team-files.json on GitHub (teammate-setup\build.ps1 writes it). Every
// listed file is downloaded and checked first (JavaScript must compile, JSON must parse); only
// when ALL are good are the changed ones swapped in, each kept as *.bak. Private files (sign-ins,
// posting code, queues, protected loads) are never in the list and never touched. No internet,
// or anything odd: the bot just starts on the code it has.
//   node update.js           update now (prints what changed)
//   node update.js --check   only say whether an update is waiting (exit code 10 = yes)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAW_BASE = process.env.TEAM_UPDATE_BASE || 'https://raw.githubusercontent.com/trucks1224-source/landstar-tms-reading/main/bot/';
const PRIVATE = /^(agent-config|protected-loads|auth|uploaded-ledger|.*queue.*|.*-state|.*-status|bot-results)\.json$|^\.env|browser-profile/i;
const SAFE_NAME = /^[\w.-]+\.(js|cjs|json)$/;

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

// Does this file look whole and working?
function checkFile(name, text) {
  if (!text || !text.trim()) throw new Error(`${name} is empty`);
  if (name.endsWith('.json')) JSON.parse(text);
  else new vm.Script(text.replace(/^#!.*\n/, ''), { filename: name });
}

// The remote file list and contents: [{ name, text }] (throws on anything wrong).
async function downloadTeamFiles({ base = RAW_BASE, fetchImpl = fetch } = {}) {
  const manifest = JSON.parse(await fetchText(`${base}team-files.json`, fetchImpl));
  const names = (manifest.files || []).filter(name => SAFE_NAME.test(name) && !PRIVATE.test(name));
  if (!names.includes('upload.js')) throw new Error('team-files.json has no upload.js');
  const files = [];
  for (const name of names) {
    const text = await fetchText(`${base}${name}`, fetchImpl);
    checkFile(name, text);
    files.push({ name, text });
  }
  return files;
}

const changedFiles = (files, dir) => files.filter(({ name, text }) => {
  try { return fs.readFileSync(path.join(dir, name), 'utf8') !== text; } catch { return true; }
});

// { changed: [names], packagesChanged }
async function applyUpdate({ dir = __dirname, base = RAW_BASE, fetchImpl = fetch, log = console.log } = {}) {
  const files = await downloadTeamFiles({ base, fetchImpl });
  const changed = changedFiles(files, dir);
  if (!changed.length) return { changed: [], packagesChanged: false };
  // Write every new file next to its old one first, then swap them all in.
  for (const { name, text } of changed) fs.writeFileSync(path.join(dir, `${name}.new`), text);
  for (const { name } of changed) {
    const target = path.join(dir, name);
    if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
    fs.renameSync(`${target}.new`, target);
  }
  const packagesChanged = changed.some(({ name }) => name === 'package.json' || name === 'package-lock.json');
  log(`Bot updated: ${changed.map(file => file.name).join(', ')}.`);
  return { changed: changed.map(file => file.name), packagesChanged };
}

// Is newer code waiting on GitHub? (The running bot asks every 30 minutes.)
async function updateAvailable({ dir = __dirname, base = RAW_BASE, fetchImpl = fetch } = {}) {
  try {
    return changedFiles(await downloadTeamFiles({ base, fetchImpl }), dir).length > 0;
  } catch {
    return false;
  }
}

module.exports = { applyUpdate, updateAvailable, downloadTeamFiles, checkFile, PRIVATE };

if (require.main === module) {
  (async () => {
    if (process.argv.includes('--check')) {
      const waiting = await updateAvailable();
      console.log(waiting ? 'An update is waiting.' : 'Up to date.');
      process.exit(waiting ? 10 : 0);
    }
    try {
      console.log('Checking for a bot update...');
      const { changed, packagesChanged } = await applyUpdate();
      if (!changed.length) console.log('The bot is up to date.');
      if (packagesChanged) {
        console.log('Updating the bot packages (a minute)...');
        const { spawnSync } = require('child_process');
        const result = spawnSync('npm.cmd', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: __dirname, stdio: 'inherit', shell: false });
        if (result.status !== 0) console.log('Package update failed; the bot starts with what it has. Run Setup again if it does not start.');
      }
    } catch (error) {
      console.log(`No update this time (${error.message}). Starting the bot as it is.`);
    }
  })();
}
