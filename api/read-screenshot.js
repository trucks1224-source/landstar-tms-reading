import { getServiceClient } from './_lib/server.js';
import { readScreenshotLoads } from './_lib/readScreenshot.js';

// AI screenshot reading on the website, for teammates (Daniel 2026-11-27): the same reader as
// the local TMS (api/_lib/readScreenshot.js), with the AI key in Vercel's settings
// (ANTHROPIC_API_KEY). Only someone signed in to the TMS can use it, so the key is never open
// to the internet; the spending cap is set in the Anthropic console.
//   POST /api/read-screenshot { images: [{ data, mediaType }], instructions, customer }
//   Authorization: Bearer <the signed-in user's Supabase token>
const MAX_IMAGES = 6;

export async function processReadScreenshot({ method, authorization, body }, { getClient = getServiceClient, read = readScreenshotLoads } = {}) {
  if (method !== 'POST') return { status: 405, body: { error: 'Use POST.' } };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: 503, body: { error: 'AI screenshot reading is not set up on the website yet (the owner adds the AI key in Vercel).' } };
  }
  const client = getClient();
  if (!client) return { status: 503, body: { error: 'The website cannot check sign-ins right now. Try again later.' } };
  const token = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { status: 401, body: { error: 'Sign in to the TMS first.' } };
  const { data: caller, error } = await client.auth.getUser(token);
  if (error || !caller?.user) return { status: 401, body: { error: 'Your sign-in has expired. Sign out and back in, then try again.' } };
  const images = Array.isArray(body?.images) ? body.images.slice(0, MAX_IMAGES) : [];
  if (!images.length) return { status: 400, body: { error: 'No picture was sent.' } };
  return read({ images, instructions: String(body?.instructions || '').slice(0, 3000), customer: String(body?.customer || '').slice(0, 200) });
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await processReadScreenshot({ method: req.method, authorization: req.headers.authorization, body: readBody(req) });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('AI screenshot reading failed:', error);
    return res.status(502).json({ error: 'The AI could not read the picture. Try again, or import it another way.' });
  }
}
