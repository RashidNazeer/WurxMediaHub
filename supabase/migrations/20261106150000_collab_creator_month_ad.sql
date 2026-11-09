-- ============================================================================
-- A CREATOR'S AD SPEND FOR A BRAND IN A MONTH, from Euka's GMV Max creatives.
--
-- Rashid, 2026-11-06: the Performance sheet's October Ad column was wrong. The figure was added up
-- from `euka_ad_video_month`, our copy of Euka's per-campaign item reports, and that copy stopped
-- refreshing on 27 October: the report calls answer 404 for most campaigns, so October stops on the
-- 26th or 27th. (Erin Cooper at Penetrex: Euka says $2,042.80 for October, our copy held $1,930.30.)
--
-- Euka lists every GMV Max creative for any dates, with the creator's handle and its cost, so the
-- month's spend per creator is read from there directly, by `collab-gmv-sync`, next to the month's
-- GMV. `euka_ad_video_month` is left alone and remains the fallback for a brand-month with no row
-- here.
--
--   collab_creator_month_ad    one row per brand, creator handle and month, with her cost
--   collab_brand_month_gmv     two columns say whether the ad spend of that brand-month was read:
--                                ad_checked  the read was attempted (so it is not retried for ever)
--                                ad_read     it succeeded: the rows here are the whole answer, so a
--                                            creator with no row spent nothing that month
-- ============================================================================

alter table public.collab_brand_month_gmv
  add column if not exists ad_checked boolean not null default false,
  add column if not exists ad_read    boolean not null default false;

comment on column public.collab_brand_month_gmv.ad_checked is
  'True once the brand-month''s GMV Max creatives were asked for (success or not).';
comment on column public.collab_brand_month_gmv.ad_read is
  'True when the creatives were read completely: collab_creator_month_ad then holds every creator who spent, and one with no row spent nothing.';

create table if not exists public.collab_creator_month_ad (
  month       text not null,
  brand       text not null,
  handle      text not null check (handle = lower(btrim(handle)) and handle <> '' and handle !~ '^@'),
  cost        numeric(14,2) not null check (cost >= 0),
  fetched_at  timestamptz not null default now(),
  primary key (month, brand, handle),
  foreign key (month, brand) references public.collab_brand_month_gmv (month, brand) on delete cascade
);

create index if not exists collab_creator_month_ad_month_idx
  on public.collab_creator_month_ad (month, brand);

comment on table public.collab_creator_month_ad is
  'GMV Max ad cost per creator for a brand and calendar month, summed from Euka''s creatives list (which carries the creator''s handle). Written only by collab-gmv-sync.';

alter table public.collab_creator_month_ad enable row level security;

drop policy if exists collab_creator_month_ad_select on public.collab_creator_month_ad;
create policy collab_creator_month_ad_select on public.collab_creator_month_ad
  for select to authenticated using (public.is_collabs_viewer());

grant select on table public.collab_creator_month_ad to authenticated;
grant all privileges on table public.collab_creator_month_ad to service_role;
