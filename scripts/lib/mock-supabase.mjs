/**
 * A small in-memory stand-in for the parts of supabase-js the Categorise Edge
 * Functions use, so their REAL handlers can be run in Node without a database, a
 * network or Deno. It is not a database: it implements exactly the query shapes
 * those functions build, and a shape it does not know throws, so a function that
 * starts using a new one fails here loudly instead of passing quietly.
 *
 * Reached through scripts/lib/functions-tsconfig.json, which maps the function's
 * `npm:@supabase/supabase-js@...` import to this file.
 */

export const tables = {};
export const users = {};

/* The column defaults the real tables have, which the functions rely on:
   `batch.attempts + 1` is NaN if a freshly inserted batch has no attempts. */
const DEFAULTS = {
  collab_angle_batches: { attempts: 0, provider_job: null, lease_until: null, finished_at: null, error: null, last_phase: null },
  collab_angle_videos: { attempts: 0, last_error: null, batch_id: null, angle: null, status: 'queued' },
};

export function reset(seed = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(users)) delete users[k];
  for (const [name, rows] of Object.entries(seed.tables ?? {})) tables[name] = rows.map((r) => ({ ...r }));
  Object.assign(users, seed.users ?? {});
}

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

/** `col.is.null` and `col.lt.value`, the only two the worker's lease check uses. */
function orFilter(expr) {
  const parts = expr.split(',').map((p) => {
    const [col, op, ...rest] = p.split('.');
    const val = rest.join('.');
    if (op === 'is' && val === 'null') return (r) => r[col] === null || r[col] === undefined;
    if (op === 'lt') return (r) => r[col] !== null && r[col] !== undefined && r[col] < val;
    throw new Error(`mock: or(${p}) is not implemented`);
  });
  return (r) => parts.some((f) => f(r));
}

class Query {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.filters = [];
    this.sort = null;
    this.max = null;
    this.payload = null;
    this.returning = false;
    this.head = false;
    this.mode = 'many';
  }
  select(_cols, opts) {
    if (this.op !== 'select') this.returning = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  in(col, vals) { this.filters.push((r) => vals.includes(r[col])); return this; }
  eq(col, v) { this.filters.push((r) => r[col] === v); return this; }
  or(expr) { this.filters.push(orFilter(expr)); return this; }
  not(col, op, v) {
    if (op !== 'is') throw new Error(`mock: not(${col}, ${op}) is not implemented`);
    this.filters.push((r) => (v === null ? r[col] !== null && r[col] !== undefined : r[col] !== v));
    return this;
  }
  order(col, o) { this.sort = { col, asc: o?.ascending !== false }; return this; }
  limit(n) { this.max = n; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  single() { this.mode = 'single'; return this; }

  run() {
    const rows = (tables[this.table] ??= []);
    const match = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'insert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const made = list.map((p) => ({
        id: uuid(),
        created_at: new Date().toISOString(),
        ...(DEFAULTS[this.table] ?? {}),
        ...p,
      }));
      rows.push(...made);
      return this.shape(this.returning ? made : null);
    }
    if (this.op === 'update') {
      for (const r of match) Object.assign(r, this.payload);
      return this.shape(this.returning ? match : null);
    }
    if (this.op === 'delete') {
      tables[this.table] = rows.filter((r) => !match.includes(r));
      return this.shape(this.returning ? match : null);
    }
    let out = [...match];
    if (this.sort) {
      const { col, asc } = this.sort;
      out.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.max !== null) out = out.slice(0, this.max);
    if (this.head) return { data: null, error: null, count: match.length };
    return this.shape(out);
  }
  shape(rows) {
    if (this.mode === 'many') return { data: rows, error: null, count: rows?.length ?? null };
    const first = rows?.[0] ?? null;
    if (this.mode === 'single' && !first) return { data: null, error: { message: 'no rows' } };
    return { data: first, error: null };
  }
  then(resolve, reject) {
    try { resolve(this.run()); } catch (e) { reject?.(e); }
  }
}

export function createClient() {
  return {
    auth: {
      getUser: async (token) => {
        const u = users[token];
        return u
          ? { data: { user: { id: u.id } }, error: null }
          : { data: { user: null }, error: { message: 'bad token' } };
      },
    },
    from: (t) => new Query(t),
    /* The angle store lives in the `wurxbase` schema. */
    schema: (s) => ({ from: (t) => new Query(`${s}.${t}`) }),
    rpc: () => { throw new Error('mock: rpc is not implemented'); },
  };
}
