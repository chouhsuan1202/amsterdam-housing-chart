// Browser checks for index.html. Run: node tests/page.test.js
// Needs playwright (and chart.js 4.4.1 from npm for offline runs; otherwise the CDN is used).
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const PAGE = 'file://' + path.resolve(process.env.PAGE || path.join(__dirname, '..', 'index.html'));
let CHART = null;
try { CHART = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'); } catch (e) { /* use CDN */ }

async function open(browser, opts = {}, { blockChart = false } = {}) {
  const p = await browser.newPage(opts);
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  if (blockChart) await p.route('https://cdnjs.cloudflare.com/**', r => r.abort());
  else if (CHART) await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: CHART, contentType: 'application/javascript' }));
  await p.goto(PAGE);
  await p.waitForFunction(() => document.querySelector('#key').textContent.length > 0, null, { timeout: 10000 });
  return { p, errors };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('key sentence uses the latest home value, not an empty quarter', async b => {
  const { p, errors } = await open(b);
  const key = await p.textContent('#key');
  assert(!key.includes('€0 萬'), key);
  const want = await p.evaluate(() => {
    const h = DATA.views.m2.series.find(s => s.id === 'home');
    let i = Q.indexOf(DATA.lastActual); while (h.values[i] == null) i--;
    return wan(h.values[i] * DATA.homeArea);
  });
  assert(key.includes('（現在 ' + want + '）'), key);
  assert(await p.evaluate(() => Chart.getChart('c').data.datasets.length > 0), 'chart did not draw');
  assert.deepStrictEqual(errors, []);
});

test('home row is in the table with its own latest quarter', async b => {
  const { p } = await open(b);
  const rows = await p.$$eval('#tb tr', t => t.map(r => r.innerText));
  assert(rows.some(r => r.startsWith('我家（2026 Q2）')), rows.join('\n'));
  assert(rows.some(r => r.startsWith('全市')), rows.join('\n'));
});

test('legend toggle keeps keyboard focus and aria-pressed', async b => {
  const { p } = await open(b);
  await p.focus('#legend button[data-id="nvm_zuid_m2"]');
  await p.keyboard.press('Enter');
  const st = await p.evaluate(() => [document.activeElement.dataset.id, document.activeElement.getAttribute('aria-pressed')]);
  assert.deepStrictEqual(st, ['nvm_zuid_m2', 'true']);
});

test('all views, modes, bases and smoothing render without errors', async b => {
  const { p, errors } = await open(b);
  for (const v of ['#v-m2', '#v-cbs']) for (const m of ['#m-pct', '#m-raw']) for (const sm of [false, true]) {
    await p.click(v); await p.click(m); await p.setChecked('#smooth', sm);
    const bases = await p.$$eval('#base option', o => o.map(x => x.value));
    assert(bases.length > 0);
    for (const q of [bases[0], bases[bases.length - 1]]) {
      await p.selectOption('#base', q);
      assert(await p.$$eval('#tb tr', t => t.length) > 0, `${v} ${m} ${sm} ${q}`);
    }
  }
  assert.deepStrictEqual(errors, []);
});

test('tooltip shows the home forecast in the quarter after its last point', async b => {
  const { p } = await open(b);
  const shown = await p.evaluate(() => {
    const c = Chart.getChart('c'), labels = c.data.labels;
    const di = c.data.datasets.findIndex(d => d._fc && d._band === 'mid' && d._id === 'home');
    const at = q => c.options.plugins.tooltip.filter({ datasetIndex: di, dataset: c.data.datasets[di], dataIndex: labels.indexOf(q),
      parsed: { y: c.data.datasets[di].data[labels.indexOf(q)] } });
    return [at('2026Q2'), at('2026Q3'), at('2027Q1')];
  });
  assert.deepStrictEqual(shown, [false, true, true]);
});

test('phone width has no horizontal scroll', async b => {
  const { p } = await open(b, { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  assert(w <= 360, 'scrollWidth ' + w);
});

test('dark mode renders', async b => {
  const { p, errors } = await open(b, { colorScheme: 'dark' });
  assert.deepStrictEqual(errors, []);
});

test('table and text still work when the chart library fails to load', async b => {
  const { p, errors } = await open(b, {}, { blockChart: true });
  assert(await p.$$eval('#tb tr', t => t.length) > 0);
  assert.deepStrictEqual(errors, []);
});

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(browser); console.log('ok   ' + t.name); }
    catch (e) { failed++; console.log('FAIL ' + t.name + '\n     ' + e.message); }
  }
  await browser.close();
  console.log(`${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
