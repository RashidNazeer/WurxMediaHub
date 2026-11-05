-- ============================================================================
-- A CREATOR'S GMV FOR A BRAND IS WHAT SHE HAS MADE SO FAR, NOT WHAT SHE POSTED
-- IN THE MONTH.
--
-- Rashid, 2026-11-06, correcting the first version (20261105085000): the figure
-- at the end of October is the SUM OF ALL THE GMV HER VIDEOS FOR THAT BRAND HAVE
-- MADE SO FAR. A creator who posted in September still earns in October, and a
-- sale can come from a video she made three months ago, so the month-end figure
-- adds every video she has posted for the brand up to the end of the month,
-- whenever it was posted.
--
-- WHERE THE GMV COMES FROM. Each video's `revenue` is its lifetime GMV as the
-- Euka and Reacher syncs last reported it, overwritten on every sync, so older
-- videos are in the data and keep growing. Nothing else is fetched: this adds up
-- what the syncs already hold. (Measured on 2026-11-06: every dated video from
-- April back to November 2025 is synced bar 35 in April-July; the ones with no
-- date, 1,036 of them, carry no GMV and are left out because they cannot be placed
-- before a month end.)
--
-- WHAT CHANGES, in `collab_month_gmv(p_month)`:
--   gmv, videos, with-sales, zero, unsynced   now cover every video posted on or
--                                              before the last day of p_month
--   month_videos, month_gmv                   NEW: the part of it posted IN the month
--
-- and the frozen snapshot keeps both, so the hover can say "$X so far, of which $Y
-- from videos posted in October".
--
-- THE ALREADY-FROZEN MONTHS ARE FROZEN AGAIN. October was frozen on 2026-11-05
-- with the old meaning (posted in the month). That is a different quantity under
-- the same name, not a figure to keep, and no month has been frozen with the new
-- meaning. So the first run of this migration (and only the first: it keys on the
-- new column not existing yet) clears the old snapshots and freezes those months
-- again as 'backfill', which is what they are: frozen after the month ended, so
-- they include what the videos earned since. Every month from here on is frozen
-- on schedule at 00:20 UTC on the 1st and never touched.
-- ============================================================================

drop function if exists public.collab_month_gmv(text);

create function public.collab_month_gmv(p_month text)
returns table (
  brand            text,
  creator_key      text,
  creator_name     text,
  videos           integer,
  videos_with_sales integer,
  videos_zero      integer,
  videos_unsynced  integer,
  gmv              numeric,
  month_videos     integer,
  month_gmv        numeric
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
      max(revenue)      as revenue
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
    coalesce(sum(greatest(v.revenue, 0)), 0),
    (count(*) filter (where left(v.day, 7) = p_month))::integer,
    coalesce(sum(greatest(v.revenue, 0)) filter (where left(v.day, 7) = p_month), 0)
  from videos v
  where left(v.day, 7) <= p_month
  group by v.brand, v.creator_key
$$;

comment on function public.collab_month_gmv(text) is
  'One calendar month (YYYY-MM): per creator and brand, the GMV of ALL the distinct videos she has posted for the brand up to the end of that month (each video once, at its larger figure, across all her rows), plus the part posted in the month itself. Splits videos into with sales, zero and unsynced. Invoker rights. The same calculation as src/lib/admin/month-gmv.ts; a test keeps them equal.';

revoke all on function public.collab_month_gmv(text) from public, anon;
grant execute on function public.collab_month_gmv(text) to authenticated, service_role;

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

  insert into public.collab_gmv_freezes (month, row_count, total_gmv, source)
  values (p_month, 0, 0, p_source);

  insert into public.collab_gmv_snapshots
    (month, brand, creator_key, creator_name, videos, videos_with_sales, videos_zero, videos_unsynced, gmv,
     month_videos, month_gmv)
  select p_month, g.brand, g.creator_key, g.creator_name, g.videos, g.videos_with_sales,
         g.videos_zero, g.videos_unsynced, round(g.gmv, 2), g.month_videos, round(g.month_gmv, 2)
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

comment on table public.collab_gmv_snapshots is
  'A creator''s GMV for one brand as it stood at the end of one closed month, as it was when the month was frozen: gmv is everything her videos for the brand had made by then (all videos posted up to month end); month_gmv is the part from videos posted in that month. Immutable: no policy allows an update or a delete. Written only by collab_gmv_freeze.';

-- The snapshot keeps the in-month part too. The old months were frozen with the old
-- meaning, so, once (the first time the new columns appear), they are cleared and
-- frozen again. Nothing here runs a second time: it keys on the columns existing.
do $$
declare
  v_months text[];
  m text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'collab_gmv_snapshots' and column_name = 'month_gmv'
  ) then
    select coalesce(array_agg(f.month order by f.month), '{}') into v_months from public.collab_gmv_freezes f;
    delete from public.collab_gmv_snapshots;
    delete from public.collab_gmv_freezes;
    alter table public.collab_gmv_snapshots
      add column month_videos integer not null default 0 check (month_videos >= 0),
      add column month_gmv numeric(14,2) not null default 0 check (month_gmv >= 0);
    foreach m in array v_months loop
      perform public.collab_gmv_freeze(m, 'backfill');
    end loop;
  end if;
end;
$$;

-- ------------------------------------------------------- the freeze waits a day --
-- Rashid, 2026-11-06: a sale made on the last day of the month may not have been
-- synced by midnight, and TikTok attributes some sales late. So a month is frozen
-- 24 HOURS AFTER IT ENDS, not the moment it ends: October is frozen on the night
-- of 1-2 November (00:20 UTC on the 2nd), by which time the syncs have had a full
-- day to bring in the last day's sales. Sales attributed later than that still
-- miss the freeze; the figure on screen says when it was frozen.
--
-- The job still runs every night, so a missed night is repaired the next one.
-- `p_now` is only there so a test can say what time it is.
drop function if exists public.collab_gmv_freeze_previous_month();
drop function if exists public.collab_gmv_freeze_previous_month(timestamptz);

create function public.collab_gmv_freeze_previous_month(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- the month a day ago, then the one before it: on 1 Nov (any hour) a day ago is
  -- still October, so the month to freeze is September; from 00:00 UTC on 2 Nov it
  -- is October's turn.
  v_month text := to_char(
    date_trunc('month', (p_now - interval '1 day') at time zone 'UTC') - interval '1 month',
    'YYYY-MM'
  );
begin
  return public.collab_gmv_freeze(v_month, 'scheduled');
end;
$$;

revoke all on function public.collab_gmv_freeze_previous_month(timestamptz) from public, anon, authenticated;
grant execute on function public.collab_gmv_freeze_previous_month(timestamptz) to service_role;

-- The job's command is unchanged (`select public.collab_gmv_freeze_previous_month();`).
