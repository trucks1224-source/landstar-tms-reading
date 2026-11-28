// ⚙ My Settings → Google Chat lists, for teammates (Daniel 2026-11-27: teammates' own lists should
// import by themselves too). The chats are saved in the teammate's bot (bot/team-chat.js through
// POST 127.0.0.1:47615/chat-config); their bot then watches them and the TMS imports each new list
// (the account is asked once per list name, then remembered). Shown only in a teammate's TMS.
import React, { useEffect, useState } from 'react';
import { parseChatLines } from './teamChat.js';

const CHAT_CONFIG_URL = 'http://127.0.0.1:47615/chat-config';

const formatChatLines = chats => (chats || []).map(chat => `${chat.name} | ${chat.url}`).join('\n');

export default function TeamChatSettings() {
  const [state, setState] = useState({ loading: true, error: '', enabled: false, text: '', message: '', bot: '' });

  useEffect(() => {
    let cancelled = false;
    fetch(CHAT_CONFIG_URL, { signal: AbortSignal.timeout(5000) })
      .then(response => response.json())
      .then(config => {
        if (cancelled) return;
        if (!config.team) {
          setState(current => ({ ...current, loading: false, error: 'This computer\'s bot is not a teammate bot.' }));
          return;
        }
        setState(current => ({ ...current, loading: false, enabled: config.enabled, text: formatChatLines(config.chats), bot: config.bot?.message || '' }));
      })
      .catch(() => {
        if (!cancelled) setState(current => ({ ...current, loading: false, error: 'Start your Landstar bot first ("Start Landstar Bot" on the desktop), then open My Settings again.' }));
      });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    const chats = parseChatLines(state.text);
    const bad = chats.filter(chat => !chat.url);
    if (bad.length) {
      setState(current => ({ ...current, message: `No Google Chat address on: ${bad.map(chat => chat.name).join(', ')}. Copy the address from the browser while the chat is open.` }));
      return;
    }
    try {
      const response = await fetch(CHAT_CONFIG_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: state.enabled, chats })
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error || 'not saved');
      setState(current => ({
        ...current, enabled: saved.enabled, text: formatChatLines(saved.chats),
        message: saved.enabled
          ? `Saved. Your bot opens ${saved.chats.length} chat${saved.chats.length === 1 ? '' : 's'} within a minute; sign in to Google in its window the first time. New lists come into the TMS by themselves.`
          : 'Saved. Google Chat lists are off.'
      }));
    } catch (error) {
      setState(current => ({ ...current, message: `Could not save: ${error.message}. Is your Landstar bot running?` }));
    }
  };

  return (
    <div className="block text-xs text-gray-400">
      Google Chat lists (your bot imports them by themselves)
      {state.loading && <p className="mt-1 text-gray-500">Checking your bot...</p>}
      {state.error && <p className="mt-1 text-amber-300">{state.error}</p>}
      {!state.loading && !state.error && (
        <div className="mt-1 space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-200" style={{ minHeight: 38 }}>
            <input type="checkbox" checked={state.enabled} onChange={e => setState(current => ({ ...current, enabled: e.target.checked, message: '' }))}
              className="w-5 h-5 accent-cyan-400" />
            Watch my Google Chat for lists
          </label>
          <textarea
            value={state.text}
            onChange={e => setState(current => ({ ...current, text: e.target.value, message: '' }))}
            rows={3}
            placeholder={'One chat per line: name | address\nMy lists | https://mail.google.com/mail/u/0/#chat/space/...'}
            aria-label="Google Chat addresses"
            className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} className="px-3 rounded bg-cyan-700 hover:bg-cyan-600 text-white text-sm" style={{ minHeight: 38 }}>
              Save chat lists
            </button>
            {state.bot && <span className="text-gray-500">Chat bot: {state.bot}</span>}
          </div>
          {state.message && <p className="text-cyan-200">{state.message}</p>}
        </div>
      )}
    </div>
  );
}
