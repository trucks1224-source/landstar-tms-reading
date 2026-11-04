-- Load-list version history.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Every save of a user's load list (app_data key landstar_customerOrdersMap) can leave
-- a dated copy in app_data_history, kept for 3 days:
--   hourly          the list as saved, at most once an hour
--   before-shrink   the previous list, whenever a save cuts it by more than half
--                   (at most once every 10 minutes), so a wiped list can be rolled back
--   before-restore  the current list, saved by the app right before a restore
-- The copies are made by the database itself, so they are kept whatever app version
-- or browser saved. Users can read and add their own copies only.

begin;

create table if not exists public.app_data_history (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value text not null,
  reason text not null check (reason in ('hourly', 'before-shrink', 'before-restore')),
  summary jsonb,
  saved_at timestamptz not null default now()
);
create index if not exists app_data_history_user_key_saved
  on public.app_data_history (user_id, key, saved_at desc);
alter table public.app_data_history enable row level security;

drop policy if exists "owner reads history" on public.app_data_history;
drop policy if exists "owner saves before restore" on public.app_data_history;
create policy "owner reads history" on public.app_data_history
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owner saves before restore" on public.app_data_history
  for insert to authenticated with check (user_id = (select auth.uid()) and reason = 'before-restore');

-- Per customer: number of loads and booked loads. Null when the value is not a load map.
create or replace function public.load_list_summary(list text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  parsed jsonb;
begin
  begin
    parsed := list::jsonb;
  exception when others then
    return null;
  end;
  if jsonb_typeof(parsed) <> 'object' then
    return null;
  end if;
  return coalesce((
    select jsonb_object_agg(customer.key, jsonb_build_object(
      'loads', case when jsonb_typeof(customer.value) = 'array' then jsonb_array_length(customer.value) else 0 end,
      'booked', case when jsonb_typeof(customer.value) = 'array'
        then (select count(*) from jsonb_array_elements(customer.value) as item where item->>'status' = 'BOOKED')
        else 0 end))
    from jsonb_each(parsed) as customer
  ), '{}'::jsonb);
end;
$$;

-- Fills in the summary for copies the app adds (before-restore).
create or replace function public.app_data_history_fill_summary()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.summary is null then
    new.summary := public.load_list_summary(new.value);
  end if;
  return new;
end;
$$;

drop trigger if exists app_data_history_fill_summary on public.app_data_history;
create trigger app_data_history_fill_summary
  before insert on public.app_data_history
  for each row execute function public.app_data_history_fill_summary();

create or replace function public.app_data_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key <> 'landstar_customerOrdersMap' then
    return new;
  end if;

  -- A save that more than halves a sizable list: keep the list it replaced.
  if tg_op = 'UPDATE' and old.value is not null and length(old.value) > 5000
     and length(new.value) < length(old.value) / 2
     and not exists (
       select 1 from public.app_data_history h
       where h.user_id = new.user_id and h.key = new.key and h.reason = 'before-shrink'
         and h.saved_at > now() - interval '10 minutes')
  then
    insert into public.app_data_history (user_id, key, value, reason)
    values (new.user_id, new.key, old.value, 'before-shrink');
  end if;

  -- At most one hourly copy.
  if not exists (
    select 1 from public.app_data_history h
    where h.user_id = new.user_id and h.key = new.key and h.reason = 'hourly'
      and h.saved_at > now() - interval '1 hour')
  then
    insert into public.app_data_history (user_id, key, value, reason)
    values (new.user_id, new.key, new.value, 'hourly');
  end if;

  delete from public.app_data_history h
  where h.user_id = new.user_id and h.saved_at < now() - interval '3 days';
  return new;
end;
$$;

revoke execute on function public.app_data_snapshot() from public, anon, authenticated;

drop trigger if exists app_data_snapshot on public.app_data;
create trigger app_data_snapshot
  after insert or update on public.app_data
  for each row execute function public.app_data_snapshot();

commit;
