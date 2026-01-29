-- Memory game leaderboard table + policies

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  player_name text not null,
  moves integer not null,
  time_ms integer not null,
  board_size integer not null,
  created_at timestamptz not null default now()
);

create index if not exists scores_board_size_time_idx
  on public.scores (board_size, time_ms, moves, created_at);

alter table public.scores enable row level security;

create policy if not exists "scores_select_public"
  on public.scores
  for select
  using (true);

create policy if not exists "scores_insert_public"
  on public.scores
  for insert
  with check (true);
