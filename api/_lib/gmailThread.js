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

// Daniel's rule (2026-11-07): every reply on an RXO "Update Request" email copies Ivan Lopez.
const RXO_ALWAYS_CC = ['ivan.lopez@landstarmail.com'];
export function withRxoAlwaysCc({ to = [], cc = [] }) {
  const present = new Set([...to, ...cc].map(emailOf));
  return { to, cc: [...cc, ...RXO_ALWAYS_CC.filter(address => !present.has(emailOf(address)))] };
}

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
      ...withRxoAlwaysCc(buildReplyAll(list, me))
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
  const recipients = withRxoAlwaysCc(buildReplyAll(messages, myEmail));
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

// Which BCO thread driver emails go to: the newest one that has a driver on it. A newer copy
// sent only to Daniel's own addresses (a re-send to himself) would otherwise leave nobody to email.
export function pickDriverThread(threads, myEmail) {
  const sorted = [...(threads || [])].sort((a, b) => Number(b.messages[0].internalDate) - Number(a.messages[0].internalDate));
  return sorted.find(thread => buildDriverRecipients(thread.messages[0], myEmail).to.length) || sorted[0] || null;
}

async function findBcoThread(accessToken, freightBill, myEmail = '') {
  const query = `subject:"BCO Load Detail for" "${freightBill}" newer_than:30d`;
  const list = await gmailJson(accessToken, `${GMAIL}/threads?q=${encodeURIComponent(query)}&maxResults=10`);
  const threads = [];
  for (const { id } of list.threads || []) {
    const thread = await gmailJson(accessToken, `${GMAIL}/threads/${encodeURIComponent(id)}?format=metadata${THREAD_HEADERS}`);
    const messages = (thread.messages || []).sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    if (messages.length && parseBcoSubject(header(messages[0], 'Subject')) === freightBill) threads.push({ id: thread.id, messages });
  }
  // A reassigned (or re-sent) load has several threads: emails go to the newest one with a
  // driver on it (see pickDriverThread), but drivers may answer on any of them, so all are returned too.
  const sorted = threads.sort((a, b) => Number(b.messages[0].internalDate) - Number(a.messages[0].internalDate));
  const chosen = pickDriverThread(sorted, myEmail);
  return chosen ? { ...chosen, all: sorted } : null;
}

async function handleDriverEmail({ action, freightBill, since, text }) {
  const bill = String(freightBill || '').trim();
  if (!/^\d{5,}$/.test(bill)) return { status: 400, body: { error: 'A Landstar freight bill number is needed.' } };
  const { accessToken, myEmail } = await connect();
  const found = await findBcoThread(accessToken, bill, myEmail);
  if (!found) return { status: 404, body: { error: `No "BCO Load Detail" email for freight bill ${bill} found in Gmail.` } };
  const { id: threadId, messages } = found;
  const recipients = buildDriverRecipients(messages[0], myEmail);
  if (action === 'driverThread') {
    // Replies on every BCO email for this freight bill, each with the thread it is in. The first
    // email counts too when the driver wrote it (a driver forwarding the BCO email with the BOL);
    // Daniel's own dispatch emails are left out by findDriverReplies.
    const replies = found.all.flatMap(thread => findDriverReplies(thread.messages, myEmail, Date.parse(since) || 0)
      .map(reply => ({ ...reply, threadId: thread.id })));
    return { status: 200, body: { threadId, ...recipients, replies: replies.sort((a, b) => a.at.localeCompare(b.at)) } };
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

// ---------- Paperwork (POD) from the driver -> the customer's tracking thread ----------
// Files a driver attaches when answering in the BCO thread: PDFs and photos/scans. Tiny
// images (email signature logos) are left out.
const PAPERWORK_FILE = /\.(pdf|jpe?g|png|heic|heif|tiff?|gif|webp)$/i;
export function findPaperworkParts(payload) {
  const parts = [];
  const walk = part => { if (part) { parts.push(part); (part.parts || []).forEach(walk); } };
  walk(payload);
  return parts.filter(part => PAPERWORK_FILE.test(part.filename || '') && part.body?.attachmentId
    && (/\.pdf$/i.test(part.filename) || Number(part.body.size || 0) >= 20000));
}

// Every paperwork file the driver sent on any BCO thread for the freight bill since `since`.
async function findDriverPaperwork(accessToken, myEmail, freightBill, since) {
  const found = await findBcoThread(accessToken, freightBill, myEmail);
  if (!found) return [];
  const files = [];
  for (const thread of found.all) {
    for (const reply of findDriverReplies(thread.messages, myEmail, Date.parse(since) || 0)) {
      const full = await gmailJson(accessToken, `${GMAIL}/messages/${encodeURIComponent(reply.id)}?format=full`);
      findPaperworkParts(full.payload).forEach(part => files.push({
        messageId: reply.id, attachmentId: part.body.attachmentId, filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream', size: Number(part.body.size || 0), at: reply.at, from: reply.from
      }));
    }
  }
  return files.sort((a, b) => a.at.localeCompare(b.at));
}

// A reply-all with files attached (multipart/mixed); files: [{ filename, mimeType, data (base64) }].
export function buildReplyWithAttachments({ to, cc, subject, inReplyTo, references, text, files = [] }) {
  const boundary = `pod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const replySubject = /^re:/i.test(subject) ? subject : `RE: ${subject}`;
  const encodeName = name => `=?UTF-8?B?${Buffer.from(oneLine(name), 'utf8').toString('base64')}?=`;
  const wrap = value => String(value).replace(/.{1,76}/g, '$&\r\n').trimEnd();
  const headers = [
    `To: ${to.map(oneLine).join(', ')}`,
    cc.length ? `Cc: ${cc.map(oneLine).join(', ')}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(oneLine(replySubject), 'utf8').toString('base64')}?=`,
    inReplyTo ? `In-Reply-To: ${oneLine(inReplyTo)}` : null,
    inReplyTo || references ? `References: ${oneLine([references, inReplyTo].filter(Boolean).join(' '))}` : null,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`
  ].filter(Boolean);
  const parts = [
    [`--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
      wrap(Buffer.from(String(text || ''), 'utf8').toString('base64'))].join('\r\n'),
    ...files.map(file => [`--${boundary}`,
      `Content-Type: ${oneLine(file.mimeType || 'application/octet-stream')}; name="${encodeName(file.filename)}"`,
      `Content-Disposition: attachment; filename="${encodeName(file.filename)}"`,
      'Content-Transfer-Encoding: base64', '', wrap(file.data)].join('\r\n'))
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--`;
}

// The customer's tracking thread for the load: Paramount's rate confirmation thread, or the
// newest RXO "Update Request" thread for the order.
async function findTrackingThread(accessToken, target, orderNumber) {
  if (target === 'paramount') {
    const found = await findThread(accessToken, orderNumber);
    return found ? { id: found.threadId, messages: found.messages } : null;
  }
  const query = `from:rxo.com subject:"Update Request" "${orderNumber}" newer_than:30d`;
  const list = await gmailJson(accessToken, `${GMAIL}/threads?q=${encodeURIComponent(query)}&maxResults=5`);
  for (const { id } of list.threads || []) {
    const thread = await gmailJson(accessToken, `${GMAIL}/threads/${encodeURIComponent(id)}?format=metadata${THREAD_HEADERS}`);
    const messages = (thread.messages || []).sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    if (messages.length && parseRxoRequestSubject(header(messages[0], 'Subject')) === orderNumber) return { id: thread.id, messages };
  }
  return null;
}

const MAX_PAPERWORK_BYTES = 20 * 1024 * 1024; // Gmail's limit is 25 MB per email

// Sends a full email (with attachments) through Gmail's upload endpoint, inside the thread.
export function buildUploadBody(raw, threadId, boundary = `up_${Date.now().toString(36)}`) {
  const body = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ threadId }),
    `--${boundary}`, 'Content-Type: message/rfc822', '', raw, `--${boundary}--`, ''
  ].join('\r\n');
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}
async function sendLargeMessage(accessToken, raw, threadId) {
  const { body, contentType } = buildUploadBody(raw, threadId);
  const response = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': contentType }, body
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `Gmail could not send the paperwork (HTTP ${response.status})`);
  return result;
}

async function handlePaperwork({ action, freightBill, since, orderNumber, target, text }) {
  const bill = String(freightBill || '').trim();
  if (!/^\d{5,}$/.test(bill)) return { status: 400, body: { error: 'A Landstar freight bill number is needed.' } };
  const { accessToken, myEmail } = await connect();
  const files = await findDriverPaperwork(accessToken, myEmail, bill, since);
  if (action === 'driverPaperwork') return { status: 200, body: { files } };
  // sendPaperwork: reply-all on the customer's tracking thread with the driver's files.
  const order = String(orderNumber || '').trim();
  if (!/^\d{4,}$/.test(order) || !['paramount', 'rxo'].includes(target)) return { status: 400, body: { error: 'Which customer thread to send the paperwork to is missing.' } };
  if (!files.length) return { status: 404, body: { error: `No paperwork from the driver for freight bill ${bill} in Gmail.` } };
  const thread = await findTrackingThread(accessToken, target, order);
  if (!thread) return { status: 404, body: { error: `No ${target === 'rxo' ? 'RXO update-request' : 'Paramount rate confirmation'} email for order ${order}: send the paperwork by hand.` } };
  const replyAll = buildReplyAll(thread.messages, myEmail);
  const recipients = target === 'rxo' ? withRxoAlwaysCc(replyAll) : replyAll;
  if (!recipients.to.length) return { status: 409, body: { error: 'Nobody to reply to on the customer email thread.' } };
  let total = 0;
  const attachments = [];
  for (const file of files) {
    const attachment = await gmailJson(accessToken, `${GMAIL}/messages/${encodeURIComponent(file.messageId)}/attachments/${encodeURIComponent(file.attachmentId)}`);
    const data = Buffer.from(String(attachment.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    total += data.length;
    if (total > MAX_PAPERWORK_BYTES) return { status: 413, body: { error: 'The paperwork files are too big for one email (over 20 MB): send them by hand.' } };
    attachments.push({ filename: file.filename, mimeType: file.mimeType, data: data.toString('base64') });
  }
  const latest = thread.messages[thread.messages.length - 1];
  const raw = buildReplyWithAttachments({
    to: recipients.to, cc: recipients.cc, subject: header(thread.messages[0], 'Subject'),
    inReplyTo: header(latest, 'Message-ID'), references: header(latest, 'References'),
    text: String(text || '').trim(), files: attachments
  });
  // Phone photos are big (10 MB+): Gmail's upload endpoint takes up to 35 MB, the plain one doesn't.
  const sent = await sendLargeMessage(accessToken, raw, thread.id);
  return { status: 200, body: { ok: true, id: sent.id, threadId: thread.id, files: files.map(file => file.filename), ...recipients } };
}

// Freight bills Daniel dispatched in the last few days (from "BCO Load Detail" subjects),
// newest first. The bot looks these up in Clarity when a booked load's truck isn't in
// Clarity's freight list yet.
async function listBcoBills() {
  const { accessToken } = await connect();
  const query = 'subject:"BCO Load Detail for" newer_than:5d';
  const list = await gmailJson(accessToken, `${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=30`);
  const bills = [];
  for (const { id } of list.messages || []) {
    const message = await gmailJson(accessToken, `${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject`);
    const bill = parseBcoSubject(header(message, 'Subject'));
    if (bill && !bills.includes(bill)) bills.push(bill);
  }
  return { status: 200, body: { bills: bills.slice(0, 20) } };
}

// ---------- Trucker Tools "Load Track has been started" (Paramount) ----------
// noreply@truckertools.com sends "TT App - Load Track has been started - Load Number: 2282980"
// once the driver starts tracking in the app. The load number is Paramount's order number.
export function parseTruckerToolsSubject(subject) {
  return String(subject || '').match(/Load Track has been started\b\D*?Load Number:?\s*#?\s*(\d{5,})/i)?.[1] || '';
}

// Every "tracking started" email of the last two weeks: [{ loadNumber, at }], the first one per load.
async function listTruckerToolsStarts() {
  const { accessToken } = await connect();
  const query = 'from:noreply@truckertools.com subject:"Load Track has been started" newer_than:14d';
  const list = await gmailJson(accessToken, `${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=60`);
  const starts = {};
  for (const { id } of list.messages || []) {
    const message = await gmailJson(accessToken, `${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject`);
    const loadNumber = parseTruckerToolsSubject(header(message, 'Subject'));
    const at = new Date(Number(message.internalDate)).toISOString();
    if (loadNumber && (!starts[loadNumber] || at < starts[loadNumber].at)) starts[loadNumber] = { loadNumber, at, messageId: message.id };
  }
  return { status: 200, body: { starts: Object.values(starts) } };
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

// ---------- Broker prospects (new-customer outreach) ----------
// "prospectSend": one fresh email (new thread) to a broker found on DAT.
// "prospectReplies": the newest reply from each given address since `since`,
// so the TMS Prospects panel can mark leads that answered.
async function handleProspectEmail(request) {
  const { action, to, subject, text, addresses, since } = request;
  const { accessToken } = await connect();
  if (action === 'prospectSend') {
    const address = emailOf(to);
    if (!address.includes('@')) return { status: 400, body: { error: 'A valid prospect email address is needed.' } };
    const body = String(text || '').trim();
    if (!body || body.length > 20000) return { status: 400, body: { error: 'The email text is empty or too long.' } };
    const encodedSubject = `=?UTF-8?B?${Buffer.from(oneLine(subject) || 'Truck capacity - Landstar agent MC# 166960', 'utf8').toString('base64')}?=`;
    const headers = [
      `To: ${oneLine(to)}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64'
    ];
    const raw = `${headers.join('\r\n')}\r\n\r\n${Buffer.from(body, 'utf8').toString('base64')}`;
    const sent = await gmailJson(accessToken, `${GMAIL}/messages/send`, {
      method: 'POST', body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') })
    });
    return { status: 200, body: { ok: true, id: sent.id, threadId: sent.threadId } };
  }
  const list = [...new Set((Array.isArray(addresses) ? addresses : []).map(emailOf).filter(item => item.includes('@')))].slice(0, 200);
  if (!list.length) return { status: 200, body: { replies: [] } };
  const sinceMs = Date.parse(since) || 0;
  const replies = {};
  for (let start = 0; start < list.length; start += 20) {
    const batch = list.slice(start, start + 20);
    const query = `from:(${batch.join(' OR ')}) newer_than:30d`;
    const found = await gmailJson(accessToken, `${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=50`);
    for (const { id } of found.messages || []) {
      const message = await gmailJson(accessToken, `${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      if (Number(message.internalDate) <= sinceMs) continue;
      const from = emailOf(header(message, 'From'));
      if (!batch.includes(from)) continue;
      const at = new Date(Number(message.internalDate)).toISOString();
      if (replies[from] && replies[from].at >= at) continue;
      replies[from] = {
        from, at, subject: header(message, 'Subject'), id: message.id, threadId: message.threadId,
        snippet: String(message.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, 300)
      };
    }
  }
  return { status: 200, body: { replies: Object.values(replies) } };
}

// action "thread": who a reply-all goes to, plus replies from others since `since`.
// action "send": reply-all inside the thread with `text`.
// action "rxoRequests" / "rxoSend": RXO update requests (see handleRxoEmail).
export async function handleParamountEmail(request = {}) {
  const { action, orderNumber, since, text } = request;
  if (action === 'prospectSend' || action === 'prospectReplies') return handleProspectEmail(request);
  if (action === 'rxoRequests' || action === 'rxoSend') return handleRxoEmail(request);
  if (action === 'driverThread' || action === 'driverSend') return handleDriverEmail(request);
  if (action === 'driverPaperwork' || action === 'sendPaperwork') return handlePaperwork(request);
  if (action === 'fuelRates') return findFuelEmail();
  if (action === 'bcoBills') return listBcoBills();
  if (action === 'truckerToolsStarts') return listTruckerToolsStarts();
  const order = String(orderNumber || '').trim();
  if (!/^\d{4,}$/.test(order)) return { status: 400, body: { error: 'A Paramount order number is needed.' } };
  const { accessToken, myEmail } = await connect();
  const found = await findThread(accessToken, order);
  if (!found) return { status: 404, body: { error: `No "Rate Confirmation for order: ${order}" email found in Gmail.` } };
  const { threadId, messages } = found;
  const recipients = buildReplyAll(messages, myEmail);
  const subject = header(messages[0], 'Subject');
  if (action === 'rateConPdf') {
    // The newest PDF attached in the thread (Paramount's "has been Accepted" email: semail.pdf).
    for (const message of [...messages].reverse()) {
      const full = await gmailJson(accessToken, `${GMAIL}/messages/${encodeURIComponent(message.id)}?format=full`);
      const parts = [];
      const walk = part => { if (part) { parts.push(part); (part.parts || []).forEach(walk); } };
      walk(full.payload);
      const pdf = parts.find(part => /\.pdf$/i.test(part.filename || '') && part.body?.attachmentId);
      if (!pdf) continue;
      const attachment = await gmailJson(accessToken, `${GMAIL}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(pdf.body.attachmentId)}`);
      const data = Buffer.from(String(attachment.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('base64');
      return { status: 200, body: { filename: pdf.filename, messageId: message.id, data } };
    }
    return { status: 404, body: { error: `No PDF in the "Rate Confirmation for order: ${order}" emails yet.` } };
  }
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
