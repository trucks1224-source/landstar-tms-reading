import assert from 'node:assert/strict';
import test from 'node:test';
import { processInviteRequest } from './invite-user.js';
import { TMS_OWNER_ID, isTmsOwner } from '../src/lib/teamAdmin.js';

// A fake Supabase service client: who the token belongs to, and what the invite returns.
function fakeClient({ callerId = TMS_OWNER_ID, inviteError = null } = {}) {
  const invites = [];
  return {
    invites,
    client: {
      auth: {
        async getUser(token) {
          return token === 'good' ? { data: { user: { id: callerId, email: 'someone@x.com' } }, error: null } : { data: null, error: { message: 'bad token' } };
        },
        admin: {
          async inviteUserByEmail(email, options) {
            invites.push({ email, options });
            return inviteError ? { data: null, error: inviteError } : { data: { user: { id: 'new-user' } }, error: null };
          }
        }
      }
    }
  };
}

const request = extra => ({ method: 'POST', authorization: 'Bearer good', body: { email: ' New.Person@Example.com ' }, origin: 'http://127.0.0.1:5173', ...extra });

test('only the TMS owner is an owner', () => {
  assert.equal(isTmsOwner(TMS_OWNER_ID), true);
  assert.equal(isTmsOwner('someone-else'), false);
  assert.equal(isTmsOwner(null), false);
});

test('the owner can invite a teammate; the link comes back to this TMS', async () => {
  const fake = fakeClient();
  const result = await processInviteRequest(request(), { getClient: () => fake.client });
  assert.deepEqual(result, { status: 200, body: { ok: true, email: 'new.person@example.com', userId: 'new-user' } });
  assert.deepEqual(fake.invites, [{ email: 'new.person@example.com', options: { redirectTo: 'http://127.0.0.1:5173/' } }]);
});

test('anyone else is refused and nothing is sent', async () => {
  const fake = fakeClient({ callerId: 'a-teammate' });
  const result = await processInviteRequest(request(), { getClient: () => fake.client });
  assert.equal(result.status, 403);
  assert.equal(fake.invites.length, 0);
});

test('no sign-in, a bad sign-in, a bad email or a GET are refused', async () => {
  const fake = fakeClient();
  const getClient = () => fake.client;
  assert.equal((await processInviteRequest(request({ authorization: '' }), { getClient })).status, 401);
  assert.equal((await processInviteRequest(request({ authorization: 'Bearer nope' }), { getClient })).status, 401);
  assert.equal((await processInviteRequest(request({ body: { email: 'not-an-email' } }), { getClient })).status, 400);
  assert.equal((await processInviteRequest(request({ method: 'GET' }), { getClient })).status, 405);
  assert.equal(fake.invites.length, 0);
});

test('a link is never sent back to another website', async () => {
  const fake = fakeClient();
  await processInviteRequest(request({ origin: 'https://evil.example' }), { getClient: () => fake.client });
  assert.equal(fake.invites[0].options, undefined, 'Supabase then uses the site address set in its own settings');
});

test('someone who already has an account gets a clear message', async () => {
  const fake = fakeClient({ inviteError: { message: 'A user with this email address has already been registered' } });
  const result = await processInviteRequest(request(), { getClient: () => fake.client });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /already has a TMS account.*Forgot password/);
});

test('no server key: a clear setup message', async () => {
  const result = await processInviteRequest(request(), { getClient: () => null });
  assert.equal(result.status, 503);
});
