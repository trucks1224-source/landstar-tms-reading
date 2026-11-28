// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { isCh593772Customer } from './customers.js';

function decodeGmailBody(data) {
  const base64 = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getGmailMessageText(payload, selectedBroker) {
  const plainParts = [];
  const htmlParts = [];
  const collectParts = part => {
    if (part.body?.data) {
      if (part.mimeType === 'text/plain') plainParts.push(decodeGmailBody(part.body.data));
      if (part.mimeType === 'text/html') htmlParts.push(decodeGmailBody(part.body.data));
    }
    (part.parts || []).forEach(collectParts);
  };
  collectParts(payload);
  if (isCh593772Customer(selectedBroker) && htmlParts.length) {
    const document = new DOMParser().parseFromString(
      htmlParts.join('\n').replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n'), 'text/html'
    );
    const rows = [...document.querySelectorAll('tr')];
    if (rows.some(row => [...row.cells].some(cell => /^bin\b/i.test(cell.textContent.trim())))) {
      rows.forEach(row => row.replaceWith(document.createTextNode(`\n${[...row.cells]
        .map(cell => cell.textContent.replace(/\s+/g, ' ').trim()).join('\t')}\n`)));
      return document.body.textContent || '';
    }
  }
  if (plainParts.length) return plainParts.join('\n');
  if (!htmlParts.length) return '';

  const htmlAsText = htmlParts.join('\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:tr|p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, '\n');
  const document = new DOMParser().parseFromString(htmlAsText, 'text/html');
  return (document.body.textContent || '').replace(/[ \t]+\n/g, '\n');
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error('Google authorization did not initialize.'));
    };
    script.onerror = () => reject(new Error('Could not load Google authorization. Check your internet connection.'));
    document.head.appendChild(script);
  });
}

async function getGmailApiError(response, action) {
  let details = '';
  try {
    const body = await response.json();
    const apiError = body.error;
    details = apiError?.message || apiError?.errors?.[0]?.reason || '';
  } catch (error) {
    console.error(`Could not read Gmail ${action} error details:`, error);
  }
  return new Error(`Gmail ${action} failed (${response.status})${details ? `: ${details}` : '.'}`);
}

export {
  decodeGmailBody,
  getGmailMessageText,
  loadGoogleIdentityScript,
  getGmailApiError
};
