// Reads Daniel's TMS workspace (his loads) from Supabase, the way the TMS does in the browser
// (src/lib/cloudSync.js): his own app_data copy plus the shared customers he owns or belongs to,
// whose loads live in shared_loads. Read-only. Used by the email bot (bot/email-bot.js).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// The TMS server gets these from .env through Vite; a bot reads the same file itself.
function loadEnv(file = path.join(ROOT, '.env')) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function serviceClient() {
  loadEnv();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing from .env');
  const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'));
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

const parseJson = (text, fallback) => {
  try { return text == null ? fallback : JSON.parse(text); } catch { return fallback; }
};

async function selectAll(supabase, table, columns, filter = query => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(supabase.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

// The office account: the TMS user whose email is the connected Gmail (same rule as the
// TMS server's prospect import).
async function findOwnerId(supabase) {
  const { data: connection } = await supabase.from('gmail_connection').select('email').eq('id', 1).maybeSingle();
  const ownerEmail = String(connection?.email || '').toLowerCase();
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`users: ${error.message}`);
  const match = (data?.users || []).find(user => String(user.email || '').toLowerCase() === ownerEmail);
  if (!match) throw new Error('No TMS account matches the connected Gmail address.');
  return match.id;
}

// Personal loads + shared customers' loads (a shared load replaces a personal one with the same id).
function mergeWorkspace(personalMap, sharedCustomers, sharedLoads) {
  const result = personalMap && typeof personalMap === 'object' && !Array.isArray(personalMap) ? { ...personalMap } : {};
  for (const name of sharedCustomers) {
    const byId = new Map((Array.isArray(result[name]) ? result[name] : [])
      .filter(load => load && load.id != null).map(load => [String(load.id), load]));
    for (const row of sharedLoads.filter(item => item.customer_name === name)) {
      const load = typeof row.data === 'string' ? parseJson(row.data, null) : row.data;
      if (load) byId.set(String(row.load_id), load);
    }
    result[name] = [...byId.values()];
  }
  return result;
}

async function readWorkspace(supabase = serviceClient()) {
  const userId = await findOwnerId(supabase);
  const { data: personal, error } = await supabase.from('app_data').select('value')
    .eq('user_id', userId).eq('key', 'landstar_customerOrdersMap').maybeSingle();
  if (error) throw new Error(`app_data: ${error.message}`);
  const customers = await selectAll(supabase, 'shared_customers', 'name, owner_id');
  const members = await selectAll(supabase, 'shared_customer_members', 'customer_name, user_id');
  const mine = customers.filter(row => row.owner_id === userId
    || members.some(member => member.customer_name === row.name && member.user_id === userId)).map(row => row.name);
  const sharedLoads = mine.length
    ? await selectAll(supabase, 'shared_loads', 'customer_name, load_id, data', query => query.in('customer_name', mine))
    : [];
  return mergeWorkspace(parseJson(personal?.value, {}), mine, sharedLoads);
}

module.exports = { readWorkspace, mergeWorkspace, loadEnv, serviceClient };
