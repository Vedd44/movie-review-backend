-- ReelBot public feedback intake.
-- Run once in the ReelBot Supabase SQL editor.
-- Public clients may submit feedback, but cannot read/update/delete rows.

create extension if not exists pgcrypto;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('feature', 'recommendation', 'bug', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  email text,
  page_url text,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.feedback enable row level security;

drop policy if exists "feedback_public_insert" on public.feedback;
create policy "feedback_public_insert"
on public.feedback
for insert
to anon, authenticated
with check (
  char_length(message) between 1 and 2000
  and type in ('feature', 'recommendation', 'bug', 'other')
);

-- Intentionally no public SELECT, UPDATE, or DELETE policies.
