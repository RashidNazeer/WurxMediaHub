-- ============================================================================
-- A CREATOR'S HEADLINE HIT RATE FOR SOMEBODY WORKING SEVERAL BRANDS: the AVERAGE of their
-- brands' hit rates.
--
-- Rashid, 2026-11-09, on the Creators table: "if a creator is not unique (working for two or more
-- brands) then we will calculate the hit rate for each brand and then take average. This will be
-- her hit rate."
--
-- So `collab_creator_hit_stats` now also returns, on every row of a creator:
--   brand_count          how many brands that creator has videos on (under the current filters)
--   avg_brand_hit_rate   the plain average of those brands' hit rates, each brand's rate being
--                        its hit videos / its videos. One brand: exactly that brand's rate.
--
-- THE POOLED RATE IS STILL THERE (`hit_rate`, hit videos / all videos together), because the two
-- answer different questions and can differ: Sarah's brands are 3.33%, 2.86% and 5.00%, so her
-- average is 3.73% while pooled over her 165 videos it is 4.24%. The screens lead with the
-- average, as asked, and show the pooled figure where it helps. `hit_rank` now orders by the
-- average rate (then hit videos, then videos) so the ranking agrees with the number on screen.
-- Everything else (criteria, brand filter, dates, hits-only) is unchanged.
--
-- A column was added, so the function has to be dropped and recreated: Postgres will not change
-- the shape of what a function returns in place.
-- ============================================================================

drop function if exists public.collab_creator_hit_stats(text, text, date, date, boolean, jsonb, boolean);

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
  hit_rank              integer,
  brand_count           integer,
  avg_brand_hit_rate    numeric
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
      max(g.hit_videos) filter (where g.is_overall) over (partition by g.creator_key)  as person_hits,
      -- each brand's own rate (unrounded), averaged: the creator's headline rate
      (count(*) filter (where not g.is_overall) over (partition by g.creator_key))::int as brand_count,
      avg(100.0 * g.hit_videos / g.total_videos) filter (where not g.is_overall)
        over (partition by g.creator_key)                                              as avg_exact
    from g
  ),
  s as (
    select r.*, round(r.avg_exact, 2) as avg_brand_hit_rate from r
  )
  select
    s.creator_key, s.creator_name, s.brand, s.is_overall, s.total_videos, s.hit_videos,
    s.hit_rate, s.videos_per_hit, s.gmv_unverified_videos, s.metrics_from, s.metrics_to,
    case when s.is_overall and p_creator is null
         then (rank() over (
                partition by s.is_overall
                order by s.avg_exact desc nulls last, s.hit_videos desc, s.total_videos desc))::int
    end,
    s.brand_count,
    s.avg_brand_hit_rate
  from s
  where (not p_overall_only or s.is_overall)
    and (not p_hits_only or s.person_hits > 0)
$$;

comment on function public.collab_creator_hit_stats(text, text, date, date, boolean, jsonb, boolean) is
  'Hit rate per creator and per creator+brand under p_criteria (null = defaults). hit_rate is pooled (hit videos / all videos); avg_brand_hit_rate is the average of the creator''s brand rates over brand_count brands, which is the headline figure; hit_rank orders by that average, then hits, then videos. videos_per_hit is null with no hits. Invoker rights.';

revoke all on function public.collab_creator_hit_stats(text, text, date, date, boolean, jsonb, boolean) from public, anon;
grant execute on function public.collab_creator_hit_stats(text, text, date, date, boolean, jsonb, boolean) to authenticated, service_role;
