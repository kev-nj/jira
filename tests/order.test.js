/* Fractional ordering keys.

   Ordering is the one field where plain last-write-wins misbehaves visibly: two
   devices reordering a list with integer indexes renumber over each other and
   the result is a jumble. A key generated midway between its neighbours means
   each move is an independent fact about one row, so concurrent moves merge.

   The primitive is lifted straight out of app.js rather than duplicated here,
   so the test cannot drift from the implementation. */
const fs = require('fs');
const path = require('path');
const { check, report } = require('./harness');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
// eslint-disable-next-line no-eval
const { midKey, spreadKeys } = eval(`(() => {
  ${slice('const KEY_DIGITS', '  // n ascending keys')}
  ${slice('  function spreadKeys', '  // Boards saved before')}
  return { midKey, spreadKeys };
})()`);

const sorted = (a) => a.every((v, i) => i === 0 || a[i - 1] < v);

// A key placed between two others must sort between them, however tight the gap.
let keys = spreadKeys(5);
check('spreadKeys ascends', sorted(keys), true);

let tight = ['', ''];
for (let i = 0; i < 200; i += 1) {
  const mid = midKey(tight[0], tight[1]);
  const ok = (!tight[0] || tight[0] < mid) && (!tight[1] || mid < tight[1]);
  if (!ok) { check(`repeated split at depth ${i}`, mid, 'between neighbours'); break; }
  tight = [tight[0], mid];       // keep splitting into the same shrinking gap
}
check('200 repeated splits stay ordered', tight[1] > '', true);

// Random insertions anywhere in a growing list must never break the ordering
// or produce a duplicate — the two ways a key scheme fails in practice.
let list = spreadKeys(3);
for (let i = 0; i < 500; i += 1) {
  const at = Math.floor(Math.random() * (list.length + 1));
  list.splice(at, 0, midKey(list[at - 1] || '', list[at] || ''));
}
check('500 random insertions stay sorted', sorted(list), true);
check('no duplicate keys', new Set(list).size, list.length);

// Two devices moving different rows: each move is one row's key, so applying
// both in either order lands on the same list.
const [a, b, c] = spreadKeys(3);
const cToTop = midKey('', a);          // device 1 drags C above A
const aToEnd = midKey(c, '');          // device 2 drags A below C
const one = [['C', cToTop], ['A', aToEnd], ['B', b]].sort((x, y) => (x[1] < y[1] ? -1 : 1));
const two = [['A', aToEnd], ['B', b], ['C', cToTop]].sort((x, y) => (x[1] < y[1] ? -1 : 1));
check('concurrent reorders converge',
  one.map((x) => x[0]).join(''), two.map((x) => x[0]).join(''));
check('both moves survived', one.map((x) => x[0]).join(''), 'CBA');

report();
