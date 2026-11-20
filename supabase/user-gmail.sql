-- Each teammate's own Gmail connection (prospect outreach from the website).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- user_gmail_connection: one Google refresh token per TMS user, saved by
--   /api/gmail-connect after that user approves Gmail access on the website.
--   Row level security is on with NO policies: browsers can never read or
--   change it; only the server (service role) uses it, in api/prospect-email.js.
--   The office's own connection (gmail_connection, id 1) is separate and unchanged.

begin;

create table if not exists public.user_gmail_connection (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_gmail_connection enable row level security;
revoke all on public.user_gmail_connection from anon, authenticated;

commit;
