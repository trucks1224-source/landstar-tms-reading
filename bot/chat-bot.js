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
  readChatConfig, writeChatStatus, readSeen, writeSeen, addToInbox, spreadsheetExtension
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
    if (!spreadsheetExtension(fileName) || !/^https:\/\//.test(href)) continue;
    const key = `file|${fileName}|${attachmentId(href)}`;
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
  const skip = /^(\d{1,2}:\d{2}\s*(am|pm)?|now|yesterday|today|edited|\d+\s*(min|mins|hr|hrs)|reply|thread|view|download|open|history is on)$/i;
  for (let index = (texts || []).length - 1; index >= 0; index -= 1) {
    const text = String(texts[index] || '').replace(/\s+/g, ' ').trim();
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
      // Walk the page top to bottom: text pieces since the last file, then each file link.
      const results = [];
      let texts = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement;
          if (!parent || parent.closest('a[href], script, style, [aria-hidden="true"]')) continue;
          const text = node.textContent.replace(/\s+/g, ' ').trim();
          if (text) texts.push(text);
          continue;
        }
        if (node.tagName !== 'A' || !node.href) continue;
        const chip = node.closest('[data-message-id], [role="listitem"], [jsmodel]') || node;
        const fileName = nameOf(node) || nameOf(chip);
        if (!fileName) continue;
        const message = node.closest('[data-message-id], [role="listitem"]');
        results.push({
          fileName, href: node.href, texts: texts.slice(-12),
          sender: (message?.querySelector('[data-name]')?.getAttribute('data-name') || '').trim(),
          postedAt: message?.querySelector('[data-absolute-timestamp]')?.getAttribute('data-absolute-timestamp') || ''
        });
        texts = [];
      }
      return results;
    }).catch(() => []);
    found.push(...files.map(({ texts, ...file }) => ({ ...file, label: pickListLabel(texts) })));
  }
  return found;
}

async function downloadSpreadsheet(context, file) {
  for (const url of [spreadsheetDownloadUrl(file.href), file.href]) {
    try {
      const response = await context.request.get(url, { timeout: 60000 });
      const type = response.headers()['content-type'] || '';
      if (response.ok() && !type.startsWith('text/html')) return await response.body();
    } catch { /* try the next way */ }
  }
  throw new Error('Google did not hand over the file (open it once in the Chat bot window to check access)');
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

async function waitForSignIn(page, chatUrl) {
  let asked = false;
  for (;;) {
    if (/^https:\/\/(chat|mail)\.google\.com\//.test(page.url()) && !/accounts\.google\.com/.test(page.url())) return;
    if (!asked) {
      log('>>> ACTION NEEDED: sign in to Google in the Chat bot window. The bot continues by itself.');
      asked = true;
    }
    writeChatStatus('signing-in', 'Waiting for Google sign-in in the Chat bot window');
    await page.waitForTimeout(5000);
    if (/myaccount\.google\.com|google\.com\/?$/.test(page.url())) await page.goto(chatUrl).catch(() => {});
  }
}

// One look at one chat: remembers its pictures and spreadsheets the first time, saves new
// ones after that.
async function checkChat(context, tab, seen) {
  const { chat, page } = tab;
  const images = pickListImages(await readPageImages(page));
  const sheets = pickSpreadsheets(await readPageFiles(page));
  if (!seen.started.has(chat.url)) {
    [...images, ...sheets].forEach(item => seen.keys.add(item.key));
    seen.started.add(chat.url);
    writeSeen(seen);
    log(`${chat.name}: first look, ${images.length} picture(s) and ${sheets.length} spreadsheet(s) already there are skipped. New ones go to the TMS.`);
    return;
  }
  for (const sheet of sheets.filter(item => !seen.keys.has(item.key))) {
    try {
      const bytes = await downloadSpreadsheet(context, sheet);
      const name = addToInbox(bytes, '', { ...sheet, chat: chat.name, kind: chat.kind });
      log(`${chat.name}: new spreadsheet ${sheet.label ? `"${sheet.label}" ` : ''}(${sheet.fileName})${sheet.sender ? ` from ${sheet.sender}` : ''}, saved for the TMS (${name}).`);
    } catch (error) {
      log(`${chat.name}: could not save spreadsheet ${sheet.fileName}: ${error.message}. It is skipped.`);
    }
    seen.keys.add(sheet.key);
    writeSeen(seen);
  }
  for (const image of images.filter(item => !seen.keys.has(item.key))) {
    try {
      const { bytes, type } = await downloadImage(context, image);
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
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: null });
  context.on('close', () => { log('The Chat bot window was closed.'); process.exit(0); });
  const tabs = [];
  for (const chat of config.chats) {
    const page = (tabs.length === 0 && context.pages()[0]) || await context.newPage();
    await page.goto(chat.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitForSignIn(page, chat.url);
    tabs.push({ chat, page });
    log(`Watching ${chat.name} (${chat.kind === 'rxo' ? 'RXO' : 'Para'}): ${chat.url}`);
  }

  const seen = readSeen();
  let lastReload = Date.now();
  for (;;) {
    try {
      if (!readChatConfig().enabled) {
        log('Turned off in bot/chat-bot-config.json. Closing.');
        writeChatStatus('off', 'Turned off in bot/chat-bot-config.json');
        await context.close();
        return;
      }
      const reload = Date.now() - lastReload > RELOAD_MS;
      for (const tab of tabs) {
        if (reload) {
          await tab.page.goto(tab.chat.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await waitForSignIn(tab.page, tab.chat.url);
        }
        await tab.page.waitForTimeout(3000);
        try {
          await checkChat(context, tab, seen);
        } catch (error) {
          log(`${tab.chat.name}: check failed: ${error.message}`);
        }
      }
      if (reload) lastReload = Date.now();
      writeChatStatus('running', `Watching ${tabs.map(tab => tab.chat.name).join(' and ')} · last check ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);
    } catch (error) {
      log(`Check failed: ${error.message}`);
      writeChatStatus('running', `Last check failed: ${error.message}`);
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

module.exports = { pickListImages, imageKey, fullSizeUrl, pickSpreadsheets, attachmentId, spreadsheetDownloadUrl, pickListLabel };
