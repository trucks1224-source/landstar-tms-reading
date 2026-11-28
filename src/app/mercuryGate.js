// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import automationPolicy from '../../bot/automation-policy.json';

const MERCURYGATE_FROM = Date.parse('2026-11-06T16:55:00Z');

// The MercuryGate step due for a booked Paramount load, or ''.
// The number MercuryGate is searched by: the Landstar freight bill (from Clarity / the BCO email)
// or, right after booking, the Landstar load number from Assign Capacity (also a reference there).
function getMercuryGateSearchNumber(load, tracking = {}) {
  return String(tracking.freightBill || (load.landstarAssignment?.ok ? load.landstarAssignment.landstarLoadId : '') || '');
}

function getDueMercuryGateStep(load, tracking = {}) {
  if (!automationPolicy.automaticDispatchEnabled) return '';
  if (load.status !== 'BOOKED' || !getMercuryGateSearchNumber(load, tracking)) return '';
  if (!(Date.parse(load.bookedAt) >= MERCURYGATE_FROM)) return '';
  const done = load.mercurygate || {};
  if (!done.booked) return 'booked';
  if (tracking.leftShipperAt && !done.pickedUp) return 'pickedUp';
  return '';
}

// The load's notes after the bot's MercuryGate run.
function applyMercuryGateResult(load, result) {
  const lines = (result.results || []).map(item => `MercuryGate: ${item.message}`);
  if (!result.ok && result.retrying) lines.push(`MercuryGate: not finished yet, trying again - ${String(result.message || '').split('\n')[0]}`);
  else if (!result.ok) lines.push(`MercuryGate: NOT finished - ${String(result.message || '').split('\n')[0]}. Finish it by hand.`);
  return {
    ...load,
    mercurygate: { ...(load.mercurygate || {}), [`${result.step}Result`]: { ok: Boolean(result.ok), at: result.at } },
    notes: [load.notes, ...lines].filter(Boolean).join('\n')
  };
}

export {
  MERCURYGATE_FROM,
  getMercuryGateSearchNumber,
  getDueMercuryGateStep,
  applyMercuryGateResult
};
