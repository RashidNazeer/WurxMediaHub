-- Proves an APC viewer reads only their brands, never contact/payment columns, and can write nothing.
-- Run against a LOCAL stack that has all migrations applied (it rolls back):
--   docker exec -i supabase_db_WurxMediaHub psql -U postgres -P pager=off < scripts/verify/apc-viewer-security.sql
-- Expect `failures | 0`. Never run against production.
\set ON_ERROR_STOP on
begin;
set session_replication_role = replica;  -- seed only: bypass the profile guard trigger

insert into auth.users (id, email, instance_id, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'apc@test.local',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'apc2@test.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'staff@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'plain@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
insert into public.profiles (id, email, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','apc@test.local','apc_viewer'),
  ('aaaaaaaa-0000-0000-0000-000000000002','apc2@test.local','apc_viewer'),
  ('aaaaaaaa-0000-0000-0000-000000000003','staff@test.local','admin'),
  ('aaaaaaaa-0000-0000-0000-000000000004','plain@test.local','applicant')
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
insert into wurxbase.apc_brand_access (user_id, brand) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Alpha');
insert into wurxbase.apc_brand_access (user_id, brand) values ('aaaaaaaa-0000-0000-0000-000000000002', 'Beta');
set session_replication_role = origin;

create temp table results (n serial, test text, outcome text);
grant all on results to authenticated, anon; grant usage, select on sequence results_n_seq to authenticated, anon;

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid, true);
end $$;

-- every check runs as the real `authenticated` role, like PostgREST does
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

grant execute on all functions in schema pg_temp to authenticated;
set local role authenticated;

-- ============ APC for Alpha ============
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_count('apc1: sees Alpha creators only (2)', 'select * from wurxbase.apc_creators', 2);
select pg_temp.expect_count('apc1: no Beta rows in view',        $q$select * from wurxbase.apc_creators where brand = 'Beta'$q$, 0);
select pg_temp.expect_count('apc1: budgets Alpha only (1)',      'select * from wurxbase.apc_brand_monthly_budgets', 1);
select pg_temp.expect_count('apc1: angle+contract Alpha only (2)', 'select * from wurxbase.apc_activity_logs', 2);
select pg_temp.expect_count('apc1: view has NO whatsapp column', $q$select 1 from information_schema.columns where table_schema='wurxbase' and table_name='apc_creators' and column_name in ('whatsapp_number','paypal','zelle','email','comments','airtable_id')$q$, 0);
select pg_temp.expect_count('apc1: raw creators table unreadable', 'select * from wurxbase.creators', 0);
select pg_temp.expect_count('apc1: app_users unreadable',        'select * from wurxbase.app_users', 0);
select pg_temp.expect_count('apc1: audit_logs unreadable',       'select * from wurxbase.audit_logs', 0);
select pg_temp.expect_count('apc1: raw activity_logs unreadable','select * from wurxbase.activity_logs', 0);
select pg_temp.expect_count('apc1: raw budgets unreadable',      'select * from wurxbase.brand_monthly_budgets', 0);
select pg_temp.expect_count('apc1: app_settings unreadable',     'select * from wurxbase.app_settings', 0);
select pg_temp.expect_count('apc1: join_requests unreadable',    'select * from wurxbase.join_requests', 0);
select pg_temp.expect_count('apc1: assignments table unreadable','select * from wurxbase.apc_brand_access', 0);
select pg_temp.expect_denied('apc1: INSERT via view',    $q$insert into wurxbase.apc_creators (brand, name) values ('Alpha','Evil')$q$);
select pg_temp.expect_denied('apc1: UPDATE via view',    $q$update wurxbase.apc_creators set gmv = 0$q$);
select pg_temp.expect_denied('apc1: DELETE via view',    $q$delete from wurxbase.apc_creators$q$);
select pg_temp.expect_denied('apc1: INSERT raw creators',$q$insert into wurxbase.creators (brand, name) values ('Alpha','Evil')$q$);
select pg_temp.expect_denied('apc1: UPDATE raw creators',$q$update wurxbase.creators set gmv = 0$q$);
select pg_temp.expect_denied('apc1: DELETE raw creators',$q$delete from wurxbase.creators$q$);
select pg_temp.expect_denied('apc1: UPDATE budgets view',$q$update wurxbase.apc_brand_monthly_budgets set budget = 0$q$);
select pg_temp.expect_denied('apc1: INSERT activity_logs',$q$insert into wurxbase.activity_logs (action,target) values ('CREATIVE_ANGLE','Alpha::2026-12')$q$);
select pg_temp.expect_denied('apc1: grant self a brand', $q$insert into wurxbase.apc_brand_access (user_id, brand) values ('aaaaaaaa-0000-0000-0000-000000000001','Beta')$q$);
select pg_temp.expect_denied('apc1: promote self to admin', $q$update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$);

-- ============ APC for Beta (isolation between APCs) ============
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.expect_count('apc2: sees Beta creators only (1)', 'select * from wurxbase.apc_creators', 1);
select pg_temp.expect_count('apc2: no Alpha rows',               $q$select * from wurxbase.apc_creators where brand = 'Alpha'$q$, 0);

-- ============ people who are not APCs get nothing from the views ============
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select pg_temp.expect_count('admin: apc view empty (admin uses base tables)', 'select * from wurxbase.apc_creators', 0);
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000004');
select pg_temp.expect_count('plain user: apc view empty', 'select * from wurxbase.apc_creators', 0);

-- ============ anon ============
reset role; set local role anon;
select pg_temp.expect_count('anon: apc view denied', 'select * from wurxbase.apc_creators', 0);

-- ============ a disabled APC loses access at once ============
reset role;
set session_replication_role = replica;
update public.profiles set is_active = false where id = 'aaaaaaaa-0000-0000-0000-000000000001';
set session_replication_role = origin;
set local role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_count('disabled apc1: sees nothing', 'select * from wurxbase.apc_creators', 0);

reset role;
select n, outcome, test from results order by n;
select count(*) filter (where outcome like 'FAIL%') as failures, count(*) as total from results;
rollback;
