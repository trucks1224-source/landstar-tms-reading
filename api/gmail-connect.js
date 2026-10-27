import { connectState, getServiceClient, secretsMatch } from './_lib/server.js';

const scope = 'https://www.googleapis.com/auth/gmail.readonly';

// One-time setup: open /api/gmail-connect?key=<CRON_SECRET> while signed in to the
// Gmail account that receives the rate confirmations. Google redirects back here
// and the refresh token is stored server-side only.
export default async function handler(req, res) {
  const {
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, CRON_SECRET
  } = process.env;
  const supabase = getServiceClient();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !CRON_SECRET || !supabase) {
    return res.status(503).send('Gmail automation is not configured. Set the server environment variables first.');
  }

  const { code, state, key, error } = req.query;
  if (error) return res.status(400).send(`Google returned an error: ${String(error).slice(0, 100)}`);

  if (!code) {
    if (!secretsMatch(key, CRON_SECRET)) return res.status(401).send('Unauthorized.');
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope,
      access_type: 'offline',
      prompt: 'consent',
      state: connectState(CRON_SECRET)
    });
    res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    return res.status(302).end();
  }

  if (!secretsMatch(state, connectState(CRON_SECRET))) return res.status(401).send('Invalid state.');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.refresh_token) {
    return res.status(400).send('Google did not return a refresh token. Remove the app from your Google account permissions and try again.');
  }

  const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  const profile = profileResponse.ok ? await profileResponse.json() : {};

  const { error: saveError } = await supabase.from('gmail_connection').upsert({
    id: 1,
    email: profile.emailAddress || null,
    refresh_token: tokens.refresh_token,
    last_checked_at: null,
    updated_at: new Date().toISOString()
  });
  if (saveError) {
    console.error('Could not save the Gmail connection:', saveError);
    return res.status(500).send('Could not save the Gmail connection.');
  }
  return res.status(200).send(`Gmail connected${profile.emailAddress ? ` for ${profile.emailAddress}` : ''}. You can close this page.`);
}
