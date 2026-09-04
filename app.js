/* To-Do Board — a kanban-style daily/weekly/monthly planner.
   Everything lives in localStorage; there is no backend. */
(() => {
  'use strict';

  const STORAGE_KEY = 'todo-board.v2';
  const LEGACY_KEY = 'jira-board.v1';

  const STATUSES = [
    { id: 'todo', name: 'To Do' },
    { id: 'doing', name: 'In Progress' },
    { id: 'done', name: 'Done' },
  ];
  const DEFAULT_SECTIONS = [
    { id: 'project', name: 'Project' },
    { id: 'personal', name: 'Non-project' },
  ];
  const PRIORITY_BARS = { high: 3, medium: 2, low: 1 };
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const el = (id) => document.getElementById(id);
  const view = el('view');

  // =========================================================================
  // Dates. Everything is a local YYYY-MM-DD string; no timezone maths.
  // =========================================================================
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => new Date(`${s}T00:00:00`);
  const todayISO = () => iso(new Date());

  function addDays(isoStr, n) {
    const d = parse(isoStr);
    d.setDate(d.getDate() + n);
    return iso(d);
  }

  function addMonths(isoStr, n) {
    const d = parse(isoStr);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    // Clamp so 31 Jan + 1 month lands on the last day of February, not in March.
    d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
    return iso(d);
  }

  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

  // Weeks run Monday to Sunday.
  function startOfWeek(isoStr) {
    const d = parse(isoStr);
    const shift = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - shift);
    return iso(d);
  }

  function weekDates(isoStr, length = 7) {
    const start = startOfWeek(isoStr);
    return Array.from({ length }, (_, i) => addDays(start, i));
  }

  // Full weeks covering the month, so the calendar grid is always rectangular.
  function monthGrid(isoStr) {
    const d = parse(isoStr);
    const first = iso(new Date(d.getFullYear(), d.getMonth(), 1));
    const last = iso(new Date(d.getFullYear(), d.getMonth(), daysInMonth(d.getFullYear(), d.getMonth())));
    const cells = [];
    for (let day = startOfWeek(first); day <= startOfWeek(last) || cells.length % 7; day = addDays(day, 1)) {
      cells.push(day);
      if (day > last && cells.length % 7 === 0) break;
    }
    return cells;
  }

  const daysAway = (isoStr) => Math.round((parse(isoStr) - parse(todayISO())) / 86400000);

  function fmtTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function dayLabel(isoStr) {
    const away = daysAway(isoStr);
    if (away === 0) return 'Today';
    if (away === 1) return 'Tomorrow';
    if (away === -1) return 'Yesterday';
    return parse(isoStr).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  // =========================================================================
  // Fractional ordering
  //
  // Order is a string key generated midway between its neighbours rather than
  // an index, so two devices reordering the same list converge instead of
  // renumbering over each other. The digits are in ascending ASCII order, which
  // is what lets plain string comparison sort them.
  // =========================================================================
  const KEY_DIGITS =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  function midKey(a, b) {
    const lo = a || '';
    const hi = b || '';
    let prefix = '';
    for (let i = 0; ; i += 1) {
      const ca = i < lo.length ? KEY_DIGITS.indexOf(lo[i]) : -1;
      const cb = i < hi.length ? KEY_DIGITS.indexOf(hi[i]) : KEY_DIGITS.length;
      if (cb - ca > 1) {
        // A key must never end in the lowest digit: nothing could ever sort
        // below it afterwards, so the top of the list would become unusable.
        const mid = Math.max(Math.floor((ca + cb) / 2), 1);
        if (mid < cb) return prefix + KEY_DIGITS[mid];
      }
      // Too tight to split at this digit; descend a level and try again.
      prefix += i < lo.length ? lo[i] : KEY_DIGITS[0];
    }
  }

  // n ascending keys, for seeding a list that has no keys yet.
  function spreadKeys(n) {
    const out = [];
    let last = '';
    for (let i = 0; i < n; i += 1) {
      last = midKey(last, '');
      out.push(last);
    }
    return out;
  }

  // Boards saved before fractional keys have numeric `order`; rank each date's
  // tasks by it once and hand out string keys in that order.
  function upgradeOrder(s) {
    const numeric = s.tasks.some((t) => typeof t.order === 'number');
    if (numeric) {
      const byDate = {};
      s.tasks.forEach((t) => { (byDate[t.date] = byDate[t.date] || []).push(t); });
      Object.values(byDate).forEach((group) => {
        group.sort((a, b) => (a.order || 0) - (b.order || 0));
        const keys = spreadKeys(group.length);
        group.forEach((t, i) => { t.order = keys[i]; });
      });
    }
    const keys = spreadKeys(s.sections.length);
    s.sections.forEach((sec, i) => { if (!sec.order) sec.order = keys[i]; });
    sortSections(s);
    return s;
  }

  function sortSections(s) {
    // Plain string compare: the key digits are in ascending ASCII order.
    return s.sections.sort((a, b) => (a.order < b.order ? -1 : 1));
  }

  // =========================================================================
  // State
  // =========================================================================
  let state;
  state = load();
  const VIEWS = ['day', 'workweek', 'week', 'month'];
  let ui = { view: VIEWS.includes(state.view) ? state.view : 'day', cursor: todayISO() };

  function blank() {
    return {
      version: 2, name: 'To-Do Board', prefix: 'T', counter: 0,
      view: 'day', sort: 'manual',
      sections: DEFAULT_SECTIONS.map((x) => ({ ...x })),
      tasks: [],
    };
  }

  function firstSectionId() {
    return state && state.sections && state.sections.length
      ? state.sections[0].id : DEFAULT_SECTIONS[0].id;
  }

  function sectionName(id) {
    const found = state.sections.find((x) => x.id === id);
    return found ? found.name : id;
  }

  function normalise(task) {
    return Object.assign({
      id: crypto.randomUUID(),
      key: '',
      title: '',
      notes: '',
      status: 'todo',
      section: firstSectionId(),
      project: '',
      assignee: '',
      date: todayISO(),
      time: null,
      priority: 'medium',
      subtasks: [],
      order: '',
      createdAt: Date.now(),
      completedAt: null,
      rolledFrom: null,
      collapsed: false,
      starred: false,
    }, task);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tasks)) {
          const s = Object.assign(blank(), parsed);
          if (!Array.isArray(s.sections) || !s.sections.length) {
            s.sections = DEFAULT_SECTIONS.map((x) => ({ ...x }));
          }
          s.tasks = s.tasks.map(normalise);
          // A task whose section was deleted elsewhere lands in the first one.
          const ids = s.sections.map((x) => x.id);
          s.tasks.forEach((t) => { if (!ids.includes(t.section)) t.section = ids[0]; });
          return upgradeOrder(s);
        }
      }
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) return upgradeOrder(migrate(JSON.parse(legacy)));
    } catch (e) {
      console.warn('Could not read saved board; starting fresh.', e);
    }
    return upgradeOrder(blank());
  }

  // Carry over anything from the old kanban board so no work is lost.
  function migrate(old) {
    const s = blank();
    if (!old || !Array.isArray(old.issues)) return s;
    s.counter = old.counter || 0;
    s.tasks = old.issues.map((i) => normalise({
      id: i.id,
      key: i.key,
      title: i.title,
      notes: i.description || '',
      status: i.status === 'done' ? 'done' : (i.status === 'todo' ? 'todo' : 'doing'),
      // The old board had no sections; anything with a label or points reads
      // as project work, the rest as personal.
      section: (i.labels && i.labels.length) || i.points ? 'project' : 'personal',
      project: (i.labels && i.labels[0]) || '',
      assignee: i.assignee || '',
      date: i.due || todayISO(),
      time: i.dueTime || null,
      priority: ['highest', 'high'].includes(i.priority) ? 'high'
        : (['low', 'lowest'].includes(i.priority) ? 'low' : 'medium'),
      order: i.order || 0,
      createdAt: i.createdAt || Date.now(),
    }));
    return s;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Could not save.', e);
      alert('Saving failed — browser storage may be full or blocked.');
    }
  }

  function save() {
    // Derive what changed before writing, so no call site can forget to record
    // itself: every mutation in the app funnels through save().
    enqueue(diffShadow());
    persist();
    scheduleSync();
  }


  // =========================================================================
  // Cloud sync
  //
  // localStorage stays the source of truth for rendering, so the board works
  // offline and signed out. Local edits are captured as per-field mutations,
  // queued in an outbox that survives reload, and drained only after a pull has
  // succeeded — a device can never assert state it has not first reconciled.
  // =========================================================================
  const OUTBOX_KEY = 'todo-board.outbox';
  const SEQ_KEY = 'todo-board.seq';
  const SEEDED_KEY = 'todo-board.seeded';

  // `collapsed` is deliberately absent: it is per-device view state, not data.
  const TASK_FIELDS = ['key', 'title', 'notes', 'status', 'section', 'project',
    'assignee', 'date', 'time', 'priority', 'subtasks', 'order', 'completedAt',
    'rolledFrom', 'starred', 'createdAt'];
  const SECTION_FIELDS = ['name', 'order'];
  const BOARD_FIELDS = ['name', 'prefix', 'counter', 'view', 'sort'];

  let syncedSeq = Number(localStorage.getItem(SEQ_KEY)) || 0;
  let outbox = readOutbox();
  let shadow = snapshot();
  let syncTimer = null;
  let syncing = false;
  let syncAgain = false;
  let subscribed = false;

  function readOutbox() {
    try {
      const raw = JSON.parse(localStorage.getItem(OUTBOX_KEY));
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }

  function writeOutbox() {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  }

  function pick(obj, keys) {
    const out = {};
    keys.forEach((k) => { out[k] = obj[k] === undefined ? null : obj[k]; });
    return out;
  }

  // What we believe the server holds, so the next save can diff against it.
  function snapshot() {
    const tasks = {};
    state.tasks.forEach((t) => { tasks[t.id] = pick(t, TASK_FIELDS); });
    const sections = {};
    state.sections.forEach((s) => { sections[s.id] = pick(s, SECTION_FIELDS); });
    return { tasks, sections, board: pick(state, BOARD_FIELDS) };
  }

  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Client-side change data capture: compare the live state to the shadow and
  // emit one mutation per changed record, carrying only the changed fields.
  function diffRows(table, now, before, fields) {
    const out = [];
    Object.keys(now).forEach((id) => {
      const changed = {};
      fields.forEach((k) => {
        if (!before[id] || !same(now[id][k], before[id][k])) changed[k] = now[id][k];
      });
      if (Object.keys(changed).length) out.push({ table, id, fields: changed });
    });
    // A row that vanished locally travels as a tombstone, never as an absence.
    Object.keys(before).forEach((id) => {
      if (!now[id]) out.push({ table, id, fields: {}, deleted: true });
    });
    return out;
  }

  function diffShadow() {
    const now = snapshot();
    const out = [
      ...diffRows('tasks', now.tasks, shadow.tasks, TASK_FIELDS),
      ...diffRows('sections', now.sections, shadow.sections, SECTION_FIELDS),
    ];
    const board = {};
    BOARD_FIELDS.forEach((k) => {
      if (!same(now.board[k], shadow.board[k])) board[k] = now.board[k];
    });
    if (Object.keys(board).length) out.push({ table: 'boards', id: 'board', fields: board });
    shadow = now;
    return out;
  }

  function enqueue(mutations) {
    if (!mutations.length) return;
    mutations.forEach((m) => { m.mutation_id = crypto.randomUUID(); });
    outbox = outbox.concat(mutations);
    writeOutbox();
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 600);
  }

  // Remote rows land on top of local state; anything still queued in the outbox
  // is re-applied over them so unsent local edits do not visibly revert.
  function applyRemote(delta) {
    if (delta.board) Object.assign(state, pick(delta.board, BOARD_FIELDS));

    delta.sections.forEach((row) => {
      const i = state.sections.findIndex((s) => s.id === row.id);
      if (row.deleted_at) { if (i >= 0) state.sections.splice(i, 1); return; }
      const merged = Object.assign({ id: row.id }, row.fields);
      if (i >= 0) state.sections[i] = merged; else state.sections.push(merged);
    });
    if (!state.sections.length) state.sections = DEFAULT_SECTIONS.map((x) => ({ ...x }));
    sortSections(state);

    delta.tasks.forEach((row) => {
      const i = state.tasks.findIndex((t) => t.id === row.id);
      if (row.deleted_at) { if (i >= 0) state.tasks.splice(i, 1); return; }
      const merged = normalise(Object.assign({ id: row.id }, row.fields));
      if (i >= 0) merged.collapsed = state.tasks[i].collapsed;
      if (i >= 0) state.tasks[i] = merged; else state.tasks.push(merged);
    });

    outbox.forEach((m) => {
      if (m.deleted) return;
      const row = m.table === 'tasks' ? byId(m.id)
        : (m.table === 'sections' ? state.sections.find((s) => s.id === m.id) : state);
      if (row) Object.assign(row, m.fields);
    });

    const ids = state.sections.map((x) => x.id);
    state.tasks.forEach((t) => { if (!ids.includes(t.section)) t.section = ids[0]; });
    shadow = snapshot();
    persist();
  }

  async function drain() {
    if (!outbox.length) return false;
    const sending = outbox.slice();
    const seq = await window.cloud.push(sending);
    if (seq === null) return false;
    const sent = new Set(sending.map((m) => m.mutation_id));
    outbox = outbox.filter((m) => !sent.has(m.mutation_id));
    writeOutbox();
    return true;
  }

  // The whole local board as mutations, to seed a server that has no rows yet.
  function seed() {
    if (localStorage.getItem(SEEDED_KEY)) return;
    localStorage.setItem(SEEDED_KEY, '1');
    const now = snapshot();
    const out = [];
    Object.keys(now.tasks).forEach((id) => out.push({ table: 'tasks', id, fields: now.tasks[id] }));
    Object.keys(now.sections).forEach((id) => out.push({ table: 'sections', id, fields: now.sections[id] }));
    out.push({ table: 'boards', id: 'board', fields: { ...now.board, migrated: true } });
    enqueue(out);
  }

  async function syncNow() {
    if (!window.cloud || !window.cloud.status.user) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      const delta = await window.cloud.pull(syncedSeq);
      if (!delta) return;                     // network error: keep the watermark
      if (!delta.board || !delta.board.migrated) seed();
      applyRemote(delta);
      syncedSeq = delta.seq;
      // Only now, having reconciled, may this device assert anything.
      if (await drain()) {
        const after = await window.cloud.pull(syncedSeq);
        if (after) { applyRemote(after); syncedSeq = after.seq; }
      }
      localStorage.setItem(SEQ_KEY, String(syncedSeq));
      if (!subscribed) { subscribed = true; window.cloud.subscribe(scheduleSync); }
      render();
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; syncNow(); }
    }
  }

  window.addEventListener('cloud:ready', syncNow);
  window.addEventListener('cloud:status', (e) => {
    updateCloudButton(e.detail);
    if (e.detail.status === 'signed-in') syncNow();
  });
  // A tab resumed after hours suspended is stale; pull before it can push.
  window.addEventListener('focus', scheduleSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync();
  });

  function updateCloudButton(detail) {
    const btn = el('cloudBtn');
    const label = {
      'signed-out': 'Sign in',
      connecting: 'Connecting…',
      'signed-in': 'Synced',
      saving: 'Saving…',
      synced: 'Synced',
      error: 'Sync error',
    }[detail.status] || 'Sign in';
    btn.textContent = label;
    btn.dataset.status = detail.status;
    btn.title = detail.error
      || (detail.user ? `Signed in as ${detail.user.email || detail.user.id} — click to sign out`
        : 'Sign in to sync across devices');
  }

  el('cloudBtn').addEventListener('click', () => {
    if (!window.cloud) {
      alert('Sync did not load. Check the browser console — cloud.js may have failed to fetch.');
      return;
    }
    if (window.cloud.status.user) {
      if (confirm('Sign out? Your tasks stay on this device.')) window.cloud.signOut();
    } else {
      window.cloud.signIn();
    }
  });

  const nextKey = () => `${state.prefix}-${(state.counter += 1)}`;
  const byId = (id) => state.tasks.find((t) => t.id === id);

  function createTask(data) {
    const peers = state.tasks.filter((t) => t.date === (data.date || todayISO()))
      .sort((a, b) => (a.order < b.order ? -1 : 1));
    const task = normalise(Object.assign({
      key: nextKey(),
      order: midKey(peers.length ? peers[peers.length - 1].order : '', ''),
    }, data));
    state.tasks.push(task);
    save();
    return task;
  }

  const NEXT_STATUS = { todo: 'doing', doing: 'done', done: 'todo' };
  const STATUS_VERB = { todo: 'Not started', doing: 'In progress', done: 'Done' };

  function setStatus(task, status) {
    task.status = status;
    task.completedAt = status === 'done' ? Date.now() : null;
    // Finishing a parent implies its subtasks are finished too.
    if (status === 'done') task.subtasks.forEach((s) => { s.done = true; });
    save();
  }

  // =========================================================================
  // Filtering
  // =========================================================================
  function filters() {
    return {
      q: el('search').value.trim().toLowerCase(),
      section: el('filterSection').value,
      project: el('filterProject').value,
      person: el('filterPerson').value,
      starred: el('starBtn').getAttribute('aria-pressed') === 'true',
      hideDone: el('hideDoneBtn').getAttribute('aria-pressed') === 'true',
    };
  }

  function matches(task, f) {
    if (f.starred && !task.starred) return false;
    if (f.hideDone && task.status === 'done') return false;
    if (f.section && task.section !== f.section) return false;
    if (f.project && (task.project || '') !== f.project) return false;
    if (f.person && (task.assignee || '') !== (f.person === '__none' ? '' : f.person)) return false;
    if (f.q) {
      const hay = [task.key, task.title, task.notes, task.project, task.assignee,
        ...task.subtasks.map((s) => s.title)].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  }

  const tasksOn = (date, f) =>
    state.tasks.filter((t) => t.date === date && matches(t, f)).sort(compare);

  // Two orderings. 'manual' honours where you dragged a card, which means the
  // manual order has to outrank everything except finished work sinking down.
  // 'time' schedules the day for you and ignores manual placement.
  function compare(a, b) {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (b.status === 'done' && a.status !== 'done') return -1;
    if (state.sort === 'time') {
      if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
      if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
      if (a.time && !b.time) return -1;
      if (!a.time && b.time) return 1;
    }
    return a.order < b.order ? -1 : 1;
  }

  const unfinishedOn = (date) => state.tasks.filter((t) => t.date === date && t.status !== 'done');

  // =========================================================================
  // Rendering
  // =========================================================================
  function render() {
    view.textContent = '';
    view.dataset.view = ui.view;
    if (ui.view === 'day') renderDay();
    else if (ui.view === 'week') renderWeek(weekDates(ui.cursor));
    else if (ui.view === 'workweek') renderWeek(weekDates(ui.cursor, 5));
    else renderMonth();
    syncChrome();
  }

  function syncChrome() {
    document.querySelectorAll('.segmented button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.view === ui.view));
    });

    if (ui.view === 'day') {
      el('periodTitle').textContent = dayLabel(ui.cursor);
    } else if (ui.view === 'week' || ui.view === 'workweek') {
      const w = weekDates(ui.cursor, ui.view === 'workweek' ? 5 : 7);
      const last = w[w.length - 1];
      const sameMonth = parse(w[0]).getMonth() === parse(last).getMonth();
      const a = parse(w[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const b = parse(last).toLocaleDateString(undefined,
        sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
      el('periodTitle').textContent = `${a} – ${b}`;
    } else {
      el('periodTitle').textContent =
        parse(ui.cursor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }

    fillSectionSelect(el('filterSection'), 'All sections');
    fillSectionSelect(form.elements.namedItem('section'));

    const projects = [...new Set(state.tasks.map((t) => t.project).filter(Boolean))].sort();
    const sel = el('filterProject');
    const keep = sel.value;
    sel.textContent = '';
    sel.append(new Option('All projects', ''));
    projects.forEach((p) => sel.append(new Option(p, p)));
    sel.value = projects.includes(keep) ? keep : '';
    const dl = el('projectList');
    dl.textContent = '';
    projects.forEach((p) => dl.append(Object.assign(document.createElement('option'), { value: p })));

    const people = [...new Set(state.tasks.map((t) => t.assignee).filter(Boolean))].sort();
    const psel = el('filterPerson');
    const keepPerson = psel.value;
    psel.textContent = '';
    psel.append(new Option('Everyone', ''));
    people.forEach((p) => psel.append(new Option(p, p)));
    if (state.tasks.some((t) => !t.assignee)) psel.append(new Option('Unassigned', '__none'));
    psel.value = [...people, '__none'].includes(keepPerson) ? keepPerson : '';
    const pdl = el('peopleList');
    pdl.textContent = '';
    people.forEach((p) => pdl.append(Object.assign(document.createElement('option'), { value: p })));

    updateSummary();
  }

  function fillSectionSelect(sel, blankLabel) {
    const keep = sel.value;
    sel.textContent = '';
    if (blankLabel) sel.append(new Option(blankLabel, ''));
    state.sections.forEach((x) => sel.append(new Option(x.name, x.id)));
    const ids = state.sections.map((x) => x.id);
    sel.value = ids.includes(keep) ? keep : (blankLabel ? '' : ids[0]);
  }

  function updateSummary() {
    const open = state.tasks.filter((t) => t.status !== 'done');
    const due = open.filter((t) => t.date === todayISO()).length;
    const late = open.filter((t) => t.date < todayISO()).length;
    const parts = [due ? `${due} left today` : 'nothing left today'];
    if (late) parts.push(`${late} overdue`);
    el('dueSummary').textContent = parts.join(' · ');
  }

  // ---- day view: status columns, each split into Project / Non-project -----
  function renderDay() {
    const f = filters();
    const board = document.createElement('div');
    board.className = 'board';

    for (const status of STATUSES) {
      const col = document.createElement('section');
      col.className = 'column';
      col.dataset.status = status.id;

      const all = tasksOn(ui.cursor, f).filter((t) => t.status === status.id);

      const head = document.createElement('div');
      head.className = 'column-head';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.dataset.status = status.id;
      head.append(dot, status.name);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = all.length;
      head.append(count);
      col.append(head);

      const body = document.createElement('div');
      body.className = 'column-body';

      for (const section of state.sections) {
        const group = document.createElement('div');
        group.className = 'group';
        group.dataset.date = ui.cursor;
        group.dataset.section = section.id;
        group.dataset.status = status.id;

        const label = sectionHeading(section);
        const n = document.createElement('span');
        n.className = 'group-count';
        const items = all.filter((t) => t.section === section.id);
        n.textContent = items.length;
        label.append(n);
        group.append(label);

        const list = document.createElement('ul');
        list.className = 'cards';
        list.dataset.status = status.id;
        list.dataset.section = section.id;
        list.dataset.date = ui.cursor;
        if (!items.length) list.classList.add('is-empty');
        items.forEach((t) => list.append(card(t)));

        // The scroller holds the cards and the add button together, so the
        // button always sits directly under the last card.
        const scroll = document.createElement('div');
        scroll.className = 'group-scroll';
        scroll.append(list);
        if (status.id !== 'done') {
          const quick = quickAdd({ status: status.id, section: section.id, date: ui.cursor });
          scroll.append(quick);
          openOnBlankClick(scroll, list, quick);
        }
        group.append(scroll);
        // The whole group accepts drops — its header and blank space included —
        // so you never have to aim at a thin strip between cards.
        dropTarget(group, { status: status.id, section: section.id, date: ui.cursor }, list);
        body.append(group);
      }

      col.append(body);
      dropTarget(col, { status: status.id, date: ui.cursor }, col.querySelector('.cards'));
      board.append(col);
    }

    view.append(dayToolbar(), board);
  }

  // Rollover control lives with the day it acts on.
  function dayToolbar() {
    const bar = document.createElement('div');
    bar.className = 'daybar';

    const left = document.createElement('div');
    left.className = 'daybar-left';
    const date = document.createElement('strong');
    date.textContent = parse(ui.cursor).toLocaleDateString(undefined,
      { weekday: 'long', month: 'long', day: 'numeric' });
    left.append(date);
    if (ui.cursor === todayISO()) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Today';
      left.append(tag);
    }
    bar.append(left);

    const pending = unfinishedOn(ui.cursor).length;
    const roll = document.createElement('button');
    roll.className = 'ghost wide';
    let nextDay = addDays(ui.cursor, 1);
    if (ui.view === 'workweek') while (isWeekend(nextDay)) nextDay = addDays(nextDay, 1);
    const when = nextDay === addDays(todayISO(), 1) ? 'tomorrow'
      : parse(nextDay).toLocaleDateString(undefined, { weekday: 'long' });
    roll.textContent = pending ? `Move ${pending} unfinished to ${when}` : 'Nothing to move';
    roll.disabled = !pending;
    roll.addEventListener('click', () => rollDay(ui.cursor));
    bar.append(roll);
    return bar;
  }

  // ---- week view: one column per day --------------------------------------
  function renderWeek(dates) {
    const f = filters();
    const board = document.createElement('div');
    board.className = 'board week';

    for (const date of dates) {
      const col = document.createElement('section');
      col.className = 'column day-column';
      if (date === todayISO()) col.classList.add('is-today');
      if (['Sat', 'Sun'].includes(WEEKDAYS[(parse(date).getDay() + 6) % 7])) col.classList.add('weekend');

      const head = document.createElement('div');
      head.className = 'column-head day-head';
      const name = document.createElement('span');
      name.className = 'dow';
      name.textContent = WEEKDAYS[(parse(date).getDay() + 6) % 7];
      const num = document.createElement('span');
      num.className = 'dnum';
      num.textContent = parse(date).getDate();
      num.title = 'Open this day';
      num.addEventListener('click', () => { ui.view = 'day'; ui.cursor = date; render(); });
      head.append(name, num);

      const pending = unfinishedOn(date).length;
      const roll = document.createElement('button');
      roll.className = 'icon';
      roll.textContent = '↦';
      roll.title = pending ? `Move ${pending} unfinished to the next day` : 'Nothing to move';
      roll.disabled = !pending;
      roll.addEventListener('click', () => rollDay(date));
      head.append(roll);
      col.append(head);

      const body = document.createElement('div');
      body.className = 'column-body';

      for (const section of state.sections) {
        const group = document.createElement('div');
        group.className = 'group';
        group.dataset.date = date;
        group.dataset.section = section.id;

        group.append(sectionHeading(section));

        const list = document.createElement('ul');
        list.className = 'cards';
        const items = tasksOn(date, f).filter((t) => t.section === section.id);
        if (!items.length) list.classList.add('is-empty');
        items.forEach((t) => list.append(card(t, true)));

        const scroll = document.createElement('div');
        scroll.className = 'group-scroll';
        const quick = quickAdd({ section: section.id, date }, true);
        scroll.append(list, quick);
        openOnBlankClick(scroll, list, quick);
        group.append(scroll);
        dropTarget(group, { section: section.id, date }, list);
        body.append(group);
      }
      col.append(body);
      // Anywhere else in the column still reschedules to this day.
      dropTarget(col, { date }, col.querySelector('.cards'));
      board.append(col);
    }
    view.append(board);
  }

  // ---- month view: calendar grid ------------------------------------------
  function renderMonth() {
    const f = filters();
    const wrap = document.createElement('div');
    wrap.className = 'month';

    const header = document.createElement('div');
    header.className = 'month-head';
    WEEKDAYS.forEach((d) => {
      const c = document.createElement('div');
      c.textContent = d;
      header.append(c);
    });
    wrap.append(header);

    const grid = document.createElement('div');
    grid.className = 'month-grid';
    const month = parse(ui.cursor).getMonth();

    for (const date of monthGrid(ui.cursor)) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (parse(date).getMonth() !== month) cell.classList.add('outside');
      if (date === todayISO()) cell.classList.add('is-today');

      const head = document.createElement('div');
      head.className = 'cell-head';
      const num = document.createElement('button');
      num.className = 'dnum';
      num.textContent = parse(date).getDate();
      num.title = 'Open this day';
      num.addEventListener('click', () => { ui.view = 'day'; ui.cursor = date; render(); });
      head.append(num);

      const pending = unfinishedOn(date).length;
      if (pending) {
        const badge = document.createElement('span');
        badge.className = 'count';
        badge.textContent = pending;
        head.append(badge);
      }
      cell.append(head);

      const list = document.createElement('ul');
      list.className = 'cards mini';
      const items = tasksOn(date, f);
      items.slice(0, 4).forEach((t) => list.append(miniCard(t)));
      if (items.length > 4) {
        const more = document.createElement('li');
        more.className = 'more';
        more.textContent = `+${items.length - 4} more`;
        more.addEventListener('click', () => { ui.view = 'day'; ui.cursor = date; render(); });
        list.append(more);
      }
      dropTarget(cell, { date }, list);
      cell.append(list);

      const add = document.createElement('button');
      add.className = 'cell-add';
      add.textContent = '+';
      add.title = 'Add a task on this day';
      add.addEventListener('click', () => openModal(null, { date }));
      cell.append(add);

      grid.append(cell);
    }
    wrap.append(grid);
    view.append(wrap);
  }

  // =========================================================================
  // Cards
  // =========================================================================
  function card(task, compact) {
    const li = document.createElement('li');
    li.className = 'card';
    if (task.status === 'done') li.classList.add('is-done');
    if (task.status === 'doing') li.classList.add('is-doing');
    if (task.starred) li.classList.add('is-starred');
    if (compact) li.classList.add('compact');
    li.draggable = true;
    li.dataset.id = task.id;
    li.tabIndex = 0;

    const top = document.createElement('div');
    top.className = 'card-top';

    const box = document.createElement('button');
    box.className = 'check';
    box.dataset.status = task.status;
    box.setAttribute('aria-label',
      `${STATUS_VERB[task.status]} — click for ${STATUS_VERB[NEXT_STATUS[task.status]].toLowerCase()}`);
    box.title = box.getAttribute('aria-label');
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      // Shift-click jumps straight to done, skipping in-progress.
      setStatus(task, e.shiftKey && task.status !== 'done' ? 'done' : NEXT_STATUS[task.status]);
      render();
    });
    top.append(box);

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = task.title;
    top.append(title);

    const star = document.createElement('button');
    star.className = 'star';
    star.textContent = task.starred ? '★' : '☆';
    star.setAttribute('aria-pressed', String(!!task.starred));
    star.title = task.starred ? 'Remove from favourites' : 'Add to favourites';
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      task.starred = !task.starred;
      save();
      render();
    });
    top.append(star);
    li.append(top);

    const meta = document.createElement('div');
    meta.className = 'card-foot';
    let hasMeta = false;

    if (task.time) {
      hasMeta = true;
      const t = document.createElement('span');
      t.className = 'time';
      const late = task.status !== 'done' && task.date < todayISO();
      if (late) t.dataset.state = 'overdue';
      t.textContent = fmtTime(task.time);
      meta.append(t);
    }
    if (task.project && !compact) {
      hasMeta = true;
      const p = document.createElement('span');
      p.className = 'chip';
      p.textContent = task.project;
      meta.append(p);
    }
    if (task.rolledFrom) {
      hasMeta = true;
      const r = document.createElement('span');
      r.className = 'rolled';
      r.textContent = '↦';
      r.title = `Moved from ${task.rolledFrom}`;
      meta.append(r);
    }
    if (task.priority === 'high') {
      hasMeta = true;
      meta.append(priorityMark(task.priority));
    }
    meta.append(Object.assign(document.createElement('span'), { className: 'spacer' }));

    if (task.assignee) {
      hasMeta = true;
      meta.append(avatar(task.assignee));
    }

    if (task.subtasks.length) {
      hasMeta = true;
      const done = task.subtasks.filter((s) => s.done).length;
      const toggle = document.createElement('button');
      toggle.className = 'sub-toggle';
      toggle.setAttribute('aria-expanded', String(!task.collapsed));
      toggle.textContent = `${done}/${task.subtasks.length}`;
      toggle.title = task.collapsed ? 'Show subtasks' : 'Hide subtasks';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        task.collapsed = !task.collapsed;
        save();
        render();
      });
      meta.append(toggle);
    }
    if (hasMeta) li.append(meta);

    if (task.subtasks.length && !task.collapsed) li.append(subList(task));

    li.addEventListener('click', () => openModal(task.id));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openModal(task.id);
      if (e.key === ' ') {
        e.preventDefault();
        setStatus(task, NEXT_STATUS[task.status]);
        render();
      }
      if (e.key === 'f') {
        e.preventDefault();
        task.starred = !task.starred;
        save();
        render();
      }
    });
    li.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      draggingId = task.id;
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
      draggingId = null;
      li.classList.remove('dragging');
      clearInsertPoint();
      view.querySelectorAll('.over').forEach((n) => n.classList.remove('over'));
    });
    return li;
  }

  function subList(task) {
    const ul = document.createElement('ul');
    ul.className = 'subs';
    task.subtasks.forEach((sub) => {
      const li = document.createElement('li');
      const box = document.createElement('button');
      box.className = 'check small';
      box.setAttribute('aria-pressed', String(sub.done));
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        sub.done = !sub.done;
        // Ticking any subtask means work has begun on the parent.
        if (sub.done && task.status === 'todo') task.status = 'doing';
        save();
        render();
      });
      const span = document.createElement('span');
      span.className = 'sub-title';
      span.textContent = sub.title;
      if (sub.done) span.classList.add('struck');
      li.append(box, span);
      ul.append(li);
    });
    return ul;
  }

  function miniCard(task) {
    const li = document.createElement('li');
    li.className = 'mini-card';
    li.dataset.id = task.id;
    li.draggable = true;
    if (task.status === 'done') li.classList.add('is-done');
    if (task.status === 'doing') li.classList.add('is-doing');
    if (task.starred) li.classList.add('is-starred');
    li.dataset.section = task.section;
    li.append(Object.assign(document.createElement('span'), { textContent: task.title }));
    if (task.starred) {
      li.prepend(Object.assign(document.createElement('span'),
        { className: 'mini-star', textContent: '★' }));
    }
    if (task.subtasks.length) {
      const done = task.subtasks.filter((x) => x.done).length;
      const badge = document.createElement('span');
      badge.className = 'mini-subs';
      badge.textContent = `${done}/${task.subtasks.length}`;
      li.append(badge);
    }
    li.title = task.subtasks.length
      ? `${task.title}\n· ${task.subtasks.map((x) => `${x.done ? '✓' : '○'} ${x.title}`).join('\n· ')}`
      : task.title;
    li.addEventListener('click', (e) => { e.stopPropagation(); openModal(task.id); });
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    return li;
  }

  // Initials in a ring — monochrome, so it reads as an owner without colour.
  function avatar(name) {
    const span = document.createElement('span');
    span.className = 'avatar';
    span.title = name;
    span.textContent = name.trim().split(/\s+/).slice(0, 2)
      .map((w) => w[0].toUpperCase()).join('');
    return span;
  }

  function priorityMark(priority) {
    const wrap = document.createElement('span');
    wrap.className = 'prio';
    wrap.dataset.priority = priority;
    wrap.title = `${priority} priority`;
    const filled = PRIORITY_BARS[priority] ?? 2;
    for (let i = 1; i <= 3; i += 1) {
      const bar = document.createElement('i');
      if (i <= filled) bar.className = 'on';
      wrap.append(bar);
    }
    return wrap;
  }

  // =========================================================================
  // Drag and drop. A drop applies whichever fields the zone declares, so the
  // same handler moves a task between statuses, sections, and days.
  // =========================================================================
  let draggingId = null;

  function dropTarget(zone, patch, listForOrder) {
    const list = listForOrder || zone;
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('over');
      showInsertPoint(list, e.clientY);
    });
    zone.addEventListener('dragleave', (e) => {
      if (zone.contains(e.relatedTarget)) return;
      zone.classList.remove('over');
      clearInsertPoint();
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('over');
      clearInsertPoint();
      const task = byId(e.dataTransfer.getData('text/plain')) || byId(draggingId);
      if (!task) return;
      // Dragging is an explicit placement, so respect it even under time sort.
      if (state.sort === 'time') {
        state.sort = 'manual';
        syncSortBtn();
      }
      if (patch.status && patch.status !== task.status) setStatus(task, patch.status);
      if (patch.section) task.section = patch.section;
      if (patch.date) task.date = patch.date;
      task.order = orderAt(list, e.clientY, task.id);
      draggingId = null;
      save();
      render();
    });
  }

  // A line showing exactly where the card will land.
  function clearInsertPoint() {
    view.querySelectorAll('.drop-before,.drop-after')
      .forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  }

  function showInsertPoint(list, y) {
    clearInsertPoint();
    const cards = [...list.querySelectorAll('.card,.mini-card')]
      .filter((c) => !c.classList.contains('dragging'));
    if (!cards.length) {
      list.classList.add('drop-before');
      return;
    }
    for (const node of cards) {
      const box = node.getBoundingClientRect();
      if (y <= box.top + box.height / 2) {
        node.classList.add('drop-before');
        return;
      }
    }
    cards[cards.length - 1].classList.add('drop-after');
  }

  function orderAt(list, y, draggedId) {
    const peers = [...list.querySelectorAll('.card,.mini-card')]
      .filter((c) => c.dataset.id !== draggedId)
      .map((c) => byId(c.dataset.id))
      .filter(Boolean);
    let before = null;
    let after = null;
    for (const peer of peers) {
      const node = list.querySelector(`[data-id="${peer.id}"]`);
      const box = node.getBoundingClientRect();
      if (y > box.top + box.height / 2) before = peer;
      else { after = peer; break; }
    }
    return midKey(before ? before.order : '', after ? after.order : '');
  }

  // =========================================================================
  // Rolling unfinished work forward
  // =========================================================================
  const isWeekend = (isoStr) => [0, 6].includes(parse(isoStr).getDay());

  function rollDay(date) {
    const pending = unfinishedOn(date);
    if (!pending.length) return;
    // In the work-week view, Friday's leftovers belong on Monday.
    let target = addDays(date, 1);
    if (ui.view === 'workweek') {
      while (isWeekend(target)) target = addDays(target, 1);
    }
    pending.forEach((t) => {
      t.date = target;
      t.rolledFrom = date;
    });
    save();
    // Follow the work when looking at a single day.
    if (ui.view === 'day' && ui.cursor === date) ui.cursor = target;
    render();
  }

  function rollOverdue() {
    const stale = state.tasks.filter((t) => t.status !== 'done' && t.date < todayISO());
    if (!stale.length) {
      alert('Nothing overdue.');
      return;
    }
    if (!confirm(`Move ${stale.length} unfinished task${stale.length > 1 ? 's' : ''} to today?`)) return;
    stale.forEach((t) => {
      t.rolledFrom = t.date;
      t.date = todayISO();
    });
    save();
    render();
  }

  // =========================================================================
  // Quick add
  // =========================================================================
  function quickAdd(patch, compact) {
    const wrap = document.createElement('div');
    wrap.className = 'quick';

    const btn = document.createElement('button');
    btn.className = 'add-card';
    btn.textContent = compact ? '+' : '+ Add task';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Task, then Enter';
    input.hidden = true;

    const open = () => {
      btn.hidden = true;
      input.hidden = false;
      input.focus();
    };
    wrap.openInput = open;
    btn.addEventListener('click', open);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; input.blur(); return; }
      if (e.key !== 'Enter') return;
      const title = input.value.trim();
      if (!title) return;
      createTask(Object.assign({ title }, patch));
      input.value = '';
      render();
      reopenQuickAdd(patch);
    });
    input.addEventListener('blur', () => {
      if (input.value.trim()) return;
      input.hidden = true;
      btn.hidden = false;
    });

    wrap.append(btn, input);
    return wrap;
  }

  // Double-clicking a section heading turns it into an input; Enter or blur
  // commits, Escape abandons. Renaming is frequent, so it lives on the board.
  function sectionHeading(section) {
    const head = document.createElement('div');
    head.className = 'group-head';

    const text = document.createElement('span');
    text.className = 'group-name';
    text.textContent = section.name;
    text.title = 'Double-click to rename';
    head.append(text);

    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('.group-count')) return;
      const input = document.createElement('input');
      input.className = 'group-rename';
      input.value = section.name;
      input.maxLength = 40;

      const commit = (save_) => {
        if (!input.isConnected) return;
        const name = input.value.trim();
        if (save_ && name && name !== section.name) {
          const live = state.sections.find((x) => x.id === section.id);
          if (live) { live.name = name; save(); }
        }
        render();
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
      });
      input.addEventListener('blur', () => commit(true));

      text.replaceWith(input);
      input.focus();
      input.select();
    });
    return head;
  }

  // Clicks that land on a section's empty space — not on a card — start a new
  // task there, so the whole section is a target and not just the button.
  function openOnBlankClick(scroll, list, quick) {
    scroll.addEventListener('click', (e) => {
      if (e.target !== scroll && e.target !== list) return;
      quick.openInput();
    });
  }

  // Re-render replaces the node, so find the equivalent input and refocus it.
  function reopenQuickAdd(patch) {
    const target = [...view.querySelectorAll('.group')].find((g) =>
      (!patch.date || g.dataset.date === patch.date)
      && (!patch.section || g.dataset.section === patch.section)
      && (!patch.status || g.dataset.status === patch.status));
    const input = target && target.querySelector('.quick input');
    if (!input) return;
    input.previousElementSibling.hidden = true;
    input.hidden = false;
    input.focus();
    // Keep the section you are typing into in view after the re-render.
    target.querySelector('.group-scroll').scrollTop = target.querySelector('.group-scroll').scrollHeight;
  }

  // =========================================================================
  // Modal
  // =========================================================================
  const modal = el('modal');
  const form = el('taskForm');
  const field = (name) => form.elements.namedItem(name);
  let editingId = null;
  let draftSubs = [];

  el('statusSelect').append(...STATUSES.map((s) => new Option(s.name, s.id)));

  function openModal(id, preset = {}) {
    editingId = id || null;
    const task = id ? byId(id) : null;
    el('modalTitle').textContent = task ? `Edit ${task.key}` : 'New task';
    el('deleteBtn').hidden = !task;
    form.reset();

    if (task) {
      field('title').value = task.title;
      field('notes').value = task.notes || '';
      field('section').value = task.section;
      field('project').value = task.project || '';
      field('assignee').value = task.assignee || '';
      field('date').value = task.date;
      field('time').value = task.time || '';
      field('status').value = task.status;
      field('priority').value = task.priority;
      draftSubs = task.subtasks.map((s) => ({ ...s }));
    } else {
      field('section').value = preset.section || firstSectionId();
      field('date').value = preset.date || ui.cursor;
      field('status').value = preset.status || 'todo';
      draftSubs = [];
    }
    renderSubs();
    modal.hidden = false;
    field('title').focus();
  }

  function closeModal() {
    modal.hidden = true;
    editingId = null;
    draftSubs = [];
  }



  function renderSubs() {
    const list = el('subList');
    list.textContent = '';
    draftSubs.forEach((sub, i) => {
      const li = document.createElement('li');
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'check small';
      box.setAttribute('aria-pressed', String(sub.done));
      box.addEventListener('click', () => { sub.done = !sub.done; renderSubs(); });

      const text = document.createElement('input');
      text.type = 'text';
      text.value = sub.title;
      text.className = 'sub-text';
      if (sub.done) text.classList.add('struck');
      text.addEventListener('input', () => { sub.title = text.value; });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon';
      del.textContent = '✕';
      del.title = 'Remove subtask';
      del.addEventListener('click', () => { draftSubs.splice(i, 1); renderSubs(); });

      li.append(box, text, del);
      list.append(li);
    });
    const done = draftSubs.filter((s) => s.done).length;
    el('subCount').textContent = draftSubs.length ? `${done}/${draftSubs.length}` : '';
  }

  el('subInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const title = e.target.value.trim();
    if (!title) return;
    draftSubs.push({ id: crypto.randomUUID(), title, done: false });
    e.target.value = '';
    renderSubs();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const section = field('section').value;
    const data = {
      title: field('title').value.trim(),
      notes: field('notes').value.trim(),
      section,
      project: field('project').value.trim(),
      assignee: field('assignee').value.trim(),
      date: field('date').value || todayISO(),
      time: field('time').value || null,
      status: field('status').value,
      priority: field('priority').value,
      subtasks: draftSubs.filter((s) => s.title.trim()),
    };
    if (!data.title) return;

    if (editingId) {
      const task = byId(editingId);
      const wasDone = task.status === 'done';
      Object.assign(task, data);
      if (data.status === 'done' && !wasDone) task.completedAt = Date.now();
      if (data.status !== 'done') task.completedAt = null;
    } else {
      createTask(data);
    }
    save();
    closeModal();
    render();
  });

  el('deleteBtn').addEventListener('click', () => {
    const task = byId(editingId);
    if (!task || !confirm(`Delete "${task.title}"?`)) return;
    state.tasks = state.tasks.filter((t) => t.id !== editingId);
    save();
    closeModal();
    render();
  });

  el('cancelBtn').addEventListener('click', closeModal);
  el('modalClose').addEventListener('click', closeModal);
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });

  // =========================================================================
  // Sections manager: add, reorder, delete. Renaming also works here, but the
  // fast path is double-clicking the heading on the board.
  // =========================================================================
  const sectionsModal = el('sectionsModal');

  function slug(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    let id = base;
    let n = 2;
    while (state.sections.some((x) => x.id === id)) id = `${base}-${n++}`;
    return id;
  }

  const countIn = (id) => state.tasks.filter((t) => t.section === id).length;

  let draggingSection = null;

  function moveSection(from, to) {
    if (to < 0 || to >= state.sections.length || from === to) return;
    const [moved] = state.sections.splice(from, 1);
    state.sections.splice(to, 0, moved);
    const prev = state.sections[to - 1];
    const next = state.sections[to + 1];
    moved.order = midKey(prev ? prev.order : '', next ? next.order : '');
    save();
    renderSections();
    render();
  }

  const clearSectionMarks = () => el('sectionsList')
    .querySelectorAll('.drop-before,.drop-after')
    .forEach((n) => n.classList.remove('drop-before', 'drop-after'));

  function renderSections() {
    const list = el('sectionsList');
    list.textContent = '';
    wireSectionDrop(list);

    state.sections.forEach((section, i) => {
      const li = document.createElement('li');
      li.className = 'section-row';

      li.dataset.id = section.id;

      const handle = document.createElement('button');
      handle.className = 'drag-handle';
      handle.type = 'button';
      handle.textContent = '⠿';
      handle.title = 'Drag to reorder (or use the arrow keys)';
      handle.setAttribute('aria-label', `Reorder ${section.name}`);
      // The row is only draggable while the handle is held, so the name field
      // stays editable and selectable the rest of the time.
      handle.addEventListener('mousedown', () => { li.draggable = true; });
      handle.addEventListener('touchstart', () => { li.draggable = true; }, { passive: true });
      handle.addEventListener('keydown', (e) => {
        const delta = e.key === 'ArrowUp' ? -1 : (e.key === 'ArrowDown' ? 1 : 0);
        if (!delta) return;
        e.preventDefault();
        moveSection(i, i + delta);
        const rows = el('sectionsList').querySelectorAll('.drag-handle');
        if (rows[i + delta]) rows[i + delta].focus();
      });
      li.append(handle);

      li.addEventListener('dragstart', (e) => {
        draggingSection = section.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', section.id);
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => {
        draggingSection = null;
        li.draggable = false;
        li.classList.remove('dragging');
        clearSectionMarks();
      });

      const name = document.createElement('input');
      name.className = 'section-name';
      name.value = section.name;
      name.maxLength = 40;
      name.addEventListener('change', () => {
        const value = name.value.trim();
        if (!value) { name.value = section.name; return; }
        section.name = value;
        save();
        render();
      });
      li.append(name);

      const count = document.createElement('span');
      count.className = 'section-count';
      const n = countIn(section.id);
      count.textContent = `${n} task${n === 1 ? '' : 's'}`;
      count.title = 'Tasks currently in this section';
      if (!n) count.classList.add('is-zero');
      li.append(count);

      const del = document.createElement('button');
      del.className = 'icon';
      del.textContent = '✕';
      del.title = 'Delete section';
      del.disabled = state.sections.length < 2;
      del.addEventListener('click', () => askDelete(li, section));
      li.append(del);

      list.append(li);
    });
  }

  // Reordering by drag: the row under the cursor shows where it will land.
  function wireSectionDrop(list) {
    if (list.dataset.wired) return;
    list.dataset.wired = '1';

    list.addEventListener('dragover', (e) => {
      if (!draggingSection) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearSectionMarks();
      const rows = [...list.querySelectorAll('.section-row:not(.dragging)')];
      const after = rows.find((r) => {
        const box = r.getBoundingClientRect();
        return e.clientY <= box.top + box.height / 2;
      });
      if (after) after.classList.add('drop-before');
      else if (rows.length) rows[rows.length - 1].classList.add('drop-after');
    });

    list.addEventListener('drop', (e) => {
      if (!draggingSection) return;
      e.preventDefault();
      const rows = [...list.querySelectorAll('.section-row')];
      const from = state.sections.findIndex((x) => x.id === draggingSection);
      const others = rows.filter((r) => r.dataset.id !== draggingSection);
      const afterRow = others.find((r) => {
        const box = r.getBoundingClientRect();
        return e.clientY <= box.top + box.height / 2;
      });
      const targetId = afterRow ? afterRow.dataset.id : null;
      clearSectionMarks();
      draggingSection = null;
      if (targetId === null) { moveSection(from, state.sections.length - 1); return; }
      let to = state.sections.findIndex((x) => x.id === targetId);
      if (from < to) to -= 1;
      moveSection(from, to);
    });

    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) clearSectionMarks();
    });
  }

  // Deleting a section with work in it has to say where that work goes.
  function askDelete(row, section) {
    if (row.nextElementSibling && row.nextElementSibling.classList.contains('confirm-row')) {
      row.nextElementSibling.remove();
      return;
    }
    const n = countIn(section.id);
    const confirmRow = document.createElement('li');
    confirmRow.className = 'confirm-row';

    if (!n) {
      confirmRow.append(Object.assign(document.createElement('span'),
        { textContent: `Delete “${section.name}”?` }));
    } else {
      confirmRow.append(Object.assign(document.createElement('span'),
        { textContent: `Move ${n} task${n === 1 ? '' : 's'} to` }));
      const sel = document.createElement('select');
      state.sections.filter((x) => x.id !== section.id)
        .forEach((x) => sel.append(new Option(x.name, x.id)));
      sel.className = 'section-target';
      confirmRow.append(sel);
    }

    const go = document.createElement('button');
    go.className = 'danger';
    go.textContent = n ? 'Move & delete' : 'Delete';
    go.addEventListener('click', () => {
      const target = confirmRow.querySelector('.section-target');
      if (target) {
        state.tasks.forEach((t) => { if (t.section === section.id) t.section = target.value; });
      }
      state.sections = state.sections.filter((x) => x.id !== section.id);
      save();
      renderSections();
      render();
    });

    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => confirmRow.remove());

    confirmRow.append(Object.assign(document.createElement('span'), { className: 'spacer' }), cancel, go);
    row.after(confirmRow);
  }

  el('sectionAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el('sectionAddInput');
    const name = input.value.trim();
    if (!name) return;
    const last = state.sections[state.sections.length - 1];
    state.sections.push({ id: slug(name), name, order: midKey(last ? last.order : '', '') });
    input.value = '';
    save();
    renderSections();
    render();
  });

  function openSections() {
    renderSections();
    sectionsModal.hidden = false;
    el('sectionAddInput').focus();
  }
  const closeSections = () => { sectionsModal.hidden = true; };

  el('sectionsBtn').addEventListener('click', openSections);
  el('sectionsClose').addEventListener('click', closeSections);
  el('sectionsDone').addEventListener('click', closeSections);
  sectionsModal.addEventListener('mousedown', (e) => {
    if (e.target === sectionsModal) closeSections();
  });

  // =========================================================================
  // Chrome: view switching, navigation, filters, menu
  // =========================================================================
  function setView(name) {
    ui.view = name;
    state.view = name;
    save();
    render();
  }

  document.querySelectorAll('.segmented button').forEach((b) => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });

  const step = (n) => {
    if (ui.view === 'day') ui.cursor = addDays(ui.cursor, n);
    else if (ui.view === 'month') ui.cursor = addMonths(ui.cursor, n);
    else ui.cursor = addDays(ui.cursor, n * 7);
    render();
  };
  el('prevBtn').addEventListener('click', () => step(-1));
  el('nextBtn').addEventListener('click', () => step(1));
  el('todayBtn').addEventListener('click', () => { ui.cursor = todayISO(); render(); });

  el('newTaskBtn').addEventListener('click', () => openModal(null, { date: ui.cursor }));
  ['search', 'filterSection', 'filterProject', 'filterPerson'].forEach((id) => {
    el(id).addEventListener('input', render);
  });
  el('starBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') === 'true';
    e.currentTarget.setAttribute('aria-pressed', String(!on));
    render();
  });
  el('hideDoneBtn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') === 'true';
    e.currentTarget.setAttribute('aria-pressed', String(!on));
    render();
  });

  const menuList = el('menuList');
  el('menuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    menuList.hidden = !menuList.hidden;
  });
  document.addEventListener('click', () => { menuList.hidden = true; });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sectionsModal.hidden) { closeSections(); return; }
    if (e.key === 'Escape' && !modal.hidden) { closeModal(); return; }
    if (!modal.hidden || !sectionsModal.hidden) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (typing) return;
    if (e.key === 'n') { e.preventDefault(); openModal(null, { date: ui.cursor }); }
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 't') { ui.cursor = todayISO(); render(); }
    if (['1', '2', '3', '4'].includes(e.key)) {
      setView({ 1: 'day', 2: 'workweek', 3: 'week', 4: 'month' }[e.key]);
    }
  });

  const sortBtn = el('sortBtn');
  function syncSortBtn() {
    sortBtn.textContent = state.sort === 'time' ? 'Sort manually (drag)' : 'Sort by time';
  }
  sortBtn.addEventListener('click', () => {
    state.sort = state.sort === 'time' ? 'manual' : 'time';
    save();
    syncSortBtn();
    render();
  });
  syncSortBtn();

  el('rollOverdueBtn').addEventListener('click', rollOverdue);

  el('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'todo-board.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  el('importBtn').addEventListener('click', () => el('importFile').click());
  el('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const tasks = parsed.tasks || parsed.issues;
      if (!Array.isArray(tasks)) throw new Error('no tasks in that file');
      if (!confirm('Replace everything with the imported file?')) return;
      state = parsed.tasks
        ? Object.assign(blank(), parsed, { tasks: parsed.tasks.map(normalise) })
        : migrate(parsed);
      save();
      render();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  });

  el('resetBtn').addEventListener('click', () => {
    if (!confirm('Delete every task? This cannot be undone.')) return;
    state = blank();
    save();
    render();
  });

  el('seedBtn').addEventListener('click', () => {
    if (state.tasks.length && !confirm('Replace everything with sample data?')) return;
    state = blank();
    const d = (n) => addDays(todayISO(), n);
    const samples = [
      ['Draft Q4 planning doc', 'project', 'Roadmap', 'Kevin Jusak', d(0), '10:00', 'high', 'doing',
        ['Outline sections', 'Pull last quarter numbers', 'Share for review']],
      ['Review pull requests', 'project', 'Board App', 'Kevin Jusak', d(0), '15:00', 'high', 'todo', []],
      ['Fix drag-and-drop bug', 'project', 'Board App', 'Alex Kim', d(0), null, 'medium', 'todo',
        ['Reproduce', 'Write fix']],
      ['Standup', 'project', 'Roadmap', 'Kevin Jusak', d(0), '09:30', 'medium', 'done', []],
      ['Book dentist', 'personal', '', '', d(0), null, 'low', 'todo', []],
      ['Groceries', 'personal', '', '', d(0), '18:30', 'medium', 'todo',
        ['Coffee', 'Oat milk', 'Rice']],
      ['Deploy to Pages', 'project', 'Board App', 'Sam Rivera', d(1), null, 'high', 'todo', []],
      ['Gym', 'personal', '', '', d(1), '07:00', 'medium', 'todo', []],
      ['Team retro', 'project', 'Roadmap', 'Alex Kim', d(2), '14:00', 'medium', 'todo', []],
      ['Call mum', 'personal', '', '', d(3), null, 'medium', 'todo', []],
      ['Renew insurance', 'personal', '', '', d(-1), null, 'high', 'todo', []],
      ['Monthly report', 'project', 'Roadmap', 'Sam Rivera', d(9), null, 'medium', 'todo', []],
    ];
    samples.forEach(([title, section, project, assignee, date, time, priority, status, subs], i) => {
      createTask({
        title, section, project, assignee, date, time, priority, status, order: i,
        subtasks: subs.map((s) => ({ id: crypto.randomUUID(), title: s, done: status === 'done' })),
      });
    });
    save();
    render();
  });

  // ---- clock --------------------------------------------------------------
  let lastDay = todayISO();
  function tick() {
    const now = new Date();
    el('todayLabel').textContent =
      now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    el('clock').textContent = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (todayISO() !== lastDay) { lastDay = todayISO(); render(); }
    else updateSummary();
  }
  tick();
  setInterval(tick, 20000);

  render();
})();
