-- ============================================================================
-- WHAT TL AND OL MAY DO.
--
--   OL (`ops_lead`)   complete admin access to EVERY brand. Staff: exactly the
--                     reach Ads Manager has, wherever `is_staff()` is asked.
--                     Not an owner: the admin-only things (editing other
--                     people's profiles, client share links, backups, creating
--                     accounts) still answer to `admin` / `ops`.
--
--   TL (`team_lead`)  full Paid Collabs access, read AND write, for the brands
--                     assigned to them in `wurxbase.apc_brand_access`, and no
--                     other brand. NOT staff and NOT in `is_collabs_viewer()`:
--                     those two predicates are all-brands and must stay so.
--
-- WHY TL IS BRAND-SCOPED IN THE DATABASE. A screen that filters rows is a
-- courtesy; anyone can open the browser console and call the REST API with
-- their own token. So every table a TL may touch gets a policy that names
-- their brands, and a table with no TL policy gives them nothing.
--
-- WHAT TL CAN READ THAT AN APC CANNOT: the base `wurxbase.creators` table, so
-- the private columns (WhatsApp, email, PayPal, Zelle, comments) for THEIR
-- brands. That is what "full access" means for a team lead. An APC still
-- reads only the views that leave those columns out.
--
-- WHAT STAYS CLOSED TO TL, on purpose: app_users (team logins and permissions),
-- audit_logs, join_requests, revoked_sessions, app_settings (workspace-wide, so
-- not one brand's), spark codes, the sync-run bookkeeping tables, and DELETE on
-- creators and budgets (hard delete is withheld in the app as well; say so if
-- it should be allowed).
--
-- `::text` on every role comparison, as in the earlier role migrations.
-- ============================================================================

-- ====================================================== OL: staff, like Ads Manager

create or replace function public.is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.jwt_role()::text in ('ops', 'admin', 'ads_manager', 'ops_lead');
$$;

comment on function public.is_staff() is
  'True for the staff roles: ops, admin, ads_manager (made staff 2026-09-15) and '
  'ops_lead (OL, 2026-11-24). Guards the whole public schema and every Paid '
  'Collabs write. Never add a role here to let somebody SEE a screen; read-only '
  'roles go in is_collabs_viewer(). team_lead is NOT here: it is brand-scoped.';

create or replace function public.assert_active_staff(p_actor_id uuid)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
begin
  select * into v_actor from public.profiles where id = p_actor_id;
  if not found then
    raise exception 'unknown actor' using errcode = '42501';
  end if;
  if v_actor.role::text not in ('ops', 'admin', 'ads_manager', 'ops_lead') or not v_actor.is_active then
    raise exception 'that account is not active staff' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.is_approved_creator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and p.role::text in ('creator', 'ops', 'admin', 'ads_manager', 'ops_lead')
  );
$$;

create or replace function public.refresh_content_preview(
  p_actor_id uuid,
  p_content_id uuid,
  p_thumbnail_url text,
  p_video_title text default null,
  p_video_author text default null,
  p_embed_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_row   public.content_submissions%rowtype;
begin
  select * into v_actor from public.profiles where id = p_actor_id;
  if not found or not v_actor.is_active then
    raise exception 'unknown actor' using errcode = '42501';
  end if;

  select * into v_row from public.content_submissions where id = p_content_id;
  if not found then
    raise exception 'no such submission' using errcode = 'P0002';
  end if;

  -- Staff, or the creator whose video it is. Exactly the people who can already
  -- read the row.
  if v_actor.role::text not in ('admin', 'ops', 'ads_manager', 'ops_lead') and v_row.creator_id <> v_actor.id then
    raise exception 'not yours' using errcode = '42501';
  end if;

  update public.content_submissions
  set thumbnail_url = p_thumbnail_url,
      video_title = coalesce(p_video_title, video_title),
      video_author = coalesce(p_video_author, video_author),
      embed_id = coalesce(p_embed_id, embed_id)
  where id = p_content_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- review_application: the reviewer list gains ops_lead, and the "that account is
-- staff, review it manually" guard gains the new roles, so an approval can never
-- overwrite a team lead's or an ops lead's role with `creator`.
create or replace function public.review_application(
  p_application_id uuid,
  p_decision public.application_status,
  p_actor_id uuid,
  p_tier public.creator_tier default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app      public.applications%rowtype;
  v_target   public.profiles%rowtype;
  v_actor    public.profiles%rowtype;
  v_note     text := nullif(trim(coalesce(p_note, '')), '');
  v_new_role public.app_role;
  v_new_tier public.creator_tier;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'review_application: decision must be approved or rejected'
      using errcode = '22023';
  end if;

  select * into v_actor from public.profiles where id = p_actor_id;
  if not found then
    raise exception 'review_application: unknown reviewer' using errcode = '42501';
  end if;
  if v_actor.role::text not in ('ops', 'admin', 'ads_manager', 'ops_lead') or not v_actor.is_active then
    raise exception 'review_application: reviewer is not active staff'
      using errcode = '42501';
  end if;

  select * into v_app
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'review_application: application not found' using errcode = 'P0002';
  end if;

  if v_app.status <> 'pending' then
    raise exception 'review_application: already reviewed as %', v_app.status
      using errcode = '55006';
  end if;

  select * into v_target from public.profiles where id = v_app.user_id;
  if not found then
    raise exception 'review_application: applicant profile is missing'
      using errcode = 'P0002';
  end if;

  if v_target.role::text in (
       'ops', 'admin', 'ads_manager', 'creative_strategist',
       'affiliate_team_lead', 'operations_lead', 'team_lead', 'ops_lead'
     ) then
    raise exception 'review_application: that account is staff, review it manually'
      using errcode = '42501';
  end if;

  if p_decision = 'approved' then
    if p_tier is null then
      raise exception 'review_application: a tier is required when approving'
        using errcode = '22023';
    end if;
    v_new_role := 'creator';
    v_new_tier := p_tier;
  else
    if p_tier is not null then
      raise exception 'review_application: a tier cannot be set when rejecting'
        using errcode = '22023';
    end if;
    v_new_role := v_target.role;
    v_new_tier := v_target.tier;
  end if;

  update public.profiles
  set role = v_new_role,
      tier = v_new_tier,
      updated_at = now()
  where id = v_target.id;

  update public.applications
  set status      = p_decision,
      reviewed_by = p_actor_id,
      reviewed_at = now(),
      review_note = v_note
  where id = v_app.id;

  insert into public.audit_log (
    actor_id, actor_email, actor_role,
    action, subject_type, subject_id, target_user_id, detail
  )
  values (
    v_actor.id, v_actor.email, v_actor.role,
    'application.' || p_decision, 'application', v_app.id, v_target.id,
    jsonb_strip_nulls(jsonb_build_object(
      'tiktok_handle',    v_app.tiktok_handle,
      'worked_with_wurx', v_app.worked_with_wurx,
      'tier',             v_new_tier,
      'previous_role',    v_target.role,
      'note',             v_note
    ))
  );

  return jsonb_build_object(
    'application_id', v_app.id,
    'user_id',        v_target.id,
    'status',         p_decision,
    'role',           v_new_role,
    'tier',           v_new_tier,
    'reviewed_at',    now()
  );
end;
$$;

-- ============================================================= TL: the brand gate

-- Is the caller an active team lead? Reads `profiles`, not the JWT claim: a
-- claim can be an hour stale, and a disabled or re-roled TL must lose access at
-- once.
create or replace function wurxbase.is_tl()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role::text = 'team_lead'
  );
$$;

-- The brands the CALLER may work on as a team lead. Empty for anyone who is not
-- an active team_lead. Shares the assignment table with APC viewers, so moving
-- someone from APC to TL keeps their brands.
create or replace function wurxbase.tl_brands()
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
    and p.role::text = 'team_lead';
$$;

-- TikTok video ids inside the caller's TL brands, for the tables keyed by video
-- rather than brand. Same extraction as apc_ad_totals_for_videos.
create or replace function wurxbase.tl_video_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct (regexp_match(v ->> 'video', '/video/(\d+)'))[1]
  from wurxbase.creators c,
       jsonb_array_elements(
         case when jsonb_typeof(c.video_codes) = 'array' then c.video_codes else '[]'::jsonb end
       ) v
  where c.brand in (select wurxbase.tl_brands())
    and (regexp_match(v ->> 'video', '/video/(\d+)'))[1] is not null;
$$;

revoke all on function wurxbase.is_tl() from public, anon;
revoke all on function wurxbase.tl_brands() from public, anon;
revoke all on function wurxbase.tl_video_ids() from public, anon;
grant execute on function wurxbase.is_tl() to authenticated, service_role;
grant execute on function wurxbase.tl_brands() to authenticated, service_role;
grant execute on function wurxbase.tl_video_ids() to authenticated, service_role;

-- The APC screens (dashboard, contests, ad totals) work off these two gates. A
-- team lead is an APC with more, so they may use the same screens for the same
-- brands.
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
    and p.role::text in ('apc_viewer', 'team_lead');
$$;

create or replace function public.apc_platform_brand_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.brand_id
  from public.apc_platform_brand_access a
  join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid()
    and p.is_active
    and p.role::text in ('apc_viewer', 'team_lead');
$$;

-- ============================================ TL: policies on the Paid Collabs tables
-- Permissive policies are OR'd with the existing staff ones, so staff are
-- untouched. Every TL policy also fails for anyone who is not an active TL,
-- because tl_brands() / is_tl() are empty / false for them.

drop policy if exists creators_select_tl on wurxbase.creators;
create policy creators_select_tl on wurxbase.creators
  for select to authenticated
  using (brand in (select wurxbase.tl_brands()));

drop policy if exists creators_insert_tl on wurxbase.creators;
create policy creators_insert_tl on wurxbase.creators
  for insert to authenticated
  with check (brand in (select wurxbase.tl_brands()));

-- USING and WITH CHECK both: without the second a TL could edit a row of theirs
-- and set its brand to somebody else's.
drop policy if exists creators_update_tl on wurxbase.creators;
create policy creators_update_tl on wurxbase.creators
  for update to authenticated
  using (brand in (select wurxbase.tl_brands()))
  with check (brand in (select wurxbase.tl_brands()));

drop policy if exists brand_monthly_budgets_select_tl on wurxbase.brand_monthly_budgets;
create policy brand_monthly_budgets_select_tl on wurxbase.brand_monthly_budgets
  for select to authenticated
  using (brand in (select wurxbase.tl_brands()));

drop policy if exists brand_monthly_budgets_insert_tl on wurxbase.brand_monthly_budgets;
create policy brand_monthly_budgets_insert_tl on wurxbase.brand_monthly_budgets
  for insert to authenticated
  with check (brand in (select wurxbase.tl_brands()));

drop policy if exists brand_monthly_budgets_update_tl on wurxbase.brand_monthly_budgets;
create policy brand_monthly_budgets_update_tl on wurxbase.brand_monthly_budgets
  for update to authenticated
  using (brand in (select wurxbase.tl_brands()))
  with check (brand in (select wurxbase.tl_brands()));

-- activity_logs holds two kinds of row. Per-brand rows (the angle test and the
-- contract, keyed "Brand::YYYY-MM") are the TL's to read and change for their
-- brands. Everything else is the team's audit trail: a TL may ADD their own
-- entries (every edit writes one) and read their own back, never anyone else's.
drop policy if exists activity_logs_select_tl on wurxbase.activity_logs;
create policy activity_logs_select_tl on wurxbase.activity_logs
  for select to authenticated
  using (
    wurxbase.is_tl()
    and (
      (action in ('CREATIVE_ANGLE', 'BRAND_CONTRACT')
        and split_part(target, '::', 1) in (select wurxbase.tl_brands()))
      or user_id = auth.uid()::text
    )
  );

drop policy if exists activity_logs_insert_tl on wurxbase.activity_logs;
create policy activity_logs_insert_tl on wurxbase.activity_logs
  for insert to authenticated
  with check (
    wurxbase.is_tl()
    and (
      user_id = auth.uid()::text
      or (action in ('CREATIVE_ANGLE', 'BRAND_CONTRACT')
          and split_part(target, '::', 1) in (select wurxbase.tl_brands()))
    )
  );

drop policy if exists activity_logs_update_tl on wurxbase.activity_logs;
create policy activity_logs_update_tl on wurxbase.activity_logs
  for update to authenticated
  using (
    wurxbase.is_tl()
    and action in ('CREATIVE_ANGLE', 'BRAND_CONTRACT')
    and split_part(target, '::', 1) in (select wurxbase.tl_brands())
  )
  with check (
    wurxbase.is_tl()
    and action in ('CREATIVE_ANGLE', 'BRAND_CONTRACT')
    and split_part(target, '::', 1) in (select wurxbase.tl_brands())
  );

-- ============================== TL: the figures behind the screens (public schema)
-- Read only. Brand-keyed tables compare case-insensitively because the briefs
-- and the figures were written by different jobs and do not always agree on
-- capitalisation ("JoyMode" / "JOYMODE").
do $$
declare t text;
begin
  foreach t in array array[
    'collab_angle_batches', 'collab_angle_videos', 'collab_brand_briefs',
    'collab_brand_month_gmv', 'collab_brand_photos',
    'collab_creator_month_ad', 'collab_creator_month_gmv'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_tl', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (exists (select 1 from wurxbase.tl_brands() b where lower(btrim(b)) = lower(btrim(%I.brand))))',
      t || '_select_tl', t, t);
  end loop;

  -- keyed by TikTok video id, scoped to the videos in the TL's own brands
  foreach t in array array['collab_video_metrics', 'euka_ad_video_month', 'euka_ad_video_day']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_tl', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (item_id in (select wurxbase.tl_video_ids()))',
      t || '_select_tl', t);
  end loop;

  -- not brand-specific and not sensitive: product pictures, creator category
  -- and follower counts (public TikTok figures)
  foreach t in array array['collab_product_images', 'euka_creator_categories', 'euka_creator_followers']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_tl', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (wurxbase.is_tl())',
      t || '_select_tl', t);
  end loop;
end $$;
