import assert from 'node:assert/strict';
import test from 'node:test';
import { processReadScreenshot } from './read-screenshot.js';

const getClient = () => ({ auth: { getUser: async token => (token === 'good' ? { data: { user: { id: 'u1' } }, error: null } : { data: null, error: new Error('bad') }) } });
const read = async request => ({ status: 200, body: { loads: [], unreadable: '', got: request } });
const request = extra => ({ method: 'POST', authorization: 'Bearer good', body: { images: [{ data: 'x', mediaType: 'image/jpeg' }], instructions: 'Rate is last', customer: 'Acme' }, ...extra });

test('website AI screenshots: signed-in TMS users only, and only with the key set up', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal((await processReadScreenshot(request(), { getClient, read })).status, 503, 'no key on the website yet');
    process.env.ANTHROPIC_API_KEY = 'test';
    assert.equal((await processReadScreenshot(request({ authorization: '' }), { getClient, read })).status, 401);
    assert.equal((await processReadScreenshot(request({ authorization: 'Bearer nope' }), { getClient, read })).status, 401);
    assert.equal((await processReadScreenshot(request({ method: 'GET' }), { getClient, read })).status, 405);
    assert.equal((await processReadScreenshot(request({ body: { images: [] } }), { getClient, read })).status, 400);
    const ok = await processReadScreenshot(request(), { getClient, read });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.got.instructions, 'Rate is last');
    const many = await processReadScreenshot(request({ body: { images: Array(9).fill({ data: 'x' }) } }), { getClient, read });
    assert.equal(many.body.got.images.length, 6, 'at most 6 pictures per read');
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;
  }
});
