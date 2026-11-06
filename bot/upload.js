// Landstar bulk-upload bot.
// Uploads every exported Landstar Excel file from your Downloads folder,
// one at a time, then moves uploaded files into a "uploaded" subfolder so
// they are not sent twice.
//
// Usage:
//   node login.js     <- run once first to save your session
//   node upload.js    <- uploads all pending Landstar Excel files
//
// Optional:
//   node upload.js "C:\path\to\folder"   <- watch a different folder

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getWorkPage, openBoard, showLoggedIn, checkFiles } = require('./rate-check');
const { setStatus, setProgress } = require('./status-server');
// Files uploaded since the bot started, and files still waiting in Downloads.
const uploadProgress = { uploaded: 0, waiting: 0 };
const { raiseWindow } = require('./raise-window');

// Before uploading, raise each load's rate to beat other agencies' postings on
// the same lane and pickup date (see rate-check.js). Skip with --no-rate-check.
const runRateCheck = !process.argv.includes('--no-rate-check');
const crypto = require('crypto');
const { removeDuplicatePostings } = require('./dedupe');
const { processUnpostQueue } = require('./unpost');
const { readQueue: readUnpostQueue, readAssignQueue } = require('./status-server');
const { processAssignQueue } = require('./assign');
const { checkTracking } = require('./clarity');
const { readTrackingWatch, reportTrackingResults, readTrackingBills } = require('./status-server');
const TRACKING_CHECK_MS = 5 * 60 * 1000;
const { readMercuryGateQueue } = require('./status-server');
const { runNextMercuryGateJob } = require('./mercurygate-job');
// While the helper bot (helper.js) runs, it does Assign Capacity, Clarity and MercuryGate.
const { helperActive } = require('./status-server');

// Booked Paramount loads: fill MercuryGate (see mercurygate-job.js). One job per round.
const mercurygateSafely = (context, log = console.log) => runNextMercuryGateJob(context, log);

// Booked Paramount loads: read their tracking link, ETA and shipper arrival/departure
// from Clarity (read-only) for the TMS emails. A problem only logs; it retries next time.
async function trackingSafely(context, log = console.log) {
  const watch = readTrackingWatch();
  if (!watch.length) return;
  try {
    reportTrackingResults(await checkTracking(context, watch, { log, candidateBills: readTrackingBills() }));
  } catch (error) {
    log(`  ! Clarity check failed: ${error.message}. It will try again.`);
  }
}

// Loads booked in the TMS: assign the truck on Landstar (see assign.js). A problem is
// reported and retried; it never stops the bot.
async function assignSafely(context, log = console.log) {
  if (!readAssignQueue().length) return;
  try {
    await processAssignQueue(context, { log });
  } catch (error) {
    log(`  ! Assigning capacity failed: ${error.message}. It will try again.`);
  }
}

// Loads that dropped off a customer's list in the TMS get their Landstar postings
// removed (see unpost.js). Never lets a problem stop uploads; it retries later.
async function unpostSafely(context, log = console.log) {
  if (!readUnpostQueue().length) return;
  try {
    await processUnpostQueue(context, { log });
  } catch (error) {
    log(`  ! Removing dropped loads failed: ${error.message}. It will try again.`);
  }
}

// After uploading, remove older copies of loads that are now posted more than
// once, keeping the newest posting (see dedupe.js). Skip with --no-dedupe.
const runDedupe = !process.argv.includes('--no-dedupe');
const DEDUPE_DELAY_MS = 2 * 60 * 1000; // give Landstar time to finish posting an upload

// Never lets a duplicate-check problem stop uploads; it is retried next round.
async function dedupeSafely(context, log = console.log) {
  if (!runDedupe) return;
  try {
    await removeDuplicatePostings(context, { apply: true, log });
  } catch (error) {
    log(`  ! Duplicate check failed: ${error.message}. It will run again later.`);
  }
}

// Every 30 minutes, keep every hazmat posting the highest on its lane: raise it to the
// top competing rate + $25 (see hazmat-watch.js). Skip with --no-hazmat-watch.
const { checkHazmatRates } = require('./hazmat-watch');
const runHazmatWatch = !process.argv.includes('--no-hazmat-watch');
const HAZMAT_CHECK_MS = 30 * 60 * 1000;

async function hazmatSafely(context, log = console.log) {
  if (!runHazmatWatch) return;
  try {
    await checkHazmatRates(context, { apply: true, log });
  } catch (error) {
    log(`  ! Hazmat rate check failed: ${error.message}. It will run again later.`);
  }
}

const BULK_POSTINGS_URL = 'https://portal.landstaronline.com/agent/bulk-postings';
// Persistent browser profile: you log in once, it stays signed in between runs.
const PROFILE_DIR = path.join(__dirname, 'browser-profile');

// Folder to scan for exported spreadsheets. Default: your Downloads folder.
const sourceFolder = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(os.homedir(), 'Downloads');
const uploadedFolder = path.join(sourceFolder, 'landstar-uploaded');

// Only pick up the app's Landstar bulk export spreadsheets:
//   Landstar_Bulk_<broker>.xlsx   or   Landstar_Bulk_<broker>_1of2.xlsx
const FILE_PATTERN = /^Landstar_Bulk_.*\.(xlsx|xls)$/i;

function findPendingFiles() {
  if (!fs.existsSync(sourceFolder)) return [];
  return fs.readdirSync(sourceFolder)
    .filter(name => FILE_PATTERN.test(name))
    .map(name => path.join(sourceFolder, name))
    .filter(full => fs.statSync(full).isFile())
    .sort(); // deterministic order
}

// Content hashes of everything already uploaded. File names repeat between
// exports (Landstar_Bulk_Para....xlsx, "(1)", ...), so name matching would
// skip genuinely new files; identical re-downloads hash the same and skip.
function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function alreadyUploaded() {
  if (!fs.existsSync(uploadedFolder)) return new Set();
  return new Set(
    fs.readdirSync(uploadedFolder)
      .map(name => path.join(uploadedFolder, name))
      .filter(full => fs.statSync(full).isFile())
      .map(fileHash)
  );
}

async function waitForUploadToFinish(page) {
  // Landstar processes one file at a time. Wait for the upload to process and
  // the modal (and its close animation) to fully clear before the next file.
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  // Wait until no overlay backdrop is present, then give the close animation
  // a fixed settle time so the next click isn't intercepted.
  await page.waitForFunction(
    () => !document.querySelector('.cdk-overlay-backdrop'),
    { timeout: 60000 }
  ).catch(() => {});
  await page.waitForTimeout(4000);

  // Confirm the upload button is clickable again (no overlay intercepting).
  const btn = page.locator('button[aria-label="Upload Template Spreadsheet"]');
  for (let i = 0; i < 10; i++) {
    if (await page.$('.cdk-overlay-backdrop') === null) break;
    await page.waitForTimeout(1000);
  }
  await btn.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
}

async function uploadOne(page, filePath) {
  const fileName = path.basename(filePath);
  console.log(`  Uploading: ${fileName}`);

  // The page has two states:
  //  - Empty ("No postings available"): an inline dropzone with a file input.
  //  - Has postings: an "Upload Spreadsheet" button that opens a modal.
  // After each upload the page re-renders, so always re-query for a fresh,
  // attached file input; only click the button if none is present.
  let fileInput = null;
  for (let attempt = 0; attempt < 5 && !fileInput; attempt++) {
    fileInput = await page.$('input[type=file]');
    if (fileInput) break;
    // No input yet: click the Upload Spreadsheet button to open the modal.
    await page.locator('button[aria-label="Upload Template Spreadsheet"]')
      .click({ timeout: 10000 }).catch(() => {});
    try {
      fileInput = await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 8000 });
    } catch {
      await page.waitForTimeout(2000);
    }
  }
  if (!fileInput) throw new Error('No file input found (modal/dropzone did not open).');

  // Attach the file.
  await fileInput.setInputFiles(filePath);
  await page.waitForTimeout(1500);

  // If an enabled "Upload" button is present (modal flow), click it via DOM to
  // avoid the dialog surface intercepting Playwright's pointer hit-test. In the
  // inline-dropzone flow the file uploads on selection, so there may be none.
  const hasUploadBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const up = btns.filter(b => (b.innerText || '').trim().toLowerCase() === 'upload').pop();
    if (up && !up.disabled) { up.click(); return true; }
    return false;
  });
  if (!hasUploadBtn) {
    // No upload button: wait briefly in case one enables after file selection.
    await page.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const up = btns.filter(b => (b.innerText || '').trim().toLowerCase() === 'upload').pop();
      if (up && !up.disabled) { up.click(); return true; }
      return false;
    }, { timeout: 8000 }).catch(() => {});
  }

  await waitForUploadToFinish(page);
  console.log(`  Done: ${fileName}`);
}

// Watch mode: stay logged in and upload every new export automatically.
//   node upload.js --watch      (or double-click "Start Landstar Bot.bat")
// Stop it by closing the bot's browser window, or Ctrl+C in its terminal.
const watchMode = process.argv.includes('--watch');
const WATCH_INTERVAL_MS = 5000;
const KEEP_ALIVE_MS = 10 * 60 * 1000;
const FILE_SETTLE_MS = 3000; // a file must be unchanged this long before upload
const MAX_FILE_FAILURES = 3;
const WATCH_BATCH_FILES = 5; // files rate-checked and uploaded per round in watch mode

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeNow = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// Opens Bulk Postings and makes sure we're signed in. In watch mode it waits as
// long as it takes for you to log in; otherwise it gives up after 5 minutes.
async function openBulkPostings(context, page, { waitForever = false } = {}) {
  await page.goto(BULK_POSTINGS_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const uploadBtn = page.locator('button[aria-label="Upload Template Spreadsheet"]');
  try {
    await uploadBtn.waitFor({ state: 'visible', timeout: 20000 });
  } catch {
    // Already inside the agent portal = logged in; the page just isn't Bulk Postings
    // (e.g. a duplicate check left it on Available Loads). Only ask for a login when
    // the window is really on Landstar's sign-in page.
    const onPortal = () => /portal\.landstaronline\.com\/agent/i.test(page.url());
    const giveUpAt = Date.now() + 300000;
    let asked = false;
    for (;;) {
      if (context.pages().length === 0) throw new Error('The bot window was closed.');
      if (onPortal()) {
        setStatus('logged-in', 'Opening Bulk Postings');
        if (!/bulk-postings/i.test(page.url())) {
          await page.goto(BULK_POSTINGS_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }
      } else if (!asked) {
        asked = true;
        setStatus('signing-in', 'Log in to Landstar in the bot window');
        console.log('\n>>> ACTION NEEDED: A browser window is open on the Landstar login page.');
        console.log('>>> Log in with your User-ID and password. The bot opens Bulk Postings and continues by itself.');
        console.log('>>> Do not close the window.\n');
        await raiseWindow(page);
      }
      try {
        await uploadBtn.waitFor({ state: 'visible', timeout: 5000 });
        break;
      } catch (err) {
        if (!waitForever && Date.now() > giveUpAt) throw err;
      }
    }
  }
  await showLoggedIn(context, page);
  setStatus('logged-in', 'Logged in to Landstar');
  await page.waitForTimeout(2000);
}

// Rate-checks then uploads the given files, moving each uploaded file into the
// "landstar-uploaded" folder. Returns the files that could not be uploaded.
// Throws if the rate check fails, so nothing posts unchecked.
async function processFiles(context, page, files, { waitForever = false } = {}) {
  if (runRateCheck) {
    const boardPage = await openBoard(context);
    const checked = await checkFiles(boardPage, files, { apply: true });
    if (checked.length !== files.length) throw new Error('Rate check did not cover every file.');
    // Files left with no loads (every one already posted by ATZ) are not uploaded.
    const skippedFolder = path.join(sourceFolder, 'landstar-skipped-atz');
    for (const result of checked) {
      if (result.remaining > 0 || !result.skips?.length) continue;
      if (!fs.existsSync(skippedFolder)) fs.mkdirSync(skippedFolder, { recursive: true });
      fs.renameSync(result.filePath, path.join(skippedFolder, path.basename(result.filePath)));
      console.log(`  ${path.basename(result.filePath)}: every load is already posted by ATZ; not uploaded.`);
      files = files.filter(file => file !== result.filePath);
    }
    console.log('');
  } else {
    setStatus('signing-in', 'Signing in to Landstar');
  }

  await openBulkPostings(context, page, { waitForever });
  if (!fs.existsSync(uploadedFolder)) fs.mkdirSync(uploadedFolder, { recursive: true });

  const failed = [];
  for (const file of files) {
    let ok = false;
    // Retry each file a few times; the page re-renders between uploads and
    // occasionally needs a second attempt. Reload between retries.
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        setStatus('uploading', `Uploading ${path.basename(file).replace(/^Landstar_Bulk_/, '').replace(/\.xlsx$/i, '')}`);
        await uploadOne(page, file);
        // Move to the uploaded folder so it is never sent twice. Keep a
        // unique name: the same export name recurs between runs.
        let target = path.join(uploadedFolder, path.basename(file));
        if (fs.existsSync(target)) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
          const ext = path.extname(file);
          target = path.join(uploadedFolder, `${path.basename(file, ext)}__${stamp}${ext}`);
        }
        fs.renameSync(file, target);
        ok = true;
        uploadProgress.uploaded += 1;
        uploadProgress.waiting = Math.max(0, uploadProgress.waiting - 1);
        setProgress(uploadProgress);
      } catch (err) {
        console.error(`  attempt ${attempt} failed: ${path.basename(file)} -> ${err.message}`);
        // Back to Bulk Postings: this also catches a Landstar logout (the window comes to
        // the front and the bot waits for the login) instead of reloading a login page.
        await openBulkPostings(context, page, { waitForever }).catch(() => {});
        await page.locator('button[aria-label="Upload Template Spreadsheet"], input[type=file]')
          .first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    }
    if (!ok) {
      console.error(`  SKIPPED after retries: ${path.basename(file)}`);
      failed.push(file);
    }
  }
  return failed;
}

// Daniel keeps the bot on his far-left screen (the small one he doesn't use), so it can
// stay open out of the way. Returns that screen's top-left corner, or null if it can't
// be found (then Windows picks the screen).
function botScreenPosition() {
  try {
    const out = require('child_process').execSync(
      'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; '
      + '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { \'{0},{1}\' -f $_.Bounds.X,$_.Bounds.Y }"',
      { encoding: 'utf8', timeout: 15000, windowsHide: true }
    );
    const screens = out.trim().split(/\r?\n/).map(line => line.split(',').map(Number)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (screens.length < 2) return null;
    const [x, y] = screens.sort((a, b) => a[0] - b[0])[0];
    return { x, y };
  } catch {
    return null;
  }
}

async function launchBrowser() {
  const screen = botScreenPosition();
  // Persistent profile so your Landstar login survives between runs.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: [
      ...(screen ? [`--window-position=${screen.x + 40},${screen.y + 40}`] : []),
      '--start-maximized'
    ],
  });
  // With --window-position Chrome opens on that screen but not maximized; maximize it there
  // (a narrow window gets Landstar's phone layout, which has no Upload Spreadsheet button).
  const page = context.pages()[0] || await context.newPage();
  let session = null;
  try {
    session = await context.newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  } catch { /* leave the window as Chrome opened it */ } finally {
    if (session) await session.detach().catch(() => {});
  }
  return context;
}

// Files ready to upload: not uploaded before, and finished downloading.
function readyFiles(failures) {
  const done = alreadyUploaded();
  return findPendingFiles().filter(file => {
    let stat;
    try { stat = fs.statSync(file); } catch { return false; }
    if (stat.size === 0 || Date.now() - stat.mtimeMs < FILE_SETTLE_MS) return false;
    const key = `${file}|${stat.mtimeMs}`;
    if ((failures.get(key) || 0) >= MAX_FILE_FAILURES) return false;
    return !done.has(fileHash(file));
  });
}

async function runOnce() {
  const done = alreadyUploaded();
  const toUpload = findPendingFiles().filter(f => !done.has(fileHash(f)));

  if (toUpload.length === 0) {
    console.log(`No new Landstar spreadsheets to upload in:\n  ${sourceFolder}`);
    console.log('(Files already uploaded are in the "landstar-uploaded" subfolder.)');
    console.log('Tip: double-click "Start Landstar Bot.bat" to keep the bot on and upload exports automatically.');
    return;
  }

  console.log(`Found ${toUpload.length} spreadsheet(s) to upload from:\n  ${sourceFolder}\n`);
  const context = await launchBrowser();
  const page = await getWorkPage(context);

  try {
    let failed;
    try {
      failed = await processFiles(context, page, toUpload);
    } catch (err) {
      console.error(`\nRate check or login failed: ${err.message}`);
      console.error('No files were uploaded. Fix the problem, or run "node upload.js --no-rate-check" to upload at the exported rates.');
      return;
    }

    const uploadedCount = toUpload.length - failed.length;
    setStatus('logged-in', failed.length
      ? `Done: ${uploadedCount} uploaded, ${failed.length} failed`
      : `Done: ${uploadedCount} file(s) uploaded`);
    console.log('\nAll done. Uploaded files were moved to:');
    console.log(`  ${uploadedFolder}`);
    if (failed.length) {
      console.log(`\n${failed.length} file(s) could not be uploaded and were left in Downloads:`);
      failed.forEach(f => console.log(`  - ${path.basename(f)}`));
    }

    if (runDedupe && uploadedCount > 0) {
      console.log(`\nWaiting ${DEDUPE_DELAY_MS / 60000} minutes for Landstar to finish posting, then removing older duplicate postings...`);
      await page.waitForTimeout(DEDUPE_DELAY_MS);
      await dedupeSafely(context);
      setStatus('logged-in', `Done: ${uploadedCount} file(s) uploaded`);
    }
    await unpostSafely(context);

    // Keep the browser open so you stay logged in and can review the result.
    // Close the window yourself, or press Enter here, to end the bot.
    console.log('\nThe browser will stay open. Press Enter in this window to close it.');
    await new Promise(resolve => {
      process.stdin.resume();
      process.stdin.once('data', resolve);
      context.on('close', resolve);
    });
  } finally {
    await context.close().catch(() => {});
  }
}

async function runWatch() {
  console.log('Landstar bot: ON (watch mode)');
  console.log(`Watching for new exports in:\n  ${sourceFolder}`);
  console.log('Export from the TMS as usual; each new file is rate-checked and uploaded automatically.');
  console.log('To turn the bot off, close its browser window (or press Ctrl+C here).\n');

  const context = await launchBrowser();
  let closed = false;
  // Closing the bot's window turns the bot off. The status server would otherwise keep
  // this program running and the TMS light would stay green; if the bot is in the middle
  // of something it gets a few seconds to stop on its own.
  context.on('close', () => {
    closed = true;
    setTimeout(() => {
      console.log('Bot window closed. Landstar bot: OFF');
      process.exit(0);
    }, 5000);
  });
  const stop = async () => {
    closed = true;
    await context.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const page = await getWorkPage(context);
  // Sign in up front so the TMS light is green before the first export.
  if (runRateCheck) await openBoard(context);
  await openBulkPostings(context, page, { waitForever: true });
  setStatus('logged-in', 'Watching for exports');
  console.log(`[${timeNow()}] Logged in. Waiting for exports...`);

  const failures = new Map();
  let lastActivity = Date.now();
  let dedupeDueAt = 0; // set after an upload; checked once no exports are waiting
  let hazmatDueAt = Date.now() + 2 * 60 * 1000; // first hazmat rate check shortly after start
  let trackingDueAt = Date.now() + 60 * 1000; // first Clarity check a minute after start

  while (!closed) {
    let files = [];
    try { files = readyFiles(failures); } catch (err) { console.error(`Could not read ${sourceFolder}: ${err.message}`); }
    // A big export (e.g. 100+ files) is rate-checked and uploaded a few files at a time,
    // so posting starts right away and a dropped login only costs one small batch.
    const waiting = files.length;
    // Files left to post, for the TMS progress line; uploaded counts this run's uploads.
    uploadProgress.waiting = waiting;
    setProgress(waiting || uploadProgress.uploaded ? uploadProgress : null);
    files = files
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true })) // 3of108 before 10of108
      .slice(0, WATCH_BATCH_FILES);

    const helperOn = helperActive();
    if (!helperOn && readMercuryGateQueue().length && !readAssignQueue().length) {
      console.log(`
[${timeNow()}] MercuryGate: filling in a booked Paramount load...`);
      setStatus('logged-in', 'Filling in MercuryGate');
      await mercurygateSafely(context, line => console.log(line));
      if (closed) break;
      try {
        await openBulkPostings(context, page, { waitForever: true });
        setStatus('logged-in', 'Watching for exports');
      } catch (err) {
        if (!closed) console.error(`[${timeNow()}] Could not return to Bulk Postings: ${err.message}`);
      }
      lastActivity = Date.now();
    } else if (!helperOn && readAssignQueue().length) {
      // Loads just booked in the TMS come first: put the truck on them in Landstar.
      console.log(`\n[${timeNow()}] Assigning capacity on booked loads...`);
      await assignSafely(context, line => console.log(line));
      if (closed) break;
      try {
        await openBulkPostings(context, page, { waitForever: true });
        setStatus('logged-in', `Watching for exports · last assignment ${timeNow()}`);
      } catch (err) {
        if (!closed) console.error(`[${timeNow()}] Could not return to Bulk Postings: ${err.message}`);
      }
      lastActivity = Date.now();
    } else if (files.length) {
      console.log(`\n[${timeNow()}] New export(s): ${files.map(f => path.basename(f)).join(', ')}`
        + (waiting > files.length ? `  (${waiting - files.length} more waiting)` : ''));
      const keyOf = file => { try { return `${file}|${fs.statSync(file).mtimeMs}`; } catch { return file; } };
      const keys = new Map(files.map(file => [file, keyOf(file)]));
      try {
        const failed = await processFiles(context, page, files, { waitForever: true });
        failed.forEach(file => failures.set(keys.get(file), (failures.get(keys.get(file)) || 0) + 1));
        const uploaded = files.length - failed.length;
        console.log(`[${timeNow()}] Uploaded ${uploaded} file(s)${failed.length ? `, ${failed.length} failed (left in Downloads)` : ''}. Watching...`);
        setStatus('logged-in', `Watching for exports · last upload ${timeNow()}`);
        if (uploaded > 0 && runDedupe) dedupeDueAt = Date.now() + DEDUPE_DELAY_MS;
      } catch (err) {
        if (closed) break;
        // Rate check or login failed: nothing was uploaded; try again next round.
        files.forEach(file => failures.set(keys.get(file), (failures.get(keys.get(file)) || 0) + 1));
        console.error(`[${timeNow()}] Could not process the export: ${err.message}. Will retry.`);
        setStatus('signing-in', 'Retrying after an error');
      }
      lastActivity = Date.now();
    } else if (readUnpostQueue().length) {
      // The TMS sent loads that dropped off a customer's list: remove their postings.
      console.log(`\n[${timeNow()}] Removing loads that are no longer on the customer list...`);
      await unpostSafely(context, line => console.log(line));
      if (closed) break;
      try {
        await openBulkPostings(context, page, { waitForever: true });
        setStatus('logged-in', `Watching for exports · last upload ${timeNow()}`);
      } catch (err) {
        if (!closed) console.error(`[${timeNow()}] Could not return to Bulk Postings: ${err.message}`);
      }
      lastActivity = Date.now();
    } else if (dedupeDueAt && Date.now() >= dedupeDueAt) {
      // An upload finished a couple of minutes ago: remove the older copies it replaced.
      dedupeDueAt = 0;
      console.log(`\n[${timeNow()}] Removing older duplicate postings...`);
      await dedupeSafely(context, line => console.log(line));
      if (closed) break;
      try {
        await openBulkPostings(context, page, { waitForever: true });
        setStatus('logged-in', `Watching for exports · last upload ${timeNow()}`);
      } catch (err) {
        if (!closed) console.error(`[${timeNow()}] Could not return to Bulk Postings: ${err.message}`);
      }
      lastActivity = Date.now();
    } else if (!helperOn && Date.now() >= trackingDueAt && readTrackingWatch().length) {
      // Booked Paramount loads: tracking link, pickup ETA, arrived / left the shipper.
      trackingDueAt = Date.now() + TRACKING_CHECK_MS;
      console.log(`
[${timeNow()}] Checking Clarity for booked Paramount loads...`);
      await trackingSafely(context, line => console.log(line));
      if (closed) break;
      try {
        await openBulkPostings(context, page, { waitForever: true });
        setStatus('logged-in', 'Watching for exports');
      } catch (err) {
        if (!closed) console.error(`[${timeNow()}] Could not return to Bulk Postings: ${err.message}`);
      }
      lastActivity = Date.now();
    } else if (runHazmatWatch && Date.now() >= hazmatDueAt) {
      // Make sure no other agency pays more than you on your hazmat lanes.
      hazmatDueAt = Date.now() + HAZMAT_CHECK_MS;
      console.log(`\n[${timeNow()}] Checking hazmat rates against the board...`);
      await hazmatSafely(context, line => console.log(line));
      if (closed) break;
      try {
        await openBulkPostings(context, page, { waitForever: true });
        setStatus('logged-in', 'Watching for exports');
      } catch (err) {
        if (!closed) console.error(`[${timeNow()}] Could not return to Bulk Postings: ${err.message}`);
      }
      lastActivity = Date.now();
    } else if (Date.now() - lastActivity > KEEP_ALIVE_MS) {
      // Keep the Landstar session alive while idle, and catch any duplicates left behind.
      await dedupeSafely(context, line => console.log(line));
      if (closed) break;
      try {
        await openBulkPostings(context, page, { waitForever: true });
        setStatus('logged-in', 'Watching for exports');
      } catch (err) {
        if (!closed) console.error(`[${timeNow()}] Keep-alive failed: ${err.message}`);
      }
      lastActivity = Date.now();
    }
    await sleep(WATCH_INTERVAL_MS);
  }
  console.log('Bot window closed. Landstar bot: OFF');
  process.exit(0);
}

(watchMode ? runWatch() : runOnce()).catch(err => {
  console.error('Upload bot failed:', err.message);
  process.exit(1);
});
