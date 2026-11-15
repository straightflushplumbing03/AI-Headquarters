-- tests/sql/supabase_shim.sql
-- Local-only stand-in for the Supabase platform objects the migrations use.
-- Apply to a scratch Postgres BEFORE supabase/migrations/*.sql. Never apply
-- this to a hosted Supabase project.
--
-- auth.uid() / auth.role() read session settings, so tests impersonate a user
-- with:  SET ROLE authenticated; SET request.jwt.claim.sub = '<uuid>';

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END;
$roles$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), current_user::text)
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('sub', auth.uid(), 'role', auth.role())
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text, public boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid
);
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;

GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- Reproduce Supabase's default privileges for the public schema.
--
-- On a hosted Supabase project, tables and sequences created in `public` are
-- automatically granted to the API roles, so a migration that REVOKEs and then
-- asserts the app still holds a privilege is testing the real state. A scratch
-- Postgres has no such defaults: migration 028 revoked grants that were never
-- made, its assertion raised, and the whole transaction rolled back -- so the
-- migration set never converged and `verify-migrations.sh` failed on a fresh
-- database. Setting the defaults here restores the platform behaviour.
--
-- The grants themselves are attached to `postgres`, the role that runs the
-- migrations, because ALTER DEFAULT PRIVILEGES only applies to objects created
-- by the role that runs it.
--
-- Verified against the Supabase docs ("Securing your API"): "By default on
-- existing projects, tables and functions you create in `public` are
-- automatically granted SELECT, INSERT, UPDATE, DELETE (or EXECUTE for
-- functions) to anon, authenticated, and service_role."
-- https://supabase.com/docs/guides/api/securing-your-api
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
