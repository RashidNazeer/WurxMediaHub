-- ============================================================================
-- CREATOR HIT RATE: how often a creator's videos become hits, under criteria the
-- USER chooses.
--
-- A video is a HIT when it meets AT LEAST ONE ENABLED condition:
--   gmv30   GMV in the last 30 days   >= its threshold
--   gmv90   GMV in the last 90 days   >= its threshold
--   views   lifetime views            >= its threshold
-- Each condition has an on/off switch and a threshold, both chosen at runtime. At least
-- one must be on. The factory settings ($1,000 / $1,000 / 250,000, all on) live in ONE
-- place, `collab_hit_defaults()`; everything else takes criteria as a parameter.
-- An unknown figure (null) is "not verified": never a hit and never a zero.
--
-- WHERE THE NUMBERS COME FROM. The Paid Collabs rows (`wurxbase.creators.video_codes`)
-- carry each video's link, posted date and lifetime views, but NO 30-day or 90-day
-- GMV: their `revenue` is one lifetime total (Penetrex's top video shows $30,978 there
-- against $8,047 in the last 90 days). So the two GMV windows are read from Euka, one
-- video at a time, by `collab-video-hits-sync`, into `collab_video_metrics`.
--
-- NOTHING ABOUT A HIT IS STORED. Whether a video is a hit depends on the criteria in force,
-- so there is no is_hit column and no precomputed rate anywhere: every function below
-- evaluates the criteria it is handed, over the whole table, each time it is asked.
-- Changing criteria therefore changes every count, rate, ranking and list at once, and
-- never touches a video's metrics. `p_criteria` is jsonb:
--     {"gmv30": {"on": true, "min": 2000}, "gmv90": {"on": false}, "views": {"min": 500000}}
-- Anything left out takes its default; null means all defaults. Bad criteria (a negative
-- or non-numeric threshold, a non-boolean switch, every condition off) are refused with an
-- error rather than quietly corrected.
--
-- WHO IS A "CREATOR": the lower-cased, trimmed name, the same key the Unique Creators
-- pill counts people by, so a total here always equals the number on that pill.
-- WHAT IS A "VIDEO": a video_codes row whose link holds a TikTok id (/video/<digits>).
-- There are no draft, rejected or soft-deleted states on these rows, so a row with such
-- a link is a published video; rows without one are excluded (and counted by the
-- callers). The same id on several rows of one person (overlapping collab windows) is
-- ONE video, filed under the person's earliest collab for it.
--
-- ACCESS. Every read function is SECURITY INVOKER, so the existing row-level security
-- on wurxbase.creators (`is_collabs_viewer()`) decides who sees anything. An APC viewer
-- passes neither, and gets an empty answer.
-- ============================================================================

-- ------------------------------------------------------------ the criteria --
-- The factory settings. The only place a threshold is written down.
create or replace function public.collab_hit_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'gmv30', jsonb_build_object('on', true, 'min', 1000),
    'gmv90', jsonb_build_object('on', true, 'min', 1000),
    'views', jsonb_build_object('on', true, 'min', 250000)
  )
$$;

comment on function public.collab_hit_defaults() is
  'Factory hit criteria: GMV 30d >= 1000, GMV 90d >= 1000, views >= 250000, all enabled. The one place these numbers are written.';

-- Criteria merged over the defaults and VALIDATED. One row. Raises on anything bad.
create or replace function public.collab_hit_criteria(p_criteria jsonb default null)
returns table (
  gmv30_on  boolean, gmv30_min  numeric,
  gmv90_on  boolean, gmv90_min  numeric,
  views_on  boolean, views_min  numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  d       jsonb := public.collab_hit_defaults();
  c       jsonb := coalesce(p_criteria, '{}'::jsonb);
  k       text;
  node    jsonb;
  v_on    boolean[] := '{}';
  v_min   numeric[] := '{}';
  n_on    int := 0;
begin
  if jsonb_typeof(c) <> 'object' then
    raise exception 'hit criteria must be a JSON object' using errcode = '22023';
  end if;

  foreach k in array array['gmv30', 'gmv90', 'views'] loop
    node := c -> k;
    if node is not null and jsonb_typeof(node) <> 'object' then
      raise exception 'hit criteria "%" must be an object like {"on": true, "min": 1000}', k using errcode = '22023';
    end if;
    node := coalesce(node, '{}'::jsonb);

    if node ? 'on' then
      if jsonb_typeof(node -> 'on') <> 'boolean' then
        raise exception 'hit criteria "%".on must be true or false', k using errcode = '22023';
      end if;
      v_on := v_on || (node ->> 'on')::boolean;
    else
      v_on := v_on || ((d -> k ->> 'on')::boolean);
    end if;

    if node ? 'min' then
      if jsonb_typeof(node -> 'min') <> 'number' then
        raise exception 'hit criteria "%".min must be a number', k using errcode = '22023';
      end if;
      if (node ->> 'min')::numeric < 0 then
        raise exception 'hit criteria "%".min must not be negative', k using errcode = '22023';
      end if;
      v_min := v_min || (node ->> 'min')::numeric;
    else
      v_min := v_min || ((d -> k ->> 'min')::numeric);
    end if;
  end loop;

  select count(*) into n_on from unnest(v_on) as t(x) where x;
  if n_on = 0 then
    raise exception 'at least one hit condition must stay enabled' using errcode = '22023';
  end if;

  return query select v_on[1], v_min[1], v_on[2], v_min[2], v_on[3], v_min[3];
end;
$$;

comment on function public.collab_hit_criteria(jsonb) is
  'Hit criteria merged over collab_hit_defaults() and validated: thresholds non-negative numbers, switches booleans, at least one condition on. Raises otherwise.';

-- THE hit definition. Which enabled conditions a video meets, OR-ed; empty = not a hit. A
-- disabled condition is never evaluated. A null figure only makes its own condition "not
-- met". Takes the already-resolved criteria so a query validates them once, not per row.
create or replace function public.collab_hit_reasons_for(
  p_gmv_30d numeric, p_gmv_90d numeric, p_views numeric,
  p_gmv30_on boolean, p_gmv30_min numeric,
  p_gmv90_on boolean, p_gmv90_min numeric,
  p_views_on boolean, p_views_min numeric
)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_remove(array[
    case when p_gmv30_on and p_gmv_30d >= p_gmv30_min then 'gmv_30d' end,
    case when p_gmv90_on and p_gmv_90d >= p_gmv90_min then 'gmv_90d' end,
    case when p_views_on and p_views    >= p_views_min then 'views'   end
  ], null)
$$;

-- The same, for one video, from raw criteria json (null = the defaults).
create or replace function public.collab_video_hit_reasons(
  p_gmv_30d numeric,
  p_gmv_90d numeric,
  p_views   numeric,
  p_criteria jsonb default null
)
returns text[]
language sql
stable
set search_path = ''
as $$
  select public.collab_hit_reasons_for(
    p_gmv_30d, p_gmv_90d, p_views,
    c.gmv30_on, c.gmv30_min, c.gmv90_on, c.gmv90_min, c.views_on, c.views_min)
  from public.collab_hit_criteria(p_criteria) c
$$;

comment on function public.collab_video_hit_reasons(numeric, numeric, numeric, jsonb) is
  'Which enabled conditions a video meets (gmv_30d, gmv_90d, views), OR-ed. Empty = not a hit. Disabled conditions are ignored; null figures are unverified, never a hit.';

-- A posted date out of a free-text field, or null. Never raises, so one bad cell cannot
-- take a whole creator's answer down.
create or replace function public.collab_safe_date(p_text text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or p_text !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return left(p_text, 10)::date;
exception when others then
  return null;
end;
$$;

-- ----------------------------------------------------- per-video metrics store --
-- One row per TikTok video id the sync has asked Euka about. `known` is whether Euka
-- holds the video: an unknown one is recorded once (so it is not asked about every run)
-- and keeps every figure null = unverified. Both windows end on `window_end` (the day
-- the read was made) and are written in ONE upsert, so a video's 30 and 90 day figures
-- always share a date. `views` is LIFETIME views (a window's views are not what
-- "accumulated 250,000 views" means). No row, or known = false, is unverified; a known
-- row with 0 is an observed zero.
create table if not exists public.collab_video_metrics (
  item_id        text primary key check (item_id ~ '^\d+$'),
  known          boolean not null default true,
  gmv_30d        numeric(14, 2) check (gmv_30d is null or gmv_30d >= 0),
  gmv_90d        numeric(14, 2) check (gmv_90d is null or gmv_90d >= 0),
  views          bigint check (views is null or views >= 0),
  lifetime_gmv   numeric(14, 2),
  window_end     date not null,
  source_through date,
  source         text not null default 'euka',
  fetched_at     timestamptz not null default now(),
  check (known or (gmv_30d is null and gmv_90d is null and views is null and lifetime_gmv is null))
);

comment on table public.collab_video_metrics is
  'Per-video GMV for the last 30 and 90 days (ending window_end) and lifetime views, from Euka. Written only by collab-video-hits-sync. No row or known=false = Euka does not hold the video = unverified.';

create index if not exists collab_video_metrics_fetched_idx on public.collab_video_metrics (fetched_at);

alter table public.collab_video_metrics enable row level security;

drop policy if exists collab_video_metrics_select on public.collab_video_metrics;
create policy collab_video_metrics_select on public.collab_video_metrics
  for select to authenticated using (public.is_collabs_viewer());

revoke all on table public.collab_video_metrics from public, anon, authenticated;
grant select on table public.collab_video_metrics to authenticated;
grant all on table public.collab_video_metrics to service_role;

-- ------------------------------------------------------------------ the videos --
-- One row per (creator, TikTok video), with the metrics joined on and the verdict under
-- `p_criteria`. `p_hits_only` returns only the videos that are hits. `p_from`/`p_to`
-- filter by the day the video was POSTED, a different thing from the 30/90 day GMV
-- windows, which always end on the metric's own window_end; a row with no posted date is
-- left out whenever either bound is given. The order is fixed (newest first, then id), so
-- a caller paging through it with LIMIT/OFFSET sees every video exactly once.
create or replace function public.collab_creator_videos(
  p_creator   text default null,
  p_brand     text default null,
  p_from      date default null,
  p_to        date default null,
  p_criteria  jsonb default null,
  p_hits_only boolean default false
)
returns table (
  creator_key  text,
  creator_name text,
  brand        text,
  item_id      text,
  video_url    text,
  thumb        text,
  posted_on    date,
  views        bigint,
  views_source text,
  gmv_30d      numeric,
  gmv_90d      numeric,
  gmv_tracked  boolean,
  metrics_as_of date,
  reasons      text[],
  is_hit       boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with crit as (
    select * from public.collab_hit_criteria(p_criteria)
  ),
  raw as (
    select
      lower(btrim(c.name))                                         as creator_key,
      btrim(c.name)                                                as creator_name,
      btrim(coalesce(c.brand, ''))                                 as brand,
      coalesce(c.hiring_date, '')                                  as hired,
      c.id                                                         as row_id,
      (regexp_match(v.e ->> 'video', '/video/(\d+)'))[1]           as item_id,
      btrim(v.e ->> 'video')                                       as video_url,
      nullif(btrim(coalesce(v.e ->> 'thumb', '')), '')             as thumb,
      public.collab_safe_date(v.e ->> 'date')                      as posted_on,
      case when (v.e ->> 'views') ~ '^\d+(\.\d+)?$'
           then nullif((v.e ->> 'views')::numeric, 0)::bigint end  as stored_views
    from wurxbase.creators c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.video_codes) = 'array' then c.video_codes else '[]'::jsonb end
    ) as v(e)
    where btrim(coalesce(c.name, '')) <> ''
      and (p_creator is null or lower(btrim(c.name)) = lower(btrim(p_creator)))
      and (p_brand is null or btrim(coalesce(c.brand, '')) = btrim(p_brand))
  ),
  one as (
    -- the same TikTok id on several rows of one person is ONE video
    select distinct on (r.creator_key, r.item_id) r.*
    from raw r
    where r.item_id is not null
    order by r.creator_key, r.item_id, r.hired, r.brand, r.row_id
  ),
  joined as (
    select
      o.*,
      coalesce(m.known, false)                                    as tracked,
      m.gmv_30d, m.gmv_90d, m.window_end,
      coalesce(m.views, o.stored_views)                           as views_now,
      case when m.views is not null then 'euka'
           when o.stored_views is not null then 'stored' end      as views_src
    from one o
    left join public.collab_video_metrics m on m.item_id = o.item_id
    where (p_from is null or o.posted_on >= p_from)
      and (p_to   is null or o.posted_on <= p_to)
  ),
  scored as (
    select
      j.*,
      public.collab_hit_reasons_for(
        j.gmv_30d, j.gmv_90d, j.views_now,
        c.gmv30_on, c.gmv30_min, c.gmv90_on, c.gmv90_min, c.views_on, c.views_min) as rs
    from joined j
    cross join crit c
  )
  select
    s.creator_key, s.creator_name, s.brand, s.item_id, s.video_url, s.thumb, s.posted_on,
    s.views_now, s.views_src, s.gmv_30d, s.gmv_90d, s.tracked, s.window_end,
    s.rs, cardinality(s.rs) > 0
  from scored s
  where not p_hits_only or cardinality(s.rs) > 0
  order by s.posted_on desc nulls last, s.item_id
$$;

comment on function public.collab_creator_videos(text, text, date, date, jsonb, boolean) is
  'Each creator''s distinct TikTok videos with metrics and the hit verdict under p_criteria (null = defaults). Deduped per person by TikTok id, in a fixed order. Invoker rights: wurxbase.creators RLS applies.';

-- ------------------------------------------------------------------- the rates --
-- Totals per creator (brand is null) and per creator and brand, under `p_criteria`. Every
-- rate comes from SUMMED counts, never an average of the brands' percentages.
-- `videos_per_hit` is null with zero hits. `gmv_unverified_videos` counts videos Euka does
-- not hold, whose GMV conditions could not be checked (they can still qualify on views).
-- `hit_rank` (overall rows of an unscoped call only) orders creators by hit rate, then hit
-- videos, then videos, so a 1-in-10 creator does not outrank a 10-in-500 one on a tie of
-- rate alone. `p_hits_only` keeps only creators with at least one hit under the criteria.
-- Computed in SQL over every video, so no page or row limit the caller has can change it.
create or replace function public.collab_creator_hit_stats(
  p_creator      text default null,
  p_brand        text default null,
  p_from         date default null,
  p_to           date default null,
  p_overall_only boolean default false,
  p_criteria     jsonb default null,
  p_hits_only    boolean default false
)
returns table (
  creator_key           text,
  creator_name          text,
  brand                 text,
  is_overall            boolean,
  total_videos          integer,
  hit_videos            integer,
  hit_rate              numeric,
  videos_per_hit        numeric,
  gmv_unverified_videos integer,
  metrics_from          date,
  metrics_to            date,
  hit_rank              integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with v as (
    select * from public.collab_creator_videos(p_creator, p_brand, p_from, p_to, p_criteria, false)
  ),
  g as (
    select
      v.creator_key,
      max(v.creator_name)                                 as creator_name,
      case when grouping(v.brand) = 1 then null else v.brand end as brand,
      grouping(v.brand) = 1                               as is_overall,
      count(*)::int                                       as total_videos,
      count(*) filter (where v.is_hit)::int               as hit_videos,
      count(*) filter (where not v.gmv_tracked)::int      as gmv_unverified_videos,
      min(v.metrics_as_of)                                as metrics_from,
      max(v.metrics_as_of)                                as metrics_to
    from v
    group by grouping sets ((v.creator_key), (v.creator_key, v.brand))
  ),
  r as (
    select
      g.*,
      round(100.0 * g.hit_videos / g.total_videos, 2)                                  as hit_rate,
      case when g.hit_videos > 0 then round(g.total_videos::numeric / g.hit_videos, 2) end as videos_per_hit,
      max(g.hit_videos) filter (where g.is_overall) over (partition by g.creator_key)  as person_hits
    from g
  )
  select
    r.creator_key, r.creator_name, r.brand, r.is_overall, r.total_videos, r.hit_videos,
    r.hit_rate, r.videos_per_hit, r.gmv_unverified_videos, r.metrics_from, r.metrics_to,
    case when r.is_overall and p_creator is null
         then (rank() over (
                partition by r.is_overall
                order by r.hit_rate desc, r.hit_videos desc, r.total_videos desc))::int
    end
  from r
  where (not p_overall_only or r.is_overall)
    and (not p_hits_only or r.person_hits > 0)
$$;

comment on function public.collab_creator_hit_stats(text, text, date, date, boolean, jsonb, boolean) is
  'Hit rate per creator and per creator+brand under p_criteria (null = defaults). Rates come from summed counts; videos_per_hit is null with no hits; hit_rank orders creators by rate, hits, videos. Invoker rights.';

-- ------------------------------------------------------------------- the schedule --
-- Same shape as collab_gmv_run_cycle: posts {} to collab-video-hits-sync with the same
-- vault secret and URL base. The function URL is derived from the GMV sync's so there is
-- nothing new to configure. A run reads only what is missing or older than 20 hours, so
-- most runs do nothing and the windows are re-read about once a day.
create or replace function public.collab_video_hits_run_cycle()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'collab_gmv_sync_secret';
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'collab_gmv_sync_url';

  if v_secret is null or v_url is null then
    return null;
  end if;

  select net.http_post(
    url := replace(v_url, '/collab-gmv-sync', '/collab-video-hits-sync'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.collab_video_hits_run_cycle() from anon, authenticated, public;
grant execute on function public.collab_video_hits_run_cycle() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('collab-video-hits-cycle')
      where exists (select 1 from cron.job where jobname = 'collab-video-hits-cycle');
    perform cron.schedule('collab-video-hits-cycle', '*/20 * * * *', 'select public.collab_video_hits_run_cycle();');
  end if;
end $$;

-- ----------------------------------------------------------------------- grants --
revoke all on function public.collab_hit_defaults() from public, anon;
revoke all on function public.collab_hit_criteria(jsonb) from public, anon;
revoke all on function public.collab_hit_reasons_for(numeric, numeric, numeric, boolean, numeric, boolean, numeric, boolean, numeric) from public, anon;
revoke all on function public.collab_video_hit_reasons(numeric, numeric, numeric, jsonb) from public, anon;
revoke all on function public.collab_safe_date(text) from public, anon;
revoke all on function public.collab_creator_videos(text, text, date, date, jsonb, boolean) from public, anon;
revoke all on function public.collab_creator_hit_stats(text, text, date, date, boolean, jsonb, boolean) from public, anon;
grant execute on function public.collab_hit_defaults() to authenticated, service_role;
grant execute on function public.collab_hit_criteria(jsonb) to authenticated, service_role;
grant execute on function public.collab_hit_reasons_for(numeric, numeric, numeric, boolean, numeric, boolean, numeric, boolean, numeric) to authenticated, service_role;
grant execute on function public.collab_video_hit_reasons(numeric, numeric, numeric, jsonb) to authenticated, service_role;
grant execute on function public.collab_safe_date(text) to authenticated, service_role;
grant execute on function public.collab_creator_videos(text, text, date, date, jsonb, boolean) to authenticated, service_role;
grant execute on function public.collab_creator_hit_stats(text, text, date, date, boolean, jsonb, boolean) to authenticated, service_role;
