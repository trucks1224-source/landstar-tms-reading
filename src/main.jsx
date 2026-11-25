import React from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./AuthGate.jsx";
import SaveProspects from "./SaveProspects.jsx";
import "./styles/global.css";

// After a new version is published, a tab opened before it still asks for the old version's
// code files (Export's spreadsheet maker, OCR, ZIP lookups), which no longer exist: "Failed to
// fetch dynamically imported module". Reload once to pick up the new version instead.
window.addEventListener("vite:preloadError", () => {
  const key = "tms_reloadedForUpdateAt";
  let last = 0;
  try { last = Number(sessionStorage.getItem(key)) || 0; } catch { /* storage blocked */ }
  if (Date.now() - last < 60 * 1000) return; // already reloaded just now: let the error show
  try { sessionStorage.setItem(key, String(Date.now())); } catch { /* storage blocked */ }
  alert("The TMS was just updated. It will reload now to get the new version. Then try that again (for example, click Export again).");
  window.location.reload();
});

// The "Save to TMS" bookmark opens /?save-prospects=1 in a small window: only that panel.
const savingProspects = new URLSearchParams(window.location.search).has("save-prospects");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {savingProspects ? <SaveProspects /> : <AuthGate />}
  </React.StrictMode>
);
