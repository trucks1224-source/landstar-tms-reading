import assert from 'node:assert/strict';
import test from 'node:test';
import { createProspectEmailHandler } from './prospect-email.js';
import { createUserState, readUserState } from './_lib/userGmail.js';

const SECRET = 'test-secret';
const USER = { id: '11111111-2222-3333-4444-555555555555', email: 'zaden@example.com' };
const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: 'https://site/api/gmail-connect', CRON_SECRET: SECRET };

async function call(handler, req) {
  const res = {
    statusCode: 0, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler({ method: 'POST', headers: {}, ...req }, res);
  return res;
}

function handlerWith(overrides = {}) {
  const calls = { connected: [], sent: [] };
  const handler = createProspectEmailHandler({
    env,
    getClient: () => ({}),
    getUser: async req => (req.headers.authorization === 'Bearer good' ? USER : null),
    readGmail: async userId => (userId === USER.id ? { email: 'zaden@gmail.com', refresh_token: 'r' } : null),
    removeGmail: async () => {},
    connectGmail: async userId => { calls.connected.push(userId); return { accessToken: 'a', myEmail: 'zaden@gmail.com' }; },
    sendProspect: async (body, { connectGmail }) => { await connectGmail(); calls.sent.push(body); return { status: 200, body: { ok: true } }; },
    ...overrides
  });
  return { handler, calls };
}

test('only a signed-in TMS user can use prospect email', async () => {
  const { handler, calls } = handlerWith();
  const res = await call(handler, { body: { action: 'prospectSend', to: 'broker@example.com' } });
  assert.equal(res.statusCode, 401);
  assert.equal(calls.sent.length, 0);
});

test('a teammate sends from their own Gmail, never anyone else\'s', async () => {
  const { handler, calls } = handlerWith();
  const res = await call(handler, { headers: { authorization: 'Bearer good' }, body: { action: 'prospectSend', to: 'broker@example.com', subject: 's', text: 't' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.connected, [USER.id], 'the Gmail of the signed-in user');
  assert.equal(calls.sent[0].to, 'broker@example.com');
});

test('status and connect link for the signed-in user', async () => {
  const { handler } = handlerWith();
  const status = await call(handler, { headers: { authorization: 'Bearer good' }, body: { action: 'status' } });
  assert.deepEqual(status.body, { connected: true, email: 'zaden@gmail.com' });
  const link = await call(handler, { headers: { authorization: 'Bearer good' }, body: { action: 'connectUrl' } });
  const state = new URL(link.body.url).searchParams.get('state');
  assert.equal(readUserState(state, SECRET), USER.id, 'Google sends the signed state back to /api/gmail-connect');
  const bad = await call(handler, { headers: { authorization: 'Bearer good' }, body: { action: 'deleteEverything' } });
  assert.equal(bad.statusCode, 400);
});

test('connect links are signed, tied to one user, and expire', () => {
  const now = Date.parse('2026-11-20T18:00:00Z');
  const state = createUserState(USER.id, SECRET, now);
  assert.equal(readUserState(state, SECRET, now), USER.id);
  assert.equal(readUserState(state, 'other-secret', now), null, 'not signed by this server');
  assert.equal(readUserState(state.replace(USER.id, '99999999-2222-3333-4444-555555555555'), SECRET, now), null, 'user swapped');
  assert.equal(readUserState(state, SECRET, now + 16 * 60 * 1000), null, 'expired after 15 minutes');
  assert.equal(readUserState('anything', SECRET, now), null);
});
