// Background brightness (Daniel's request, 2026-11-25): ⚙ My Settings has a slider that makes the
// TMS background brighter or darker. Saved on this computer; 0 is the original look.

export const backgroundBrightnessKey = 'landstar_backgroundBrightness';

export function clampBrightness(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(-100, Math.min(100, number)) : 0;
}

// The color laid over the background photo. Darker adds more navy shade, brighter first removes
// the normal shade (at +40) and then adds a light wash on top.
export function backgroundShade(value) {
  const level = clampBrightness(value);
  if (level <= 0) return `rgba(5, 11, 23, ${(0.3 + (-level / 100) * 0.6).toFixed(3)})`;
  if (level <= 40) return `rgba(5, 11, 23, ${(0.3 * (1 - level / 40)).toFixed(3)})`;
  return `rgba(255, 255, 255, ${(((level - 40) / 60) * 0.35).toFixed(3)})`;
}

export function readBackgroundBrightness() {
  try { return clampBrightness(localStorage.getItem(backgroundBrightnessKey) || 0); } catch { return 0; }
}

export function applyBackgroundBrightness(value, save = false) {
  const level = clampBrightness(value);
  if (save) {
    try { localStorage.setItem(backgroundBrightnessKey, String(level)); } catch { /* storage blocked */ }
  }
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--tms-bg-shade', backgroundShade(level));
  return level;
}
