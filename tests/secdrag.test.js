const fs = require('fs');
const { JSDOM } = require('jsdom');
const DIR = require('path').join(__dirname, '..');
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8').replace(/<script src="app.js"><\/script>/, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom, doc = window.document;
window.localStorage.setItem('todo-board.v2', JSON.stringify({
  version: 2, prefix: 'T', counter: 0, view: 'day', sort: 'manual',
  sections: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }],
  tasks: [] }));
window.crypto = { randomUUID: () => 'u' + Math.random() };
window.eval(fs.readFileSync(`${DIR}/app.js`, 'utf8'));
const names = () => JSON.parse(window.localStorage.getItem('todo-board.v2')).sections.map((s) => s.name).join(', ');
doc.getElementById('sectionsBtn').dispatchEvent(new window.Event('click', { bubbles: true }));

function layout() {
  [...doc.querySelectorAll('.section-row')].forEach((r, i) => {
    r.getBoundingClientRect = () => ({ top: i * 40, height: 34, bottom: i * 40 + 34, left: 0, right: 400 });
  });
}
function fire(target, type, clientY) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  ev.dataTransfer = { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; } };
  ev.clientY = clientY;
  target.dispatchEvent(ev);
}
console.log('start:', names());

// Drag Gamma (index 2) to the top.
layout();
let rows = [...doc.querySelectorAll('.section-row')];
fire(rows[2], 'dragstart');
layout();
fire(doc.getElementById('sectionsList'), 'dragover', 2);
fire(doc.getElementById('sectionsList'), 'drop', 2);
console.log('drag Gamma to top:', names());

// Drag the new first row to the bottom.
layout();
rows = [...doc.querySelectorAll('.section-row')];
fire(rows[0], 'dragstart');
layout();
fire(doc.getElementById('sectionsList'), 'drop', 200);
console.log('drag first to bottom:', names());

// Keyboard fallback: ArrowDown on the first handle.
const handle = doc.querySelector('.section-row .drag-handle');
handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
console.log('ArrowDown on first: ', names());
window.close(); process.exit(0);
