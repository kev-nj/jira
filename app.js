(() => {
  'use strict';

  const STORAGE_KEY = 'jira-board.v1';
  const COLUMNS = [
    { id: 'todo', name: 'To Do' },
    { id: 'inprogress', name: 'In Progress' },
    { id: 'review', name: 'In Review' },
    { id: 'done', name: 'Done' },
  ];
  const TYPE_LABEL = { story: 'Story', task: 'Task', bug: 'Bug', epic: 'Epic' };
  const PRIORITY_LABEL = {
    highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest',
  };
  // Bars drawn for each priority level, tallest first.
  const PRIORITY_BARS = { highest: 3, high: 3, medium: 2, low: 1, lowest: 1 };

  const el = (id) => document.getElementById(id);

  // ---- dates --------------------------------------------------------------
  const startOfDay = (d) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
  const todayISO = () => localISO(new Date());

  function localISO(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  // Days from today to `iso`: 0 today, negative in the past.
  function daysAway(iso) {
    return Math.round((startOfDay(new Date(`${iso}T00:00:00`)) - startOfDay(new Date())) / 86400000);
  }

  function dueState(issue) {
    if (!issue.due) return null;
    const days = daysAway(issue.due);
    if (issue.status === 'done') return 'done';
    if (days < 0) return 'overdue';
    if (days === 0) {
      if (!issue.dueTime) return 'today';
      const [h, m] = issue.dueTime.split(':').map(Number);
      const at = new Date(); at.setHours(h, m, 0, 0);
      return at < new Date() ? 'overdue' : 'today';
    }
    if (days === 1) return 'tomorrow';
    return days < 0 ? 'overdue' : 'later';
  }

  function dueText(issue) {
    const days = daysAway(issue.due);
    const time = issue.dueTime ? ` ${fmtTime(issue.dueTime)}` : '';
    if (days === 0) return `Today${time}`;
    if (days === 1) return `Tomorrow${time}`;
    if (days === -1) return `Yesterday${time}`;
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days <= 6) {
      const d = new Date(`${issue.due}T00:00:00`);
      return d.toLocaleDateString(undefined, { weekday: 'short' }) + time;
    }
    return new Date(`${issue.due}T00:00:00`)
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fmtTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const board = el('board');

  let state = load();

  function blank() {
    return { projectKey: 'JB', projectName: 'My Project', counter: 0, issues: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blank();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.issues)) return blank();
      return Object.assign(blank(), parsed);
    } catch (e) {
      console.warn('Could not read saved board, starting fresh.', e);
      return blank();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Could not save board.', e);
      alert('Saving failed — browser storage may be full or blocked.');
    }
  }

  function nextKey() {
    state.counter += 1;
    return `${state.projectKey}-${state.counter}`;
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }

  // ---- filtering ----------------------------------------------------------
  function activeFilters() {
    return {
      q: el('search').value.trim().toLowerCase(),
      assignee: el('filterAssignee').value,
      type: el('filterType').value,
      priority: el('filterPriority').value,
      today: el('todayBtn').getAttribute('aria-pressed') === 'true',
    };
  }

  function matches(issue, f) {
    if (f.today) {
      // Keep finished work visible in the day view — dueState() reports 'done'
      // for it, so test the date directly rather than the display state.
      if (!issue.due || daysAway(issue.due) > 0) return false;
    }
    if (f.assignee && (issue.assignee || '') !== f.assignee) return false;
    if (f.type && issue.type !== f.type) return false;
    if (f.priority && issue.priority !== f.priority) return false;
    if (f.q) {
      const hay = [issue.key, issue.title, issue.description, issue.assignee, ...(issue.labels || [])]
        .join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  }

  // ---- rendering ----------------------------------------------------------
  function render() {
    const f = activeFilters();
    board.textContent = '';

    for (const col of COLUMNS) {
      const issues = state.issues
        .filter((i) => i.status === col.id)
        .sort(byDueThenOrder);
      const shown = issues.filter((i) => matches(i, f));

      const section = document.createElement('section');
      section.className = 'column';
      section.dataset.status = col.id;

      const head = document.createElement('div');
      head.className = 'column-head';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.dataset.status = col.id;
      head.append(dot, col.name);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = shown.length;
      head.append(count);
      section.append(head);

      const list = document.createElement('ul');
      list.className = 'cards';
      if (!shown.length) {
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = issues.length ? 'No matching issues' : 'No issues';
        list.append(empty);
      }
      shown.forEach((issue) => list.append(cardFor(issue)));
      section.append(list);

      section.append(quickAdd(col.id));

      wireDrop(section, list);
      board.append(section);
    }

    refreshAssignees();
    updateDueSummary();
  }

  // Dated work floats to the top of a column, soonest first; undated keeps
  // whatever order the user dragged it into.
  function byDueThenOrder(a, b) {
    const ad = a.due ? `${a.due}T${a.dueTime || '23:59'}` : null;
    const bd = b.due ? `${b.due}T${b.dueTime || '23:59'}` : null;
    if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return a.order - b.order;
  }

  function cardFor(issue) {
    const li = document.createElement('li');
    li.className = 'card';
    li.draggable = true;
    li.dataset.id = issue.id;
    li.tabIndex = 0;

    const h3 = document.createElement('h3');
    h3.textContent = issue.title;
    li.append(h3);

    if (issue.labels && issue.labels.length) {
      const wrap = document.createElement('div');
      wrap.className = 'labels';
      issue.labels.forEach((l) => {
        const s = document.createElement('span');
        s.className = 'label';
        s.textContent = l;
        wrap.append(s);
      });
      li.append(wrap);
    }

    const foot = document.createElement('div');
    foot.className = 'card-foot';

    const type = document.createElement('span');
    type.className = 'chip';
    type.dataset.type = issue.type;
    type.textContent = TYPE_LABEL[issue.type] || issue.type;
    foot.append(type);

    foot.append(priorityMark(issue.priority));

    if (issue.due) {
      const due = document.createElement('span');
      due.className = 'due';
      due.dataset.state = dueState(issue);
      due.textContent = dueText(issue);
      due.title = `Due ${issue.due}${issue.dueTime ? ` at ${fmtTime(issue.dueTime)}` : ''}`;
      foot.append(due);
    }

    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = issue.key;
    foot.append(key);
    foot.append(Object.assign(document.createElement('span'), { className: 'spacer' }));
    if (issue.points != null && issue.points !== '') {
      const p = document.createElement('span');
      p.className = 'pts';
      p.textContent = issue.points;
      foot.append(p);
    }
    if (issue.assignee) {
      const a = document.createElement('span');
      a.className = 'avatar';
      a.title = issue.assignee;
      a.style.setProperty('--hue', hueFor(issue.assignee));
      a.textContent = initials(issue.assignee);
      foot.append(a);
    }
    li.append(foot);

    li.addEventListener('click', () => openModal(issue.id));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openModal(issue.id);
    });
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', issue.id);
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    return li;
  }

  // Inline capture: type a title, press Enter, keep typing. Faster than the
  // full dialog when you are just filling in the day.
  function quickAdd(status) {
    const wrap = document.createElement('div');
    wrap.className = 'quick';

    const btn = document.createElement('button');
    btn.className = 'add-card';
    btn.textContent = '+ Add task';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Task title, then Enter';
    input.hidden = true;

    btn.addEventListener('click', () => {
      btn.hidden = true;
      input.hidden = false;
      input.focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; input.blur(); return; }
      if (e.key !== 'Enter') return;
      const title = input.value.trim();
      if (!title) return;
      createIssue({ title, status, due: todayISO() });
      input.value = '';
      // Re-render replaces this node, so reopen the input in the new column.
      render();
      const fresh = board.querySelector(`.column[data-status="${status}"] .quick input`);
      if (fresh) { fresh.previousElementSibling.hidden = true; fresh.hidden = false; fresh.focus(); }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim()) return;
      input.hidden = true;
      btn.hidden = false;
    });

    wrap.append(btn, input);
    return wrap;
  }

  function createIssue(data) {
    const inCol = state.issues.filter((i) => i.status === data.status);
    const order = inCol.length ? Math.max(...inCol.map((i) => i.order)) + 1 : 0;
    state.issues.push(Object.assign({
      id: crypto.randomUUID(),
      key: nextKey(),
      description: '',
      type: 'task',
      priority: 'medium',
      points: null,
      assignee: '',
      labels: [],
      due: null,
      dueTime: null,
      order,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, data));
    save();
  }

  // Signal-strength style priority indicator: filled bars up to the level.
  function priorityMark(priority) {
    const wrap = document.createElement('span');
    wrap.className = 'prio';
    wrap.dataset.priority = priority;
    wrap.title = `${PRIORITY_LABEL[priority] || priority} priority`;
    const filled = PRIORITY_BARS[priority] ?? 2;
    for (let i = 1; i <= 3; i += 1) {
      const bar = document.createElement('i');
      if (i <= filled) bar.className = 'on';
      wrap.append(bar);
    }
    return wrap;
  }

  // Stable per-person accent so the same name always gets the same avatar colour.
  function hueFor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  // ---- drag & drop --------------------------------------------------------
  function wireDrop(section, list) {
    section.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      section.classList.add('over');
    });
    section.addEventListener('dragleave', (e) => {
      if (!section.contains(e.relatedTarget)) section.classList.remove('over');
    });
    section.addEventListener('drop', (e) => {
      e.preventDefault();
      section.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      const issue = state.issues.find((i) => i.id === id);
      if (!issue) return;
      issue.status = section.dataset.status;
      issue.order = orderAt(list, e.clientY, id);
      issue.updatedAt = Date.now();
      save();
      render();
    });
  }

  // Compute a fractional order between the neighbours at the drop point.
  function orderAt(list, y, draggedId) {
    const siblings = [...list.querySelectorAll('.card')]
      .filter((c) => c.dataset.id !== draggedId)
      .map((c) => ({ el: c, issue: state.issues.find((i) => i.id === c.dataset.id) }))
      .filter((s) => s.issue);
    let before = null;
    let after = null;
    for (const s of siblings) {
      const box = s.el.getBoundingClientRect();
      if (y > box.top + box.height / 2) before = s.issue;
      else { after = s.issue; break; }
    }
    if (!before && !after) return 0;
    if (!before) return after.order - 1;
    if (!after) return before.order + 1;
    return (before.order + after.order) / 2;
  }

  // ---- modal --------------------------------------------------------------
  const modal = el('modal');
  const form = el('issueForm');
  // form.title / form.status collide with HTMLFormElement's own DOM properties,
  // so always reach fields through form.elements.
  const field = (name) => form.elements.namedItem(name);
  let editingId = null;

  el('statusSelect').append(...COLUMNS.map((c) => new Option(c.name, c.id)));

  function openModal(id, presetStatus) {
    editingId = id || null;
    const issue = id ? state.issues.find((i) => i.id === id) : null;
    el('modalTitle').textContent = issue ? `Edit ${issue.key}` : 'Create issue';
    el('deleteBtn').hidden = !issue;
    form.reset();
    if (issue) {
      field('title').value = issue.title;
      field('description').value = issue.description || '';
      field('type').value = issue.type;
      field('priority').value = issue.priority;
      field('status').value = issue.status;
      field('points').value = issue.points ?? '';
      field('assignee').value = issue.assignee || '';
      field('labels').value = (issue.labels || []).join(', ');
      field('due').value = issue.due || '';
      field('dueTime').value = issue.dueTime || '';
    } else {
      field('status').value = presetStatus || COLUMNS[0].id;
      // A daily list is mostly "today", so default new work to today.
      field('due').value = todayISO();
    }
    modal.hidden = false;
    field('title').focus();
  }

  function closeModal() {
    modal.hidden = true;
    editingId = null;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      title: field('title').value.trim(),
      description: field('description').value.trim(),
      type: field('type').value,
      priority: field('priority').value,
      status: field('status').value,
      points: field('points').value === '' ? null : Number(field('points').value),
      assignee: field('assignee').value.trim(),
      labels: field('labels').value.split(',').map((v) => v.trim()).filter(Boolean),
      due: field('due').value || null,
      dueTime: field('dueTime').value || null,
    };
    if (!data.title) return;

    if (editingId) {
      const issue = state.issues.find((i) => i.id === editingId);
      Object.assign(issue, data, { updatedAt: Date.now() });
    } else {
      createIssue(data);
    }
    save();
    closeModal();
    render();
  });

  el('deleteBtn').addEventListener('click', () => {
    const issue = state.issues.find((i) => i.id === editingId);
    if (!issue || !confirm(`Delete ${issue.key}? This cannot be undone.`)) return;
    state.issues = state.issues.filter((i) => i.id !== editingId);
    save();
    closeModal();
    render();
  });

  el('cancelBtn').addEventListener('click', closeModal);
  el('modalClose').addEventListener('click', closeModal);
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
    if (e.key === 'c' && modal.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      openModal(null);
    }
  });

  // ---- toolbar ------------------------------------------------------------
  el('newIssueBtn').addEventListener('click', () => openModal(null));

  const todayBtn = el('todayBtn');
  todayBtn.addEventListener('click', () => {
    const on = todayBtn.getAttribute('aria-pressed') === 'true';
    todayBtn.setAttribute('aria-pressed', String(!on));
    render();
  });

  // ---- header clock -------------------------------------------------------
  let lastDay = todayISO();
  function tick() {
    const now = new Date();
    el('todayLabel').textContent =
      now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    el('clock').textContent =
      now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    // Crossing midnight, or a due time passing, changes what is overdue.
    if (todayISO() !== lastDay) { lastDay = todayISO(); render(); }
    else updateDueSummary();
  }

  function updateDueSummary() {
    const open = state.issues.filter((i) => i.status !== 'done');
    const due = open.filter((i) => dueState(i) === 'today').length;
    const late = open.filter((i) => dueState(i) === 'overdue').length;
    const parts = [];
    parts.push(due ? `${due} due today` : 'nothing due today');
    if (late) parts.push(`${late} overdue`);
    el('dueSummary').textContent = parts.join(' · ');
  }

  tick();
  setInterval(tick, 20000);
  ['search', 'filterAssignee', 'filterType', 'filterPriority'].forEach((id) => {
    el(id).addEventListener('input', render);
  });

  const menuList = el('menuList');
  el('menuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    menuList.hidden = !menuList.hidden;
  });
  document.addEventListener('click', () => { menuList.hidden = true; });

  function refreshAssignees() {
    const names = [...new Set(state.issues.map((i) => i.assignee).filter(Boolean))].sort();
    const sel = el('filterAssignee');
    const current = sel.value;
    sel.textContent = '';
    sel.append(new Option('All assignees', ''));
    names.forEach((n) => sel.append(new Option(n, n)));
    sel.value = names.includes(current) ? current : '';
    const dl = el('assigneeList');
    dl.textContent = '';
    names.forEach((n) => dl.append(Object.assign(document.createElement('option'), { value: n })));
    el('projectName').textContent = state.projectName;
  }

  el('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.projectKey}-board.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  el('importBtn').addEventListener('click', () => el('importFile').click());
  el('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.issues)) throw new Error('missing issues array');
      if (!confirm('Replace the current board with the imported file?')) return;
      state = Object.assign(blank(), parsed);
      save();
      render();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  });

  el('resetBtn').addEventListener('click', () => {
    if (!confirm('Clear all issues from this board?')) return;
    state = blank();
    save();
    render();
  });

  el('seedBtn').addEventListener('click', () => {
    if (state.issues.length && !confirm('Replace the current board with sample data?')) return;
    state = blank();
    const shift = (days) => {
      const d = new Date(); d.setDate(d.getDate() + days); return localISO(d);
    };
    const samples = [
      ['Morning standup notes', 'task', 'medium', 'done', 'Kevin Jusak', 1, [], shift(0), '09:30'],
      ['Set up GitHub Pages deployment', 'task', 'high', 'done', 'Kevin Jusak', 3, ['infra'], shift(-1), null],
      ['Draft Q4 planning doc', 'story', 'highest', 'inprogress', 'Kevin Jusak', 8, ['writing'], shift(0), '17:00'],
      ['Review pull requests', 'task', 'high', 'inprogress', 'Kevin Jusak', 2, ['code'], shift(0), '15:00'],
      ['Cards lose order after refresh', 'bug', 'high', 'review', 'Alex Kim', 2, ['bug'], shift(-2), null],
      ['Reply to vendor email', 'task', 'medium', 'todo', '', 1, ['admin'], shift(0), '12:00'],
      ['Book dentist appointment', 'task', 'low', 'todo', '', 1, ['personal'], shift(1), null],
      ['Add sprint burndown chart', 'epic', 'low', 'todo', '', 13, ['reporting'], shift(6), null],
      ['Weekly review', 'task', 'medium', 'todo', 'Kevin Jusak', 2, [], shift(3), '16:00'],
    ];
    samples.forEach(([title, type, priority, status, assignee, points, labels, due, dueTime], idx) => {
      state.issues.push({
        id: crypto.randomUUID(), key: nextKey(), title, description: '',
        type, priority, status, assignee, points, labels, due, dueTime,
        order: idx, createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    save();
    render();
  });

  render();
})();
