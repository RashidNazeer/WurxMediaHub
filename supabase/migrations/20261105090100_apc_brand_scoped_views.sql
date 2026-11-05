-- ============================================================================
-- What an APC viewer may read: their assigned brands, through views that leave
-- the private columns out. Nothing else.
--
-- WHY VIEWS AND NOT A POLICY ON THE TABLES. Row level security filters ROWS. It
-- cannot hide a column, and every signed-in user is the one Postgres role
-- `authenticated`, so column grants cannot tell an APC from a staff member
-- either. A policy letting an APC read `wurxbase.creators` would hand them
-- every creator's WhatsApp number, email, PayPal and Zelle with one REST call
-- from the browser console, whatever the screen chose to draw.
--
-- So the APC gets NO policy on any base table (which also means realtime
-- pushes them nothing: it honours RLS, and whole rows would carry the phone
-- numbers). `public.is_collabs_viewer()` and `public.is_staff()` are untouched
-- and `apc_viewer` is named in neither.
--
-- WHAT STAYS CLOSED to an APC, on purpose: creators.whatsapp_number / email /
-- paypal / zelle / comments / airtable_id, and the tables app_users (team
-- logins and permissions), audit_logs, activity_logs (except the two per-brand
-- subject kinds below), join_requests, revoked_sessions, app_settings.
--
-- READ ONLY BY GRANT: the views are plain (auto-updatable) views, so the only
-- thing stopping an INSERT/UPDATE/DELETE through them is that no write
-- privilege is granted. SELECT is all that is granted. Do not add more.
-- ============================================================================

-- ---------------------------------------------------------- assignments ----
create table if not exists wurxbase.apc_brand_access (
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Exactly as `wurxbase.creators.brand` spells it. The admin screen picks from
  -- the brands that exist, so there is nothing to mistype.
  brand       text not null check (length(btrim(brand)) between 1 and 200),
  assigned_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (user_id, brand)
);

comment on table wurxbase.apc_brand_access is
  'Which brands each APC viewer may read. Written by the manage-apc Edge '
  'Function (service role) and readable by staff only.';

alter table wurxbase.apc_brand_access enable row level security;

drop policy if exists apc_brand_access_staff on wurxbase.apc_brand_access;
create policy apc_brand_access_staff on wurxbase.apc_brand_access
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

revoke all on wurxbase.apc_brand_access from public, anon, authenticated;
grant select, insert, update, delete on wurxbase.apc_brand_access to authenticated;
grant all on wurxbase.apc_brand_access to service_role;

-- ---------------------------------------------------------- the one gate ----
-- The brands the CALLER may read. Empty for anyone who is not an active
-- apc_viewer, so every view below is empty for staff and for everyone else.
-- Reads `profiles` rather than the JWT claim: a claim can be an hour stale,
-- and a disabled or re-roled APC must lose access immediately.
create or replace function wurxbase.apc_brands()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select a.brand
  from wurxbase.apc_brand_access a
  join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid()
    and p.is_active
    and p.role::text = 'apc_viewer';
$$;

revoke all on function wurxbase.apc_brands() from public, anon;
grant execute on function wurxbase.apc_brands() to authenticated, service_role;

-- ---------------------------------------------------------------- views ----
-- Same names and shapes as the tables the Paid Collabs screens read, MINUS the
-- private columns. The browser swaps the table name for APC sessions
-- (src/vendor/wurxbase/supabaseClient.js); the database is what makes that
-- swap a boundary rather than a convenience.

create or replace view wurxbase.apc_creators
with (security_barrier = true) as
select
  c.id, c.created_time, c.inserted_at, c.brand, c.name, c.deal,
  c.payment_status, c.tiktok_account, c.tiktok_account_2, c.videos,
  c.hiring_date, c.deadline, c.hired_by, c.product, c.category, c.status,
  c.gmv, c.ad_spent, c.total_gmv, c.video_codes, c.monthly, c.products
from wurxbase.creators c
where c.brand in (select wurxbase.apc_brands());

create or replace view wurxbase.apc_brand_monthly_budgets
with (security_barrier = true) as
select b.*
from wurxbase.brand_monthly_budgets b
where b.brand in (select wurxbase.apc_brands());

-- Angle tests and contracts ride in activity_logs as one row per
-- "Brand::YYYY-MM" subject. Only those two kinds, only the assigned brands, and
-- never user_id. Discovery marks are keyed by creator handle, not brand, and
-- the rest of the table is the team's audit trail: both stay closed.
create or replace view wurxbase.apc_activity_logs
with (security_barrier = true) as
select
  l.id, l.action, l.target, l.details, l.user_display,
  l.created_at, l.updated_at, l.revision
from wurxbase.activity_logs l
where l.action in ('CREATIVE_ANGLE', 'BRAND_CONTRACT')
  and split_part(l.target, '::', 1) in (select wurxbase.apc_brands());

do $$
declare v text;
begin
  foreach v in array array['apc_creators', 'apc_brand_monthly_budgets', 'apc_activity_logs']
  loop
    execute format('revoke all on wurxbase.%I from public, anon, authenticated', v);
    execute format('grant select on wurxbase.%I to authenticated', v);
    execute format('grant all on wurxbase.%I to service_role', v);
  end loop;
end $$;

comment on view wurxbase.apc_creators is
  'Brand-scoped creator rows for APC viewers. Deliberately OMITS whatsapp_number, '
  'email, paypal, zelle, comments and airtable_id. If you add a column to '
  'wurxbase.creators it is NOT here until someone decides it is safe.';
