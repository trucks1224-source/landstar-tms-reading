import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Without both values the app keeps working exactly as before, using browser storage only.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
