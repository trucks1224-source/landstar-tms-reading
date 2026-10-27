import React, { useEffect, useState } from 'react';
import App from './App.jsx';
import { supabase } from './lib/supabase.js';
import {
  flushCloudSyncNow,
  onSyncStatus,
  startCloudSync,
  stopCloudSync,
  subscribeToRemoteChanges
} from './lib/cloudSync.js';

const statusLabels = {
  idle: '☁ Not synced',
  saving: '☁ Saving…',
  synced: '☁ Synced',
  error: '⚠ Sync problem – retrying'
};

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) setError(signInError.message);
    setBusy(false);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-[#0b132b] text-white">
      <form onSubmit={handleSubmit} className="w-80 bg-[#121829] border border-[#1c2541] rounded p-5 space-y-3">
        <h1 className="text-sm font-bold text-gray-200">Landstar TMS – Sign in</h1>
        <input
          type="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          placeholder="Email"
          autoComplete="username"
          required
          className="w-full bg-[#161f36] border border-[#1c2541] rounded p-2 text-xs text-white placeholder-gray-500"
        />
        <input
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          required
          className="w-full bg-[#161f36] border border-[#1c2541] rounded p-2 text-xs text-white placeholder-gray-500"
        />
        {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-2 py-1.5 text-xs font-bold rounded"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function SyncBadge({ email }) {
  const [status, setStatus] = useState('idle');
  useEffect(() => onSyncStatus(setStatus), []);

  const handleSignOut = async () => {
    await flushCloudSyncNow();
    await supabase.auth.signOut();
  };

  return (
    <div className="fixed bottom-2 right-2 z-50 flex items-center gap-2 rounded bg-[#161f36]/90 border border-[#1c2541] px-2 py-1 text-[10px] text-gray-300">
      <span className={status === 'error' ? 'text-red-400' : status === 'synced' ? 'text-emerald-400' : ''}>
        {statusLabels[status]}
      </span>
      <span className="text-gray-500">{email}</span>
      <button type="button" onClick={handleSignOut} className="text-blue-400 hover:text-blue-300 underline">
        Sign out
      </button>
    </div>
  );
}

// Signs the team in and keeps the shared database in step with the app. When
// Supabase is not configured the app runs on browser storage only, as before.
export default function AuthGate() {
  const [session, setSession] = useState(null);
  const [phase, setPhase] = useState(supabase ? 'loading' : 'local');
  const [syncError, setSyncError] = useState('');
  const [appVersion, setAppVersion] = useState(0);

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setPhase(data.session ? 'syncing' : 'signedOut');
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(current => {
        if (current?.user?.id === nextSession?.user?.id) return nextSession;
        setPhase(nextSession ? 'syncing' : 'signedOut');
        return nextSession;
      });
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  useEffect(() => {
    if (!supabase || !userId) return undefined;
    let cancelled = false;
    let unsubscribe = () => {};
    let remountTimer = null;
    setSyncError('');
    startCloudSync()
      .then(() => {
        if (cancelled) return;
        unsubscribe = subscribeToRemoteChanges(() => {
          window.clearTimeout(remountTimer);
          remountTimer = window.setTimeout(() => setAppVersion(version => version + 1), 400);
        });
        setPhase('ready');
      })
      .catch(error => {
        console.error('Could not load shared data:', error);
        if (!cancelled) {
          setSyncError(error.message || 'Could not reach the cloud database.');
          setPhase('error');
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(remountTimer);
      unsubscribe();
      stopCloudSync();
    };
  }, [userId]);

  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const flush = () => { if (document.visibilityState === 'hidden') flushCloudSyncNow(); };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [phase]);

  if (phase === 'local') return <App />;
  if (phase === 'loading' || phase === 'syncing') {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0b132b] text-xs text-gray-300">
        {phase === 'syncing' ? 'Loading shared data…' : 'Loading…'}
      </div>
    );
  }
  if (phase === 'signedOut') return <LoginForm />;
  if (phase === 'error') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 bg-[#0b132b] text-xs text-gray-200">
        <p>Could not load shared data: {syncError}</p>
        <p className="text-gray-400">Your data in this browser is untouched. Check the connection and the Supabase setup, then retry.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-blue-600 hover:bg-blue-500 px-3 py-1.5 font-bold rounded"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <>
      <App key={appVersion} />
      <SyncBadge email={session?.user?.email} />
    </>
  );
}
