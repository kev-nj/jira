const fs = require('fs');
const { JSDOM } = require('jsdom');
const DIR = require('path').join(__dirname, '..');
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8').replace(/<script src="app.js"><\/script>/, '');

function boot(viewName) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.localStorage.setItem('todo-board.v2', JSON.stringify({
    version: 2, prefix: 'T', counter: 0, view: viewName, sort: 'manual', tasks: [],
  }));
  window.crypto = { randomUUID: () => 'u' + Math.random() };
  window.eval(fs.readFileSync(`${DIR}/app.js`, 'utf8'));
  return window;
}

for (const v of ['day', 'week']) {
  const window = boot(v);
  const doc = window.document;
  console.log(`\n=== ${v} view ===`);
  const groups = [...doc.querySelectorAll('.group')].slice(0, 2);
  for (const g of groups) {
    const btn = g.querySelector('.add-card');
    const input = g.querySelector('.quick input');
    if (!btn) { console.log(`${g.dataset.section}: NO BUTTON`); continue; }
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    console.log(`${g.dataset.section.padEnd(9)} btn.hidden=${btn.hidden} input.hidden=${input.hidden} focused=${doc.activeElement === input}`);
    // now type + Enter
    input.value = `task-${g.dataset.section}`;
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const saved = JSON.parse(window.localStorage.getItem('todo-board.v2'));
    console.log(`${''.padEnd(9)} saved: ${saved.tasks.map((t) => t.title + '/' + t.section).join(', ') || 'NOTHING'}`);
  }
  window.close();
}
process.exit(0);
