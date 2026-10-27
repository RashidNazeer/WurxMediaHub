-- ============================================================================
-- Backup data: whole-database backups, and putting them back.
-- ============================================================================
-- WHAT THIS IS
--   A backup is a consistent picture of every table the application owns
--   (public, wurxbase and any schema added later) plus the sign-in accounts
--   (auth.users and auth.identities: the emails and password hashes), taken at
--   a single instant and stored, in pieces ("chunks"), in backup.chunks.
--   Restoring puts those pieces back in ONE transaction: all of it or none.
--
-- WHY IT LIVES IN THE DATABASE AND NOT IN THE EDGE FUNCTION
--   An Edge Function gets about two seconds of CPU per request. Reading,
--   parsing and compressing a real database in JavaScript blows through that
--   (measured: killed after 400,000 rows). Postgres has no such limit, takes
--   the snapshot itself, and can do the whole restore atomically inside one
--   function call. The Edge Function is therefore only a gatekeeper: it checks
--   the caller is an admin, re-checks their password, writes the audit log and
--   moves small pages of chunks in and out. Compression and the optional
--   passphrase encryption happen in the admin's own browser.
--
-- WHAT IS NOT IN A BACKUP
--   - The SCHEMA (tables, functions, policies): that is code in this folder.
--     A backup restores DATA into a database that already has the right shape,
--     and says so plainly if the shape differs.
--   - Live sessions and one-time tokens (people simply sign in again).
--   - Secrets: the Vault and Edge Function secrets are not data a backup holds.
--   - Uploaded pictures: they are in Storage, and travel only in a DOWNLOADED
--     backup file (the browser packs them in).
--
-- RULES THAT MATTER
--   1. No foreign keys from the bookkeeping tables to anything. A restore
--      TRUNCATEs every table it restores, and Postgres refuses to truncate a
--      table another table points at. The bookkeeping tables (public.data_backups,
--      public.data_restore_runs) and the whole `backup` schema are left out of
--      every backup and every restore, so the history survives a restore.
--   2. Deny by default. RLS on, no policies, no grants to anon or authenticated.
--      The functions are security definer, owned by postgres, and nobody but
--      the owner can execute them: the Edge Function connects as postgres.
--   3. Counters (sequences) only ever move FORWARD on a restore, because a
--      sequence is the one thing a rollback does not undo. A rehearsal that
--      wound one back would leave the live database reusing ids.
-- ============================================================================

-- ------------------------------------------------------------ bookkeeping ---

create table if not exists public.data_backups (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  finished_at      timestamptz,

  -- Who asked, copied in rather than referenced (rule 1).
  created_by       uuid,
  created_by_email text,

  -- manual          an admin pressed "Back up now"
  -- before_restore  made automatically just before a restore, so it can be undone
  -- uploaded        a backup file an admin brought in from their own computer
  kind             text not null default 'manual'
                     check (kind in ('manual', 'before_restore', 'uploaded')),

  status           text not null default 'running'
                     check (status in ('running', 'ready', 'failed')),
  -- Plain words for what it is doing right now. Shown in the progress panel.
  phase            text,
  note             text check (note is null or length(note) <= 200),

  -- How big the data is, as text, before the browser compresses it.
  size_bytes       bigint,
  -- { "public.brands": 12, "auth.users": 340, ... } and their sum.
  row_counts       jsonb not null default '{}'::jsonb,
  total_rows       bigint not null default 0,

  -- A short hash of every table and column. A restore compares it with the
  -- database as it is now and says so plainly when they differ.
  schema_fingerprint text,

  -- A download needs the admin's password again; passing that check mints a
  -- short-lived ticket, kept here as a hash, that the page requests carry.
  ticket_hash      text,
  ticket_expires   timestamptz,

  error            text
);

comment on table public.data_backups is
  'One row per whole-database backup. The data is in backup.chunks. No foreign keys and left out of every backup on purpose. Edge Function only.';

create index if not exists data_backups_created_idx
  on public.data_backups (created_at desc);

create table if not exists public.data_restore_runs (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,

  started_by       uuid,
  started_by_email text,

  backup_id        uuid,
  -- Restore the sign-in accounts too? (Normally yes.)
  accounts         boolean not null default true,

  -- A rehearsal runs the whole restore and then rolls it back, so an admin can
  -- learn whether a restore WOULD work without changing anything.
  dry_run          boolean not null default false,

  status           text not null default 'running'
                     check (status in ('running', 'succeeded', 'failed')),
  phase            text,

  -- The "before restore" safety copy, so the screen can offer to undo it.
  safety_backup_id uuid,

  -- What was put back, table by table, and anything worth warning about.
  result           jsonb not null default '{}'::jsonb,
  error            text
);

comment on table public.data_restore_runs is
  'One row per restore attempt, including rehearsals (dry_run). No foreign keys and left out of every backup on purpose. Edge Function only.';

create index if not exists data_restore_runs_started_idx
  on public.data_restore_runs (started_at desc);

alter table public.data_backups enable row level security;
alter table public.data_restore_runs enable row level security;
-- No policies on purpose. With RLS on and no policy, every request through
-- PostgREST reads nothing and writes nothing, whatever role it carries.

revoke all on table public.data_backups from anon, authenticated;
revoke all on table public.data_restore_runs from anon, authenticated;

-- "Automatically expose new tables" is OFF, which also withholds the default
-- grants to service_role, so they are given here or the function sees nothing.
grant all privileges on table public.data_backups to service_role;
grant all privileges on table public.data_restore_runs to service_role;

-- ---------------------------------------------------------------- chunks ---
-- The data itself. One row per piece of the file: a `head` (which tables and
-- columns the backup holds), many `rows` (up to 500 rows of one table, as a
-- JSON array kept as TEXT so 19-digit TikTok ids are never rounded), and an
-- `end` (what every table should add up to). `hash` is the SHA-256 of
-- `payload`, checked when the chunk arrives and again before any restore.

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table if not exists backup.chunks (
  backup_id uuid    not null,
  seq       integer not null,
  kind      text    not null check (kind in ('head', 'rows', 'end')),
  table_id  text,
  n         integer not null default 0,
  hash      text    not null,
  payload   text    not null,
  primary key (backup_id, seq)
);

comment on table backup.chunks is
  'The pieces of every backup. Deny by default; only the functions in this schema, run by the Edge Function as postgres, touch it.';

alter table backup.chunks enable row level security;
revoke all on table backup.chunks from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers ---

-- Every table a backup covers, with its columns, as one JSON array.
create or replace function backup.introspect(p_accounts boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(t order by (t ->> 'ord')::int), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',     n.nspname || '.' || c.relname,
      'schema', n.nspname,
      'name',   c.relname,
      'oid',    c.oid::int,
      'ord',    row_number() over (
                  order by (n.nspname = 'auth') desc,
                           (n.nspname = 'auth' and c.relname = 'users') desc,
                           n.nspname, c.relname),
      'columns', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'name', a.attname,
                 'type', format_type(a.atttypid, a.atttypmod),
                 'generated', a.attgenerated <> '',
                 'identity', a.attidentity::text,
                 'sequence', case when a.attidentity <> '' or a.atthasdef
                   then pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) end
               ) order by a.attnum), '[]'::jsonb)
        from pg_attribute a
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
    ) as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and not c.relispartition
      and (
            -- the accounts: a sign-in identity points at its account
            (n.nspname = 'auth' and p_accounts and c.relname in ('users', 'identities'))
         or (    n.nspname <> all (array[
                   'information_schema', 'auth', 'storage', 'extensions', 'cron', 'net', 'vault',
                   'supabase_functions', 'supabase_migrations', 'realtime', '_realtime', 'graphql',
                   'graphql_public', 'pgsodium', 'pgsodium_masks', 'pgbouncer', '_analytics',
                   '_supabase', 'pgmq', 'backup'])
             and left(n.nspname, 3) <> 'pg_'
             and (n.nspname || '.' || c.relname) <> all (array['public.data_backups', 'public.data_restore_runs'])
             and pg_get_userbyid(c.relowner) = current_user)
      )
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  ) s
$$;

-- A short fingerprint of "which tables and columns exist".
create or replace function backup.fingerprint(p_tables jsonb)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select left(encode(sha256(convert_to(coalesce(string_agg(line, E'\n' order by line), ''), 'UTF8')), 'hex'), 16)
  from (
    select (t ->> 'id') || '(' || coalesce((
             select string_agg((c.v ->> 'name') || ':' || (c.v ->> 'type'), ',' order by c.o)
             from jsonb_array_elements(t -> 'columns') with ordinality as c(v, o)
             where not (c.v ->> 'generated')::boolean), '') || ')' as line
    from jsonb_array_elements(p_tables) t
  ) s
$$;

create or replace function backup.sha(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to(p_text, 'UTF8')), 'hex') $$;

-- ------------------------------------------------------------------- make ---
-- Write a backup into backup.chunks. MUST run inside one REPEATABLE READ
-- transaction, which is what makes the picture a single instant: whatever people
-- do while it runs, a restored copy never has a row pointing at something that
-- was deleted a second later. The caller starts that transaction.

create or replace function backup.make(p_backup_id uuid, p_accounts boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tables jsonb;
  v_t      jsonb;
  v_head   jsonb;
  v_seq    integer := 0;
  v_added  integer;
  v_rows   jsonb := '{}'::jsonb;
  v_n      bigint;
  v_total  bigint := 0;
  v_fp     text;
  v_bytes  bigint;
  v_live   bigint;
begin
  if current_setting('transaction_isolation') <> 'repeatable read' then
    raise exception 'A backup has to run in one repeatable-read transaction so it sees a single moment.'
      using errcode = 'BK001';
  end if;

  perform set_config('timezone', 'UTC', true);
  perform set_config('extra_float_digits', '3', true);

  v_tables := backup.introspect(p_accounts);
  if p_accounts and not exists (select 1 from jsonb_array_elements(v_tables) x where x ->> 'id' = 'auth.users') then
    raise exception 'The sign-in accounts (auth.users) could not be read, so this would not be a complete backup.'
      using errcode = 'BK004';
  end if;
  v_fp := backup.fingerprint(v_tables);

  v_head := jsonb_build_object(
    'k', 'head', 'v', 2, 'app', 'prism',
    'created_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'server_version', current_setting('server_version'),
    'schema_fingerprint', v_fp,
    'accounts', p_accounts,
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t ->> 'id',
               'columns', (select coalesce(jsonb_agg(jsonb_build_object('name', c ->> 'name', 'type', c ->> 'type')), '[]'::jsonb)
                           from jsonb_array_elements(t -> 'columns') c
                           where not (c ->> 'generated')::boolean))
             order by (t ->> 'ord')::int), '[]'::jsonb)
      from jsonb_array_elements(v_tables) t),
    'sequences', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'seq', s.schemaname || '.' || s.sequencename, 'last', s.last_value::text)), '[]'::jsonb)
      from pg_sequences s
      where s.schemaname <> all (array['information_schema', 'auth', 'storage', 'extensions', 'cron', 'net',
              'vault', 'supabase_functions', 'supabase_migrations', 'realtime', '_realtime', 'graphql',
              'graphql_public', 'pgsodium', 'pgsodium_masks', 'pgbouncer', '_analytics', '_supabase', 'pgmq', 'backup'])
        and left(s.schemaname, 3) <> 'pg_')
  );

  v_seq := v_seq + 1;
  insert into backup.chunks (backup_id, seq, kind, table_id, n, hash, payload)
  values (p_backup_id, v_seq, 'head', null, 0, backup.sha(v_head::text), v_head::text);

  for v_t in select value from jsonb_array_elements(v_tables) loop
    -- Number the rows, group them 500 at a time, glue each group into one JSON
    -- array of text. The rows never become JSON values the database has to
    -- re-render: they stay exactly as to_jsonb printed them.
    execute format($q$
      insert into backup.chunks (backup_id, seq, kind, table_id, n, hash, payload)
      select %L::uuid, %s + g.g + 1, 'rows', %L, g.c, backup.sha(g.p), g.p
      from (
        select s.g, count(*)::int as c, '[' || string_agg(s.j, ',') || ']' as p
        -- the alias is odd on purpose: a table with a column called "t" would otherwise be backed up
        -- as that one column (to_jsonb(t) would mean the column, not the row)
        from (select to_jsonb(bk_row_)::text as j, ((row_number() over ()) - 1) / 500 as g from %I.%I as bk_row_) s
        group by s.g
      ) g
    $q$, p_backup_id, v_seq, v_t ->> 'id', v_t ->> 'schema', v_t ->> 'name');
    get diagnostics v_added = row_count;
    v_seq := v_seq + v_added;

    select coalesce(sum(n), 0) into v_n from backup.chunks
     where backup_id = p_backup_id and kind = 'rows' and table_id = v_t ->> 'id';
    -- NEVER trust the copy: in the same snapshot, the table must hold exactly as many rows as were written
    execute format('select count(*) from %I.%I', v_t ->> 'schema', v_t ->> 'name') into v_live;
    if v_live <> v_n then
      raise exception 'The backup of % did not match the table (% rows written, % in the table), so it was thrown away. Nothing was changed.',
        v_t ->> 'id', v_n, v_live using errcode = 'BK004';
    end if;
    -- and every one of those rows must be a whole row, never a bare value
    if exists (select 1 from backup.chunks c, jsonb_array_elements(c.payload::jsonb) e
                where c.backup_id = p_backup_id and c.kind = 'rows' and c.table_id = v_t ->> 'id'
                  and jsonb_typeof(e) <> 'object') then
      raise exception 'The backup of % contained something that is not a whole row, so it was thrown away. Nothing was changed.',
        v_t ->> 'id' using errcode = 'BK004';
    end if;
    v_rows := v_rows || jsonb_build_object(v_t ->> 'id', v_n);
    v_total := v_total + v_n;
  end loop;

  v_seq := v_seq + 1;
  insert into backup.chunks (backup_id, seq, kind, table_id, n, hash, payload)
  values (p_backup_id, v_seq, 'end', null, 0,
          backup.sha(jsonb_build_object('k', 'end', 'rows', v_rows, 'total_rows', v_total, 'files', 0,
                                        'file_bytes', 0, 'files_skipped', 0)::text),
          jsonb_build_object('k', 'end', 'rows', v_rows, 'total_rows', v_total, 'files', 0,
                             'file_bytes', 0, 'files_skipped', 0)::text);

  select coalesce(sum(length(payload)), 0) into v_bytes from backup.chunks where backup_id = p_backup_id;

  return jsonb_build_object('rows', v_rows, 'total_rows', v_total, 'schema_fingerprint', v_fp,
                            'chunks', v_seq, 'bytes', v_bytes);
end;
$$;

-- ----------------------------------------------------------------- verify ---
-- Is this backup whole and undamaged? Also reads out the few facts the screen
-- and the safety checks need (who the admins are, which accounts exist).

create or replace function backup.verify(p_backup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head     jsonb;
  v_end      jsonb;
  v_problems jsonb := '[]'::jsonb;
  v_counts   jsonb := '{}'::jsonb;
  r          record;
  v_t        jsonb;
  v_promised bigint;
  v_have     bigint;
  v_total    bigint := 0;
  v_users    jsonb;
  v_idents   jsonb;
  v_admins   jsonb;
  v_roles    jsonb;
begin
  select payload::jsonb into v_head from backup.chunks where backup_id = p_backup_id and kind = 'head';
  select payload::jsonb into v_end  from backup.chunks where backup_id = p_backup_id and kind = 'end';
  if v_head is null then
    return jsonb_build_object('problems', jsonb_build_array('This backup has no table list, so it cannot be complete.'));
  end if;
  if v_end is null then
    v_problems := v_problems || to_jsonb('The backup is cut short: its closing piece is missing.'::text);
  end if;

  -- every piece must match its own fingerprint
  for r in select seq, table_id from backup.chunks
            where backup_id = p_backup_id and backup.sha(payload) <> hash loop
    v_problems := v_problems || to_jsonb(('A piece of ' || coalesce(r.table_id, 'the backup') || ' failed its integrity check.')::text);
  end loop;

  -- every row must be a whole row
  for r in select c.seq, c.table_id from backup.chunks c
            where c.backup_id = p_backup_id and c.kind = 'rows'
              and exists (select 1 from jsonb_array_elements(c.payload::jsonb) e where jsonb_typeof(e) <> 'object') loop
    v_problems := v_problems || to_jsonb(('A piece of ' || coalesce(r.table_id, 'the backup') || ' is not made of whole rows.')::text);
  end loop;

  -- every table must hold what the footer says
  for v_t in select value from jsonb_array_elements(v_head -> 'tables') loop
    select coalesce(sum(n), 0) into v_have from backup.chunks
     where backup_id = p_backup_id and kind = 'rows' and table_id = v_t ->> 'id';
    v_counts := v_counts || jsonb_build_object(v_t ->> 'id', v_have);
    v_total := v_total + v_have;
    if v_end is not null then
      v_promised := coalesce((v_end -> 'rows' ->> (v_t ->> 'id'))::bigint, 0);
      if v_promised <> v_have then
        v_problems := v_problems || to_jsonb(((v_t ->> 'id') || ' should hold ' || v_promised || ' rows but the backup has ' || v_have || '.')::text);
      end if;
    end if;
  end loop;

  select coalesce(jsonb_agg(distinct e ->> 'id'), '[]'::jsonb) into v_users
    from backup.chunks c, jsonb_array_elements(c.payload::jsonb) e
   where c.backup_id = p_backup_id and c.table_id = 'auth.users';
  select coalesce(jsonb_agg(distinct e ->> 'id'), '[]'::jsonb) into v_idents
    from backup.chunks c, jsonb_array_elements(c.payload::jsonb) e
   where c.backup_id = p_backup_id and c.table_id = 'auth.identities';
  select coalesce(jsonb_agg(distinct e ->> 'id'), '[]'::jsonb) into v_admins
    from backup.chunks c, jsonb_array_elements(c.payload::jsonb) e
   where c.backup_id = p_backup_id and c.table_id = 'public.profiles'
     and e ->> 'role' = 'admin' and coalesce((e ->> 'is_active')::boolean, true);
  select coalesce(jsonb_object_agg(role, cnt), '{}'::jsonb) into v_roles from (
    select coalesce(e ->> 'role', '') as role, count(*) as cnt
      from backup.chunks c, jsonb_array_elements(c.payload::jsonb) e
     where c.backup_id = p_backup_id and c.table_id = 'public.profiles'
     group by 1) x;

  return jsonb_build_object(
    'problems', v_problems, 'rows', v_counts, 'total_rows', v_total,
    'user_ids', v_users, 'identity_ids', v_idents, 'admin_ids', v_admins, 'profile_roles', v_roles,
    'head', v_head, 'end', v_end);
end;
$$;

-- ------------------------------------------------------------------ apply ---
-- Put a backup back. ONE call, so one transaction: all of it or none of it.
--
--   1. user triggers are switched off, so restoring a row does not also
--      "update" it, re-stamp updated_at or write audit rows of its own;
--   2. foreign keys are made deferrable and checked all at once at the end,
--      which makes insert order (and cycles, and self references) irrelevant;
--   3. every table in the backup is emptied and refilled; tables the backup
--      has never heard of are left exactly as they are;
--   4. the sign-in accounts are brought back (and any account made after the
--      backup is removed);
--   5. row counts are checked against the backup's own footer;
--   6. every trigger and constraint is put back exactly as it was found.
--
-- A rehearsal (p_dry_run) does all of that and then rolls it back on purpose:
-- the answer is exactly what a real restore would have done, and nothing moves.
-- Raising BK0RH inside the inner block rolls back that block and ONLY it.

create or replace function backup.apply(
  p_backup_id uuid,
  p_accounts  boolean default true,
  p_dry_run   boolean default false,
  p_actor     uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ver      jsonb;
  v_head     jsonb;
  v_cur      jsonb;
  v_t        jsonb;
  v_user_ids uuid[];
  v_ident_ids uuid[];
  v_warnings jsonb := '[]'::jsonb;
  v_missing  jsonb := '[]'::jsonb;
  v_untouched jsonb := '[]'::jsonb;
  v_dropped  jsonb := '[]'::jsonb;
  v_added    jsonb := '[]'::jsonb;
  v_acc      jsonb := null;
  v_removed  integer := 0;
  v_users_back integer := 0;
  v_trig     jsonb := '[]'::jsonb;
  v_fks      jsonb := '[]'::jsonb;
  v_result   jsonb;
  v_tables   jsonb := '[]'::jsonb;
  r          record;
  k          record;
  v_n        bigint;
  v_list     text;
  v_cols     text;
  v_set      text;
  v_max      bigint;
  v_now      bigint;
  v_target   bigint;
  v_last     bigint;
  v_first_data boolean := true;
  v_rolled   boolean := false;
  v_truncate text;
begin
  if not pg_try_advisory_xact_lock(727274001) then
    raise exception 'Another backup or restore is already running. Try again in a minute.' using errcode = 'BK002';
  end if;

  -- ---------------------------------------------------------- the backup --
  v_ver := backup.verify(p_backup_id);
  if jsonb_array_length(v_ver -> 'problems') > 0 then
    raise exception 'This backup is damaged and was not restored. %', v_ver -> 'problems' ->> 0
      using errcode = 'BK003';
  end if;
  v_head := v_ver -> 'head';

  if p_accounts and not coalesce((v_head ->> 'accounts')::boolean, false) then
    raise exception 'This backup does not contain the sign-in accounts.' using errcode = 'BK004';
  end if;
  if p_accounts and jsonb_array_length(v_ver -> 'user_ids') = 0 then
    raise exception 'This backup has no accounts in it. Restoring it would remove everyone.' using errcode = 'BK004';
  end if;
  if p_actor is not null
     and exists (select 1 from jsonb_array_elements(v_head -> 'tables') as ht(v) where ht.v ->> 'id' = 'public.profiles')
     and not ((v_ver -> 'admin_ids') ? p_actor::text) then
    raise exception 'The account you are signed in with is not an active admin in this backup. Restoring it would lock you out, so nothing was changed.'
      using errcode = 'BK004';
  end if;

  select coalesce(array_agg(u.v::uuid), '{}') into v_user_ids from jsonb_array_elements_text(v_ver -> 'user_ids') as u(v);
  select coalesce(array_agg(i.v::uuid), '{}') into v_ident_ids from jsonb_array_elements_text(v_ver -> 'identity_ids') as i(v);

  -- ------------------------------------------------------------- the plan --
  -- A table is restored when it is in BOTH the backup and this database.
  -- Every set-returning function below carries an explicit alias AND column
  -- alias (as t(v)): an unaliased `value` in a subquery silently hides an outer
  -- one, which is how a "table the backup does not know" once went unreported.
  v_cur := backup.introspect(p_accounts);

  create temporary table if not exists bk_plan (
    id text primary key, schema_name text, table_name text, oid oid, ord int,
    cols text[], identity_always boolean, backup_rows bigint, before_rows bigint
  ) on commit drop;
  create temporary table if not exists bk_head_cols (tbl text, col text) on commit drop;
  create temporary table if not exists bk_cur_cols (
    tbl text, col text, ord bigint, generated boolean, identity text, seq text
  ) on commit drop;
  delete from pg_temp.bk_plan;
  delete from pg_temp.bk_head_cols;
  delete from pg_temp.bk_cur_cols;

  insert into pg_temp.bk_head_cols
  select ht.v ->> 'id', hc.v ->> 'name'
    from jsonb_array_elements(v_head -> 'tables') as ht(v),
         jsonb_array_elements(ht.v -> 'columns') as hc(v);

  insert into pg_temp.bk_cur_cols
  select ct.v ->> 'id', cc.v ->> 'name', cc.o, (cc.v ->> 'generated')::boolean, cc.v ->> 'identity', cc.v ->> 'sequence'
    from jsonb_array_elements(v_cur) as ct(v),
         jsonb_array_elements(ct.v -> 'columns') with ordinality as cc(v, o);

  insert into pg_temp.bk_plan
  select ct.v ->> 'id', ct.v ->> 'schema', ct.v ->> 'name', (ct.v ->> 'oid')::oid, (ct.v ->> 'ord')::int,
         coalesce((select array_agg(c.col order by c.ord)
                     from pg_temp.bk_cur_cols c
                    where c.tbl = ct.v ->> 'id' and not c.generated
                      and exists (select 1 from pg_temp.bk_head_cols h where h.tbl = c.tbl and h.col = c.col)), '{}'),
         exists (select 1 from pg_temp.bk_cur_cols c
                  where c.tbl = ct.v ->> 'id' and c.identity = 'a'
                    and exists (select 1 from pg_temp.bk_head_cols h where h.tbl = c.tbl and h.col = c.col)),
         coalesce((v_ver -> 'rows' ->> (ct.v ->> 'id'))::bigint, 0), 0
    from jsonb_array_elements(v_cur) as ct(v)
   where exists (select 1 from jsonb_array_elements(v_head -> 'tables') as ht(v) where ht.v ->> 'id' = ct.v ->> 'id');

  -- in the backup, gone from this database: their rows cannot come back
  select coalesce(jsonb_agg(ht.v ->> 'id'), '[]'::jsonb) into v_missing
    from jsonb_array_elements(v_head -> 'tables') as ht(v)
   where not exists (select 1 from jsonb_array_elements(v_cur) as ct(v) where ct.v ->> 'id' = ht.v ->> 'id');
  for r in select m.v as id from jsonb_array_elements_text(v_missing) as m(v) loop
    if coalesce((v_ver -> 'rows' ->> r.id)::bigint, 0) > 0 then
      v_warnings := v_warnings || to_jsonb((r.id || ' no longer exists in this version of Prism, so its '
        || (v_ver -> 'rows' ->> r.id) || ' rows were not restored.')::text);
    end if;
  end loop;

  -- in this database, not in the backup: left exactly as they are
  select coalesce(jsonb_agg(ct.v ->> 'id'), '[]'::jsonb) into v_untouched
    from jsonb_array_elements(v_cur) as ct(v)
   where not exists (select 1 from jsonb_array_elements(v_head -> 'tables') as ht(v) where ht.v ->> 'id' = ct.v ->> 'id');

  -- columns the backup has that this database no longer has: values dropped
  select coalesce(jsonb_agg(jsonb_build_object('table', d.tbl, 'columns', d.cols)), '[]'::jsonb) into v_dropped
    from (select h.tbl, jsonb_agg(h.col) as cols
            from pg_temp.bk_head_cols h
           where exists (select 1 from pg_temp.bk_plan p where p.id = h.tbl)
             and not exists (select 1 from pg_temp.bk_cur_cols c where c.tbl = h.tbl and c.col = h.col and not c.generated)
           group by h.tbl) d;
  for r in select x.v ->> 'table' as tbl, x.v -> 'columns' as cols from jsonb_array_elements(v_dropped) as x(v) loop
    v_warnings := v_warnings || to_jsonb((r.tbl || ': the columns '
      || (select string_agg(cn.v, ', ') from jsonb_array_elements_text(r.cols) as cn(v))
      || ' no longer exist, so their values were not restored.')::text);
  end loop;

  -- columns this database has that the backup lacks: they get their default
  select coalesce(jsonb_agg(jsonb_build_object('table', a.tbl, 'columns', a.cols)), '[]'::jsonb) into v_added
    from (select c.tbl, jsonb_agg(c.col) as cols
            from pg_temp.bk_cur_cols c
           where exists (select 1 from pg_temp.bk_plan p where p.id = c.tbl) and not c.generated
             and not exists (select 1 from pg_temp.bk_head_cols h where h.tbl = c.tbl and h.col = c.col)
           group by c.tbl) a;

  -- A table that is NOT in the backup but points at one that is would be wiped
  -- by the truncate (or block it). Say so instead of destroying it.
  select cf.relname as child, cp.relname as parent into k
    from pg_constraint con
    join pg_class cf on cf.oid = con.conrelid
    join pg_class cp on cp.oid = con.confrelid
   where con.contype = 'f'
     and con.confrelid in (select oid from pg_temp.bk_plan where schema_name <> 'auth')
     and con.conrelid not in (select oid from pg_temp.bk_plan where schema_name <> 'auth')
   limit 1;
  if found then
    raise exception 'The table % is not in this backup but depends on %, which is. This backup is from before % existed. Nothing was changed.',
      k.child, k.parent, k.child using errcode = 'BK004';
  end if;

  -- what is being replaced
  for r in select id, schema_name, table_name from pg_temp.bk_plan where schema_name <> 'auth' loop
    execute format('select count(*) from %I.%I', r.schema_name, r.table_name) into v_n;
    update pg_temp.bk_plan set before_rows = v_n where id = r.id;
  end loop;

  select string_agg(format('%I.%I', schema_name, table_name), ', ' order by ord) into v_truncate
    from pg_temp.bk_plan where schema_name <> 'auth';

  -- ---------------------------------------- everything that can be undone --
  begin
    perform set_config('timezone', 'UTC', true);

    -- 1. switch off user triggers, remembering how each one was set
    select coalesce(jsonb_agg(jsonb_build_object('schema', p.schema_name, 'table', p.table_name, 'name', t.tgname, 'state', t.tgenabled::text)), '[]')
      into v_trig
      from pg_trigger t join pg_temp.bk_plan p on p.oid = t.tgrelid
     where not t.tgisinternal and p.schema_name <> 'auth';
    for r in select distinct (x ->> 'schema') as s, (x ->> 'table') as t from jsonb_array_elements(v_trig) x loop
      execute format('alter table %I.%I disable trigger user', r.s, r.t);
    end loop;

    -- 2. foreign keys: deferred until the very end
    select coalesce(jsonb_agg(jsonb_build_object('schema', p.schema_name, 'table', p.table_name, 'name', con.conname,
             'deferrable', con.condeferrable, 'deferred', con.condeferred)), '[]')
      into v_fks
      from pg_constraint con join pg_temp.bk_plan p on p.oid = con.conrelid
     where con.contype = 'f' and p.schema_name <> 'auth';
    for r in select x ->> 'schema' as s, x ->> 'table' as t, x ->> 'name' as c from jsonb_array_elements(v_fks) x
              where not ((x ->> 'deferrable')::boolean and (x ->> 'deferred')::boolean) loop
      execute format('alter table %I.%I alter constraint %I deferrable initially deferred', r.s, r.t, r.c);
    end loop;

    -- 3. empty what we are about to refill. Postgres will not truncate a table
    --    that has deferred checks waiting, so settle them first.
    if v_truncate is not null then
      execute 'set constraints all immediate';
      execute 'set constraints all deferred';
      execute 'truncate table ' || v_truncate;
    end if;

    -- 4. accounts
    if p_accounts then
      with gone as (delete from auth.users where not (id = any (v_user_ids)) returning 1)
        select count(*) into v_removed from gone;
      if exists (select 1 from pg_temp.bk_plan where id = 'auth.identities') then
        delete from auth.identities where not (id = any (v_ident_ids));
      end if;
      for k in select c.seq, c.table_id, c.payload, p.cols, p.schema_name, p.table_name
                 from backup.chunks c join pg_temp.bk_plan p on p.id = c.table_id
                where c.backup_id = p_backup_id and c.kind = 'rows' and p.schema_name = 'auth'
                order by (c.table_id = 'auth.users') desc, c.seq loop
        v_cols := (select string_agg(format('%I', x), ', ') from unnest(k.cols) x);
        v_set  := (select string_agg(format('%I = excluded.%I', x, x), ', ') from unnest(k.cols) x where x <> 'id');
        execute format('insert into %I.%I (%s) select %s from jsonb_populate_recordset(null::%I.%I, $1::jsonb) on conflict (id) do update set %s',
                       k.schema_name, k.table_name, v_cols, v_cols, k.schema_name, k.table_name, v_set)
          using k.payload;
        if k.table_id = 'auth.users' then v_users_back := v_users_back + (select jsonb_array_length(k.payload::jsonb)); end if;
      end loop;
      v_acc := jsonb_build_object('restored', v_users_back, 'removed', v_removed);

      -- A sign-up trigger may have just created profiles. Empty again so the
      -- backup's own rows go into clean tables.
      if v_truncate is not null then
        execute 'set constraints all immediate';
        execute 'set constraints all deferred';
        execute 'truncate table ' || v_truncate;
      end if;
    end if;

    -- 5. the rows
    for k in select c.seq, c.table_id, c.payload, p.cols, p.schema_name, p.table_name, p.identity_always
               from backup.chunks c join pg_temp.bk_plan p on p.id = c.table_id
              where c.backup_id = p_backup_id and c.kind = 'rows' and p.schema_name <> 'auth'
                and cardinality(p.cols) > 0
              order by c.seq loop
      v_cols := (select string_agg(format('%I', x), ', ') from unnest(k.cols) x);
      execute format('insert into %I.%I (%s)%s select %s from jsonb_populate_recordset(null::%I.%I, $1::jsonb)',
                     k.schema_name, k.table_name, v_cols,
                     case when k.identity_always then ' overriding system value' else '' end,
                     v_cols, k.schema_name, k.table_name)
        using k.payload;
    end loop;

    -- 6. counters only ever move forward
    for r in
      select p.schema_name, p.table_name, cc.col, cc.seq
        from pg_temp.bk_plan p
        join pg_temp.bk_cur_cols cc on cc.tbl = p.id
       where p.schema_name <> 'auth' and cc.seq is not null
    loop
      execute format('select coalesce(max(%I), 0) from %I.%I', r.col, r.schema_name, r.table_name) into v_max;
      select coalesce(s.last_value, 0) into v_now from pg_sequences s
       where format('%I.%I', s.schemaname, s.sequencename) = r.seq;
      v_last := coalesce((select nullif(sq.v ->> 'last', '')::bigint from jsonb_array_elements(v_head -> 'sequences') as sq(v) where sq.v ->> 'seq' = r.seq), 0);
      v_target := greatest(v_max, v_last);
      if v_target > coalesce(v_now, 0) then
        perform setval(r.seq::regclass, v_target, true);
      end if;
    end loop;

    -- 7. does everything fit together?
    begin
      execute 'set constraints all immediate';
    exception when others then
      raise exception 'The backup does not fit this database: % Nothing was changed.', sqlerrm using errcode = 'BK004';
    end;
    for r in select id, schema_name, table_name, backup_rows from pg_temp.bk_plan where schema_name <> 'auth' loop
      execute format('select count(*) from %I.%I', r.schema_name, r.table_name) into v_n;
      if v_n <> r.backup_rows then
        raise exception '% came back with % rows but the backup holds %. Nothing was changed.', r.id, v_n, r.backup_rows
          using errcode = 'BK004';
      end if;
    end loop;

    -- 8. put every setting back exactly as it was
    for r in select x ->> 'schema' as s, x ->> 'table' as t, x ->> 'name' as c, (x ->> 'deferrable')::boolean as d
               from jsonb_array_elements(v_fks) x
              where not ((x ->> 'deferrable')::boolean and (x ->> 'deferred')::boolean) loop
      execute format('alter table %I.%I alter constraint %I %s', r.s, r.t, r.c,
                     case when r.d then 'deferrable initially immediate' else 'not deferrable' end);
    end loop;
    for r in select distinct (x ->> 'schema') as s, (x ->> 'table') as t from jsonb_array_elements(v_trig) x loop
      execute format('alter table %I.%I enable trigger user', r.s, r.t);
    end loop;
    for r in select x ->> 'schema' as s, x ->> 'table' as t, x ->> 'name' as n, x ->> 'state' as st from jsonb_array_elements(v_trig) x
              where x ->> 'state' <> 'O' loop
      execute format('alter table %I.%I %s trigger %I', r.s, r.t,
                     case r.st when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' else 'enable' end, r.n);
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'before', before_rows, 'restored', backup_rows) order by ord), '[]')
      into v_tables from pg_temp.bk_plan where schema_name <> 'auth';

    v_result := jsonb_build_object(
      'dry_run', p_dry_run, 'tables', v_tables, 'accounts', v_acc,
      'schema', jsonb_build_object('missingHere', v_missing, 'untouched', v_untouched,
                                   'droppedColumns', v_dropped, 'newColumns', v_added),
      'warnings', v_warnings,
      'backup', jsonb_build_object(
        'created_at', v_head ->> 'created_at', 'total_rows', v_ver -> 'total_rows',
        'profile_roles', v_ver -> 'profile_roles', 'server_version', v_head ->> 'server_version',
        'same_shape', (v_head ->> 'schema_fingerprint') = backup.fingerprint(v_cur)));

    if p_dry_run then
      raise exception 'rehearsal' using errcode = 'BK0RH';
    end if;
  exception when sqlstate 'BK0RH' then
    v_rolled := true;   -- everything above is undone; the result is kept
  end;

  return v_result;
end;
$$;

-- ------------------------------------------------------------------- jobs ---
-- A backup or a restore can take a minute or more. It must not depend on the
-- Edge Function staying alive for that long: the platform retires function
-- isolates for CPU and time, and a job lost that way leaves a restore
-- half-announced and nobody sure what happened. So the Edge Function only
-- SCHEDULES the work, and Postgres itself runs it (pg_cron, one second later,
-- as its own session). The browser can be closed; the job carries on and writes
-- its own result into the same rows the screen reads.
--
--   backup:   one job, in a repeatable-read transaction (one instant)
--   restore:  job 1 saves a safety copy of today's data (also repeatable-read),
--             then schedules job 2, which does the restore. They are separate
--             transactions on purpose: a restore must not run in a repeatable-
--             read snapshot, or a login a moment ago would make it fail to
--             serialise.
--   rehearsal: job 2 only, with nothing to roll back.
--
-- Every job unschedules ITSELF as its first act, so it runs exactly once.

-- Plain words for whatever went wrong. Our own errors (BKnnn) already are.
create or replace function backup.explain(p_state text, p_msg text, p_restore boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_state like 'BK%' then p_msg
    when p_msg ~* 'permission denied.*(auth|users|identities)'
      then 'The database would not let Prism read or change the sign-in accounts.'
           || case when p_restore then ' Nothing was changed.' else '' end
    else case when p_restore then 'The restore stopped and nothing was changed. '
              else 'The backup could not be finished. ' end
         || 'Details: ' || left(p_msg, 300)
  end
$$;

create or replace function backup.audit(
  p_actor uuid, p_action text, p_subject uuid, p_detail jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, actor_email, actor_role, action, subject_type, subject_id, detail)
  select p.id, p.email, p.role, p_action, 'backup', p_subject, coalesce(p_detail, '{}'::jsonb)
    from public.profiles p where p.id = p_actor
$$;

-- How many times pg_cron has already started this job. A job whose session is
-- killed (a crash, a restart) is still scheduled afterwards, because its own
-- "unschedule" was rolled back with it, so pg_cron simply runs it again: a restore
-- interrupted by a restart carries on and completes, all or nothing. But a job
-- that dies the same way every time must not retry for ever: after three tries it
-- is given up on, loudly.
create or replace function backup.attempts(p_name text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  if to_regclass('cron.job_run_details') is null then
    return 0;
  end if;
  execute 'select count(*)::int from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = $1'
    into v_n using p_name;
  return coalesce(v_n, 0);
end;
$$;

-- Job 1 (or the only job of a backup): take the snapshot.
create or replace function backup.schedule_make(
  p_backup_id uuid, p_kind text, p_actor uuid, p_run uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'backup-job-' || p_backup_id::text;
begin
  perform cron.schedule(
    v_name, '1 seconds',
    format($c$set statement_timeout = 0; set lock_timeout = '30s';
              set transaction isolation level repeatable read;
              select backup.run_make(%L::uuid, %L, %L::uuid, %L::uuid)$c$,
           p_backup_id, p_kind, p_actor, p_run));
end;
$$;

-- Job 2: the restore itself (or a rehearsal of it). Arguments live on the run row.
create or replace function backup.schedule_apply(p_run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'backup-job-' || p_run::text;
begin
  perform cron.schedule(
    v_name, '1 seconds',
    format($c$set statement_timeout = 0; set lock_timeout = '30s';
              select backup.run_apply(%L::uuid)$c$,
           p_run));
end;
$$;

create or replace function backup.run_make(
  p_id uuid, p_kind text, p_actor uuid, p_run uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res   jsonb;
  v_state text;
  v_msg   text;
  v_row   public.data_backups%rowtype;
  v_tries integer;
begin
  v_tries := backup.attempts('backup-job-' || p_id::text);
  -- Runs once: remove the schedule first thing. If this session is killed, this
  -- is rolled back with it and pg_cron tries again, which is what we want.
  perform cron.unschedule(j.jobname) from cron.job j where j.jobname = 'backup-job-' || p_id::text;
  select * into v_row from public.data_backups where id = p_id;
  if not found or v_row.status <> 'running' then
    return; -- already done (a re-run after a crash that came too late): never do it twice
  end if;
  if v_tries > 3 then
    update public.data_backups set status = 'failed', phase = null, finished_at = now(),
           error = 'The server kept stopping this job, so it was cancelled. Nothing was changed.' where id = p_id;
    if p_run is not null then
      update public.data_restore_runs set status = 'failed', phase = null, finished_at = now(),
             error = 'The server kept stopping the safety copy, so nothing was restored. Nothing was changed.' where id = p_run;
    end if;
    return;
  end if;

  begin
    v_res := backup.make(p_id, true);
    update public.data_backups
       set status = 'ready', phase = null, error = null,
           size_bytes = (v_res ->> 'bytes')::bigint, row_counts = v_res -> 'rows',
           total_rows = (v_res ->> 'total_rows')::bigint,
           schema_fingerprint = v_res ->> 'schema_fingerprint', finished_at = now()
     where id = p_id;
    perform backup.audit(p_actor, 'backup.created', p_id,
      jsonb_build_object('kind', p_kind, 'rows', v_res -> 'total_rows', 'bytes', v_res -> 'bytes'));
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    update public.data_backups
       set status = 'failed', phase = null, finished_at = now(),
           error = backup.explain(v_state, v_msg, false)
     where id = p_id;
    perform backup.audit(p_actor, 'backup.failed', p_id, jsonb_build_object('error', left(v_msg, 300)));
    if p_run is not null then
      update public.data_restore_runs
         set status = 'failed', phase = null, finished_at = now(),
             error = 'A safety copy of the current data could not be saved, so nothing was restored. '
                     || backup.explain(v_state, v_msg, false)
       where id = p_run;
    end if;
    return;
  end;

  -- the safety copy is saved: now the restore itself, as its own job
  if p_run is not null then
    update public.data_restore_runs
       set phase = 'Restoring (this usually takes under a minute)' where id = p_run;
    perform backup.schedule_apply(p_run);
  end if;
end;
$$;

create or replace function backup.run_apply(p_run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run   public.data_restore_runs%rowtype;
  v_res   jsonb;
  v_state text;
  v_msg   text;
  v_tries integer;
begin
  v_tries := backup.attempts('backup-job-' || p_run::text);
  perform cron.unschedule(j.jobname) from cron.job j where j.jobname = 'backup-job-' || p_run::text;
  select * into v_run from public.data_restore_runs where id = p_run;
  if not found or v_run.status <> 'running' then
    return; -- already finished (a re-run after a crash that came too late): never restore twice
  end if;
  if v_tries > 3 then
    update public.data_restore_runs set status = 'failed', phase = null, finished_at = now(),
           error = 'The server kept stopping this restore, so it was cancelled. Nothing was changed.' where id = p_run;
    return;
  end if;

  begin
    v_res := backup.apply(v_run.backup_id, v_run.accounts, v_run.dry_run, v_run.started_by);
    update public.data_restore_runs
       set status = 'succeeded', phase = null, result = v_res, finished_at = now()
     where id = p_run;
    -- The restore replaced the audit log with the backup's own copy, so this
    -- line goes in afterwards, where it will be seen.
    if not v_run.dry_run then
      perform backup.audit(v_run.started_by, 'backup.restored', v_run.backup_id,
        jsonb_build_object('tables', jsonb_array_length(v_res -> 'tables'), 'accounts', v_run.accounts,
                           'safety_backup_id', v_run.safety_backup_id));
    end if;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    update public.data_restore_runs
       set status = 'failed', phase = null, finished_at = now(),
           error = backup.explain(v_state, v_msg, true)
     where id = p_run;
    perform backup.audit(v_run.started_by, 'backup.restore_failed', v_run.backup_id,
      jsonb_build_object('error', left(v_msg, 300), 'dry_run', v_run.dry_run));
  end;
end;
$$;

-- Is a job for this row still scheduled or running?
create or replace function backup.job_alive(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from cron.job where jobname like '%' || p_id::text || '%')
      or exists (select 1 from pg_stat_activity
                  where application_name = 'pg_cron' and query like '%' || p_id::text || '%')
$$;

-- Called whenever the screen lists backups. A job the database no longer has
-- any trace of (the server restarted mid-way, say) is marked failed so it can
-- never block the next backup; one that was scheduled but never started (pg_cron
-- switched off) is cancelled and says so.
create or replace function backup.sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  -- an upload that was started and never finished (the tab was closed)
  update public.data_backups
     set status = 'failed', phase = null, finished_at = now(), error = 'The upload was never finished.'
   where status = 'running' and kind = 'uploaded' and created_at < now() - interval '30 minutes';
  get diagnostics v_n = row_count;

  for r in
    select 'backup' as what, id, created_at as since from public.data_backups
     where status = 'running' and kind <> 'uploaded' and created_at < now() - interval '2 minutes'
    union all
    select 'restore', id, started_at from public.data_restore_runs
     where status = 'running' and started_at < now() - interval '2 minutes'
  loop
    if not backup.job_alive(r.id) then
      if r.what = 'backup' then
        update public.data_backups set status = 'failed', phase = null, finished_at = now(),
               error = 'The server stopped this before it finished. Nothing was changed.' where id = r.id;
      else
        update public.data_restore_runs set status = 'failed', phase = null, finished_at = now(),
               error = 'The server stopped this before it finished. Nothing was changed.' where id = r.id;
      end if;
      v_n := v_n + 1;
    elsif r.since < now() - interval '30 minutes' then
      -- still scheduled but never started, or hung for half an hour: cancel it
      perform cron.unschedule(j.jobname) from cron.job j where j.jobname like '%' || r.id::text || '%';
      if r.what = 'backup' then
        update public.data_backups set status = 'failed', phase = null, finished_at = now(),
               error = 'This took far too long and was cancelled. Nothing was changed.' where id = r.id;
      else
        update public.data_restore_runs set status = 'failed', phase = null, finished_at = now(),
               error = 'This took far too long and was cancelled. Nothing was changed.' where id = r.id;
      end if;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ----------------------------------------------------------- put a chunk ---
-- Bring one piece in (from an uploaded file). The fingerprint is checked here,
-- in the database, so a piece damaged on the way is refused at the door.

create or replace function backup.put_chunk(
  p_backup_id uuid, p_seq integer, p_kind text, p_table text, p_n integer, p_hash text, p_payload text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if backup.sha(p_payload) <> p_hash then
    raise exception 'A piece of the file was damaged on the way (seq %).', p_seq using errcode = 'BK005';
  end if;
  if p_kind = 'rows' and jsonb_array_length(p_payload::jsonb) <> coalesce(p_n, 0) then
    raise exception 'A piece of the file does not hold the number of rows it claims (seq %).', p_seq using errcode = 'BK005';
  end if;
  insert into backup.chunks (backup_id, seq, kind, table_id, n, hash, payload)
  values (p_backup_id, p_seq, p_kind, p_table, coalesce(p_n, 0), p_hash, p_payload)
  on conflict (backup_id, seq) do update
    set kind = excluded.kind, table_id = excluded.table_id, n = excluded.n,
        hash = excluded.hash, payload = excluded.payload;
end;
$$;

create or replace function backup.drop_backup(p_backup_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$ delete from backup.chunks where backup_id = p_backup_id $$;

-- Pieces whose backup is gone, or failed, are rubbish (an upload that was never
-- finished, for one). Cleared whenever the screen lists backups.
create or replace function backup.purge_orphans()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from backup.chunks c
   where not exists (select 1 from public.data_backups b where b.id = c.backup_id and b.status <> 'failed');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function backup.size()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$ select pg_total_relation_size('backup.chunks') $$;

-- Nobody but the owner (postgres, which is what the Edge Function connects as)
-- may run any of these. `public` is where Postgres grants execute by default.
revoke all on function backup.introspect(boolean) from public, anon, authenticated;
revoke all on function backup.fingerprint(jsonb) from public, anon, authenticated;
revoke all on function backup.sha(text) from public, anon, authenticated;
revoke all on function backup.make(uuid, boolean) from public, anon, authenticated;
revoke all on function backup.verify(uuid) from public, anon, authenticated;
revoke all on function backup.apply(uuid, boolean, boolean, uuid) from public, anon, authenticated;
revoke all on function backup.put_chunk(uuid, integer, text, text, integer, text, text) from public, anon, authenticated;
revoke all on function backup.drop_backup(uuid) from public, anon, authenticated;
revoke all on function backup.size() from public, anon, authenticated;
revoke all on function backup.purge_orphans() from public, anon, authenticated;
revoke all on function backup.explain(text, text, boolean) from public, anon, authenticated;
revoke all on function backup.audit(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function backup.schedule_make(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function backup.schedule_apply(uuid) from public, anon, authenticated;
revoke all on function backup.run_make(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function backup.run_apply(uuid) from public, anon, authenticated;
revoke all on function backup.job_alive(uuid) from public, anon, authenticated;
revoke all on function backup.attempts(text) from public, anon, authenticated;
revoke all on function backup.sweep() from public, anon, authenticated;
