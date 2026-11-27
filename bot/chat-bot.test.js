const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-bot-'));
process.env.CHAT_INBOX_DIR = path.join(dir, 'inbox');
process.env.CHAT_BOT_CONFIG_FILE = path.join(dir, 'config.json');
process.env.CHAT_BOT_STATUS_FILE = path.join(dir, 'status.json');
process.env.CHAT_BOT_SEEN_FILE = path.join(dir, 'seen.json');

const inbox = require('./chat-inbox');
const { pickListImages, imageKey, fullSizeUrl, pickSpreadsheets, attachmentId, spreadsheetDownloadUrl, pickListLabel } = require('./chat-bot');

test('RXO list label: the message just above the file ("big list", "fbs", "reefer")', () => {
  // As LANDJA18 shows it: a message, then the file chip; the previous file's chip text in between.
  assert.equal(pickListLabel(['Tyler Cook', 'yessir otw in a sec', 'big list']), 'big list');
  assert.equal(pickListLabel(['allLoadsSearch_Export - 2026-11-27T08…', 'fbs']), 'fbs');
  assert.equal(pickListLabel(['reefer', '8:12 AM', 'allLoadsSearch_Export - 2026-11-27T08.xlsx']), 'reefer', 'times and file names are skipped');
  assert.equal(pickListLabel([]), '');
});

const writeConfig = value => fs.writeFileSync(process.env.CHAT_BOT_CONFIG_FILE, JSON.stringify(value));

test('the Google Chat bot is off until enabled with at least one chat address', () => {
  fs.rmSync(process.env.CHAT_BOT_CONFIG_FILE, { force: true });
  assert.equal(inbox.readChatConfig().enabled, false, 'no config file = off');
  const shipped = inbox.readChatConfig(path.join(__dirname, 'chat-bot-config.json'));
  assert.equal(shipped.enabled, false, 'the config in the project starts off');
  writeConfig({ enabled: true, chats: [{ name: 'LANDJA.18', kind: 'rxo', url: '' }] });
  assert.equal(inbox.readChatConfig().enabled, false, 'no address yet = off');
  writeConfig({ enabled: true, chats: [
    { name: 'Para', kind: 'para', url: 'https://chat.google.com/room/AAAA' },
    { name: 'LANDJA.18', kind: 'rxo', url: '' }
  ] });
  const config = inbox.readChatConfig();
  assert.equal(config.enabled, true);
  assert.deepEqual(config.chats.map(chat => chat.kind), ['para']);
  assert.deepEqual(config.missing, ['LANDJA.18']);
  writeConfig({ enabled: true, chats: [{ name: 'Bad', url: 'https://evil.example.com/room' }] });
  assert.equal(inbox.readChatConfig().enabled, false, 'only Google Chat addresses');
});

test('only big pictures count as lists, each once', () => {
  const picked = pickListImages([
    { src: 'https://lh3.googleusercontent.com/abc=w512-h300', width: 1200, height: 700 },
    { src: 'https://lh3.googleusercontent.com/abc=w1024-h600', width: 1200, height: 700 },
    { src: 'https://lh3.googleusercontent.com/avatar=s32', width: 32, height: 32 },
    { src: 'data:image/png;base64,xxx', width: 900, height: 900 }
  ]);
  assert.equal(picked.length, 1, 'same picture at two sizes; avatar and inline data skipped');
  assert.equal(imageKey('https://lh3.googleusercontent.com/abc=w512-h300'), 'https://lh3.googleusercontent.com/abc');
  assert.equal(fullSizeUrl('https://lh3.googleusercontent.com/abc=w512-h300'), 'https://lh3.googleusercontent.com/abc=s0');
});

test('RXO spreadsheets: Excel and CSV attachments are picked, each attachment once', () => {
  const sheets = pickSpreadsheets([
    { fileName: 'RXO ATZ H 11-27.xlsx', href: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit' },
    { fileName: 'RXO ATZ H 11-27.xlsx', href: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view' },
    { fileName: 'loads.csv', href: 'https://chat.google.com/u/0/api/get_attachment_url?url_type=DOWNLOAD_URL&attachment_token=XYZ&auth=abc' },
    { fileName: 'notes.pdf', href: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz99999/view' }
  ]);
  assert.deepEqual(sheets.map(sheet => sheet.fileName), ['RXO ATZ H 11-27.xlsx', 'loads.csv']);
  assert.equal(attachmentId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz99999/view'), '1AbCdEfGhIjKlMnOpQrStUvWxYz99999');
  assert.equal(spreadsheetDownloadUrl('https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0'), 'https://docs.google.com/spreadsheets/d/ABC123/export?format=xlsx');
  assert.equal(spreadsheetDownloadUrl('https://drive.google.com/file/d/XYZ789/view'), 'https://drive.google.com/uc?export=download&id=XYZ789');
});

test('inbox: saves pictures and spreadsheets with their chat, lists them, moves them out when done', () => {
  const picture = inbox.addToInbox(Buffer.from('png-bytes'), 'image/png', { chat: 'Para', kind: 'para', sender: 'Heather' }, 1795788000000);
  const sheet = inbox.addToInbox(Buffer.from('xlsx-bytes'), '', { chat: 'LANDJA.18', kind: 'rxo', fileName: 'RXO ATZ P.xlsx' }, 1795788000001);
  assert.throws(() => inbox.addToInbox(Buffer.from('x'), '', { fileName: 'notes.pdf' }), /Not a picture or spreadsheet/);
  const items = inbox.listInbox();
  assert.deepEqual(items.map(item => [item.name, item.type, item.kind]), [[picture, 'picture', 'para'], [sheet, 'spreadsheet', 'rxo']]);
  assert.equal(items[1].fileName, 'RXO ATZ P.xlsx');
  assert.equal(inbox.contentTypeOf(sheet), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.throws(() => inbox.inboxFilePath('../../secrets.json'), /Unknown inbox picture/);
  assert.equal(inbox.markInboxDone(picture), true);
  assert.deepEqual(inbox.listInbox().map(item => item.name), [sheet]);
});

test('seen list remembers which chats had their first look', () => {
  const seen = inbox.readSeen();
  seen.started.add('https://chat.google.com/room/AAAA');
  seen.keys.add('k1');
  inbox.writeSeen(seen);
  const again = inbox.readSeen();
  assert.equal(again.started.has('https://chat.google.com/room/AAAA'), true);
  assert.equal(again.keys.has('k1'), true);
});
