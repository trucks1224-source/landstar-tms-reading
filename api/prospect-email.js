// Prospect outreach from the website, from the signed-in teammate's OWN Gmail.
//   POST /api/prospect-email   Authorization: Bearer <Supabase access token>
//   { action: 'status' }                 -> { connected, email }
//   { action: 'connectUrl' }             -> { url }  (Google page to approve Gmail)
//   { action: 'disconnect' }             -> { ok }
//   { action: 'prospectSend' | 'prospectReplies' | 'prospectThreadReply', ... }  (same as the local TMS)
// Nobody can send from someone else's Gmail: the user comes from their own sign-in token.
import { getServiceClient } from './_lib/server.js';
import { handleProspectEmail } from './_lib/gmailThread.js';
import {
  connectUserGmail, createUserState, googleConnectUrl, readUserGmail, removeUserGmail, userFromRequest
} from './_lib/userGmail.js';

const EMAIL_ACTIONS = new Set(['prospectSend', 'prospectReplies', 'prospectThreadReply']);

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch { return {}; }
}

// Dependencies are injectable so tests can run without a real database or Gmail.
export function createProspectEmailHandler({
  getClient = getServiceClient, getUser = userFromRequest, readGmail = readUserGmail, removeGmail = removeUserGmail,
  connectGmail = connectUserGmail, sendProspect = handleProspectEmail, env = process.env
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    const supabase = getClient();
    if (!supabase || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI || !env.CRON_SECRET) {
      return res.status(503).json({ error: 'Gmail outreach is not set up on the website yet.' });
    }
    const user = await getUser(req, supabase);
    if (!user) return res.status(401).json({ error: 'Sign in to the TMS first.' });
    const body = readBody(req);
    try {
      if (body.action === 'status') {
        const saved = await readGmail(user.id, supabase);
        return res.status(200).json({ connected: Boolean(saved?.refresh_token), email: saved?.email || '' });
      }
      if (body.action === 'connectUrl') {
        return res.status(200).json({ url: googleConnectUrl(createUserState(user.id, env.CRON_SECRET)) });
      }
      if (body.action === 'disconnect') {
        await removeGmail(user.id, supabase);
        return res.status(200).json({ ok: true });
      }
      if (!EMAIL_ACTIONS.has(body.action)) return res.status(400).json({ error: 'Unknown action.' });
      const result = await sendProspect(body, { connectGmail: () => connectGmail(user.id, supabase) });
      return res.status(result.status).json(result.body);
    } catch (error) {
      console.error('Prospect email failed:', error.message);
      return res.status(502).json({ error: error.message || 'The Gmail request failed.' });
    }
  };
}

export default createProspectEmailHandler();
