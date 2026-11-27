// Safety check for moving code between files (Daniel 2026-11-27, splitting App.jsx): lists every
// name a source file uses but neither defines, imports nor gets from the browser. After a move,
// any new name here is a broken link (something moved without its import).
//   node scripts/check-undefined.cjs src/App.jsx src/app/*.js
// Exits 1 when a file uses an unknown name.
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Names the browser (and Node, for the bot-side helpers) provide.
const GLOBALS = new Set(`window document navigator location history localStorage sessionStorage console
  setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask
  fetch Request Response Headers URL URLSearchParams FormData Blob File FileReader AbortController AbortSignal
  TextEncoder TextDecoder atob btoa crypto structuredClone performance alert confirm prompt open close print
  Notification IntersectionObserver ResizeObserver MutationObserver DOMParser XMLSerializer Image Audio
  AudioContext webkitAudioContext CustomEvent Event EventTarget getComputedStyle matchMedia innerWidth innerHeight
  Object Array String Number Boolean Symbol BigInt Math JSON Date RegExp Error TypeError RangeError SyntaxError
  Map Set WeakMap WeakSet Promise Proxy Reflect Intl ArrayBuffer Uint8Array Uint16Array Int32Array Float64Array
  DataView parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI escape
  unescape Infinity NaN undefined globalThis self arguments require module exports process __dirname __filename
  import.meta __tmsNoticeHook HTMLElement HTMLInputElement Element Node KeyboardEvent ClipboardItem Worker
  OffscreenCanvas ImageData createImageBitmap Option screen SpeechSynthesisUtterance speechSynthesis Storage
  setImmediate clearImmediate`.split(/\s+/).filter(Boolean));

function undefinedNames(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
  const found = new Map();
  const note = (name, loc) => {
    if (GLOBALS.has(name)) return;
    if (!found.has(name)) found.set(name, loc.start.line);
  };
  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (p.isJSXIdentifier()) {
        // <div> and <Foo.Bar> parts: only capitalized component names are variables.
        if (!/^[A-Z]/.test(name) || p.parentPath.isJSXMemberExpression({ property: p.node })) return;
      }
      if (!p.scope.hasBinding(name, true)) note(name, p.node.loc);
    }
  });
  return found;
}

let bad = 0;
for (const file of process.argv.slice(2)) {
  const names = undefinedNames(file);
  const rel = path.relative(process.cwd(), file);
  if (!names.size) { console.log(`ok   ${rel}`); continue; }
  bad += names.size;
  console.log(`FAIL ${rel}: ${names.size} unknown name(s)`);
  for (const [name, line] of names) console.log(`       ${name} (line ${line})`);
}
process.exit(bad ? 1 : 0);
