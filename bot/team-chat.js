// Teammates' bots (launcher sets TEAM_AUTO_UPDATE=1) run the Google Chat bot next to the upload
// bot (Daniel 2026-11-27: teammates' own lists should import by themselves too). The teammate
// turns it on and lists the chats to watch in the TMS (My Settings -> Google Chat lists, saved to
// bot/chat-bot-config.json through the status server); this keeps chat-bot.js running while it is
// on and starts it again a minute after it stops. Daniel's own chat bot is run by watchdog.js.
const { spawn } = require('child_process');
const path = require('path');
const { readChatConfig } = require('./chat-inbox');

const RESTART_AFTER_MS = 60 * 1000;
let child = null;
let nextStartAt = 0;

function keepTeamChatBot(now = Date.now()) {
  if (child || now < nextStartAt) return false;
  if (!readChatConfig().enabled) return false;
  child = spawn(process.execPath, [path.join(__dirname, 'chat-bot.js')], { cwd: __dirname, stdio: 'ignore' });
  child.on('exit', () => {
    child = null;
    nextStartAt = Date.now() + RESTART_AFTER_MS;
  });
  child.on('error', () => {
    child = null;
    nextStartAt = Date.now() + RESTART_AFTER_MS;
  });
  return true;
}

function stopTeamChatBot() {
  if (!child) return;
  try { child.kill(); } catch { /* already gone */ }
  child = null;
}

process.on('exit', stopTeamChatBot);

// A teammate's chat list from the TMS -> the config file's shape. Every chat is kind "team":
// pictures and spreadsheets, each list's account asked once in the TMS and then remembered.
function teamChatConfig(input) {
  const chats = (Array.isArray(input?.chats) ? input.chats : []).slice(0, 10).map((chat, index) => ({
    name: String(chat?.name || '').trim().slice(0, 60) || `Chat ${index + 1}`,
    url: String(chat?.url || '').trim().slice(0, 300),
    kind: 'team'
  })).filter(chat => /^https:\/\/(chat|mail)\.google\.com\//.test(chat.url));
  return { enabled: input?.enabled === true && chats.length > 0, chats };
}

module.exports = { keepTeamChatBot, stopTeamChatBot, teamChatConfig };
