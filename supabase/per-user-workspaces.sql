-- One-time migration from the shared team workspace to one workspace per user.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Existing data, the Gmail email loads and the starting My Settings values are
-- assigned to the original workspace owner below.

begin;

-- ---------------------------------------------------------------
-- app_data: one copy of every key per signed-in user
-- ---------------------------------------------------------------
alter table public.app_data add column if not exists user_id uuid references auth.users (id) on delete cascade;
update public.app_data set user_id = '1ad2f272-4490-4fe8-9c7d-bd692e107f8a' where user_id is null;
alter table public.app_data alter column user_id set not null;
alter table public.app_data alter column user_id set default auth.uid();
alter table public.app_data drop constraint if exists app_data_pkey;
alter table public.app_data add primary key (user_id, key);

drop policy if exists "team can read app_data" on public.app_data;
drop policy if exists "team can insert app_data" on public.app_data;
drop policy if exists "team can update app_data" on public.app_data;
drop policy if exists "users read own app_data" on public.app_data;
drop policy if exists "users insert own app_data" on public.app_data;
drop policy if exists "users update own app_data" on public.app_data;
create policy "users read own app_data" on public.app_data
  for select to authenticated using (user_id = auth.uid());
create policy "users insert own app_data" on public.app_data
  for insert to authenticated with check (user_id = auth.uid());
create policy "users update own app_data" on public.app_data
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The owner keeps the phone number, posting code and visibility group used so far.
insert into public.app_data (user_id, key, value)
values (
  '1ad2f272-4490-4fe8-9c7d-bd692e107f8a',
  'landstar_profile',
  '{"phone":"4845756486","postingCode":"ANQ","visibilityGroup":"ANQ"}'
)
on conflict (user_id, key) do nothing;

-- ---------------------------------------------------------------
-- email_loads: Gmail loads belong to the owner of the connected Gmail
-- ---------------------------------------------------------------
alter table public.email_loads add column if not exists owner_id uuid
  references auth.users (id) on delete cascade
  default '1ad2f272-4490-4fe8-9c7d-bd692e107f8a';
update public.email_loads set owner_id = '1ad2f272-4490-4fe8-9c7d-bd692e107f8a' where owner_id is null;

drop policy if exists "team can read email_loads" on public.email_loads;
drop policy if exists "team can update email_loads" on public.email_loads;
drop policy if exists "owner reads email_loads" on public.email_loads;
drop policy if exists "owner updates email_loads" on public.email_loads;
create policy "owner reads email_loads" on public.email_loads
  for select to authenticated using (owner_id = auth.uid());
create policy "owner updates email_loads" on public.email_loads
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

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
commit;
