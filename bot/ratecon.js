// Paramount's rate confirmation ("Load Confirmation", semail.pdf): a scanned PDF attached to
// the "...Rate Confirmation for order: <order#> has been Accepted" email. The bot gets it from
// Gmail through the local TMS server, renders page 1 with pdf.js in its own browser, reads the
// text with tesseract (the same engine the TMS uses for screenshots) and pulls out what goes
// into MercuryGate.

const fs = require('fs');
const path = require('path');

const TMS_EMAIL_URL = 'http://127.0.0.1:5173/api/paramount-email';
const RATECON_DIR = path.join(__dirname, 'ratecons');
const ROOT = path.join(__dirname, '..');

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const hhmm = value => (/^\d{4}$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : value);
// 3001098403 -> 300-109-8403 (how Daniel writes BOL numbers in MercuryGate).
const dashed = value => (/^\d{10}$/.test(value) ? `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}` : value);

// One stop block ("PU1 Name: ... Date: 11/07/2026 1400 / Address: ... 11/07/2026 2345 /
// Martinsburg WV 25403 Driver Load: ...").
function parseStop(block) {
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
  const nameLine = lines.find(line => /Name:/i.test(line)) || '';
  const addressIndex = lines.findIndex(line => /Address:/i.test(line));
  const addressLine = lines[addressIndex] || '';
  const cityLine = lines.slice(addressIndex + 1).find(line => /\b[A-Z]{2}\s+\d{5}\b/.test(line)) || '';
  // OCR sometimes reads "/" as 7 or 1 ("11/09/2026" -> "1170972026"); dates are MM/DD/YYYY.
  const DATE = String.raw`(\d{2}[\/71|]\d{2}[\/71|]20\d{2}|\d{1,2}\/\d{1,2}\/\d{4})`;
  const start = nameLine.match(new RegExp(String.raw`Date:\s*${DATE}\s+(\d{4})`, 'i'));
  const end = addressLine.match(new RegExp(String.raw`${DATE}\s+(\d{4})\s*$`));
  const fixDate = text => {
    const plain = String(text).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (plain) return text;
    const ocr = String(text).match(/^(\d{2}).(\d{2}).(\d{4})$/);
    return ocr ? `${ocr[1]}/${ocr[2]}/${ocr[3]}` : text;
  };
  if (start) start[1] = fixDate(start[1]);
  if (end) end[1] = fixDate(end[1]);
  const place = cityLine.match(/^(.*?)\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
  return {
    name: clean(nameLine.replace(/^.*?Name:\s*/i, '').replace(/\s*Date:.*$/i, '').replace(/[-–—]+\s*$/, '')),
    address: clean(addressLine.replace(/^.*?Address:\s*/i, '').replace(/\s*\d{1,2}\/\d{1,2}\/\d{4}\s+\d{4}\s*$/, '')),
    city: clean(place?.[1]),
    state: place?.[2] || '',
    zip: place?.[3] || '',
    early: start ? { date: start[1], time: hhmm(start[2]) } : null,
    late: end ? { date: end[1], time: hhmm(end[2]) } : (start ? { date: start[1], time: hhmm(start[2]) } : null)
  };
}

// What MercuryGate needs from the confirmation text, or { error }.
function parseParamountRateCon(text) {
  const value = String(text || '').replace(/\r/g, '');
  const order = value.match(/Order:\s*(\d{6,})/i)?.[1] || value.match(/Load Confirmation\s+(\d{6,})/i)?.[1] || '';
  // Same line only: an empty "Reference:" must not pick up the next line's words.
  const bol = value.match(/BOL:[ \t]*([A-Z0-9-]{4,})/i)?.[1] || '';
  const reference = value.match(/Reference:[ \t]*[^A-Za-z0-9\n]*?(\d[A-Z0-9-]{3,})/i)?.[1] || '';
  // Stop blocks start with PU1 / SO2 (OCR may read SO as S0 or 50).
  const starts = [...value.matchAll(/^\s*(PU|SO|S0|50)\s*(\d)\b/gim)].map(match => ({ index: match.index, kind: /PU/i.test(match[1]) ? 'pickup' : 'drop' }));
  const stops = starts.map((start, i) => ({ kind: start.kind, ...parseStop(value.slice(start.index, starts[i + 1]?.index ?? value.search(/^\s*\w*ayment\b|^\s*Special Instructions/im) >>> 0)) }));
  const pickup = stops.find(stop => stop.kind === 'pickup');
  const drop = [...stops].reverse().find(stop => stop.kind === 'drop');
  const missing = [];
  if (!order) missing.push('order number');
  if (!pickup?.name || !pickup?.zip || !pickup?.early) missing.push('pickup');
  if (!drop?.name || !drop?.zip || !drop?.early) missing.push('delivery');
  if (missing.length) return { error: `Could not read the ${missing.join(', ')} on the rate confirmation.`, order, bol, reference, pickup, drop };
  const comments = [bol ? `BOL number ${dashed(bol)}` : '', reference ? `reference number ${reference}` : ''].filter(Boolean).join('\n');
  return { order, bol, reference, pickup: { ...pickup, comments }, drop: { ...drop, comments: '' } };
}

// The PDF from Gmail (through the local TMS server). Saves it under bot/ratecons/<order>.pdf.
async function downloadRateCon(orderNumber) {
  const response = await fetch(TMS_EMAIL_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'rateConPdf', orderNumber: String(orderNumber) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.data) throw new Error(result.error || `Could not get the rate confirmation PDF (HTTP ${response.status}).`);
  fs.mkdirSync(RATECON_DIR, { recursive: true });
  const file = path.join(RATECON_DIR, `${orderNumber}.pdf`);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  return file;
}

// Renders page 1 of a PDF to PNG with pdf.js inside the bot's browser (served from
// node_modules through a fake address, so no files are opened from disk by the page).
async function renderFirstPage(context, pdfFile) {
  const page = await context.newPage();
  const pdfjsDir = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
  try {
    await page.route('https://pdfjs.local/**', route => {
      const name = route.request().url().split('/').pop();
      route.fulfill({ path: path.join(pdfjsDir, name), contentType: 'text/javascript' });
    });
    await page.route('https://pdfjs.local/', route => route.fulfill({ contentType: 'text/html', body: '<canvas id="c"></canvas>' }));
    await page.goto('https://pdfjs.local/');
    const dataUrl = await page.evaluate(async b64 => {
      const pdfjs = await import('https://pdfjs.local/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://pdfjs.local/pdf.worker.mjs';
      const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data }).promise;
      const first = await doc.getPage(1);
      const viewport = first.getViewport({ scale: 3 }) // higher resolution: fewer misread dates and words;
      const canvas = document.getElementById('c');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await first.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return canvas.toDataURL('image/png');
    }, fs.readFileSync(pdfFile).toString('base64'));
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  } finally {
    await page.close().catch(() => {});
  }
}

async function ocr(png) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { langPath: ROOT, gzip: false, cachePath: path.join(__dirname, '.tesseract-cache') });
  try {
    return (await worker.recognize(png)).data.text;
  } finally {
    await worker.terminate();
  }
}

// Everything in one go: { order, bol, reference, pickup, drop, pdfFile } or { error }.
async function readRateConfirmation(context, orderNumber) {
  const pdfFile = await downloadRateCon(orderNumber);
  const text = await ocr(await renderFirstPage(context, pdfFile));
  const parsed = parseParamountRateCon(text);
  if (!parsed.error && parsed.order !== String(orderNumber)) {
    return { error: `The rate confirmation is for order ${parsed.order}, not ${orderNumber}.`, pdfFile };
  }
  return { ...parsed, pdfFile };
}

module.exports = { parseParamountRateCon, readRateConfirmation, downloadRateCon, renderFirstPage };
