-- Proves the creator hit-rate maths: the hit rule, dedupe, brand vs overall, nulls, access.
-- Run against a LOCAL stack with migration 20261109120000 applied (everything rolls back):
--   docker exec -i supabase_db_WurxMediaHub psql -U postgres -P pager=off < scripts/verify/creator-hit-rate.sql
-- Expect `failures | 0`. Never run against production.
\set ON_ERROR_STOP on
begin;

create temp table results (n serial, test text, outcome text);
grant all on results to authenticated, anon; grant usage, select on sequence results_n_seq to authenticated, anon;

create or replace function pg_temp.chk(label text, got text, want text) returns void language plpgsql as $$
begin
  insert into results(test, outcome) values (label,
    case when got is not distinct from want then 'PASS' else 'FAIL (got '||coalesce(got,'NULL')||', want '||coalesce(want,'NULL')||')' end);
end $$;

-- one creator row with N distinct videos, ids base+1..base+N
create or replace function pg_temp.mk(p_name text, p_brand text, p_base bigint, p_n int, p_posted text default '2026-10-01')
returns void language sql as $$
  insert into wurxbase.creators (brand, name, hiring_date, status, video_codes)
  values (p_brand, p_name, '2026-10-01', 'approved',
    (select coalesce(jsonb_agg(jsonb_build_object(
        'video', 'https://www.tiktok.com/@x/video/' || (p_base + i), 'date', p_posted, 'views', 1000)), '[]'::jsonb)
     from generate_series(1, p_n) i));
$$;

-- Euka's answer for one video
create or replace function pg_temp.metric(p_id bigint, g30 numeric, g90 numeric, v bigint) returns void language sql as $$
  insert into public.collab_video_metrics (item_id, gmv_30d, gmv_90d, views, window_end)
  values (p_id::text, g30, g90, v, '2026-11-09')
  on conflict (item_id) do update set gmv_30d = excluded.gmv_30d, gmv_90d = excluded.gmv_90d, views = excluded.views;
$$;

create or replace function pg_temp.reasons(g30 numeric, g90 numeric, v numeric) returns text
language sql as $$ select coalesce(array_to_string(public.collab_video_hit_reasons(g30, g90, v), ','), '') $$;

-- ====================== 1. THE HIT RULE ITSELF (spec table, OR not AND) ======================
select pg_temp.chk('rule: 30d GMV only',           pg_temp.reasons(1200, 0, 1000),       'gmv_30d');
select pg_temp.chk('rule: 90d GMV only',           pg_temp.reasons(200, 1100, 30000),    'gmv_90d');
select pg_temp.chk('rule: views only',             pg_temp.reasons(100, 200, 260000),    'views');
select pg_temp.chk('rule: all three = ONE verdict, three reasons', pg_temp.reasons(5000, 9000, 900000), 'gmv_30d,gmv_90d,views');
select pg_temp.chk('rule: $1,200/$1,500/20K is a hit', (cardinality(public.collab_video_hit_reasons(1200,1500,20000)) > 0)::text, 'true');
select pg_temp.chk('rule: $900/$950/200K is NOT a hit', pg_temp.reasons(900, 950, 200000), '');
select pg_temp.chk('rule: $0/$0/50K is NOT a hit',     pg_temp.reasons(0, 0, 50000),         '');
select pg_temp.chk('rule: exactly $1,000 30d qualifies', pg_temp.reasons(1000, 0, 10000),    'gmv_30d');
select pg_temp.chk('rule: exactly $1,000 90d qualifies', pg_temp.reasons(0, 1000, 10),       'gmv_90d');
select pg_temp.chk('rule: exactly 250,000 views qualifies', pg_temp.reasons(0, 0, 250000),   'views');
select pg_temp.chk('rule: $999.99 does not',           pg_temp.reasons(999.99, 999.99, 0),   '');
select pg_temp.chk('rule: 249,999 views does not',     pg_temp.reasons(0, 0, 249999),        '');
select pg_temp.chk('rule: missing GMV never makes a hit', pg_temp.reasons(null, null, 100),  '');
select pg_temp.chk('rule: missing views never makes a hit', pg_temp.reasons(10, 20, null),   '');
select pg_temp.chk('rule: all missing is not a hit',   pg_temp.reasons(null, null, null),    '');
select pg_temp.chk('rule: missing GMV does not block views', pg_temp.reasons(null, null, 300000), 'views');
select pg_temp.chk('rule: a missing window does not block the other', pg_temp.reasons(null, 5000, 0), 'gmv_90d');

-- ====================== 2. FIXTURES ======================
-- Sarah: MDE 30 videos / 1 hit, Penetrex 35 / 1, Brand C 100 / 5  -> 165 videos, 7 hits
select pg_temp.mk('HR Sarah',  'HR MDE',      8100000000000000000, 30);
select pg_temp.mk('HR Sarah',  'HR Penetrex', 8200000000000000000, 35);
select pg_temp.mk('HR Sarah',  'HR BrandC',   8300000000000000000, 100);
select pg_temp.metric(8100000000000000001, 1200, 1500, 20000);   -- MDE hit (all of A and B)
select pg_temp.metric(8200000000000000001, 0, 0, 300000);        -- Penetrex hit (views)
select pg_temp.metric(8300000000000000001, 0, 1000, 0);          -- BrandC hits x5, different ways
select pg_temp.metric(8300000000000000002, 1000, 0, 0);
select pg_temp.metric(8300000000000000003, 5000, 5000, 5000);
select pg_temp.metric(8300000000000000004, 0, 0, 250000);
select pg_temp.metric(8300000000000000005, 1, 1, 1);
update public.collab_video_metrics set gmv_90d = 1100 where item_id = '8300000000000000005';
-- near misses that must NOT count
select pg_temp.metric(8100000000000000002, 999.99, 999.99, 249999);
select pg_temp.metric(8100000000000000003, 0, 0, 50000);

-- Cara: 30 + 35 across two brands, one hit each -> 65 videos, 2 hits (spec test C)
select pg_temp.mk('HR Cara', 'HR MDE',      8400000000000000000, 30);
select pg_temp.mk('HR Cara', 'HR Penetrex', 8500000000000000000, 35);
select pg_temp.metric(8400000000000000001, 1000, 0, 0);
select pg_temp.metric(8500000000000000001, 0, 0, 250000);

-- Nohit: 10 videos, none a hit
select pg_temp.mk('HR Nohit', 'HR MDE', 8600000000000000000, 10);
select pg_temp.metric(8600000000000000001, 10, 20, 30);

-- Dupe: the same TikTok ids on two rows of one brand, and again under another brand,
-- plus the same video written with a different handle in the URL
select pg_temp.mk('HR Dupe', 'HR MDE',      8700000000000000000, 4);
select pg_temp.mk('HR Dupe', 'HR MDE',      8700000000000000000, 4);       -- overlapping collab row
select pg_temp.mk('HR Dupe', 'HR Penetrex', 8700000000000000002, 3);       -- ids 3,4,5: 3 and 4 already seen
insert into wurxbase.creators (brand, name, hiring_date, status, video_codes) values
  ('HR MDE', 'hr dupe  ', '2026-10-02', 'approved',                        -- same person, other casing/spacing
   '[{"video":"https://www.tiktok.com/@someone.else/video/8700000000000000001","date":"2026-10-01","views":1000}]');
select pg_temp.metric(8700000000000000001, 2000, 2000, 2000);              -- a hit, on a duplicated video

-- Drafts / unpublished / junk links: no TikTok id, so not a published video
insert into wurxbase.creators (brand, name, hiring_date, status, video_codes) values
  ('HR MDE', 'HR Drafts', '2026-10-01', 'approved', '[
     {"video":""},
     {"video":"   "},
     {"video":"draft - waiting on creator"},
     {"video":"https://vm.tiktok.com/ZMabc123/"},
     {"video":"https://www.tiktok.com/@d/video/8800000000000000001","date":"2026-10-01","views":10}
   ]'),
  ('HR MDE', 'HR Empty', '2026-10-01', 'approved', '[]'),
  ('HR MDE', 'HR NoCodes', '2026-10-01', 'approved', null);

-- Dates: one undated, two dated apart
insert into wurxbase.creators (brand, name, hiring_date, status, video_codes) values
  ('HR MDE', 'HR Dated', '2026-10-01', 'approved', '[
     {"video":"https://www.tiktok.com/@d/video/8900000000000000001","date":"2026-08-10","views":300000},
     {"video":"https://www.tiktok.com/@d/video/8900000000000000002","date":"2026-10-20","views":300000},
     {"video":"https://www.tiktok.com/@d/video/8900000000000000003","views":300000}
   ]');

-- Views source: Euka's lifetime figure wins, the stored one is the fallback, stored 0 is unknown
insert into wurxbase.creators (brand, name, hiring_date, status, video_codes) values
  ('HR MDE', 'HR Views', '2026-10-01', 'approved', '[
     {"video":"https://www.tiktok.com/@d/video/8910000000000000001","views":100},
     {"video":"https://www.tiktok.com/@d/video/8910000000000000002","views":260000},
     {"video":"https://www.tiktok.com/@d/video/8910000000000000003","views":0}
   ]');
select pg_temp.metric(8910000000000000001, 0, 0, 400000);

-- ====================== 3. TOTALS AND BRAND/OVERALL ======================
create or replace function pg_temp.line(p_key text, p_brand text) returns text language sql as $$
  select total_videos || '/' || hit_videos || '/' || hit_rate || '/' || coalesce(videos_per_hit::text, 'null')
  from public.collab_creator_hit_stats(p_key)
  where creator_key = lower(p_key) and brand is not distinct from p_brand
$$;

select pg_temp.chk('test A: 30 videos 1 hit -> 3.33% and 30 per hit', pg_temp.line('HR Sarah', 'HR MDE'),      '30/1/3.33/30.00');
select pg_temp.chk('test B: 35 videos 1 hit -> 2.86% and 35 per hit', pg_temp.line('HR Sarah', 'HR Penetrex'), '35/1/2.86/35.00');
select pg_temp.chk('test D: 100 videos 5 hits -> 5% and 20 per hit',  pg_temp.line('HR Sarah', 'HR BrandC'),   '100/5/5.00/20.00');
select pg_temp.chk('test C: 65 videos across two brands, 2 hits -> 3.08% and 32.5', pg_temp.line('HR Cara', null), '65/2/3.08/32.50');
select pg_temp.chk('overall = summed counts (165 videos, 7 hits, 4.24%, 23.57 per hit)', pg_temp.line('HR Sarah', null), '165/7/4.24/23.57');
select pg_temp.chk('overall is NOT the average of the brand rates (that would be 3.73)',
  (select (hit_rate <> round((3.33 + 2.86 + 5.00) / 3, 2))::text from public.collab_creator_hit_stats('HR Sarah') where brand is null), 'true');
select pg_temp.chk('brand rows add up to the overall row',
  (select (sum(total_videos) = 165 and sum(hit_videos) = 7)::text from public.collab_creator_hit_stats('HR Sarah') where brand is not null), 'true');
select pg_temp.chk('Cara brand rows are 30/1 and 35/1',
  pg_temp.line('HR Cara', 'HR MDE') || ' ' || pg_temp.line('HR Cara', 'HR Penetrex'), '30/1/3.33/30.00 35/1/2.86/35.00');
select pg_temp.chk('near misses were not counted as hits (Sarah MDE has exactly 1 hit)',
  (select hit_videos::text from public.collab_creator_hit_stats('HR Sarah') where brand = 'HR MDE'), '1');

-- zero hits: no division by zero, "videos per hit" is null
select pg_temp.chk('zero hits: 10 videos, 0 hits, 0%, videos-per-hit null', pg_temp.line('HR Nohit', null), '10/0/0.00/null');
-- zero videos: the creator simply has no row, and nothing raised
select pg_temp.chk('zero videos: empty list gives no stats row',  (select count(*)::text from public.collab_creator_hit_stats('HR Empty')), '0');
select pg_temp.chk('zero videos: null video_codes gives no stats row', (select count(*)::text from public.collab_creator_hit_stats('HR NoCodes')), '0');
select pg_temp.chk('zero videos: unknown creator gives no stats row', (select count(*)::text from public.collab_creator_hit_stats('nobody at all')), '0');

-- ====================== 4. DUPLICATES, DRAFTS ======================
-- ids 1..4 (twice on one brand, once again under a 2nd casing) + 5 from the Penetrex row (3,4,5)
select pg_temp.chk('dupes: the same TikTok id is one video however many rows carry it (5 distinct)',
  (select total_videos::text from public.collab_creator_hit_stats('HR Dupe') where brand is null), '5');
select pg_temp.chk('dupes: a duplicated hit counts once', (select hit_videos::text from public.collab_creator_hit_stats('HR Dupe') where brand is null), '1');
select pg_temp.chk('dupes: brand rows never double count (they sum to the overall)',
  (select (sum(total_videos) = 5)::text from public.collab_creator_hit_stats('HR Dupe') where brand is not null), 'true');
select pg_temp.chk('dupes: a name written with other case/spacing is the same person',
  (select count(distinct creator_key)::text from public.collab_creator_videos() where creator_key = 'hr dupe'), '1');
select pg_temp.chk('dupes: a video seen under two brands is filed under the earliest collab only',
  (select count(*)::text from public.collab_creator_videos('HR Dupe') where item_id = '8700000000000000003'), '1');
select pg_temp.chk('drafts: blank, whitespace, text and short-link rows are not videos; one real video remains',
  (select total_videos::text from public.collab_creator_hit_stats('HR Drafts') where brand is null), '1');

-- ====================== 5. MISSING DATA ======================
select pg_temp.chk('unverified: videos Euka does not hold are counted, not hidden',
  (select gmv_unverified_videos::text from public.collab_creator_hit_stats('HR Nohit') where brand is null), '9');
insert into public.collab_video_metrics (item_id, known, window_end) values ('8600000000000000002', false, '2026-11-09');
select pg_temp.chk('an unknown-to-Euka row is unverified, with every figure null',
  (select (not gmv_tracked and gmv_30d is null and gmv_90d is null)::text from public.collab_creator_videos('HR Nohit') where item_id = '8600000000000000002'), 'true');
do $$ begin
  begin
    insert into public.collab_video_metrics (item_id, known, gmv_30d, window_end) values ('8600000000000000003', false, 5000, '2026-11-09');
    insert into results(test, outcome) values ('known=false carrying a GMV figure is refused', 'FAIL (allowed)');
  exception when check_violation then
    insert into results(test, outcome) values ('known=false carrying a GMV figure is refused', 'PASS');
  end;
end $$;
select pg_temp.chk('missing metrics row + 1,000 stored views is not a hit',
  (select (not is_hit)::text from public.collab_creator_videos('HR Nohit') where item_id = '8600000000000000002'), 'true');
select pg_temp.chk('no metrics row and only 10 stored views: not a hit',
  (select (not is_hit and views = 10 and views_source = 'stored')::text from public.collab_creator_videos('HR Drafts')), 'true');
select pg_temp.chk('untracked video is flagged gmv_tracked = false', (select (not gmv_tracked)::text from public.collab_creator_videos('HR Drafts')), 'true');
select pg_temp.chk('views: Euka lifetime views win over the stored figure',
  (select views || '/' || views_source from public.collab_creator_videos('HR Views') where item_id = '8910000000000000001'), '400000/euka');
select pg_temp.chk('views: the stored figure is the fallback and can qualify (260,000)',
  (select views || '/' || views_source || '/' || is_hit from public.collab_creator_videos('HR Views') where item_id = '8910000000000000002'), '260000/stored/true');
select pg_temp.chk('views: a stored 0 is unknown, not zero',
  (select coalesce(views::text, 'null') || '/' || coalesce(views_source, 'null') from public.collab_creator_videos('HR Views') where item_id = '8910000000000000003'), 'null/null');

-- ====================== 6. A METRIC REFRESH CHANGES THE VERDICT ======================
select pg_temp.chk('refresh: 90d GMV $950 is below the line', (select is_hit::text from public.collab_creator_videos('HR Nohit') where item_id = '8600000000000000001'), 'false');
select pg_temp.metric(8600000000000000001, 10, 1000, 30);
select pg_temp.chk('refresh: the same video at $1,000 is now a hit, with no recount step',
  (select reasons::text from public.collab_creator_videos('HR Nohit') where item_id = '8600000000000000001'), '{gmv_90d}');
select pg_temp.chk('refresh: and the creator''s totals followed', pg_temp.line('HR Nohit', null), '10/1/10.00/10.00');
select pg_temp.metric(8600000000000000001, 10, 950, 30);
select pg_temp.chk('refresh: falling back below the line un-hits it', pg_temp.line('HR Nohit', null), '10/0/0.00/null');

-- ====================== 7. DATE FILTER = POSTED DATE ======================
select pg_temp.chk('dates: no bounds = all three videos',
  (select count(*)::text from public.collab_creator_videos('HR Dated')), '3');
select pg_temp.chk('dates: a posted-date range keeps only videos posted inside it',
  (select count(*)::text from public.collab_creator_videos('HR Dated', null, '2026-10-01', '2026-10-31')), '1');
select pg_temp.chk('dates: a video with no posted date is left out once a bound is given',
  (select count(*)::text from public.collab_creator_videos('HR Dated', null, '2026-01-01', '2026-12-31')), '2');
select pg_temp.chk('dates: the filter moves the hit count too',
  (select hit_videos || '/' || total_videos from public.collab_creator_hit_stats('HR Dated', null, '2026-08-01', '2026-08-31') where brand is null), '1/1');
select pg_temp.chk('brand filter limits videos', (select total_videos::text from public.collab_creator_hit_stats('HR Sarah', 'HR MDE') where brand is null), '30');
select pg_temp.chk('overall-only returns no brand rows', (select count(*)::text from public.collab_creator_hit_stats('HR Sarah', null, null, null, true) where brand is not null), '0');
select pg_temp.chk('creator lookup ignores case and spacing', (select count(*)::text from public.collab_creator_hit_stats('  hr SARAH ', null, null, null, true)), '1');

-- ====================== 7b. USER-CHOSEN CRITERIA ======================
-- criteria shorthands
create or replace function pg_temp.crit(g30 numeric, g90 numeric, v numeric) returns jsonb language sql as $$
  select jsonb_build_object('gmv30', jsonb_build_object('min', g30), 'gmv90', jsonb_build_object('min', g90), 'views', jsonb_build_object('min', v)) $$;
create or replace function pg_temp.cline(p_key text, p_brand text, p_crit jsonb) returns text language sql as $$
  select total_videos || '/' || hit_videos || '/' || hit_rate || '/' || coalesce(videos_per_hit::text, 'null')
  from public.collab_creator_hit_stats(p_key, null, null, null, false, p_crit)
  where creator_key = lower(p_key) and brand is not distinct from p_brand
$$;
create or replace function pg_temp.reasons_c(g30 numeric, g90 numeric, v numeric, c jsonb) returns text
language sql as $$ select coalesce(array_to_string(public.collab_video_hit_reasons(g30, g90, v, c), ','), '') $$;

-- defaults: nothing passed, null, '{}' and the explicit factory numbers all agree
select pg_temp.chk('criteria: factory defaults are 1000 / 1000 / 250000, all on',
  public.collab_hit_defaults()::text, '{"gmv30": {"on": true, "min": 1000}, "gmv90": {"on": true, "min": 1000}, "views": {"on": true, "min": 250000}}');
select pg_temp.chk('criteria: null, {} and the explicit defaults give the SAME answer as passing nothing',
  (select (pg_temp.cline('HR Sarah', null, null) = pg_temp.cline('HR Sarah', null, '{}'::jsonb)
       and pg_temp.cline('HR Sarah', null, null) = pg_temp.cline('HR Sarah', null, public.collab_hit_defaults())
       and pg_temp.cline('HR Sarah', null, null) = '165/7/4.24/23.57')::text), 'true');

-- raising one threshold at a time changes classification
select pg_temp.chk('threshold: raising the 30d GMV line to $2,000 un-hits a $1,200 video',
  pg_temp.reasons_c(1200, 0, 0, '{"gmv30":{"min":2000}}'), '');
select pg_temp.chk('threshold: ...while $2,000 exactly still qualifies',
  pg_temp.reasons_c(2000, 0, 0, '{"gmv30":{"min":2000}}'), 'gmv_30d');
select pg_temp.chk('threshold: raising the 90d GMV line to $3,000 un-hits $2,500',
  pg_temp.reasons_c(0, 2500, 0, '{"gmv90":{"min":3000}}'), '');
select pg_temp.chk('threshold: raising the views line to 500,000 un-hits 300,000 views',
  pg_temp.reasons_c(0, 0, 300000, '{"views":{"min":500000}}'), '');
select pg_temp.chk('threshold: lowering a line makes new hits (views >= 100,000)',
  pg_temp.reasons_c(0, 0, 150000, '{"views":{"min":100000}}'), 'views');
select pg_temp.chk('threshold: a zero threshold is allowed, and then any known figure qualifies',
  pg_temp.reasons_c(0, null, null, '{"gmv30":{"min":0},"gmv90":{"on":false},"views":{"on":false}}'), 'gmv_30d');
select pg_temp.chk('threshold: a missing figure still never qualifies, even at a zero line',
  pg_temp.reasons_c(null, null, null, '{"gmv30":{"min":0},"gmv90":{"min":0},"views":{"min":0}}'), '');

-- disabling conditions
select pg_temp.chk('disable GMV: views is the only criterion (a $5,000 / $9,000 video is no hit)',
  pg_temp.reasons_c(5000, 9000, 1000, '{"gmv30":{"on":false},"gmv90":{"on":false}}'), '');
select pg_temp.chk('disable GMV: ...and 300,000 views still is',
  pg_temp.reasons_c(5000, 9000, 300000, '{"gmv30":{"on":false},"gmv90":{"on":false}}'), 'views');
select pg_temp.chk('disable views: GMV is the only criterion (900,000 views is no hit)',
  pg_temp.reasons_c(0, 0, 900000, '{"views":{"on":false}}'), '');
select pg_temp.chk('disable views: ...and $1,000 still is',
  pg_temp.reasons_c(1000, 0, 900000, '{"views":{"on":false}}'), 'gmv_30d');
select pg_temp.chk('disable one GMV window: only the other window counts',
  pg_temp.reasons_c(5000, 10, 0, '{"gmv30":{"on":false}}') || '|' || pg_temp.reasons_c(10, 5000, 0, '{"gmv30":{"on":false}}'), '|gmv_90d');
select pg_temp.chk('multiple enabled matches stay in the reasons list (three) ...',
  pg_temp.reasons_c(5000, 9000, 900000, pg_temp.crit(2000, 3000, 500000)), 'gmv_30d,gmv_90d,views');

-- the spec's worked example: 100 videos, 5 hits at default, 2 at $2,000 / 500,000
select pg_temp.mk('HR Strict', 'HR X', 7100000000000000000, 50);
select pg_temp.mk('HR Strict', 'HR Y', 7200000000000000000, 50);
select pg_temp.metric(7100000000000000001, 1500, 0, 1000);     -- default yes (30d), strict no
select pg_temp.metric(7100000000000000002, 0, 1000, 1000);     -- default yes (90d), strict no
select pg_temp.metric(7100000000000000003, 2500, 0, 1000);     -- yes / yes
select pg_temp.metric(7200000000000000001, 0, 0, 300000);      -- default yes (views), strict no
select pg_temp.metric(7200000000000000002, 0, 0, 600000);      -- yes / yes
select pg_temp.chk('example: default criteria give 100 videos, 5 hits, 5%, 20 per hit',
  pg_temp.cline('HR Strict', null, null), '100/5/5.00/20.00');
select pg_temp.chk('example: $2,000 GMV and 500,000 views re-evaluate ALL 100 videos -> 2 hits, 2%, 50 per hit',
  pg_temp.cline('HR Strict', null, pg_temp.crit(2000, 2000, 500000)), '100/2/2.00/50.00');
select pg_temp.chk('brand level, default: HR X is 3 of 50 and HR Y is 2 of 50',
  pg_temp.cline('HR Strict', 'HR X', null) || ' ' || pg_temp.cline('HR Strict', 'HR Y', null), '50/3/6.00/16.67 50/2/4.00/25.00');
select pg_temp.chk('brand level, strict: both fall to 1 of 50',
  pg_temp.cline('HR Strict', 'HR X', pg_temp.crit(2000, 2000, 500000)) || ' ' || pg_temp.cline('HR Strict', 'HR Y', pg_temp.crit(2000, 2000, 500000)),
  '50/1/2.00/50.00 50/1/2.00/50.00');
select pg_temp.chk('brand rows still add up to the overall under custom criteria',
  (select (sum(hit_videos) filter (where brand is not null) = sum(hit_videos) filter (where brand is null)
       and sum(total_videos) filter (where brand is not null) = sum(total_videos) filter (where brand is null))::text
   from public.collab_creator_hit_stats('HR Strict', null, null, null, false, pg_temp.crit(2000, 2000, 500000))), 'true');
select pg_temp.chk('video list agrees with the counts: the hits-only list has exactly the 2 strict hits',
  (select count(*)::text from public.collab_creator_videos('HR Strict', null, null, null, pg_temp.crit(2000, 2000, 500000), true)), '2');
select pg_temp.chk('video list, default: 5 hits, and every row says why',
  (select count(*) || '/' || bool_and(cardinality(reasons) > 0)::text from public.collab_creator_videos('HR Strict', null, null, null, null, true)), '5/true');
select pg_temp.chk('a video that meets several enabled conditions is ONE row in the hit list',
  (select count(*) || '/' || max(cardinality(reasons)) from public.collab_creator_videos('HR Sarah', 'HR MDE', null, null, null, true) where item_id = '8100000000000000001'), '1/2');

-- the brand filter and the criteria together (HR Strict: HR X has hits 1,2,3 of 50, HR Y has 1,2 of 50)
create or replace function pg_temp.bline(p_key text, p_brand text, p_crit jsonb) returns text language sql as $$
  select total_videos || '/' || hit_videos || '/' || hit_rate || '/' || coalesce(videos_per_hit::text, 'null')
  from public.collab_creator_hit_stats(p_key, p_brand, null, null, true, p_crit) where creator_key = lower(p_key) $$;
select pg_temp.chk('brand filter, default criteria: only HR X counts (50 videos, 3 hits)', pg_temp.bline('HR Strict', 'HR X', null), '50/3/6.00/16.67');
select pg_temp.chk('brand filter, default criteria: only HR Y counts (50 videos, 2 hits)', pg_temp.bline('HR Strict', 'HR Y', null), '50/2/4.00/25.00');
select pg_temp.chk('brand filter + strict criteria: HR X falls to 1 of 50', pg_temp.bline('HR Strict', 'HR X', pg_temp.crit(2000, 2000, 500000)), '50/1/2.00/50.00');
select pg_temp.chk('brand filter + views-only at 500k: HR Y is 1 of 50',
  pg_temp.bline('HR Strict', 'HR Y', '{"gmv30":{"on":false},"gmv90":{"on":false},"views":{"min":500000}}'), '50/1/2.00/50.00');
select pg_temp.chk('brand filter drops creators with no videos on that brand from the whole list',
  (select (bool_or(creator_key = 'hr strict') and not bool_or(creator_key = 'hr sarah'))::text from public.collab_creator_hit_stats(null, 'HR X', null, null, true)), 'true');
select pg_temp.chk('brand filter: a brand nobody has returns an empty list, not an error',
  (select count(*)::text from public.collab_creator_hit_stats(null, 'No Such Brand', null, null, true)), '0');
select pg_temp.chk('brand filter is matched exactly, not by prefix',
  (select count(*)::text from public.collab_creator_hit_stats('HR Strict', 'HR', null, null, true)), '0');
select pg_temp.chk('brand filter: ranking is among the creators who have that brand (starts at 1)',
  (select min(hit_rank)::text from public.collab_creator_hit_stats(null, 'HR X', null, null, true)), '1');
select pg_temp.chk('the filtered stats agree with the filtered hit list (HR Strict on HR X has 3 hit videos)',
  (select count(*)::text from public.collab_creator_videos('HR Strict', 'HR X', null, null, null, true)), '3');

-- a creator's headline rate is the AVERAGE of her brands' rates (Rashid, 2026-11-09)
create or replace function pg_temp.avgline(p_key text, p_brand text, p_crit jsonb) returns text language sql as $$
  select avg_brand_hit_rate || '/' || brand_count || '/' || hit_rate
  from public.collab_creator_hit_stats(p_key, p_brand, null, null, true, p_crit) where creator_key = lower(p_key) $$;
select pg_temp.chk('average: Sarah (3.33%, 2.86%, 5.00%) averages 3.73% over 3 brands; pooled is still 4.24%', pg_temp.avgline('HR Sarah', null, null), '3.73/3/4.24');
select pg_temp.chk('average: Cara (3.33%, 2.86%) averages 3.10% over 2 brands; pooled is 3.08%', pg_temp.avgline('HR Cara', null, null), '3.10/2/3.08');
select pg_temp.chk('average: one brand is exactly that brand''s rate (0% with no hits)', pg_temp.avgline('HR Nohit', null, null), '0.00/1/0.00');
select pg_temp.chk('average: HR Strict (6.00% and 4.00%) averages 5.00%', pg_temp.avgline('HR Strict', null, null), '5.00/2/5.00');
select pg_temp.chk('average follows the criteria: strict gives both brands 2.00%, so 2.00%', pg_temp.avgline('HR Strict', null, pg_temp.crit(2000, 2000, 500000)), '2.00/2/2.00');
select pg_temp.chk('average follows the brand filter: Sarah on HR MDE alone is that brand''s 3.33% over 1 brand',
  (select avg_brand_hit_rate || '/' || brand_count from public.collab_creator_hit_stats('HR Sarah', 'HR MDE', null, null, true) where creator_key = 'hr sarah'), '3.33/1');
select pg_temp.chk('the per-brand rows are unchanged by it (they are the inputs)',
  pg_temp.line('HR Sarah', 'HR Penetrex'), '35/1/2.86/35.00');

-- a brand with no hits still counts in the average: 10 videos 1 hit (10%) and 40 videos 0 hits (0%)
select pg_temp.mk('HR Mixed', 'HR M1', 7700000000000000000, 10);
select pg_temp.mk('HR Mixed', 'HR M2', 7710000000000000000, 40);
select pg_temp.metric(7700000000000000001, 1500, 0, 100);
select pg_temp.chk('average: a zero-hit brand pulls the average down (10% and 0% -> 5.00%) while pooled is 2.00%', pg_temp.avgline('HR Mixed', null, null), '5.00/2/2.00');
-- ...and the ranking follows the average, not the pooled rate: Mixed (avg 5.00, pooled 2.00) vs AvgY (one brand, 4.00)
select pg_temp.mk('HR AvgY', 'HR M1', 7720000000000000000, 50);
select pg_temp.metric(7720000000000000001, 1500, 0, 100);
select pg_temp.metric(7720000000000000002, 1500, 0, 100);
select pg_temp.chk('ranking uses the average: Mixed (5.00% avg, 2.00% pooled) ranks above AvgY (4.00% both)',
  (select (m.hit_rank < y.hit_rank)::text
   from public.collab_creator_hit_stats(null, null, null, null, true) m, public.collab_creator_hit_stats(null, null, null, null, true) y
   where m.creator_key = 'hr mixed' and y.creator_key = 'hr avgy'), 'true');

-- rankings follow the criteria: P has two high-view videos, Q has one big-GMV video
select pg_temp.mk('HR RankP', 'HR R', 7300000000000000000, 10);
select pg_temp.mk('HR RankQ', 'HR R', 7400000000000000000, 10);
select pg_temp.metric(7300000000000000001, 0, 0, 300000);
select pg_temp.metric(7300000000000000002, 0, 0, 300000);
select pg_temp.metric(7400000000000000001, 5000, 0, 100);
create or replace function pg_temp.rk(p_key text, p_crit jsonb) returns int language sql as $$
  select hit_rank from public.collab_creator_hit_stats(null, null, null, null, true, p_crit) where creator_key = lower(p_key) $$;
select pg_temp.chk('ranking, default: P (2 of 10, 20%) ranks above Q (1 of 10, 10%)',
  (pg_temp.rk('HR RankP', null) < pg_temp.rk('HR RankQ', null))::text, 'true');
select pg_temp.chk('ranking, views switched off: the order flips (Q above P) with no recount step',
  (pg_temp.rk('HR RankQ', '{"views":{"on":false}}') < pg_temp.rk('HR RankP', '{"views":{"on":false}}'))::text, 'true');
select pg_temp.chk('ranking: the list is a real ranking (ranks start at 1, no gaps in order)',
  (select (min(hit_rank) = 1 and bool_and(hit_rank is not null))::text from public.collab_creator_hit_stats(null, null, null, null, true, null)), 'true');
select pg_temp.chk('ranking: a scoped (single creator) call carries no rank',
  (select (hit_rank is null)::text from public.collab_creator_hit_stats('HR RankP', null, null, null, true, null)), 'true');

-- zero-hit creators under strict criteria
select pg_temp.mk('HR OneHit', 'HR Z', 7500000000000000000, 20);
select pg_temp.metric(7500000000000000001, 1200, 0, 100);
select pg_temp.chk('zero hits under strict criteria: kept in the directory with 0.00% and no videos-per-hit',
  pg_temp.cline('HR OneHit', null, '{"gmv30":{"min":2000}}'), '20/0/0.00/null');
select pg_temp.chk('...and listed in the directory view',
  (select count(*)::text from public.collab_creator_hit_stats('HR OneHit', null, null, null, true, '{"gmv30":{"min":2000}}')), '1');
select pg_temp.chk('...but left out of a hit-performers list',
  (select count(*)::text from public.collab_creator_hit_stats('HR OneHit', null, null, null, true, '{"gmv30":{"min":2000}}', true)), '0');
select pg_temp.chk('the same creator is in the hit-performers list under the default criteria',
  (select count(*)::text from public.collab_creator_hit_stats('HR OneHit', null, null, null, true, null, true)), '1');
select pg_temp.chk('a hit-performers list keeps that creator''s brand rows too',
  (select count(*)::text from public.collab_creator_hit_stats('HR Strict', null, null, null, false, null, true)), '3');

-- pagination cannot change an aggregate: 1,200 videos, 30 hits, well past PostgREST's 1,000-row page
select pg_temp.mk('HR Big', 'HR B', 7600000000000000000, 1200);
insert into public.collab_video_metrics (item_id, gmv_30d, gmv_90d, views, window_end)
  select (7600000000000000000 + i)::text, 1000, 1000, 10, '2026-11-09' from generate_series(1, 30) i;
select pg_temp.chk('pagination: totals come from the whole set (1,200 videos, 30 hits, 2.50%, 40 per hit)',
  pg_temp.cline('HR Big', null, null), '1200/30/2.50/40.00');
select pg_temp.chk('pagination: paging the list in 500s returns every video exactly once',
  (select count(*) || '/' || count(distinct item_id) from (
     select item_id from (select * from public.collab_creator_videos('HR Big') order by item_id limit 500 offset 0) a
     union all select item_id from (select * from public.collab_creator_videos('HR Big') order by item_id limit 500 offset 500) b
     union all select item_id from (select * from public.collab_creator_videos('HR Big') order by item_id limit 500 offset 1000) c) p), '1200/1200');
select pg_temp.chk('pagination: the hits across all pages equal the aggregate',
  (select count(*)::text from public.collab_creator_videos('HR Big', null, null, null, null, true)), '30');
select pg_temp.chk('pagination: a strict criteria recount over the same 1,200 is just as complete',
  pg_temp.cline('HR Big', null, '{"gmv30":{"min":5000},"gmv90":{"min":5000}}'), '1200/0/0.00/null');

-- bad criteria are refused, never quietly fixed
create or replace function pg_temp.refused(label text, c jsonb) returns void language plpgsql as $$
begin
  begin
    perform * from public.collab_hit_criteria(c);
    insert into results(test, outcome) values (label, 'FAIL (accepted)');
  exception when sqlstate '22023' then
    insert into results(test, outcome) values (label, 'PASS');
  end;
end $$;
select pg_temp.refused('validation: every condition off is refused', '{"gmv30":{"on":false},"gmv90":{"on":false},"views":{"on":false}}');
select pg_temp.refused('validation: a negative threshold is refused', '{"gmv30":{"min":-1}}');
select pg_temp.refused('validation: a text threshold is refused', '{"views":{"min":"lots"}}');
select pg_temp.refused('validation: a non-boolean switch is refused', '{"gmv90":{"on":"yes"}}');
select pg_temp.refused('validation: a condition that is not an object is refused', '{"gmv30": 5}');
select pg_temp.refused('validation: criteria that are not an object are refused', '[1,2]'::jsonb);
select pg_temp.refused('validation: reaches the video list too (negative threshold)', '{"views":{"min":-5}}');
do $$ begin
  begin
    perform * from public.collab_creator_hit_stats('HR Strict', null, null, null, false, '{"views":{"on":false},"gmv30":{"on":false},"gmv90":{"on":false}}');
    insert into results(test, outcome) values ('validation: hit_stats with all conditions off raises', 'FAIL (ran)');
  exception when sqlstate '22023' then
    insert into results(test, outcome) values ('validation: hit_stats with all conditions off raises', 'PASS');
  end;
  begin
    perform * from public.collab_creator_videos('HR Strict', null, null, null, '{"gmv30":{"min":-10}}');
    insert into results(test, outcome) values ('validation: the video list with a negative threshold raises', 'FAIL (ran)');
  exception when sqlstate '22023' then
    insert into results(test, outcome) values ('validation: the video list with a negative threshold raises', 'PASS');
  end;
end $$;
select pg_temp.chk('validation: one condition on is enough',
  (select (gmv30_on and not gmv90_on and not views_on)::text from public.collab_hit_criteria('{"gmv90":{"on":false},"views":{"on":false}}')), 'true');

-- recalculating never touches what is stored
create temp table before_sum as
  select (select md5(string_agg(m::text, '|' order by item_id)) from public.collab_video_metrics m) as metrics,
         (select md5(string_agg(c.video_codes::text || c.brand || c.name, '|' order by c.id)) from wurxbase.creators c) as creators,
         (select count(*) from public.collab_video_metrics) as metric_rows;
select count(*) from (
  select * from public.collab_creator_hit_stats(null, null, null, null, false, pg_temp.crit(5000, 5000, 900000))
  union all select * from public.collab_creator_hit_stats(null, null, null, null, true, '{"views":{"on":false}}')
  union all select * from public.collab_creator_hit_stats(null, null, null, null, false, '{"gmv30":{"on":false},"gmv90":{"on":false}}', true)) q;
select pg_temp.chk('stored metrics are byte-for-byte unchanged after many different criteria',
  (select (b.metrics = (select md5(string_agg(m::text, '|' order by item_id)) from public.collab_video_metrics m)
       and b.metric_rows = (select count(*) from public.collab_video_metrics))::text from before_sum b), 'true');
select pg_temp.chk('creator rows are unchanged too',
  (select (b.creators = (select md5(string_agg(c.video_codes::text || c.brand || c.name, '|' order by c.id)) from wurxbase.creators c))::text from before_sum b), 'true');
select pg_temp.chk('the table has no is_hit or hit-rate column to go stale',
  (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'collab_video_metrics' and column_name ~ 'hit|rate'), '0');

-- ====================== 8. WHO MAY READ ======================
set session_replication_role = replica;  -- seed only: bypass the profile guard trigger
insert into auth.users (id, email, instance_id, aud, role) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'hr-staff@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-1111-0000-0000-000000000002', 'hr-apc@test.local',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-1111-0000-0000-000000000003', 'hr-plain@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.profiles (id, email, role) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'hr-staff@test.local', 'admin'),
  ('aaaaaaaa-1111-0000-0000-000000000002', 'hr-apc@test.local',   'apc_viewer'),
  ('aaaaaaaa-1111-0000-0000-000000000003', 'hr-plain@test.local', 'applicant')
on conflict (id) do update set role = excluded.role;
set session_replication_role = origin;

-- the app's access-token hook puts the profile role in the user_role claim, which is what is_staff() reads
create or replace function pg_temp.as_user(uid text, urole text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'user_role', urole)::text, true);
  perform set_config('request.jwt.claim.sub', uid, true);
end $$;

reset role; set local role authenticated;
select pg_temp.as_user('aaaaaaaa-1111-0000-0000-000000000001', 'admin');
select pg_temp.chk('access: staff reads the hit stats', (select count(*)::text from public.collab_creator_hit_stats('HR Sarah')), '4');
select pg_temp.chk('access: staff reads the metrics', (select (count(*) > 0)::text from public.collab_video_metrics), 'true');
select pg_temp.as_user('aaaaaaaa-1111-0000-0000-000000000002', 'apc_viewer');
select pg_temp.chk('access: an APC viewer gets nothing from the stats', (select count(*)::text from public.collab_creator_hit_stats('HR Sarah')), '0');
select pg_temp.chk('access: an APC viewer gets nothing from the videos', (select count(*)::text from public.collab_creator_videos('HR Sarah')), '0');
select pg_temp.chk('access: an APC viewer cannot read the metrics table', (select count(*)::text from public.collab_video_metrics), '0');
select pg_temp.as_user('aaaaaaaa-1111-0000-0000-000000000003', 'applicant');
select pg_temp.chk('access: a non-staff login gets nothing', (select count(*)::text from public.collab_creator_hit_stats('HR Sarah')), '0');
do $$ begin
  begin
    insert into public.collab_video_metrics (item_id, window_end) values ('1', now()::date);
    insert into results(test, outcome) values ('access: a login cannot write the metrics', 'FAIL (insert allowed)');
  exception when others then
    insert into results(test, outcome) values ('access: a login cannot write the metrics', 'PASS');
  end;
end $$;
reset role; set local role anon;
do $$ begin
  begin
    perform * from public.collab_creator_hit_stats('HR Sarah');
    insert into results(test, outcome) values ('access: anon is refused the function', 'FAIL (allowed)');
  exception when others then
    insert into results(test, outcome) values ('access: anon is refused the function', 'PASS');
  end;
end $$;

reset role;
select n, outcome, test from results order by n;
select count(*) filter (where outcome like 'FAIL%') as failures, count(*) as total from results;
rollback;
