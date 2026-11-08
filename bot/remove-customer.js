// Removes every bulk-uploaded posting under your own codes whose Landstar customer name
// matches the given text (e.g. "RXO"). Hand-posted and protected loads are left alone.
// Report only unless --apply. Stop the bot first: this uses its browser profile.
//   node remove-customer.js RXO [--apply] [--out report.json]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { listPostings, cancelPostings, protectedLoadIds } = require('./dedupe');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');

(async () => {
  const args = process.argv.slice(2);
  const name = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');
  if (!name) throw new Error('Usage: node remove-customer.js <customer name> [--apply] [--out report.json]');
  const apply = args.includes('--apply');
  const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const board = await openBoard(browser, console.log);
  const postings = await listPostings(board, OWN_POSTING_CODES, console.log);
  const bulk = postings.filter(p => p.SourceSystemID === 'PORTAL');
  console.log(`${postings.length} postings under ${OWN_POSTING_CODES.join(', ')}; ${bulk.length} bulk-uploaded. Reading customers...`);

  const portal = await browser.newPage();
  await portal.goto('https://portal.landstaronline.com/agent', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await portal.waitForURL(/portal\.landstaronline\.com\/agent/, { timeout: 60000 }).catch(() => {});
  await portal.waitForTimeout(6000);
  const details = await portal.evaluate(async ids => {
    let token = null;
    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (/oidc\.user/i.test(key)) { try { token = JSON.parse(store.getItem(key)).access_token; } catch { /* next */ } }
      }
    }
    if (!token) throw new Error('Not signed in to the Landstar portal');
    const out = [];
    for (let i = 0; i < ids.length; i += 10) {
      out.push(...await Promise.all(ids.slice(i, i + 10).map(async id => {
        const r = await fetch(`/loadboards/v1/availableLoad/agent/PORTAL/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await r.json().catch(() => ({}));
        return { id, customerNumber: body?.data?.customerNumber, customerName: body?.data?.customerName };
      })));
    }
    return out;
  }, [...new Set(bulk.map(p => p.LoadId))]);

  const byCustomer = {};
  details.forEach(d => { const k = `${d.customerName || '?'} (${d.customerNumber || '?'})`; byCustomer[k] = (byCustomer[k] || 0) + 1; });
  console.log('Bulk postings by customer:');
  Object.entries(byCustomer).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${n}\t${k}`));

  const protectedIds = protectedLoadIds();
  // Landstar spells some names with spaces ("R X O CAPACITY"), so also match with spaces removed,
  // or by customer number.
  const matches = details.filter(d => pattern.test(String(d.customerName || ''))
    || pattern.test(String(d.customerName || '').replace(/[\s.]/g, ''))
    || String(d.customerNumber || '') === name);
  const targets = matches.filter(d => !protectedIds.has(String(d.id)));
  const unknown = details.filter(d => !d.customerName).length;
  console.log(`Matching "${name}": ${matches.length}; protected: ${matches.length - targets.length}; customer unreadable: ${unknown}.`);
  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify(targets.map(d => {
      const p = bulk.find(x => x.LoadId === d.id) || {};
      return { loadId: d.id, customer: d.customerName, lane: `${p.OriginCityStateForDisplay} -> ${p.DestinationCityStateForDisplay}`, pickup: p.PickupFromDateForDisplay, rate: p.TotalRevenue };
    }), null, 2));
  }

  if (apply && targets.length) {
    const removed = await cancelPostings(portal, targets.map(d => d.id), console.log);
    console.log(`Removed ${removed} of ${targets.length}.`);
    const after = await listPostings(board, OWN_POSTING_CODES, console.log);
    const left = new Set(after.map(p => p.LoadId));
    console.log(`Still on the board: ${targets.filter(d => left.has(d.id)).length} of the ${targets.length}.`);
  } else {
    console.log(`${targets.length} posting(s) to remove${apply ? '' : ' (report only)'}.`);
  }
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
