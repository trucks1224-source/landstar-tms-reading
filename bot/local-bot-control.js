const fs = require('fs');
const path = require('path');

const CONTROL_FILE = process.env.LOCAL_BOT_CONTROL_FILE || path.join(__dirname, 'local-bot-control.json');

function readBotControl() {
  try {
    const data = JSON.parse(fs.readFileSync(CONTROL_FILE, 'utf8'));
    if (typeof data.enabled !== 'boolean') throw new Error('Invalid local bot control');
    return data.enabled;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

function writeBotControl(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Bot control must be on or off');
  const temp = `${CONTROL_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ enabled }));
  fs.renameSync(temp, CONTROL_FILE);
}

module.exports = { readBotControl, writeBotControl };
