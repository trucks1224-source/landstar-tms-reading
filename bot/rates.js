process.env.BOT_ROLE = 'rates';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const { setStatus, readRatesStatus } = require('./status-server');
const { openBoard, checkFiles } = require('./rate-check');
const { checkHazmatRates } = require('./hazmat-watch');
const { pendingRateFiles, prepareRateFile, dedicatedRatesReady } = require('./rate-work');
const { readBotControl } = require('./local-bot-control');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sourceFolder = process.argv.slice(2).find(arg => !arg.startsWith('--')) || path.join(os.homedir(), 'Downloads');
const hazmatEnabled = !process.argv.includes('--no-hazmat-watch');
const HAZMAT_INTERVAL_MS = 30 * 60 * 1000;

async function main() {
  // The profile is an exclusive browser lock as well as a separate sign-in.
  // Launch it before publishing status, so a duplicate launch cannot replace the owner's light.
  fs.mkdirSync(sourceFolder, { recursive: true });
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile-rates'), {
    headless: false, viewport: null, args: ['--start-maximized']
  });
  let closed = false;
  context.on('close', () => { closed = true; });
  const stop = () => { closed = true; void context.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  setStatus('starting', 'Opening rate worker');
  const heartbeat = setInterval(() => {
    const status = readRatesStatus();
    setStatus(status.state, status.message);
  }, 10000);
  try {
    await openBoard(context);
    let hazmatDueAt = Date.now() + 2 * 60 * 1000;
    let lastActivity = Date.now();
    let hazmatError = '';
    const report = (state, message) => setStatus(hazmatError && state === 'logged-in' ? 'blocked' : state,
      hazmatError ? `${message}. Hazmat check needs attention: ${hazmatError}` : message);
    while (!closed) {
      try {
        if (!readBotControl()) {
          setStatus('logged-in', 'Local bots paused');
          await sleep(5000);
          continue;
        }
        const response = await fetch('http://127.0.0.1:47615/status', { signal: AbortSignal.timeout(3000) });
        if (!response.ok || !dedicatedRatesReady(await response.json())) {
          setStatus('blocked', 'Waiting for posting and helper workers to restart in dedicated-rate mode');
          await sleep(5000);
          continue;
        }
        const files = pendingRateFiles(sourceFolder);
        if (hazmatEnabled && Date.now() >= hazmatDueAt) {
          hazmatDueAt = Date.now() + HAZMAT_INTERVAL_MS;
          setStatus('working', 'Checking existing hazmat board rates');
          try {
            await checkHazmatRates(context, { apply: true });
            hazmatError = '';
          } catch (error) {
            if (closed) break;
            hazmatError = error.message;
            console.error('Hazmat check failed; export preparation will continue:', error.message);
            report('logged-in', 'Export preparation can continue');
          }
          lastActivity = Date.now();
        } else if (files.length) {
          const file = files[0];
          setStatus('working', `Preparing ${path.basename(file)}`);
          const result = await prepareRateFile(file, {
            skippedFolder: path.join(sourceFolder, 'landstar-skipped-atz'),
            check: async target => {
              const board = await openBoard(context);
              return checkFiles(board, [target], { apply: true });
            }
          });
          report('logged-in', result.state === 'busy'
            ? 'Waiting for export ownership' : `${result.state === 'skipped' ? 'Skipped empty' : 'Prepared'} export; ${files.length - 1} remaining`);
          lastActivity = Date.now();
        } else {
          if (Date.now() - lastActivity >= 15 * 60 * 1000) {
            await openBoard(context);
            lastActivity = Date.now();
          }
          report('logged-in', 'Waiting for exports to rate-check');
        }
      } catch (error) {
        if (closed) break;
        console.error('Rate worker blocked:', error.message);
        setStatus('blocked', `Rate preparation paused: ${error.message}`);
        // An unprepared file is never handed to posting, even when rate lookup fails.
        await sleep(30000);
      }
      if (!closed) await sleep(5000);
    }
  } finally {
    clearInterval(heartbeat);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await context.close();
    setStatus('off', 'Rate worker is off');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Rate worker failed:', error.message);
    if (readRatesStatus().pid === process.pid) setStatus('off', `Rate worker stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
