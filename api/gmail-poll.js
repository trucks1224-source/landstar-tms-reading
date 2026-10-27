import { getAccessToken, getMessageText, getServiceClient, secretsMatch } from './_lib/server.js';
import { parseRateConfirmation } from './_lib/rateConfirmation.js';

const defaultQuery = 'subject:"Rate Confirmation for order"';
const defaultCustomer = 'Para 1522166 - ATZ';
const overlapMs = 15 * 60 * 1000;
const firstRunLookbackMs = 2 * 24 * 60 * 60 * 1000;

// Called every few minutes by the scheduler with "Authorization: Bearer <CRON_SECRET>".
export default async function handler(req, res) {
  const { CRON_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  const supabase = getServiceClient();
  if (!CRON_SECRET || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !supabase) {
    return res.status(503).json({ error: 'Gmail automation is not configured.' });
  }
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secretsMatch(bearer, CRON_SECRET)) return res.status(401).json({ error: 'Unauthorized.' });

  const startedAt = new Date();
  try {
    const { data: connection, error: connectionError } = await supabase
      .from('gmail_connection').select('refresh_token, last_checked_at').eq('id', 1).maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) return res.status(409).json({ error: 'Gmail is not connected yet.' });

    const since = connection.last_checked_at
      ? new Date(connection.last_checked_at).getTime() - overlapMs
      : startedAt.getTime() - firstRunLookbackMs;
    const query = `${process.env.GMAIL_QUERY || defaultQuery} after:${Math.floor(since / 1000)}`;
    const customer = process.env.GMAIL_CUSTOMER || defaultCustomer;

    const accessToken = await getAccessToken(connection.refresh_token);
    const headers = { Authorization: `Bearer ${accessToken}` };
    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=25`,
      { headers }
    );
    if (!listResponse.ok) throw new Error(`Gmail search failed (${listResponse.status}).`);
    const messages = (await listResponse.json()).messages || [];

    const summary = { messages: messages.length, loadsQueued: 0, skipped: [] };
    for (const { id: messageId } of messages) {
      const messageResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
        { headers }
      );
      if (!messageResponse.ok) {
        summary.skipped.push({ messageId, reason: `read failed (${messageResponse.status})` });
        continue;
      }
      const message = await messageResponse.json();
      const subject = (message.payload?.headers || []).find(header => header.name.toLowerCase() === 'subject')?.value || '';
      const loads = parseRateConfirmation(subject, getMessageText(message.payload || {}), customer);
      if (!loads.length) {
        summary.skipped.push({ messageId, subject: subject.slice(0, 80), reason: 'no load recognized' });
        continue;
      }

      const rows = loads.map(({ customer: loadCustomer, ...load }) => ({
        gmail_message_id: messageId,
        customer: loadCustomer,
        load_id: load.id,
        load
      }));
      const { error: insertError } = await supabase
        .from('email_loads')
        .upsert(rows, { onConflict: 'gmail_message_id,load_id', ignoreDuplicates: true });
      if (insertError) throw insertError;
      summary.loadsQueued += rows.length;
    }

    await supabase.from('gmail_connection').update({ last_checked_at: startedAt.toISOString() }).eq('id', 1);
    return res.status(200).json(summary);
  } catch (error) {
    console.error('Gmail poll failed:', error);
    return res.status(500).json({ error: error.message || 'Gmail poll failed.' });
  }
}
