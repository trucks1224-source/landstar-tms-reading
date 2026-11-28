// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { findNtgCardRegions } from '../lib/ntgCards.js';
import { parseNtgScreenshotLines, findChHeaders, getChColumnBounds, parseChScreenshotLines } from './screenshotParsers.js';

async function readCanvasStrip(worker, canvas, x0, y0, x1, y1, pattern, thresholds = [150, 110, 190, 0]) {
  const left = Math.max(0, Math.round(x0));
  const top = Math.max(0, Math.round(y0));
  const width = Math.min(canvas.width, Math.round(x1)) - left;
  const height = Math.min(canvas.height, Math.round(y1)) - top;
  if (width < 4 || height < 4) return '';
  for (const threshold of thresholds) {
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = width * 2 + 64;
    cropCanvas.height = height * 2 + 64;
    const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
    cropContext.fillStyle = '#fff';
    cropContext.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropContext.drawImage(canvas, left, top, width, height, 32, 32, width * 2, height * 2);
    if (threshold) {
      const pixels = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const luminance = pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114;
        const value = luminance < threshold ? 0 : 255;
        pixels.data[offset] = value;
        pixels.data[offset + 1] = value;
        pixels.data[offset + 2] = value;
        pixels.data[offset + 3] = 255;
      }
      cropContext.putImageData(pixels, 0, 0);
    }
    const { data: stripData } = await worker.recognize(cropCanvas);
    const found = stripData.text.match(pattern)?.[0];
    if (found) return found;
  }
  return '';
}

// Picks the most common digit at each position across several OCR readings of one load number.
function voteNtgLoadNumber(candidates) {
  const readings = candidates.filter(candidate => /^\d{7}$/.test(candidate));
  if (!readings.length) return null;
  const value = Array.from({ length: 7 }, (_, position) => {
    const counts = {};
    readings.forEach(reading => { counts[reading[position]] = (counts[reading[position]] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }).join('').replace(/^0/, '9');
  return { value, unanimous: readings.length >= 2 && readings.every(reading => reading === value) };
}

// Re-reads the small parts of one cropped NTG/Beon load card that full-card OCR tends to miss.
async function fillMissingNtgCardDetails(worker, canvas, lines) {
  const W = canvas.width;
  const H = canvas.height;
  const words = lines.flatMap(line => line.words || [])
    .map(word => ({ text: String(word.text || '').trim(), ...word.bbox }))
    .filter(word => word.text);
  const add = (text, x0, y0, x1, y1) => lines.push({ text, bbox: { x0, y0, x1, y1 }, words: [{ text, bbox: { x0, y0, x1, y1 } }] });
  const find = pattern => words.find(word => pattern.test(word.text));
  const allText = words.map(word => word.text).join(' ');
  const milesWord = words.find(word => /miles?$/i.test(word.text) && word.x0 > W * 0.15 && word.x1 < W * 0.65);
  const totalLabel = words.find(word => /^total$/i.test(word.text) && word.x0 > W * 0.6);
  const weightLabel = words.find(word => /^w\w{2,4}t$/i.test(word.text) && word.x0 > W * 0.6);
  const label = totalLabel || weightLabel;
  const labelHeight = label ? label.y1 - label.y0 : H * 0.08;
  const valueTop = label ? label.y1 + labelHeight * 0.2 : H * 0.35;
  const valueBottom = label ? label.y1 + labelHeight * 3 : H * 0.75;

  await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789,.$' });
  const idCandidates = words.filter(word => word.x0 < W * 0.2 && /^\d{7}$/.test(word.text)).map(word => word.text);
  for (const threshold of [0, 150, 110, 190, 130, 170]) {
    const reading = await readCanvasStrip(worker, canvas, 0, 0, W * 0.08, H, /\d{7}/, [threshold]);
    if (reading) idCandidates.push(reading.slice(0, 7));
  }
  const loadNumber = voteNtgLoadNumber(idCandidates);
  if (loadNumber) {
    const text = loadNumber.value;
    lines.unshift({ text, bbox: { x0: W * 0.01, y0: H * 0.45, x1: W * 0.05, y1: H * 0.5 }, words: [{ text, bbox: { x0: W * 0.01, y0: H * 0.45, x1: W * 0.05, y1: H * 0.5 } }] });
    if (!loadNumber.unanimous) lines.ntgIdUncertain = true;
  }
  const statsLeft = W * 0.67;
  if (!words.some(word => word.x0 > statsLeft && /^\$\s*[\d,]+(\.\d+)?$/.test(word.text))) {
    const rateLeft = totalLabel ? totalLabel.x0 - W * 0.01 : W * 0.765;
    const rateText = await readCanvasStrip(worker, canvas, rateLeft, valueTop, rateLeft + W * 0.075, valueBottom, /\d[\d,]*\.\d{2}/);
    if (rateText) add(`$${rateText}`, rateLeft + W * 0.01, (valueTop + valueBottom) / 2 - 4, rateLeft + W * 0.06, (valueTop + valueBottom) / 2 + 4);
  }
  if (!words.some(word => word.x0 > statsLeft && /^(\d{1,3}(,\d{3})+|\d{2,6})(\.\d+)?$/.test(word.text))) {
    const weightLeft = weightLabel ? weightLabel.x0 - W * 0.02 : W * 0.69;
    const weightRight = totalLabel ? totalLabel.x0 - W * 0.01 : W * 0.765;
    const weightText = await readCanvasStrip(worker, canvas, weightLeft, valueTop, weightRight, valueBottom, /\d{1,3}(,\d{3})+(\.\d+)?|\d{2,6}(\.\d+)?/);
    if (weightText) add(weightText, weightLeft + W * 0.01, (valueTop + valueBottom) / 2 - 4, weightRight - W * 0.01, (valueTop + valueBottom) / 2 + 4);
  }

  await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
  if (!/van|reefer|flat|truck|sprinter|hot\s*shot|step|conestoga/i.test(allText)) {
    const lineHeight = milesWord ? milesWord.y1 - milesWord.y0 : H * 0.08;
    const top = milesWord ? milesWord.y0 - lineHeight * 3.4 : 0;
    const bottom = milesWord ? milesWord.y0 - lineHeight * 0.3 : H * 0.5;
    const equipment = await readCanvasStrip(worker, canvas, W * 0.2, top, W * 0.52, bottom, /[\w /]*(van|reefer|flat\s*bed|truck|sprinter|hot\s*shot)[\w /]*/i);
    const centerX = milesWord ? (milesWord.x0 + milesWord.x1) / 2 : W * 0.37;
    if (equipment) add(equipment.trim(), centerX - 4, top, centerX + 4, bottom);
  }
  if (!/haz|\b\w{1,2}zmat\b/i.test(allText)) {
    const tagText = await readCanvasStrip(worker, canvas, 0, H * 0.7, W * 0.35, H, /.*(haz|tank).*/is);
    const tags = [/haz/i.test(tagText) && 'Hazmat', /tank/i.test(tagText) && 'Tanker'].filter(Boolean);
    if (tags.length) add(tags.join(' '), W * 0.01, H * 0.9, W * 0.1, H * 0.95);
  }
}

async function readNtgScreenshotCards(worker, image, onProgress) {
  const analysis = document.createElement('canvas');
  analysis.width = image.naturalWidth || image.width;
  analysis.height = image.naturalHeight || image.height;
  const analysisContext = analysis.getContext('2d', { willReadFrequently: true });
  if (!analysisContext) return [];
  analysisContext.drawImage(image, 0, 0);
  // Zoomed-out Beon pages have thin, very light gaps between cards: a stricter white level
  // keeps neighbouring cards apart. Use whichever level finds more separate cards.
  const pixels0 = analysisContext.getImageData(0, 0, analysis.width, analysis.height).data;
  const regions = [246, 250]
    .map(whiteLevel => findNtgCardRegions(pixels0, analysis.width, analysis.height, { whiteLevel }))
    .reduce((best, found) => (found.length > best.length ? found : best), []);
  const loads = [];
  for (const [index, region] of regions.entries()) {
    onProgress?.(`Reading NTG load card ${index + 1} of ${regions.length}...`);
    const regionWidth = region.x1 - region.x0;
    const regionHeight = region.y1 - region.y0;
    // Small (zoomed-out) cards are enlarged more so their small print can be read.
    const scale = Math.max(1, Math.min(4, 5600 / regionWidth));
    const cardCanvas = document.createElement('canvas');
    cardCanvas.width = Math.round(regionWidth * scale);
    cardCanvas.height = Math.round(regionHeight * scale);
    const cardContext = cardCanvas.getContext('2d', { willReadFrequently: true });
    if (!cardContext) continue;
    cardContext.imageSmoothingQuality = 'high';
    cardContext.drawImage(image, region.x0, region.y0, regionWidth, regionHeight, 0, 0, cardCanvas.width, cardCanvas.height);
    const pixels = cardContext.getImageData(0, 0, cardCanvas.width, cardCanvas.height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const gray = pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114;
      pixels.data[offset] = gray;
      pixels.data[offset + 1] = gray;
      pixels.data[offset + 2] = gray;
    }
    cardContext.putImageData(pixels, 0, 0);
    await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
    const { data } = await worker.recognize(cardCanvas, {}, { blocks: true });
    const lines = (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
    await fillMissingNtgCardDetails(worker, cardCanvas, lines);
    loads.push(...parseNtgScreenshotLines(lines, cardCanvas.width, cardCanvas.height, { wholeCard: true })
      .map(load => ({
        ...load,
        id: /^NTG-/.test(load.id) ? `NTG-${Date.now()}-${index}` : load.id,
        ...(lines.ntgIdUncertain && !/^NTG-/.test(load.id)
          ? { notes: [load.notes, 'Load number was hard to read from the screenshot; please verify it.'].filter(Boolean).join(' ') }
          : {})
      })));
  }
  await worker.setParameters({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' });
  return loads;
}

async function readChScreenshot(worker, canvas, lines, brokerName, laneRates, scale) {
  const headers = findChHeaders(lines);
  if (!headers) return { loads: [], skippedLtl: 0, skippedNoDate: 0 };
  const bounds = getChColumnBounds(headers, canvas.width);
  // Reading each narrow column on its own is far more accurate than reading it inside the full table.
  const readStrip = async (left, right, whitelist) => {
    const x0 = Math.max(0, Math.round(left));
    const x1 = Math.min(canvas.width, Math.round(right));
    if (x1 - x0 < 8) return [];
    const factor = Math.max(1, 4 / scale);
    const margin = 40;
    const strip = document.createElement('canvas');
    strip.width = Math.round((x1 - x0) * factor) + margin * 2;
    strip.height = Math.round(canvas.height * factor) + margin * 2;
    const context = strip.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    context.fillStyle = '#fff';
    context.fillRect(0, 0, strip.width, strip.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, x0, 0, x1 - x0, canvas.height, margin, margin, (x1 - x0) * factor, canvas.height * factor);
    // Highlighted rows (yellow, green, gray) confuse OCR, so light backgrounds are whitened while dark text stays.
    const pixels = context.getImageData(0, 0, strip.width, strip.height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const luminance = pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114;
      const value = luminance >= 205 ? 255 : luminance;
      pixels.data[offset] = value;
      pixels.data[offset + 1] = value;
      pixels.data[offset + 2] = value;
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: whitelist });
    const { data } = await worker.recognize(strip, {}, { blocks: true });
    return (data.blocks || [])
      .flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
      .map(line => ({
        y: ((line.bbox.y0 + line.bbox.y1) / 2 - margin) / factor,
        text: line.text.replace(/\s+/g, '')
      }));
  };
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const strips = {
    ost: await readStrip(bounds.ostLeft, bounds.destinationLeft, letters),
    dst: await readStrip(bounds.dstLeft, bounds.pickupLeft, letters),
    bin: await readStrip(bounds.binLeft, canvas.width, '0123456789')
  };
  await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
  return parseChScreenshotLines(lines, canvas.width, canvas.height, brokerName, laneRates, strips);
}

export {
  readCanvasStrip,
  voteNtgLoadNumber,
  fillMissingNtgCardDetails,
  readNtgScreenshotCards,
  readChScreenshot
};
