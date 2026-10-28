const luminance = (data, offset) => data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;

// Finds the white NTG/Beon load cards in a full-window screenshot by looking for the
// grey gap rows that separate them. Returns card boxes in image pixel coordinates.
export function findNtgCardRegions(data, width, height, { whiteLevel = 246 } = {}) {
  if (!data || !width || !height) return [];
  const separators = [];
  for (let y = 0; y < height; y += 1) {
    let best = { length: 0, x0: 0, x1: 0 };
    let start = -1;
    for (let x = 0; x <= width; x += 1) {
      const isDark = x < width && luminance(data, (y * width + x) * 4) < whiteLevel;
      if (isDark && start < 0) start = x;
      if (!isDark && start >= 0) {
        if (x - start > best.length) best = { length: x - start, x0: start, x1: x };
        start = -1;
      }
    }
    separators.push(best.length >= width * 0.4 ? best : null);
  }

  const regions = [];
  let top = -1;
  for (let y = 0; y <= height; y += 1) {
    const isSeparator = y === height || separators[y];
    if (!isSeparator && top < 0) top = y;
    if (isSeparator && top >= 0) {
      const bottom = y;
      const neighbours = [separators[top - 1], separators[bottom]].filter(Boolean);
      if (neighbours.length && bottom - top >= Math.max(24, height * 0.05)) {
        const x0 = Math.max(...neighbours.map(run => run.x0));
        const x1 = Math.min(...neighbours.map(run => run.x1));
        if (x1 - x0 >= width * 0.4) regions.push({ x0, y0: top, x1, y1: bottom });
      }
      top = -1;
    }
  }

  return regions.filter(region => {
    let white = 0;
    let total = 0;
    const step = Math.max(1, Math.floor((region.x1 - region.x0) / 300));
    for (let y = region.y0; y < region.y1; y += 2) {
      for (let x = region.x0; x < region.x1; x += step) {
        total += 1;
        if (luminance(data, (y * width + x) * 4) >= whiteLevel - 10) white += 1;
      }
    }
    return total > 0 && white / total >= 0.75;
  });
}
