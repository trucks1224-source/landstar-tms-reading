import test from 'node:test';
import assert from 'node:assert/strict';
import { lastExportTime, buildTeamStatusRow, describeTeamStatus } from './teamStatus.js';

test('the last export is the newest exported load', () => {
  assert.equal(lastExportTime({
    A: [{ landstarExportedAt: '2026-11-27T20:00:00.000Z' }, {}],
    B: [{ landstarExportedAt: '2026-11-27T21:30:00.000Z' }]
  }), '2026-11-27T21:30:00.000Z');
  assert.equal(lastExportTime({}), '');
});

test("a teammate's row", () => {
  const row = buildTeamStatusRow({ userId: 'u1', name: 'Ivan', postingCode: 'snb', bot: { state: 'logged-in', message: 'Watching' }, chat: null, lastExportAt: '' });
  assert.equal(row.posting_code, 'SNB');
  assert.equal(row.bot_state, 'logged-in');
  assert.equal(row.chat_state, 'off');
  assert.equal(row.last_export_at, null);
});

test('the panel shows a closed TMS, a stopped bot and a running one', () => {
  const now = Date.parse('2026-11-27T22:00:00.000Z');
  const fresh = '2026-11-27T21:59:00.000Z';
  assert.equal(describeTeamStatus({ updated_at: '2026-11-27T20:00:00.000Z' }, now).tms.level, 'down');
  assert.match(describeTeamStatus({ updated_at: '2026-11-27T20:00:00.000Z' }, now).tms.text, /2 h ago/);
  const stopped = describeTeamStatus({ updated_at: fresh, bot_state: 'off', bot_message: 'Upload bot is not running' }, now);
  assert.equal(stopped.bot.level, 'down');
  const running = describeTeamStatus({ updated_at: fresh, bot_state: 'logged-in', chat_state: 'running', chat_message: 'Watching My lists' }, now);
  assert.equal(running.bot.level, 'ok');
  assert.equal(running.chat.level, 'ok');
});
