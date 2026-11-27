// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { useState } from 'react';
import { supabase } from '../lib/supabase';

// ==========================================
// LOAD-LIST HISTORY
// ==========================================
// The cloud keeps dated copies of each user's load list for 3 days (see
// supabase/app-data-history.sql): hourly, and the old list right before any save that
// cuts it by more than half. The History window lists them and rolls back to one.
const loadListHistoryReasons = {
  hourly: 'Hourly copy',
  'before-shrink': 'Before the list shrank',
  'before-restore': 'Before a restore'
};

// "RXO ATZ: 2,463 loads (1 booked) · Para: 27 loads"
function describeLoadListSummary(summary) {
  if (!summary || typeof summary !== 'object') return 'No details';
  const parts = Object.entries(summary)
    .filter(([, info]) => Number(info?.loads) > 0)
    .sort(([, a], [, b]) => Number(b.loads) - Number(a.loads))
    .map(([customer, info]) => `${customer}: ${Number(info.loads).toLocaleString('en-US')} load${Number(info.loads) === 1 ? '' : 's'}`
      + (Number(info.booked) > 0 ? ` (${info.booked} booked)` : ''));
  return parts.length ? parts.join(' · ') : 'Empty list';
}

function LoadListHistory({ onRestore }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState(null);

  const loadRows = async () => {
    setStatus('Loading saved copies…');
    const { data, error } = await supabase.from('app_data_history')
      .select('id, reason, saved_at, summary')
      .eq('key', 'landstar_customerOrdersMap')
      .order('saved_at', { ascending: false })
      .limit(200);
    if (error) {
      setStatus(/relation|does not exist|schema cache/i.test(error.message)
        ? 'History is not set up yet: run supabase/app-data-history.sql in Supabase first.'
        : `Could not load history: ${error.message}`);
      return;
    }
    setRows(data || []);
    setStatus(data?.length ? '' : 'No saved copies yet. The first one is made on your next save.');
  };

  const restore = async row => {
    const when = new Date(row.saved_at).toLocaleString();
    if (!window.confirm(`Replace your whole load list with the copy from ${when}?\n\n${describeLoadListSummary(row.summary)}\n\nYour current list is saved to History first, so this can be undone.`)) return;
    setBusyId(row.id);
    try {
      const { data, error } = await supabase.from('app_data_history').select('value').eq('id', row.id).single();
      if (error) throw error;
      const { data: userData } = await supabase.auth.getUser();
      const current = localStorage.getItem('landstar_customerOrdersMap');
      if (userData?.user?.id && current) {
        const { error: saveError } = await supabase.from('app_data_history').insert({
          user_id: userData.user.id, key: 'landstar_customerOrdersMap', value: current, reason: 'before-restore'
        });
        if (saveError) throw new Error(`Could not save your current list first (${saveError.message}); nothing was changed.`);
      }
      if (!onRestore(data.value)) throw new Error('The restored list could not be saved in this browser.');
      alert(`Restored the load list from ${when}.`);
      setOpen(false);
    } catch (error) {
      alert(`Restore failed: ${error.message}`);
    } finally {
      setBusyId(null);
    }
  };

  if (!supabase) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); void loadRows(); }}
        className="tms-tool"
        data-accent="slate"
        title="Roll your load list back to a saved copy from the last 3 days"
      >
        🕘 History
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-label="Load list history">
          <div className="w-[40rem] max-w-full max-h-[80vh] overflow-y-auto bg-[#121829] border border-slate-500 rounded-lg shadow-2xl p-3 normal-case tracking-normal text-left">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-white">🕘 Load list history (last 3 days)</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-300 hover:text-white text-sm px-2 cursor-pointer" aria-label="Close history">✕</button>
            </div>
            <p className="text-[11px] text-gray-300 mb-2">Copies are saved every hour, and right before any save that cuts your list by more than half. Restoring replaces your whole load list.</p>
            {status && <p className="text-xs text-gray-300">{status}</p>}
            {rows.map(row => (
              <div key={row.id} className="border border-[#1c2541] rounded p-2 mb-2 text-xs text-white flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold">{new Date(row.saved_at).toLocaleString()} <span className="font-normal text-gray-400">· {loadListHistoryReasons[row.reason] || row.reason}</span></div>
                  <div className="text-gray-300">{describeLoadListSummary(row.summary)}</div>
                </div>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => restore(row)}
                  className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 px-2 py-1 text-[10px] font-bold rounded text-white cursor-pointer shrink-0"
                >
                  {busyId === row.id ? 'Restoring…' : 'Restore'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export {
  loadListHistoryReasons,
  describeLoadListSummary,
  LoadListHistory
};
