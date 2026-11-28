// Google Chat inbox: list screenshots the chat bot (bot/chat-bot.js) saved from Daniel's
// Google Chat groups, waiting for the TMS to import them:
//   - Para lists (Heather, Olga, Ashley, Edgar)         kind "para"
//   - RXO, the chat called LANDJA.18                     kind "rxo"
//
//   bot/chat-inbox/<name>.png   a picture posted in a chat, not imported yet
//   bot/chat-inbox/<name>.json  which chat, who posted it and when
//   bot/chat-inbox/done/        pictures the TMS imported or Daniel cancelled
//
// The TMS server (vite.config.js) lists the inbox at GET /api/chat-inbox; the TMS shows each
// picture in the same "Which list is this?" window as a Ctrl+V paste, with that chat's accounts.
//
// The bot is OFF until bot/chat-bot-config.json has "enabled": true and each chat's address
// (Daniel 2026-11-27: built now, turned on once the new laptop arrives).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INBOX_DIR = process.env.CHAT_INBOX_DIR || path.join(__dirname, 'chat-inbox');
const DONE_DIR = path.join(INBOX_DIR, 'done');
const CONFIG_FILE = process.env.CHAT_BOT_CONFIG_FILE || path.join(__dirname, 'chat-bot-config.json');
const STATUS_FILE = process.env.CHAT_BOT_STATUS_FILE || path.join(__dirname, 'chat-bot-status.json');
const SEEN_FILE = process.env.CHAT_BOT_SEEN_FILE || path.join(__dirname, 'chat-bot-seen.json');
const SEEN_LIMIT = 2000;
const IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
// Spreadsheets (the RXO chat LANDJA.18 sends its load lists as Excel files).
const SHEET_TYPES = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv'
};
// Inbox file names are made here; anything else is refused (no paths from requests).
const INBOX_NAME = /^chat-\d{13}-[a-f0-9]{12}\.(png|jpg|webp|gif|xlsx|xls|csv|txt)$/;

// A chat attachment's file name -> its spreadsheet extension, or '' when it is not one.
function spreadsheetExtension(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return SHEET_TYPES[ext] ? ext : '';
}

function readJson(file, fallback) {
  // A file saved by Notepad or PowerShell may start with a byte-order mark: ignore it.
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
}

function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

const CHAT_KINDS = new Set(['para', 'rxo']);
const isChatUrl = url => /^https:\/\/(chat|mail)\.google\.com\//.test(url);

// { enabled, chats: [{ name, url, kind }], missing: [names without an address] }.
// Missing or unreadable file = off. On only when at least one chat has its address.
function readChatConfig(file = CONFIG_FILE) {
  const config = readJson(file, {});
  const all = (Array.isArray(config.chats) ? config.chats : []).map(chat => ({
    name: String(chat?.name || '').trim(),
    url: String(chat?.url || '').trim(),
    kind: CHAT_KINDS.has(chat?.kind) ? chat.kind : 'para'
  })).filter(chat => chat.name || chat.url);
  const chats = all.filter(chat => isChatUrl(chat.url));
  return {
    enabled: config.enabled === true && chats.length > 0,
    chats,
    missing: all.filter(chat => !isChatUrl(chat.url)).map(chat => chat.name || chat.url)
  };
}

// The bot's heartbeat, written every check. Older than 90 s = not running.
// failingSince: when the checks started failing (cleared by the next good check), so the TMS
// can say the bot is stuck even while it still says "running" (2026-11-27: 16 lists missed).
function writeChatStatus(state, message, now = Date.now(), extra = {}) {
  writeJson(STATUS_FILE, { state, message, at: now, pid: process.pid, ...extra });
}

function readChatStatus(now = Date.now()) {
  const status = readJson(STATUS_FILE, null);
  return status && now - Number(status.at) < 90000 ? status : { state: 'off', message: 'Google Chat bot is not running' };
}

// Pictures already handled (a key per Chat picture), and the chats the bot has already
// looked at once (by address): a chat's first look only remembers what is there.
function readSeen() {
  const seen = readJson(SEEN_FILE, null);
  return {
    started: new Set(Array.isArray(seen?.started) ? seen.started : []),
    keys: new Set(Array.isArray(seen?.keys) ? seen.keys : [])
  };
}

function writeSeen(seen) {
  writeJson(SEEN_FILE, { started: [...seen.started], keys: [...seen.keys].slice(-SEEN_LIMIT) });
}

// Saves one picture or spreadsheet for the TMS. meta = { chat, kind, sender, postedAt, key,
// fileName (a spreadsheet's name in the chat), label (the message above it, e.g. "big list") }.
// Returns the inbox file name.
function addToInbox(bytes, contentType, meta = {}, now = Date.now()) {
  // A single-load message (Tyler's "Load Number: ..." posts) is saved as its text.
  const isLoadText = meta.type === 'load';
  const ext = isLoadText ? '.txt' : IMAGE_TYPES[String(contentType || '').split(';')[0].trim().toLowerCase()] || spreadsheetExtension(meta.fileName);
  if (!ext) throw new Error(`Not a picture or spreadsheet (${meta.fileName || contentType || 'no type'})`);
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12);
  const name = `chat-${now}-${hash}${ext}`;
  fs.writeFileSync(path.join(INBOX_DIR, name), bytes);
  writeJson(path.join(INBOX_DIR, `${name}.json`), {
    chat: String(meta.chat || ''), kind: CHAT_KINDS.has(meta.kind) ? meta.kind : 'para',
    type: isLoadText ? 'load' : SHEET_TYPES[ext] ? 'spreadsheet' : 'picture', fileName: String(meta.fileName || ''), label: String(meta.label || ''),
    sender: String(meta.sender || ''), postedAt: String(meta.postedAt || ''), key: String(meta.key || ''), savedAt: now
  });
  return name;
}

// Pictures waiting for the TMS, oldest first: [{ name, sender, postedAt, savedAt }].
function listInbox() {
  let names = [];
  try { names = fs.readdirSync(INBOX_DIR); } catch { return []; }
  return names.filter(name => INBOX_NAME.test(name)).sort()
    .map(name => ({ name, ...readJson(path.join(INBOX_DIR, `${name}.json`), {}) }));
}

function inboxFilePath(name) {
  if (!INBOX_NAME.test(String(name || ''))) throw new Error('Unknown inbox picture');
  return path.join(INBOX_DIR, name);
}

function contentTypeOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return SHEET_TYPES[ext] || Object.keys(IMAGE_TYPES).find(type => IMAGE_TYPES[type] === ext) || 'application/octet-stream';
}

// The TMS imported (or Daniel cancelled) a picture: move it out of the inbox.
function markInboxDone(name) {
  const file = inboxFilePath(name);
  if (!fs.existsSync(file)) return false;
  fs.mkdirSync(DONE_DIR, { recursive: true });
  fs.renameSync(file, path.join(DONE_DIR, name));
  const meta = `${file}.json`;
  if (fs.existsSync(meta)) fs.renameSync(meta, path.join(DONE_DIR, `${name}.json`));
  return true;
}

module.exports = {
  INBOX_DIR, CONFIG_FILE, STATUS_FILE, readChatConfig, writeChatStatus, readChatStatus,
  readSeen, writeSeen, addToInbox, listInbox, inboxFilePath, contentTypeOf, markInboxDone, spreadsheetExtension
};
