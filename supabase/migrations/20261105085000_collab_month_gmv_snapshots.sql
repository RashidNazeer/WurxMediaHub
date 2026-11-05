-- ============================================================================
-- WHAT A CREATOR SOLD FOR A BRAND IN A MONTH, FROZEN WHEN THE MONTH CLOSES.
--
-- Rashid, 2026-11-05: find a way to sum up and calculate the total GMV a creator
-- has made at the end of the month for a certain brand, through her videos for
-- that brand; and show it in the Creators table.
--
-- THE FIGURE. For one creator and one brand, over one calendar month: every
-- video she posted for that brand in that month, each counted ONCE, at its GMV.
--
--   whose        the person (the trimmed, lower-cased name, the key the Creators
--                tab already uses to tell one person from another), across ALL of
--                her rows for the brand. A creator hired in September who posts in
--                October has her October videos on a September row; a per-row
--                figure cannot see that, and a per-row sum counts a video that
--                sits on two of her rows twice (84 times in Penetrex's history).
--   which month  the day the VIDEO WAS POSTED (`video_codes[].date`), not the
--                month the deal was signed. A video with no date cannot be placed
--                in any month and is left out; it carries no GMV today.
--   once         keyed on TikTok's video id (`/video/<digits>`), or the link when
--                there is none: exactly the rule the app's own totals use
--                (`wxVideoTotals`), so this figure and the brand cards cannot
--                disagree. Where two rows hold different figures for one video the
--                larger wins, because a video's GMV only ever grows, so the larger
--                is the newer sync.
--   how much     `video_codes[].revenue`. A video is counted three ways, and the
--                three are kept apart on purpose: WITH SALES (revenue above 0),
--                ZERO (synced, sold nothing) and UNSYNCED (no revenue figure at
--                all, which is a hand-added ad code or one the syncs have not
--                reached). Unsynced is "not reported", never $0.
--
-- WHY IT MUST BE FROZEN. A video's GMV is a running total that every sync
-- overwrites with the latest, and nothing keeps the history. October's figure
-- therefore keeps rising after October ends, and next month there would be no way
-- to say what it was on 31 October. So at the start of every month the previous
-- month is written into collab_gmv_snapshots, once, and never changed.
--
-- THE LIVE FIGURE IS FOR ANY RANGE, so the screen computes it itself from the
-- rows it already holds (src/lib/admin/month-gmv.ts). `collab_month_gmv` below is
-- the same calculation in SQL, which is what freezes a month, and a test
-- (scripts/verify/collabs/check-month-gmv.mjs) fails if the two ever disagree.
--
-- READ BY the Paid Collabs team (staff plus the read-only collabs roles), through
-- is_collabs_viewer(), exactly as the creators table itself is. Written only by
-- the scheduled job and the service role. No policy lets a browser write.
-- ============================================================================

-- ------------------------------------------------------------ the calculation --
create or replace function public.collab_month_gmv(p_month text)
returns table (
  brand            text,
  creator_key      text,
  creator_name     text,
  videos           integer,
  videos_with_sales integer,
  videos_zero      integer,
  videos_unsynced  integer,
  gmv              numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with entries as (
    select
      btrim(c.brand)                       as brand,
      lower(btrim(c.name))                 as creator_key,
      btrim(c.name)                        as creator_name,
      btrim(coalesce(v ->> 'video', ''))   as url,
      case when (v ->> 'date') ~ '^\d{4}-\d{2}-\d{2}' then left(v ->> 'date', 10) end as day,
      case
        when jsonb_typeof(v -> 'revenue') = 'number' then (v ->> 'revenue')::numeric
        -- older rows hold some figures as text; the app's totals read those as numbers
        when jsonb_typeof(v -> 'revenue') = 'string' and btrim(v ->> 'revenue') ~ '^-?\d+(\.\d+)?$'
          then btrim(v ->> 'revenue')::numeric
      end as revenue
    from wurxbase.creators c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.video_codes) = 'array' then c.video_codes else '[]'::jsonb end
    ) as v
    where btrim(coalesce(c.brand, '')) <> ''
      and btrim(coalesce(c.name, ''))  <> ''
  ),
  keyed as (
    select
      brand, creator_key, creator_name, day, revenue,
      coalesce((regexp_match(url, '/video/(\d+)'))[1], url) as vkey
    from entries
    where url <> '' and day is not null
  ),
  videos as (
    select
      brand, creator_key,
      min(creator_name) as creator_name,
      vkey,
      min(day)          as day,
      max(revenue)      as revenue          -- the larger figure is the newer sync; null if none had one
    from keyed
    group by brand, creator_key, vkey
  )
  select
    v.brand,
    v.creator_key,
    min(v.creator_name),
    count(*)::integer,
    (count(*) filter (where coalesce(v.revenue, 0) > 0))::integer,
    (count(*) filter (where v.revenue is not null and v.revenue <= 0))::integer,
    (count(*) filter (where v.revenue is null))::integer,
    coalesce(sum(greatest(v.revenue, 0)), 0)
  from videos v
  where left(v.day, 7) = p_month
  group by v.brand, v.creator_key
$$;

comment on function public.collab_month_gmv(text) is
  'One calendar month (YYYY-MM): per creator and brand, the GMV of the distinct videos posted that month, across all of the creator''s rows, each video once at its larger figure. Splits videos into with sales, zero and unsynced. Invoker rights, so it sees only what the caller may read. The same calculation as src/lib/admin/month-gmv.ts; a test keeps them equal.';

revoke all on function public.collab_month_gmv(text) from public, anon;
grant execute on function public.collab_month_gmv(text) to authenticated, service_role;

-- ------------------------------------------------------------------- tables --
-- One row per month that has been frozen, even a month with nothing in it, so
-- "frozen and empty" can be told from "not frozen yet" and the job does not try
-- again every night for ever.
create table if not exists public.collab_gmv_freezes (
  month      text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  frozen_at  timestamptz not null default now(),
  row_count  integer not null check (row_count >= 0),
  total_gmv  numeric(14,2) not null check (total_gmv >= 0),
  -- 'scheduled' is the job at the start of the month. 'backfill' is a month that
  -- had already ended when this was first switched on, frozen late: its figure
  -- includes whatever the videos earned between month end and that day, and
  -- frozen_at says how late.
  source     text not null check (source in ('scheduled', 'backfill'))
);

create table if not exists public.collab_gmv_snapshots (
  id                uuid primary key default gen_random_uuid(),
  month             text not null references public.collab_gmv_freezes (month),
  brand             text not null check (length(btrim(brand)) between 1 and 120),
  creator_key       text not null,
  creator_name      text not null,
  videos            integer not null check (videos >= 0),
  videos_with_sales integer not null check (videos_with_sales >= 0),
  videos_zero       integer not null check (videos_zero >= 0),
  videos_unsynced   integer not null check (videos_unsynced >= 0),
  gmv               numeric(14,2) not null check (gmv >= 0),
  unique (month, brand, creator_key)
);

create index if not exists collab_gmv_snapshots_month_brand_idx
  on public.collab_gmv_snapshots (month, brand);

comment on table public.collab_gmv_freezes is
  'The months whose creator-by-brand GMV has been frozen, and when. Written only by collab_gmv_freeze.';
comment on table public.collab_gmv_snapshots is
  'A creator''s GMV for one brand in one closed month, as it stood when the month was frozen. Immutable: no policy allows an update or a delete. Written only by collab_gmv_freeze.';

-- ------------------------------------------------------------ row security --
alter table public.collab_gmv_freezes   enable row level security;
alter table public.collab_gmv_snapshots enable row level security;

drop policy if exists collab_gmv_freezes_select_collabs on public.collab_gmv_freezes;
create policy collab_gmv_freezes_select_collabs on public.collab_gmv_freezes
  for select to authenticated using (public.is_collabs_viewer());

drop policy if exists collab_gmv_snapshots_select_collabs on public.collab_gmv_snapshots;
create policy collab_gmv_snapshots_select_collabs on public.collab_gmv_snapshots
  for select to authenticated using (public.is_collabs_viewer());

-- No insert, update or delete policy on either table.

-- ------------------------------------------------------------------ grants --
-- "Automatically expose new tables" is off, which also drops the default grants to
-- service_role. Without these the job would silently write nothing.
grant select on table public.collab_gmv_freezes   to authenticated;
grant select on table public.collab_gmv_snapshots to authenticated;
grant all privileges on table public.collab_gmv_freezes   to service_role;
grant all privileges on table public.collab_gmv_snapshots to service_role;

-- ------------------------------------------------------------ the freezing --
-- Freeze one CLOSED month. Idempotent: a month already frozen is left exactly as
-- it is and the function answers 0. A month that has not ended is refused,
-- because a "month-end" figure taken mid-month would be a lie with a date on it.
create or replace function public.collab_gmv_freeze(p_month text, p_source text default 'scheduled')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_this  text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_rows  integer;
  v_total numeric;
begin
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'the month must look like 2026-10';
  end if;
  if p_month >= v_this then
    raise exception '% has not ended yet, so it cannot be frozen', p_month;
  end if;
  if p_source not in ('scheduled', 'backfill') then
    raise exception 'the source must be scheduled or backfill';
  end if;
  if exists (select 1 from public.collab_gmv_freezes f where f.month = p_month) then
    return 0;
  end if;

  -- The freeze row first: the snapshots refer to it, and the primary key makes two
  -- runs at once safe (the loser gets a unique violation and writes nothing).
  insert into public.collab_gmv_freezes (month, row_count, total_gmv, source)
  values (p_month, 0, 0, p_source);

  insert into public.collab_gmv_snapshots
    (month, brand, creator_key, creator_name, videos, videos_with_sales, videos_zero, videos_unsynced, gmv)
  select p_month, g.brand, g.creator_key, g.creator_name, g.videos, g.videos_with_sales,
         g.videos_zero, g.videos_unsynced, round(g.gmv, 2)
  from public.collab_month_gmv(p_month) g;

  select count(*)::integer, coalesce(sum(s.gmv), 0)
    into v_rows, v_total
    from public.collab_gmv_snapshots s
   where s.month = p_month;

  update public.collab_gmv_freezes set row_count = v_rows, total_gmv = v_total where month = p_month;
  return v_rows;
end;
$$;

revoke all on function public.collab_gmv_freeze(text, text) from public, anon, authenticated;
grant execute on function public.collab_gmv_freeze(text, text) to service_role;

-- What the nightly job calls: the month that has just ended, if it is not frozen.
-- Tried every night, not only on the 1st, so a night when it failed (the database
-- paused, a deploy) is repaired the next night instead of leaving a gap.
create or replace function public.collab_gmv_freeze_previous_month()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.collab_gmv_freeze(
    to_char((date_trunc('month', now() at time zone 'UTC') - interval '1 month'), 'YYYY-MM'),
    'scheduled'
  );
end;
$$;

revoke all on function public.collab_gmv_freeze_previous_month() from public, anon, authenticated;
grant execute on function public.collab_gmv_freeze_previous_month() to service_role;

-- ---------------------------------------------------------------- schedule --
-- 00:20 UTC, a few minutes after the day turns over. The previous month is
-- written once; every later night finds it done and does nothing.
select cron.unschedule('collab-gmv-freeze')
where exists (select 1 from cron.job where jobname = 'collab-gmv-freeze');

select cron.schedule(
  'collab-gmv-freeze',
  '20 0 * * *',
  $$ select public.collab_gmv_freeze_previous_month(); $$
);
