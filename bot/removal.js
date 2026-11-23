require('./file-log')('removal'); // also writes this bot's output to bot/logs
// Dedicated worker for the TMS-approved missing-load removal queue.
process.env.BOT_ROLE = 'removal';

const path = require('path');
const { chromium } = require('playwright');
const { readQueue, setStatus, readRemovalStatus, reportErrorDraft } = require('./status-server');
const { cleanErrorDrafts } = require('./error-drafts');
// Bulk Postings error drafts are checked this often (error-drafts.js).
const ERROR_DRAFT_CHECK_MS = 5 * 60 * 1000;
const { openBoard } = require('./rate-check');
const { processUnpostQueue } = require('./unpost');
const { readBotControl } = require('./local-bot-control');
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
    console.log('Removal bot signed in. Processing the removal queue and Bulk Postings error drafts.');
    let errorDraftsDueAt = Date.now() + 60 * 1000;
    while (!closed) {
      try {
        if (!readBotControl()) {
          setStatus('logged-in', 'Local bots paused');
          await sleep(10000);
          continue;
        }
        const count = readQueue().length;
        if (count) {
          setStatus('working', `Removing ${count} queued load(s)`);
          await processUnpostQueue(context);
        }
        if (Date.now() >= errorDraftsDueAt) {
          errorDraftsDueAt = Date.now() + ERROR_DRAFT_CHECK_MS;
          setStatus('working', 'Checking Bulk Postings errors and stuck drafts');
          try {
            await cleanErrorDrafts(context, { apply: true, report: reportErrorDraft });
          } catch (error) {
            console.error('Bulk Postings error check failed; it runs again in 5 minutes:', error.message);
          }
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
