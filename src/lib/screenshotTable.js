function clusterPixels(positions) {
  const clusters = [];
  positions.forEach(position => {
    const last = clusters[clusters.length - 1];
    if (last && position <= last.end + 1) last.end = position;
    else clusters.push({ start: position, end: position });
  });
  return clusters.map(({ start, end }) => Math.round((start + end) / 2));
}

export function detectScreenshotGrid(canvas) {
  const { width, height } = canvas;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not inspect screenshot table boundaries.');
  const { data } = context.getImageData(0, 0, width, height);
  const isGridPixel = (x, y) => {
    const offset = (y * width + x) * 4;
    const max = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    const min = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    return max < 180 && max - min < 30;
  };
  const verticalPixels = [];
  const top = Math.round(height * 0.08);
  const bottom = Math.round(height * 0.92);
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = top; y < bottom; y += 1) {
      if (isGridPixel(x, y)) count += 1;
    }
    if (count / (bottom - top) > 0.75) verticalPixels.push(x);
  }
  const vertical = clusterPixels(verticalPixels).filter(x => x < width * 0.98);
  // This board has 15 columns; the comment column may end at the image edge.
  if (vertical.length !== 15 || vertical[0] > width * 0.02) return null;
  const horizontalPixels = [];
  const left = vertical[0] + 1;
  const right = vertical[14];
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = left; x < right; x += 1) {
      if (isGridPixel(x, y)) count += 1;
    }
    if (count / (right - left) > 0.8) horizontalPixels.push(y);
  }
  const horizontal = clusterPixels(horizontalPixels);
  if (horizontal.length < 4) return null;
  const gaps = horizontal.slice(1).map((y, index) => y - horizontal[index]);
  const rowHeight = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const rows = horizontal.slice(1).flatMap((y, index) => {
    const previous = horizontal[index];
    return y - previous >= rowHeight * 0.8 && y - previous <= rowHeight * 1.2
      ? [{ top: previous, bottom: y }]
      : [];
  });
  return rows.length >= 2 ? { columns: [...vertical, width], rows } : null;
}

export async function recognizeScreenshotEquipment(worker, canvas) {
  await worker.setParameters({
    tessedit_pageseg_mode: '8',
    tessedit_char_whitelist: 'VEZRFSADNM53'
  });
  const { data } = await worker.recognize(canvas);
  const rawEquipmentCode = data.text.trim().toUpperCase().replace(/[\s.]/g, '');
  // V53 is a 53' van; VM is a team van.
  return { V53: 'V', VM: 'VT' }[rawEquipmentCode] || rawEquipmentCode;
}

export async function readScreenshotGrid(worker, canvas, grid, onProgress, sourceImage) {
  const lines = [];
  const padding = 16;
  const nativeCanvas = document.createElement('canvas');
  nativeCanvas.width = sourceImage.width;
  nativeCanvas.height = sourceImage.height;
  const nativeContext = nativeCanvas.getContext('2d', { willReadFrequently: true });
  if (!nativeContext) throw new Error('Could not prepare the original screenshot.');
  nativeContext.drawImage(sourceImage, 0, 0);
  const scaleX = canvas.width / nativeCanvas.width;
  const scaleY = canvas.height / nativeCanvas.height;
  for (const [index, row] of grid.rows.entries()) {
    onProgress(`Reading load row ${index + 1} of ${grid.rows.length}...`);
    const inset = Math.max(1, Math.round(canvas.width / 1202));
    const top = row.top + inset;
    const height = row.bottom - row.top - inset * 2;
    const rowCanvas = document.createElement('canvas');
    rowCanvas.width = canvas.width + padding * 2;
    rowCanvas.height = height + padding * 2;
    const context = rowCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not prepare a screenshot load row.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, rowCanvas.width, rowCanvas.height);
    context.drawImage(canvas, 0, top, canvas.width, height, padding, padding, canvas.width, height);
    grid.columns.forEach(x => context.fillRect(padding + x - inset, padding, inset * 2 + 1, height));
    const orderLeft = grid.columns[1] + inset;
    const orderWidth = grid.columns[2] - grid.columns[1] - inset * 2;
    const pixels = context.getImageData(padding + orderLeft, padding, orderWidth, height);
    let redCount = 0;
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      if (pixels.data[offset] > 180 && pixels.data[offset + 1] < 100 && pixels.data[offset + 2] < 100) {
        redCount += 1;
      }
    }
    const highlighted = redCount > orderWidth * height * 0.2;
    if (highlighted) {
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        // Preserve antialiased digit edges while turning red backgrounds white.
        const value = 255 - Math.min(pixels.data[offset + 1], pixels.data[offset + 2]);
        pixels.data[offset] = value;
        pixels.data[offset + 1] = value;
        pixels.data[offset + 2] = value;
        pixels.data[offset + 3] = 255;
      }
      context.putImageData(pixels, padding + orderLeft, padding);
    }
    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
    const { data } = await worker.recognize(rowCanvas, {}, { blocks: true });
    const words = (data.blocks || []).flatMap(block =>
      block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words))
    ).map(word => ({
      ...word,
      bbox: {
        x0: word.bbox.x0 - padding,
        x1: word.bbox.x1 - padding,
        y0: word.bbox.y0 - padding + top,
        y1: word.bbox.y1 - padding + top
      }
    }));
    const nativeLeft = Math.floor(grid.columns[1] / scaleX) + 1;
    const nativeTop = Math.floor(row.top / scaleY) + 1;
    const nativeWidth = Math.floor(grid.columns[2] / scaleX) - nativeLeft - 1;
    const nativeHeight = Math.floor(row.bottom / scaleY) - nativeTop - 1;
    const nativeOrder = document.createElement('canvas');
    nativeOrder.width = nativeWidth;
    nativeOrder.height = nativeHeight;
    const nativeOrderContext = nativeOrder.getContext('2d');
    if (!nativeOrderContext) throw new Error('Could not prepare the original load number.');
    const nativePixels = nativeContext.getImageData(nativeLeft, nativeTop, nativeWidth, nativeHeight);
    if (highlighted) {
      for (let offset = 0; offset < nativePixels.data.length; offset += 4) {
        const value = 255 - Math.min(nativePixels.data[offset + 1], nativePixels.data[offset + 2]);
        nativePixels.data[offset] = nativePixels.data[offset + 1] = nativePixels.data[offset + 2] = value;
      }
    }
    nativeOrderContext.putImageData(nativePixels, 0, 0);
    const orderCanvas = document.createElement('canvas');
    orderCanvas.width = (highlighted ? nativeWidth * 3 : orderWidth) + padding * 2;
    orderCanvas.height = (highlighted ? nativeHeight * 3 : height) + padding * 2;
    const orderContext = orderCanvas.getContext('2d');
    if (!orderContext) throw new Error('Could not read a screenshot load number.');
    orderContext.fillStyle = '#fff';
    orderContext.fillRect(0, 0, orderCanvas.width, orderCanvas.height);
    if (highlighted) {
      orderContext.drawImage(nativeOrder, padding, padding, nativeWidth * 3, nativeHeight * 3);
    } else {
      orderContext.drawImage(rowCanvas, padding + orderLeft, padding, orderWidth, height, padding, padding, orderWidth, height);
    }
    await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
    const { data: orderData } = await worker.recognize(orderCanvas);
    const digits = orderData.text.replace(/\s/g, '');
    if (!/^\d{7}$/.test(digits)) {
      throw new Error(`Could not read the load number in screenshot row ${index + 1}. Existing loads were not deleted.`);
    }
    const equipmentLeft = Math.floor(grid.columns[0] / scaleX) + 1;
    const equipmentWidth = Math.floor(grid.columns[1] / scaleX) - equipmentLeft;
    const equipmentTop = Math.floor(row.top / scaleY) + 2;
    const equipmentHeight = Math.floor(row.bottom / scaleY) - equipmentTop - 1;
    const equipmentCanvas = document.createElement('canvas');
    equipmentCanvas.width = equipmentWidth * 5 + padding * 2;
    equipmentCanvas.height = equipmentHeight * 5 + padding * 2;
    const equipmentContext = equipmentCanvas.getContext('2d');
    if (!equipmentContext) throw new Error('Could not read screenshot equipment.');
    equipmentContext.fillStyle = '#fff';
    equipmentContext.fillRect(0, 0, equipmentCanvas.width, equipmentCanvas.height);
    equipmentContext.drawImage(
      nativeCanvas, equipmentLeft, equipmentTop, equipmentWidth, equipmentHeight,
      padding, padding, equipmentWidth * 5, equipmentHeight * 5
    );
    const equipmentCode = await recognizeScreenshotEquipment(worker, equipmentCanvas);
    if (!/^(VZ|VE|VR|VT|RZ|R|F|SD|VAN|V)$/.test(equipmentCode)) {
      throw new Error(`Could not read equipment for load ${digits}. Existing loads were not deleted.`);
    }
    lines.push({
      text: data.text,
      words,
      bbox: { x0: 0, x1: canvas.width, y0: top, y1: row.bottom - inset },
      verifiedOrderId: digits,
      verifiedEquipmentCode: equipmentCode,
      orderNumberHighlighted: highlighted,
      screenshotColumns: grid.columns.map(x => x / canvas.width)
    });
  }
  await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
  return lines;
}
