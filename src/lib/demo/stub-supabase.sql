-- Stub minimal objek Supabase (auth schema & role) supaya migration bisa
-- dijalankan di PGlite untuk pengujian dan mode demo. TIDAK dipakai di Supabase.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text unique);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
grant usage on schema auth to authenticated, anon;
grant select on auth.users to authenticated;
grant execute on function auth.uid() to authenticated, anon;

-- Pengganti Supabase Storage di mode demo (file BAST disimpan di database browser).
create schema if not exists demo_store;
create table if not exists demo_store.files (path text primary key, mime text, data bytea not null, created_at timestamptz default now());
grant usage on schema demo_store to authenticated;
grant select, insert on demo_store.files to authenticated;
