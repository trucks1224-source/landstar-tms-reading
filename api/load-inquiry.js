import { getAccessToken, getServiceClient, sendGmail } from './_lib/server.js';

// Public endpoint behind the driver link (public/inquire.html?t=<token>).
//   GET  /api/load-inquiry?t=<token>  -> the load details you chose to share
//   POST /api/load-inquiry            -> saves a driver's inquiry and emails you
// Drivers never see the customer name, your notes, or other loads. Links are
// long random tokens created from the TMS ("Copy driver link").

const publicFields = ['ref', 'company', 'callbackPhone', 'origin', 'destination', 'pickup', 'delivery', 'equipment', 'weight', 'miles', 'rate'];
const maxPerHour = 10;

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

function publicDetails(details) {
  return Object.fromEntries(publicFields.map(key => [key, clean(details?.[key], 120)]));
}

async function findLink(supabase, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) return null;
  const { data, error } = await supabase
    .from('load_inquiry_links')
    .select('token, owner_id, owner_email, customer, load_id, details, active')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  return data?.active ? data : null;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch { return {}; }
}

// Dependencies are injectable so tests can run without a real database or Gmail.
export function createLoadInquiryHandler({ getClient = getServiceClient, getToken = getAccessToken, send = sendGmail } = {}) {
  return async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const supabase = getClient();
  if (!supabase) return res.status(503).json({ error: 'Load inquiries are not set up yet.' });

  try {
    if (req.method === 'GET') {
      const link = await findLink(supabase, req.query.t);
      if (!link) return res.status(404).json({ error: 'This load link is no longer available.' });
      return res.status(200).json({ load: publicDetails(link.details) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    const body = readBody(req);
    // Hidden "website" field: real people leave it empty, spam bots fill it in.
    if (clean(body.website, 200)) return res.status(200).json({ ok: true });

    const link = await findLink(supabase, body.t);
    if (!link) return res.status(404).json({ error: 'This load link is no longer available.' });

    const driverName = clean(body.name, 80);
    const driverPhone = clean(body.phone, 30);
    const driverEmail = clean(body.email, 120);
    const mcOrTruck = clean(body.mcOrTruck, 60);
    const message = clean(body.message, 1000);
    if (!driverName) return res.status(400).json({ error: 'Please enter your name.' });
    if (driverPhone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Please enter a phone number we can call you back on.' });
    if (driverEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(driverEmail)) return res.status(400).json({ error: 'That email address does not look right.' });

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('load_inquiries')
      .select('id', { count: 'exact', head: true })
      .eq('token', link.token)
      .gte('created_at', hourAgo);
    if ((count || 0) >= maxPerHour) {
      return res.status(429).json({ error: 'This load has received a lot of inquiries. Please call instead.' });
    }

    const { data: inquiry, error: insertError } = await supabase
      .from('load_inquiries')
      .insert({
        token: link.token,
        owner_id: link.owner_id,
        customer: link.customer,
        load_id: link.load_id,
        driver_name: driverName,
        driver_phone: driverPhone,
        mc_or_truck: [mcOrTruck, driverEmail && `Email: ${driverEmail}`].filter(Boolean).join(' · ') || null,
        message: message || null
      })
      .select('id')
      .single();
    if (insertError) throw insertError;

    // Email you. The inquiry is already saved, so a failed email never loses it;
    // the TMS shows the reason next to the inquiry instead.
    let notifyError = null;
    try {
      const { data: connection } = await supabase
        .from('gmail_connection').select('email, refresh_token').eq('id', 1).maybeSingle();
      const to = link.owner_email || connection?.email;
      if (!connection?.refresh_token || !to) throw new Error('Gmail is not connected, so no email was sent.');
      const details = publicDetails(link.details);
      const host = clean(req.headers['x-forwarded-host'] || req.headers.host, 200);
      await send(await getToken(connection.refresh_token), {
        to,
        replyTo: driverEmail || undefined,
        subject: `Driver inquiry: Load #${details.ref} ${details.origin} → ${details.destination}`,
        text: [
          `${driverName} is asking about load #${details.ref}.`,
          '',
          `Phone: ${driverPhone}`,
          driverEmail ? `Email: ${driverEmail}` : null,
          mcOrTruck ? `MC / truck: ${mcOrTruck}` : null,
          message ? `Message: ${message}` : null,
          '',
          `Load: ${details.origin} → ${details.destination}`,
          `Pickup: ${details.pickup}`,
          `Delivery: ${details.delivery}`,
          `Equipment: ${details.equipment} · Rate: ${details.rate}`,
          `Customer: ${link.customer}`,
          '',
          host ? `Open your TMS: https://${host}/` : null
        ].filter(line => line !== null).join('\n')
      });
    } catch (error) {
      notifyError = clean(error.message, 300);
    }
    await supabase.from('load_inquiries')
      .update({ notified: !notifyError, notify_error: notifyError })
      .eq('id', inquiry.id);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Load inquiry failed:', error);
    return res.status(500).json({ error: 'Something went wrong. Please call instead.' });
  }
  };
}

export default createLoadInquiryHandler();
