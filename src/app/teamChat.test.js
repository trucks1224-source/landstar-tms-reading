import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatLines } from './teamChat.js';

test('chat lines: "name | address" or just the address', () => {
  assert.deepEqual(parseChatLines('My lists | https://mail.google.com/mail/u/0/#chat/space/AAAA\n\nhttps://chat.google.com/room/BBBB\nBroken line'), [
    { name: 'My lists', url: 'https://mail.google.com/mail/u/0/#chat/space/AAAA' },
    { name: 'Chat 2', url: 'https://chat.google.com/room/BBBB' },
    { name: 'Broken line', url: '' }
  ]);
});
