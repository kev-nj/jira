/* The sync protocol, client side.

   Test 1 is the 2026-09-04 incident written down: a device holding a stale copy
   made one small edit and its whole board went up, reverting two days of work.
   Under per-record sync it must only be able to affect the field it touched. */
const {
  fakeServer, boot, settle, localState, task, board, check, report,
} = require('./harness');

async function staleDeviceCannotClobber() {
  const server = fakeServer();

  // Desktop seeds the server with two tasks.
  const desktop = boot(board([task('A'), task('B')]), server);
  desktop.window.dispatchEvent(new desktop.window.Event('cloud:ready'));
  await settle(desktop.window);
  check('server seeded', Object.keys(server.rows.tasks).sort(), ['A', 'B']);

  // Desktop renames B and syncs.
  server.apply([{ mutation_id: 'd1', table: 'tasks', id: 'B', fields: { title: 'B renamed on desktop' } }]);

  // Phone boots from a copy predating that rename — it has never seen it.
  const phone = boot(board([task('A'), task('B')]), server);
  // It ticks A's status. Under the old blob model this pushed all of A and B.
  const store = localState(phone.window);
  phone.window.dispatchEvent(new phone.window.Event('cloud:ready'));
  await settle(phone.window);
  const card = phone.doc.querySelector('[data-id="A"] .check');
  card.dispatchEvent(new phone.window.Event('click', { bubbles: true }));
  await settle(phone.window);

  check('A status changed by phone', server.rows.tasks.A.fields.status, 'doing');
  check("B's desktop rename survived", server.rows.tasks.B.fields.title, 'B renamed on desktop');
  check('phone adopted the rename', localState(phone.window).tasks.find((t) => t.id === 'B').title,
    'B renamed on desktop');
  return store;
}

async function tombstoneStaysDeleted() {
  const server = fakeServer();
  const a = boot(board([task('A'), task('B')]), server);
  a.window.dispatchEvent(new a.window.Event('cloud:ready'));
  await settle(a.window);

  // Device A deletes B while device B is offline through the whole thing.
  server.apply([{ mutation_id: 'del', table: 'tasks', id: 'B', fields: {}, deleted: true }]);

  const b = boot(board([task('A'), task('B')]), server, { seq: 0 });
  b.window.dispatchEvent(new b.window.Event('cloud:ready'));
  await settle(b.window);

  check('deleted task did not resurrect',
    localState(b.window).tasks.map((t) => t.id), ['A']);
  check('server still shows the tombstone', !!server.rows.tasks.B.deleted_at, true);
}

async function outboxReplaysOnce() {
  const server = fakeServer();
  const w = boot(board([task('A')]), server);
  w.window.dispatchEvent(new w.window.Event('cloud:ready'));
  await settle(w.window);

  server.apply([{ mutation_id: 'x', table: 'tasks', id: 'A', fields: { title: 'once' } }]);
  server.apply([{ mutation_id: 'x', table: 'tasks', id: 'A', fields: { title: 'twice' } }]);
  check('duplicate mutation_id ignored', server.rows.tasks.A.fields.title, 'once');
  check('outbox drained', JSON.parse(w.window.localStorage.getItem('todo-board.outbox')), []);
  check('watermark recorded', Number(w.window.localStorage.getItem('todo-board.seq')) > 0, true);
}

/* The Sep 4 failure mode: the device could not see the server, but pushed
   anyway. A pull that fails must leave the watermark alone and hold the write
   in the outbox — never let the device assert state it could not reconcile. */
async function pullFailureBlocksPush() {
  const server = fakeServer();
  const w = boot(board([task('A')]), server);
  w.window.cloud.pull = async () => null;        // network is down

  const card = w.doc.querySelector('[data-id="A"] .check');
  card.dispatchEvent(new w.window.Event('click', { bubbles: true }));
  await settle(w.window);

  check('nothing reached the server', Object.keys(server.rows.tasks), []);
  check('the edit is held in the outbox',
    JSON.parse(w.window.localStorage.getItem('todo-board.outbox')).length > 0, true);

  // Network returns: the queued edit goes up, and only then.
  w.window.cloud.pull = async (n) => server.pull(n);
  w.window.dispatchEvent(new w.window.Event('focus'));
  await settle(w.window);
  check('queued edit delivered once reachable', server.rows.tasks.A.fields.status, 'doing');
  check('outbox emptied', JSON.parse(w.window.localStorage.getItem('todo-board.outbox')), []);
}

(async () => {
  console.log('stale device cannot clobber');
  await staleDeviceCannotClobber();
  console.log('tombstones');
  await tombstoneStaysDeleted();
  console.log('outbox idempotency');
  await outboxReplaysOnce();
  console.log('a failed pull blocks the push');
  await pullFailureBlocksPush();
  report();
})();
