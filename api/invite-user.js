import crypto from 'node:crypto';
import { getServiceClient } from './_lib/server.js';
import { isTmsOwner } from '../src/lib/teamAdmin.js';

// "Add teammate" in ⚙ My Settings:
//   POST /api/invite-user  { email }   (Authorization: Bearer <the signed-in user's Supabase token>)
// Creates the teammate's account with a temporary password and returns it to the owner, who
// passes it on (text, call). No email is sent: Supabase's built-in email allows only a few
// emails an hour ("email rate limit exceeded", 2026-11-23). Typing the email of someone who
// already has an account gives them a new temporary password (a forgotten password).
// Either way the teammate must choose their own password the first time they sign in
// (user_metadata.must_change_password, see src/AuthGate.jsx).
//
// Only the TMS owner (Daniel, src/lib/teamAdmin.js) may call this; everyone else is refused.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// No look-alike characters (0/O, 1/l/I), so it can be read out over the phone.
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generateTempPassword(length = 12, randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i += 1) password += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length];
  return password;
}

async function findUserByEmail(client, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find(user => String(user.email || '').toLowerCase() === email);
    if (found || users.length < 200) return found || null;
  }
  return null;
}

export async function processInviteRequest({ method, authorization, body }, { getClient = getServiceClient, makePassword = generateTempPassword } = {}) {
  if (method !== 'POST') return { status: 405, body: { error: 'Use POST.' } };
  const client = getClient();
  if (!client) return { status: 503, body: { error: 'Adding teammates is not set up: the server needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' } };

  const token = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { status: 401, body: { error: 'Sign in to the TMS first.' } };
  const { data: caller, error: callerError } = await client.auth.getUser(token);
  if (callerError || !caller?.user) return { status: 401, body: { error: 'Your sign-in has expired. Sign out and back in, then try again.' } };
  if (!isTmsOwner(caller.user.id)) return { status: 403, body: { error: 'Only the TMS owner can add teammates.' } };

  const email = String(body?.email || '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return { status: 400, body: { error: 'Enter a valid email address.' } };

  const tempPassword = makePassword();
  const existing = await findUserByEmail(client, email);
  if (existing && isTmsOwner(existing.id)) {
    return { status: 400, body: { error: 'That is your own account. Change your password with "Forgot password?" or in Supabase.' } };
  }
  const result = existing
    ? await client.auth.admin.updateUserById(existing.id, {
      password: tempPassword, email_confirm: true,
      user_metadata: { ...(existing.user_metadata || {}), must_change_password: true }
    })
    : await client.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true, user_metadata: { must_change_password: true }
    });
  if (result.error) return { status: 502, body: { error: result.error.message || 'Supabase could not save the account.' } };
  return { status: 200, body: { ok: true, email, tempPassword, existed: Boolean(existing), userId: result.data?.user?.id || existing?.id || null } };
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await processInviteRequest({ method: req.method, authorization: req.headers.authorization, body: readBody(req) });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Adding a teammate failed:', error);
    return res.status(500).json({ error: 'The teammate could not be added.' });
  }
}
