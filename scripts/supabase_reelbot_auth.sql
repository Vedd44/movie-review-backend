create extension if not exists pgcrypto;

create table if not exists public.user_movies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  movie_id bigint not null,
  status text not null check (status in ('saved', 'seen', 'hidden')),
  movie_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, movie_id)
);

alter table public.user_movies
  add column if not exists movie_data jsonb not null default '{}'::jsonb;

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_key text not null default 'reelbot_state',
  last_prompt text,
  last_pick_id bigint,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, session_key)
);

alter table public.user_movies enable row level security;
alter table public.user_sessions enable row level security;

drop policy if exists "user_movies_select_own" on public.user_movies;
create policy "user_movies_select_own"
on public.user_movies
for select
using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "user_movies_insert_own" on public.user_movies;
create policy "user_movies_insert_own"
on public.user_movies
for insert
with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "user_movies_update_own" on public.user_movies;
create policy "user_movies_update_own"
on public.user_movies
for update
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "user_movies_delete_own" on public.user_movies;
create policy "user_movies_delete_own"
on public.user_movies
for delete
using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "user_sessions_select_own" on public.user_sessions;
create policy "user_sessions_select_own"
on public.user_sessions
for select
using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "user_sessions_insert_own" on public.user_sessions;
create policy "user_sessions_insert_own"
on public.user_sessions
for insert
with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "user_sessions_update_own" on public.user_sessions;
create policy "user_sessions_update_own"
on public.user_sessions
for update
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "user_sessions_delete_own" on public.user_sessions;
create policy "user_sessions_delete_own"
on public.user_sessions
for delete
using (auth.uid() is not null and auth.uid() = user_id);
