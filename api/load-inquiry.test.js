import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoadInquiryHandler } from './load-inquiry.js';

const TOKEN = 'abcDEF1234567890abcdef';

// Minimal in-memory stand-in for the Supabase query builder used by the endpoint.
function fakeSupabase(tables) {
  return {
    from(table) {
      const rows = tables[table];
      const filters = [];
      let op = 'select';
      let payload = null;
      let head = false;
      const matching = () => rows.filter(row => filters.every(f => f(row)));
      const builder = {
        select(_cols, opts) { if (op === 'select') head = Boolean(opts?.head); return builder; },
        eq(col, val) { filters.push(row => row[col] === val); return builder; },
        gte(col, val) { filters.push(row => row[col] >= val); return builder; },
        insert(row) {
          op = 'insert';
          payload = { id: `id${rows.length + 1}`, created_at: new Date().toISOString(), ...row };
          rows.push(payload);
          return builder;
        },
        update(changes) { op = 'update'; payload = changes; return builder; },
        async maybeSingle() { return { data: matching()[0] || null, error: null }; },
        async single() { return { data: op === 'insert' ? payload : matching()[0], error: null }; },
        then(resolve) {
          if (op === 'update') {
            matching().forEach(row => Object.assign(row, payload));
            return resolve({ error: null });
          }
          return resolve(head ? { count: matching().length, error: null } : { data: matching(), error: null });
        }
      };
      return builder;
    }
  };
}

function setup({ connected = true } = {}) {
  const tables = {
    load_inquiry_links: [{
      token: TOKEN,
      owner_id: 'owner-1',
      owner_email: 'me@example.com',
      customer: 'Para 1522166 - ATZ',
      load_id: '24552929',
      active: true,
      details: { ref: '24552929', origin: 'ELK GROVE VILLAGE, IL', destination: 'MANSFIELD, TX', rate: '$3,175', secretNote: 'do not show' }
    }],
    load_inquiries: [],
    gmail_connection: connected ? [{ id: 1, email: 'gmail@example.com', refresh_token: 'refresh' }] : []
  };
  const sent = [];
  const handler = createLoadInquiryHandler({
    getClient: () => fakeSupabase(tables),
    getToken: async () => 'access',
    send: async (_token, message) => { sent.push(message); }
  });
  return { tables, sent, handler };
}

async function call(handler, req) {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler({ headers: { host: 'tms.example.com' }, query: {}, ...req }, res);
  return res;
}

const validInquiry = {
  t: TOKEN, name: 'Joe Driver', phone: '(555) 123-4567', mcOrTruck: 'MC 123456', message: 'Empty in Joliet, can load today'
};

test('GET returns only the public load fields', async () => {
  const { handler } = setup();
  const res = await call(handler, { method: 'GET', query: { t: TOKEN } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.load.origin, 'ELK GROVE VILLAGE, IL');
  assert.equal(res.body.load.secretNote, undefined);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('unknown or malformed links are not found', async () => {
  const { handler } = setup();
  assert.equal((await call(handler, { method: 'GET', query: { t: 'nope' } })).statusCode, 404);
  assert.equal((await call(handler, { method: 'GET', query: { t: 'x'.repeat(22) } })).statusCode, 404);
});

test('POST saves the inquiry and emails the link owner', async () => {
  const { handler, tables, sent } = setup();
  const res = await call(handler, { method: 'POST', body: validInquiry });
  assert.equal(res.statusCode, 200);
  assert.equal(tables.load_inquiries.length, 1);
  const saved = tables.load_inquiries[0];
  assert.equal(saved.owner_id, 'owner-1');
  assert.equal(saved.load_id, '24552929');
  assert.equal(saved.driver_name, 'Joe Driver');
  assert.equal(saved.notified, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'me@example.com');
  assert.match(sent[0].subject, /Load #24552929 ELK GROVE VILLAGE, IL → MANSFIELD, TX/);
  assert.match(sent[0].text, /Phone: \(555\) 123-4567/);
  assert.match(sent[0].text, /Customer: Para 1522166 - ATZ/);
});

test('POST requires a name and a 10-digit phone, and drops bot submissions', async () => {
  const { handler, tables } = setup();
  assert.equal((await call(handler, { method: 'POST', body: { ...validInquiry, name: ' ' } })).statusCode, 400);
  assert.equal((await call(handler, { method: 'POST', body: { ...validInquiry, phone: '12345' } })).statusCode, 400);
  const bot = await call(handler, { method: 'POST', body: { ...validInquiry, website: 'http://spam' } });
  assert.equal(bot.statusCode, 200);
  assert.equal(tables.load_inquiries.length, 0);
});

test('POST is limited to 10 inquiries per load per hour', async () => {
  const { handler } = setup();
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await call(handler, { method: 'POST', body: validInquiry })).statusCode, 200);
  }
  assert.equal((await call(handler, { method: 'POST', body: validInquiry })).statusCode, 429);
});

test('inquiry is still saved when Gmail is not connected, with the reason recorded', async () => {
  const { handler, tables, sent } = setup({ connected: false });
  const res = await call(handler, { method: 'POST', body: validInquiry });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 0);
  assert.equal(tables.load_inquiries[0].notified, false);
  assert.match(tables.load_inquiries[0].notify_error, /Gmail is not connected/);
});
