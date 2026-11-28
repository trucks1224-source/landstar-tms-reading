// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { useState, useEffect } from 'react';
import { formatCheckTime, PARAMOUNT_AUTO_SEND_AFTER, paramountAlwaysAskKinds, driverEmailLabels, isRxoAccount, manualUpdateKinds } from '../lib/trackingEmails.js';

function InquiriesPanel({ inquiries, onOpen, onSeen, onClose }) {
  return (
    <div className="fixed right-4 top-16 z-40 w-[26rem] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto bg-[#121829] border border-purple-500 rounded-lg shadow-2xl p-3 normal-case tracking-normal text-left" role="dialog" aria-label="Driver inquiries">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-purple-200">📨 Driver inquiries</h2>
        <button type="button" onClick={onClose} className="text-gray-300 hover:text-white text-sm px-2 cursor-pointer" aria-label="Close inquiries">✕</button>
      </div>
      {inquiries.length === 0 && <p className="text-xs text-gray-300">No inquiries yet. Use 🔗 Copy driver link on a load and send it to drivers.</p>}
      {inquiries.map(inquiry => (
        <div key={inquiry.id} className={`border rounded p-2 mb-2 text-xs text-white ${inquiry.seen ? 'border-[#1c2541] opacity-75' : 'border-purple-400 bg-purple-950/30'}`}>
          <div className="flex justify-between gap-2">
            <span className="font-bold">{inquiry.driver_name}</span>
            <span className="text-gray-400">{formatCheckTime(inquiry.created_at)}</span>
          </div>
          <p>
            <a href={`tel:${String(inquiry.driver_phone).replace(/[^\d+]/g, '')}`} className="text-emerald-300 underline">📞 {inquiry.driver_phone}</a>
            {inquiry.mc_or_truck ? ` · ${inquiry.mc_or_truck}` : ''}
          </p>
          {inquiry.message && <p className="text-gray-200 mt-1">“{inquiry.message}”</p>}
          <p className="text-gray-400 mt-1">Load #{inquiry.load_id} · {inquiry.customer}</p>
          {inquiry.notify_error && <p className="text-amber-300 mt-1">Email not sent: {inquiry.notify_error}</p>}
          <div className="flex gap-2 mt-1">
            <button type="button" onClick={() => onOpen(inquiry)} className="bg-purple-600 hover:bg-purple-500 text-white px-2 py-0.5 rounded font-semibold cursor-pointer">Open load</button>
            {!inquiry.seen && <button type="button" onClick={() => onSeen(inquiry)} className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded cursor-pointer">Mark seen</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Tracking emails for one load (Paramount / RXO), shown inside its Booked Loads card:
// a warning badge while an email waits for Send, which opens the email to review.
function LoadEmailBox({ drafts = [], replies = [], onChangeText, onChangeManual, onSend, onSkip, onDismissReply }) {
  const [open, setOpen] = useState(false);
  // "✉ Customer update" opens its email right away.
  const manualCount = drafts.filter(draft => draft.kind === 'manualUpdate').length;
  useEffect(() => {
    if (manualCount) setOpen(true);
  }, [manualCount]);
  if (!drafts.length && !replies.length) return null;
  const kindLabel = { manualUpdate: 'Your update', customerUpdate: 'Reply to customer update request', initial: 'Tracking link + pickup ETA', pickupEta: 'Morning pickup ETA', arrived: 'Arrived at shipper', departed: 'Loaded, left shipper', arrivedDelivery: 'Arrived at receiver', delivered: 'Delivered', rxo: 'Reply to update request', rxoForward: 'Forward RXO request to Ivan', driverEta: 'Driver ETA update', driverStatus: 'Driver status update', paperwork: 'POD / paperwork (files attached)', location: 'Daily location update', dailyCustomer: 'Daily customer update', checkCall: 'Logged check call update' };
  const approvalsLeft = draft => Math.max(0, PARAMOUNT_AUTO_SEND_AFTER
    - readApprovedCount(draft.kind === 'paperwork' ? paperworkApprovedKey : draft.kind === 'driver' ? driverApprovedKey : ['rxo', 'customerUpdate'].includes(draft.kind) ? rxoApprovedKey : paramountApprovedKey));
  const who = draft => (draft.kind === 'driver' ? 'Driver' : ['checkCall', 'manualUpdate'].includes(draft.kind) ? draft.customer : draft.kind === 'rxoForward' ? 'Ivan' : draft.kind === 'customerUpdate' ? draft.customer : draft.kind === 'rxo' || draft.target === 'rxo' || isRxoAccount(draft.customer) ? 'RXO' : 'Paramount');
  // Paperwork drafts carry no addresses: the send replies on the customer's email thread.
  const recipients = draft => [...(draft.to || []), ...(draft.cc || [])];
  return (
    <div data-email-draft={drafts.length ? 'waiting' : undefined} className="mt-3 text-xs text-white normal-case tracking-normal text-left">
      <div className="flex flex-wrap gap-2">
        {drafts.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            aria-expanded={open}
            title="An email is waiting for you to review and send"
            className="bg-amber-400 hover:bg-amber-300 text-black px-2 py-0.5 rounded font-bold cursor-pointer"
          >
            ⚠ {drafts.length === 1 ? 'Email ready to send' : `${drafts.length} emails ready to send`} · {open ? 'Hide' : 'Review'}
          </button>
        )}
        {replies.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            className="bg-sky-500 hover:bg-sky-400 text-black px-2 py-0.5 rounded font-bold cursor-pointer"
          >
            💬 {replies.length === 1 ? 'New reply' : `${replies.length} new replies`} · {open ? 'Hide' : 'Read'}
          </button>
        )}
      </div>
      {open && replies.map(reply => (
        <div key={reply.id} className="border border-sky-400 bg-sky-950/30 rounded p-2 mt-2">
          <p className="font-bold text-sky-200">💬 {reply.driver ? 'Driver · ' : ''}{reply.from} · {formatCheckTime(reply.at)}</p>
          <p className="mt-1 text-gray-100">“{reply.snippet}”</p>
          <div className="flex gap-2 mt-1">
            <a href={`https://mail.google.com/mail/u/0/#all/${reply.threadId}`} target="_blank" rel="noreferrer" className="bg-sky-600 hover:bg-sky-500 text-white px-2 py-0.5 rounded font-semibold">Open in Gmail</a>
            <button type="button" onClick={() => onDismissReply(reply)} className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded cursor-pointer">Dismiss</button>
          </div>
        </div>
      ))}
      {open && drafts.map(draft => (
        <div key={draft.id} className="border border-amber-400 rounded p-2 mt-2">
          <p className="font-bold text-amber-200">✉️ {who(draft)} email · {draft.kind === 'driver' ? driverEmailLabels[draft.driverKind] : kindLabel[draft.kind]}</p>
          {draft.request && <p className="text-amber-100 mt-0.5">They asked: “{draft.request}”</p>}
          {draft.warning && <p role="alert" className="mt-1 bg-red-600 text-white font-bold rounded px-2 py-1">⚠ {draft.warning} Send only if it is; otherwise click Don&apos;t send.</p>}
          {['rxo', 'customerUpdate'].includes(draft.kind) && !draft.complete && <p className="text-amber-300 mt-0.5">Fill in the blanks (like the pickup ETA) before sending.</p>}
          {draft.kind === 'manualUpdate' && (
            <div className="flex flex-wrap gap-2 mt-1 items-center">
              <label className="flex items-center gap-1">
                <span className="text-gray-300">Update:</span>
                <select
                  value={draft.updateKind}
                  disabled={draft.sending}
                  onChange={event => onChangeManual(draft, { updateKind: event.target.value })}
                  className="bg-[#0b1020] border border-[#1c2541] rounded px-1 py-0.5 text-xs text-white"
                >
                  {manualUpdateKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-gray-300">Time:</span>
                <input
                  value={draft.updateTime}
                  disabled={draft.sending}
                  onChange={event => onChangeManual(draft, { updateTime: event.target.value })}
                  placeholder="11/24 14:30 CST"
                  className="bg-[#0b1020] border border-[#1c2541] rounded px-1 py-0.5 text-xs text-white w-36"
                  aria-label={`Update time for order ${draft.loadId}`}
                />
              </label>
              <span className="text-gray-400">Changing these rewrites the email below.</span>
            </div>
          )}
          <p className="text-gray-300">{recipients(draft).length
            ? `Reply all to: ${recipients(draft).join(', ')}`
            : draft.kind === 'manualUpdate'
              ? `Reply all on the ${draft.customer} email thread for order ${draft.loadId}`
              : `Sends with the files on the ${who(draft)} email thread`}</p>
          <textarea
            value={draft.text}
            onChange={event => onChangeText(draft, event.target.value)}
            rows={10}
            className="w-full mt-1 bg-[#0b1020] border border-[#1c2541] rounded p-1.5 text-xs text-white font-sans"
            aria-label={`Email text for order ${draft.loadId}`}
          />
          {draft.error && <p className="text-red-300 mt-1">Not sent: {draft.error}</p>}
          {draft.sending && draft.retryNote && <p className="text-amber-300 mt-1">{draft.retryNote}</p>}
          <div className="flex flex-wrap gap-2 mt-1 items-center">
            <button type="button" disabled={draft.sending} onClick={() => onSend(draft)} className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white px-3 py-0.5 rounded font-semibold cursor-pointer">{draft.sending ? 'Sending…' : 'Send'}</button>
            <button type="button" disabled={draft.sending} onClick={() => onSkip(draft)} className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded cursor-pointer">Don&apos;t send</button>
            <span className="text-gray-400">{draft.warning || draft.kind === 'manualUpdate' ? 'Waits for your Send' : paramountAlwaysAskKinds.has(draft.kind) ? 'Always waits for your Send' : approvalsLeft(draft) ? `${approvalsLeft(draft)} more approval${approvalsLeft(draft) === 1 ? '' : 's'}, then these send automatically` : 'Sending automatically'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const paramountApprovedKey = 'landstar_paramountApprovedSends';

// ---------- Driver emails ----------
// Every booked load whose Landstar freight bill the bot found in Clarity: the TMS replies
// in Daniel's "BCO Load Detail" email to the driver (Cc his Landstar address):
//   dispatch        right after the BCO Load Detail email: turn on the tracking app, confirm.
//   pickupMorning   7:00 AM on pickup day: good to go? ETA to the shipper?
//   pickedUp        once Clarity shows the truck left the shipper: ETA for delivery?
//   deliveryMorning 7:00 AM on delivery day (picked up on an earlier day): good? ETA?
//   pod             once delivered: please send the POD.
// The first few wait for a Send click; driver replies show on the load with a pop-up.
const driverApprovedKey = 'landstar_driverApprovedSends';

// daily reminders stop after a week
const paperworkApprovedKey = 'landstar_paperworkApprovedSends';

const rxoApprovedKey = 'landstar_rxoApprovedSends';

function readApprovedCount(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

export {
  InquiriesPanel,
  LoadEmailBox,
  paramountApprovedKey,
  driverApprovedKey,
  paperworkApprovedKey,
  rxoApprovedKey,
  readApprovedCount
};
