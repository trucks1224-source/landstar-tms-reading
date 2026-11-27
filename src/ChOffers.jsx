// 💲 CH Offers: what to offer on C.H. Robinson loads (Daniel, 2026-11-25).
// Copy Navisphere's Find Loads results (Ctrl+A, Ctrl+C), paste here: every load gets its DAT
// rate and your offer, DAT + $500 (CH posts low). You make the offers yourself in Navisphere;
// nothing here touches C.H. Robinson's site (a bot there could get the Landstar account flagged).
import { useState } from 'react';
import { parseNavisphereLoads, chOfferAmount, chLaneKey, CH_OFFER_OVER_DAT, CH_COPY_BOOKMARKLET } from './lib/chOffers';

const storageKey = 'landstar_chOffers';
const money = value => (value > 0 ? `$${Math.round(value).toLocaleString('en-US')}` : '—');

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    return saved && Array.isArray(saved.loads) ? saved : { loads: [], at: 0 };
  } catch {
    return { loads: [], at: 0 };
  }
}

async function datRate(load) {
  const response = await fetch('/api/dat-rate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: { city: load.origin.city, state: load.origin.state, zip: '' },
      destination: { city: load.destination.city, state: load.destination.state, zip: '' },
      equipment: load.equipmentCode,
      // CH offers use DAT's spot rate (Daniel, 2026-11-25); the rest of the TMS stays contract-first.
      rateType: 'spot'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (data?.rate > 0) return { rate: Number(data.rate), error: '' };
  return { rate: 0, error: data?.error || `DAT rate request failed (${response.status})` };
}

export default function ChOffers() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState(readSaved);
  const [busy, setBusy] = useState('');
  const [sortBy, setSortBy] = useState('gap');
  const [copied, setCopied] = useState('');

  const save = next => {
    setState(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* the list still shows */ }
  };

  const readLoads = async () => {
    const { loads, skipped } = parseNavisphereLoads(text);
    if (!loads.length) {
      setBusy('');
      alert('No loads found. In Navisphere, open Find Loads results, press Ctrl+A then Ctrl+C, and paste here.');
      return;
    }
    // One DAT lookup per lane and equipment, a few at a time.
    const lanes = [...new Map(loads.map(load => [chLaneKey(load), load])).values()];
    const rates = new Map();
    let done = 0;
    const queue = [...lanes];
    const worker = async () => {
      for (let lane = queue.shift(); lane; lane = queue.shift()) {
        rates.set(chLaneKey(lane), await datRate(lane).catch(error => ({ rate: 0, error: error.message })));
        done += 1;
        setBusy(`Getting DAT rates: ${done} of ${lanes.length} lanes...`);
      }
    };
    setBusy(`Getting DAT rates: 0 of ${lanes.length} lanes...`);
    await Promise.all([worker(), worker(), worker()]);
    const priced = loads.map(load => {
      const { rate, error } = rates.get(chLaneKey(load)) || { rate: 0, error: 'no DAT rate' };
      const offer = chOfferAmount(rate);
      return { ...load, datRate: rate, datError: error, offer, overCh: offer && load.chRate ? offer - load.chRate : 0 };
    });
    save({ loads: priced, at: Date.now(), skipped });
    setText('');
    setBusy('');
  };

  const copyText = async (value, id) => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(id);
      setTimeout(() => setCopied(current => (current === id ? '' : current)), 2000);
    } catch {
      alert(String(value));
    }
  };
  const copyOffer = load => copyText(load.offer, load.key);

  const sorted = [...state.loads].sort((a, b) => {
    if (sortBy === 'pickup') return new Date(`${a.pickupDate} ${a.pickupTime.split(' - ')[0]}`) - new Date(`${b.pickupDate} ${b.pickupTime.split(' - ')[0]}`);
    if (sortBy === 'offer') return b.offer - a.offer;
    // Origin city A-Z (then state, then pickup date), so loads from one city sit together.
    if (sortBy === 'origin') {
      return a.origin.city.localeCompare(b.origin.city) || a.origin.state.localeCompare(b.origin.state)
        || new Date(`${a.pickupDate} ${a.pickupTime.split(' - ')[0]}`) - new Date(`${b.pickupDate} ${b.pickupTime.split(' - ')[0]}`);
    }
    // Biggest gap first; Make Offer loads (no CH rate) after, then loads without a DAT rate.
    const score = load => (load.offer ? (load.chRate ? load.overCh : -1) : -2);
    return score(b) - score(a);
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tms-tool"
        data-accent="emerald"
        title="C.H. Robinson offers: paste Navisphere Find Loads results, see DAT rate + $500 for each load"
      >
        💲 CH Offers{state.loads.length ? ` (${state.loads.length})` : ''}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-label="CH Offers">
          <div className="w-[64rem] max-w-full max-h-[88vh] overflow-y-auto bg-[#121829] border border-slate-500 rounded-lg shadow-2xl p-3 normal-case tracking-normal text-left">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-white">💲 C.H. Robinson offers - DAT spot rate + ${CH_OFFER_OVER_DAT}</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-300 hover:text-white text-sm px-2 cursor-pointer" aria-label="Close CH offers">✕</button>
            </div>
            <p className="text-xs text-gray-400 mb-2">
              In Navisphere: Find Loads → your search → click your <b className="text-gray-200">Copy CH loads</b> bookmark (copies load numbers too), or press <b className="text-gray-200">Ctrl+A</b>, <b className="text-gray-200">Ctrl+C</b>. Paste below. You make each offer yourself in Navisphere (never "Book" here).
            </p>
            <details className="mb-2 text-xs text-gray-300 bg-slate-800/50 border border-slate-600 rounded p-2">
              <summary className="cursor-pointer font-semibold text-gray-200">One-time setup: the Copy CH loads bookmark (gets the load numbers)</summary>
              <ol className="list-decimal ml-5 mt-1 space-y-0.5">
                <li>Click <button type="button" onClick={() => copyText(CH_COPY_BOOKMARKLET, 'bookmarklet')} className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded text-[11px] cursor-pointer">{copied === 'bookmarklet' ? '✓ Copied' : '📋 Copy bookmark code'}</button></li>
                <li>In Chrome, right-click the bookmarks bar → <b>Add page...</b></li>
                <li>Name: <b>Copy CH loads</b> · URL: paste (Ctrl+V) · Save</li>
                <li>On Navisphere's Find Loads results, click <b>Copy CH loads</b>, then paste here.</li>
              </ol>
              <p className="mt-1 text-gray-400">It only reads the loads already on your screen (like Ctrl+C); it never clicks, searches or sends anything to C.H. Robinson.</p>
            </details>
            <textarea
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder="Paste the Navisphere Find Loads page here"
              className="w-full h-24 bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white font-mono"
            />
            <div className="flex items-center gap-2 mt-2 mb-3">
              <button
                type="button"
                onClick={() => { setBusy('Reading loads...'); void readLoads(); }}
                disabled={!text.trim() || Boolean(busy)}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded font-semibold cursor-pointer"
              >
                Read loads and get DAT rates
              </button>
              {busy && <span className="text-xs text-emerald-300">{busy}</span>}
              {!busy && state.at > 0 && (
                <span className="text-xs text-gray-400">
                  {state.loads.length} loads read {new Date(state.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  {state.skipped ? ` · ${state.skipped} could not be read` : ''}
                </span>
              )}
              <label className="ml-auto text-xs text-gray-400">
                Sort{' '}
                <select value={sortBy} onChange={event => setSortBy(event.target.value)} className="bg-[#0b132b] border border-[#1c2541] rounded px-1 py-0.5 text-white">
                  <option value="gap">Biggest gap over CH rate</option>
                  <option value="pickup">Pickup date</option>
                  <option value="offer">Highest offer</option>
                  <option value="origin">Origin city (A-Z)</option>
                </select>
              </label>
            </div>
            {sorted.length > 0 && (
              <table className="w-full text-xs text-gray-200 border-collapse">
                <thead>
                  <tr className="text-[10px] uppercase text-gray-400 border-b border-slate-600">
                    <th className="text-left py-1 pr-2">Load #</th>
                    <th className="text-left pr-2">Pickup</th>
                    <th className="text-left pr-2">Lane</th>
                    <th className="text-right pr-2">Miles</th>
                    <th className="text-right pr-2">DH</th>
                    <th className="text-left pr-2">Equip</th>
                    <th className="text-right pr-2">Weight</th>
                    <th className="text-right pr-2">CH rate</th>
                    <th className="text-right pr-2">DAT spot</th>
                    <th className="text-right pr-2">Your offer</th>
                    <th className="text-right pr-2">Over CH</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(load => (
                    <tr key={load.key} className="border-b border-slate-800 hover:bg-slate-800/50">
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {load.loadNumber ? (
                          <button type="button" onClick={() => copyText(load.loadNumber, `n-${load.key}`)} title="Copy the load number for Navisphere's Load Number search" className="font-mono text-sky-300 hover:text-white cursor-pointer">
                            {copied === `n-${load.key}` ? '✓ copied' : load.loadNumber}
                          </button>
                        ) : <span className="text-gray-500">—</span>}
                      </td>
                      <td className="pr-2 whitespace-nowrap">{load.pickupDate.slice(0, 5)} {load.pickupTime}</td>
                      <td className="pr-2">
                        {load.origin.city}, {load.origin.state} → {load.destination.city}, {load.destination.state}
                        {load.stops && load.stops !== '1 pick, 1 drop' && <span className="text-amber-300"> · {load.stops}</span>}
                      </td>
                      <td className="text-right pr-2">{load.miles.toLocaleString('en-US')}</td>
                      <td className="text-right pr-2 text-gray-400">{Math.round(load.deadheadMiles)}</td>
                      <td className="pr-2 whitespace-nowrap">
                        {load.equipment}{load.endorsement && <span className="text-amber-300"> · {load.endorsement}</span>}
                      </td>
                      <td className="text-right pr-2">{load.weight.toLocaleString('en-US')}</td>
                      <td className="text-right pr-2 whitespace-nowrap">
                        {load.chRate ? money(load.chRate) : <span className="text-sky-300">Make Offer</span>}
                        {load.status && <div className="text-[10px] text-amber-300">{load.status}</div>}
                      </td>
                      <td className="text-right pr-2" title={load.datError || ''}>{load.datRate ? money(load.datRate) : <span className="text-red-300">none</span>}</td>
                      <td className="text-right pr-2 font-bold text-emerald-300">{money(load.offer)}</td>
                      <td className="text-right pr-2 text-gray-300">{load.overCh > 0 ? `+${money(load.overCh)}` : ''}</td>
                      <td className="whitespace-nowrap">
                        {load.offer > 0 && (
                          <button
                            type="button"
                            onClick={() => copyOffer(load)}
                            title="Copy your offer to paste into Navisphere's Make Offer"
                            className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded text-[11px] cursor-pointer"
                          >
                            {copied === load.key ? '✓ Copied' : '📋 Copy'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
