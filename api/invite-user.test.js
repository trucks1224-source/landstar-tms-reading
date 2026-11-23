import assert from 'node:assert/strict';
import test from 'node:test';
import { processInviteRequest, generateTempPassword } from './invite-user.js';
import { TMS_OWNER_ID, isTmsOwner } from '../src/lib/teamAdmin.js';

// A fake Supabase service client: who the token belongs to, which accounts exist, and what
// was created or changed. It has no email functions on purpose: nothing may send email.
function fakeClient({ callerId = TMS_OWNER_ID, users = [], saveError = null } = {}) {
  const created = [];
  const updated = [];
  return {
    created,
    updated,
    client: {
      auth: {
        async getUser(token) {
          return token === 'good' ? { data: { user: { id: callerId } }, error: null } : { data: null, error: { message: 'bad token' } };
        },
        admin: {
          async listUsers() { return { data: { users }, error: null }; },
          async createUser(attributes) {
            created.push(attributes);
            return saveError ? { data: null, error: saveError } : { data: { user: { id: 'new-user' } }, error: null };
          },
          async updateUserById(id, attributes) {
            updated.push({ id, ...attributes });
            return { data: { user: { id } }, error: null };
          }
        }
      }
    }
  };
}

const request = extra => ({ method: 'POST', authorization: 'Bearer good', body: { email: ' New.Person@Example.com ' }, ...extra });
const fixedPassword = () => 'Temp2345pass';

test('only the TMS owner is an owner', () => {
  assert.equal(isTmsOwner(TMS_OWNER_ID), true);
  assert.equal(isTmsOwner('someone-else'), false);
  assert.equal(isTmsOwner(null), false);
});

test('the owner adds a teammate: account created with a temporary password, no email sent', async () => {
  const fake = fakeClient();
  const result = await processInviteRequest(request(), { getClient: () => fake.client, makePassword: fixedPassword });
  assert.deepEqual(result, { status: 200, body: { ok: true, email: 'new.person@example.com', tempPassword: 'Temp2345pass', existed: false, userId: 'new-user' } });
  assert.deepEqual(fake.created, [{ email: 'new.person@example.com', password: 'Temp2345pass', email_confirm: true, user_metadata: { must_change_password: true } }]);
});

test('typing an existing teammate gives them a new temporary password (a forgotten password)', async () => {
  const fake = fakeClient({ users: [{ id: 'juan', email: 'New.Person@example.com', user_metadata: { name: 'Juan' } }] });
  const result = await processInviteRequest(request(), { getClient: () => fake.client, makePassword: fixedPassword });
  assert.equal(result.status, 200);
  assert.equal(result.body.existed, true);
  assert.equal(fake.created.length, 0);
  assert.deepEqual(fake.updated, [{ id: 'juan', password: 'Temp2345pass', email_confirm: true, user_metadata: { name: 'Juan', must_change_password: true } }]);
});

test("the owner's own account is never reset from here", async () => {
  const fake = fakeClient({ users: [{ id: TMS_OWNER_ID, email: 'new.person@example.com' }] });
  const result = await processInviteRequest(request(), { getClient: () => fake.client });
  assert.equal(result.status, 400);
  assert.equal(fake.updated.length, 0);
});

test('anyone else is refused and nothing is changed', async () => {
  const fake = fakeClient({ callerId: 'a-teammate' });
  const result = await processInviteRequest(request(), { getClient: () => fake.client });
  assert.equal(result.status, 403);
  assert.equal(fake.created.length + fake.updated.length, 0);
});

test('no sign-in, a bad sign-in, a bad email or a GET are refused', async () => {
  const fake = fakeClient();
  const getClient = () => fake.client;
  assert.equal((await processInviteRequest(request({ authorization: '' }), { getClient })).status, 401);
  assert.equal((await processInviteRequest(request({ authorization: 'Bearer nope' }), { getClient })).status, 401);
  assert.equal((await processInviteRequest(request({ body: { email: 'not-an-email' } }), { getClient })).status, 400);
  assert.equal((await processInviteRequest(request({ method: 'GET' }), { getClient })).status, 405);
  assert.equal(fake.created.length + fake.updated.length, 0);
});

test('a Supabase error is shown; no server key gives a setup message', async () => {
  const fake = fakeClient({ saveError: { message: 'Database error saving new user' } });
  const failed = await processInviteRequest(request(), { getClient: () => fake.client });
  assert.deepEqual(failed, { status: 502, body: { error: 'Database error saving new user' } });
  assert.equal((await processInviteRequest(request(), { getClient: () => null })).status, 503);
});

test('temporary passwords are 12 characters with no look-alikes (0/O, 1/l/I)', () => {
  for (let i = 0; i < 50; i += 1) {
    const password = generateTempPassword();
    assert.match(password, /^[A-HJ-NP-Za-km-z2-9]{12}$/);
  }
  assert.notEqual(generateTempPassword(), generateTempPassword());
});
