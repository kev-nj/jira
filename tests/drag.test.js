const fs = require('fs');
const { JSDOM } = require('jsdom');
const DIR = require('path').join(__dirname, '..');

const html = fs.readFileSync(`${DIR}/index.html`, 'utf8').replace(/<script src="app.js"><\/script>/, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

const today = new Date().toISOString().slice(0, 10);
const mk = (t, order) => ({
  id: `id-${t}`, key: `T-${t}`, title: t, notes: '', status: 'todo', section: 'project',
  project: '', assignee: '', date: today, time: null, priority: 'medium', subtasks: [],
  order, createdAt: 1, completedAt: null, rolledFrom: null, collapsed: false, starred: false,
});
window.localStorage.setItem('todo-board.v2', JSON.stringify({
  version: 2, name: 'x', prefix: 'T', counter: 3, view: 'day', sort: 'manual',
  tasks: [mk('A', 0), mk('B', 1), mk('C', 2)],
}));
window.crypto = { randomUUID: () => 'u' + Math.random() };

window.eval(fs.readFileSync(`${DIR}/app.js`, 'utf8'));
const doc = window.document;

const titles = () => [...doc.querySelectorAll('.column[data-status=todo] .card .title')].map((n) => n.textContent);
console.log('initial order:', titles().join(', '));

// Give the cards geometry: jsdom reports all-zero rects otherwise.
function layout() {
  [...doc.querySelectorAll('.card')].forEach((c, i) => {
    c.getBoundingClientRect = () => ({ top: i * 50, height: 40, bottom: i * 50 + 40, left: 0, right: 200 });
  });
}
layout();

// Drag C to the very top of the list (above A).
const group = doc.querySelector('.column[data-status=todo] .group');
const dt = { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; } };
const cardC = [...doc.querySelectorAll('.card')].find((c) => c.textContent.includes('C'));
console.log('dragging card id:', cardC.dataset.id);

function fire(target, type, clientY) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  ev.dataTransfer = dt;
  ev.clientY = clientY;
  target.dispatchEvent(ev);
  return ev;
}
// Case 1: normal element drag, C to the top.
fire(cardC, 'dragstart');
fire(group, 'dragover', 2);
fire(group, 'drop', 2);
console.log('case 1 (C to top):        ', titles().join(', '));

// Case 2: the browser hands us a text-selection payload instead of the id.
layout();
const g2 = doc.querySelector('.column[data-status=todo] .group');
const cardA = [...doc.querySelectorAll('.card')].find((c) => c.textContent.includes('A'));
fire(cardA, 'dragstart');
dt.data['text/plain'] = 'A';            // what a text drag actually carries
fire(g2, 'dragover', 130);
fire(g2, 'drop', 130);                  // below the last card
console.log('case 2 (text payload, A to end):', titles().join(', '));

// Case 3: reorder to the middle.
layout();
const g3 = doc.querySelector('.column[data-status=todo] .group');
const first = doc.querySelector('.column[data-status=todo] .card');
fire(first, 'dragstart');
fire(g3, 'dragover', 60);
fire(g3, 'drop', 60);
console.log('case 3 (first to middle):  ', titles().join(', '));
const saved = JSON.parse(window.localStorage.getItem('todo-board.v2'));
console.log('final orders:', saved.tasks.map((t) => `${t.title}=${t.order}`).join(' '));

window.close(); process.exit(0);
