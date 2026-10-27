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
