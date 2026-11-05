-- ============================================================================
-- WHAT A CREATOR MADE FOR A BRAND IN A CALENDAR MONTH, from Euka and Reacher.
--
-- Rashid, 2026-11-06: set the date to September and see the GMV the creator made
-- from 1 September to the end of September. Not the videos posted in September:
-- the sales that landed in September, from any of her videos.
--
-- WHY OUR OWN DATA CANNOT ANSWER IT. A video's `revenue` is one running total
-- that every sync overwrites, with no history, so a September sale on a July
-- video cannot be told apart from a July one. Euka and Reacher both keep DAILY
-- sales and report a creator's GMV for any date range, so this copies their
-- answer for each whole calendar month:
--
--   Euka     POST /dashboard/top-creators-by-gmv   (sales dates, top 50 per brand)
--   Reacher  POST /creators/performance            (sales dates, every creator)
--
-- A brand is read from Euka when Euka has it, otherwise from Reacher, never both
-- (adding them would count a sale twice). A brand on neither has no rows and the
-- screen shows a dash.
--
-- TWO TABLES.
--   collab_creator_month_gmv   one row per brand, creator handle and month. The
--                              handle is lower-case with no @, the way both
--                              platforms give it and the way Paid Collabs rows
--                              hold it (`tiktok_account`).
--   collab_brand_month_gmv     one row per brand and month: where it came from,
--                              when it was read, and, for Euka, whether the
--                              report was cut at 50 creators and the smallest GMV
--                              it reached. A creator who is not in a CUT list made
--                              less than that smallest figure; that is "under
--                              $X", which is not the same as $0 and not the same
--                              as "no data".
--
-- A MONTH IS RE-READ WHILE IT SETTLES: the current month often, last month for its
-- first week (TikTok attributes some sales late), older months once.
--
-- THE SCHEDULE is the one `reacher-sync` uses: the secret and URL sit in the vault,
-- set once at deploy time, and pg_cron posts to the Edge Function through pg_net.
-- ============================================================================

create table if not exists public.collab_brand_month_gmv (
  month       text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  brand       text not null check (length(btrim(brand)) between 1 and 120),
  source      text not null check (source in ('euka', 'reacher')),
  creators    integer not null check (creators >= 0),
  -- Euka answers the top 50 only. true when it returned 50, so someone may be missing.
  truncated   boolean not null default false,
  -- the smallest GMV in a truncated list: anyone absent from it made no more than this
  floor_gmv   numeric(14,2) check (floor_gmv >= 0),
  fetched_at  timestamptz not null default now(),
  primary key (month, brand)
);

create table if not exists public.collab_creator_month_gmv (
  month       text not null,
  brand       text not null,
  handle      text not null check (handle = lower(btrim(handle)) and handle <> '' and handle !~ '^@'),
  gmv         numeric(14,2) not null check (gmv >= 0),
  source      text not null check (source in ('euka', 'reacher')),
  fetched_at  timestamptz not null default now(),
  primary key (month, brand, handle),
  foreign key (month, brand) references public.collab_brand_month_gmv (month, brand) on delete cascade
);

create index if not exists collab_creator_month_gmv_month_idx
  on public.collab_creator_month_gmv (month, brand);

comment on table public.collab_brand_month_gmv is
  'Which platform a brand''s monthly creator GMV was read from, when, and whether Euka''s top-50 list was cut (then floor_gmv is the smallest figure it reached). Written only by collab-gmv-sync.';
comment on table public.collab_creator_month_gmv is
  'A creator''s GMV for a brand over one calendar month, by SALES date, as reported by Euka or Reacher. Not the videos posted that month. Written only by collab-gmv-sync.';

alter table public.collab_brand_month_gmv   enable row level security;
alter table public.collab_creator_month_gmv enable row level security;

drop policy if exists collab_brand_month_gmv_select on public.collab_brand_month_gmv;
create policy collab_brand_month_gmv_select on public.collab_brand_month_gmv
  for select to authenticated using (public.is_collabs_viewer());

drop policy if exists collab_creator_month_gmv_select on public.collab_creator_month_gmv;
create policy collab_creator_month_gmv_select on public.collab_creator_month_gmv
  for select to authenticated using (public.is_collabs_viewer());

-- no insert, update or delete policy on either table: only the service role writes

grant select on table public.collab_brand_month_gmv   to authenticated;
grant select on table public.collab_creator_month_gmv to authenticated;
grant all privileges on table public.collab_brand_month_gmv   to service_role;
grant all privileges on table public.collab_creator_month_gmv to service_role;

-- ------------------------------------------------------------ the schedule --
create or replace function public.collab_gmv_set_sync_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_secret is null or length(p_secret) < 24 then
    raise exception 'collab_gmv_set_sync_secret: the secret must be at least 24 characters';
  end if;
  select id into v_id from vault.secrets where name = 'collab_gmv_sync_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'collab_gmv_sync_secret',
      'Shared with the collab-gmv-sync Edge Function, which compares it in constant time');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
end;
$$;

create or replace function public.collab_gmv_set_sync_url(p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_url is null or p_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/collab-gmv-sync$' then
    raise exception 'collab_gmv_set_sync_url: that does not look like a collab-gmv-sync function URL';
  end if;
  select id into v_id from vault.secrets where name = 'collab_gmv_sync_url';
  if v_id is null then
    perform vault.create_secret(p_url, 'collab_gmv_sync_url', 'Where the collab GMV sync posts');
  else
    perform vault.update_secret(v_id, p_url);
  end if;
end;
$$;

revoke all on function public.collab_gmv_set_sync_secret(text) from anon, authenticated, public;
revoke all on function public.collab_gmv_set_sync_url(text) from anon, authenticated, public;
grant execute on function public.collab_gmv_set_sync_secret(text) to service_role;
grant execute on function public.collab_gmv_set_sync_url(text) to service_role;

create or replace function public.collab_gmv_run_cycle()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'collab_gmv_sync_secret';
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'collab_gmv_sync_url';

  -- Silent when the vault is empty, like reacher_run_cycle: nothing to run, nothing to log.
  if v_secret is null or v_url is null then
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.collab_gmv_run_cycle() from anon, authenticated, public;
grant execute on function public.collab_gmv_run_cycle() to service_role;

-- Every 30 minutes. A run does only what is missing or stale (the function decides),
-- so most runs do nothing; the first ones fill the last six months a few brands at a time.
select cron.unschedule('collab-gmv-cycle')
where exists (select 1 from cron.job where jobname = 'collab-gmv-cycle');

select cron.schedule(
  'collab-gmv-cycle',
  '*/30 * * * *',
  $$ select public.collab_gmv_run_cycle(); $$
);
