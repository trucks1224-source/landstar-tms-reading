// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { useState, useEffect } from 'react';
import { describeEmailWorker } from '../lib/emailWorker.js';

// The truck's own painted lights (roof and step markers, headlights, fog lights,
// under-glow) are cut out of the art into two layers so the glow sits exactly on them:
// public/truck-lights-yellow.png (roof, side and step markers) and
// public/truck-lights-under.png (white headlights, fog lights and under-glow). They flash for a few seconds after sign-in, then stay on.
// Lights the art doesn't have (mirrors, exhaust stacks) are added as dots; positions
// are percentages of the 1152x768 background, shown centered with "contain".
const truckLights = [
  // LED strips down the outer edge of each mirror
  ['mirror', 45.35, 40.2], ['mirror', 64.15, 37.9],
  // lights running up the left exhaust stack, bottom to top
  ['stack', 43.6, 54.6], ['stack', 43.3, 51], ['stack', 42.9, 47.4], ['stack', 42.6, 43.8], ['stack', 42.3, 40.2],
  ['stack', 42, 36.6], ['stack', 41.7, 33], ['stack', 41.4, 29.4],
];

// Exhaust stack tops; smoke rises from here all the time.
const truckStacks = [[41, 27.6], [56.3, 22.8]];

const smokePuffs = 12;

const truckFlashMs = 6000;

function TruckLights() {
  const [flashing, setFlashing] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setFlashing(false), truckFlashMs);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="tms-truck-fx" aria-hidden="true">
      <div className="tms-truck-box">
        <div className={`tms-broski-badge${flashing ? ' is-flashing' : ''}`} />
        {truckStacks.map(([x, y], stack) => (
          <div key={`stack-${stack}`} className="tms-smoke" style={{ left: `${x}%`, top: `${y}%` }}>
            {Array.from({ length: smokePuffs }, (_, puff) => (
              <span key={puff} style={{ animationDelay: `${-(puff * 0.4 + stack * 0.2).toFixed(1)}s` }} />
            ))}
          </div>
        ))}
        <div className={`tms-truck-lit${flashing ? ' is-flashing' : ''}`}>
          <div className="tms-truck-glow is-yellow" />
          <div className="tms-truck-glow is-under" />
          {truckLights.map(([kind, x, y], index) => (
            <span
              key={index}
              className={`tms-truck-light is-${kind}`}
              style={{ left: `${x}%`, top: `${y}%`, '--chase': index }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const canStartBotHere = () => typeof window !== 'undefined'
  && ['127.0.0.1', 'localhost'].includes(window.location?.hostname);

function LocalBotsSwitch() {
  const [enabled, setEnabled] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch('/api/local-bots', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
        const result = await response.json();
        if (!response.ok || typeof result.enabled !== 'boolean') throw new Error(result.error || 'Invalid bot control status');
        if (active) { setEnabled(result.enabled); setError(''); }
      } catch (err) {
        if (active) { setEnabled(null); setError(`Bot control unavailable: ${err.message}`); }
      }
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const toggle = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/local-bots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }), signal: AbortSignal.timeout(3000)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not change bot control');
      setEnabled(result.enabled);
      setError('');
    } catch (err) { setError(`Bot control unavailable: ${err.message}`); }
    finally { setBusy(false); }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" disabled={enabled === null || busy} onClick={toggle}
        aria-label={enabled ? 'Pause local bots' : 'Resume local bots'}
        title="Pauses posting, helper, rate and removal workers after their current task. Email automation is separate. Start Everything must be running to restart missing workers."
        className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs px-2.5 py-1 rounded">
        {enabled === null ? 'Bot control unavailable' : enabled ? 'Pause all local bots' : 'Resume local bots'}
      </button>
      {error && <span role="alert" className="text-amber-300 text-xs">{error}</span>}
    </span>
  );
}

function describeRateWorker(status) {
  if (status.state === 'off') return 'Rate worker off';
  if (status.state === 'signing-in') return 'Rate worker: sign in to Landstar';
  if (status.state === 'starting') return 'Rate worker starting';
  if (status.state === 'blocked') return 'Rate worker: needs attention';
  if (status.state === 'working') return 'Rate worker: checking';
  return status.state === 'logged-in' ? 'Rate worker on' : 'Rate worker: status unavailable';
}

function RateWorkerLight() {
  const [status, setStatus] = useState({ state: 'off', message: 'Rate worker is not running' });
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!canStartBotHere()) return undefined;
    let cancelled = false;
    let timer;
    const check = async () => {
      try {
        const response = await fetch('/api/rates/status', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error(`Rate-worker status returned HTTP ${response.status}`);
        const next = await response.json();
        if (!cancelled) { setStatus(next); setError(''); }
      } catch (failure) {
        if (!cancelled) setError(`Rate-worker status unavailable: ${failure.message}`);
      } finally {
        if (!cancelled) timer = setTimeout(check, 5000);
      }
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  if (!canStartBotHere()) return null;
  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const response = await fetch('/api/rates/start', { method: 'POST', signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start the rate worker.');
      setStatus({ state: 'starting', message: 'Opening rate-worker browser; sign in if asked' });
    } catch (failure) {
      setError(failure.message);
    } finally { setStarting(false); }
  };
  const label = starting ? 'Rate worker starting' : describeRateWorker(status);
  return (
    <details className="relative normal-case tracking-normal text-left text-xs" aria-label="Rate worker">
      <summary className="bg-slate-800 border border-slate-600 rounded px-2.5 py-1 cursor-pointer">
        <span role="status">{error ? 'Rate worker: needs attention' : label}</span>
      </summary>
      <div className="absolute right-0 bottom-full mb-2 z-50 w-72 max-w-[90vw] bg-slate-900 border border-slate-600 rounded p-3 shadow-xl space-y-2">
        <p>{error || status.message}</p>
        <p>Prepares export rates using the Landstar board. DAT API quotes remain in the TMS. This worker never uploads loads.</p>
        {status.state === 'off' && <button type="button" disabled={starting} onClick={start} className="bg-blue-600 rounded px-3 py-1 disabled:opacity-50">Start rate worker</button>}
      </div>
    </details>
  );
}

// The helper bot (bot/helper.js): Assign Capacity, Clarity and MercuryGate in its own window.
// Its state comes through the main bot's status; when it's off, a click starts it.
function HelperBotLight({ helper }) {
  const [starting, setStarting] = useState(0);
  const state = helper?.state || 'off';
  const isOn = state === 'logged-in' || state === 'working';
  const color = isOn ? '#22c55e' : state === 'signing-in' || (starting && Date.now() - starting < 60000) ? '#facc15' : '#64748b';
  const dot = <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: color === '#64748b' ? 'none' : `0 0 8px ${color}`, display: 'inline-block' }} />;
  const label = isOn ? `Helper ${state === 'working' ? `· ${helper.message || 'working'}` : 'on'}`
    : state === 'signing-in' ? 'Helper · sign in to Landstar in its window' : starting ? 'Helper starting…' : 'Helper off · Start';
  if (!isOn && state !== 'signing-in' && canStartBotHere()) {
    return (
      <button
        type="button"
        onClick={async () => {
          setStarting(Date.now());
          try {
            const response = await fetch('/api/helper/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'The helper bot could not be started.');
          } catch (error) {
            setStarting(0);
            alert(`${error.message}\n\nYou can also double-click "Start Helper Bot.bat" in the bot folder.`);
          }
        }}
        title="The helper bot does Assign Capacity, Clarity checks and MercuryGate so the main bot can keep uploading. Click to start it."
        className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs px-2.5 py-1 rounded font-medium normal-case tracking-normal cursor-pointer border border-slate-600"
      >
        {dot}
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-xs px-2.5 py-1 rounded font-medium normal-case tracking-normal" title={helper?.message || label} role="status">
      {dot}
      {label}
    </span>
  );
}

// The email worker chip in the header: redraws on its own when the worker reports.
function EmailWorkerStatus({ store, drafts }) {
  const [status, setStatus] = useState(store.get);
  useEffect(() => {
    setStatus(store.get());
    return store.subscribe(setStatus);
  }, [store]);
  return (
    <details className="relative normal-case tracking-normal text-left text-xs" aria-label="Driver-to-broker worker">
      <summary className="bg-slate-800 border border-slate-600 rounded px-2.5 py-1 cursor-pointer">
        <span role="status" aria-live="polite">{describeEmailWorker(status, drafts)}</span>
      </summary>
      <div className="absolute left-0 top-full mt-2 z-50 w-80 max-w-[90vw] max-h-[60vh] overflow-y-auto bg-slate-900 border border-slate-600 rounded p-3 shadow-xl space-y-2">
        <p>{status.message}</p>
        {status.lastCheckedAt && <p>Last completed check: {new Date(status.lastCheckedAt).toLocaleTimeString()}</p>}
        <p>Runs while the local TMS is open. Posting runs separately. Only one local tab runs automatic email checks.</p>
        {status.issues.map(issue => <p key={issue.task} className="text-amber-300">{issue.task}: {issue.message}</p>)}
        {drafts.some(draft => draft.error) && <p className="text-amber-300">Email send failures are shown in Booked Loads.</p>}
        {drafts.some(draft => !draft.error && !draft.sending) && <p>Emails awaiting approval are in Booked Loads.</p>}
      </div>
    </details>
  );
}

export {
  truckLights,
  truckStacks,
  smokePuffs,
  truckFlashMs,
  TruckLights,
  canStartBotHere,
  LocalBotsSwitch,
  describeRateWorker,
  RateWorkerLight,
  HelperBotLight,
  EmailWorkerStatus
};
