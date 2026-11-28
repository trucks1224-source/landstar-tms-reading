// ⚙ My Settings → Team status, in Daniel's TMS only (Daniel 2026-11-27: see if a teammate's side
// broke without them having to tell him). Reads the team_status table (supabase/team-status.sql)
// that each teammate's TMS fills every 2 minutes (src/lib/teamStatus.js).
import React, { useEffect, useState } from 'react';
import { describeTeamStatus, ago } from '../lib/teamStatus.js';

const dot = { ok: 'bg-emerald-400', warn: 'bg-amber-400', down: 'bg-red-500' };

function Light({ part }) {
  if (!part) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot[part.level] || dot.warn}`} aria-hidden="true" />
      {part.text}
    </span>
  );
}

export default function TeamStatusPanel({ supabase }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return undefined;
    let cancelled = false;
    const load = async () => {
      const { data, error: loadError } = await supabase.from('team_status').select('*').order('name');
      if (cancelled) return;
      if (loadError) setError(/does not exist|schema cache/i.test(loadError.message) ? 'The team status table is not set up yet (supabase/team-status.sql).' : loadError.message);
      else { setError(''); setRows(data || []); }
    };
    load();
    const timer = setInterval(load, 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [supabase]);

  const now = Date.now();
  return (
    <fieldset className="border border-[#1c2541] rounded p-2 text-xs text-gray-300">
      <legend className="px-1 text-gray-400">Team status</legend>
      {error && <p className="text-amber-300">{error}</p>}
      {!error && rows === null && <p className="text-gray-500">Loading...</p>}
      {!error && rows?.length === 0 && <p className="text-gray-500">No teammate has opened the TMS since this was turned on.</p>}
      {!error && rows?.length > 0 && (
        <ul className="space-y-2">
          {rows.map(row => {
            const status = describeTeamStatus(row, now);
            return (
              <li key={row.user_id} className="border-t border-[#1c2541] pt-1.5 first:border-0 first:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white">{row.name || 'Teammate'}{row.posting_code ? ` (${row.posting_code})` : ''}</span>
                  <span className="text-gray-500">{row.last_export_at ? `last export ${ago(now - Date.parse(row.last_export_at))}` : 'no export yet'}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5">
                  <Light part={status.tms} />
                  <Light part={status.bot} />
                  <Light part={status.chat} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
