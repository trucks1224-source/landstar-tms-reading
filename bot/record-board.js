// One-time helper: opens the Landstar load board in the bot's browser and
// records how a search works (form fields, requests, results page) so the
// rate-check bot can repeat it automatically.
//
// Usage: node record-board.js
//   1. Log in if asked.
//   2. Search one lane (e.g. Elk Grove Village, IL -> Mansfield, TX, van, pickup date).
//   3. Wait for the results to show, then CLOSE the browser window.
// Output goes to bot/board-capture/ (no passwords or cookies are saved).

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BOARD_URL = 'https://www.landstaronline.com/Loads/Load/SearchResults';
const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const OUT_DIR = path.join(__dirname, 'board-capture');

(async () => {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
  });
  const page = context.pages()[0] || await context.newPage();

  const requests = [];
  let snapshot = 0;

  // Only load-board traffic is recorded. Login, identity and token traffic is
  // never touched, so no username, password or session token is written.
  const isLoadBoardUrl = url =>
    /^https:\/\/portal\.landstaronline\.com\/loadboards\//i.test(url) ||
    /^https:\/\/www\.landstaronline\.com\/Loads\//i.test(url);

  context.on('response', async response => {
    const request = response.request();
    const type = request.resourceType();
    if (!['xhr', 'fetch', 'document'].includes(type)) return;
    const url = request.url();
    if (!isLoadBoardUrl(url)) return;
    const postData = request.postData() || null;
    const entry = {
      type,
      method: request.method(),
      url,
      status: response.status(),
      postData: postData && /password|token|secret/i.test(postData) ? '[redacted]' : postData,
      contentType: response.headers()['content-type'] || '',
    };
    try {
      const body = await response.text();
      const file = `response-${String(requests.length).padStart(3, '0')}.${/json/.test(entry.contentType) ? 'json' : 'html'}`;
      fs.writeFileSync(path.join(OUT_DIR, file), body);
      entry.bodyFile = file;
    } catch { /* redirects have no body */ }
    requests.push(entry);
    fs.writeFileSync(path.join(OUT_DIR, 'requests.json'), JSON.stringify(requests, null, 2));
  });

  // Snapshot every open tab that is on the load board (never login pages).
  const saveSnapshot = async () => {
    for (const p of context.pages()) {
      try {
        if (!/portal\.landstaronline\.com\/(agent|loadboards)|www\.landstaronline\.com\/Loads/i.test(p.url())) continue;
        const n = String(snapshot++).padStart(3, '0');
        fs.writeFileSync(path.join(OUT_DIR, `page-${n}.html`), await p.content());
        fs.writeFileSync(path.join(OUT_DIR, `page-${n}-url.txt`), p.url());
      } catch { /* page closing */ }
    }
  };
  // Also snapshot periodically, since results may render without a page load.
  const timer = setInterval(saveSnapshot, 5000);

  await page.goto(BOARD_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n>>> Landstar load board is open in the bot browser.');
  console.log('>>> Log in if needed, open Available Loads, search one lane, wait for results, then CLOSE the window.\n');

  await new Promise(resolve => context.on('close', resolve));
  clearInterval(timer);
  console.log(`Recorded ${requests.length} request(s) and ${snapshot} page snapshot(s) in ${OUT_DIR}`);
})().catch(err => {
  console.error('Recorder failed:', err.message);
  process.exit(1);
});
