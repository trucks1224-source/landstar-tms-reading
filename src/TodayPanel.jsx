// 🚨 Problem banner and 📅 Today panel (Daniel 2026-11-27).
//
// ProblemBanner: a strip across the top of the TMS for what needs Daniel now (uploads to
// Landstar failing, a bot waiting for a sign-in or down, uploads Landstar never confirmed).
// Red = act now, amber = look soon. A new problem plays an alarm and shows a Windows
// notification (when allowed), so it is noticed even with the TMS behind other windows.
// "Hide 30 min" puts one away; it comes back if it is still there.
//
// TodayPanel: one window with today's work per account (exported, booked, files posted or
// failed, rates the bot raised, loads skipped because ATZ has them, loads on hot lanes) and a
// timeline. Data: GET /api/today (bot/today.js) plus the TMS's own loads.
import { useEffect, useRef, useState } from 'react';
import { visibleProblems, newProblems, summarizeTodayByAccount, todayTotals, todayTimeline } from './lib/todayPanel';

const hiddenKey = 'landstar_hiddenProblems';
const timeOf = ms => (ms ? new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');

function readHidden() {
  try { return JSON.parse(localStorage.getItem(hiddenKey) || '{}') || {}; } catch { return {}; }
}

// Three rising beeps, loud enough to hear across the room; quiet if the browser blocks sound.
function playAlarm() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [0, 0.35, 0.7].forEach((offset, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 660 + index * 220;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.3);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch { /* no sound */ }
}

function notifyWindows(problem) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const note = new Notification(`🚨 TMS: ${problem.title}`, { body: problem.detail || '', tag: problem.key, requireInteraction: problem.level === 'bad' });
    note.onclick = () => { window.focus(); note.close(); };
  } catch { /* no notification */ }
}

export function ProblemBanner({ problems = [] }) {
  const [hidden, setHidden] = useState(readHidden);
  const [clock, setClock] = useState(Date.now());
  const seen = useRef(null);
  const [canNotify, setCanNotify] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted');

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const shown = visibleProblems(problems, hidden, clock);

  // Alarm and Windows notification for problems not on screen before (not on the first load:
  // problems already there when the TMS opens only show in the banner, without a sound).
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(problems.map(problem => problem.key));
      return;
    }
    const fresh = newProblems(shown, seen.current);
    problems.forEach(problem => seen.current.add(problem.key));
    if (!fresh.length) return;
    playAlarm();
    fresh.forEach(notifyWindows);
  }, [problems.map(problem => problem.key).join('|')]);

  const hide = key => {
    const next = { ...hidden, [key]: Date.now() };
    // Forget hides older than a day.
    Object.keys(next).forEach(item => { if (Date.now() - next[item] > 24 * 60 * 60 * 1000) delete next[item]; });
    setHidden(next);
    try { localStorage.setItem(hiddenKey, JSON.stringify(next)); } catch { /* hidden for this visit */ }
  };

  const askNotify = async () => {
    try { setCanNotify((await Notification.requestPermission()) === 'granted'); } catch { /* not allowed */ }
  };

  if (!shown.length) return null;
  const worst = shown.some(problem => problem.level === 'bad') ? 'bad' : 'warn';
  return (
    <div role="alert" aria-label="Problems that need you" className={`fixed top-0 inset-x-0 z-[60] max-h-[40vh] overflow-y-auto border-b-2 px-3 py-2 shadow-2xl normal-case tracking-normal text-left ${worst === 'bad' ? 'bg-red-950/95 border-red-500' : 'bg-amber-950/95 border-amber-400'}`}>
      <div className="flex flex-col gap-1.5">
        {shown.map(problem => (
          <div key={problem.key} className="flex items-start gap-2 text-xs">
            <span className={`shrink-0 font-bold px-1.5 py-0.5 rounded ${problem.level === 'bad' ? 'bg-red-600 text-white' : 'bg-amber-400 text-black'}`}>{problem.level === 'bad' ? '🚨 ACT NOW' : '⚠ CHECK'}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-white">{problem.title}</div>
              {problem.detail && <div className="text-gray-200 break-words">{problem.detail}</div>}
            </div>
            <button type="button" onClick={() => hide(problem.key)} className="shrink-0 text-gray-300 hover:text-white underline cursor-pointer" title="Hide this for 30 minutes (it comes back if it is still a problem)">Hide 30 min</button>
          </div>
        ))}
        {!canNotify && typeof Notification !== 'undefined' && Notification.permission !== 'denied' && (
          <button type="button" onClick={askNotify} className="self-start text-[11px] text-sky-300 hover:text-white underline cursor-pointer">
            Also show these as Windows notifications (so you see them with the TMS in the background)
          </button>
        )}
      </div>
    </div>
  );
}

export function TodayPanel({ today, ordersMap = {}, isHotLane = () => false, onOpenAccount = null }) {
  const [open, setOpen] = useState(false);
  const rows = summarizeTodayByAccount(today, ordersMap, isHotLane);
  const totals = todayTotals(today, rows);
  const timeline = todayTimeline(today);
  const problems = today?.problems || [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Today: what went out, what the bots did and what needs you, per account"
        className={`text-xs px-2.5 py-1 rounded font-semibold cursor-pointer normal-case tracking-normal ${problems.some(problem => problem.level === 'bad') ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-white'}`}
      >
        📅 Today{totals.exported ? ` · ${totals.exported} out` : ''}{problems.length ? ` · ${problems.length} ⚠` : ''}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-label="Today">
          <div className="w-[68rem] max-w-full max-h-[88vh] overflow-y-auto bg-[#121829] border border-slate-500 rounded-lg shadow-2xl p-4 normal-case tracking-normal text-left">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-white">📅 Today · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-300 hover:text-white text-sm px-2 cursor-pointer" aria-label="Close Today">✕</button>
            </div>
            {!today && <p className="text-xs text-gray-400 mb-3">The bots' activity shows only in the TMS on the bot PC (127.0.0.1:5173). Your exports and bookings are below.</p>}

            <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-4">
              {[
                ['Exported', totals.exported, 'Loads exported to Landstar from the TMS'],
                ['Booked', totals.booked, 'Loads booked today'],
                ['Files posted', totals.filesPosted, 'Spreadsheets the upload bot posted on Landstar'],
                ['Files failed', totals.filesFailed, 'Upload attempts that did not go through', totals.filesFailed ? 'text-red-300' : ''],
                ['Rates raised', totals.raised, 'Rates the bot raised to beat another agent on the board'],
                ['ATZ had it', totals.skippedAtz, 'Loads not posted because ATZ already has them'],
                ['To check', totals.reviews, 'Uploads Landstar never confirmed (Downloads\\landstar-upload-review)', totals.reviews ? 'text-amber-300' : ''],
                ['From chat', totals.chat, 'Lists and loads that came in from Google Chat']
              ].map(([label, value, title, color = '']) => (
                <div key={label} title={title} className="bg-slate-800/60 border border-slate-700 rounded p-2 text-center">
                  <div className={`text-xl font-bold ${color || 'text-white'}`}>{value}</div>
                  <div className="text-[10px] uppercase text-gray-400">{label}</div>
                </div>
              ))}
            </div>

            {problems.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-bold text-red-300 uppercase mb-1">Needs you</h3>
                <ul className="space-y-1">
                  {problems.map(problem => (
                    <li key={problem.key} className={`text-xs rounded px-2 py-1 ${problem.level === 'bad' ? 'bg-red-950 text-red-100' : 'bg-amber-950 text-amber-100'}`}>
                      <b>{problem.title}</b>{problem.detail ? ` · ${problem.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <h3 className="text-xs font-bold text-gray-300 uppercase mb-1">By account</h3>
            {rows.length === 0 ? (
              <p className="text-xs text-gray-500 mb-4">Nothing exported, posted or booked yet today.</p>
            ) : (
              <table className="w-full text-xs text-gray-200 border-collapse mb-4">
                <thead>
                  <tr className="text-[10px] uppercase text-gray-400 border-b border-slate-600">
                    <th className="text-left py-1 pr-2">Account</th>
                    <th className="text-right pr-2" title="Loads exported to Landstar today">Exported</th>
                    <th className="text-right pr-2">Booked</th>
                    <th className="text-right pr-2" title="Spreadsheets posted / failed">Files ok / failed</th>
                    <th className="text-right pr-2" title="Loads the bot checked on the Landstar board">Checked</th>
                    <th className="text-right pr-2">Raised</th>
                    <th className="text-right pr-2" title="Not posted: ATZ already has the load">ATZ had it</th>
                    <th className="text-right pr-2" title="Open loads on a hot lane (other agents book them)">🔥 Hot</th>
                    <th className="text-right pr-2">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.key} className="border-b border-slate-800 hover:bg-slate-800/50">
                      <td className="py-1 pr-2">
                        {onOpenAccount && ordersMap[row.name] ? (
                          <button type="button" onClick={() => { onOpenAccount(row.name); setOpen(false); }} className="text-sky-300 hover:text-white cursor-pointer text-left">{row.name}</button>
                        ) : row.name}
                      </td>
                      <td className="text-right pr-2 font-bold text-emerald-300">{row.exported || ''}</td>
                      <td className="text-right pr-2 font-bold text-purple-300">{row.booked || ''}</td>
                      <td className="text-right pr-2">{row.filesPosted || row.filesFailed ? <>{row.filesPosted}{row.filesFailed ? <span className="text-red-300"> / {row.filesFailed}</span> : ''}</> : ''}</td>
                      <td className="text-right pr-2 text-gray-400">{row.checked || ''}</td>
                      <td className="text-right pr-2">{row.raised || ''}</td>
                      <td className="text-right pr-2 text-gray-400">{row.skippedAtz || ''}</td>
                      <td className="text-right pr-2">{row.onHotLane || ''}</td>
                      <td className="text-right pr-2 text-gray-400 whitespace-nowrap">{timeOf(row.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {timeline.length > 0 && (
              <>
                <h3 className="text-xs font-bold text-gray-300 uppercase mb-1">Timeline</h3>
                <ul className="text-xs space-y-0.5">
                  {timeline.map((item, index) => (
                    <li key={`${item.kind}-${item.at}-${index}`} className="flex gap-2">
                      <span className="text-gray-500 w-28 shrink-0 whitespace-nowrap">{item.count > 1 ? `${timeOf(item.at)}-${timeOf(item.lastAt)}` : timeOf(item.at)}</span>
                      {item.kind === 'posted' && <span className="text-emerald-300">✓ Posted on Landstar: {item.account}</span>}
                      {item.kind === 'failed' && <span className="text-red-300">✕ {item.account ? `${item.account}: ` : ''}{item.message}{item.count > 1 ? ` (${item.count} times)` : ''}</span>}
                      {item.kind === 'chat' && <span className="text-sky-300">💬 {item.account}: {item.type === 'load' ? item.label : item.type === 'spreadsheet' ? `list "${item.label || 'no name'}"` : 'picture'}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
