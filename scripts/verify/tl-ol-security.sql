-- Proves the TL (team_lead) and OL (ops_lead) roles:
--   TL: full read/write on THEIR brands only, in the database, and nothing on other brands.
--   OL: staff, like Ads Manager.
--   APC viewers and ordinary users are unchanged.
-- Run against a LOCAL stack that has all migrations applied (it rolls back):
--   docker exec -i supabase_db_WurxMediaHub psql -U postgres -P pager=off < scripts/verify/tl-ol-security.sql
-- Expect `failures | 0`. Never run against production.
\set ON_ERROR_STOP on
begin;
set session_replication_role = replica;  -- seed only: bypass the profile guard trigger

insert into auth.users (id, email, instance_id, aud, role) values
  ('dddddddd-0000-0000-0000-000000000001', 'tl1@test.local',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000002', 'tl2@test.local',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000003', 'apc1@test.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000004', 'ol@test.local',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000005', 'admin@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000006', 'plain@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000007', 'tl0@test.local',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.profiles (id, email, role) values
  ('dddddddd-0000-0000-0000-000000000001','tl1@test.local','team_lead'),
  ('dddddddd-0000-0000-0000-000000000002','tl2@test.local','team_lead'),
  ('dddddddd-0000-0000-0000-000000000003','apc1@test.local','apc_viewer'),
  ('dddddddd-0000-0000-0000-000000000004','ol@test.local','ops_lead'),
  ('dddddddd-0000-0000-0000-000000000005','admin@test.local','admin'),
  ('dddddddd-0000-0000-0000-000000000006','plain@test.local','applicant'),
  ('dddddddd-0000-0000-0000-000000000007','tl0@test.local','team_lead')
on conflict (id) do update set role = excluded.role;

insert into wurxbase.creators (brand, name, whatsapp_number, paypal, zelle, email, comments, deal, gmv, status) values
  ('Alpha', 'Ann',  '+1-555-0101', 'ann@pay.com',  'ann-zelle',  'ann@mail.com',  'call her mobile', '$200 for 6', 1200, 'approved'),
  ('Alpha', 'Abe',  '+1-555-0102', 'abe@pay.com',  'abe-zelle',  'abe@mail.com',  'secret note',     '$100 for 3',  300, 'approved'),
  ('Beta',  'Bob',  '+1-555-0201', 'bob@pay.com',  'bob-zelle',  'bob@mail.com',  'other brand',     '$300 for 9',  900, 'approved');
insert into wurxbase.brand_monthly_budgets (brand, month, budget) values ('Alpha','2026-11',5000), ('Beta','2026-11',7000);
insert into wurxbase.activity_logs (user_id, action, target, details) values
  ('u1','CREATIVE_ANGLE','Alpha::2026-11','{"angles":[]}'),
  ('u1','CREATIVE_ANGLE','Beta::2026-11','{"angles":[]}'),
  ('u1','BRAND_CONTRACT','Alpha::2026-11','{"terms":"x"}'),
  ('u1','LOGIN',null,'{}'),
  ('u1','DISCOVERY_MARK','somehandle','{}');
insert into wurxbase.app_users (id, username, role, display) values ('x1','someone','admin','Someone');
insert into wurxbase.audit_logs (actor, action) values ('a','b');
-- tl1 works Alpha only, tl2 Beta only, apc1 Alpha, tl0 has NO brand at all
insert into wurxbase.apc_brand_access (user_id, brand) values
  ('dddddddd-0000-0000-0000-000000000001', 'Alpha'),
  ('dddddddd-0000-0000-0000-000000000002', 'Beta'),
  ('dddddddd-0000-0000-0000-000000000003', 'Alpha');
set session_replication_role = origin;

update wurxbase.creators set video_codes = '[{"video":"https://www.tiktok.com/@a/video/111111111"}]'::jsonb where name = 'Ann';
update wurxbase.creators set video_codes = '[{"video":"https://www.tiktok.com/@b/video/222222222"}]'::jsonb where name = 'Bob';
insert into public.euka_ad_video_month (item_id, month, store_id, advertiser_id, campaign_id, cost, orders, gross_revenue, currency) values
  ('111111111', date_trunc('month', now())::date, 's', 'adv', 'c1', 50, 2, 300, 'USD'),
  ('222222222', date_trunc('month', now())::date, 's', 'adv', 'c2', 99, 9, 900, 'USD');
insert into public.collab_video_metrics (item_id, known, gmv_30d, gmv_90d, views, window_end, source) values
  ('111111111', true, 10, 20, 1000, current_date, 'euka'),
  ('222222222', true, 99, 99, 9999, current_date, 'euka');
insert into public.collab_brand_month_gmv (month, brand, source, creators) values
  ('2026-11', 'Alpha', 'euka', 2), ('2026-11', 'Beta', 'euka', 1);
insert into public.collab_creator_month_gmv (month, brand, handle, gmv, source) values
  ('2026-11', 'Alpha', 'ann', 100, 'euka'), ('2026-11', 'Beta', 'bob', 900, 'euka');
-- written by another job with different capitalisation: must still match 'Alpha'
insert into public.collab_brand_briefs (brand, brief_url) values ('ALPHA', 'https://docs.google.com/document/d/aaaaaaaaaaaaaaaaaaaa'), ('Beta', 'https://docs.google.com/document/d/bbbbbbbbbbbbbbbbbbbb');
insert into public.euka_creator_categories (handle, found) values ('ann', true);

-- platform brands + contests, for the APC screens a TL shares
insert into public.brands (id, name, slug, store_id) values
  ('bbbbbbbb-0000-0000-0000-00000000000a','Plat Alpha','plat-alpha','store-a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','Plat Beta','plat-beta','store-b');
insert into public.contests (id, brand_id, name, expires_at) values
  ('cccccccc-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-00000000000a','Alpha contest', now() + interval '10 days'),
  ('cccccccc-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-00000000000b','Beta contest',  now() + interval '10 days');
insert into public.apc_platform_brand_access (user_id, brand_id) values
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-00000000000a'),
  ('dddddddd-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b');

create temp table results (n serial, test text, outcome text);
grant all on results to authenticated, anon; grant usage, select on sequence results_n_seq to authenticated, anon;

-- the token carries `user_role` (what is_staff() reads) and `sub`
create or replace function pg_temp.as_user(uid text, urole text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'user_role', urole)::text, true);
  perform set_config('request.jwt.claim.sub', uid, true);
end $$;

create or replace function pg_temp.expect_count(label text, q text, want int) returns void language plpgsql as $$
declare got int;
begin
  begin
    execute 'select count(*) from (' || q || ') s' into got;
    insert into results(test, outcome) values (label, case when got = want then 'PASS' else 'FAIL (got '||got||', want '||want||')' end);
  exception when others then
    insert into results(test, outcome) values (label, case when want = 0 then 'PASS (denied: '||sqlerrm||')' else 'FAIL error '||sqlerrm end);
  end;
end $$;

-- a write that must change nothing (0 rows) or be refused
create or replace function pg_temp.expect_denied(label text, stmt text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
    insert into results(test, outcome) values (label, case when n = 0 then 'PASS (0 rows changed)' else 'FAIL (changed '||n||' rows)' end);
  exception when others then
    insert into results(test, outcome) values (label, 'PASS (denied: '||sqlerrm||')');
  end;
end $$;

-- a write that must succeed and change exactly `want` rows
create or replace function pg_temp.expect_allowed(label text, stmt text, want int) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
    insert into results(test, outcome) values (label, case when n = want then 'PASS' else 'FAIL (changed '||n||', want '||want||')' end);
  exception when others then
    insert into results(test, outcome) values (label, 'FAIL error '||sqlerrm);
  end;
end $$;

grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

-- ============ TL for Alpha: READS ============
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000001', 'team_lead');
select pg_temp.expect_count('tl1: reads Alpha creators (2)', 'select * from wurxbase.creators', 2);
select pg_temp.expect_count('tl1: sees NO Beta creator',     $q$select * from wurxbase.creators where brand = 'Beta'$q$, 0);
select pg_temp.expect_count('tl1: contact columns are readable for own brand (2)', 'select * from wurxbase.creators where whatsapp_number is not null and paypal is not null and zelle is not null', 2);
select pg_temp.expect_count('tl1: Alpha budget only (1)',    'select * from wurxbase.brand_monthly_budgets', 1);
select pg_temp.expect_count('tl1: Alpha angle+contract only (2)', 'select * from wurxbase.activity_logs', 2);
select pg_temp.expect_count('tl1: app_users closed',         'select * from wurxbase.app_users', 0);
select pg_temp.expect_count('tl1: audit_logs closed',        'select * from wurxbase.audit_logs', 0);
select pg_temp.expect_count('tl1: join_requests closed',     'select * from wurxbase.join_requests', 0);
select pg_temp.expect_count('tl1: revoked_sessions closed',  'select * from wurxbase.revoked_sessions', 0);
select pg_temp.expect_count('tl1: app_settings closed',      'select * from wurxbase.app_settings', 0);
select pg_temp.expect_count('tl1: assignments table closed', 'select * from wurxbase.apc_brand_access', 0);
select pg_temp.expect_count('tl1: video metrics for own brand only (1)', 'select * from public.collab_video_metrics', 1);
select pg_temp.expect_count('tl1: ad spend for own videos only (1)', 'select * from public.euka_ad_video_month', 1);
select pg_temp.expect_count('tl1: brand month gmv, Alpha only (1)', 'select * from public.collab_brand_month_gmv', 1);
select pg_temp.expect_count('tl1: creator month gmv, Alpha only (1)', 'select * from public.collab_creator_month_gmv', 1);
select pg_temp.expect_count('tl1: brief matches despite capitalisation (1)', 'select * from public.collab_brand_briefs', 1);
select pg_temp.expect_count('tl1: category table readable (1)', 'select * from public.euka_creator_categories', 1);
select pg_temp.expect_count('tl1: shares the APC screens: apc_creators (2)', 'select * from wurxbase.apc_creators', 2);
select pg_temp.expect_count('tl1: shares the APC screens: own contest only (1)', 'select * from public.apc_contests', 1);
select pg_temp.expect_count('tl1: cannot price a Beta video', $q$select * from wurxbase.apc_ad_totals_for_videos(array['222222222'])$q$, 0);

-- ============ TL for Alpha: WRITES ============
select pg_temp.expect_allowed('tl1: INSERT creator in own brand', $q$insert into wurxbase.creators (brand, name) values ('Alpha','New Alpha')$q$, 1);
select pg_temp.expect_denied ('tl1: INSERT creator in another brand', $q$insert into wurxbase.creators (brand, name) values ('Beta','Intruder')$q$);
select pg_temp.expect_allowed('tl1: UPDATE own brand rows', $q$update wurxbase.creators set gmv = 5 where brand = 'Alpha'$q$, 3);
select pg_temp.expect_denied ('tl1: UPDATE another brand changes nothing', $q$update wurxbase.creators set gmv = 0 where brand = 'Beta'$q$);
select pg_temp.expect_denied ('tl1: cannot move a row to another brand', $q$update wurxbase.creators set brand = 'Beta' where name = 'Ann'$q$);
select pg_temp.expect_denied ('tl1: DELETE creators (withheld)', $q$delete from wurxbase.creators$q$);
select pg_temp.expect_allowed('tl1: INSERT budget in own brand', $q$insert into wurxbase.brand_monthly_budgets (brand, month, budget) values ('Alpha','2026-12',100)$q$, 1);
select pg_temp.expect_denied ('tl1: INSERT budget in another brand', $q$insert into wurxbase.brand_monthly_budgets (brand, month, budget) values ('Beta','2026-12',100)$q$);
select pg_temp.expect_allowed('tl1: UPDATE own budget', $q$update wurxbase.brand_monthly_budgets set budget = 6000 where brand = 'Alpha' and month = '2026-11'$q$, 1);
select pg_temp.expect_denied ('tl1: UPDATE another brand budget', $q$update wurxbase.brand_monthly_budgets set budget = 0 where brand = 'Beta'$q$);
select pg_temp.expect_denied ('tl1: DELETE budgets (withheld)', $q$delete from wurxbase.brand_monthly_budgets$q$);
select pg_temp.expect_allowed('tl1: audit entry as themselves', $q$insert into wurxbase.activity_logs (user_id, action, target) values ('dddddddd-0000-0000-0000-000000000001','EDIT','Ann')$q$, 1);
select pg_temp.expect_denied ('tl1: audit entry in someone else''s name', $q$insert into wurxbase.activity_logs (user_id, action, target) values ('u1','EDIT','Ann')$q$);
select pg_temp.expect_allowed('tl1: angle row for own brand', $q$insert into wurxbase.activity_logs (user_id, action, target) values ('anyone','CREATIVE_ANGLE','Alpha::2026-12')$q$, 1);
select pg_temp.expect_denied ('tl1: angle row for another brand', $q$insert into wurxbase.activity_logs (user_id, action, target) values ('anyone','CREATIVE_ANGLE','Beta::2026-12')$q$);
select pg_temp.expect_denied ('tl1: UPDATE another brand angle', $q$update wurxbase.activity_logs set details = '{}' where target = 'Beta::2026-11'$q$);
select pg_temp.expect_denied ('tl1: DELETE audit rows', $q$delete from wurxbase.activity_logs$q$);
select pg_temp.expect_denied ('tl1: grant self another brand', $q$insert into wurxbase.apc_brand_access (user_id, brand) values ('dddddddd-0000-0000-0000-000000000001','Beta')$q$);
select pg_temp.expect_denied ('tl1: promote self to admin', $q$update public.profiles set role = 'admin' where id = 'dddddddd-0000-0000-0000-000000000001'$q$);
select pg_temp.expect_denied ('tl1: write app_users', $q$insert into wurxbase.app_users (id, username, role, display) values ('x2','evil','admin','Evil')$q$);
select pg_temp.expect_denied ('tl1: write app_settings', $q$insert into wurxbase.app_settings default values$q$);

-- ============ TL for Beta (isolation between TLs) ============
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000002', 'team_lead');
select pg_temp.expect_count('tl2: sees Beta creator only (1)', 'select * from wurxbase.creators', 1);
select pg_temp.expect_count('tl2: no Alpha rows', $q$select * from wurxbase.creators where brand = 'Alpha'$q$, 0);
select pg_temp.expect_count('tl2: video metrics Beta only (1)', 'select * from public.collab_video_metrics', 1);
select pg_temp.expect_denied('tl2: cannot update Alpha', $q$update wurxbase.creators set gmv = 0 where brand = 'Alpha'$q$);

-- ============ a TL with NO brand assigned sees and writes nothing ============
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000007', 'team_lead');
select pg_temp.expect_count('tl0 (no brands): creators', 'select * from wurxbase.creators', 0);
select pg_temp.expect_count('tl0 (no brands): video metrics', 'select * from public.collab_video_metrics', 0);
select pg_temp.expect_denied('tl0 (no brands): insert', $q$insert into wurxbase.creators (brand, name) values ('Alpha','x')$q$);

-- ============ APC viewer unchanged: still no base-table reach ============
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003', 'apc_viewer');
select pg_temp.expect_count('apc1: raw creators still unreadable', 'select * from wurxbase.creators', 0);
select pg_temp.expect_count('apc1: view still works (3 incl. new Alpha row)', 'select * from wurxbase.apc_creators', 3);
select pg_temp.expect_denied('apc1: still cannot insert raw', $q$insert into wurxbase.creators (brand, name) values ('Alpha','Evil')$q$);
select pg_temp.expect_count('apc1: video metrics closed', 'select * from public.collab_video_metrics', 0);
select pg_temp.expect_count('apc1: brand month gmv closed', 'select * from public.collab_brand_month_gmv', 0);

-- ============ OL: staff everywhere, like Ads Manager ============
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004', 'ops_lead');
select pg_temp.expect_count('ol: is_staff()', 'select 1 where public.is_staff()', 1);
select pg_temp.expect_count('ol: reads every brand, not just one (Alpha+Beta = 4 of our rows)', $q$select * from wurxbase.creators where brand in ('Alpha','Beta')$q$, 4);
select pg_temp.expect_count('ol: reads app_users', 'select * from wurxbase.app_users', 1);
select pg_temp.expect_count('ol: reads assignments', $q$select * from wurxbase.apc_brand_access where user_id::text like 'dddddddd%'$q$, 3);
select pg_temp.expect_allowed('ol: writes any brand', $q$update wurxbase.creators set gmv = 7 where brand = 'Beta'$q$, 1);
select pg_temp.expect_count('ol: not a TL (no tl brands)', 'select * from wurxbase.tl_brands()', 0);

-- ============ the server-side staff gate (service role only), as its owner ============
reset role;
do $$ begin
  perform public.assert_active_staff('dddddddd-0000-0000-0000-000000000004');   -- OL: must not raise
  insert into results(test, outcome) values ('assert_active_staff admits an active OL', 'PASS');
exception when others then
  insert into results(test, outcome) values ('assert_active_staff admits an active OL', 'FAIL '||sqlerrm);
end $$;
do $$ begin
  perform public.assert_active_staff('dddddddd-0000-0000-0000-000000000001');   -- TL: must raise
  insert into results(test, outcome) values ('assert_active_staff refuses a TL', 'FAIL (admitted)');
exception when others then
  insert into results(test, outcome) values ('assert_active_staff refuses a TL', 'PASS');
end $$;
set local role authenticated;

-- ============ unchanged: admin, plain user, anon ============
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000005', 'admin');
select pg_temp.expect_count('admin: reads every brand (4 of our rows)', $q$select * from wurxbase.creators where brand in ('Alpha','Beta')$q$, 4);
select pg_temp.expect_count('admin: tl_brands empty (not a TL)', 'select * from wurxbase.tl_brands()', 0);
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000006', 'applicant');
select pg_temp.expect_count('plain user: creators', 'select * from wurxbase.creators', 0);
select pg_temp.expect_denied('plain user: insert', $q$insert into wurxbase.creators (brand, name) values ('Alpha','x')$q$);
select pg_temp.expect_count('plain user: category table', 'select * from public.euka_creator_categories', 0);
reset role; set local role anon;
select pg_temp.expect_count('anon: creators', 'select * from wurxbase.creators', 0);

-- ============ a disabled TL loses access at once ============
reset role;
set session_replication_role = replica;
update public.profiles set is_active = false where id = 'dddddddd-0000-0000-0000-000000000001';
set session_replication_role = origin;
set local role authenticated;
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000001', 'team_lead');
select pg_temp.expect_count('disabled tl1: creators', 'select * from wurxbase.creators', 0);
select pg_temp.expect_denied('disabled tl1: insert', $q$insert into wurxbase.creators (brand, name) values ('Alpha','x')$q$);

-- ============ re-roled TL (token still says team_lead) loses access at once ============
reset role;
set session_replication_role = replica;
update public.profiles set is_active = true, role = 'applicant' where id = 'dddddddd-0000-0000-0000-000000000001';
set session_replication_role = origin;
set local role authenticated;
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000001', 'team_lead');
select pg_temp.expect_count('re-roled tl1 with a stale token: creators', 'select * from wurxbase.creators', 0);

reset role;
select n, outcome, test from results order by n;
select count(*) filter (where outcome like 'FAIL%') as failures, count(*) as total from results;
rollback;
