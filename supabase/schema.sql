-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Team model: every signed-in user shares the same data. Disable public sign-ups
-- (Authentication -> Providers -> Email -> turn off "Allow new users to sign up")
-- and add teammates yourself under Authentication -> Users.

-- ---------------------------------------------------------------
-- Shared app data (customers, loads, lane rates, exported history)
-- ---------------------------------------------------------------
create table if not exists public.app_data (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.app_data enable row level security;

drop policy if exists "team can read app_data" on public.app_data;
create policy "team can read app_data" on public.app_data
  for select to authenticated using (true);

drop policy if exists "team can insert app_data" on public.app_data;
create policy "team can insert app_data" on public.app_data
  for insert to authenticated with check (true);

drop policy if exists "team can update app_data" on public.app_data;
create policy "team can update app_data" on public.app_data
  for update to authenticated using (true) with check (true);

-- Live updates between teammates' browsers
alter publication supabase_realtime add table public.app_data;

-- ---------------------------------------------------------------
-- Gmail automation
-- ---------------------------------------------------------------
-- Google refresh token + settings. Only the server (service-role key) can touch
-- this table; there are intentionally no policies for signed-in users.
create table if not exists public.gmail_connection (
  id int primary key default 1 check (id = 1),
  email text,
  refresh_token text not null,
  last_checked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.gmail_connection enable row level security;

-- Loads found in email by the scheduled job. The app merges these into the
-- customer's load list and marks them applied, so the server never overwrites
-- your edits.
-- For Para 1522166 ATZ, RXO 2429200 ATZ P and Nolan 965974 ATZ H, all pending
-- rows for a customer form a full replacement list: missing loads (including
-- ENT) are removed, load numbers are unique, and existing numbers reopen.
create table if not exists public.email_loads (
  id bigint generated always as identity primary key,
  gmail_message_id text not null,
  customer text not null,
  load_id text not null,
  load jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'applied')),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (gmail_message_id, load_id)
);
alter table public.email_loads enable row level security;

drop policy if exists "team can read email_loads" on public.email_loads;
create policy "team can read email_loads" on public.email_loads
  for select to authenticated using (true);

drop policy if exists "team can update email_loads" on public.email_loads;
create policy "team can update email_loads" on public.email_loads
  for update to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.email_loads;
