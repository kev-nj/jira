const fs = require('fs');
const { JSDOM } = require('jsdom');
const DIR = require('path').join(__dirname, '..');
const css = fs.readFileSync(`${DIR}/styles.css`, 'utf8');
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8')
  .replace(/<script src="app.js"><\/script>/, '')
  .replace(/<link rel="stylesheet" href="styles.css">/, `<style>${css}</style>`);
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom, doc = window.document;
window.localStorage.setItem('todo-board.v2', JSON.stringify({
  version: 2, prefix: 'T', counter: 0, view: 'day', sort: 'manual', tasks: [],
}));
window.crypto = { randomUUID: () => 'u' + Math.random() };
window.eval(fs.readFileSync(`${DIR}/app.js`, 'utf8'));

const props = ['display', 'opacity', 'pointer-events', 'visibility', 'position', 'overflow-y', 'flex'];
for (const g of [...doc.querySelectorAll('.group')].slice(0, 2)) {
  const btn = g.querySelector('.add-card');
  const cs = window.getComputedStyle(btn);
  console.log(`[${g.dataset.status}/${g.dataset.section}] button:`,
    props.map((p) => `${p}=${cs.getPropertyValue(p) || '-'}`).join(' '));
  const sc = window.getComputedStyle(g.querySelector('.group-scroll'));
  console.log(`   scroller: overflow-y=${sc.overflowY} flex=${sc.flex || '-'}  group.flex=${window.getComputedStyle(g).flex || '-'}`);
}
window.close(); process.exit(0);
