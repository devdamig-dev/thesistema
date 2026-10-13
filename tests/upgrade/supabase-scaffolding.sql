-- Managed-service scaffolding for isolated tests only. Never run in production.

    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema storage;
    create table storage.buckets (
      id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (id uuid primary key, bucket_id text, name text);
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select current_user::text
    $$;
    grant usage on schema public, auth to authenticated, anon, service_role;
    grant execute on function auth.uid(), auth.role() to authenticated, anon, service_role;
    alter default privileges in schema public grant all on tables to authenticated, service_role;
    create publication supabase_realtime;
