import { getServiceClient } from './_lib/server.js';
import { isTmsOwner } from '../src/lib/teamAdmin.js';

// "Add teammate" in ⚙ My Settings:
//   POST /api/invite-user  { email }   (Authorization: Bearer <the signed-in user's Supabase token>)
// Supabase emails the person an invite link; they open it, choose a password and sign in to
// their own empty workspace (customers are then shared with them from the TMS).
//
// Only the TMS owner (Daniel, src/lib/teamAdmin.js) may invite; everyone else is refused.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Where the invite link may send people back to: this app only.
const ALLOWED_ORIGIN = /^(https:\/\/[a-z0-9-]+\.vercel\.app|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/i;

export async function processInviteRequest({ method, authorization, body, origin }, { getClient = getServiceClient } = {}) {
  if (method !== 'POST') return { status: 405, body: { error: 'Use POST.' } };
  const client = getClient();
  if (!client) return { status: 503, body: { error: 'Inviting is not set up: the server needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' } };

  const token = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { status: 401, body: { error: 'Sign in to the TMS first.' } };
  const { data: caller, error: callerError } = await client.auth.getUser(token);
  if (callerError || !caller?.user) return { status: 401, body: { error: 'Your sign-in has expired. Sign out and back in, then try again.' } };
  if (!isTmsOwner(caller.user.id)) return { status: 403, body: { error: 'Only the TMS owner can add teammates.' } };

  const email = String(body?.email || '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return { status: 400, body: { error: 'Enter a valid email address.' } };

  const redirectTo = ALLOWED_ORIGIN.test(String(origin || '')) ? `${origin}/` : undefined;
  const { data, error } = await client.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
  if (error) {
    if (/already (been )?registered|already exists/i.test(error.message || '')) {
      return { status: 409, body: { error: `${email} already has a TMS account. They can use "Forgot password?" on the sign-in page.` } };
    }
    return { status: 502, body: { error: error.message || 'Supabase could not send the invite.' } };
  }
  return { status: 200, body: { ok: true, email, userId: data?.user?.id || null } };
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await processInviteRequest({
      method: req.method, authorization: req.headers.authorization, body: readBody(req), origin: req.headers.origin
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Invite failed:', error);
    return res.status(500).json({ error: 'The invite could not be sent.' });
  }
}
