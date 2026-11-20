import React from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./AuthGate.jsx";
import SaveProspects from "./SaveProspects.jsx";
import "./styles/global.css";

// The "Save to TMS" bookmark opens /?save-prospects=1 in a small window: only that panel.
const savingProspects = new URLSearchParams(window.location.search).has("save-prospects");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {savingProspects ? <SaveProspects /> : <AuthGate />}
  </React.StrictMode>
);
