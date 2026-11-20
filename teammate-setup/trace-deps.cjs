// Prints the bot files upload.js loads (itself plus every local require, recursively), one per
// line, relative to bot/. The teammate zip ships exactly these, so it never carries queues,
// logins, customer files or one-off scripts.
const fs = require('fs');
const path = require('path');

const botDir = path.resolve(__dirname, '..', 'bot');

function trace(entry) {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!file.endsWith('.js')) return;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      const base = path.resolve(path.dirname(file), match[1]);
      const found = [base, `${base}.js`, `${base}.json`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (found) visit(found);
    }
  };
  visit(path.join(botDir, entry));
  return [...seen].map(file => path.relative(botDir, file));
}

if (require.main === module) console.log(trace('upload.js').join('\n'));

module.exports = { trace };
