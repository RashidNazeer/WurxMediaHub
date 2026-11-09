-- ============================================================================
-- A CREATOR'S CATEGORY, LOOKED UP BY HANDLE IN EUKA.
--
-- Rashid, 2026-11-06: the Category column on Paid Collabs -> Creators should fill itself from Euka
-- for every creator, and for every creator added later.
--
-- Euka's market intelligence (`/market-intelligence/tiktok/creator/rank`, asked with
-- `need_category: 1`) lists the top three TikTok Shop categories a creator sells in. It is a keyword
-- search, so as with follower counts only an EXACT handle match is believed and a miss is recorded,
-- not retried every run.
--
--   euka_creator_categories   one row per handle: Euka's labels, what this sync last wrote into
--                             wurxbase.creators.category, whether the search found her, when.
--
-- `written` is how a typed category is told from the sync's own: the sync fills a row whose Category
-- is blank, or still equals `written`, and nothing else. A person's edit therefore freezes it.
--
-- WHY NOT THE FOLLOWER TABLE: its filler runs at the end of euka-ads-sync, which has not reached it
-- since 2026-10-27, so anything added there would not run. This is filled by `collab-gmv-sync` in
-- its `categories` mode, on its own cron, with the same secret and URL (the vault entries
-- `collab_gmv_sync_secret` and `collab_gmv_sync_url` already set for the GMV cycle).
-- ============================================================================

create table if not exists public.euka_creator_categories (
  handle      text primary key check (handle = lower(handle) and handle !~ '^@'),
  categories  text[] not null default '{}',
  written     text,
  found       boolean not null default false,
  last_error  text,
  checked_at  timestamptz not null default now()
);

comment on table public.euka_creator_categories is
  'Top TikTok Shop categories per creator handle from Euka market intelligence. found=false records a search that matched nobody. written is the label last put into wurxbase.creators.category.';

create index if not exists euka_creator_categories_checked_idx on public.euka_creator_categories (checked_at);

alter table public.euka_creator_categories enable row level security;

drop policy if exists euka_creator_categories_select on public.euka_creator_categories;
create policy euka_creator_categories_select on public.euka_creator_categories
  for select to authenticated using (public.is_collabs_viewer());

revoke all on table public.euka_creator_categories from anon;
grant select on table public.euka_creator_categories to authenticated;
grant all privileges on table public.euka_creator_categories to service_role;

-- ---------------------------------------------------------------- the cycle --
-- Same shape as collab_gmv_run_cycle, posting {"categories": true} to the same function.
create or replace function public.collab_category_run_cycle()
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

  if v_secret is null or v_url is null then
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := '{"categories": true}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.collab_category_run_cycle() from anon, authenticated, public;
grant execute on function public.collab_category_run_cycle() to service_role;

-- Every 10 minutes. A run looks up a few handles Euka has not been asked about (new creators first
-- in line) and writes what it already knows; with nothing due it does nothing.
select cron.unschedule('collab-category-cycle')
where exists (select 1 from cron.job where jobname = 'collab-category-cycle');

select cron.schedule(
  'collab-category-cycle',
  '*/10 * * * *',
  $$ select public.collab_category_run_cycle(); $$
);
