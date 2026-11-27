// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { useState, useEffect } from 'react';

// Import/Data tools and the customer list live in a drawer that slides out from the
// left. The sidebar keeps one button showing the selected customer; picking a customer,
// clicking outside, Esc or ✕ closes it.
// Pinned (📌, the default): the drawer stays open while switching customers and using the page,
// and is open again after a reload. Unpinned: picking a customer closes it, as before.
const toolsPinnedKey = 'landstar_toolsPinned';

// On a phone the drawer covers the whole screen, so it never stays pinned open there.
const isPhoneScreen = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 767px)').matches);

const readToolsPinned = () => {
  if (isPhoneScreen()) return false;
  try { return localStorage.getItem(toolsPinnedKey) !== 'false'; } catch { return true; }
};

function ToolsDrawer({ selected, count, children }) {
  const [pinned, setPinned] = useState(readToolsPinned);
  const [open, setOpen] = useState(readToolsPinned);
  const togglePinned = () => setPinned(current => {
    const next = !current;
    try { localStorage.setItem(toolsPinnedKey, String(next)); } catch { /* this visit only */ }
    return next;
  });
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    // The sidebar's blur would trap the fixed drawer inside it, so drop it while open.
    if (open) {
      document.body.classList.add('tms-drawer-open');
      const onKey = event => { if (event.key === 'Escape') setOpen(false); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    const timer = setTimeout(() => document.body.classList.remove('tms-drawer-open'), 320);
    return () => clearTimeout(timer);
  }, [open]);
  return (
    <>
      <button type="button" className="tms-drawer-trigger" onClick={() => setOpen(true)} aria-expanded={open}>
        <span className="tms-drawer-burger" aria-hidden="true">☰</span>
        <span className="tms-drawer-trigger-text">
          <span>Tools &amp; Customers ({count})</span>
          <strong>{selected || 'Pick a customer'}</strong>
        </span>
        <span className="tms-drawer-chevron" aria-hidden="true">›</span>
      </button>
      <div className={`tms-drawer${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`}>
        {/* Pinned: no dark backdrop, so the page next to the drawer stays usable. */}
        {!pinned && <div className="tms-drawer-backdrop" onClick={() => setOpen(false)} />}
        <aside
          className="tms-drawer-panel tms-sidebar-header"
          aria-label="Tools and customers"
          onClick={event => { if (!pinned && event.target?.closest?.('[data-close-drawer]')) setOpen(false); }}
          // Double-click a customer: open it and close the drawer, even when it is kept open
          // (Daniel 2026-11-27: "so I don't have to go to the X").
          onDoubleClick={event => { if (event.target?.closest?.('[data-close-drawer]')) setOpen(false); }}
        >
          <div className="tms-drawer-head">
            <span>Tools &amp; Customers</span>
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={togglePinned}
                aria-pressed={pinned}
                title={pinned ? 'Pinned: stays open when you switch customers. Click to close it after each pick.' : 'Click to keep this panel open while you switch customers.'}
                className={`text-xs px-2 py-0.5 rounded cursor-pointer ${pinned ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-200'}`}
              >
                📌 {pinned ? 'Kept open' : 'Keep open'}
              </button>
              <button type="button" className="tms-drawer-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </span>
          </div>
          {children}
        </aside>
      </div>
    </>
  );
}

export {
  toolsPinnedKey,
  isPhoneScreen,
  readToolsPinned,
  ToolsDrawer
};
