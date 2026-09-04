/* Shared jsdom harness plus an in-memory stand-in for the server.

   The stand-in reimplements apply_mutations()'s contract — per-field
   last-write-wins against a server-side clock, tombstones, idempotency by
   mutation_id — so these tests exercise the *client* half of the protocol.
   The SQL half is verified against the real database, not here. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DIR = path.join(__dirname, '..');

function fakeServer() {
  const rows = { tasks: {}, sections: {}, boards: {} };
  const applied = new Set();
  let seq = 0;
  let clock = 0;

  // One tick per batch, mirroring now() being constant within a transaction.
  function apply(mutations) {
    clock += 1;
    mutations.forEach((m) => {
      const key = `${m.mutation_id}`;
      if (applied.has(key)) return;          // replayed outbox entry: no-op
      applied.add(key);
      const table = rows[m.table];
      const id = m.table === 'boards' ? 'board' : m.id;
      const row = table[id] || (table[id] = { id, fields: {}, ts: {}, deleted_at: null });
      Object.entries(m.fields).forEach(([k, v]) => {
        if (row.ts[k] === undefined || clock >= row.ts[k]) {
          row.fields[k] = k === 'counter'
            ? Math.max(row.fields[k] || 0, v || 0)   // grow-only, never LWW
            : v;
          row.ts[k] = clock;
        }
      });
      if (m.deleted) row.deleted_at = clock;
      seq += 1;
      row.seq = seq;
    });
    return seq;
  }

  const since = (table, n) => Object.values(rows[table])
    .filter((r) => r.seq > n)
    .map((r) => ({ id: r.id, fields: r.fields, deleted_at: r.deleted_at, seq: r.seq }))
    .sort((a, b) => a.seq - b.seq);

  return {
    rows,
    apply,
    get seq() { return seq; },
    pull(n) {
      const board = rows.boards.board;
      return {
        tasks: since('tasks', n),
        sections: since('sections', n),
        board: board ? board.fields : null,
        legacy: null,
        seq: Math.max(n, seq),
      };
    },
  };
}

// Boots app.js in jsdom against `server`, with `stored` as prior localStorage.
function boot(stored, server, opts = {}) {
  const html = fs.readFileSync(`${DIR}/index.html`, 'utf8')
    .replace(/<script src="app.js"><\/script>/, '')
    .replace(/<script type="module" src="cloud.js"><\/script>/, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  let n = 0;
  window.crypto = { randomUUID: () => `u${(n += 1)}-${Math.random().toString(16).slice(2)}` };
  if (stored) window.localStorage.setItem('todo-board.v2', JSON.stringify(stored));
  if (opts.seq) window.localStorage.setItem('todo-board.seq', String(opts.seq));

  window.cloud = {
    status: { status: 'signed-in', user: { id: 'u1' }, error: null },
    pull: async (s) => server.pull(s),
    push: async (m) => server.apply(m),
    subscribe() {},
    signIn() {}, signOut() {},
  };
  window.eval(fs.readFileSync(`${DIR}/app.js`, 'utf8'));
  return { window, doc: window.document };
}

// Let the app's awaits and its 600ms debounce settle.
const settle = (window, ms = 900) => new Promise((r) => {
  const t = Date.now();
  const step = () => (Date.now() - t > ms ? r() : setTimeout(step, 20));
  step();
});

const localState = (window) => JSON.parse(window.localStorage.getItem('todo-board.v2'));

const today = () => new Date().toISOString().slice(0, 10);

const task = (id, over = {}) => Object.assign({
  id, key: id, title: id, notes: '', status: 'todo', section: 'project',
  project: '', assignee: '', date: today(), time: null, priority: 'medium',
  subtasks: [], order: '', createdAt: 1, completedAt: null, rolledFrom: null,
  collapsed: false, starred: false,
}, over);

const board = (tasks) => ({
  version: 2, name: 'To-Do Board', prefix: 'T', counter: tasks.length,
  view: 'day', sort: 'manual',
  sections: [{ id: 'project', name: 'Project' }, { id: 'personal', name: 'Non-project' }],
  tasks,
});

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}
const report = () => {
  console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
  // app.js runs a 20s clock interval inside jsdom, which would otherwise hold
  // the event loop open forever.
  process.exit(failures ? 1 : 0);
};

module.exports = {
  DIR, fakeServer, boot, settle, localState, task, board, today, check, report,
};
