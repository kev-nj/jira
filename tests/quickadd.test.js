const fs = require('fs');
const { JSDOM } = require('jsdom');
const DIR = require('path').join(__dirname, '..');
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8').replace(/<script src="app.js"><\/script>/, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
const today = new Date().toISOString().slice(0, 10);
window.localStorage.setItem('todo-board.v2', JSON.stringify({
  version: 2, prefix: 'T', counter: 0, view: 'week', sort: 'manual', tasks: [],
}));
window.crypto = { randomUUID: () => 'u' + Math.random() };
window.eval(fs.readFileSync(`${DIR}/app.js`, 'utf8'));

// Type into a later day's Non-project quick-add and press Enter. Pick the last
// such day actually on screen rather than a fixed offset from today, which
// falls outside the rendered week whenever today is late in it.
const groups = [...doc.querySelectorAll('.group')];
const later = groups.filter((g) => g.dataset.section === 'personal' && g.dataset.date > today);
const target = later[later.length - 1];
const label = (g) => `${g.dataset.date} / ${g.dataset.section}`;
console.log('typing into:', target ? label(target) : 'NOT FOUND');

const btn = target.querySelector('.add-card');
btn.dispatchEvent(new window.Event('click', { bubbles: true }));
const input = target.querySelector('.quick input');
input.value = 'Test task';
const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
input.dispatchEvent(ev);

const focused = doc.activeElement;
const focusedGroup = focused && focused.closest ? focused.closest('.group') : null;
console.log('focus after Enter:', focusedGroup ? label(focusedGroup) : focused && focused.tagName);
const saved = JSON.parse(window.localStorage.getItem('todo-board.v2'));
console.log('task saved on:', saved.tasks.map((t) => `${t.title} → ${t.date} / ${t.section}`).join(', '));
window.close(); process.exit(0);
