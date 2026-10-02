-- Verdict: Supabase schema. Run once in the SQL editor (or via the Supabase connector).

-- Briefs: one row per session date (YYYY-MM-DD). `data` holds the full brief document
-- exactly as the Claude scheduled tasks write it.
create table if not exists public.briefs (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Members: who can see briefs. Only the server (service role) writes this table.
create table if not exists public.members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text,
  role         text not null default 'member' check (role in ('member','admin')),
  source       text,                -- 'owner' | 'comp' | 'license'
  license_key  text unique,
  active       boolean not null default false,
  checked_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- Comped emails: free access granted by the admin.
create table if not exists public.comps (
  email     text primary key,
  note      text,
  added_at  timestamptz not null default now()
);

-- Access helpers used by row-level security.
create or replace function public.has_access() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'admin');
$$;

alter table public.briefs  enable row level security;
alter table public.members enable row level security;
alter table public.comps   enable row level security;

drop policy if exists "members read briefs" on public.briefs;
create policy "members read briefs" on public.briefs for select to authenticated using (public.has_access());

drop policy if exists "read own membership" on public.members;
create policy "read own membership" on public.members for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admin manages comps" on public.comps;
create policy "admin manages comps" on public.comps for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Live updates to the page.
do $$ begin
  alter publication supabase_realtime add table public.briefs;
exception when duplicate_object then null; end $$;

-- Write helpers for the Claude scheduled tasks (they run SQL through the Supabase connector).
-- Full brief upsert (brief runs).
create or replace function public.upsert_brief(p_id text, p_data jsonb) returns void
language sql as $$
  insert into public.briefs (id, data, updated_at) values (p_id, p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
$$;

-- News watcher: prepend new news items (cap 40) and replace the watch object.
create or replace function public.merge_watch(p_id text, p_news jsonb, p_watch jsonb) returns void
language sql as $$
  update public.briefs b set
    data = jsonb_set(b.data, '{watch}', coalesce(p_watch, b.data->'watch', 'null'::jsonb))
           || jsonb_build_object('news', (
                select coalesce(jsonb_agg(x), '[]'::jsonb)
                from (select x from jsonb_array_elements(coalesce(p_news, '[]'::jsonb) || coalesce(b.data->'news', '[]'::jsonb)) as t(x) limit 40) s)),
    updated_at = now()
  where b.id = p_id;
$$;

-- Grader: set the grade object.
create or replace function public.set_grade(p_id text, p_grade jsonb) returns void
language sql as $$
  update public.briefs set data = data || jsonb_build_object('grade', p_grade), updated_at = now() where id = p_id;
$$;

revoke execute on function public.upsert_brief(text, jsonb) from public, anon, authenticated;
revoke execute on function public.merge_watch(text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.set_grade(text, jsonb) from public, anon, authenticated;

-- ---------- Private-app extras: your levels and the free Run/Scan queue ----------
create table if not exists public.inputs (
  id          text primary key,          -- session date
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.requests (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('run','scan')),
  status      text not null default 'queued' check (status in ('queued','done')),
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);

alter table public.inputs   enable row level security;
alter table public.requests enable row level security;

drop policy if exists "admin manages inputs" on public.inputs;
create policy "admin manages inputs" on public.inputs for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manages requests" on public.requests;
create policy "admin manages requests" on public.requests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- The news watcher calls this each run: returns queued requests from the last 6 hours and marks them done.
create or replace function public.take_requests() returns setof public.requests
language sql as $$
  update public.requests set status = 'done', done_at = now()
  where status = 'queued' and created_at > now() - interval '6 hours'
  returning *;
$$;
revoke execute on function public.take_requests() from public, anon, authenticated;
