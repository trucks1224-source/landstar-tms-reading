// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { formatCheckTime } from '../lib/trackingEmails.js';

const sameZip = (a, b) => String(a || '').trim().padStart(5, '0') === String(b || '').trim().padStart(5, '0');

// The TMS load a raise belongs to: its saved Landstar posting has the same origin ZIP,
// destination ZIP, pickup end and weight as the raised posting.
function loadMatchesRateRaise(load, raise) {
  const mine = load?.landstarPosting;
  const theirs = raise?.posting;
  if (!mine || !theirs) return false;
  return sameZip(mine.originZip, theirs.originZip) && sameZip(mine.destZip, theirs.destZip)
    && String(mine.pickupThru || '').trim() === String(theirs.pickupThru || '').trim()
    && (!theirs.weight || !mine.weight || Number(mine.weight) === Number(theirs.weight));
}

// The load after the bot raised it on Landstar: its rate is the new board rate and it remembers
// the raise (the ⬆ RAISED badge). It counts as a set rate ('user-entered'): the rate box and the
// export only accept user-entered/DAT rates, a re-export then posts this exact rate with no RXO
// DAT discount, and re-imports and DAT refreshes keep it. It is not saved as a lane rate.
function applyRateRaise(load, raise) {
  return {
    ...load,
    rateInput: String(raise.to),
    rateSource: 'user-entered',
    rateRaise: {
      from: Number(raise.from) || 0, to: Number(raise.to) || 0,
      competitor: raise.competitor || '', competitorRate: Number(raise.competitorRate) || 0,
      landstarLoadId: raise.landstarLoadId || '', at: Number(raise.at) || Date.now()
    }
  };
}

const formatRaiseMoney = value => `$${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// The load after Landstar rejected its posting and the bot deleted the error draft.
function applyLandstarError(load, draft) {
  return { ...load, landstarError: { reasons: draft.reasons || [], draftId: draft.draftId || '', at: Number(draft.at) || Date.now() } };
}

function markRemovalQueued(load, reason = '') {
  return { ...load, landstarRemoval: { state: 'queued', at: new Date().toISOString(), ...(reason ? { reason } : {}) } };
}

function applyRemovalResult(load, result) {
  return { ...load, landstarRemoval: { ...(load.landstarRemoval || {}), state: result.state, at: new Date(Number(result.at) || Date.now()).toISOString() } };
}

// Badge text, style and tooltip for a load's removal state (null when it has none).
function getRemovalBadge(load) {
  const removal = load?.landstarRemoval;
  if (!removal?.state) return null;
  const when = formatCheckTime(removal.at) || '';
  if (removal.state === 'queued') return { text: '⏳ SENT TO REMOVAL BOT', className: 'bg-amber-500 text-black', title: `Sent to the removal bot ${when}. It takes the posting off the Landstar board.` };
  if (removal.state === 'removed') return { text: 'RMOV', className: 'bg-slate-500 text-white', title: `Removed from Landstar ${when}.` };
  if (removal.state === 'gone') return { text: 'RMOV', className: 'bg-slate-500 text-white', title: `No longer on the Landstar board (checked ${when}).` };
  return { text: '⚠ NOT REMOVED', className: 'bg-red-600 text-white', title: `Still on Landstar after 3 tries (${when}): posted by hand or Landstar refused. Remove it on LandstarOnline.` };
}

// The load's note after the bot's assignment: "Landstar: Assigned 420371 - LDWY ..." or why not.
function applyAssignResult(load, result) {
  const capacity = result.carrierMc ? `carrier MC ${result.carrierMc}` : `truck ${result.truck}`;
  const line = result.ok
    ? `Landstar: ${result.message}`
    : result.unconfirmed
      ? `Landstar: ${capacity} NOT CONFIRMED - check Landstar before assigning again. ${result.message}`
      : `Landstar: ${capacity} NOT assigned - ${result.message}. Assign it by hand.`;
  return {
    ...load,
    ...(result.ok && result.posting ? { landstarPosting: result.posting } : {}),
    landstarAssignment: { ok: Boolean(result.ok), truck: result.truck, ...(result.carrierMc ? { carrierMc: result.carrierMc } : {}), landstarLoadId: result.landstarLoadId || '', message: result.message, at: result.at },
    notes: load.notes ? `${load.notes}\n${line}` : line
  };
}

export {
  sameZip,
  loadMatchesRateRaise,
  applyRateRaise,
  formatRaiseMoney,
  applyLandstarError,
  markRemovalQueued,
  applyRemovalResult,
  getRemovalBadge,
  applyAssignResult
};
