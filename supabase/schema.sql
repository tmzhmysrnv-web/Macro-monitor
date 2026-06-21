-- supabase/schema.sql
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- Creates the user profile / preferences / interests tables, row-level security
-- so each user can only touch their own rows, and a trigger that seeds a profile
-- (+ default preferences) the moment an auth user is created.

-- ── profiles ──────────────────────────────────────────────────────────
-- Mirrors the bits of auth.users the app needs (email, Google name/avatar).
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- ── user_preferences ──────────────────────────────────────────────────
-- One row per user. digest_frequency: 'breaking' | 'daily' | 'weekly'.
create table if not exists public.user_preferences (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  digest_frequency text not null default 'weekly'
                     check (digest_frequency in ('breaking', 'daily', 'weekly')),
  email_enabled    boolean not null default true,
  push_enabled     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── user_interests ────────────────────────────────────────────────────
-- Many rows per user; one per selected topic category.
create table if not exists public.user_interests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   text not null,
  created_at timestamptz not null default now(),
  unique (user_id, category)
);
create index if not exists user_interests_user_idx on public.user_interests (user_id);

-- ── Row Level Security ────────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_interests   enable row level security;

-- profiles: a user can see + edit only their own profile row.
drop policy if exists "profiles self" on public.profiles;
create policy "profiles self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- preferences: self only.
drop policy if exists "preferences self" on public.user_preferences;
create policy "preferences self" on public.user_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- interests: self only.
drop policy if exists "interests self" on public.user_interests;
create policy "interests self" on public.user_interests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── New-user trigger ──────────────────────────────────────────────────
-- On auth.users insert, seed a profile (email + Google name/avatar from the
-- OAuth metadata) and a default preferences row. SECURITY DEFINER so it runs
-- regardless of the inserting role; RLS above still guards client access.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
