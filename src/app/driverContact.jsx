// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { trackingStages, formatCheckTime, PAPERWORK_DUE_HOURS, getDeliveredAt } from '../lib/trackingEmails.js';
import { buildDriverText } from './driverInfo.js';

// Records a check call (and the stage it reports) on the load; keeps the last 20.
function logCheckCall(load, { stage, note = '' }, at = new Date().toISOString()) {
  const nextStage = trackingStages.includes(stage) ? stage : (load.trackingStage || 'Booked');
  const calls = Array.isArray(load.checkCalls) ? load.checkCalls : [];
  return {
    ...load,
    trackingStage: nextStage,
    checkCalls: [...calls, { at, stage: nextStage, note: String(note).trim() }].slice(-20)
  };
}

// ---------- Driver texts through Google Voice (free; Daniel presses send) ----------
// A US phone number as +1XXXXXXXXXX, or '' if it isn't one.
function toUsPhoneE164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

// Opens (or starts) the text conversation with that number in Google Voice on the web.
function getGoogleVoiceUrl(phone) {
  const number = toUsPhoneE164(phone);
  return number ? `https://voice.google.com/u/0/messages?itemId=t.${encodeURIComponent(number)}` : 'https://voice.google.com/u/0/messages';
}

// Text button: copy the message, open the Google Voice conversation; Daniel pastes and sends.
async function openDriverText(event, load, customer) {
  const button = event?.currentTarget;
  const text = buildDriverText(load, customer);
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch { /* shown below */ }
  window.open(getGoogleVoiceUrl(load.driverPhone), 'google-voice');
  if (!copied) { window.prompt('Copy this text, then paste it in Google Voice:', text); return; }
  if (button) {
    const label = button.textContent;
    button.textContent = '✅ Copied: paste in Google Voice (Ctrl+V, Enter)';
    setTimeout(() => { button.textContent = label; }, 6000);
  }
}

// Delivered, the paperwork is in, and it went to the customer (or didn't need to): the load
// leaves the main Booked Loads list. Older loads marked by hand count as done.
const isBookedLoadComplete = load => load.trackingStage === 'Delivered' && Boolean(load.paperworkReceivedAt)
  && load.paperworkDone !== false;

// The paperwork line on a delivered load's card.
function getPaperworkStatus(load, now = Date.now()) {
  if (load.paperworkReceivedAt) {
    return { level: 'ok', text: `Paperwork received ${formatCheckTime(load.paperworkReceivedAt)}${load.paperworkSentAt ? ' · sent to the customer' : load.paperworkDone ? '' : ' · waiting for you to send it to the customer'}` };
  }
  const deliveredAt = getDeliveredAt(load);
  if (!deliveredAt) return { level: 'waiting', text: 'Waiting on paperwork from the driver' };
  const hours = Math.floor((now - deliveredAt) / 3600000);
  const left = PAPERWORK_DUE_HOURS - hours;
  return left > 0
    ? { level: hours >= 24 ? 'due' : 'waiting', text: `Waiting on paperwork · delivered ${hours}h ago · due in ${left}h` }
    : { level: 'late', text: `Paperwork LATE · delivered ${hours}h ago (due within ${PAPERWORK_DUE_HOURS}h, customer can charge back)` };
}

export {
  logCheckCall,
  toUsPhoneE164,
  getGoogleVoiceUrl,
  openDriverText,
  isBookedLoadComplete,
  getPaperworkStatus
};
