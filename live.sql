-- Live bias engine output: one row per session date, written by /api/push-tick (service role).
create table if not exists public.live (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.live enable row level security;
create policy "members read live" on public.live for select to authenticated using (public.has_access());
alter publication supabase_realtime add table public.live;
create or replace function public.set_live_pushed(p_id text, p_pushed jsonb) returns void
language sql as $$
  update public.live set data = jsonb_set(data, '{pushed}', p_pushed, true) where id = p_id;
$$;
revoke execute on function public.set_live_pushed(text, jsonb) from public, anon, authenticated;
grant execute on function public.set_live_pushed(text, jsonb) to service_role;
