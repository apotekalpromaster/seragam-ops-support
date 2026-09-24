-- Stub minimal objek Supabase (auth schema & role) supaya migration bisa
-- dijalankan di PGlite untuk pengujian dan mode demo. TIDAK dipakai di Supabase.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text unique);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
grant usage on schema auth to authenticated, anon;
grant select on auth.users to authenticated;
grant execute on function auth.uid() to authenticated, anon;
