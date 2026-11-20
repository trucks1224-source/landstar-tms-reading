// The small window the website "Save to TMS" bookmark opens on DAT
// (/?save-prospects=1#t=<page text>). It finds the broker contacts on that page and, after the
// person clicks Save, adds them to THEIR OWN Prospects list (signed-in user; row security keeps
// each person's list separate). Nothing is saved without that click, so another website cannot
// slip addresses into someone's list. Saved contacts are emailed by the Prospects panel.
import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabase.js';
import { contactsToSave, readPageText } from './lib/prospects.js';

const box = { maxWidth: 480, margin: '0 auto', padding: 16, font: '14px/1.5 system-ui, sans-serif', color: '#eef2ff' };
const button = { background: '#047857', color: 'white', border: 0, borderRadius: 6, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' };

export default function SaveProspects() {
  const [session, setSession] = useState(undefined);
  const [text] = useState(() => readPageText(window.location.hash));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.style.background = '#0b132b';
    // The page text stays out of the address bar and history once read.
    if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data?.session || null));
  }, []);

  if (session === undefined) return <div style={box}>Loading…</div>;
  if (!session) {
    return (
      <div style={box}>
        <h1 style={{ fontSize: 18 }}>Save to TMS</h1>
        <p>Sign in to the TMS website in this browser first, then click the bookmark again on DAT.</p>
        <a href="/" target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>Open the TMS and sign in</a>
      </div>
    );
  }
  const contacts = contactsToSave(text, session.user?.email);
  const save = async () => {
    setBusy(true);
    const { data, error } = await supabase.from('prospects').upsert(
      contacts.map(item => ({ company: item.company || '', contact: item.contact || '', email: item.email.toLowerCase(), phone: item.phone || '', lane: item.lane || '' })),
      { onConflict: 'owner_id,email', ignoreDuplicates: true }
    ).select('id');
    setBusy(false);
    setResult(error ? { error: error.message } : { saved: (data || []).length, skipped: contacts.length - (data || []).length });
  };

  return (
    <div style={box}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>Save to TMS</h1>
      <p style={{ color: '#cbd5e1', marginTop: 0 }}>Into your Prospects list ({session.user?.email})</p>
      {!text && <p>No page text came through. Open a DAT posting so the contact email shows, then click the bookmark again.</p>}
      {text && !contacts.length && <p>No broker emails on this page. Open the DAT posting so the contact email shows, then click the bookmark again.</p>}
      {contacts.length > 0 && !result && (
        <>
          <p>{contacts.length} contact{contacts.length === 1 ? '' : 's'} found:</p>
          <ul style={{ maxHeight: 260, overflowY: 'auto', paddingLeft: 18 }}>
            {contacts.map(item => <li key={item.email}>{item.company ? `${item.company} - ` : ''}{item.email}{item.lane ? ` (${item.lane})` : ''}</li>)}
          </ul>
          <button type="button" onClick={save} disabled={busy} style={button}>{busy ? 'Saving…' : `Save ${contacts.length} to my Prospects`}</button>
        </>
      )}
      {result?.error && <p style={{ color: '#fca5a5' }}>Could not save: {result.error}</p>}
      {result && !result.error && (
        <>
          <p style={{ color: '#6ee7b7' }}>Saved {result.saved} new contact{result.saved === 1 ? '' : 's'}{result.skipped ? `; ${result.skipped} already in your list` : ''}.</p>
          <p style={{ color: '#cbd5e1' }}>New contacts are emailed automatically from your Gmail while the TMS website is open (Prospects → Connect Gmail).</p>
          <button type="button" onClick={() => window.close()} style={button}>Close</button>
        </>
      )}
    </div>
  );
}
