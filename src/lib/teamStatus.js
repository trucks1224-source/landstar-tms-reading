// Team status panel (Daniel 2026-11-27: see at a glance if a teammate's side broke, without them
// having to tell him). Each teammate's TMS writes its row to the team_status table
// (supabase/team-status.sql) every TEAM_STATUS_EVERY_MS; Daniel's TMS shows them all
// (src/app/TeamStatusPanel.jsx). Tested in teamStatus.test.js.

export const TEAM_STATUS_EVERY_MS = 2 * 60 * 1000;
// A row older than this means the teammate's TMS is closed (or their computer is off).
export const TEAM_STATUS_STALE_MS = 6 * 60 * 1000;

// The newest landstarExportedAt among all loads, as an ISO time ('' when none).
export function lastExportTime(customerOrdersMap) {
  let newest = 0;
  Object.values(customerOrdersMap || {}).forEach(loads => (loads || []).forEach(load => {
    const at = Date.parse(load?.landstarExportedAt || '') || 0;
    if (at > newest) newest = at;
  }));
  return newest ? new Date(newest).toISOString() : '';
}

export function buildTeamStatusRow({ userId, name, postingCode, bot, chat, lastExportAt }) {
  return {
    user_id: userId,
    name: String(name || '').slice(0, 80),
    posting_code: String(postingCode || '').trim().toUpperCase().slice(0, 10),
    bot_state: String(bot?.state || 'off'),
    bot_message: String(bot?.message || 'Upload bot is not running').slice(0, 160),
    chat_state: String(chat?.state || 'off'),
    chat_message: String(chat?.message || '').slice(0, 160),
    last_export_at: lastExportAt || null,
    updated_at: new Date().toISOString()
  };
}

// One row for the panel: { level: 'ok' | 'warn' | 'down', text } for the upload bot, the chat
// bot and the TMS itself.
export function describeTeamStatus(row, now = Date.now()) {
  const seenAt = Date.parse(row?.updated_at || '') || 0;
  if (!seenAt || now - seenAt > TEAM_STATUS_STALE_MS) {
    return { tms: { level: 'down', text: seenAt ? `TMS closed (last seen ${ago(now - seenAt)})` : 'Never opened the TMS' }, bot: null, chat: null };
  }
  const botOk = /^(logged-in|uploading|working|starting)$/.test(row.bot_state);
  const chatOn = row.chat_state && row.chat_state !== 'off';
  return {
    tms: { level: 'ok', text: 'TMS open' },
    bot: { level: botOk ? 'ok' : 'down', text: botOk ? 'Upload bot running' : (row.bot_message || 'Upload bot is not running') },
    chat: chatOn ? { level: row.chat_state === 'running' ? 'ok' : 'warn', text: row.chat_message || 'Chat bot' } : null
  };
}

export function ago(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
