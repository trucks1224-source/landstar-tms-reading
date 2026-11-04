import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export function getServiceClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export function secretsMatch(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export function connectState(secret) {
  return crypto.createHmac('sha256', secret).update('gmail-connect').digest('hex');
}

function decodeBody(data) {
  return Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

export function getMessageText(payload) {
  const plain = [];
  const html = [];
  const walk = part => {
    if (part.body?.data) {
      if (part.mimeType === 'text/plain') plain.push(decodeBody(part.body.data));
      if (part.mimeType === 'text/html') html.push(decodeBody(part.body.data));
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  if (plain.length) return plain.join('\n');
  return html.join('\n')
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export async function getAccessToken(refreshToken) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || 'Google rejected the saved Gmail connection.');
  }
  return result.access_token;
}

// Header values must stay on one line so nothing can inject extra headers.
const oneLine = value => String(value || '').replace(/[\r\n]+/g, ' ').trim();

// Sends a plain-text email through the connected Gmail account (needs gmail.send scope).
export async function sendGmail(accessToken, { to, subject, text, replyTo }) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(oneLine(subject), 'utf8').toString('base64')}?=`;
  const headers = [
    `To: ${oneLine(to)}`,
    `Subject: ${encodedSubject}`,
    replyTo ? `Reply-To: ${oneLine(replyTo)}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ].filter(Boolean);
  const raw = `${headers.join('\r\n')}\r\n\r\n${Buffer.from(String(text || ''), 'utf8').toString('base64')}`;
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') })
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const reason = result.error?.message || `Gmail send failed (HTTP ${response.status})`;
    throw new Error(/insufficient|scope/i.test(reason)
      ? 'Gmail is not allowed to send yet. Reconnect Gmail once at /api/gmail-connect to add send permission.'
      : reason);
  }
}
