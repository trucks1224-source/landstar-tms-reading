require('./file-log')('refresh'); // also writes this bot's output to bot/logs
// Refresh bot: keeps AMERI 18347- ATZ (every 5 min) and hazmat (every 30 min) postings fresh on
// DAT by pausing and unpausing them on Landstar (pause-refresh.js). Its own browser and sign-in,
// so the rate worker stays free for rate checks (Daniel, 2026-11-25). The watchdog keeps it running.
process.env.BOT_ROLE = 'refresh';

const path = require('path');
const { chromium } = require('playwright');
const { setStatus, readRefreshStatus } = require('./status-server');
const { openBoard } = require('./rate-check');
const { runPauseRefresh } = require('./pause-refresh');
const { readBotControl } = require('./local-bot-control');

const CHECK_MS = 60 * 1000; // looks for due postings once a minute
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const previous = readRefreshStatus();
  if (previous.pid && previous.state !== 'off' && previous.pid !== process.pid) {
    try {
      process.kill(previous.pid, 0);
      throw new Error('The refresh bot is already running.');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  setStatus('starting', 'Opening refresh bot');
  let context;
  let closed = false;
  let problem = '';
  const heartbeat = setInterval(() => {
    const status = readRefreshStatus();
    setStatus(status.state === 'off' ? 'logged-in' : status.state, status.message);
  }, 10000);
  try {
    context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile-refresh'), {
      headless: false, viewport: null, args: ['--start-maximized']
    });
    context.on('close', () => { closed = true; });
    process.once('SIGINT', () => { closed = true; void context.close(); });
    process.once('SIGTERM', () => { closed = true; void context.close(); });
    await openBoard(context);
    console.log('Refresh bot signed in. Pausing and unpausing AMERI (5 min) and hazmat (30 min) postings.');
    while (!closed) {
      try {
        if (!readBotControl()) {
          setStatus('logged-in', 'Local bots paused');
          await sleep(10000);
          continue;
        }
        setStatus('working', 'Refreshing AMERI and hazmat postings (pause/unpause)');
        const result = await runPauseRefresh(context);
        problem = result.problems.join(' ');
        if (problem) console.error(`Needs attention: ${problem}`);
        setStatus(problem ? 'blocked' : 'logged-in', problem
          ? `Needs attention: ${problem}`
          : `Waiting · last pass ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${result.refreshed ? ` (${result.refreshed} refreshed)` : ''}`);
      } catch (error) {
        if (closed) break;
        console.error('Refresh pass failed; it runs again in a minute:', error.message);
        setStatus('blocked', `Refresh pass failed: ${error.message}`);
      }
      await sleep(CHECK_MS);
    }
  } finally {
    clearInterval(heartbeat);
    if (context) await context.close().catch(() => {});
    setStatus('off', 'Refresh bot is off');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Refresh bot failed:', error.message);
    if (readRefreshStatus().pid === process.pid) setStatus('off', `Refresh bot stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
