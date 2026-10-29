// Proves the shared-settings loop is gone without opening a browser (a browser robot must never be pointed at the WurxBase screens: they write
// to the real database). It models the one shared `app_settings` row, three open sessions and the database's own broadcast of every update,
// runs the OLD behaviour (every fetch sets new state, every state change saves) and the NEW one (settingsSync.js), and counts the writes.
//   node scripts/verify/verify-settings-sync.mjs        (also: pnpm verify:settings-sync)
import { createFetchGate, createSettingsMirror } from '../../src/vendor/wurxbase/settingsSync.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
};

const TEAM = [
  { id: 'aris', name: 'Aris', color: 'x', bg: '#DBEAFE' },
  { id: 'emily', name: 'Emily', color: 'x', bg: '#FCE7F3' },
];
const clone = (v) => JSON.parse(JSON.stringify(v));
const reorderKeys = (arr) => arr.map((o) => Object.fromEntries(Object.entries(o).reverse()));

/**
 * One server row, a queue of pending work (a message in flight is a queued task), and the database's broadcast: EVERY update is sent to
 * every session, even one that changes nothing, exactly as Postgres + Realtime do, unless the "ignore unchanged saves" rule is on.
 */
function world({ mode, sessions = 3, suppressRedundant = false, serverTeam = TEAM, serverKeyOrder = false }) {
  const w = { row: { hired_by_team: clone(serverTeam) }, writes: 0, reads: 0, queue: [], broadcasts: 0 };
  w.sessions = [];
  const send = (fn) => w.queue.push(fn);
  w.write = (patch) => {
    w.writes++;
    const next = { ...w.row, ...clone(patch) };
    const same = JSON.stringify(next) === JSON.stringify(w.row);
    w.row = next;
    if (suppressRedundant && same) return; // the database rule: a save that changes nothing makes no change and no broadcast
    w.broadcasts++;
    w.sessions.forEach((s) => send(() => s.fetch()));
  };
  for (let i = 0; i < sessions; i++) {
    const s = { state: clone(TEAM), loaded: false, mirror: createSettingsMirror(), edits: 0 };
    // what a session's React "persist" effect does when its state changes
    s.persist = () => {
      if (!s.loaded) return;
      if (mode === 'old') return w.write({ hired_by_team: s.state });
      const keys = s.mirror.changed({ hired_by_team: s.state });
      if (!keys.length) return;
      const body = { hired_by_team: s.state };
      w.write(body);
      s.mirror.seen('hired_by_team', body.hired_by_team);
    };
    // what loadSettings does with a row: the server's JSON, then the state set from it (a NEW array every time)
    s.fetch = () => {
      w.reads++;
      const data = serverKeyOrder ? { hired_by_team: reorderKeys(w.row.hired_by_team) } : clone(w.row);
      let applied = true;
      if (mode === 'new') {
        const fresh = s.mirror.differs('hired_by_team', data.hired_by_team);
        s.mirror.seen('hired_by_team', data.hired_by_team);
        applied = fresh;
      }
      if (applied && Array.isArray(data.hired_by_team) && data.hired_by_team.length) {
        const saved = data.hired_by_team;
        s.state = typeof saved[0] === 'string' ? saved.map((n) => TEAM.find((d) => d.name === n) || { id: n.toLowerCase(), name: n, color: 'x', bg: '#F3F4F6' }) : saved.filter((m) => m && m.name);
        s.loaded = true;
        s.persist(); // the state changed identity, so the effect runs
      }
      s.loaded = true;
    };
    w.sessions.push(s);
  }
  return w;
}
function run(w, cap = 5000) {
  w.sessions.forEach((s) => w.queue.push(() => s.fetch())); // every session opens and loads
  let steps = 0;
  while (w.queue.length && steps < cap) {
    w.queue.shift()();
    steps++;
  }
  return { settled: w.queue.length === 0, steps };
}

// ---------------------------------------------------------------- the bug, reproduced
{
  const w = world({ mode: 'old' });
  const r = run(w);
  ok('OLD behaviour: three open sessions never settle (the endless loop)', !r.settled, `${w.writes} writes and ${w.reads} reads in ${r.steps} steps and still going`);
}
// ---------------------------------------------------------------- the fix
{
  const w = world({ mode: 'new' });
  const r = run(w);
  ok('NEW behaviour: three sessions load, nothing is written back, everything settles', r.settled && w.writes === 0, `${w.writes} writes, ${w.reads} reads`);
}
{
  const w = world({ mode: 'new', serverKeyOrder: true });
  const r = run(w);
  ok('the database handing its keys back in another order does not start a loop either', r.settled && w.writes === 0, `${w.writes} writes`);
}
{
  const w = world({ mode: 'new' });
  run(w);
  const a = w.sessions[0];
  const edited = [...clone(TEAM), { id: 'zoe', name: 'Zoe', color: 'x', bg: '#EEE' }];
  a.state = edited;
  a.persist(); // a real edit: the effect runs because the state changed
  const before = w.writes;
  const r = run({ ...w, sessions: [] , queue: w.queue }); // drain what the save set going
  ok('a real edit still saves, exactly once', before === 1 && w.writes === 1, `${w.writes} write`);
  ok('and the other sessions pick it up and settle without saving anything back', r.settled && w.writes === 1 && w.sessions.every((s) => s.state.length === 3), `${w.writes} write, ${w.reads} reads`);
}
{
  const w = world({ mode: 'new', serverTeam: ['Aris', 'Emily'] });
  const r = run(w);
  ok('an old-format list (plain names) is converted once and then stays quiet', r.settled && w.writes >= 1 && w.writes <= 3, `${w.writes} writes`);
}
// ---------------------------------------------------------------- the database rule on its own
{
  const w = world({ mode: 'old', suppressRedundant: true });
  const r = run(w);
  ok('the database rule alone ends the loop even for the OLD code', r.settled, `${w.writes} writes, ${w.broadcasts} broadcast(s), settled after ${r.steps} steps`);
}
// ---------------------------------------------------------------- the mirror and the gate
{
  const m = createSettingsMirror();
  ok('a key the server was never asked about always differs', m.differs('a', [1]));
  m.seen('a', { x: 1, y: [1, 2] });
  ok('the same data in another key order is the same', !m.differs('a', { y: [1, 2], x: 1 }));
  ok('different data differs', m.differs('a', { x: 2, y: [1, 2] }));
  ok('changed() lists only what differs', JSON.stringify(m.changed({ a: { x: 1, y: [1, 2] }, b: 1 })) === '["b"]');
}
{
  let runs = 0;
  const gate = createFetchGate(async () => {
    runs++;
    await new Promise((r) => setTimeout(r, 20));
  });
  await Promise.all([gate(), gate(), gate(), gate(), gate()]);
  await new Promise((r) => setTimeout(r, 80));
  ok('five simultaneous fetches become two (the one running, and one more after it)', runs === 2, `${runs} runs`);
  await gate();
  ok('a fetch with nothing running just runs', runs === 3);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
