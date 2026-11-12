// Dedicated worker for the TMS-approved missing-load removal queue.
process.env.BOT_ROLE = 'removal';

const path = require('path');
const { chromium } = require('playwright');
const { readQueue, setStatus, readRemovalStatus } = require('./status-server');
const { openBoard } = require('./rate-check');
const { processUnpostQueue } = require('./unpost');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const previous = readRemovalStatus();
  if (previous.pid && previous.state !== 'off') {
    try {
      process.kill(previous.pid, 0);
      throw new Error('The removal bot is already running.');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  setStatus('starting', 'Opening removal bot');
  let context;
  let closed = false;
  const heartbeat = setInterval(() => {
    const status = readRemovalStatus();
    setStatus(status.state, status.message);
  }, 10000);
  try {
    context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile-removal'), {
      headless: false, viewport: null, args: ['--start-maximized']
    });
    context.on('close', () => { closed = true; });
    process.once('SIGINT', () => { closed = true; void context.close(); });
    await openBoard(context);
    console.log('Removal bot signed in. Processing only the existing removal queue.');
    while (!closed) {
      try {
        const count = readQueue().length;
        if (count) {
          setStatus('working', `Removing ${count} queued load(s)`);
          await processUnpostQueue(context);
        }
        setStatus('logged-in', 'Waiting for queued removals');
      } catch (error) {
        if (closed) break;
        console.error('Removal failed; queued loads will be retried:', error.message);
        setStatus('working', `Retrying removals: ${error.message}`);
      }
      await sleep(10000);
    }
  } finally {
    clearInterval(heartbeat);
    if (context) await context.close();
    setStatus('off', 'Removal bot is off');
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
