-- ============================================================================
-- EXACT FIGURES FOR CREATORS BELOW EUKA'S TOP 50.
--
-- Rashid, 2026-11-06: the Brand GMV column showed "< $18" for small creators, because Euka's
-- top-creators report stops at 50. The sync now also reads the brand's affiliate orders and adds
-- up the creators on our roster that the list did not reach (collab-gmv-sync, _shared/collab-gmv.ts).
--
-- `orders_checked` remembers that a month's orders were read, so a cut list is re-read ONCE for
-- them (the months stored before this existed), and a brand-month whose orders could not be read
-- completely is not retried on every run for ever.
-- ============================================================================

alter table public.collab_brand_month_gmv
  add column if not exists orders_checked boolean not null default false;

comment on column public.collab_brand_month_gmv.orders_checked is
  'True once the brand-month''s affiliate orders have been read to complete a cut Euka list. A cut list with this false is read again once.';
