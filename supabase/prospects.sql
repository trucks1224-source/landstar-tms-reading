-- Broker prospects (new-customer outreach from DAT postings).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- prospects: brokers captured from DAT posting screenshots in the TMS Prospects
--   panel. Each signed-in user keeps their own list (one row per broker email).
--   The TMS emails them through the connected Gmail and records replies here.

begin;

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company text not null default '',
  contact text not null default '',
  email text not null check (position('@' in email) > 1),
  phone text not null default '',
  lane text not null default '',
  equipment text not null default '',
  notes text not null default '',
  -- new -> emailed -> followed-up -> replied -> customer (or dead)
  status text not null default 'new'
    check (status in ('new', 'emailed', 'followed-up', 'replied', 'customer', 'dead')),
  emailed_at timestamptz,
  followed_up_at timestamptz,
  replied_at timestamptz,
  reply_snippet text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, email)
);
create index if not exists prospects_owner_status on public.prospects (owner_id, status, created_at desc);
alter table public.prospects enable row level security;

drop policy if exists "owner reads prospects" on public.prospects;
drop policy if exists "owner creates prospects" on public.prospects;
drop policy if exists "owner updates prospects" on public.prospects;
drop policy if exists "owner deletes prospects" on public.prospects;
create policy "owner reads prospects" on public.prospects
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner creates prospects" on public.prospects
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "owner updates prospects" on public.prospects
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner deletes prospects" on public.prospects
  for delete to authenticated using (owner_id = (select auth.uid()));

commit;
