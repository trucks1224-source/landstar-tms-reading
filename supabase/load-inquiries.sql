-- Driver load-inquiry links.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- load_inquiry_links: one shareable link per load. The token is a long random
--   string; only the server (service-role key, api/load-inquiry.js) reads a link
--   by token for the public driver page. Signed-in users manage their own links.
-- load_inquiries: what drivers submit. Only the server inserts; the owner of the
--   link can read them and mark them seen.

begin;

create table if not exists public.load_inquiry_links (
  token text primary key check (char_length(token) >= 20),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email text,
  customer text not null,
  load_id text not null,
  details jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, customer, load_id)
);
alter table public.load_inquiry_links enable row level security;

drop policy if exists "owner reads inquiry links" on public.load_inquiry_links;
drop policy if exists "owner creates inquiry links" on public.load_inquiry_links;
drop policy if exists "owner updates inquiry links" on public.load_inquiry_links;
create policy "owner reads inquiry links" on public.load_inquiry_links
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner creates inquiry links" on public.load_inquiry_links
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "owner updates inquiry links" on public.load_inquiry_links
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create table if not exists public.load_inquiries (
  id uuid primary key default gen_random_uuid(),
  token text not null references public.load_inquiry_links (token) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  customer text not null,
  load_id text not null,
  driver_name text not null,
  driver_phone text not null,
  mc_or_truck text,
  message text,
  notified boolean not null default false,
  notify_error text,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists load_inquiries_owner_created on public.load_inquiries (owner_id, created_at desc);
create index if not exists load_inquiries_token_created on public.load_inquiries (token, created_at desc);
alter table public.load_inquiries enable row level security;

drop policy if exists "owner reads inquiries" on public.load_inquiries;
drop policy if exists "owner marks inquiries seen" on public.load_inquiries;
create policy "owner reads inquiries" on public.load_inquiries
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner marks inquiries seen" on public.load_inquiries
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

commit;
