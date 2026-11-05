-- ============================================================================
-- APC viewer, phase two: ad figures and contests, still brand-scoped, still
-- read only, still no private columns. Same rules as 20261105090100.
--
-- 1. AD FIGURES for the videos inside an APC's brands. The staff function
--    `euka_ad_totals_for_videos` is security invoker over staff-only tables, so
--    an APC got nothing. This wrapper runs as its owner but only ever asks that
--    function about video ids found in the APC's OWN brands' creator rows, so
--    nobody can use it to price another brand's videos. Spark codes are
--    authorisations to run ads on a creator's video and are NOT exposed.
--
-- 2. CONTESTS. They belong to PLATFORM brands (`public.brands`), a different
--    list from the Paid Collabs brand names, with no reliable link (most Paid
--    Collabs brands have no row in public.brands at all). So platform brands
--    are assigned to an APC separately, by id, never matched by name.
--    The view returns counts and totals ONLY: no creator names, handles or
--    emails, no internal notes.
-- ============================================================================

-- ------------------------------------------------- platform brand assignment --
create table if not exists public.apc_platform_brand_access (
  user_id     uuid not null references auth.users (id) on delete cascade,
  brand_id    uuid not null references public.brands (id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (user_id, brand_id)
);

alter table public.apc_platform_brand_access enable row level security;

drop policy if exists apc_platform_brand_access_staff on public.apc_platform_brand_access;
create policy apc_platform_brand_access_staff on public.apc_platform_brand_access
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

revoke all on public.apc_platform_brand_access from public, anon, authenticated;
grant select, insert, update, delete on public.apc_platform_brand_access to authenticated;
grant all on public.apc_platform_brand_access to service_role;

-- Platform brands the CALLER may read. Empty unless an active apc_viewer.
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
    and p.role::text = 'apc_viewer';
$$;

revoke all on function public.apc_platform_brand_ids() from public, anon;
grant execute on function public.apc_platform_brand_ids() to authenticated, service_role;

-- ----------------------------------------------------------- contest summary --
create or replace view public.apc_contests
with (security_barrier = true) as
select
  c.id,
  c.brand_id,
  b.name                                     as brand_name,
  c.name,
  c.description,
  c.status::text                             as status,
  c.opens_at,
  c.expires_at,
  c.currency,
  k.total_budget,
  coalesce(e.entries, 0)::int                as entries,
  coalesce(e.approved, 0)::int               as entries_approved,
  coalesce(s.submissions, 0)::int            as submissions,
  coalesce(a.awarded, 0)::numeric(14, 2)     as awarded,
  coalesce(a.paid, 0)::numeric(14, 2)        as paid,
  coalesce(a.owed, 0)::numeric(14, 2)        as owed
from public.contests c
join public.brands b on b.id = c.brand_id
left join public.contest_commercials k on k.contest_id = c.id
left join lateral (
  select count(*) as entries,
         count(*) filter (where x.status::text = 'approved') as approved
  from public.contest_entries x where x.contest_id = c.id
) e on true
left join lateral (
  select count(*) as submissions
  from public.contest_submissions x where x.contest_id = c.id
) s on true
left join lateral (
  select sum(w.awarded_amount) as awarded,
         sum(w.awarded_amount) filter (where w.paid_at is not null) as paid,
         sum(w.awarded_amount) filter (where w.paid_at is null) as owed
  from public.contest_awards w
  where w.contest_id = c.id and w.awarded_currency = c.currency
) a on true
where c.brand_id in (select public.apc_platform_brand_ids());

revoke all on public.apc_contests from public, anon, authenticated;
grant select on public.apc_contests to authenticated;
grant all on public.apc_contests to service_role;

comment on view public.apc_contests is
  'Brand-scoped contest SUMMARIES for APC viewers. Counts and money totals '
  'only: deliberately no creator identity, no internal_note, no entry rows.';

-- ------------------------------------------------------------- ad figures ----
create or replace function wurxbase.apc_ad_totals_for_videos(
  p_item_ids text[],
  p_from date default null,
  p_to date default null
)
returns table (
  item_id        text,
  cost           numeric,
  gross_revenue  numeric,
  orders         bigint,
  currency       text,
  mixed_currency boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select distinct (regexp_match(v ->> 'video', '/video/(\d+)'))[1] as id
    from wurxbase.creators c,
         jsonb_array_elements(
           case when jsonb_typeof(c.video_codes) = 'array' then c.video_codes else '[]'::jsonb end
         ) v
    where c.brand in (select wurxbase.apc_brands())
  )
  select t.*
  from public.euka_ad_totals_for_videos(
         array(select m.id from mine m where m.id is not null and m.id = any (p_item_ids)),
         p_from, p_to
       ) t;
$$;

revoke all on function wurxbase.apc_ad_totals_for_videos(text[], date, date) from public, anon;
grant execute on function wurxbase.apc_ad_totals_for_videos(text[], date, date) to authenticated, service_role;

comment on function wurxbase.apc_ad_totals_for_videos(text[], date, date) is
  'Ad cost/revenue/orders for videos that belong to the caller''s assigned '
  'brands, and only those. Empty for anyone who is not an active APC viewer.';
