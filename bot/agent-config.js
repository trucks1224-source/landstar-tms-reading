// This computer's Landstar posting code(s), from bot/agent-config.json (never shared in git).
//
// Every bot treats postings under these codes as "mine": it uploads, de-duplicates, removes and
// raises rates only on them, and never counts them as competition. Each teammate's setup writes
// their own code, so one person's bots can never touch another person's postings.
//
//   { "postingCodes": ["ANQ"] }
//
// No file (or no valid code) = the bots refuse to start, rather than guess someone's code.
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = process.env.AGENT_CONFIG_FILE || path.join(__dirname, 'agent-config.json');

// Landstar posting codes are 3 letters/digits (ANQ, SNB, ATZ...).
const isPostingCode = code => /^[A-Z0-9]{2,4}$/.test(code);

function readPostingCodes(file = CONFIG_FILE) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    // Automated tests run without a computer's config; they use the original code.
    if (error.code === 'ENOENT' && process.env.NODE_TEST_CONTEXT) return ['ANQ'];
    if (error.code === 'ENOENT') {
      throw new Error(`This computer has no posting code set up (${file} is missing). Run Setup again, or create it with {"postingCodes": ["YOURCODE"]}.`);
    }
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
  const codes = [...new Set((Array.isArray(parsed?.postingCodes) ? parsed.postingCodes : [])
    .map(code => String(code || '').trim().toUpperCase()))];
  if (!codes.length || !codes.every(isPostingCode)) {
    throw new Error(`${file} needs "postingCodes" with your Landstar posting code(s), like ["ANQ"].`);
  }
  return codes;
}

module.exports = { readPostingCodes, isPostingCode, CONFIG_FILE };
