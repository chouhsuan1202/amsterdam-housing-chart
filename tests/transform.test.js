// 資料轉換層單元測試。執行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/transform.js');

const Q = ['2022Q1', '2022Q2', '2022Q3', '2022Q4', '2023Q1', '2023Q2'];

test('fmtWan：四捨五入到千元再拆萬位，不會出現「萬 10」', () => {
  assert.equal(T.fmtWan(389019), '€38 萬 9');
  assert.equal(T.fmtWan(389600), '€39 萬');
  assert.equal(T.fmtWan(366400), '€36 萬 6');
  assert.equal(T.fmtWan(-23000), '€2 萬 3');
  assert.equal(T.fmtWan(0), '€0 萬');
});

test('fmtPct 與 fmtRaw', () => {
  assert.equal(T.fmtPct(4.94), '+4.9%');
  assert.equal(T.fmtPct(-2), '-2.0%');
  assert.equal(T.fmtPct(0), '0.0%');
  assert.equal(T.fmtRaw(8310.4, 'eur'), '€8,310');
  assert.equal(T.fmtRaw(156.44, 'index'), '156.4');
});

test('qLabel 與 qShort', () => {
  assert.equal(T.qLabel('2022Q2'), '2022 年第 2 季');
  assert.equal(T.qShort('2026Q3'), '2026 Q3');
});

test('smoothSeries：四季平均，窗口內缺值就是 null', () => {
  assert.deepEqual(T.smoothSeries([4, 8, 12, 16, 20]), [null, null, null, 10, 14]);
  assert.deepEqual(T.smoothSeries([4, null, 12, 16, 20, 24]), [null, null, null, null, null, 18]);
  assert.deepEqual(T.smoothSeries([]), []);
});

test('toPct：基準為 null 或 0 時全部 null', () => {
  assert.deepEqual(T.toPct([100, 110, null], 100).map(v => v == null ? v : Math.round(v)), [0, 10, null]);
  assert.deepEqual(T.toPct([1, 2], null), [null, null]);
  assert.deepEqual(T.toPct([1, 2], 0), [null, null]);
});

test('lastIndexAtOrBefore 與 chartStartIndex', () => {
  assert.equal(T.lastIndexAtOrBefore([1, null, 3, null], 3), 2);
  assert.equal(T.lastIndexAtOrBefore([null, null], 1), -1);
  const series = [
    { id: 'home', home: true, values: [5, null, null] },
    { id: 'a', values: [null, null, 2] },
    { id: 'b', values: [null, 1, 2] },
    { id: 'empty', values: [null, null, null] },
  ];
  assert.equal(T.chartStartIndex(series), 1, '忽略全空序列與 home 序列');
  assert.equal(T.chartStartIndex([{ id: 'x', values: [null] }]), 0, '全部都空時回傳 0');
});

test('availableBases：不晚於最新實際季，平滑時要滿四季', () => {
  const series = [{ id: 'home', home: true, values: [1, 1, 1, 1, 1, 1] }, { id: 'a', values: [null, 1, 2, 3, 4, 5] }];
  assert.deepEqual(T.availableBases(series, Q, 4, false), ['2022Q2', '2022Q3', '2022Q4', '2023Q1']);
  assert.deepEqual(T.availableBases(series, Q, 5, true), ['2023Q1', '2023Q2']);
  assert.deepEqual(T.availableBases([{ id: 'home', home: true, values: [1] }], Q, 5, false), []);
});

test('resolveBase', () => {
  assert.equal(T.resolveBase('2022Q3', ['2022Q2', '2022Q3'], '2022Q2'), '2022Q3');
  assert.equal(T.resolveBase('2010Q1', ['2022Q1', '2022Q2'], '2022Q2'), '2022Q2');
  assert.equal(T.resolveBase('2010Q1', ['2023Q1'], '2022Q2'), '2023Q1');
  assert.equal(T.resolveBase('2010Q1', [], '2022Q2'), null);
});

test('prepareSeries：home 序列不平滑，預估也換算成漲幅', () => {
  const series = [
    { id: 'home', home: true, values: [null, 100, null, null, null, 110] },
    { id: 'a', values: [100, 200, 300, 400, 500, 600], fc: { lo: [null, null, null, null, null, 600], mid: [null, null, null, null, null, 660], hi: [null, null, null, null, null, 720] } },
  ];
  const p = T.prepareSeries(series, Q, '2022Q2', false);
  assert.equal(p[0].b, 100);
  assert.ok(Math.abs(p[0].pct[5] - 10) < 1e-9);
  assert.equal(p[1].b, 200);
  assert.ok(Math.abs(p[1].fcp.mid[5] - 230) < 1e-9);
  const ps = T.prepareSeries(series, Q, '2023Q1', true);
  assert.equal(ps[0].vals, series[0].values, 'home 不平滑');
  assert.equal(ps[1].b, 350, '平滑後基準 = (200+300+400+500)/4');
});

test('tableRows：最新季沒有點時用之前最近的點並標記 stale，依漲幅排序，略過隱藏與無基準', () => {
  const series = [
    { id: 'home', label: '我家', home: true, values: [null, 100, null, null, 120, null] },
    { id: 'a', label: 'A', values: [100, 100, 100, 100, 100, 105] },
    { id: 'b', label: 'B', values: [100, 100, 100, 100, 100, 130] },
    { id: 'nb', label: '沒基準', home: true, values: [null, null, null, 50, null, null] },
  ];
  const p = T.prepareSeries(series, Q, '2022Q2', false);
  const rows = T.tableRows(p, Q, 5, { b: true });
  assert.deepEqual(rows.map(r => r.s.id), ['home', 'a']);
  assert.equal(rows[0].stale, true);
  assert.equal(rows[0].latestQuarter, '2023Q1');
  assert.ok(Math.abs(rows[0].chg - 20) < 1e-9);
  assert.equal(rows[1].stale, false);
});

test('homeOutlook：最新季沒有估價時，現值用前一個點，不會變成 0', () => {
  const home = { id: 'home', values: [null, 7894, null, null, 8277, null] };
  const o = T.homeOutlook(home, 5, { lo: 7795, hi: 8609 }, 47);
  assert.equal(o.index, 4);
  assert.equal(o.cur, 8277 * 47);
  assert.match(T.keyMessage('m2', o), /現在 €38 萬 9/);
  assert.match(T.keyMessage('m2', o), /少 €2 萬 3 到 多 €1 萬 6/);
});

test('homeOutlook：缺資料時回傳 null，重點句為空字串', () => {
  assert.equal(T.homeOutlook(undefined, 5, { lo: 1, hi: 2 }, 47), null);
  assert.equal(T.homeOutlook({ values: [null] }, 0, { lo: 1, hi: 2 }, 47), null);
  assert.equal(T.homeOutlook({ values: [1] }, 0, null, 47), null);
  assert.equal(T.homeOutlook({ values: [1] }, 0, { lo: 1, hi: 2 }, null), null);
  assert.equal(T.keyMessage('m2', null), '');
  assert.match(T.keyMessage('cbs', null), /全荷蘭/);
});
