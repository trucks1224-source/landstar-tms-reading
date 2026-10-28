-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Workspace model: every signed-in user has their own customers, loads, lane rates,
-- exported history and My Settings (phone, posting code, visibility group).
-- Disable public sign-ups (Authentication -> Providers -> Email -> turn off
-- "Allow new users to sign up") and add teammates yourself under Authentication -> Users.
-- Existing shared-workspace databases: run per-user-workspaces.sql instead.

-- ---------------------------------------------------------------
-- Per-user app data (customers, loads, lane rates, exported history, settings)
-- ---------------------------------------------------------------
create table if not exists public.app_data (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (user_id, key)
);

alter table public.app_data enable row level security;

drop policy if exists "users read own app_data" on public.app_data;
create policy "users read own app_data" on public.app_data
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "users insert own app_data" on public.app_data;
create policy "users insert own app_data" on public.app_data
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "users update own app_data" on public.app_data;
create policy "users update own app_data" on public.app_data
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live updates between the same user's browsers and tabs
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
-- rows for a customer form a full replacement list; other customers merge additively.
-- All customers import new and matching loads as OPEN, except Para customer screenshots:
-- red load numbers import as ON HOLD; non-red load numbers import as OPEN.
-- Keep one directional city/state lane per pickup day; different days stay separate.
-- Exported ENT loads absent from an import are retained for 30 days after export.
-- A re-imported load reopens immediately and clears its export-retention timestamp.
-- DAT screenshot imports are additive without requiring source load IDs.
-- Existing lane/day results reopen instead of being skipped; repeated input rows collapse.
-- Re-importing DAT may correct a screenshot rate on an existing lane/day;
-- manually entered rates are preserved, and unreadable DAT rates are not API estimates.
create table if not exists public.email_loads (
  id bigint generated always as identity primary key,
  -- Set this default to the user ID of the person whose Gmail is connected:
  -- alter table public.email_loads alter column owner_id set default '<user id>';
  owner_id uuid references auth.users (id) on delete cascade,
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

drop policy if exists "owner reads email_loads" on public.email_loads;
create policy "owner reads email_loads" on public.email_loads
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "owner updates email_loads" on public.email_loads;
create policy "owner updates email_loads" on public.email_loads
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter publication supabase_realtime add table public.email_loads;

-- ---------------------------------------------------------------
-- Shared customers: an owner shares one customer (its loads and lane rates)
-- with chosen teammates. Everyone on it edits the same loads live.
-- ---------------------------------------------------------------
create table if not exists public.shared_customers (
  name text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  load_order text not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists public.shared_customer_members (
  customer_name text not null references public.shared_customers (name) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (customer_name, user_id)
);

create table if not exists public.shared_loads (
  customer_name text not null references public.shared_customers (name) on delete cascade,
  load_id text not null,
  data text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (customer_name, load_id)
);

create table if not exists public.shared_lane_rates (
  customer_name text not null references public.shared_customers (name) on delete cascade,
  rate_key text not null,
  rate text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (customer_name, rate_key)
);

create or replace function public.can_use_shared_customer(customer text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from shared_customers where name = customer and owner_id = auth.uid())
      or exists (select 1 from shared_customer_members where customer_name = customer and user_id = auth.uid());
$$;

-- Lets signed-in teammates pick each other by email when sharing.
create or replace function public.team_directory()
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id, u.email::text from auth.users u where auth.uid() is not null order by u.email;
$$;
revoke all on function public.team_directory() from public, anon;
grant execute on function public.team_directory() to authenticated;

alter table public.shared_customers enable row level security;
alter table public.shared_customer_members enable row level security;
alter table public.shared_loads enable row level security;
alter table public.shared_lane_rates enable row level security;

drop policy if exists "shared customer read" on public.shared_customers;
create policy "shared customer read" on public.shared_customers
  for select to authenticated using (public.can_use_shared_customer(name));
drop policy if exists "shared customer create" on public.shared_customers;
create policy "shared customer create" on public.shared_customers
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "shared customer order" on public.shared_customers;
create policy "shared customer order" on public.shared_customers
  for update to authenticated using (public.can_use_shared_customer(name)) with check (public.can_use_shared_customer(name));
drop policy if exists "shared customer stop" on public.shared_customers;
create policy "shared customer stop" on public.shared_customers
  for delete to authenticated using (owner_id = auth.uid());
-- Teammates may only change the load order, never the owner or name.
revoke update on public.shared_customers from authenticated;
grant update (load_order) on public.shared_customers to authenticated;

drop policy if exists "shared members read" on public.shared_customer_members;
create policy "shared members read" on public.shared_customer_members
  for select to authenticated using (public.can_use_shared_customer(customer_name));
drop policy if exists "shared members add" on public.shared_customer_members;
create policy "shared members add" on public.shared_customer_members
  for insert to authenticated with check (
    exists (select 1 from public.shared_customers c where c.name = customer_name and c.owner_id = auth.uid())
  );
drop policy if exists "shared members remove" on public.shared_customer_members;
create policy "shared members remove" on public.shared_customer_members
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.shared_customers c where c.name = customer_name and c.owner_id = auth.uid())
  );

drop policy if exists "shared loads access" on public.shared_loads;
create policy "shared loads access" on public.shared_loads
  for all to authenticated
  using (public.can_use_shared_customer(customer_name))
  with check (public.can_use_shared_customer(customer_name));

drop policy if exists "shared lane rates access" on public.shared_lane_rates;
create policy "shared lane rates access" on public.shared_lane_rates
  for all to authenticated
  using (public.can_use_shared_customer(customer_name))
  with check (public.can_use_shared_customer(customer_name));

-- Live updates for teammates on shared customers
alter publication supabase_realtime add table public.shared_customers;
alter publication supabase_realtime add table public.shared_customer_members;
alter publication supabase_realtime add table public.shared_loads;
alter publication supabase_realtime add table public.shared_lane_rates;