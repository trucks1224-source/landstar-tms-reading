// Prospects: new-customer outreach from DAT posting screenshots.
// Snip a DAT posting (Win+Shift+S), paste it here; OCR pulls out each broker's
// company, email, phone and lane. Saved prospects live in Supabase (supabase/prospects.sql).
// Intro and follow-up emails go out through the connected Gmail on this computer
// (/api/paramount-email, local TMS only). The first few sends wait for an approval
// click; after that "Send all" may send by itself. Replies found in Gmail move a
// prospect to "replied" so hot leads stand out - except "we can't work with Landstar"
// answers, which get an automatic apology reply and move to "dead". The Daily check-ins list emails chosen
// brokers "any loads available today?" once a day (synced key landstar_dailyCheckins).
//
// Daniel's rules (2026-11-09): emails never mention Broski Transportation - the sender
// is a Landstar agent, MC# 166960 - and they lead with "we do not double broker" and
// "we stay on top of our updates".
import { useEffect, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import {
  extractProspects, buildProspectEmail, buildFollowUpEmail, defaultSubject, prospectSubject, isFollowUpDue, isBlockedProspect, isProspectFollowUpExcluded, FOLLOW_UP_AFTER_DAYS,
  buildDailyCheckInEmail, dailyCheckInSubject, isDailyCheckInDue, isLandstarRefusal, buildDeclineReplyEmail
} from './lib/prospects';

const PROSPECT_EMAIL_URL = '/api/paramount-email';
const settingsKey = 'landstar_prospectSettings';
// Daily "any loads today?" brokers, synced through app_data (cloudSync syncedKeys).
const checkinsKey = 'landstar_dailyCheckins';

// Daniel's starting list (2026-11-10): brokers who get the daily check-in email.
// Only used the first time, before the list exists in storage - deleting everyone
// saves an empty list and does not bring these back.
const seedCheckins = [
  { id: 'seed-kevin-coolmore', contact: 'Kevin Presley', company: 'Coolmore Logistics', email: 'kevin@coolmorelogistics.com', active: true, lastSentAt: '' },
  { id: 'seed-justin-traffictech', contact: 'Justin Mesch', company: 'TrafficTech', email: 'jmesch@traffictech.com', active: true, lastSentAt: '' }
];

function readCheckins() {
  try {
    const saved = window.localStorage.getItem(checkinsKey);
    if (saved === null) return seedCheckins;
    const list = JSON.parse(saved);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const canSendHere = () => typeof window !== 'undefined'
  && ['127.0.0.1', 'localhost'].includes(window.location.hostname);

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey)) || {};
    return {
      yourName: saved.yourName || '',
      agencyName: saved.agencyName || '',
      phone: saved.phone || '484-575-6486',
      email: saved.email || '',
      subject: saved.subject || defaultSubject()
    };
  } catch {
    return { yourName: '', agencyName: '', phone: '484-575-6486', email: '', subject: defaultSubject() };
  }
}

async function callEmailApi(body) {
  const response = await fetch(PROSPECT_EMAIL_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Email request failed (HTTP ${response.status}).`);
  return result;
}

const statusLabels = {
  new: 'New', emailed: 'Emailed', 'followed-up': 'Followed up',
  replied: 'REPLIED', customer: 'Customer', dead: 'Dead'
};
const statusColors = {
  new: 'text-sky-300', emailed: 'text-amber-300', 'followed-up': 'text-orange-300',
  replied: 'text-emerald-300', customer: 'text-emerald-400', dead: 'text-gray-500'
};
const statusOrder = { replied: 0, new: 1, emailed: 2, 'followed-up': 3, customer: 4, dead: 5 };

const inputClass = 'w-full bg-[#161f36] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500';

export default function Prospects() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [settings, setSettings] = useState(readSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [captured, setCaptured] = useState([]); // extracted from a screenshot, not saved yet
  const [reading, setReading] = useState('');
  const [preview, setPreview] = useState(null); // { prospect, kind, subject, text }
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkProgress, setBulkProgress] = useState('');
  const [checkins, setCheckins] = useState(readCheckins);
  const [newCheckin, setNewCheckin] = useState({ contact: '', company: '', email: '' });
  const checkedReplies = useRef(false);

  const saveCheckins = next => {
    setCheckins(next);
    try { window.localStorage.setItem(checkinsKey, JSON.stringify(next)); } catch { /* kept for this tab only */ }
  };

  const addCheckin = () => {
    const email = newCheckin.email.trim().toLowerCase();
    if (!email.includes('@')) {
      setStatus('Enter the broker email address to add a daily check-in.');
      return;
    }
    if (checkins.some(item => item.email === email)) {
      setStatus(`${email} is already on the daily check-in list.`);
      return;
    }
    saveCheckins([...readCheckins(), {
      id: `checkin-${Date.now()}`,
      contact: newCheckin.contact.trim(),
      company: newCheckin.company.trim(),
      email, active: true, lastSentAt: ''
    }]);
    setNewCheckin({ contact: '', company: '', email: '' });
    setStatus(`${email} added - the daily check-in starts with the next sender run.`);
  };

  const saveSettings = next => {
    setSettings(next);
    try { localStorage.setItem(settingsKey, JSON.stringify(next)); } catch { /* kept for this tab only */ }
  };

  const loadRows = async () => {
    const { data, error } = await supabase.from('prospects').select('*')
      .order('created_at', { ascending: false }).limit(1000);
    if (error) {
      setStatus(/relation|does not exist|schema cache/i.test(error.message)
        ? 'Prospects are not set up yet: run supabase/prospects.sql in Supabase first.'
        : `Could not load prospects: ${error.message}`);
      return null;
    }
    setRows(data || []);
    return data || [];
  };

  // Marks prospects whose address answered in Gmail as "replied".
  const checkReplies = async current => {
    if (!canSendHere()) return;
    const waiting = (current || rows).filter(row => ['emailed', 'followed-up'].includes(row.status));
    if (!waiting.length) return;
    try {
      const since = waiting.map(row => row.emailed_at).filter(Boolean).sort()[0];
      const { replies } = await callEmailApi({ action: 'prospectReplies', addresses: waiting.map(row => row.email), since });
      for (const reply of replies || []) {
        const match = waiting.find(row => row.email.toLowerCase() === reply.from);
        if (!match || Date.parse(reply.at) <= (Date.parse(match.emailed_at) || 0)) continue;
        // "We can't work with Landstar" gets an automatic apology that leaves the door
        // open, and the prospect goes to "dead" so no more outreach goes out (Daniel's
        // rule, 2026-11-10). Needs the sender name from Settings for the signature.
        if (!isBlockedProspect(match) && isLandstarRefusal(reply.snippet) && settings.yourName.trim()) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await callEmailApi({ action: 'prospectThreadReply', messageId: reply.id, company: match.company, text: buildDeclineReplyEmail(match, settings) });
            // eslint-disable-next-line no-await-in-loop
            await supabase.from('prospects').update({
              status: 'dead', replied_at: reply.at,
              reply_snippet: `${reply.snippet || ''} (apology auto-replied)`.trim(),
              updated_at: new Date().toISOString()
            }).eq('id', match.id);
            setStatus(`${match.email} cannot work with Landstar - the apology reply went out automatically.`);
            continue;
          } catch (error) {
            setStatus(`Could not auto-reply to ${match.email}: ${error.message}`);
          }
        }
        // eslint-disable-next-line no-await-in-loop
        await supabase.from('prospects').update({
          status: 'replied', replied_at: reply.at, reply_snippet: reply.snippet || '', updated_at: new Date().toISOString()
        }).eq('id', match.id);
      }
      if ((replies || []).length) await loadRows();
    } catch (error) {
      setStatus(`Could not check Gmail for replies: ${error.message}`);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadRows().then(data => {
      if (data && !checkedReplies.current) {
        checkedReplies.current = true;
        void checkReplies(data);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fully automatic outreach (Daniel's rule, 2026-11-09): new brokers get the intro email
  // within ~10 minutes of being saved, and the day-after follow-up when nobody answered -
  // no approval clicks. Runs even with the panel closed; needs only the sender name in
  // Settings. Blocked prospects (Landstar agencies, TQL, NTG) are never emailed.
  useEffect(() => {
    if (!supabase || !canSendHere()) return undefined;
    const run = async () => {
      const current = readSettings();
      if (!current.yourName.trim()) return;
      const { data } = await supabase.from('prospects').select('*').in('status', ['new', 'emailed']).limit(500);
      if (!data || !data.length) return;
      // Anyone who answered is marked "replied" first and never followed up.
      const emailed = data.filter(row => row.status === 'emailed');
      if (emailed.length) await checkReplies(emailed);
      const { data: fresh } = await supabase.from('prospects').select('*').in('status', ['new', 'emailed']).limit(500);
      for (const prospect of (fresh || []).filter(row => !isBlockedProspect(row))) {
        if (prospect.status === 'new') {
          // eslint-disable-next-line no-await-in-loop
          await sendTo(prospect, 'intro', prospectSubject(prospect, current.subject), buildProspectEmail(prospect, current), { auto: true });
        } else if (isFollowUpDue(prospect)) {
          // eslint-disable-next-line no-await-in-loop
          await sendTo(prospect, 'followUp', `RE: ${prospectSubject(prospect, current.subject)}`, buildFollowUpEmail(prospect, current), { auto: true });
        }
      }
      // Daily check-in brokers: one "any loads today?" email each, once a day.
      for (const broker of readCheckins().filter(item => isDailyCheckInDue(item))) {
        // eslint-disable-next-line no-await-in-loop
        await sendCheckin(broker, current);
      }
    };
    const first = setTimeout(run, 45 * 1000);
    const timer = setInterval(run, 10 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Capture: OCR a pasted DAT screenshot ----------
  const readImage = async blob => {
    setReading('Loading OCR engine…');
    let worker = null;
    let imageUrl = '';
    try {
      const tesseractModule = await import('tesseract.js');
      const createWorker = tesseractModule.createWorker || tesseractModule.default?.createWorker;
      if (typeof createWorker !== 'function') throw new Error('The OCR engine could not be loaded.');
      const image = new Image();
      imageUrl = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('The pasted image could not be opened.'));
        image.src = imageUrl;
      });
      const scale = Math.min(3, 5000 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      worker = await createWorker('eng', 1, {
        logger: message => {
          if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
            setReading(`Reading screenshot ${Math.round(message.progress * 100)}%`);
          }
        }
      });
      await worker.setParameters({ tessedit_pageseg_mode: '3' });
      const { data } = await worker.recognize(canvas);
      const existing = new Set(rows.map(row => row.email.toLowerCase()));
      const all = extractProspects(data.text || '').filter(item => !isBlockedProspect(item));
      const found = all.filter(item => !existing.has(item.email));
      const already = all.length - found.length;
      setCaptured(current => {
        const seen = new Set(current.map(item => item.email));
        return [...current, ...found.filter(item => !seen.has(item.email))];
      });
      setReading('');
      setStatus(found.length
        ? `Found ${found.length} contact(s)${already ? ` (${already} already saved)` : ''}. Check them below, then save.`
        : already ? 'Every contact in that screenshot is already saved.'
          : 'No email addresses found. Zoom DAT to 100% and capture the contact column clearly.');
    } catch (error) {
      setReading('');
      setStatus(`Could not read the screenshot: ${error.message}`);
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    }
  };

  const onPaste = event => {
    const item = [...(event.clipboardData?.items || [])].find(entry => entry.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    void readImage(item.getAsFile());
  };

  const pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find(entry => entry.startsWith('image/'));
        if (type) return void readImage(await item.getType(type));
      }
      setStatus('No screenshot on the clipboard. Snip the DAT posting with Win+Shift+S first.');
    } catch {
      setStatus('Could not read the clipboard. Click inside this panel and press Ctrl+V instead.');
    }
  };

  const saveCaptured = async () => {
    const keep = captured.filter(item => item.email.includes('@'));
    if (!keep.length) return;
    const { error } = await supabase.from('prospects').upsert(
      keep.map(item => ({
        company: item.company || '', contact: item.contact || '', email: item.email.toLowerCase(),
        phone: item.phone || '', lane: item.lane || '', equipment: item.equipment || ''
      })),
      { onConflict: 'owner_id,email', ignoreDuplicates: true }
    );
    if (error) {
      setStatus(/relation|does not exist|schema cache/i.test(error.message)
        ? 'Prospects are not set up yet: run supabase/prospects.sql in Supabase first.'
        : `Could not save: ${error.message}`);
      return;
    }
    setCaptured([]);
    setStatus(`Saved ${keep.length} prospect(s).`);
    await loadRows();
  };

  // ---------- Sending ----------
  const settingsReady = () => {
    if (settings.yourName.trim()) return true;
    setShowSettings(true);
    setStatus('Fill in your name in Settings first - it goes in the email signature.');
    return false;
  };

  const sendTo = async (prospect, kind, subject, text, { auto = false } = {}) => {
    if (kind === 'followUp' && isProspectFollowUpExcluded(prospect)) {
      setStatus(`Prospecting follow-ups are disabled for ${prospect.email}.`);
      return;
    }
    if (isBlockedProspect(prospect)) {
      setStatus(`${prospect.email} is on the prospect do-not-email list (Landstar agencies, TQL and Nolan Transportation Group). Marked dead.`);
      await supabase.from('prospects').update({ status: 'dead', updated_at: new Date().toISOString() }).eq('id', prospect.id);
      await loadRows();
      return;
    }
    setBusyId(prospect.id);
    try {
      await callEmailApi({ action: 'prospectSend', kind, to: prospect.email, company: prospect.company, subject, text });
      const now = new Date().toISOString();
      const change = kind === 'followUp'
        ? { status: 'followed-up', followed_up_at: now, updated_at: now }
        : { status: 'emailed', emailed_at: now, updated_at: now };
      await supabase.from('prospects').update(change).eq('id', prospect.id);
      setPreview(null);
      await loadRows();
      setStatus(`Sent to ${prospect.email}.`);
    } catch (error) {
      setStatus(`Could not send to ${prospect.email}: ${error.message}`);
    } finally {
      setBusyId(null);
    }
  };

  // One daily check-in email to a broker; stamps lastSentAt so the next one waits a day.
  const sendCheckin = async (broker, current) => {
    if (isBlockedProspect(broker)) {
      setStatus(`${broker.email} is on the prospect do-not-email list. Daily check-in not sent.`);
      return;
    }
    try {
      await callEmailApi({
        action: 'prospectSend', to: broker.email, company: broker.company,
        subject: dailyCheckInSubject(), text: buildDailyCheckInEmail(broker, current)
      });
      const sentAt = new Date().toISOString();
      saveCheckins(readCheckins().map(item => (item.id === broker.id ? { ...item, lastSentAt: sentAt } : item)));
      setStatus(`Daily check-in sent to ${broker.email}.`);
    } catch (error) {
      setStatus(`Could not send the daily check-in to ${broker.email}: ${error.message}`);
    }
  };

  const openPreview = (prospect, kind) => {
    if (!settingsReady()) return;
    const sender = { ...settings, email: settings.email.trim() };
    setPreview({
      prospect, kind,
      subject: kind === 'followUp' ? `RE: ${prospectSubject(prospect, settings.subject)}` : prospectSubject(prospect, settings.subject),
      text: kind === 'followUp' ? buildFollowUpEmail(prospect, sender) : buildProspectEmail(prospect, sender)
    });
  };

  // One click emails every remaining "new" prospect without waiting for the 10-minute timer.
  const sendAllNew = async () => {
    if (!settingsReady()) return;
    const targets = rows.filter(row => row.status === 'new');
    for (const prospect of targets) {
      // eslint-disable-next-line no-await-in-loop
      await sendTo(prospect, 'intro', prospectSubject(prospect, settings.subject), buildProspectEmail(prospect, settings), { auto: true });
    }
  };

  // Checked prospects: the intro email goes to each one, one after the other.
  const sendSelected = async () => {
    if (!settingsReady()) return;
    const targets = rows.filter(row => row.status === 'new' && selected.has(row.id));
    let sent = 0;
    for (const prospect of targets) {
      setBulkProgress(`Sending ${sent + 1} of ${targets.length}… (${prospect.email})`);
      // eslint-disable-next-line no-await-in-loop
      await sendTo(prospect, 'intro', prospectSubject(prospect, settings.subject), buildProspectEmail(prospect, settings), { auto: true });
      sent += 1;
      setSelected(current => { const next = new Set(current); next.delete(prospect.id); return next; });
    }
    setBulkProgress('');
    if (sent) setStatus(`Sent the intro email to ${sent} broker(s).`);
  };

  const toggleSelected = id => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const setProspectStatus = async (prospect, nextStatus) => {
    await supabase.from('prospects').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', prospect.id);
    await loadRows();
  };

  const removeProspect = async prospect => {
    if (!window.confirm(`Delete ${prospect.email}?`)) return;
    await supabase.from('prospects').delete().eq('id', prospect.id);
    await loadRows();
  };

  if (!supabase) return null;
  const sendable = canSendHere();
  const newCount = rows.filter(row => row.status === 'new').length;
  const selectedNewCount = rows.filter(row => row.status === 'new' && selected.has(row.id)).length;
  const sorted = [...rows].sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
    || Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tms-tool"
        data-accent="emerald"
        title="New customers: paste DAT broker postings, email them from your Gmail, track replies"
      >
        📣 Prospects{newCount ? ` (${newCount})` : ''}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-label="Prospects">
          <div
            className="w-[52rem] max-w-full max-h-[85vh] overflow-y-auto bg-[#121829] border border-slate-500 rounded-lg shadow-2xl p-3 normal-case tracking-normal text-left"
            onPaste={onPaste}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-white">📣 Prospects - new customer outreach</h2>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowSettings(current => !current)} className="text-xs text-gray-300 hover:text-white cursor-pointer">⚙ Settings</button>
                <button type="button" onClick={() => setOpen(false)} className="text-gray-300 hover:text-white text-sm px-2 cursor-pointer" aria-label="Close prospects">✕</button>
              </div>
            </div>

            {showSettings && (
              <div className="border border-[#1c2541] rounded p-2 mb-3 grid grid-cols-2 gap-2">
                <label className="text-[10px] text-gray-400">Your name (signature)
                  <input type="text" value={settings.yourName} onChange={event => saveSettings({ ...settings, yourName: event.target.value })} className={inputClass} placeholder="Daniel …" />
                </label>
                <label className="text-[10px] text-gray-400">Agency name shown (never Broski; blank to leave out)
                  <input type="text" value={settings.agencyName} onChange={event => saveSettings({ ...settings, agencyName: event.target.value })} className={inputClass} />
                </label>
                <label className="text-[10px] text-gray-400">Phone
                  <input type="text" value={settings.phone} onChange={event => saveSettings({ ...settings, phone: event.target.value })} className={inputClass} />
                </label>
                <label className="text-[10px] text-gray-400">Reply-to email shown in the signature
                  <input type="text" value={settings.email} onChange={event => saveSettings({ ...settings, email: event.target.value })} className={inputClass} placeholder="trucks1224@gmail.com" />
                </label>
                <label className="text-[10px] text-gray-400 col-span-2">Subject line
                  <input type="text" value={settings.subject} onChange={event => saveSettings({ ...settings, subject: event.target.value })} className={inputClass} />
                </label>
                <p className="text-[10px] text-gray-500 col-span-2">Every email says "Independent Agent for Landstar - MC# 166960" and leads with no double brokering + constant updates. Broski is never mentioned.</p>
              </div>
            )}

            <div className="flex items-center gap-2 mb-2">
              <button type="button" onClick={pasteFromClipboard} disabled={Boolean(reading)} className="bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 px-2 py-1 text-[11px] font-bold rounded text-white cursor-pointer">
                {reading || '📋 Paste DAT screenshot'}
              </button>
              <span className="text-[10px] text-gray-400">Snip broker postings on DAT with Win+Shift+S, then paste here (or Ctrl+V in this panel).</span>
            </div>

            <div className="border border-[#1c2541] rounded p-2 mb-3">
              <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                <span className="text-xs font-bold text-white">🔁 Daily check-ins</span>
                <span className="text-[10px] text-gray-400">"Any loads available today?" emailed once a day while the TMS is open on this computer.</span>
              </div>
              {checkins.map(broker => (
                <div key={broker.id} className="flex items-center justify-between gap-2 text-xs py-0.5">
                  <div className={`min-w-0 flex-1 truncate ${broker.active === false ? 'text-gray-500' : 'text-white'}`}>
                    <span className="font-bold">{broker.contact || broker.email}</span>
                    {broker.company ? ` · ${broker.company}` : ''} · {broker.email}
                    <span className="text-[10px] text-gray-500 ml-2">
                      {broker.active === false ? 'paused' : (broker.lastSentAt ? `last sent ${new Date(broker.lastSentAt).toLocaleString()}` : 'not sent yet')}
                    </span>
                  </div>
                  <div className="flex gap-1 shrink-0 items-center">
                    <button type="button" disabled={!sendable || busyId !== null} onClick={() => { if (settingsReady()) void sendCheckin(broker, readSettings()); }} className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer">✉ Send now</button>
                    <button type="button" onClick={() => saveCheckins(readCheckins().map(item => (item.id === broker.id ? { ...item, active: item.active === false } : item)))} className="text-[10px] text-amber-300 hover:text-amber-200 cursor-pointer">{broker.active === false ? 'Resume' : 'Pause'}</button>
                    <button type="button" onClick={() => saveCheckins(readCheckins().filter(item => item.id !== broker.id))} className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer" aria-label={`Remove ${broker.email}`}>✕</button>
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 mt-1">
                <input type="text" value={newCheckin.contact} placeholder="Contact (Kevin)" onChange={event => setNewCheckin(current => ({ ...current, contact: event.target.value }))} className={inputClass} />
                <input type="text" value={newCheckin.company} placeholder="Company" onChange={event => setNewCheckin(current => ({ ...current, company: event.target.value }))} className={inputClass} />
                <input type="text" value={newCheckin.email} placeholder="Email" onChange={event => setNewCheckin(current => ({ ...current, email: event.target.value }))} className={inputClass} />
                <button type="button" onClick={addCheckin} className="bg-emerald-700 hover:bg-emerald-600 px-2 py-1 text-[10px] font-bold rounded text-white cursor-pointer">Add</button>
              </div>
            </div>
            {!sendable && <p className="text-[11px] text-amber-300 mb-2">Emails can only be sent from the TMS on the office computer (127.0.0.1:5173). Here you can still view and edit the list.</p>}
            {status && <p className="text-xs text-gray-300 mb-2">{status}</p>}

            {captured.length > 0 && (
              <div className="border border-emerald-700/60 rounded p-2 mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white">Found in the screenshot - check before saving</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={saveCaptured} className="bg-emerald-700 hover:bg-emerald-600 px-2 py-1 text-[10px] font-bold rounded text-white cursor-pointer">Save {captured.length}</button>
                    <button type="button" onClick={() => setCaptured([])} className="text-[10px] text-gray-400 hover:text-white cursor-pointer">Discard</button>
                  </div>
                </div>
                {captured.map((item, index) => (
                  <div key={item.email} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1 mb-1 items-center">
                    <input type="text" value={item.company} placeholder="Company" onChange={event => setCaptured(current => current.map((row, i) => (i === index ? { ...row, company: event.target.value } : row)))} className={inputClass} />
                    <input type="text" value={item.email} placeholder="Email" onChange={event => setCaptured(current => current.map((row, i) => (i === index ? { ...row, email: event.target.value.trim().toLowerCase() } : row)))} className={inputClass} />
                    <input type="text" value={item.phone} placeholder="Phone" onChange={event => setCaptured(current => current.map((row, i) => (i === index ? { ...row, phone: event.target.value } : row)))} className={inputClass} />
                    <input type="text" value={item.lane} placeholder="Lane" onChange={event => setCaptured(current => current.map((row, i) => (i === index ? { ...row, lane: event.target.value } : row)))} className={inputClass} />
                    <button type="button" onClick={() => setCaptured(current => current.filter((row, i) => i !== index))} className="text-gray-400 hover:text-white text-xs px-1 cursor-pointer" aria-label={`Remove ${item.email}`}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {preview && (
              <div className="border border-sky-700/60 rounded p-2 mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white">{preview.kind === 'followUp' ? 'Follow-up' : 'Intro email'} to {preview.prospect.email}</span>
                  <button type="button" onClick={() => setPreview(null)} className="text-[10px] text-gray-400 hover:text-white cursor-pointer">Cancel</button>
                </div>
                <input type="text" value={preview.subject} onChange={event => setPreview(current => ({ ...current, subject: event.target.value }))} className={`${inputClass} mb-1`} />
                <textarea value={preview.text} onChange={event => setPreview(current => ({ ...current, text: event.target.value }))} rows={14} className={`${inputClass} font-mono leading-snug`} />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-gray-400">New brokers are emailed automatically within 10 minutes - this preview is only for sending with your own edits.</span>
                  <button
                    type="button"
                    disabled={!sendable || busyId !== null}
                    onClick={() => sendTo(preview.prospect, preview.kind, preview.subject, preview.text)}
                    className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 px-3 py-1 text-[11px] font-bold rounded text-white cursor-pointer"
                  >
                    {busyId ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
              <label className="text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newCount > 0 && rows.filter(row => row.status === 'new').every(row => selected.has(row.id))}
                  onChange={event => setSelected(event.target.checked
                    ? new Set(rows.filter(row => row.status === 'new').map(row => row.id))
                    : new Set())}
                  disabled={!newCount}
                  aria-label="Select every new prospect"
                />
                {rows.length} prospect(s){newCount ? ` · select all new (${newCount})` : ''}
              </label>
              <div className="flex gap-2 items-center">
                {bulkProgress && <span className="text-[10px] text-amber-300">{bulkProgress}</span>}
                <button type="button" disabled={!sendable} onClick={() => checkReplies()} className="text-[10px] text-gray-300 hover:text-white disabled:opacity-50 cursor-pointer">↻ Check replies</button>
                {selectedNewCount > 0 && (
                  <button type="button" disabled={!sendable || busyId !== null || Boolean(bulkProgress)} onClick={sendSelected} className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 px-2 py-1 text-[10px] font-bold rounded text-white cursor-pointer">
                    ✉ Email selected ({selectedNewCount})
                  </button>
                )}
                {newCount > 0 && (
                  <button type="button" disabled={!sendable || busyId !== null || Boolean(bulkProgress)} onClick={sendAllNew} className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-2 py-1 text-[10px] font-bold rounded text-white cursor-pointer">
                    Send intro to all new ({newCount})
                  </button>
                )}
              </div>
            </div>
            {sorted.map(row => (
              <div key={row.id} className="border border-[#1c2541] rounded p-2 mb-1.5 text-xs text-white">
                <div className="flex items-start justify-between gap-2">
                  {row.status === 'new' && (
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      className="mt-1 shrink-0"
                      aria-label={`Select ${row.email}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-bold truncate">
                      {row.company || row.email}
                      <span className={`ml-2 font-bold ${statusColors[row.status] || 'text-gray-300'}`}>{statusLabels[row.status] || row.status}</span>
                      {isFollowUpDue(row) && <span className="ml-2 text-orange-300 font-bold">Follow-up due ({FOLLOW_UP_AFTER_DAYS}+ days, no answer)</span>}
                      {isProspectFollowUpExcluded(row) && <span className="ml-2 text-gray-400">Prospect follow-ups disabled</span>}
                    </div>
                    <div className="text-gray-300 truncate">{row.email}{row.phone ? ` · ${row.phone}` : ''}{row.lane ? ` · ${row.lane}` : ''}</div>
                    {row.emailed_at && <div className="text-[10px] text-gray-500">Emailed {new Date(row.emailed_at).toLocaleString()}{row.followed_up_at ? ` · followed up ${new Date(row.followed_up_at).toLocaleString()}` : ''}</div>}
                    {row.reply_snippet && <div className="text-[10px] text-emerald-200 mt-0.5">↩ {row.reply_snippet}</div>}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0 items-end">
                    {row.status === 'new' && (
                      <button type="button" disabled={!sendable || busyId !== null} onClick={() => openPreview(row, 'intro')} className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer">✉ Email</button>
                    )}
                    {isFollowUpDue(row) && (
                      <button type="button" disabled={!sendable || busyId !== null} onClick={() => openPreview(row, 'followUp')} className="bg-orange-700 hover:bg-orange-600 disabled:opacity-50 px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer">✉ Follow up</button>
                    )}
                    <div className="flex gap-1">
                      {row.status !== 'customer' && <button type="button" onClick={() => setProspectStatus(row, 'customer')} className="text-[10px] text-emerald-300 hover:text-emerald-200 cursor-pointer" title="They sent freight - mark as a customer">Customer</button>}
                      {row.status !== 'dead' && <button type="button" onClick={() => setProspectStatus(row, 'dead')} className="text-[10px] text-gray-400 hover:text-gray-200 cursor-pointer" title="Not interested">Dead</button>}
                      <button type="button" onClick={() => removeProspect(row)} className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer" aria-label={`Delete ${row.email}`}>✕</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {!rows.length && !captured.length && (
              <p className="text-xs text-gray-400">No prospects yet. Search broker postings on DAT, snip the results with the contact emails showing, and paste the screenshot here.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
