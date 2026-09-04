const fs = require('fs');
const { JSDOM } = require('jsdom');
const DIR = require('path').join(__dirname, '..');
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8').replace(/<script src="app.js"><\/script>/, '');
for (const v of ['day', 'week']) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, doc = window.document;
  window.localStorage.setItem('todo-board.v2', JSON.stringify({
    version: 2, prefix: 'T', counter: 0, view: v, sort: 'manual', tasks: [] }));
  window.crypto = { randomUUID: () => 'u' + Math.random() };
  window.eval(fs.readFileSync(`${DIR}/app.js`, 'utf8'));
  const g = [...doc.querySelectorAll('.group')].find((x) => x.dataset.section === 'personal');
  const scroll = g.querySelector('.group-scroll');
  // Click the blank area of the section, not the button.
  scroll.dispatchEvent(new window.Event('click', { bubbles: true }));
  const input = g.querySelector('.quick input');
  console.log(`${v}: blank-area click → input open=${!input.hidden} focused=${doc.activeElement === input}`);
  window.close();
}
process.exit(0);
