// Moves a group of top-level helpers out of src/App.jsx into src/app/<name>.js (Daniel 2026-11-27:
// splitting App.jsx). The group is the seeds plus everything they use from App.jsx, so the new
// file never needs App.jsx back. Refuses groups that touch browser state (storage, window...)
// or that App.jsx reassigns. App.jsx then imports every moved name (the tests reach helpers
// through App.jsx, so the names stay available there).
//   node scripts/move-from-app.cjs <module-name> <seed> [<seed>...] [--dry]
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const [moduleName, ...rest] = process.argv.slice(2);
const dry = rest.includes('--dry');
// --ui: screen parts (React components): they may use the browser (storage, window...) and go
// into a .jsx file.
const ui = rest.includes('--ui');
const ext = ui ? 'jsx' : 'js';
const seeds = rest.filter(arg => !arg.startsWith('--'));
const appFile = path.join('src', 'App.jsx');
const src = fs.readFileSync(appFile, 'utf8');
const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'], attachComment: true });

// Built-ins a moved helper may use; anything else from the browser keeps it in App.jsx.
const PURE_GLOBALS = new Set(`Object Array String Number Boolean Symbol Math JSON Date RegExp Error TypeError RangeError
  Map Set WeakMap WeakSet Promise Intl parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent
  Infinity NaN undefined console Uint8Array ArrayBuffer`.split(/\s+/).filter(Boolean));

const decls = [];
const imports = [];
for (const node of ast.program.body) {
  if (node.type === 'ImportDeclaration') { imports.push(node); continue; }
  const target = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' ? node.declaration : node;
  if (!target) continue;
  const names = [];
  if (target.type === 'FunctionDeclaration' || target.type === 'ClassDeclaration') names.push(target.id.name);
  if (target.type === 'VariableDeclaration') target.declarations.forEach(d => d.id.type === 'Identifier' && names.push(d.id.name));
  if (!names.length) continue;
  const comments = node.leadingComments || [];
  const start = comments.length ? comments[0].start : node.start;
  decls.push({ node, names, start, end: node.end, kind: target.type === 'VariableDeclaration' ? target.kind : 'function', exported: node.type !== target.type });
}
const byName = new Map();
decls.forEach(decl => decl.names.forEach(name => byName.set(name, decl)));
const importedNames = new Map();
imports.forEach(node => node.specifiers.forEach(spec => importedNames.set(spec.local.name, node)));

// What each declaration uses: other top-level names, imported names, free globals.
function usage(decl) {
  const topUses = new Set();
  const importUses = new Set();
  const globals = new Set();
  traverse(ast, {
    ReferencedIdentifier(p) {
      if (p.node.start < decl.node.start || p.node.end > decl.node.end) return;
      const name = p.node.name;
      if (p.isJSXIdentifier() && !/^[A-Z]/.test(name)) return;
      const binding = p.scope.getBinding(name);
      if (binding && binding.scope.block.type !== 'Program') return;
      if (decl.names.includes(name)) return;
      if (byName.has(name)) topUses.add(name);
      else if (importedNames.has(name)) importUses.add(name);
      else if (!binding) globals.add(name);
    }
  });
  return { topUses, importUses, globals };
}

const group = new Set();
const queue = [...seeds];
for (const seed of seeds) if (!byName.has(seed)) throw new Error(`Not a top-level name in App.jsx: ${seed}`);
while (queue.length) {
  const name = queue.shift();
  const decl = byName.get(name);
  if (group.has(decl)) continue;
  if (decl.names.includes('App')) throw new Error('The group would include the App screen itself.');
  group.add(decl);
  usage(decl).topUses.forEach(used => queue.push(used));
}
const members = [...group].sort((a, b) => a.start - b.start);
const problems = [];
const neededImports = new Set();
for (const decl of members) {
  const { importUses, globals } = usage(decl);
  importUses.forEach(name => neededImports.add(name));
  const impure = [...globals].filter(name => !PURE_GLOBALS.has(name));
  if (impure.length && !ui) problems.push(`${decl.names.join(',')} uses ${impure.join(', ')}`);
  if (decl.exported) problems.push(`${decl.names.join(',')} is exported by App.jsx`);
}
// App.jsx may not reassign a moved variable (imports are read-only).
const movedNames = new Set(members.flatMap(decl => decl.names));
traverse(ast, {
  'AssignmentExpression|UpdateExpression'(p) {
    const target = p.node.left || p.node.argument;
    if (target?.type !== 'Identifier' || !movedNames.has(target.name)) return;
    const binding = p.scope.getBinding(target.name);
    if (binding?.scope.block.type === 'Program' && !members.some(decl => p.node.start >= decl.node.start && p.node.end <= decl.node.end)) {
      problems.push(`App.jsx reassigns ${target.name}`);
    }
  }
});
const lines = members.reduce((sum, decl) => sum + src.slice(decl.start, decl.end).split('\n').length, 0);
console.log(`group "${moduleName}": ${members.length} declarations, ${lines} lines`);
console.log(`  ${members.map(decl => decl.names.join(',')).join(', ')}`);
console.log(`  imports it needs: ${[...neededImports].join(', ') || 'none'}`);
if (problems.length) {
  console.log('REFUSED:');
  problems.forEach(problem => console.log(`  - ${problem}`));
  process.exit(1);
}
if (dry) process.exit(0);

// New module: the imports it needs (paths adjusted from src/ to src/app/), the code, the exports.
const importLines = [];
for (const node of imports) {
  const specs = node.specifiers.filter(spec => neededImports.has(spec.local.name));
  if (!specs.length) continue;
  const from = node.source.value;
  // From src/app/: a sibling moved file is ./x.js; anything else under src/ is one level up.
  const source = from.startsWith('./app/') ? `./${from.slice(6)}` : from.startsWith('./') ? `../${from.slice(2)}` : from.startsWith('../') ? `../${from}` : from;
  const parts = specs.map(spec => {
    if (spec.type === 'ImportDefaultSpecifier') return { def: spec.local.name };
    if (spec.type === 'ImportNamespaceSpecifier') return { ns: spec.local.name };
    const imported = spec.imported.name || spec.imported.value;
    return { named: imported === spec.local.name ? imported : `${imported} as ${spec.local.name}` };
  });
  const def = parts.find(part => part.def)?.def;
  const ns = parts.find(part => part.ns)?.ns;
  const named = parts.filter(part => part.named).map(part => part.named);
  const head = [def, ns ? `* as ${ns}` : '', named.length ? `{ ${named.join(', ')} }` : ''].filter(Boolean).join(', ');
  importLines.push(`import ${head} from '${source}';`);
}
const eol = src.includes('\r\n') ? '\r\n' : '\n';
const body = members.map(decl => src.slice(decl.start, decl.end)).join(`${eol}${eol}`);
const exportNames = members.flatMap(decl => decl.names);
const header = `// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports${eol}// everything here, so it is used exactly as before.${eol}`;
const moduleText = `${header}${importLines.join(eol)}${importLines.length ? eol + eol : ''}${body}${eol}${eol}export {${eol}  ${exportNames.join(`,${eol}  `)}${eol}};${eol}`;
fs.mkdirSync(path.join('src', 'app'), { recursive: true });
const moduleFile = path.join('src', 'app', `${moduleName}.${ext}`);
if (fs.existsSync(moduleFile)) throw new Error(`${moduleFile} already exists`);
fs.writeFileSync(moduleFile, moduleText);

// App.jsx: drop the moved code (and the blank lines it leaves), add one import line.
let next = '';
let cursor = 0;
for (const decl of members) {
  next += src.slice(cursor, decl.start);
  cursor = decl.end;
}
next += src.slice(cursor);
next = next.replace(/(\r?\n){3,}/g, `${eol}${eol}`);
const lastImport = imports[imports.length - 1];
const insertAt = next.indexOf(src.slice(lastImport.start, lastImport.end)) + (lastImport.end - lastImport.start);
next = `${next.slice(0, insertAt)}${eol}import {${eol}  ${exportNames.join(`,${eol}  `)}${eol}} from './app/${moduleName}.${ext}';${next.slice(insertAt)}`;
fs.writeFileSync(appFile, next);
console.log(`moved to ${moduleFile}; App.jsx now ${next.split('\n').length} lines`);
