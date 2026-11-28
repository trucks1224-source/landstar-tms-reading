// Only the running bot writes bot/logs (tests load this file too).
if (require.main === module) require('./file-log')('chatbot');
// Google Chat bot: watches Daniel's Google Chat groups in its own browser window (one tab
// per chat) and saves every new list screenshot into bot/chat-inbox:
//   - the Para group (Heather, Olga, Ashley, Edgar)   kind "para"
//   - the RXO chat called LANDJA.18                     kind "rxo"
// The TMS picks each one up and asks which account it is for, like a Ctrl+V paste (RXO
// pictures offer the RXO accounts, Para pictures the Para accounts and NTG cards).
//
// Google's Chat API does not work for a personal Gmail account, so this reads the Chat web
// page. It only READS: it never types, posts or reacts in a chat.
//
// OFF until bot/chat-bot-config.json has "enabled": true and each chat's address (open the
// chat in Chrome and copy the address bar, e.g. https://chat.google.com/room/XXXXXXXX).
// Daniel 2026-11-27: built now, turned on once the new laptop arrives (this PC is short on memory).
//
// The first time it opens a chat it only remembers the pictures already there (old lists
// are never imported); after that every new picture goes to the TMS.
//
//   node chat-bot.js        (or "Start Chat Bot.bat"; the watchdog keeps it running once enabled)
const path = require('path');
const {
  readChatConfig, writeChatStatus, readSeen, writeSeen, addToInbox, spreadsheetExtension, INBOX_DIR
} = require('./chat-inbox');

const PROFILE_DIR = path.join(__dirname, 'browser-profile-chat');
const CHECK_MS = 20 * 1000;
const RELOAD_MS = 10 * 60 * 1000;
// List screenshots are big; avatars, emoji and link previews are small.
const MIN_WIDTH = 300;
const MIN_HEIGHT = 150;

const log = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);

// Which of the pictures on the page are list screenshots, and the key that identifies each.
// candidates = [{ src, width, height, sender, postedAt }] from the page.
function pickListImages(candidates) {
  const picked = new Map();
  for (const item of candidates || []) {
    const src = String(item?.src || '');
    if (!/^https:\/\//.test(src)) continue;
    if (!(item.width >= MIN_WIDTH && item.height >= MIN_HEIGHT)) continue;
    const key = imageKey(src);
    if (!picked.has(key)) picked.set(key, { ...item, key });
  }
  return [...picked.values()];
}

// The same attachment is shown at different sizes: strip the size part of its address.
function imageKey(src) {
  return String(src)
    .replace(/=[swh]\d+[^/?#&]*$/i, '')
    .replace(/([?&])(sz|w|h)=[^&]*/gi, '$1')
    .replace(/[?&]+$/, '');
}

// The full-size picture's address (Google image addresses take a size at the end).
function fullSizeUrl(src) {
  const text = String(src);
  if (/googleusercontent\.com\//i.test(text)) return `${text.replace(/=[swh]\d+[^/?#&]*$/i, '')}=s0`;
  return text.replace(/([?&]sz=)[^&]*/i, '$1s0');
}

// Spreadsheet attachments on the page: [{ fileName, href, sender, postedAt }] -> the ones to
// save, each with a key (the same file posted again later is a new attachment, a new key).
function pickSpreadsheets(candidates) {
  const picked = new Map();
  for (const item of candidates || []) {
    const fileName = String(item?.fileName || '').trim();
    const href = String(item?.href || '');
    // Gmail's Chat shows a file as a button with no link (opened by clicking): usable too.
    const clickable = Number.isInteger(item?.chipIndex);
    if (!spreadsheetExtension(fileName) || (!/^https:\/\//.test(href) && !clickable)) continue;
    const key = href ? `file|${fileName}|${attachmentId(href)}` : `file|${fileName}|${item.postedAt || ''}`;
    if (!picked.has(key)) picked.set(key, { ...item, fileName, href, key });
  }
  return [...picked.values()];
}

// What identifies one attachment in its link (Drive file id, or the link without its
// sign-in and size parts).
function attachmentId(href) {
  const drive = String(href).match(/\/(?:spreadsheets\/)?d\/([A-Za-z0-9_-]{20,})/) || String(href).match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (drive) return drive[1];
  return String(href).replace(/([?&])(auth\w*|sz|authuser|token)=[^&]*/gi, '$1').replace(/[?&]+$/, '');
}

// Where to download a spreadsheet: a Google Sheet as Excel, a Drive file as the file itself,
// any other attachment link as it is.
function spreadsheetDownloadUrl(href) {
  const text = String(href);
  const sheet = text.match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (sheet) return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=xlsx`;
  const file = text.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]+)/);
  if (file) return `https://drive.google.com/uc?export=download&id=${file[1]}`;
  return text;
}

// The list's label: the short message posted just before the file ("big list", "fbs",
// "reefer"). RXO's files are all named "allLoadsSearch_Export - <date>.xlsx", so the label
// is what tells the lists apart (Daniel 2026-11-27). texts = the chat's text pieces from the
// top down to the file. Skips times, file names and Chat's own words.
function pickListLabel(texts) {
  const skip = /^(\d{1,2}:\d{2}\s*(am|pm)?|now|yesterday|today|edited|\d+\s*(min|mins|hr|hrs)|reply|thread|view|download|open|history is on|only visible to you|you|sent|sending|failed to send)$/i;
  for (let index = (texts || []).length - 1; index >= 0; index -= 1) {
    const text = String(texts[index] || '').replace(/\s+/g, ' ').trim();
    // Only punctuation (a lone "," between messages) is not a name; "$$" is.
    if (!/[A-Za-z0-9$]/.test(text)) continue;
    if (!text || text.length > 60 || skip.test(text) || /\.(xlsx|xls|csv)\b|…$/i.test(text)) continue;
    return text;
  }
  return '';
}

// Reads every spreadsheet attachment in the chat (file name from the chip's label or text),
// with the chat text that came before it (for its list label).
async function readPageFiles(page) {
  const found = [];
  for (const frame of page.frames()) {
    const files = await frame.evaluate(() => {
      const nameOf = element => [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('download'), element.innerText]
        .map(text => String(text || '').match(/[^\s"'\\/:*?<>|]+(?:[ ._-][^\s"'\\/:*?<>|]+)*\.(xlsx|xls|csv)\b/i)?.[0])
        .find(Boolean) || '';
      // Walk the page top to bottom: text pieces since the last file, then each file. A file is
      // a link, or (Gmail's Chat, 2026-11-27) a button titled with the file name:
      //   <div role="button" title="allLoadsSearch_Export - 2026-11-27T103054.245.xlsx">
      const results = [];
      let texts = [];
      let chipIndex = 0;
      const isFileButton = node => node.getAttribute('role') === 'button' && /\.(xlsx|xls|csv)$/i.test(node.getAttribute('title') || '');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement;
          // Skip links, file buttons and the sender's name (a person card), so "Tyler Cook" is
          // never taken for a list name.
          if (!parent || parent.closest('a[href], script, style, [aria-hidden="true"], [role="button"][title], [data-hovercard-id], [data-member-id], [data-name], [data-sender-id]')) continue;
          const text = node.textContent.replace(/\s+/g, ' ').trim();
          if (text) texts.push(text);
          continue;
        }
        const button = isFileButton(node);
        if (!button && (node.tagName !== 'A' || !node.href)) continue;
        const chip = node.closest('[data-message-id], [role="listitem"], [jsmodel]') || node;
        const fileName = button ? node.getAttribute('title').trim() : nameOf(node) || nameOf(chip);
        if (!fileName) continue;
        const message = node.closest('[data-message-id], [role="listitem"]');
        let index = null;
        if (button) {
          index = chipIndex;
          chipIndex += 1;
          node.dataset.chatBotFile = String(index);
        }
        results.push({
          fileName, href: button ? '' : node.href, chipIndex: index, texts: texts.slice(-12),
          sender: (message?.querySelector('[data-name]')?.getAttribute('data-name') || '').trim(),
          postedAt: message?.querySelector('[data-absolute-timestamp]')?.getAttribute('data-absolute-timestamp') || ''
        });
        texts = [];
      }
      return results;
    }).catch(() => []);
    found.push(...files.map(({ texts, ...file }) => ({ ...file, frame, label: pickListLabel(texts) })));
  }
  return found;
}

// Single-load messages (Tyler's "Load Number: ... Pickup: ... Delivery: ... $1500" posts in
// LANDJA18): the smallest element holding the whole message, one per load number. The TMS
// reads the text (src/lib/chatLoads.js). [{ loadNumber, text, key }]
async function readLoadMessages(page) {
  const found = new Map();
  for (const frame of page.frames()) {
    const texts = await frame.evaluate(() => {
      const isLoad = text => /Load Number\s*:\s*\d{5,12}[\s\S]*Delivery\s*:/i.test(text || '');
      return Array.from(document.querySelectorAll('div, span, p'))
        .filter(element => isLoad(element.innerText) && !Array.from(element.children).some(child => isLoad(child.innerText)))
        .map(element => element.innerText);
    }).catch(() => []);
    for (const text of texts) {
      const loadNumber = text.match(/Load Number\s*:\s*(\d{5,12})/i)?.[1];
      if (loadNumber && !found.has(loadNumber)) found.set(loadNumber, { loadNumber, text, key: `load|${loadNumber}` });
    }
  }
  return [...found.values()];
}

// When a chat shows files but none is read as a spreadsheet, saves what the page has around
// "xlsx" (tags, roles, labels, links) to bot/chat-debug.json, to fix the reader (no message text
// beyond 200 characters per element).
async function writeFileDebug(page, chat) {
  const fs = require('fs');
  const found = [];
  for (const frame of page.frames()) {
    const items = await frame.evaluate(() => {
      const out = [];
      const all = Array.from(document.querySelectorAll('*'));
      for (const element of all) {
        const own = Array.from(element.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join(' ');
        const attrs = ['aria-label', 'title', 'data-tooltip', 'download', 'href', 'data-url', 'data-id'].map(name => element.getAttribute(name) || '').join(' ');
        if (!/\.(xlsx|xls|csv)\b|allLoadsSearch/i.test(`${own} ${attrs}`)) continue;
        const path = [];
        for (let node = element; node && node !== document.body && path.length < 8; node = node.parentElement) {
          path.push(`${node.tagName.toLowerCase()}${node.getAttribute('role') ? `[role=${node.getAttribute('role')}]` : ''}${node.getAttribute('jsname') ? `[jsname=${node.getAttribute('jsname')}]` : ''}${node.getAttribute('data-message-id') ? '[data-message-id]' : ''}${node.tagName === 'A' ? `[href=${String(node.href).slice(0, 80)}]` : ''}`);
        }
        out.push({
          text: own.trim().slice(0, 200),
          attrs: Object.fromEntries(Array.from(element.attributes).filter(a => !/^(class|style|jsaction|jscontroller|jslog)$/.test(a.name)).map(a => [a.name, String(a.value).slice(0, 200)])),
          path
        });
        if (out.length >= 30) break;
      }
      return out;
    }).catch(error => [{ error: error.message }]);
    if (items.length) found.push({ frame: frame.url().slice(0, 120), items });
  }
  try {
    fs.writeFileSync(path.join(__dirname, 'chat-debug.json'), JSON.stringify({ chat: chat.name, at: new Date().toISOString(), found }, null, 2));
  } catch { /* debug only */ }
}

// A file button (no link): open its preview like Daniel would and click Download there.
// Only opens and downloads; never sends or changes anything in the chat.
async function downloadByClick(page, file) {
  const chip = await file.frame.$(`[data-chat-bot-file="${file.chipIndex}"]`);
  if (!chip) throw new Error('the file left the page before it could be saved');
  // A file preview still open from the last download covers the chat (2026-11-27 4:35 PM:
  // "spareFrame1 intercepts pointer events", 8 RXO lists missed): close it first, and if the
  // click is still blocked, close again and click through.
  await page.keyboard.press('Escape').catch(() => {});
  await chip.scrollIntoViewIfNeeded().catch(() => {});
  const downloaded = page.waitForEvent('download', { timeout: 30000 });
  downloaded.catch(() => {});
  try {
    await chip.click({ timeout: 8000 });
  } catch {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape').catch(() => {});
    await chip.click({ timeout: 8000, force: true });
  }
  // The preview's Download button (in whichever frame Gmail draws it).
  let clicked = false;
  for (let tries = 0; tries < 20 && !clicked; tries += 1) {
    await page.waitForTimeout(500);
    for (const frame of page.frames()) {
      const button = await frame.$('[role="button"][aria-label^="Download" i], button[aria-label^="Download" i], [data-tooltip^="Download" i]').catch(() => null);
      if (button && await button.isVisible().catch(() => false)) {
        await button.click().catch(() => {});
        clicked = true;
        break;
      }
    }
  }
  if (!clicked) {
    await page.screenshot({ path: path.join(__dirname, 'logs', 'chat-download-fail.png') }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error('the file preview showed no Download button');
  }
  let download;
  try {
    download = await downloaded;
  } catch (error) {
    // What the window showed when no file came (logs/chat-download-fail.png).
    await page.screenshot({ path: path.join(__dirname, 'logs', 'chat-download-fail.png') }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    throw error;
  }
  const fs = require('fs');
  const bytes = fs.readFileSync(await download.path());
  // Close the preview so the chat shows again.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
  return bytes;
}

async function downloadSpreadsheet(context, file, page) {
  if (!file.href && Number.isInteger(file.chipIndex)) return downloadByClick(page, file);
  for (const url of [spreadsheetDownloadUrl(file.href), file.href]) {
    try {
      const response = await context.request.get(url, { timeout: 60000 });
      const type = response.headers()['content-type'] || '';
      if (response.ok() && !type.startsWith('text/html')) return await response.body();
    } catch { /* try the next way */ }
  }
  throw new Error('Google did not hand over the file (open it once in the Chat bot window to check access)');
}

// New posts always appear at the bottom of a chat, while Gmail keeps loading older history
// above (2026-11-27: Wednesday's pictures came in as "new"). So only items BELOW the last one
// already seen are new; with nothing seen on the page, nothing is (better to miss than to
// import an old list). items are in page order, top to bottom.
function newAfterLastSeen(items, isSeen) {
  let last = -1;
  items.forEach((item, index) => { if (isSeen(item)) last = index; });
  return last < 0 ? [] : items.slice(last + 1).filter(item => !isSeen(item));
}

const contentKeyByAddress = new Map();

// Recently saved spreadsheets by content: hash -> { fileName, at } (catches a repeated download).
const recentSheetBytes = new Map();
const sheetHash = bytes => require('crypto').createHash('sha1').update(bytes).digest('hex');
function sameAsEarlierSheet(bytes, fileName, now = Date.now()) {
  const seen = recentSheetBytes.get(sheetHash(bytes));
  return seen && seen.fileName !== fileName && now - seen.at < 60 * 60 * 1000 ? seen.fileName : '';
}
function rememberSheetBytes(bytes, fileName, now = Date.now()) {
  recentSheetBytes.set(sheetHash(bytes), { fileName, at: now });
}

// Spreadsheets that could not be saved yet: key -> tries so far.
const sheetFailures = new Map();
const SHEET_TRIES = 5;
// The newest file in a chat waits one check (its second part may still be coming).
const sheetHeldOnce = new Set();

// New spreadsheets in posting order, grouped into lists: a file with no name right below
// another file is that file's next part. sheets = every file on the page, top to bottom.
function groupSheetParts(sheets, newSheets) {
  const groups = [];
  for (const sheet of newSheets) {
    const previous = sheets[sheets.indexOf(sheet) - 1];
    const last = groups[groups.length - 1];
    if (!sheet.label && last && previous && last.sheets.includes(previous)) {
      last.sheets.push(sheet);
      continue;
    }
    groups.push({ label: sheet.label || '', sheets: [sheet] });
  }
  return groups;
}

// Parts of one list -> one workbook: the first part's header row, then every part's rows.
function mergeSheetParts(parts) {
  const XLSX = require('xlsx');
  const rowsOf = bytes => {
    const workbook = XLSX.read(bytes, { type: 'buffer' });
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: '' });
  };
  const all = parts.map(rowsOf);
  const header = all[0][0] || [];
  const rows = [header];
  all.forEach(part => part.slice(1).forEach(row => { if (row.some(cell => String(cell).trim())) rows.push(row); }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

// A picture's identity by what it shows (its bytes), not its address.
function pictureContentKey(bytes) {
  return `picture|${require('crypto').createHash('sha1').update(bytes).digest('hex')}`;
}

// Pictures already saved for the TMS (waiting or done) count as seen, by content.
function rememberSavedPictures(seen) {
  const fs = require('fs');
  for (const folder of [INBOX_DIR, path.join(INBOX_DIR, 'done')]) {
    let names = [];
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names.filter(item => /\.(png|jpg|webp|gif)$/i.test(item))) {
      try { seen.keys.add(pictureContentKey(fs.readFileSync(path.join(folder, name)))); } catch { /* skip */ }
    }
  }
}

// Reads every big picture in the chat (Chat draws messages in frames).
async function readPageImages(page) {
  const found = [];
  for (const frame of page.frames()) {
    const images = await frame.evaluate(() => Array.from(document.querySelectorAll('img')).map((img, index) => {
      img.dataset.chatBotIndex = String(index);
      const message = img.closest('[data-message-id], [role="listitem"], [jsmodel]');
      const sender = message?.querySelector('[data-name]')?.getAttribute('data-name')
        || message?.querySelector('[data-hovercard-id]')?.textContent || '';
      const postedAt = message?.querySelector('[data-absolute-timestamp]')?.getAttribute('data-absolute-timestamp') || '';
      return { index, src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight, sender: sender.trim(), postedAt };
    })).catch(() => []);
    images.forEach(image => found.push({ ...image, frame }));
  }
  return found;
}

// Gets a picture's bytes: the full-size file with the bot's Google sign-in, or (if Google
// refuses) a screenshot of the picture as shown.
async function downloadImage(context, image) {
  for (const url of [fullSizeUrl(image.src), image.src]) {
    try {
      const response = await context.request.get(url, { timeout: 30000 });
      const type = response.headers()['content-type'] || '';
      if (response.ok() && type.startsWith('image/')) return { bytes: await response.body(), type };
    } catch { /* try the next way */ }
  }
  const element = await image.frame.$(`img[data-chat-bot-index="${image.index}"]`);
  if (!element) throw new Error('the picture left the page before it could be saved');
  return { bytes: await element.screenshot({ type: 'png' }), type: 'image/png' };
}

// Signed in = Google left the page on Gmail / Chat (not the sign-in or "about Gmail" pages).
function isSignedInUrl(url) {
  return /^https:\/\/(chat|mail)\.google\.com\/(mail|chat|u\/|room|app)/.test(String(url || '')) && !/accounts\.google\.com/.test(String(url || ''));
}

// Google refuses sign-in in a browser a program controls ("Couldn't sign you in: this browser
// or app may not be secure", 2026-11-27), so Daniel signs in in a plain Chrome window on the
// bot's own profile, with no program attached. The sign-in is saved in that profile; the bot
// then opens it again and finds Google already signed in.
function findChrome() {
  const fs = require('fs');
  return [
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ].find(file => fs.existsSync(file)) || '';
}

async function signInWithPlainChrome(chatUrl) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Google Chrome is not installed: the Chat bot needs it for the Google sign-in');
  const { spawn } = require('child_process');
  log('>>> ACTION NEEDED: a normal Chrome window opened for the Google sign-in. Sign in with the account that is in LANDJA18,');
  log('>>> wait until Gmail opens, then CLOSE that Chrome window. The bot continues by itself.');
  const child = spawn(chrome, [
    `--user-data-dir=${PROFILE_DIR}`, '--no-first-run', '--no-default-browser-check', '--new-window',
    `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(chatUrl)}`
  ], { stdio: 'ignore' });
  const exited = new Promise(resolve => child.on('exit', resolve));
  const timer = setInterval(() => writeChatStatus('signing-in', 'Waiting for Google sign-in: sign in in the Chrome window, then close it'), 5000);
  writeChatStatus('signing-in', 'Waiting for Google sign-in: sign in in the Chrome window, then close it');
  await exited;
  clearInterval(timer);
  log('Sign-in window closed. Opening Google Chat...');
}

// Opens the bot's browser on the chat, signing in first when Google asks for it.
async function openChatBrowser(chromium, chatUrl) {
  for (let attempt = 1; ; attempt += 1) {
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false, viewport: null, channel: 'chrome', ignoreDefaultArgs: ['--enable-automation']
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(chatUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(6000);
    if (isSignedInUrl(page.url())) return { context, page };
    await context.close().catch(() => {});
    if (attempt > 3) throw new Error('Google still asks for a sign-in after 3 tries');
    await signInWithPlainChrome(chatUrl);
  }
}

// Later on (a reload every 10 minutes): if Google signed the bot out, stop; the watchdog starts
// the bot again and it asks for the sign-in at start-up.
async function waitForSignIn(page) {
  if (isSignedInUrl(page.url())) return;
  await page.waitForTimeout(5000);
  if (!isSignedInUrl(page.url())) throw new Error('Google signed the Chat bot out');
}

// Downloads one list (all its parts) and puts it in the TMS inbox; returns the inbox file name.
async function saveSheetGroup(context, page, chat, group) {
  const first = group.sheets[0];
  const parts = [];
  for (const sheet of group.sheets) {
    const bytes = await downloadSpreadsheet(context, sheet, page);
    // 2026-11-27 6:18 PM: the "fbs" download came back as the big list again (same bytes), so
    // the flatbed list was never imported. A file identical to a different list saved in the
    // last hour is the wrong download: tried again on the next check.
    const repeat = sameAsEarlierSheet(bytes, sheet.fileName);
    if (repeat) throw new Error(`the download gave the earlier list again (${repeat}), not ${sheet.fileName}`);
    parts.push(bytes);
  }
  group.sheets.forEach((sheet, index) => rememberSheetBytes(parts[index], sheet.fileName));
  const bytes = parts.length > 1 ? mergeSheetParts(parts) : parts[0];
  const meta = parts.length > 1
    ? { ...first, label: group.label, fileName: `${first.fileName.replace(/\.xlsx?$/i, '')} (${parts.length} parts).xlsx` }
    : first;
  return addToInbox(bytes, '', { ...meta, chat: chat.name, kind: chat.kind });
}

// Reply threads (Daniel 2026-11-27: lists posted as a reply were never seen, the bot only read
// the main chat). A "N replies" button whose count is new is opened, and RXO export files in it
// from the last 12 hours (the time is in the file name, allLoadsSearch_Export - 2026-11-27T181729)
// go to the TMS, so older history Gmail loads never sends an old list.
const REPLY_COUNT = /\b(\d+)\s+(?:more\s+|new\s+|unread\s+)?repl(?:y|ies)\b/i;
function replyCountOf(label) {
  return Number(String(label || '').match(REPLY_COUNT)?.[1]) || 0;
}
const THREAD_FILE_HOURS = 12;
function isRecentExportName(fileName, now = Date.now(), hours = THREAD_FILE_HOURS) {
  const match = String(fileName || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!match) return false;
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])).getTime();
  return at <= now + 10 * 60 * 1000 && now - at <= hours * 60 * 60 * 1000;
}
const threadKey = (chatUrl, thread) => `thread|${chatUrl}|${thread.anchor}|${thread.count}`;

// The reply buttons on the page: [{ frame, index, label, count, anchor }]. anchor names the
// message the thread hangs on (Google's topic/message id), so a new reply changes only its key.
async function readReplyButtons(page) {
  const found = [];
  for (const frame of page.frames()) {
    const items = await frame.evaluate(pattern => {
      const re = new RegExp(pattern, 'i');
      const labelOf = element => `${element.getAttribute('aria-label') || ''} ${element.innerText || ''}`.replace(/\s+/g, ' ').trim();
      const out = [];
      const all = Array.from(document.querySelectorAll('[role="button"], button, [jsaction*="click"]'));
      for (const element of all) {
        const label = labelOf(element);
        if (!re.test(label) || label.length > 120) continue;
        if (Array.from(element.querySelectorAll('[role="button"], button')).some(child => re.test(labelOf(child)))) continue;
        let anchor = '';
        for (let node = element; node && !anchor; node = node.parentElement) {
          anchor = node.getAttribute?.('data-topic-id') || node.getAttribute?.('data-message-id') || node.getAttribute?.('data-id') || '';
        }
        if (!anchor) continue;
        element.dataset.chatBotThread = String(out.length);
        out.push({ index: out.length, label: label.slice(0, 80), anchor });
      }
      return out;
    }, REPLY_COUNT.source).catch(() => []);
    found.push(...items.map(item => ({ ...item, frame, count: replyCountOf(item.label) })));
  }
  return found;
}

const loggedThreadButtons = new Set();
async function checkReplyThreads(context, tab, seen) {
  const { chat, page } = tab;
  const threads = (await readReplyButtons(page)).filter(thread => thread.count > 0);
  const startKey = `${chat.url}|threads`;
  if (!seen.started.has(startKey)) {
    threads.forEach(thread => seen.keys.add(threadKey(chat.url, thread)));
    seen.started.add(startKey);
    writeSeen(seen);
    log(`${chat.name}: first look at reply threads, ${threads.length} already there are skipped. New replies go to the TMS.`);
    return;
  }
  for (const thread of threads) {
    const key = threadKey(chat.url, thread);
    if (seen.keys.has(key)) continue;
    if (!loggedThreadButtons.has(key)) {
      loggedThreadButtons.add(key);
      log(`${chat.name}: reply thread "${thread.label}" has new replies; opening it.`);
    }
    const opened = await thread.frame.evaluate(index => {
      const element = document.querySelector(`[data-chat-bot-thread="${index}"]`);
      if (!element) return false;
      element.click();
      return true;
    }, thread.index).catch(() => false);
    if (!opened) continue;
    await page.waitForTimeout(3000);
    const sheets = pickSpreadsheets(await readPageFiles(page));
    // Files not seen yet: recent RXO exports go to the TMS; anything older is only marked seen.
    const unseen = sheets.filter(sheet => !seen.keys.has(sheet.key));
    const fresh = unseen.filter(sheet => isRecentExportName(sheet.fileName));
    unseen.filter(sheet => !fresh.includes(sheet)).forEach(sheet => seen.keys.add(sheet.key));
    let failed = false;
    for (const group of groupSheetParts(sheets, fresh)) {
      const names = group.sheets.map(sheet => sheet.fileName).join(' + ');
      try {
        const name = await saveSheetGroup(context, page, chat, group);
        log(`${chat.name}: new spreadsheet in a reply thread ${group.label ? `"${group.label}" ` : ''}(${names}), saved for the TMS (${name}).`);
        group.sheets.forEach(sheet => seen.keys.add(sheet.key));
      } catch (error) {
        failed = true;
        log(`${chat.name}: could not save spreadsheet ${names} from a reply thread: ${error.message}. Trying again on the next check.`);
      }
    }
    if (!failed) seen.keys.add(key);
    writeSeen(seen);
    // Close the thread (Escape closes Gmail's thread panel; an inline thread just stays open).
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
    if (failed) break;
  }
}

// One look at one chat: remembers its pictures and spreadsheets the first time, saves new
// ones after that.
async function checkChat(context, tab, seen) {
  const { chat, page } = tab;
  // RXO's chat sends spreadsheets: its pictures are only the files' previews, never lists.
  const images = chat.kind === 'rxo' ? [] : pickListImages(await readPageImages(page));
  const sheets = pickSpreadsheets(await readPageFiles(page));
  if (!sheets.length) await writeFileDebug(page, chat);
  // Single loads posted as messages (RXO's chat only).
  const loadMessages = chat.kind === 'rxo' ? await readLoadMessages(page) : [];
  // Load messages already in the chat before this kind was read (2026-11-27) count as seen.
  const loadsStartKey = `${chat.url}|loads`;
  if (!seen.started.has(loadsStartKey)) {
    loadMessages.forEach(item => seen.keys.add(item.key));
    seen.started.add(loadsStartKey);
    writeSeen(seen);
    if (seen.started.has(chat.url)) log(`${chat.name}: first look at single-load messages, ${loadMessages.length} already there are skipped.`);
  }
  if (!seen.started.has(chat.url)) {
    [...images, ...sheets].forEach(item => seen.keys.add(item.key));
    // Remember the pictures already there by content too (their addresses change).
    for (const image of images) {
      try { seen.keys.add(pictureContentKey((await downloadImage(context, image)).bytes)); } catch { /* address key only */ }
    }
    seen.started.add(chat.url);
    writeSeen(seen);
    log(`${chat.name}: first look, ${images.length} picture(s), ${sheets.length} spreadsheet(s) and ${loadMessages.length} single-load message(s) already there are skipped. New ones go to the TMS.`);
    return;
  }
  // Only items below the last one already seen are new; older history Gmail loads above them
  // is marked seen and never sent.
  const takeNew = (items, isSeen, keysOf) => {
    const fresh = newAfterLastSeen(items, isSeen);
    let changed = false;
    for (const item of items) {
      if (!fresh.includes(item) && !isSeen(item)) { keysOf(item).forEach(key => seen.keys.add(key)); changed = true; }
    }
    if (changed) writeSeen(seen);
    return fresh;
  };
  const newLoads = takeNew(loadMessages, item => seen.keys.has(item.key), item => [item.key]);
  const newSheets = takeNew(sheets, item => seen.keys.has(item.key), item => [item.key]);
  // Pictures by content (their addresses change on every page load); each address is
  // downloaded once per run.
  for (const image of images) {
    if (!contentKeyByAddress.has(image.key)) {
      try { contentKeyByAddress.set(image.key, pictureContentKey((await downloadImage(context, image)).bytes)); } catch { /* try again next check */ }
    }
    image.contentKey = contentKeyByAddress.get(image.key) || '';
  }
  const newImages = takeNew(images.filter(image => image.contentKey),
    image => seen.keys.has(image.contentKey) || seen.keys.has(image.key), image => [image.key, image.contentKey]);

  for (const message of newLoads) {
    try {
      const name = addToInbox(Buffer.from(message.text, 'utf8'), 'text/plain', {
        type: 'load', chat: chat.name, kind: chat.kind, label: `Load ${message.loadNumber}`, key: message.key
      });
      log(`${chat.name}: new single load ${message.loadNumber}, saved for the TMS (${name}).`);
    } catch (error) {
      log(`${chat.name}: could not save load message ${message.loadNumber}: ${error.message}. It is skipped.`);
    }
    seen.keys.add(message.key);
    writeSeen(seen);
  }
  // A file posted right below a named list with no name of its own is the same list's next
  // part (Daniel 2026-11-27: "the panels list comes in two different spreadsheets"): the parts
  // go to the TMS as ONE list, since a second part on its own would replace the first. The
  // newest file waits one check, in case its second part is still being posted.
  const groups = groupSheetParts(sheets, newSheets);
  const newest = sheets[sheets.length - 1];
  const lastGroup = groups[groups.length - 1];
  if (lastGroup && newest && lastGroup.sheets.includes(newest) && !sheetHeldOnce.has(newest.key)) {
    sheetHeldOnce.add(newest.key);
    groups.pop();
  }
  for (const group of groups) {
    const first = group.sheets[0];
    const names = group.sheets.map(sheet => sheet.fileName).join(' + ');
    try {
      const name = await saveSheetGroup(context, page, chat, group);
      log(`${chat.name}: new spreadsheet ${group.label ? `"${group.label}" ` : ''}(${names})${first.sender ? ` from ${first.sender}` : ''}, saved for the TMS (${name}).`);
      sheetFailures.delete(first.key);
    } catch (error) {
      // Tried again on the next checks (a list later in the chat waits, so the order holds and
      // nothing above the newest saved list is taken for old history). Skipped after 5 tries.
      const tries = (sheetFailures.get(first.key) || 0) + 1;
      sheetFailures.set(first.key, tries);
      if (tries < SHEET_TRIES) {
        log(`${chat.name}: could not save spreadsheet ${names} (try ${tries} of ${SHEET_TRIES}): ${error.message}. Trying again on the next check.`);
        break;
      }
      log(`${chat.name}: could not save spreadsheet ${names} after ${SHEET_TRIES} tries: ${error.message}. It is skipped; import it by hand.`);
      sheetFailures.delete(first.key);
    }
    group.sheets.forEach(sheet => seen.keys.add(sheet.key));
    writeSeen(seen);
  }
  for (const image of newImages) {
    try {
      const { bytes, type } = await downloadImage(context, image);
      seen.keys.add(image.contentKey);
      const name = addToInbox(bytes, type, { ...image, chat: chat.name, kind: chat.kind });
      log(`${chat.name}: new picture${image.sender ? ` from ${image.sender}` : ''}, saved for the TMS (${name}).`);
    } catch (error) {
      log(`${chat.name}: could not save a new picture: ${error.message}. It is skipped.`);
    }
    seen.keys.add(image.key);
    writeSeen(seen);
  }
}

async function main() {
  const config = readChatConfig();
  if (!config.enabled) {
    log('The Google Chat bot is OFF. To turn it on, set "enabled": true and paste each chat\'s address in bot/chat-bot-config.json.');
    writeChatStatus('off', 'Turned off in bot/chat-bot-config.json');
    return;
  }
  if (config.missing.length) log(`No address yet for: ${config.missing.join(', ')} (not watched until it is added).`);
  const { chromium } = require('playwright');
  writeChatStatus('starting', 'Opening Google Chat');
  const { context, page: firstPage } = await openChatBrowser(chromium, config.chats[0].url);
  // Test:  node chat-bot.js --test-download <folder>   lists the first chat's spreadsheets with
  // their list names and saves only the newest one into <folder>. Nothing goes to the TMS.
  // Recover:  node chat-bot.js --recover <text>   sends every RXO-chat spreadsheet whose file name
  // contains <text> to the TMS inbox, as if it had just come in (2026-11-27: lists missed while
  // the window was stuck). Then it closes.
  const recoverAt = process.argv.indexOf('--recover');
  if (recoverAt >= 0) {
    const match = String(process.argv[recoverAt + 1] || '');
    const chat = config.chats.find(item => item.kind === 'rxo') || config.chats[0];
    if (firstPage.url() !== chat.url) await firstPage.goto(chat.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await firstPage.waitForTimeout(8000);
    const seen = readSeen();
    const onPage = pickSpreadsheets(await readPageFiles(firstPage));
    log(`Recover: the chat shows ${onPage.length} spreadsheet(s); newest: ${onPage.slice(-6).map(sheet => `"${sheet.label || '?'}" ${sheet.fileName}`).join(' | ')}`);
    const wanted = onPage.filter(sheet => match && sheet.fileName.includes(match));
    for (const sheet of wanted) {
      try {
        const bytes = await downloadSpreadsheet(context, sheet, firstPage);
        const repeat = sameAsEarlierSheet(bytes, sheet.fileName);
        if (repeat) throw new Error(`the download gave ${repeat} again`);
        rememberSheetBytes(bytes, sheet.fileName);
        const name = addToInbox(bytes, '', { ...sheet, chat: chat.name, kind: chat.kind });
        log(`Recover: "${sheet.label || '(no name above)'}" (${sheet.fileName}) saved for the TMS (${name}).`);
      } catch (error) {
        log(`Recover: could not save ${sheet.fileName}: ${error.message}`);
      }
      seen.keys.add(sheet.key);
      writeSeen(seen);
    }
    log(`Recover: ${wanted.length} spreadsheet(s) matched "${match}".`);
    await context.close();
    return;
  }
  const testAt = process.argv.indexOf('--test-download');
  if (testAt >= 0) {
    const fs = require('fs');
    const folder = process.argv[testAt + 1];
    // The RXO chat when there is one (it has the spreadsheets and single loads).
    const testChat = config.chats.find(chat => chat.kind === 'rxo') || config.chats[0];
    if (firstPage.url() !== testChat.url) await firstPage.goto(testChat.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await firstPage.waitForTimeout(8000);
    const sheets = pickSpreadsheets(await readPageFiles(firstPage));
    log(`Test: ${sheets.length} spreadsheet(s) in ${testChat.name}:`);
    sheets.forEach(sheet => log(`  "${sheet.label || '(no name above)'}"  ${sheet.fileName}`));
    const loadMessages = await readLoadMessages(firstPage);
    log(`Test: ${loadMessages.length} single-load message(s): ${loadMessages.map(item => item.loadNumber).join(', ')}`);
    if (loadMessages[0]) log(`Test: first one reads as:\n${loadMessages[0].text}`);
    if (sheets.length && folder) {
      const newest = sheets[sheets.length - 1];
      const bytes = await downloadSpreadsheet(context, newest, firstPage);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, newest.fileName), bytes);
      log(`Test: saved ${newest.fileName} (${bytes.length} bytes) to ${folder}`);
    }
    await context.close();
    return;
  }
  context.on('close', () => { log('The Chat bot window was closed.'); process.exit(0); });
  const tabs = [];
  for (const chat of config.chats) {
    const page = tabs.length === 0 ? firstPage : await context.newPage();
    if (page.url() !== chat.url) await page.goto(chat.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(8000);
    tabs.push({ chat, page });
    log(`Watching ${chat.name}: ${chat.url}`);
  }

  const seen = readSeen();
  rememberSavedPictures(seen);
  let lastReload = Date.now();
  let failingSince = 0;
  for (;;) {
    try {
      if (!readChatConfig().enabled) {
        log('Turned off in bot/chat-bot-config.json. Closing.');
        writeChatStatus('off', 'Turned off in bot/chat-bot-config.json');
        await context.close();
        return;
      }
      const reload = Date.now() - lastReload > RELOAD_MS;
      let chatFailed = '';
      for (const tab of tabs) {
        if (tab.page.isClosed()) {
          log(`${tab.chat.name}: its tab was closed; opening it again.`);
          tab.page = await context.newPage();
          await tab.page.goto(tab.chat.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await tab.page.waitForTimeout(8000);
          await waitForSignIn(tab.page);
        }
        if (reload) {
          await tab.page.goto(tab.chat.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await waitForSignIn(tab.page);
        }
        await tab.page.waitForTimeout(3000);
        try {
          await checkChat(context, tab, seen);
          if (tab.chat.kind === 'rxo') await checkReplyThreads(context, tab, seen);
        } catch (error) {
          log(`${tab.chat.name}: check failed: ${error.message}`);
          chatFailed = `${tab.chat.name}: ${error.message}`;
        }
      }
      if (reload) lastReload = Date.now();
      if (chatFailed) {
        if (!failingSince) failingSince = Date.now();
        writeChatStatus('running', `Last check failed: ${chatFailed}`, Date.now(), { failingSince });
        await new Promise(resolve => setTimeout(resolve, CHECK_MS));
        continue;
      }
      failingSince = 0;
      writeChatStatus('running', `Watching ${tabs.map(tab => tab.chat.name).join(' and ')} · last check ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);
    } catch (error) {
      // Signed out: close; the watchdog starts the bot again and it asks for the sign-in.
      if (/signed the Chat bot out/.test(error.message)) throw error;
      log(`Check failed: ${error.message}`);
      if (!failingSince) failingSince = Date.now();
      writeChatStatus('running', `Last check failed: ${error.message}`, Date.now(), { failingSince });
    }
    await new Promise(resolve => setTimeout(resolve, CHECK_MS));
  }
}

if (require.main === module) {
  main().catch(error => {
    log(`Google Chat bot stopped: ${error.message}`);
    try { writeChatStatus('blocked', error.message); } catch { /* exit anyway */ }
    process.exit(1);
  });
}

module.exports = { replyCountOf, isRecentExportName, sameAsEarlierSheet, rememberSheetBytes, pickListImages, imageKey, fullSizeUrl, pickSpreadsheets, attachmentId, spreadsheetDownloadUrl, pickListLabel, isSignedInUrl, newAfterLastSeen, groupSheetParts, mergeSheetParts };
