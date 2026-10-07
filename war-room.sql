-- War room: callsigns, the pre-open bias vote + leaderboard, and phone push alerts.

-- Callsigns shown on the leaderboard.
alter table public.members add column if not exists callsign text;
create unique index if not exists members_callsign_key on public.members (lower(callsign)) where callsign is not null;

create or replace function public.set_callsign(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_name, ''));
begin
  if not public.has_access() then raise exception 'No access'; end if;
  if n !~ '^[A-Za-z0-9_.-]{3,20}$' then raise exception 'Callsign must be 3–20 letters, numbers, _ - or .'; end if;
  update public.members set callsign = n where user_id = auth.uid();
  return n;
exception when unique_violation then raise exception 'That callsign is taken';
end $$;
revoke execute on function public.set_callsign(text) from public, anon;
grant execute on function public.set_callsign(text) to authenticated;

create or replace function public.my_callsign() returns text
language sql stable security definer set search_path = public as $$
  select callsign from public.members where user_id = auth.uid();
$$;
revoke execute on function public.my_callsign() from public, anon;
grant execute on function public.my_callsign() to authenticated;

-- Pre-open vote: members lock bull or bear on the session before 9:30 ET.
create table if not exists public.votes (
  day        text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  side       text not null check (side in ('bull','bear')),
  created_at timestamptz not null default now(),
  primary key (day, user_id)
);
alter table public.votes enable row level security;  -- no direct access; functions below only

create or replace function public.vote_tally(p_day text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.has_access() then null else jsonb_build_object(
    'day', p_day,
    'bull', (select count(*) from public.votes where day = p_day and side = 'bull'),
    'bear', (select count(*) from public.votes where day = p_day and side = 'bear'),
    'mine', (select side from public.votes where day = p_day and user_id = auth.uid()),
    'closesAt', ((p_day::date + time '09:30') at time zone 'America/New_York')) end;
$$;

create or replace function public.cast_vote(p_day text, p_side text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_access() then raise exception 'No access'; end if;
  if p_side not in ('bull','bear') then raise exception 'Pick bull or bear'; end if;
  if not exists (select 1 from public.briefs where id = p_day) then raise exception 'No session for that day'; end if;
  if now() >= ((p_day::date + time '09:30') at time zone 'America/New_York') then raise exception 'Voting closed at 9:30 ET'; end if;
  insert into public.votes (day, user_id, side) values (p_day, auth.uid(), p_side)
    on conflict (day, user_id) do update set side = excluded.side, created_at = now();
  return public.vote_tally(p_day);
end $$;

-- Leaderboard: a vote hits when NQ's graded 9:30–12:00 move went that way.
create or replace function public.vote_board() returns jsonb
language sql stable security definer set search_path = public as $$
  with g as (
    select id, (data->'grade'->'NQ'->>'movePct')::numeric as mv
    from public.briefs where data->'grade'->'NQ'->>'movePct' ~ '^-?[0-9]+(\.[0-9]+)?$'
  ), v as (
    select v.user_id, count(*) as n,
           count(*) filter (where (v.side = 'bull' and g.mv > 0) or (v.side = 'bear' and g.mv < 0)) as hits
    from public.votes v join g on g.id = v.day where g.mv <> 0 group by v.user_id
  )
  select case when not public.has_access() then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
      'name', coalesce(m.callsign, 'Trader-' || upper(substr(md5(m.user_id::text), 1, 4))),
      'n', v.n, 'hits', v.hits, 'me', m.user_id = auth.uid())
    order by (v.hits::numeric / v.n) desc, v.n desc), '[]'::jsonb) end
  from v join public.members m using (user_id);
$$;

revoke execute on function public.vote_tally(text), public.cast_vote(text, text), public.vote_board() from public, anon;
grant execute on function public.vote_tally(text), public.cast_vote(text, text), public.vote_board() to authenticated;

-- Push alerts. Server-only tables (service role); no client policies.
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  sub        jsonb not null,
  prefs      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.push_log (
  k       text primary key,
  sent_at timestamptz not null default now()
);
create table if not exists public.app_secrets (
  k text primary key,
  v text not null
);
alter table public.push_subs  enable row level security;
alter table public.push_log   enable row level security;
alter table public.app_secrets enable row level security;

insert into public.app_secrets (k, v) values ('tick_token', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (k) do nothing;

-- Every minute Sun–Fri the database pings the site, which sends any new alerts.
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'verdict-push-tick';
select cron.schedule('verdict-push-tick', '* * * * 0-5', $job$
  select net.http_post(
    url := 'https://verdict-sooty-delta.vercel.app/api/push-tick',
    headers := jsonb_build_object('content-type', 'application/json', 'x-tick', (select v from public.app_secrets where k = 'tick_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000);
$job$);
