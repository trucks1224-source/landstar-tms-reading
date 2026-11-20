// Copies everything a bot prints (console.log / warn / error) into bot/logs/<name>-<date>.log, so
// what happened can be read later even after the bot's window is closed. Load it first:
//   require('./file-log')('upload');
const fs = require('fs');
const path = require('path');
const util = require('util');

const LOG_DIR = path.join(__dirname, 'logs');
const KEEP_DAYS = 14;

module.exports = function startFileLog(name) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // Old logs are removed so the folder doesn't grow forever.
    for (const file of fs.readdirSync(LOG_DIR)) {
      const full = path.join(LOG_DIR, file);
      if (Date.now() - fs.statSync(full).mtimeMs > KEEP_DAYS * 86400000) fs.unlinkSync(full);
    }
  } catch { /* logging is best effort */ }
  const stamp = () => new Date().toLocaleTimeString('en-US', { hour12: false });
  const file = () => {
    const day = new Date();
    const pad = value => String(value).padStart(2, '0');
    return path.join(LOG_DIR, `${name}-${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}.log`);
  };
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      try {
        // Colors are for the window only.
        const text = util.format(...args).replace(/\x1b\[[0-9;]*m/g, '');
        fs.appendFileSync(file(), `[${stamp()}]${level === 'log' ? '' : ` ${level.toUpperCase()}`} ${text}\n`);
      } catch { /* never let logging stop a bot */ }
    };
  }
  process.on('uncaughtException', error => { console.error('Crashed:', error?.stack || error); process.exit(1); });
  // Same as Node's default (stop the bot), but the reason is written to the log first.
  process.on('unhandledRejection', error => { console.error('Crashed (unhandled error):', error?.stack || error); process.exit(1); });
  console.log(`--- ${name} started (pid ${process.pid}) ---`);
};
