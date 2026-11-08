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

test('paperwork files: PDFs and real photos from the driver, not signature logos', async () => {
  const { findPaperworkParts } = await import('./_lib/gmailThread.js');
  const payload = { parts: [
    { mimeType: 'text/plain', body: { size: 300 } },
    { filename: 'POD 4590295.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a1', size: 9000 } },
    { filename: 'IMG_2041.jpg', mimeType: 'image/jpeg', body: { attachmentId: 'a2', size: 1800000 } },
    { filename: 'logo.png', mimeType: 'image/png', body: { attachmentId: 'a3', size: 4200 } },
    { mimeType: 'multipart/alternative', parts: [{ filename: 'scan.HEIC', mimeType: 'image/heic', body: { attachmentId: 'a4', size: 900000 } }] },
    { filename: 'notes.docx', body: { attachmentId: 'a5', size: 50000 } }
  ] };
  assert.deepEqual(findPaperworkParts(payload).map(part => part.filename), ['POD 4590295.pdf', 'IMG_2041.jpg', 'scan.HEIC']);
});

test('paperwork email: reply-all text plus the files attached', async () => {
  const { buildReplyWithAttachments } = await import('./_lib/gmailThread.js');
  const raw = buildReplyWithAttachments({
    to: ['Heather <heather@paramount.com>'], cc: ['ops@paramount.com'], subject: 'Rate Confirmation for order: 2282980',
    inReplyTo: '<m1@x>', references: '<m0@x>', text: 'Attached is the POD.',
    files: [{ filename: 'POD.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') }]
  });
  assert.match(raw, /^To: Heather <heather@paramount.com>\r\nCc: ops@paramount.com\r\n/);
  assert.match(raw, /In-Reply-To: <m1@x>\r\nReferences: <m0@x> <m1@x>/);
  const boundary = raw.match(/boundary="([^"]+)"/)[1];
  assert.equal(raw.split(`--${boundary}`).length, 4, 'text part, one file, closing marker');
  assert.match(raw, /Content-Disposition: attachment; filename="=\?UTF-8\?B\?/);
  assert.ok(raw.includes(Buffer.from('Attached is the POD.').toString('base64')));
  assert.ok(raw.includes(Buffer.from('%PDF-1.4 test').toString('base64')));
  assert.ok(raw.trimEnd().endsWith(`--${boundary}--`));
});

test('driver emails go to the newest BCO email that has a driver on it', async () => {
  const { pickDriverThread } = await import('./_lib/gmailThread.js');
  const withDriver = { id: 'old', messages: [msg('a', 1000, { From: 'daniel.gomez@landstarmail.com', To: 'daniel.gomez@landstarmail.com, randycotton84@gmail.com', Subject: 'BCO Load Detail for load: - 4492905' })] };
  const toMeOnly = { id: 'new', messages: [msg('b', 2000, { From: 'daniel.gomez@landstarmail.com', To: 'daniel.gomez@landstarmail.com', Subject: 'BCO Load Detail for load: - 4492905' })] };
  assert.equal(pickDriverThread([toMeOnly, withDriver], me).id, 'old');
  const reassigned = { id: 'newer', messages: [msg('c', 3000, { From: 'daniel.gomez@landstarmail.com', To: 'daniel.gomez@landstarmail.com, other.driver@yahoo.com', Subject: 'BCO Load Detail for load: - 4492905' })] };
  assert.equal(pickDriverThread([withDriver, toMeOnly, reassigned], me).id, 'newer', 'a reassigned driver still wins');
  assert.equal(pickDriverThread([toMeOnly], me).id, 'new', 'no driver anywhere: the newest, as before');
});

test('a driver who forwards the BCO email (instead of replying) still counts as a driver reply', () => {
  const forwarded = [msg('f1', 5000, { From: 'Daniel Taylor <taylordaniel906@gmail.com>', To: 'daniel.gomez@landstarmail.com', Subject: 'Fwd: BCO Load Detail for load: - 4492905' })];
  assert.equal(parseBcoSubject('Fwd: BCO Load Detail for load: - 4492905'), '4492905');
  assert.deepEqual(findDriverReplies(forwarded, me, 0).map(reply => reply.id), ['f1']);
  const dispatch = [msg('d1', 1000, { From: 'daniel.gomez@landstarmail.com', To: 'randycotton84@gmail.com', Subject: 'BCO Load Detail for load: - 4492905' })];
  assert.deepEqual(findDriverReplies(dispatch, me, 0), [], 'your own dispatch email is never a driver reply');
});

test('big paperwork emails go through the upload endpoint inside the customer thread', async () => {
  const { buildUploadBody } = await import('./_lib/gmailThread.js');
  const { body, contentType } = buildUploadBody('To: a@b.com\r\n\r\nhi', '18abc', 'B1');
  assert.equal(contentType, 'multipart/related; boundary=B1');
  assert.equal(body, '--B1\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"threadId":"18abc"}\r\n--B1\r\nContent-Type: message/rfc822\r\n\r\nTo: a@b.com\r\n\r\nhi\r\n--B1--\r\n');
});

test('every reply on an RXO update request copies Ivan Lopez, once', async () => {
  const { withRxoAlwaysCc } = await import('./_lib/gmailThread.js');
  assert.deepEqual(withRxoAlwaysCc({ to: ['chatracking2@rxo.com'], cc: ['dashawn@rxo.com'] }),
    { to: ['chatracking2@rxo.com'], cc: ['dashawn@rxo.com', 'ivan.lopez@landstarmail.com'] });
  assert.deepEqual(withRxoAlwaysCc({ to: ['chatracking2@rxo.com'], cc: ['Ivan Lopez <Ivan.Lopez@landstarmail.com>'] }).cc,
    ['Ivan Lopez <Ivan.Lopez@landstarmail.com>'], 'already on it: not added twice');
  const thread = { id: 't1', messages: [
    msg('r1', 1000, { From: 'chatracking2 <chatracking2@rxo.com>', To: me, Cc: 'dashawn@rxo.com', Subject: 'Update Request - Order # 24474085 Coeymans, NY → Pittston, PA' })
  ] };
  const [request] = findOpenRxoRequests([thread], me);
  assert.ok(request.cc.includes('ivan.lopez@landstarmail.com'), 'shown on the draft too');
});
