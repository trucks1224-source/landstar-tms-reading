// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// ⚙ My Settings → Team: invite a teammate by email (api/invite-user.js) and see who is on the TMS.
// Its own component so its state never shifts the App's (tests address App state by position).
function TeamInvite({ sharing }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [teammates, setTeammates] = useState([]);
  const loadTeammates = () => {
    if (!sharing?.listTeammates) return;
    sharing.listTeammates().then(list => setTeammates(Array.isArray(list) ? list : [])).catch(() => {});
  };
  useEffect(loadTeammates, [sharing]);
  const invite = async () => {
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error('Sign in to the TMS first.');
      const response = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: address })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The teammate could not be added.');
      setMessage({
        ok: true,
        password: result.tempPassword,
        text: `${result.existed ? `New temporary password for ${result.email}` : `Account created for ${result.email}`}. `
          + 'Text them this password. They sign in at the TMS website and choose their own password right away. Then share customers with them from the customer list.'
      });
      setEmail('');
      loadTeammates();
    } catch (error) {
      setMessage({ ok: false, text: error.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="border border-[#1c2541] rounded p-3 space-y-2">
      <legend className="px-1 text-xs font-bold text-gray-300">👥 Team</legend>
      <p className="text-[11px] text-gray-400">Add a teammate: you get a temporary password to text them (no email is sent). Forgot their password? Type their email again for a new one.</p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void invite(); } }}
          placeholder="teammate@email.com"
          aria-label="Teammate email"
          className="flex-1 min-w-0 bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
        />
        <button
          type="button"
          onClick={() => void invite()}
          disabled={busy || !email.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 text-xs rounded font-bold whitespace-nowrap"
        >
          {busy ? 'Saving…' : 'Add teammate'}
        </button>
      </div>
      {message && <p role={message.ok ? 'status' : 'alert'} className={`text-[11px] ${message.ok ? 'text-emerald-300' : 'text-red-400'}`}>{message.text}</p>}
      {message?.password && (
        <div className="flex items-center gap-2">
          <code aria-label="Temporary password" className="flex-1 bg-[#0b132b] border border-emerald-600 rounded px-2 py-1.5 text-base text-white font-mono tracking-wider select-all">{message.password}</code>
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(message.password).catch(() => {}); }}
            className="bg-slate-700 hover:bg-slate-600 text-white px-2.5 py-1.5 rounded text-xs"
          >
            📋 Copy
          </button>
        </div>
      )}
      {teammates.length > 0 && (
        <p className="text-[11px] text-gray-400">On the TMS: {teammates.map(person => person.email).join(', ')}</p>
      )}
    </fieldset>
  );
}

export {
  TeamInvite
};
