import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDriverRecipients, buildReplyAll, buildReplyMessage, findDriverReplies, findDriverStatus, buildDriverStatusEmail, handleParamountEmail, findNewReplies, findOpenRxoRequests, findRxoForwardRequests, parseBcoSubject, parseTruckerToolsSubject, isRateConfirmationSubject, parseRxoRequestSubject, pickRxoPaperworkThread, splitAddresses } from './_lib/gmailThread.js';

const msg = (id, internalDate, headers) => ({
  id, internalDate: String(internalDate), snippet: `text ${id}`,
  payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) }
});
const me = 'trucks1224@gmail.com';

test('RXO updates create an order-specific Dashawn chain only when no chain exists, then reuse it', async t => {
  const env = {
    SUPABASE_URL: 'https://tms-test.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret'
  };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  let existing = null;
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/rest/v1/gmail_connection')) return Response.json({ refresh_token: 'test-refresh', email: me });
    if (path.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test-access' });
    if (path.includes('/threads?')) return Response.json({ threads: existing ? [{ id: existing.id }] : [] });
    if (path.includes('/threads/fallback?')) return Response.json(existing);
    if (path.endsWith('/messages/send')) {
      const request = JSON.parse(options.body);
      const raw = Buffer.from(request.raw, 'base64url').toString('utf8');
      assert.match(raw, /To: Dashawn.Cook@rxo.com/);
      assert.doesNotMatch(raw, /Cc:/);
      sent.push(request);
      existing = { id: 'fallback', messages: [msg('sent-fallback', Date.now(), {
        From: me, To: 'Dashawn.Cook@rxo.com',
        Subject: 'RE: RXO - Order #24639815 - Paperwork and Updates',
        'Message-ID': '<fallback@example.com>'
      })] };
      return Response.json({ id: `sent-${sent.length}`, threadId: 'fallback' });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const request = {
    action: 'checkCallSend', customer: 'R X O 2429200 - ATZ V', orderNumber: '24639815',
    checkCallAt: '2026-11-12T12:30:00Z', text: 'Driver reported a flat tire.'
  };
  assert.equal((await handleParamountEmail(request)).body.threadId, 'fallback');
  assert.equal(sent[0].threadId, undefined, 'first update creates the new conversation');
  assert.equal((await handleParamountEmail({ ...request, checkCallAt: '2026-11-12T12:31:00Z' })).status, 200);
  assert.equal(sent[1].threadId, 'fallback', 'subsequent updates use the same conversation');
  assert.equal(pickRxoPaperworkThread([existing], '246398150', me), null);
});

test('check calls reply on exact RXO chains, rate confirmation first, and retry only unsent chains', async t => {
  const env = {
    SUPABASE_URL: 'https://tms-test.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret'
  };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const at = Date.now() - 60000;
  const threads = [
    { id: 'check-update', messages: [msg('request', at, {
      From: 'tracking@rxo.com', To: me, Subject: 'Update Request - Order # 24639815'
    })] },
    { id: 'check-rate', messages: [msg('rate', at, {
      From: 'broker@rxo.com', To: me, Subject: 'RXO - Rate Confirmation - Load 24639815'
    })] },
    { id: 'check-other', messages: [msg('other', at, {
      From: 'broker@rxo.com', To: me, Subject: 'RXO - Rate Confirmation - Load 246398150'
    })] }
  ];
  const sent = [];
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/rest/v1/gmail_connection')) return Response.json({ refresh_token: 'test-refresh', email: me });
    if (path.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test-access' });
    if (path.includes('/threads?')) return Response.json({ threads: threads.map(({ id }) => ({ id })) });
    const thread = threads.find(item => path.includes(`/threads/${item.id}?`));
    if (thread) return Response.json(thread);
    if (path.endsWith('/messages/send')) {
      const request = JSON.parse(options.body);
      if (request.threadId === 'check-update' && fail) throw new Error('Temporary send failure');
      const raw = Buffer.from(request.raw, 'base64url').toString('utf8');
      assert.match(raw, /X-TMS-Check-Call:/);
      assert.ok(raw.includes(Buffer.from('Driver reported a flat tire.').toString('base64')));
      sent.push(request.threadId);
      const target = threads.find(item => item.id === request.threadId);
      target.messages.push(msg(`sent-${sent.length}`, at + 1000, {
        From: me, 'X-TMS-Check-Call': raw.match(/X-TMS-Check-Call: ([^\r\n]+)/)[1]
      }));
      return Response.json({ id: `sent-${sent.length}` });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const request = {
    action: 'checkCallSend', customer: 'R X O 2429200 - ATZ V', orderNumber: '24639815',
    checkCallAt: new Date(at).toISOString(), text: 'Driver reported a flat tire.'
  };
  await assert.rejects(handleParamountEmail(request), /Temporary send failure/);
  assert.deepEqual(sent, ['check-rate']);
  fail = false;
  assert.equal((await handleParamountEmail(request)).body.ok, true);
  assert.deepEqual(sent, ['check-rate', 'check-update']);
  assert.equal((await handleParamountEmail(request)).body.alreadySent, true);
  assert.equal(sent.length, 2);
  assert.equal((await handleParamountEmail({ ...request, checkCallAt: '' })).status, 400);
});

test('prospect sends to NTG are blocked server-side before connecting to Gmail', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Blocked prospect must not access the network'); });
  for (const request of [
    { action: 'prospectSend', to: 'ops@ntgfreight.com' },
    { action: 'prospectSend', to: 'ops@example.com', company: 'Nolan Transportation Group' },
    { action: 'prospectThreadReply', messageId: 'ntg-reply', company: 'NTG' }
  ]) {
    const result = await handleParamountEmail({ ...request, text: 'Hello' });
    assert.equal(result.status, 403);
    assert.match(result.body.error, /prospect do-not-email/);
  }
});

test('excluded prospect follow-ups are blocked before connecting, including older clients', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Excluded follow-up must not access the network'); });
  for (const request of [
    { kind: 'followUp', subject: 'Custom subject' },
    { subject: 'RE: Truck capacity' }
  ]) {
    const result = await handleParamountEmail({
      action: 'prospectSend', to: 'Capacity <CAPACITY@greatwide-tx.com>', text: 'Hello', ...request
    });
    assert.equal(result.status, 403);
    assert.match(result.body.error, /follow-ups are disabled/);
  }
});

test('prospect replies validate the actual sender even when company metadata is missing', async t => {
  const env = {
    SUPABASE_URL: 'https://tms-test.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret'
  };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  t.mock.method(globalThis, 'fetch', async url => {
    const path = String(url);
    if (path.includes('/rest/v1/gmail_connection')) return Response.json({ refresh_token: 'test-refresh', email: me });
    if (path.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test-access' });
    if (path.includes('/messages/ntg-refusal?')) return Response.json(msg('ntg-refusal', Date.now(), {
      From: 'Broker <broker@ntgfreight.com>', Subject: 'Cannot work with Landstar'
    }));
    throw new Error(`Unexpected request: ${path}`);
  });
  const result = await handleParamountEmail({ action: 'prospectThreadReply', messageId: 'ntg-refusal', text: 'Sorry to hear that' });
  assert.equal(result.status, 403);
});

test('driver confirmations distinguish loaded from departure and ignore quoted, uncertain or future text', () => {
  for (const [text, status] of [
    ['I am at the shipper', 'arrived'], ['They loaded me', 'loaded'],
    ["I'm loaded.", 'loaded'], ['I left the shipper', 'departed'], ['Delivered', 'delivered'],
    ['Hello,\nThey loaded me.\nThank you\nTri', 'loaded'],
    ['Thanks On Wed, Nov 11, Daniel wrote: They loaded me', ''],
    ['Thanks\n> I am loaded', ''], ['Not loaded yet', ''],
    ['Are you loaded?', ''], ['They will load me', ''], ["I'm being loaded", ''],
    ['They loaded me?', ''], ["I'm empty", ''], ['Received, thanks', '']
  ]) assert.equal(findDriverStatus(text), status, text);
  const body = buildDriverStatusEmail('2283493', 'loaded', '2026-11-11T18:55:00.000Z');
  assert.match(body, /2283493/);
  assert.match(body, /loading is complete/);
  assert.match(body, /Departure has not been confirmed/);
  assert.doesNotMatch(body, /ETA|left the shipper/);
});

test('driver status comes from the full authored body, not a quoted Gmail snippet', () => {
  const message = msg('driver', Date.now(), { From: 'driver@example.com' });
  message.snippet = 'They loaded me';
  message.payload.mimeType = 'text/plain';
  message.payload.body = { data: Buffer.from('Thank you\nOn Wed, Daniel wrote: They loaded me').toString('base64url') };
  assert.equal(findDriverReplies([message], me)[0].status, '');
  message.payload.body.data = Buffer.from('They loaded me').toString('base64url');
  assert.equal(findDriverReplies([message], me)[0].status, 'loaded');
  message.payload.mimeType = 'text/html';
  for (const html of [
    '<div>Thanks</div><blockquote><div>They loaded me</div></blockquote>',
    '<div>Thanks</div><div class="gmail_quote"><div>They loaded me</div></div>'
  ]) {
    message.payload.body.data = Buffer.from(html).toString('base64url');
    assert.equal(findDriverReplies([message], me)[0].status, '', 'HTML quotes are not driver confirmations');
  }
});

test('status updates validate the driver source, reply-all and do not resend a Gmail-marked report', async t => {
  const env = {
    SUPABASE_URL: 'https://tms-test.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret'
  };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const at = Date.now() - 60000;
  const driver = msg('driver-report', at, { From: 'driver@example.com', Subject: 'Re: BCO Load Detail for load: - 4706205' });
  driver.payload.mimeType = 'text/plain';
  driver.payload.body = { data: Buffer.from('They loaded me').toString('base64url') };
  const customer = msg('customer', at - 60000, {
    From: 'Heather <heather@rlglobal.com>', To: me, Cc: 'afterhours@rlglobal.com',
    Subject: 'Paramount Rate Confirmation for order: 2283493', 'Message-ID': '<customer@rlglobal.com>'
  });
  const thread = { id: 'customer-thread', messages: [customer] };
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/rest/v1/gmail_connection')) return Response.json({ refresh_token: 'test-refresh', email: me });
    if (path.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test-access' });
    if (path.includes('/messages/driver-report?')) return Response.json(driver);
    if (path.includes('/threads?')) return Response.json({ threads: [{ id: thread.id }] });
    if (path.includes('/threads/customer-thread?')) return Response.json(thread);
    if (path.endsWith('/messages/send')) {
      sends++;
      const request = JSON.parse(options.body);
      assert.equal(request.threadId, thread.id);
      const raw = Buffer.from(request.raw, 'base64url').toString('utf8');
      assert.match(raw, /X-TMS-Driver-Update: Para\|2283493\|driver-report/);
      assert.match(raw, /Cc: afterhours@rlglobal.com/);
      const sent = msg('sent', at + 1000, { From: me, 'X-TMS-Driver-Update': 'Para|2283493|driver-report' });
      thread.messages.push(sent);
      return Response.json({ id: 'sent' });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const request = {
    action: 'driverStatusSend', customer: 'Para', orderNumber: '2283493',
    freightBill: '4706205', messageId: 'driver-report', since: new Date(at - 3600000).toISOString()
  };
  assert.equal((await handleParamountEmail(request)).body.ok, true);
  assert.equal((await handleParamountEmail(request)).body.alreadySent, true);
  assert.equal(sends, 1);
  assert.equal((await handleParamountEmail({ ...request, freightBill: '4706206' })).status, 409);
  assert.equal(sends, 1);
  await t.test('Gmail quota errors pause outgoing API checks until cooldown expires', async t => {
    const isolated = await import('./_lib/gmailThread.js?quota-test');
    let gmailRequests = 0;
    let limited = true;
    const clock = Date.now();
    t.mock.method(Date, 'now', () => clock);
    t.mock.method(globalThis, 'fetch', async url => {
      const path = String(url);
      if (path.includes('/rest/v1/gmail_connection')) return Response.json({ refresh_token: 'test-refresh', email: me });
      if (path.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test-access' });
      gmailRequests++;
      if (limited) return Response.json({ error: { message: 'Quota exceeded for Total Query Cost' } }, {
        status: 429, headers: { 'Retry-After': '120' }
      });
      if (path.includes('/threads?')) return Response.json({ threads: [] });
      throw new Error(`Unexpected request: ${path}`);
    });
    const lookup = { action: 'thread', orderNumber: '2283493' };
    await assert.rejects(isolated.handleParamountEmail(lookup), /Quota exceeded/);
    await assert.rejects(isolated.handleParamountEmail(lookup), /paused briefly/);
    assert.equal(gmailRequests, 1);
    t.mock.method(Date, 'now', () => clock + 61000);
    await assert.rejects(isolated.handleParamountEmail(lookup), /paused briefly/);
    assert.equal(gmailRequests, 1, 'honor Retry-After beyond the default minute');
    limited = false;
    t.mock.method(Date, 'now', () => clock + 121000);
    assert.equal((await isolated.handleParamountEmail(lookup)).status, 404);
    assert.equal(gmailRequests, 2, 'resume requests after cooldown');
  });
});

test('generic daily updates require exact-order and customer identity in the existing chain', async () => {
  const { matchesDailyCustomerThread } = await import('./_lib/gmailThread.js');
  const thread = { messages: [msg('a', 1, {
    From: 'ops@nolan.com', Subject: 'Nolan Load #123456 confirmation'
  })] };
  assert.equal(matchesDailyCustomerThread(thread, '123456', 'Nolan 965974 - ATZ H'), true);
  assert.equal(matchesDailyCustomerThread(thread, '12345', 'Nolan 965974 - ATZ H'), false);
  assert.equal(matchesDailyCustomerThread(thread, '123456', 'Other Customer'), false);
  const bco = { messages: [msg('b', 1, {
    From: 'nolan@landstarmail.com', Subject: 'BCO Load Detail for load: 123456'
  })] };
  assert.equal(matchesDailyCustomerThread(bco, '123456', 'Nolan'), false);
});

test('Ivan request copies do not answer RXO or change customer reply-all recipients', () => {
  const now = Date.now();
  const original = msg('request', now - 10000, {
    From: 'tracking@rxo.com', To: me, Cc: 'ops@rxo.com',
    Subject: 'Update Request - Order # 24596349'
  });
  const forwarded = msg('copy', now - 5000, {
    From: me, To: 'ivan.lopez@landstarmail.com',
    Subject: 'Re: Update Request - Order # 24596349', 'X-TMS-RXO-Forward': 'request'
  });
  const thread = { id: 'rxo-thread', messages: [original, forwarded] };
  assert.equal(findOpenRxoRequests([thread], me)[0].messageId, 'request');
  assert.deepEqual(buildReplyAll(thread.messages, me), { to: ['tracking@rxo.com'], cc: ['ops@rxo.com'] });
  assert.deepEqual(findRxoForwardRequests([thread], me, now), []);
  assert.equal(findRxoForwardRequests([{ ...thread, messages: [original] }], me, now)[0].messageId, 'request');
  const answered = msg('answer', now - 1000, { From: me, To: 'tracking@rxo.com' });
  const answeredThread = { ...thread, messages: [original, answered] };
  assert.equal(findOpenRxoRequests([answeredThread], me).length, 0);
  assert.equal(findRxoForwardRequests([answeredThread], me, now)[0].messageId, 'request',
    'a request can be copied to Ivan even if someone already answered RXO');
  assert.equal(findRxoForwardRequests([{ ...thread, messages: [
    { ...original, internalDate: String(now - 4 * 86400000) }
  ] }], me, now).length, 0);
});

test('RXO replies copy Ivan only for SNB and separate forwarding is disabled', async t => {
  const env = {
    SUPABASE_URL: 'https://tms-test.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret'
  };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const api = await import('./_lib/gmailThread.js?rxo-forward-test');
  const original = msg('incoming', Date.now() - 60000, {
    From: 'tracking@rxo.com', To: me, Cc: 'ops@rxo.com',
    Subject: 'Update Request - Order # 24596349', 'Message-ID': '<incoming@rxo.com>'
  });
  original.payload.mimeType = 'text/plain';
  original.payload.body = { data: Buffer.from('Please confirm current location and ETA.').toString('base64url') };
  const thread = { id: 'abc123456', messages: [original] };
  let sends = 0;
  let replyCode = null;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/rest/v1/gmail_connection')) return Response.json({ refresh_token: 'test-refresh', email: me });
    if (path.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test-access' });
    if (path.includes('/threads/abc123456?')) return Response.json(thread);
    if (path.endsWith('/messages/send')) {
      sends++;
      const request = JSON.parse(options.body);
      assert.equal(request.threadId, thread.id);
      const raw = Buffer.from(request.raw, 'base64url').toString('utf8');
      if (replyCode !== null) {
        assert.match(raw, /To: tracking@rxo.com\r\n/);
        assert.match(raw, /ops@rxo.com/);
        assert.equal(raw.includes('ivan.lopez@landstarmail.com'), replyCode === 'SNB',
          'actual outgoing reply enforces the posting code even when Ivan was already in the thread');
        return Response.json({ id: `reply-${sends}` });
      }
      assert.match(raw, /To: ivan.lopez@landstarmail.com\r\n/);
      assert.doesNotMatch(raw, /\r\nCc:/);
      assert.match(raw, /X-TMS-RXO-Forward: incoming/);
      const body = Buffer.from(raw.split('\r\n\r\n')[1], 'base64').toString();
      assert.match(body, /Please confirm current location and ETA/);
      thread.messages.push(msg('sent-copy', Date.now(), {
        From: me, To: 'ivan.lopez@landstarmail.com', 'X-TMS-RXO-Forward': 'incoming'
      }));
      return Response.json({ id: 'sent-copy' });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const request = { action: 'rxoForward', threadId: thread.id, messageId: original.id, postingCode: 'SNB' };
  for (const postingCode of ['ANQ', '', undefined]) {
    const blocked = await api.handleParamountEmail({ ...request, postingCode });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /Separate forwards.*disabled/);
  }
  assert.equal(sends, 0, 'non-SNB and unknown loads never forward');
  assert.equal((await api.handleParamountEmail(request)).status, 409);
  assert.equal(sends, 0);
  assert.equal(findOpenRxoRequests([thread], me)[0].messageId, original.id);
  assert.equal((await api.handleParamountEmail({ ...request, messageId: 'not-in-thread' })).status, 409);
  original.payload.headers.find(item => item.name === 'Cc').value = 'ops@rxo.com, ivan.lopez@landstarmail.com';
  for (const postingCode of ['ANQ', '', 'SNB']) {
    replyCode = postingCode;
    const sent = await api.handleParamountEmail({
      action: 'rxoSend', threadId: thread.id, text: 'Confirmed driver report.', postingCode
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.cc.includes('ivan.lopez@landstarmail.com'), postingCode === 'SNB');
  }
});

test('paperwork uses an existing exact-order RXO conversation, preferring update requests', () => {
  const rate = { id: 'rate', messages: [msg('r', 3000, {
    From: 'Dashawn.Cook@rxo.com', To: me,
    Subject: 'RXO - Rate Confirmation - Load 24543958 - Spartanburg, SC to Bennettsville, SC'
  })] };
  const update = { id: 'update', messages: [msg('u', 1000, {
    From: 'chatracking2@rxo.com', To: me, Cc: 'ops@rxo.com',
    Subject: 'Update Request // Order # 24543958 Spartanburg, SC to Bennettsville, SC'
  })] };
  assert.equal(pickRxoPaperworkThread([rate], '24543958', me).id, 'rate', 'human rate confirmation is a valid fallback');
  assert.equal(pickRxoPaperworkThread([rate, update], '24543958', me).id, 'update');
  assert.equal(pickRxoPaperworkThread([rate, update], '24466147', me), null, 'different screenshot orders never share paperwork');
  assert.equal(pickRxoPaperworkThread([rate], '2454395', me), null, 'no partial order matches');
  const automated = { id: 'auto', messages: [msg('a', 5000, {
    From: 'donotreply@rxo.com', To: me, Subject: 'RXO - Rate Confirmation - Load 24543958'
  })] };
  assert.equal(pickRxoPaperworkThread([automated], '24543958', me), null, 'do not send PODs to unattended mailboxes');
  assert.equal(pickRxoPaperworkThread([automated, rate], '24543958', me).id, 'rate');
  const other = { id: 'other', messages: [msg('o', 6000, {
    From: 'person@example.com', To: me, Subject: 'Order #24543958'
  })] };
  assert.equal(pickRxoPaperworkThread([other], '24543958', me), null, 'must be an RXO conversation');
});

test('only the rate confirmation thread for that exact order', () => {
  const subject = 'Paramount Transportation Logistics Svcs Rate Confirmation for order: 2283600';
  assert.equal(isRateConfirmationSubject(subject, '2283600'), true);
  assert.equal(isRateConfirmationSubject(subject, '228360'), false);
  assert.equal(isRateConfirmationSubject('Rate Confirmation for order: 2283600', '2283600'), false, 'must be Paramount');
});

test('RXO updates prefer update requests and fall back only to the same load rate confirmation', () => {
  const rate = { id: 'rate', messages: [msg('r', 3000, {
    From: 'Dashawn.Cook@rxo.com', To: me, Cc: 'pete@rxo.com',
    Subject: 'RXO - Rate Confirmation - Load 24515484 - San Antonio, TX 78218 to Ocala, FL 34475'
  })] };
  const request = { id: 'request', messages: [msg('u', 1000, {
    From: 'chatracking2@rxo.com', To: me,
    Subject: 'Update Request // Order # 24515484 San Antonio, TX to Ocala, FL'
  })] };
  const unrelated = { id: 'other-order', messages: [msg('o', 4000, {
    From: 'chatracking2@rxo.com', To: me,
    Subject: 'Update Request // Order # 24543958 Spartanburg, SC to Bennettsville, SC'
  })] };
  const otherEmail = { id: 'other-email', messages: [msg('n', 5000, {
    From: 'ops@rxo.com', To: me, Subject: 'Order #24515484 invoice'
  })] };
  assert.equal(pickRxoPaperworkThread([rate, request], '24515484', me).id, 'request');
  assert.equal(pickRxoPaperworkThread([rate, unrelated, otherEmail], '24515484', me).id, 'rate');
  assert.equal(pickRxoPaperworkThread([unrelated, otherEmail], '24515484', me), null);
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

test('RXO Order-only subjects require an actual update request from RXO', () => {
  const subject = 'Order # 24466147    Abilene, TX → San Antonio, TX';
  assert.equal(parseRxoRequestSubject(subject), '24466147');
  assert.equal(parseRxoRequestSubject(`Re: ${subject}`), '24466147');
  assert.equal(parseRxoRequestSubject('Invoice for Order # 24466147'), '');
  const request = (id, from, text) => {
    const message = msg(id, 1000, { From: from, To: me, Subject: subject });
    message.payload.mimeType = 'text/plain';
    message.payload.body = { data: Buffer.from(text).toString('base64url') };
    return message;
  };
  const from = 'Daniel Rhodes <daniel.rhodes001@rxo.com>';
  const update = request('update', from, 'Hello valued carrier,\nPlease provide the following updates and REPLY ALL\nOUT time from shipper:');
  const invoice = request('invoice', from, 'Please send the invoice for this order.');
  const unrelated = request('other', 'other@example.com', 'Please provide the following updates');
  const quoted = request('quoted', from, 'Thanks, no update needed.\nOn Tuesday Daniel wrote:\nPlease provide the following updates');
  const threads = [update, invoice, unrelated, quoted].map(message => ({ id: message.id, messages: [message] }));
  const found = findOpenRxoRequests(threads, me);
  assert.deepEqual(found.map(item => item.orderNumber), ['24466147']);
  assert.equal(found[0].threadId, 'update');
  assert.ok(!found[0].cc.includes('ivan.lopez@landstarmail.com'), 'unknown posting code does not copy Ivan');
  assert.equal(findOpenRxoRequests([{ id: 'answered', messages: [
    update, msg('sent', 2000, { From: me, Subject: `Re: ${subject}` })
  ] }], me).length, 0);
});

test('RXO Order-only requests are recognized in HTML email bodies', () => {
  const message = msg('html', 1000, {
    From: 'ops@rxo.com', To: me, Subject: 'Order #24466147 Abilene, TX to San Antonio, TX'
  });
  message.payload.mimeType = 'text/html';
  message.payload.body = { data: Buffer.from('<p>Please provide the following updates and REPLY ALL</p><p>OUT time from shipper:</p>').toString('base64url') };
  const found = findOpenRxoRequests([{ id: 'thread', messages: [message] }], me);
  assert.equal(found.length, 1);
  assert.equal(found[0].orderNumber, '24466147');
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

test('standalone paperwork requires an exact freight bill subject', async () => {
  const { isStandalonePaperworkSubject } = await import('./_lib/gmailThread.js');
  for (const subject of ['Load# 4253383', 'Re: Load #4253383', 'Fwd: Load number: 4253383']) {
    assert.equal(isStandalonePaperworkSubject(subject, '4253383'), true);
  }
  for (const subject of ['Load# 42533830', 'Load# 425338', 'Load# 4253383 / 4253384', 'Invoice for Load# 4253383', 'BCO Load Detail for load: - 4253383']) {
    assert.equal(isStandalonePaperworkSubject(subject, '4253383'), false);
  }
});

test('standalone driver paperwork is discovered and manual forwards are not duplicated', async t => {
  const env = {
    SUPABASE_URL: 'https://tms-test.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret'
  };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const at = Date.now() - 60000;
  const bytes = Buffer.from('%PDF-1.4 POD and receipt');
  const withFile = (message, attachmentId = 'pod') => {
    message.payload.parts = [{
      filename: 'receipt.pdf', mimeType: 'application/pdf', body: { attachmentId, size: bytes.length }
    }];
    return message;
  };
  const dispatch = msg('dispatch', at - 10000, {
    From: 'dispatch@landstarmail.com', To: `${me}, driver@example.com`, Subject: 'BCO Load Detail for load: - 4253383'
  });
  const standalone = withFile(msg('standalone', at, { From: 'driver@example.com', Subject: 'Load# 4253383' }));
  const otherSender = withFile(msg('stranger', at, { From: 'stranger@example.com', Subject: 'Load# 4253383' }));
  const otherLoad = withFile(msg('other-load', at, { From: 'driver@example.com', Subject: 'Load# 42533830' }));
  const old = withFile(msg('old', at - 86400000, { From: 'driver@example.com', Subject: 'Load# 4253383' }));
  const mine = withFile(msg('mine', at, { From: me, Subject: 'Load# 4253383' }));
  const customer = msg('customer', at - 20000, {
    From: 'broker@rxo.com', To: me, Subject: 'RXO - Rate Confirmation - Load 24515484',
    'Message-ID': '<customer@rxo.com>'
  });
  const manual = withFile(msg('manual', at + 1000, { From: me, Subject: 'Re: RXO - Rate Confirmation - Load 24515484' }), 'forwarded');
  const messages = [standalone, otherSender, otherLoad, old, mine];
  for (const mode of ['not-sent', 'manual-identical', 'manual-different']) {
    await t.test(mode, async t => {
      const api = await import(`./_lib/gmailThread.js?paperwork-${mode}`);
      let sends = 0;
      t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
        const path = String(url);
        if (path.includes('/rest/v1/gmail_connection')) return Response.json({ refresh_token: 'test-refresh', email: me });
        if (path.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test-access' });
        if (path.includes('/threads?')) {
          const query = new URL(path).searchParams.get('q');
          return Response.json({ threads: [{ id: query.includes('BCO Load Detail') ? 'bco' : 'broker' }] });
        }
        if (path.includes('/threads/bco?')) return Response.json({ id: 'bco', messages: [dispatch] });
        if (path.includes('/threads/broker?')) return Response.json({
          id: 'broker', messages: mode === 'not-sent' ? [customer] : [customer, manual]
        });
        if (path.includes('/messages?')) {
          const query = new URL(path);
          if (query.searchParams.has('pageToken')) return Response.json({ messages: messages.slice(1).map(({ id }) => ({ id })) });
          assert.match(query.searchParams.get('q'), /subject:"4253383"/);
          return Response.json({ messages: [{ id: standalone.id }], nextPageToken: 'next' });
        }
        if (path.includes('/attachments/')) {
          const data = mode === 'manual-different' && path.includes('/manual/')
            ? Buffer.from('%PDF-1.4 different file') : bytes;
          return Response.json({ data: data.toString('base64url') });
        }
        if (path.includes('/messages/send?')) {
          sends++;
          assert.match(options.body, /"threadId":"broker"/);
          assert.match(options.body, /filename="receipt.pdf"|filename="=\?UTF-8\?B\?/);
          return Response.json({ id: 'sent' });
        }
        const message = messages.find(message => path.includes(`/messages/${message.id}?`));
        if (message) return Response.json(message);
        throw new Error(`Unexpected request: ${path}`);
      });
      const request = { freightBill: '4253383', since: new Date(at - 1000).toISOString() };
      const discovered = await api.handleParamountEmail({ ...request, action: 'driverPaperwork' });
      assert.deepEqual(discovered.body.files.map(file => file.messageId), ['standalone']);
      const result = await api.handleParamountEmail({
        ...request, action: 'sendPaperwork', orderNumber: '24515484', target: 'rxo', text: 'Attached is the paperwork.'
      });
      assert.equal(result.body.ok, true);
      assert.equal(Boolean(result.body.alreadySent), mode === 'manual-identical');
      assert.equal(sends, mode === 'manual-identical' ? 0 : 1);
    });
  }
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

test('only SNB load emails copy Ivan, removing inherited addresses on other or unknown codes', async () => {
  const { withLoadIvanCopy } = await import('./_lib/gmailThread.js');
  assert.deepEqual(withLoadIvanCopy({ to: ['chatracking2@rxo.com'], cc: ['dashawn@rxo.com'] }, ' snb '),
    { to: ['chatracking2@rxo.com'], cc: ['dashawn@rxo.com', 'ivan.lopez@landstarmail.com'] });
  assert.deepEqual(withLoadIvanCopy({ to: ['chatracking2@rxo.com'], cc: ['Ivan Lopez <Ivan.Lopez@landstarmail.com>'] }, 'SNB').cc,
    ['Ivan Lopez <Ivan.Lopez@landstarmail.com>'], 'already on it: not added twice');
  for (const code of ['ANQ', '', undefined, 'SNB-other']) {
    assert.deepEqual(withLoadIvanCopy({
      to: ['Ivan <IVAN.LOPEZ@landstarmail.com>', 'tracking@rxo.com'],
      cc: ['ivan.lopez@landstarmail.com', 'ops@rxo.com']
    }, code), { to: ['tracking@rxo.com'], cc: ['ops@rxo.com'] });
  }
  const thread = { id: 't1', messages: [
    msg('r1', 1000, { From: 'chatracking2 <chatracking2@rxo.com>', To: me, Cc: 'dashawn@rxo.com', Subject: 'Update Request - Order # 24474085 Coeymans, NY → Pittston, PA' })
  ] };
  const [request] = findOpenRxoRequests([thread], me, { '24474085': 'SNB' });
  assert.ok(request.cc.includes('ivan.lopez@landstarmail.com'), 'shown on the draft too');
  const [nonSnb] = findOpenRxoRequests([thread], me, { '24474085': 'ANQ' });
  assert.ok(!nonSnb.cc.includes('ivan.lopez@landstarmail.com'));
});

test('Trucker Tools "tracking started" subject gives the Paramount load number', () => {
  assert.equal(parseTruckerToolsSubject('TT App - Load Track has been started - Load Number: 2282980'), '2282980');
  assert.equal(parseTruckerToolsSubject('Fwd: TT App - Load Track has been started - Load Number: #2283600'), '2283600');
  assert.equal(parseTruckerToolsSubject('TT App - Load Track has been stopped - Load Number: 2282980'), '');
  assert.equal(parseTruckerToolsSubject('BCO Load Detail for load: - 4574648'), '');
});
