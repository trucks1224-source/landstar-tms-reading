-- Team status panel (Daniel, 2026-11-27: see at a glance if a teammate's side broke, without them
-- having to tell him). Each teammate's TMS writes its own row every 2 minutes (src/lib/teamStatus.js):
-- whether their upload bot and Google Chat bot run, and when they last exported. Only the TMS owner
-- (src/lib/teamAdmin.js) reads everyone's rows; a teammate sees only their own.
create table if not exists public.team_status (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  name text not null default '',
  posting_code text not null default '',
  bot_state text not null default '',
  bot_message text not null default '',
  chat_state text not null default '',
  chat_message text not null default '',
  last_export_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.team_status enable row level security;

drop policy if exists "read own or owner reads team_status" on public.team_status;
create policy "read own or owner reads team_status" on public.team_status
  for select to authenticated
  using (user_id = (select auth.uid()) or (select auth.uid()) = '1ad2f272-4490-4fe8-9c7d-bd692e107f8a'::uuid);

drop policy if exists "write own team_status" on public.team_status;
create policy "write own team_status" on public.team_status
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "update own team_status" on public.team_status;
create policy "update own team_status" on public.team_status
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
