const test = require('node:test');
const assert = require('node:assert/strict');
const { teamChatConfig } = require('./team-chat');

test("a teammate's chat list becomes team chats; bad addresses are dropped", () => {
  const config = teamChatConfig({
    enabled: true,
    chats: [
      { name: 'My lists', url: 'https://mail.google.com/mail/u/0/#chat/space/AAAA' },
      { name: '', url: 'https://chat.google.com/room/BBBB' },
      { name: 'Bad', url: 'https://example.com/x' }
    ]
  });
  assert.deepEqual(config, {
    enabled: true,
    chats: [
      { name: 'My lists', url: 'https://mail.google.com/mail/u/0/#chat/space/AAAA', kind: 'team' },
      { name: 'Chat 2', url: 'https://chat.google.com/room/BBBB', kind: 'team' }
    ]
  });
  assert.equal(teamChatConfig({ enabled: true, chats: [] }).enabled, false, 'nothing to watch: off');
  assert.equal(teamChatConfig({ chats: [{ url: 'https://chat.google.com/room/C' }] }).enabled, false, 'off unless turned on');
});
