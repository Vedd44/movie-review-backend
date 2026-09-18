create table if not exists public.reelbot_movie_takes (
  movie_id bigint not null,
  take_version text not null,
  context_hash text not null,
  take jsonb not null,
  model text not null,
  generated_at timestamptz not null default now(),
  primary key (movie_id, take_version)
);

alter table public.reelbot_movie_takes enable row level security;

revoke all on public.reelbot_movie_takes from anon, authenticated;
