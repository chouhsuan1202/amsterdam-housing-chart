// 資料驗證單元測試：格式變動、空資料、壞值都不能讓頁面壞掉。執行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateData, normalizeValues } = require('../src/data.js');

const Q = ['2022Q1', '2022Q2', '2022Q3'];
const good = () => ({
  quarters: Q.slice(),
  lastActual: '2022Q3',
  homeArea: 47,
  homeEnd: { lo: 1, mid: 2, hi: 3 },
  views: {
    m2: { unit: 'eur', series: [{ id: 'a', label: 'A', color: '#2a78d6', values: [1, 2, 3] }] },
    cbs: { unit: 'index', series: [{ id: 'c', label: 'C', color: '#898781', values: [100, 101, 102] }] },
  },
});

test('正常資料：沒有警告', () => {
  const r = validateData(good());
  assert.equal(r.error, undefined);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.data.views.m2.series[0].label, 'A');
});

test('index.html 裡實際嵌入的資料可以通過驗證', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const json = html.match(/id="housing-data">([\s\S]*?)<\/script>/)[1];
  const r = validateData(JSON.parse(json));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.data.lastActual, '2026Q3');
});

test('整份無效：null、缺 quarters、季別格式錯、沒有任何序列', () => {
  assert.ok(validateData(null).error);
  assert.ok(validateData('x').error);
  assert.ok(validateData({ ...good(), quarters: [] }).error);
  assert.ok(validateData({ ...good(), quarters: ['2022-1', '2022-2', '2022-3'] }).error);
  assert.ok(validateData({ ...good(), views: {} }).error);
  assert.ok(validateData({ ...good(), views: { m2: { series: [] }, cbs: { series: [] } } }).error);
});

test('一個 view 缺少時其他 view 照常', () => {
  const d = good();
  delete d.views.cbs;
  const r = validateData(d);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.data.views.cbs.series, []);
  assert.ok(r.warnings.some(w => w.includes('views.cbs')));
});

test('序列長度不符補 null、非數字清成 null、全空或缺 id 的序列略過', () => {
  const d = good();
  d.views.m2.series = [
    { id: 'short', values: [1] },
    { id: 'long', values: [1, 2, 3, 4] },
    { id: 'junk', values: ['1', NaN, 3] },
    { id: 'empty', values: [null, null, null] },
    { values: [1, 2, 3] },
    { id: 'novals' },
    null,
  ];
  const r = validateData(d);
  const ids = r.data.views.m2.series.map(s => s.id);
  assert.deepEqual(ids, ['short', 'long', 'junk']);
  assert.deepEqual(r.data.views.m2.series[0].values, [1, null, null]);
  assert.deepEqual(r.data.views.m2.series[1].values, [1, 2, 3]);
  assert.deepEqual(r.data.views.m2.series[2].values, [null, null, 3]);
  assert.ok(r.warnings.length >= 6);
});

test('顏色格式錯用預設灰色，缺 label 用 id', () => {
  const d = good();
  d.views.m2.series = [{ id: 'x', color: 'red', values: [1, 2, 3] }];
  const s = validateData(d).data.views.m2.series[0];
  assert.equal(s.color, '#898781');
  assert.equal(s.label, 'x');
});

test('預估格式錯只丟掉預估，實際線保留', () => {
  const d = good();
  d.views.m2.series[0].fc = { lo: [1, 2, 3], mid: 'bad', hi: [1, 2, 3] };
  const r = validateData(d);
  assert.equal(r.data.views.m2.series[0].fc, undefined);
  assert.ok(r.warnings.some(w => w.includes('預估')));
});

test('lastActual 不在清單時改用有資料的最後一季', () => {
  const d = good();
  d.lastActual = '2030Q1';
  d.views.m2.series[0].values = [1, 2, null];
  d.views.cbs.series[0].values = [1, null, null];
  assert.equal(validateData(d).data.lastActual, '2022Q2');
});

test('homeArea、homeEnd 缺少時設為 null', () => {
  const d = good();
  d.homeArea = -1;
  delete d.homeEnd;
  const r = validateData(d);
  assert.equal(r.data.homeArea, null);
  assert.equal(r.data.homeEnd, null);
});

test('normalizeValues', () => {
  assert.equal(normalizeValues('x', 2), null);
  assert.deepEqual(normalizeValues([1, 2], 2), { values: [1, 2], changed: false });
  assert.deepEqual(normalizeValues([1, Infinity], 2), { values: [1, null], changed: true });
});
