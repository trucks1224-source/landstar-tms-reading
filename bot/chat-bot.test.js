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
const { pickListImages, imageKey, fullSizeUrl, pickSpreadsheets, attachmentId, spreadsheetDownloadUrl, pickListLabel, isSignedInUrl, newAfterLastSeen } = require('./chat-bot');

test('only items below the last one seen are new (older history loading above is not)', () => {
  const seenKeys = new Set(['b', 'c']);
  const isSeen = item => seenKeys.has(item);
  assert.deepEqual(newAfterLastSeen(['old1', 'b', 'old2', 'c', 'new1', 'new2'], isSeen), ['new1', 'new2']);
  assert.deepEqual(newAfterLastSeen(['history', 'b', 'c'], isSeen), [], 'history above is never new');
  assert.deepEqual(newAfterLastSeen(['x', 'y'], isSeen), [], 'nothing seen on the page: nothing is new');
});

test('signed in only when Google leaves the bot on Gmail or Chat', () => {
  assert.equal(isSignedInUrl('https://mail.google.com/mail/u/0/#chat/space/AAAAA4kpZmM'), true);
  assert.equal(isSignedInUrl('https://chat.google.com/room/AAAA'), true);
  assert.equal(isSignedInUrl('https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fmail.google.com'), false);
  assert.equal(isSignedInUrl('https://workspace.google.com/gmail/'), false, 'the "about Gmail" page');
  assert.equal(isSignedInUrl('https://mail.google.com/'), false, 'not into the inbox yet');
});

test('RXO list label: the message just above the file ("big list", "fbs", "reefer")', () => {
  // As LANDJA18 shows it: a message, then the file chip; the previous file's chip text in between.
  assert.equal(pickListLabel(['Tyler Cook', 'yessir otw in a sec', 'big list']), 'big list');
  assert.equal(pickListLabel(['allLoadsSearch_Export - 2026-11-27T08…', 'fbs']), 'fbs');
  assert.equal(pickListLabel(['reefer', '8:12 AM', 'allLoadsSearch_Export - 2026-11-27T08.xlsx']), 'reefer', 'times and file names are skipped');
  assert.equal(pickListLabel([]), '');
  assert.equal(pickListLabel(['solar', 'Only visible to you']), 'solar', "Gmail's own notices are skipped");
  assert.equal(pickListLabel(['solar', ',']), 'solar', 'a lone comma is not a name');
  assert.equal(pickListLabel(['$$']), '$$');
});

const writeConfig = value => fs.writeFileSync(process.env.CHAT_BOT_CONFIG_FILE, JSON.stringify(value));

test('the Google Chat bot is off until enabled with at least one chat address', () => {
  fs.rmSync(process.env.CHAT_BOT_CONFIG_FILE, { force: true });
  assert.equal(inbox.readChatConfig().enabled, false, 'no config file = off');
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

test('a file with no name right below a named list is its next part, merged into one list', () => {
  const { groupSheetParts, mergeSheetParts } = require('./chat-bot');
  const XLSX = require('xlsx');
  const sheet = (fileName, label) => ({ fileName, label, key: fileName });
  const page = [sheet('a.xlsx', 'haz'), sheet('b.xlsx', 'panels'), sheet('c.xlsx', ''), sheet('d.xlsx', 'reefer')];
  const groups = groupSheetParts(page, page.slice(1));
  assert.deepEqual(groups.map(group => [group.label, group.sheets.map(item => item.fileName)]),
    [['panels', ['b.xlsx', 'c.xlsx']], ['reefer', ['d.xlsx']]]);
  const book = rows => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };
  const merged = mergeSheetParts([book([['Order'], ['1'], ['2']]), book([['Order'], ['3']])]);
  const rows = XLSX.utils.sheet_to_json(XLSX.read(merged).Sheets.Sheet1, { header: 1 });
  assert.deepEqual(rows.map(row => String(row[0])), ['Order', '1', '2', '3']);
});

test('a download identical to a different list saved within the hour is caught', () => {
  const { sameAsEarlierSheet, rememberSheetBytes } = require('./chat-bot');
  const big = Buffer.from('big list bytes');
  rememberSheetBytes(big, 'export-181729.xlsx', 1000);
  assert.equal(sameAsEarlierSheet(big, 'export-181742.xlsx', 2000), 'export-181729.xlsx', 'the fbs download came back as the big list');
  assert.equal(sameAsEarlierSheet(big, 'export-181729.xlsx', 2000), '', 'the same file again is fine');
  assert.equal(sameAsEarlierSheet(Buffer.from('fbs bytes'), 'export-181742.xlsx', 2000), '');
  assert.equal(sameAsEarlierSheet(big, 'export-181742.xlsx', 1000 + 61 * 60 * 1000), '', 'older than an hour: not compared');
});

test('reply thread buttons and recent RXO export names', () => {
  const { replyCountOf, isRecentExportName } = require('./chat-bot');
  assert.equal(replyCountOf('1 reply'), 1);
  assert.equal(replyCountOf('3 replies  Last reply 5 min'), 3);
  assert.equal(replyCountOf('2 unread replies'), 2);
  assert.equal(replyCountOf('Reply'), 0, 'the plain Reply button is not a thread');
  const now = new Date(2026, 10, 27, 21, 40).getTime();
  assert.equal(isRecentExportName('allLoadsSearch_Export - 2026-11-27T210512.123.xlsx', now), true);
  assert.equal(isRecentExportName('allLoadsSearch_Export - 2026-11-27T091512.123.xlsx', now), false, 'more than 12 hours old');
  assert.equal(isRecentExportName('allLoadsSearch_Export - 2026-11-20T210512.123.xlsx', now), false, 'old history');
  assert.equal(isRecentExportName('panels.xlsx', now), false, 'no time in the name: left for Daniel');
});
