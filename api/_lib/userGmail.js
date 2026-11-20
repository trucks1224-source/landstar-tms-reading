// Each TMS user's own Gmail, for prospect outreach from the website (teammates).
// The refresh token lives in user_gmail_connection (no browser access, service role only).
// The office Gmail (gmail_connection id 1) used by the local TMS is separate and unchanged.
import crypto from 'node:crypto';
import { getAccessToken, getServiceClient } from './server.js';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const STATE_PREFIX = 'user';
const STATE_MINUTES = 15;

const sign = (secret, text) => crypto.createHmac('sha256', secret).update(`user-gmail:${text}`).digest('hex');

// OAuth "state" naming the TMS user who asked to connect: user.<id>.<expires>.<signature>.
export function createUserState(userId, secret, now = Date.now()) {
  const expires = now + STATE_MINUTES * 60 * 1000;
  return `${STATE_PREFIX}.${userId}.${expires}.${sign(secret, `${userId}.${expires}`)}`;
}

// The user id from a state this server signed and that has not expired, else null.
export function readUserState(state, secret, now = Date.now()) {
  const parts = String(state || '').split('.');
  if (parts.length !== 4 || parts[0] !== STATE_PREFIX || !secret) return null;
  const [, userId, expires, signature] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !(Number(expires) > now)) return null;
  const expected = Buffer.from(sign(secret, `${userId}.${expires}`));
  const actual = Buffer.from(String(signature));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) ? userId : null;
}

export function googleConnectUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// The signed-in TMS user making this request (Supabase access token in Authorization), or null.
export async function userFromRequest(req, supabase = getServiceClient()) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !supabase) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

export async function saveUserGmail(userId, { email, refreshToken }, supabase = getServiceClient()) {
  const { error } = await supabase.from('user_gmail_connection').upsert({
    user_id: userId, email: email || null, refresh_token: refreshToken, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function readUserGmail(userId, supabase = getServiceClient()) {
  const { data, error } = await supabase.from('user_gmail_connection').select('email, refresh_token').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function removeUserGmail(userId, supabase = getServiceClient()) {
  const { error } = await supabase.from('user_gmail_connection').delete().eq('user_id', userId);
  if (error) throw error;
}

// { accessToken, myEmail } for this user's Gmail, the shape the email code expects.
export async function connectUserGmail(userId, supabase = getServiceClient()) {
  const saved = await readUserGmail(userId, supabase);
  if (!saved?.refresh_token) throw new Error('Connect your Gmail first (Prospects -> Connect Gmail).');
  const accessToken = await getAccessToken(saved.refresh_token);
  return { accessToken, myEmail: String(saved.email || '').toLowerCase() };
}
