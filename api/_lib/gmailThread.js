// Paramount tracking emails: find the "Rate Confirmation for order: <order#>" thread in
// the connected Gmail account, reply-all inside it, and list replies from other people.
// Used by the local TMS server (vite.config.js -> /api/paramount-email).
import { getAccessToken, getMessageText, getServiceClient } from './server.js';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const oneLine = value => String(value || '').replace(/[\r\n]+/g, ' ').trim();

// "Heather Locke <heather.locke@rlglobal.com>, x@y.com" -> ["Heather Locke <heather.locke@rlglobal.com>", "x@y.com"]
export function splitAddresses(value) {
  const out = [];
  let current = '';
  let quoted = false;
  let angle = 0;
  for (const ch of String(value || '')) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '<') angle += 1;
    if (!quoted && ch === '>') angle = Math.max(0, angle - 1);
    if (ch === ',' && !quoted && !angle) {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function emailOf(address) {
  const text = String(address || '');
  return (text.match(/<([^>]+)>/)?.[1] || text).trim().toLowerCase();
}

const header = (message, name) => (message?.payload?.headers || [])
  .find(item => item.name.toLowerCase() === name.toLowerCase())?.value || '';

// The thread must be Paramount's rate confirmation for exactly this order number.
export function isRateConfirmationSubject(subject, orderNumber) {
  const order = String(orderNumber || '').trim();
  if (!/^\d{4,}$/.test(order)) return false;
  const match = String(subject || '').match(/Rate Confirmation for order:?\s*#?\s*(\d+)/i);
  return Boolean(match && match[1] === order && /paramount/i.test(subject));
}

// Reply-all recipients for the newest message of the thread, never including my own address.
// To: whoever wrote the newest message that isn't mine (else that message's To);
// Cc: everyone else on it.
export function buildReplyAll(messages, myEmail) {
  const me = String(myEmail || '').toLowerCase();
  const list = messages || [];
  if (!list.length) return { to: [], cc: [] };
  const latest = list[list.length - 1];
  const latestOther = [...list].reverse().find(message => emailOf(header(message, 'From')) !== me) || latest;
  const seen = new Set([me]);
  const take = values => values.filter(address => {
    const email = emailOf(address);
    if (!email || !email.includes('@') || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
  const fromLatest = emailOf(header(latest, 'From')) === me ? [] : splitAddresses(header(latest, 'From'));
  const to = take([...fromLatest, ...splitAddresses(header(latestOther, 'From')), ...splitAddresses(header(latest, 'Reply-To'))]);
  const cc = take([
    ...splitAddresses(header(latest, 'To')), ...splitAddresses(header(latest, 'Cc')),
    ...splitAddresses(header(latestOther, 'To')), ...splitAddresses(header(latestOther, 'Cc'))
  ]);
  if (!to.length && cc.length) to.push(cc.shift());
  return { to, cc };
}

// Messages from other people (not me) newer than `sinceMs`, for the TMS reply alerts.
// (The caller leaves out the rate confirmation itself, the thread's first message.)
export function findNewReplies(messages, myEmail, sinceMs = 0) {
  const me = String(myEmail || '').toLowerCase();
  return (messages || [])
    .filter(message => emailOf(header(message, 'From')) !== me && Number(message.internalDate) > Number(sinceMs || 0))
    .map(message => ({
      id: message.id,
      from: header(message, 'From'),
      at: new Date(Number(message.internalDate)).toISOString(),
      snippet: String(message.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, 300)
    }));
}

export function buildReplyMessage({ to, cc, subject, inReplyTo, references, text, from }) {
  const replySubject = /^re:/i.test(subject) ? subject : `RE: ${subject}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(oneLine(replySubject), 'utf8').toString('base64')}?=`;
  const headers = [
    from ? `From: ${oneLine(from)}` : null,
    `To: ${to.map(oneLine).join(', ')}`,
    cc.length ? `Cc: ${cc.map(oneLine).join(', ')}` : null,
    `Subject: ${encodedSubject}`,
    inReplyTo ? `In-Reply-To: ${oneLine(inReplyTo)}` : null,
    inReplyTo || references ? `References: ${oneLine([references, inReplyTo].filter(Boolean).join(' '))}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${Buffer.from(String(text || ''), 'utf8').toString('base64')}`;
}

async function gmailJson(accessToken, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = result.error?.message || `Gmail request failed (HTTP ${response.status})`;
    throw new Error(/insufficient|scope/i.test(reason)
      ? 'Gmail is not allowed to send yet. Reconnect Gmail once at /api/gmail-connect to add send permission.'
      : reason);
  }
  return result;
}

async function connect() {
  const supabase = getServiceClient();
  if (!supabase || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Gmail is not set up on this computer (.env needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET).');
  }
  const { data, error } = await supabase.from('gmail_connection').select('refresh_token, email').eq('id', 1).maybeSingle();
  if (error) throw error;
  if (!data?.refresh_token) throw new Error('Gmail is not connected yet.');
  const accessToken = await getAccessToken(data.refresh_token);
  let email = data.email;
  if (!email) email = (await gmailJson(accessToken, `${GMAIL}/profile`)).emailAddress;
  return { accessToken, myEmail: String(email || '').toLowerCase() };
}

// The newest Paramount rate-confirmation thread for the order, with its messages.
async function findThread(accessToken, orderNumber) {
  const query = `subject:"Rate Confirmation for order" "${orderNumber}" newer_than:30d`;
  const list = await gmailJson(accessToken, `${GMAIL}/threads?q=${encodeURIComponent(query)}&maxResults=10`);
  for (const { id } of list.threads || []) {
    const thread = await gmailJson(accessToken, `${GMAIL}/threads/${encodeURIComponent(id)}?format=metadata`
      + '&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Reply-To'
      + '&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References');
    const messages = (thread.messages || []).sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    if (messages.length && isRateConfirmationSubject(header(messages[0], 'Subject'), orderNumber)) {
      return { threadId: thread.id, messages };
    }
  }
  return null;
}

// RXO tracking asks for updates in emails like "Update Request - Order # 24474092 Coeymans, NY → Pittston, PA"
// (also "Update Request/ Order #", "Update request Order #"). Returns the order number or ''.
export function parseRxoRequestSubject(subject) {
  return String(subject || '').match(/update\s*request\b[\s\S]*?order\s*#?\s*(\d{6,})/i)?.[1] || '';
}

const isRxoAddress = address => /@rxo\.com$/i.test(emailOf(address));

// RXO update requests still waiting for an answer: the thread's newest message is from RXO.
export function findOpenRxoRequests(threads, myEmail) {
  const me = String(myEmail || '').toLowerCase();
  return (threads || []).flatMap(({ id, messages }) => {
    const list = [...(messages || [])].sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    if (!list.length) return [];
    const orderNumber = parseRxoRequestSubject(header(list[0], 'Subject'));
    const latest = list[list.length - 1];
    const from = header(latest, 'From');
    if (!orderNumber || !isRxoAddress(from) || emailOf(from) === me) return [];
    return [{
      threadId: id, messageId: latest.id, orderNumber, subject: header(list[0], 'Subject'), from,
      at: new Date(Number(latest.internalDate)).toISOString(),
      snippet: String(latest.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, 300),
      ...buildReplyAll(list, me)
    }];
  });
}

const THREAD_HEADERS = '&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Reply-To'
  + '&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References';

async function handleRxoEmail({ action, threadId, text }) {
  const { accessToken, myEmail } = await connect();
  if (action === 'rxoRequests') {
    const query = 'from:rxo.com subject:"Update Request" newer_than:3d';
    const list = await gmailJson(accessToken, `${GMAIL}/threads?q=${encodeURIComponent(query)}&maxResults=25`);
    const threads = [];
    for (const { id } of list.threads || []) {
      threads.push(await gmailJson(accessToken, `${GMAIL}/threads/${encodeURIComponent(id)}?format=metadata${THREAD_HEADERS}`));
    }
    return { status: 200, body: { requests: findOpenRxoRequests(threads, myEmail) } };
  }
  // rxoSend: reply-all in an RXO update-request thread (checked again before sending).
  const body = String(text || '').trim();
  if (!/^[0-9a-f]{8,}$/i.test(String(threadId || ''))) return { status: 400, body: { error: 'Missing email thread.' } };
  if (!body || body.length > 20000) return { status: 400, body: { error: 'The email text is empty or too long.' } };
  const thread = await gmailJson(accessToken, `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=metadata${THREAD_HEADERS}`);
  const messages = (thread.messages || []).sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
  if (!messages.length || !parseRxoRequestSubject(header(messages[0], 'Subject'))
    || !messages.some(message => isRxoAddress(header(message, 'From')))) {
    return { status: 409, body: { error: 'That email is not an RXO update request.' } };
  }
  const recipients = buildReplyAll(messages, myEmail);
  if (!recipients.to.length) return { status: 409, body: { error: 'Nobody to reply to on that email thread.' } };
  const latest = messages[messages.length - 1];
  const raw = buildReplyMessage({
    to: recipients.to, cc: recipients.cc, subject: header(messages[0], 'Subject'),
    inReplyTo: header(latest, 'Message-ID'), references: header(latest, 'References'), text: body
  });
  const sent = await gmailJson(accessToken, `${GMAIL}/messages/send`, {
    method: 'POST', body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url'), threadId: thread.id })
  });
  return { status: 200, body: { ok: true, id: sent.id, threadId: thread.id, ...recipients } };
}

// ---------- Driver emails (BCO Load Detail threads) ----------
// Daniel dispatches drivers with "BCO Load Detail for load: - <freight bill>" from his
// @landstarmail.com address (to himself and the driver). Driver emails reply in that
// thread: To the driver, Cc his Landstar address.
export function parseBcoSubject(subject) {
  return String(subject || '').match(/BCO Load Detail for(?: load)?:?\s*-?\s*(\d{5,})/i)?.[1] || '';
}

const isLandstarAddress = address => /@landstarmail\.com$/i.test(emailOf(address));

export function buildDriverRecipients(message, myEmail) {
  const me = String(myEmail || '').toLowerCase();
  const all = [...splitAddresses(header(message, 'To')), ...splitAddresses(header(message, 'Cc'))];
  const seen = new Set([me]);
  const keep = address => {
    const email = emailOf(address);
    if (!email.includes('@') || seen.has(email)) return false;
    seen.add(email);
    return true;
  };
  const drivers = all.filter(address => !isLandstarAddress(address) && keep(address));
  const landstar = [header(message, 'From'), ...all].filter(address => isLandstarAddress(address) && keep(address));
  return { to: drivers, cc: landstar };
}

// Replies in a driver thread from anyone but Daniel (his Gmail or Landstar address).
export function findDriverReplies(messages, myEmail, sinceMs = 0) {
  return findNewReplies(messages, myEmail, sinceMs).filter(reply => !isLandstarAddress(reply.from));
}

async function findBcoThread(accessToken, freightBill) {
  const query = `subject:"BCO Load Detail for" "${freightBill}" newer_than:30d`;
  const list = await gmailJson(accessToken, `${GMAIL}/threads?q=${encodeURIComponent(query)}&maxResults=10`);
  const threads = [];
  for (const { id } of list.threads || []) {
    const thread = await gmailJson(accessToken, `${GMAIL}/threads/${encodeURIComponent(id)}?format=metadata${THREAD_HEADERS}`);
    const messages = (thread.messages || []).sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    if (messages.length && parseBcoSubject(header(messages[0], 'Subject')) === freightBill) threads.push({ id: thread.id, messages });
  }
  // A reassigned load has one thread per driver: the newest dispatch is the current driver.
  return threads.sort((a, b) => Number(b.messages[0].internalDate) - Number(a.messages[0].internalDate))[0] || null;
}

async function handleDriverEmail({ action, freightBill, since, text }) {
  const bill = String(freightBill || '').trim();
  if (!/^\d{5,}$/.test(bill)) return { status: 400, body: { error: 'A Landstar freight bill number is needed.' } };
  const { accessToken, myEmail } = await connect();
  const found = await findBcoThread(accessToken, bill);
  if (!found) return { status: 404, body: { error: `No "BCO Load Detail" email for freight bill ${bill} found in Gmail.` } };
  const { id: threadId, messages } = found;
  const recipients = buildDriverRecipients(messages[0], myEmail);
  if (action === 'driverThread') {
    return { status: 200, body: { threadId, ...recipients, replies: findDriverReplies(messages.slice(1), myEmail, Date.parse(since) || 0) } };
  }
  const body = String(text || '').trim();
  if (!body || body.length > 20000) return { status: 400, body: { error: 'The email text is empty or too long.' } };
  if (!recipients.to.length) return { status: 409, body: { error: 'No driver email address on that BCO Load Detail email.' } };
  const latest = messages[messages.length - 1];
  const raw = buildReplyMessage({
    to: recipients.to, cc: recipients.cc, subject: header(messages[0], 'Subject'),
    inReplyTo: header(latest, 'Message-ID'), references: header(latest, 'References'), text: body
  });
  const sent = await gmailJson(accessToken, `${GMAIL}/messages/send`, {
    method: 'POST', body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url'), threadId })
  });
  return { status: 200, body: { ok: true, id: sent.id, threadId, ...recipients } };
}

// ---------- Weekly fuel surcharge email ----------
// "Fw: 11/3/2026   East .86  Midwest .88   West 1.03 New England .89" (Ryan Huber, forwarded
// by Jorge Farinhas). Returns the newest one's subject and text; the TMS reads the rates.
async function findFuelEmail() {
  const { accessToken } = await connect();
  const query = 'subject:(East Midwest West "New England") newer_than:30d';
  const list = await gmailJson(accessToken, `${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=5`);
  const first = (list.messages || [])[0];
  if (!first) return { status: 404, body: { error: 'No fuel surcharge email in the last 30 days.' } };
  const message = await gmailJson(accessToken, `${GMAIL}/messages/${encodeURIComponent(first.id)}?format=full`);
  return {
    status: 200,
    body: {
      messageId: message.id, subject: header(message, 'Subject'), from: header(message, 'From'),
      at: new Date(Number(message.internalDate)).toISOString(), text: getMessageText(message.payload || {}).slice(0, 4000)
    }
  };
}

// action "thread": who a reply-all goes to, plus replies from others since `since`.
// action "send": reply-all inside the thread with `text`.
// action "rxoRequests" / "rxoSend": RXO update requests (see handleRxoEmail).
export async function handleParamountEmail(request = {}) {
  const { action, orderNumber, since, text } = request;
  if (action === 'rxoRequests' || action === 'rxoSend') return handleRxoEmail(request);
  if (action === 'driverThread' || action === 'driverSend') return handleDriverEmail(request);
  if (action === 'fuelRates') return findFuelEmail();
  const order = String(orderNumber || '').trim();
  if (!/^\d{4,}$/.test(order)) return { status: 400, body: { error: 'A Paramount order number is needed.' } };
  const { accessToken, myEmail } = await connect();
  const found = await findThread(accessToken, order);
  if (!found) return { status: 404, body: { error: `No "Rate Confirmation for order: ${order}" email found in Gmail.` } };
  const { threadId, messages } = found;
  const recipients = buildReplyAll(messages, myEmail);
  const subject = header(messages[0], 'Subject');
  if (action === 'thread') {
    return { status: 200, body: { threadId, subject, ...recipients, replies: findNewReplies(messages.slice(1), myEmail, Date.parse(since) || 0) } };
  }
  if (action === 'send') {
    const body = String(text || '').trim();
    if (!body || body.length > 20000) return { status: 400, body: { error: 'The email text is empty or too long.' } };
    if (!recipients.to.length) return { status: 409, body: { error: 'Nobody to reply to on that email thread.' } };
    const latest = messages[messages.length - 1];
    const raw = buildReplyMessage({
      to: recipients.to, cc: recipients.cc, subject,
      inReplyTo: header(latest, 'Message-ID'), references: header(latest, 'References'), text: body
    });
    const sent = await gmailJson(accessToken, `${GMAIL}/messages/send`, {
      method: 'POST', body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url'), threadId })
    });
    return { status: 200, body: { ok: true, id: sent.id, threadId, ...recipients } };
  }
  return { status: 400, body: { error: 'Unknown action.' } };
}
