const fs = require('fs');
const { JSDOM } = require('jsdom');
const DIR = require('path').join(__dirname, '..');
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8').replace(/<script src="app.js"><\/script>/, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom, doc = window.document;
const today = new Date().toISOString().slice(0, 10);
const mk = (t, section) => ({ id: 'id' + t, key: t, title: t, notes: '', status: 'todo', section,
  project: '', assignee: '', date: today, time: null, priority: 'medium', subtasks: [], order: 0,
  createdAt: 1, completedAt: null, rolledFrom: null, collapsed: false, starred: false });
window.localStorage.setItem('todo-board.v2', JSON.stringify({
  version: 2, prefix: 'T', counter: 2, view: 'day', sort: 'manual',
  tasks: [mk('A', 'project'), mk('B', 'personal')] }));   // note: no sections key (old data)
window.crypto = { randomUUID: () => 'u' + Math.random() };
window.eval(fs.readFileSync(`${DIR}/app.js`, 'utf8'));
const st = () => { const x = JSON.parse(window.localStorage.getItem('todo-board.v2')); x.sections = x.sections || []; return x; };
const heads = () => [...doc.querySelectorAll('.column[data-status=todo] .group-name')].map((n) => n.textContent);
const click = (n) => n.dispatchEvent(new window.Event('click', { bubbles: true }));

console.log('1. migrated old data → sections:', st().sections.map((s) => s.name).join(', '));
console.log('   board headings:', heads().join(' | '));

// Add a section.
doc.getElementById('sectionAddInput').value = 'Errands';
doc.getElementById('sectionAddForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
console.log('2. after add:', st().sections.map((s) => s.name).join(', '), '| headings:', heads().join(' | '));

// Rename via the manager.
click(doc.getElementById('sectionsBtn'));
const nameInput = doc.querySelectorAll('.section-name')[1];
nameInput.value = 'Personal life';
nameInput.dispatchEvent(new window.Event('change', { bubbles: true }));
console.log('3. after rename:', st().sections.map((s) => s.name).join(', '));

// Reorder now lives on the drag handle (keyboard fallback shown here).
const h = [...doc.querySelectorAll('.section-row .drag-handle')][2];
h.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
console.log('4. after move up:', st().sections.map((s) => s.name).join(', '));

// Delete a section that holds a task, reassigning its work.
const target = [...doc.querySelectorAll('.section-row')].find((r) => r.querySelector('.section-name').value === 'Personal life');
click([...target.querySelectorAll('button')].find((b) => b.textContent === '✕'));
const confirmRow = target.nextElementSibling;
console.log('5. confirm prompt:', confirmRow.textContent.replace(/\s+/g, ' ').trim().slice(0, 60));
confirmRow.querySelector('.section-target').value = 'project';
click([...confirmRow.querySelectorAll('button')].find((b) => /delete/i.test(b.textContent)));
console.log('   after delete → sections:', st().sections.map((s) => s.name).join(', '));
console.log('   task B now in:', st().tasks.find((t) => t.title === 'B').section);

// Inline rename on the board.
const head = doc.querySelector('.column[data-status=todo] .group-head');
head.dispatchEvent(new window.Event('dblclick', { bubbles: true }));
const inline = head.querySelector('.group-rename');
inline.value = 'Deep work';
inline.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
console.log('6. inline rename →', st().sections.map((s) => s.name).join(', '), '| headings:', heads().join(' | '));
window.close(); process.exit(0);
