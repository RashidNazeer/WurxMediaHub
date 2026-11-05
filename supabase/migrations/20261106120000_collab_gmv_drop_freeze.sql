-- ============================================================================
-- THE MONTH-END FREEZE IS REMOVED.
--
-- Rashid, 2026-11-06: the Brand GMV for a month is what the videos posted in that
-- month have made up to today, so it keeps rising and "can never be locked". The
-- screens now work it out live from the rows they hold (src/lib/admin/month-gmv.ts)
-- and read nothing from these tables, so the nightly job, the functions and the
-- snapshots built for the freeze (20261105085000, 20261106000000) are dropped.
--
-- This deletes the one frozen month (October 2026, frozen late as a backfill): no
-- screen shows it any more.
-- ============================================================================

select cron.unschedule('collab-gmv-freeze')
where exists (select 1 from cron.job where jobname = 'collab-gmv-freeze');

drop function if exists public.collab_gmv_freeze_previous_month(timestamptz);
drop function if exists public.collab_gmv_freeze_previous_month();
drop function if exists public.collab_gmv_freeze(text, text);
drop function if exists public.collab_month_gmv(text);

drop table if exists public.collab_gmv_snapshots;
drop table if exists public.collab_gmv_freezes;
