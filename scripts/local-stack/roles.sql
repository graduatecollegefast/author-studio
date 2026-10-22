-- Minimal Supabase-compatible roles and schemas for a local stack built from
-- the open-source Supabase services (GoTrue, PostgREST, Storage API).
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator login password 'postgres' noinherit; end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login password 'postgres' noinherit createrole; end if;
  if not exists (select from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin login password 'postgres' noinherit createrole; end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to supabase_storage_admin;
alter role postgres set search_path = public, extensions;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role, postgres;
alter role supabase_auth_admin set search_path = auth;
create schema if not exists storage authorization supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role, postgres;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant create on database postgres to supabase_storage_admin, supabase_auth_admin;
