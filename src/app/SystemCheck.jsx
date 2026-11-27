// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { useState, useEffect } from 'react';

// Morning system check (header): TMS, watchdog, every bot, the bot switch, a recent PC
// restart (from /api/health, bot/health.js) and this tab's email checks. Opens by itself
// once a day when something needs attention. Polls on its own, so it never redraws the App.
const SYSTEM_CHECK_URL = '/api/health';

const systemCheckShownKey = 'landstar_systemCheckShownOn';

const systemCheckColors = { ok: 'bg-emerald-400', info: 'bg-sky-400', warn: 'bg-amber-400', bad: 'bg-red-500' };

const systemCheckRank = { ok: 0, info: 1, warn: 2, bad: 3 };

function emailCheckRow(status = {}) {
  if (status.state === 'blocked') {
    return { id: 'email', label: 'Email checks', level: 'warn', detail: status.message || 'Some checks need attention',
      fix: (status.issues || []).map(issue => `${issue.task}: ${issue.message}`).join(' · ') || 'Open the email worker chip for details.' };
  }
  if (status.state === 'standby') return { id: 'email', label: 'Email checks', level: 'info', detail: 'Another TMS tab runs the email checks' };
  if (status.state === 'view-only') return { id: 'email', label: 'Email checks', level: 'info', detail: 'Email checks run only on the local TMS' };
  return { id: 'email', label: 'Email checks', level: 'ok', detail: status.message || 'Running' };
}

function mergeSystemCheck(report, emailStatus) {
  if (!report) {
    return { worst: 'bad', rows: [{ id: 'tms', label: 'TMS server', level: 'bad', detail: 'Not answering', fix: 'The watchdog restarts it within a minute. If it does not, double-click "Start TMS".' }] };
  }
  const rows = [...(report.rows || []), emailCheckRow(emailStatus)];
  const worst = rows.reduce((level, row) => (systemCheckRank[row.level] > systemCheckRank[level] ? row.level : level), 'ok');
  return { ...report, rows, worst };
}

function SystemCheck({ emailStore }) {
  const [report, setReport] = useState(undefined);
  const [emailStatus, setEmailStatus] = useState(emailStore.get);
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setEmailStatus(emailStore.get());
    return emailStore.subscribe(setEmailStatus);
  }, [emailStore]);
  // Daniel checked Gmail for a send that never finished: it went out, or it may be sent again.
  const settleEmail = async (key, wentOut) => {
    try {
      const response = await fetch('/api/email-record', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'settle', key, wentOut })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
    } catch (error) {
      alert(`Could not update the email record: ${error.message}`);
    }
    setRefresh(value => value + 1);
  };
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(SYSTEM_CHECK_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = await response.json();
        if (!cancelled) setReport(current => (JSON.stringify(current) === JSON.stringify({ ...next, at: current?.at }) ? current : next));
      } catch {
        if (!cancelled) setReport(null);
      }
    };
    void check();
    const timer = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [refresh]);
  const merged = report === undefined ? null : mergeSystemCheck(report, emailStatus);
  // First look of the day with something to fix: open the panel by itself.
  useEffect(() => {
    if (!merged || systemCheckRank[merged.worst] < systemCheckRank.warn) return;
    const today = new Date().toDateString();
    try {
      if (localStorage.getItem(systemCheckShownKey) === today) return;
      localStorage.setItem(systemCheckShownKey, today);
    } catch { /* storage blocked: still open once for this page */ }
    setOpen(true);
  }, [merged?.worst]);
  const worst = merged?.worst || 'info';
  const problems = merged ? merged.rows.filter(row => systemCheckRank[row.level] >= systemCheckRank.warn).length : 0;
  return (
    <div className="relative normal-case tracking-normal text-left text-xs">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="bg-slate-800 border border-slate-600 rounded px-2.5 py-1 cursor-pointer flex items-center gap-1.5"
      >
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${systemCheckColors[worst]}`} aria-hidden="true" />
        <span role="status">{!merged ? 'System check…' : problems ? `System check: ${problems} to fix` : 'System check: all good'}</span>
      </button>
      {open && merged && (
        <div role="dialog" aria-label="System check" className="absolute right-0 top-full mt-2 z-50 w-96 max-w-[92vw] max-h-[70vh] overflow-y-auto bg-slate-900 border border-slate-600 rounded p-3 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-bold text-white">System check</p>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-white cursor-pointer" aria-label="Close system check">✕</button>
          </div>
          {merged.rows.map(row => (
            <div key={row.id} className="flex items-start gap-2">
              <span className={`mt-1 inline-block w-2.5 h-2.5 shrink-0 rounded-full ${systemCheckColors[row.level]}`} aria-hidden="true" />
              <div>
                <p className="text-white"><span className="font-semibold">{row.label}:</span> {row.detail}</p>
                {row.fix && <p className={row.level === 'bad' ? 'text-red-300' : 'text-amber-300'}>{row.fix}</p>}
                {(row.emails || []).map(email => (
                  <div key={email.key} className="mt-1 bg-slate-800 rounded p-1.5">
                    <p className="text-white">{email.label}{email.at ? ` · started ${new Date(email.at).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</p>
                    <div className="flex gap-2 mt-1">
                      <button type="button" onClick={() => settleEmail(email.key, true)} className="bg-emerald-700 hover:bg-emerald-600 text-white px-2 py-0.5 rounded cursor-pointer">It went out</button>
                      <button type="button" onClick={() => settleEmail(email.key, false)} className="bg-slate-600 hover:bg-slate-500 text-white px-2 py-0.5 rounded cursor-pointer">Not sent, allow again</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {merged.at && <p className="text-gray-500">Checked {new Date(merged.at).toLocaleTimeString()} · refreshes every 30 seconds</p>}
        </div>
      )}
    </div>
  );
}

export {
  SYSTEM_CHECK_URL,
  systemCheckShownKey,
  systemCheckColors,
  systemCheckRank,
  emailCheckRow,
  mergeSystemCheck,
  SystemCheck
};
