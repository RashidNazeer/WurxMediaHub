/**
 * backup-data
 * ---------------------------------------------------------------------------
 * Back up the whole database, and put a backup back.
 *
 * WHAT THIS FUNCTION IS NOT: the thing that does the work. An Edge Function
 * gets about two seconds of CPU per request, and reading a real database in
 * JavaScript blows through that (measured: killed after 400,000 rows). The
 * work is done by Postgres, in the `backup` schema (see the migration
 * 20261027120000_backup_data.sql): `backup.make` takes the snapshot,
 * `backup.verify` checks it, `backup.apply` restores it in ONE transaction.
 * This function only decides WHO may ask, and carries small pages of data in
 * and out. Compression and the optional passphrase happen in the admin's own
 * browser, so the passphrase never reaches this function.
 *
 * ADMIN ONLY, and stricter than the other admin functions: `ops` and
 * `ads_manager` are refused. A backup holds every creator's details, every
 * password hash and the TikTok connection details, so it is held to the
 * narrowest role there is.
 *
 * It follows the same shape as `manage-brand`:
 *   1. Verify the access token with the auth server. Not decode it.
 *   2. Read the caller's role FROM THE PROFILES TABLE, not from a token claim.
 *   3. Validate with Zod.
 *   4. Do the work as service_role / postgres, and write the audit log.
 *
 * Three things on top of that, because this function can erase the database:
 *   - Downloading a backup and restoring one both need the admin's PASSWORD
 *     again. A left-open laptop must not be enough to walk off with every
 *     account or to wipe the data. Wrong tries are counted and locked out.
 *   - A restore needs the word RESTORE typed, and is always preceded by an
 *     automatic safety backup of what is there now.
 *   - A restore can be REHEARSED first (dryRun): it does every step, checks
 *     everything fits, and rolls back. Nothing changes.
 *
 * LONG WORK RUNS IN POSTGRES, NOT HERE. A backup or restore can take a minute
 * or more, and a function isolate can be retired by the platform at any
 * moment (a job lost that way once left a restore announced and never run).
 * So this function only SCHEDULES the job: the database runs it as its own
 * session (pg_cron, a second later), records the outcome in the same rows the
 * screen reads, and unschedules itself. The browser can be closed, and nothing
 * here has to stay alive. The screen polls `backup.list` for the phase.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import postgres from 'npm:postgres@3.4.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';

const MAX_REAUTH_FAILS = 5;
const TICKET_MINUTES = 30;
/** One page of a backup going out. Small, so a request never needs much CPU or memory. */
const PAGE_BYTES = 1_500_000;

// ----------------------------------------------------------------- the input --

const Chunk = z.object({
  seq: z.number().int().min(1).max(10_000_000),
  kind: z.enum(['head', 'rows', 'end']),
  table_id: z.string().max(200).nullable(),
  n: z.number().int().min(0).max(1_000_000),
  hash: z.string().length(64),
  payload: z.string().max(4_000_000),
});

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('backup.list') }),
  z.object({ action: z.literal('backup.create'), note: z.string().trim().max(200).nullish() }),
  z.object({
    action: z.literal('backup.download_start'),
    backupId: z.uuid(),
    password: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal('backup.chunks'),
    backupId: z.uuid(),
    ticket: z.string().length(64),
    afterSeq: z.number().int().min(0),
  }),
  z.object({
    action: z.literal('pictures.list'),
    backupId: z.uuid(),
    ticket: z.string().length(64),
  }),
  z.object({ action: z.literal('backup.upload_start'), note: z.string().trim().max(200).nullish() }),
  z.object({
    action: z.literal('backup.upload_chunks'),
    backupId: z.uuid(),
    chunks: z.array(Chunk).min(1).max(200),
  }),
  z.object({ action: z.literal('backup.upload_finish'), backupId: z.uuid() }),
  z.object({
    action: z.literal('backup.restore'),
    backupId: z.uuid(),
    dryRun: z.boolean(),
    // Only a real restore has to carry these two.
    confirm: z.string().nullish(),
    password: z.string().max(200).nullish(),
    accounts: z.boolean().default(true),
  }),
  z.object({ action: z.literal('backup.delete'), backupId: z.uuid() }),
  z.object({
    action: z.literal('pictures.upload_urls'),
    items: z
      .array(z.object({ bucket: z.string().min(1).max(100), path: z.string().min(1).max(500) }))
      .min(1)
      .max(100),
  }),
]);

// ------------------------------------------------------------------ plumbing --

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Plain words for whatever went wrong. Raw database text is shortened, not hidden. */
function explain(e: unknown, what: 'backup' | 'restore'): string {
  const code = (e as { code?: string } | null)?.code;
  const m = messageOf(e);
  // Our own SQL functions raise errors with a BKnnn code and a sentence written for people.
  if (typeof code === 'string' && code.startsWith('BK')) return m;
  if (/permission denied.*(auth|users|identities)/i.test(m)) {
    return (
      'The database would not let Prism read or change the sign-in accounts.' +
      (what === 'restore' ? ' Nothing was changed.' : '')
    );
  }
  if (/function backup\.\w+.* does not exist|schema "backup" does not exist/i.test(m)) {
    return 'The backup tools are not installed in this database yet. Apply the latest database migration first.';
  }
  return (
    (what === 'restore' ? 'The restore stopped and nothing was changed. ' : 'The backup could not be finished. ') +
    'Details: ' +
    m.slice(0, 300)
  );
}

function connect() {
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) throw new Error('SUPABASE_DB_URL is not available to this function.');
  return postgres(url, { max: 1, prepare: false, idle_timeout: 30, connect_timeout: 30 });
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------- main --

Deno.serve(async (req) => {
  const reply = (body: unknown, status = 200) => json(body, status, req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Not signed in' }, 401);

  // ---------------------------------------------------------- who is this --
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) return reply({ error: 'Not signed in' }, 401);

  // Service role from here on. Nothing above this line was trusted.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('id', userData.user.id)
    .single();
  // While a restore holds its locks (usually seconds, longer for a big database)
  // this lookup can time out. That is the database being busy, NOT the caller
  // being refused, and the screen keeps waiting on a busy answer.
  if (profileErr && profileErr.code !== 'PGRST116') {
    return reply({ error: 'The database is busy for a moment. Try again shortly.', busy: true }, 503);
  }
  if (!profile) return reply({ error: 'Not allowed' }, 403);

  const audit = (action: string, subjectId: string | null, detail: Record<string, unknown> = {}) =>
    admin
      .from('audit_log')
      .insert({
        actor_id: profile.id,
        actor_email: profile.email,
        actor_role: profile.role,
        action,
        subject_type: 'backup',
        subject_id: subjectId,
        detail,
      })
      .then(() => {});

  if (profile.role !== 'admin' || !profile.is_active) {
    await audit('backup.denied', null, { reason: profile.is_active ? 'not an admin' : 'account inactive' });
    return reply({ error: 'Only an admin can use backups.' }, 403);
  }
  const actor = { id: profile.id as string, email: profile.email as string };

  // ------------------------------------------------------------ the input --
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reply({ error: 'Expected a JSON body' }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return reply({ error: parsed.error.issues[0]?.message ?? 'That request is not valid.' }, 400);
  }
  const body = parsed.data;
  console.log(JSON.stringify({ at: new Date().toISOString(), req: body.action }));

  // ---------------------------------------------------------- shared bits --
  const nowMinus = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  /**
   * Housekeeping, run whenever the list is read: a job the database has no trace
   * of any more is marked failed (so it can never block the next one), and
   * pieces of backups that no longer exist are cleared away.
   */
  async function sweepStale() {
    const sql = connect();
    try {
      await sql.unsafe(`select backup.sweep()`);
      await sql.unsafe(`select backup.purge_orphans()`);
    } catch {
      /* the backup tools may not be installed yet; the screen says so on first use */
    } finally {
      await sql.end({ timeout: 2 }).catch(() => {});
    }
  }

  async function somethingIsRunning(): Promise<string | null> {
    const [b, r] = await Promise.all([
      admin.from('data_backups').select('id', { count: 'exact', head: true }).eq('status', 'running').neq('kind', 'uploaded'),
      admin.from('data_restore_runs').select('id', { count: 'exact', head: true }).eq('status', 'running'),
    ]);
    if ((b.count ?? 0) > 0) return 'A backup is already running. Wait for it to finish.';
    if ((r.count ?? 0) > 0) return 'A restore is already running. Wait for it to finish.';
    return null;
  }

  /** Re-check the admin's password. Counts and limits wrong tries. */
  async function passwordIsRight(password: string): Promise<boolean | 'locked'> {
    const { count } = await admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('actor_id', actor.id)
      .eq('action', 'backup.reauth_failed')
      .gte('created_at', nowMinus(15));
    if ((count ?? 0) >= MAX_REAUTH_FAILS) return 'locked';
    const probe = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await probe.auth.signInWithPassword({ email: actor.email, password });
    if (error || data?.user?.id !== actor.id) {
      await audit('backup.reauth_failed', null);
      return false;
    }
    return true;
  }

  const passwordGate = async (password: string | null | undefined) => {
    if (!password) return reply({ error: 'Type your password to continue.' }, 400);
    const ok = await passwordIsRight(password);
    if (ok === 'locked') return reply({ error: 'Too many wrong passwords. Try again in 15 minutes.' }, 429);
    if (!ok) return reply({ error: 'That password is not right.' }, 403);
    return null;
  };

  /** A page request must carry the ticket the password check handed out. */
  async function ticketIsGood(backupId: string, ticket: string): Promise<boolean> {
    const { data } = await admin
      .from('data_backups')
      .select('ticket_hash, ticket_expires, status')
      .eq('id', backupId)
      .single();
    if (!data || data.status !== 'ready' || !data.ticket_hash || !data.ticket_expires) return false;
    if (new Date(data.ticket_expires).getTime() < Date.now()) return false;
    return data.ticket_hash === (await sha256Hex(ticket));
  }

  // ================================================================ create ==
  /** Insert the registry row and return its id. Postgres runs the work (see schedule()). */
  async function startBackup(kind: 'manual' | 'before_restore' | 'uploaded', note: string | null): Promise<string> {
    const { data, error } = await admin
      .from('data_backups')
      .insert({
        kind,
        status: 'running',
        phase: kind === 'uploaded' ? 'Receiving the file' : 'Taking a snapshot of everything',
        note,
        created_by: actor.id,
        created_by_email: actor.email,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error('Could not start the backup: ' + (error?.message ?? 'no row'));
    return data.id as string;
  }

  /** Ask Postgres to run a job. Fast: it only schedules. */
  async function schedule(statement: string, params: unknown[]) {
    const sql = connect();
    try {
      await sql.unsafe(statement, params as never[]);
    } finally {
      await sql.end({ timeout: 2 }).catch(() => {});
    }
  }

  // ================================================================ action ==
  try {
    switch (body.action) {
      // ---------------------------------------------------------------- list --
      case 'backup.list': {
        await sweepStale();
        const [b, r] = await Promise.all([
          admin
            .from('data_backups')
            .select('id, created_at, finished_at, kind, status, phase, note, size_bytes, total_rows, row_counts, created_by_email, error')
            .order('created_at', { ascending: false })
            .limit(60),
          admin
            .from('data_restore_runs')
            .select('id, started_at, finished_at, started_by_email, backup_id, dry_run, status, phase, safety_backup_id, result, error')
            .order('started_at', { ascending: false })
            .limit(15),
        ]);
        let stored = 0;
        const sql = connect();
        try {
stored = Number((await sql.unsafe(`select backup.size()::text as s`))[0]?.s ?? 0);
        } catch {
          /* the tools may not be installed yet; the screen says so on first use */
        } finally {
          await sql.end({ timeout: 2 }).catch(() => {});
        }
        return reply({ backups: b.data ?? [], restores: r.data ?? [], stored_bytes: stored });
      }

      // -------------------------------------------------------------- create --
      case 'backup.create': {
        await sweepStale();
        const busy = await somethingIsRunning();
        if (busy) return reply({ error: busy }, 409);
        const id = await startBackup('manual', body.note?.trim() || null);
        try {
          await schedule(`select backup.schedule_make($1::uuid, 'manual', $2::uuid, null)`, [id, actor.id]);
        } catch (e) {
          await admin
            .from('data_backups')
            .update({ status: 'failed', phase: null, error: explain(e, 'backup'), finished_at: new Date().toISOString() })
            .eq('id', id);
          return reply({ error: explain(e, 'backup') }, 500);
        }
        return reply({ backupId: id }, 202);
      }

      // ---------------------------------------------------------- download --
      case 'backup.download_start': {
        const refused = await passwordGate(body.password);
        if (refused) return refused;
        const { data: row } = await admin.from('data_backups').select('id, status, created_at').eq('id', body.backupId).single();
        if (!row || row.status !== 'ready') return reply({ error: 'That backup is not ready.' }, 404);
        const ticket = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
        await admin
          .from('data_backups')
          .update({
            ticket_hash: await sha256Hex(ticket),
            ticket_expires: new Date(Date.now() + TICKET_MINUTES * 60_000).toISOString(),
          })
          .eq('id', row.id);
        await audit('backup.downloaded', row.id);
        return reply({ ticket, createdAt: row.created_at, minutes: TICKET_MINUTES });
      }

      case 'backup.chunks': {
        if (!(await ticketIsGood(body.backupId, body.ticket))) {
          return reply({ error: 'This download has expired. Start it again.' }, 403);
        }
        const sql = connect();
        try {
          const rows = await sql.unsafe(
            `select seq, kind, table_id, n, hash, payload
               from (select c.*, sum(length(c.payload)) over (order by c.seq) as run
                       from backup.chunks c where c.backup_id = $1::uuid and c.seq > $2::int) x
              where x.run - length(x.payload) < $3::bigint
              order by x.seq`,
            [body.backupId, body.afterSeq, PAGE_BYTES],
          );
          const last = Number(rows[rows.length - 1]?.seq ?? body.afterSeq);
          const more = (
            await sql.unsafe(`select exists (select 1 from backup.chunks where backup_id = $1::uuid and seq > $2::int) as m`, [
              body.backupId,
              last,
            ])
          )[0]?.m;
          return reply({ chunks: rows, done: !more, lastSeq: last });
        } finally {
          await sql.end({ timeout: 2 }).catch(() => {});
        }
      }

      // ----------------------------------------------------------- pictures --
      case 'pictures.list': {
        if (!(await ticketIsGood(body.backupId, body.ticket))) {
          return reply({ error: 'This download has expired. Start it again.' }, 403);
        }
        const { data: buckets, error } = await admin.storage.listBuckets();
        if (error) return reply({ error: 'Could not list the pictures.' }, 500);
        const out: { bucket: string; path: string; size: number; type: string; url: string }[] = [];
        for (const b of buckets ?? []) {
          const found: { path: string; size: number; type: string }[] = [];
          const walk = async (prefix: string) => {
            for (let offset = 0; ; offset += 1000) {
              const { data } = await admin.storage
                .from(b.id)
                .list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
              if (!data || data.length === 0) return;
              for (const e of data) {
                const path = prefix ? `${prefix}/${e.name}` : e.name;
                if (e.id === null || e.id === undefined) await walk(path);
                else found.push({ path, size: Number(e.metadata?.size ?? 0), type: String(e.metadata?.mimetype ?? 'application/octet-stream') });
              }
              if (data.length < 1000) return;
            }
          };
          await walk('');
          for (let i = 0; i < found.length; i += 100) {
            const batch = found.slice(i, i + 100);
            const { data: signed } = await admin.storage.from(b.id).createSignedUrls(
              batch.map((f) => f.path),
              900,
            );
            for (const s of signed ?? []) {
              const f = batch.find((x) => x.path === s.path);
              if (f && s.signedUrl) out.push({ bucket: b.id, path: f.path, size: f.size, type: f.type, url: s.signedUrl });
            }
          }
        }
        return reply({ pictures: out });
      }

      case 'pictures.upload_urls': {
        const { data: buckets } = await admin.storage.listBuckets();
        const have = new Set((buckets ?? []).map((b) => b.id));
        const urls: { bucket: string; path: string; token: string }[] = [];
        const skipped: string[] = [];
        for (const it of body.items) {
          if (!have.has(it.bucket) || it.path.startsWith('/') || it.path.includes('..')) {
            skipped.push(`${it.bucket}/${it.path}`);
            continue;
          }
          const { data, error } = await admin.storage.from(it.bucket).createSignedUploadUrl(it.path, { upsert: true });
          if (error || !data) skipped.push(`${it.bucket}/${it.path}`);
          else urls.push({ bucket: it.bucket, path: it.path, token: data.token });
        }
        return reply({ urls, skipped });
      }

      // ------------------------------------------------------------ upload --
      case 'backup.upload_start': {
        const id = await startBackup('uploaded', body.note?.trim() || null);
        return reply({ backupId: id });
      }

      case 'backup.upload_chunks': {
        const { data: row } = await admin.from('data_backups').select('id, kind, status').eq('id', body.backupId).single();
        if (!row || row.kind !== 'uploaded' || row.status !== 'running') {
          return reply({ error: 'That upload is not open.' }, 404);
        }
        const sql = connect();
        try {
          await sql.begin(async (tx) => {
            for (const c of body.chunks) {
              await tx.unsafe(`select backup.put_chunk($1::uuid, $2::int, $3::text, $4::text, $5::int, $6::text, $7::text)`, [
                body.backupId,
                c.seq,
                c.kind,
                c.table_id,
                c.n,
                c.hash,
                c.payload,
              ]);
            }
          });
          return reply({ ok: true, stored: body.chunks.length });
        } catch (e) {
          return reply({ error: explain(e, 'backup') }, 422);
        } finally {
          await sql.end({ timeout: 2 }).catch(() => {});
        }
      }

      case 'backup.upload_finish': {
        const { data: row } = await admin.from('data_backups').select('id, kind, status').eq('id', body.backupId).single();
        if (!row || row.kind !== 'uploaded' || row.status !== 'running') {
          return reply({ error: 'That upload is not open.' }, 404);
        }
        const sql = connect();
        try {
          // deno-lint-ignore no-explicit-any
          const ver: any = (await sql.unsafe(`select backup.verify($1::uuid) as r`, [row.id]))[0]?.r;
          if (!ver || (ver.problems?.length ?? 1) > 0) {
            await sql.unsafe(`select backup.drop_backup($1::uuid)`, [row.id]);
            await admin.from('data_backups').delete().eq('id', row.id);
            return reply({ error: ver?.problems?.[0] ?? 'That file is not a complete backup.' }, 422);
          }
          const bytes = Number((await sql.unsafe(`select coalesce(sum(length(payload)), 0)::text as b from backup.chunks where backup_id = $1::uuid`, [row.id]))[0]?.b ?? 0);
          await admin
            .from('data_backups')
            .update({
              status: 'ready',
              phase: null,
              row_counts: ver.rows,
              total_rows: ver.total_rows,
              size_bytes: bytes,
              schema_fingerprint: ver.head?.schema_fingerprint ?? null,
              note: ver.head?.created_at ? `Brought in from a file made ${String(ver.head.created_at).slice(0, 10)}` : null,
              finished_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          await audit('backup.uploaded', row.id, { rows: ver.total_rows, bytes });
          return reply({ ok: true, backupId: row.id, totalRows: ver.total_rows });
        } catch (e) {
          return reply({ error: explain(e, 'backup') }, 422);
        } finally {
          await sql.end({ timeout: 2 }).catch(() => {});
        }
      }

      // ------------------------------------------------------------ delete --
      case 'backup.delete': {
        const { data: row } = await admin.from('data_backups').select('id, status, kind').eq('id', body.backupId).single();
        if (!row) return reply({ error: 'Backup not found.' }, 404);
        // A backup being MADE is left alone; an upload that never finished (refused, or the tab was
        // closed) is cleaned up at once, so no half-loaded copy lingers.
        if (row.status === 'running' && row.kind !== 'uploaded') return reply({ error: 'This backup is still being made.' }, 409);
        const sql = connect();
        try {
          await sql.unsafe(`select backup.drop_backup($1::uuid)`, [row.id]);
        } finally {
          await sql.end({ timeout: 2 }).catch(() => {});
        }
        await admin.from('data_backups').delete().eq('id', row.id);
        await audit('backup.deleted', row.id);
        return reply({ ok: true });
      }

      // ----------------------------------------------------------- restore --
      case 'backup.restore': {
        await sweepStale();
        if (!body.dryRun) {
          if (body.confirm !== 'RESTORE') return reply({ error: 'Type RESTORE to confirm.' }, 400);
          const refused = await passwordGate(body.password);
          if (refused) return refused;
        }
        const busy = await somethingIsRunning();
        if (busy) return reply({ error: busy }, 409);

        const { data: row } = await admin.from('data_backups').select('id, status').eq('id', body.backupId).single();
        if (!row || row.status !== 'ready') return reply({ error: 'That backup is not ready.' }, 404);

        const { data: run, error: runErr } = await admin
          .from('data_restore_runs')
          .insert({
            started_by: actor.id,
            started_by_email: actor.email,
            backup_id: row.id,
            accounts: body.accounts,
            dry_run: body.dryRun,
            status: 'running',
            phase: body.dryRun ? 'Rehearsing the restore (nothing will change)' : 'Saving a safety copy of what you have now',
          })
          .select('id')
          .single();
        if (runErr || !run) return reply({ error: 'Could not start the restore.' }, 500);
        const runId = run.id as string;

        try {
          if (body.dryRun) {
            await schedule(`select backup.schedule_apply($1::uuid)`, [runId]);
          } else {
            // The way back. A copy of today's data is saved FIRST, as the
            // first job; the restore is scheduled by that job once it is saved.
            const safetyId = await startBackup('before_restore', 'Saved automatically just before a restore');
            await admin.from('data_restore_runs').update({ safety_backup_id: safetyId }).eq('id', runId);
            await schedule(`select backup.schedule_make($1::uuid, 'before_restore', $2::uuid, $3::uuid)`, [
              safetyId,
              actor.id,
              runId,
            ]);
          }
        } catch (e) {
          await admin
            .from('data_restore_runs')
            .update({ status: 'failed', phase: null, finished_at: new Date().toISOString(), error: explain(e, 'restore') })
            .eq('id', runId);
          return reply({ error: explain(e, 'restore') }, 500);
        }
        return reply({ restoreId: runId }, 202);
      }
    }
  } catch (e) {
    console.error('backup-data failed', e);
    return reply({ error: 'Something went wrong: ' + messageOf(e).slice(0, 200) }, 500);
  }
  return reply({ error: 'Unknown action' }, 400);
});
