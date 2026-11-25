-- Team-wide data every teammate sees (Daniel, 2026-11-25: teammates should see the 🔥 hot lanes and
-- ⬆ RAISED badges just like the owner). Only the TMS owner (src/lib/teamAdmin.js) writes it.
--   key 'hotLanes'   : the hot lanes from the last order export import
--   key 'rateRaises' : { loadId: rateRaise } for loads the owner's bot raised on Landstar
create table if not exists public.team_data (
  key text primary key,
  value text not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.team_data enable row level security;

drop policy if exists "team reads team_data" on public.team_data;
create policy "team reads team_data" on public.team_data
  for select to authenticated using (true);

drop policy if exists "owner writes team_data" on public.team_data;
create policy "owner writes team_data" on public.team_data
  for insert to authenticated with check ((select auth.uid()) = '1ad2f272-4490-4fe8-9c7d-bd692e107f8a'::uuid);

drop policy if exists "owner updates team_data" on public.team_data;
create policy "owner updates team_data" on public.team_data
  for update to authenticated
  using ((select auth.uid()) = '1ad2f272-4490-4fe8-9c7d-bd692e107f8a'::uuid)
  with check ((select auth.uid()) = '1ad2f272-4490-4fe8-9c7d-bd692e107f8a'::uuid);

alter publication supabase_realtime add table public.team_data;
