import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDriverRecipients, buildReplyAll, buildReplyMessage, findDriverReplies, findNewReplies, findOpenRxoRequests, parseBcoSubject, isRateConfirmationSubject, parseRxoRequestSubject, splitAddresses } from './_lib/gmailThread.js';

const msg = (id, internalDate, headers) => ({
  id, internalDate: String(internalDate), snippet: `text ${id}`,
  payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) }
});
const me = 'trucks1224@gmail.com';

test('only the rate confirmation thread for that exact order', () => {
  const subject = 'Paramount Transportation Logistics Svcs Rate Confirmation for order: 2283600';
  assert.equal(isRateConfirmationSubject(subject, '2283600'), true);
  assert.equal(isRateConfirmationSubject(subject, '228360'), false);
  assert.equal(isRateConfirmationSubject('Rate Confirmation for order: 2283600', '2283600'), false, 'must be Paramount');
});

test('reply all goes to Paramount and everyone copied, never to me', () => {
  const rateCon = msg('a', 1, {
    From: 'Heather Locke <heather.locke@rlglobal.com>',
    To: `Daniel <${me}>`, Cc: 'afterhoursatrltruckload@rlglobal.com, "Ops, Team" <ops@rlglobal.com>'
  });
  assert.deepEqual(buildReplyAll([rateCon], me), {
    to: ['Heather Locke <heather.locke@rlglobal.com>'],
    cc: ['afterhoursatrltruckload@rlglobal.com', '"Ops, Team" <ops@rlglobal.com>']
  });
  const mine = msg('b', 2, { From: me, To: 'heather.locke@rlglobal.com', Cc: 'afterhoursatrltruckload@rlglobal.com' });
  const both = buildReplyAll([rateCon, mine], me);
  assert.deepEqual(both.to, ['Heather Locke <heather.locke@rlglobal.com>']);
  assert.ok(both.cc.includes('afterhoursatrltruckload@rlglobal.com'));
  assert.ok(![...both.to, ...both.cc].some(address => address.includes(me)));
  assert.deepEqual(splitAddresses('"Locke, Heather" <h@x.com>, y@z.com'), ['"Locke, Heather" <h@x.com>', 'y@z.com']);
});

test('replies from others after a time are reported; mine are not', () => {
  const list = [msg('b', 2000, { From: me }), msg('c', 3000, { From: 'Heather <heather.locke@rlglobal.com>' }), msg('d', 1000, { From: 'x@rlglobal.com' })];
  assert.deepEqual(findNewReplies(list, me, 1500).map(reply => reply.id), ['c']);
});

test('the reply stays in the thread and its headers cannot be injected', () => {
  const raw = buildReplyMessage({ to: ['a@b.com\r\nBcc: evil@x.com'], cc: [], subject: 'Rate Confirmation for order: 1', inReplyTo: '<m1@x>', references: '<m0@x>', text: 'Hi' });
  assert.match(raw, /In-Reply-To: <m1@x>/);
  assert.match(raw, /References: <m0@x> <m1@x>/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.doesNotMatch(raw, /\r\nBcc:/);
});

test('RXO update requests: order number from every subject style, only unanswered ones', () => {
  assert.equal(parseRxoRequestSubject('Update Request - Order # 24474092    Coeymans, NY → Pittston, PA'), '24474092');
  assert.equal(parseRxoRequestSubject('Update Request/ Order # 24442168    West Memphis, AR → Longview, TX'), '24442168');
  assert.equal(parseRxoRequestSubject('Update request Order # 24544189 Spartanburg, SC'), '24544189');
  assert.equal(parseRxoRequestSubject('Rate Confirmation for order: 2283600'), '');
  const subject = 'Update Request - Order # 24474092 Coeymans, NY → Pittston, PA';
  const rxo = { From: 'chatracking2 <chatracking2@rxo.com>', To: `${me}, Dashawn <d@landstarmail.com>`, Cc: 'RXO <ops@rxo.com>', Subject: subject };
  const open = { id: 't1', messages: [msg('m1', 1, rxo)] };
  const answered = { id: 't2', messages: [msg('m2', 1, rxo), msg('m3', 2, { From: me, Subject: `RE: ${subject}` })] };
  const byColleague = { id: 't3', messages: [msg('m4', 1, rxo), msg('m5', 2, { From: 'Ivan Lopez <ivan.lopez@landstarmail.com>' })] };
  const asksAgain = { id: 't4', messages: [msg('m6', 1, rxo), msg('m7', 2, { From: me }), msg('m8', 3, { From: rxo.From })] };
  const found = findOpenRxoRequests([open, answered, byColleague, asksAgain], me);
  assert.deepEqual(found.map(item => [item.threadId, item.messageId, item.orderNumber]), [['t1', 'm1', '24474092'], ['t4', 'm8', '24474092']]);
  assert.deepEqual(found[0].to, ['chatracking2 <chatracking2@rxo.com>']);
  assert.ok(found[0].cc.includes('Dashawn <d@landstarmail.com>') && found[0].cc.includes('RXO <ops@rxo.com>'));
});

test('driver emails go to the driver from the BCO Load Detail email, with Landstar copied', () => {
  assert.equal(parseBcoSubject('BCO Load Detail for load: - 4574648'), '4574648');
  assert.equal(parseBcoSubject('BCO Load Detail for - 4268116'), '4268116');
  assert.equal(parseBcoSubject('Rate Confirmation for order: 2283600'), '');
  const dispatch = msg('a', 1, { From: 'daniel.gomez@landstarmail.com', To: 'daniel.gomez@landstarmail.com, rocwayxpress@hotmail.com', Subject: 'BCO Load Detail for load: - 4574648' });
  assert.deepEqual(buildDriverRecipients(dispatch, me), { to: ['rocwayxpress@hotmail.com'], cc: ['daniel.gomez@landstarmail.com'] });
  const replies = findDriverReplies([
    msg('b', 2000, { From: me }),
    msg('c', 3000, { From: 'Rocway <rocwayxpress@hotmail.com>' }),
    msg('d', 4000, { From: 'daniel.gomez@landstarmail.com' })
  ], me, 1000);
  assert.deepEqual(replies.map(reply => reply.id), ['c'], 'only the driver, not Daniel from either address');
});
