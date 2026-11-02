// Playwright smoke test：實際用瀏覽器打開 index.html，檢查載入、錯誤狀態、互動、手機版與鍵盤操作。
// 執行：npm run test:smoke（需要 playwright 與 Chromium，見 README）
// 設定 SCREENSHOT_DIR 環境變數時會順便存截圖。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }

const ROOT = path.join(__dirname, '..');
const CDN = '**/cdnjs.cloudflare.com/**';
const VENDOR = path.join(ROOT, 'vendor', 'chart.umd.js');
const SHOTS = process.env.SCREENSHOT_DIR;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json' };

/** 簡單的靜態檔伺服器，只服務 repo 內的檔案 */
function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const skip = chromium ? false : '沒有安裝 playwright，略過 smoke test';

test.describe('smoke', { skip }, () => {
  let browser, server, base;

  test.before(async () => {
    server = await startServer();
    base = 'http://127.0.0.1:' + server.address().port + '/';
    browser = await chromium.launch();
  });
  test.after(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  /**
   * 開新頁面。cdn：'ok' 用 vendor 檔回應 CDN、'fail' 讓 CDN 失敗、'hang' 讓 CDN 不回應。
   * vendor：false 時連備份檔也擋掉。
   */
  async function open({ width = 1280, height = 900, cdn = 'ok', vendor = true, colorScheme = 'light', html } = {}) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(CDN, route => {
      if (cdn === 'ok') return route.fulfill({ path: VENDOR, contentType: 'application/javascript' });
      if (cdn === 'fail') return route.abort();
      // hang：不回應，讓前端的逾時機制處理
    });
    if (!vendor) await page.route('**/vendor/chart.umd.js', route => route.abort());
    if (html) await page.route(base, route => route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' }));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    return { page, errors };
  }

  const chartReady = page => page.waitForFunction(() => {
    const s = document.getElementById('chart-status');
    return s.hidden || s.dataset.kind === 'empty';
  }, null, { timeout: 20000 });

  const noHorizontalScroll = async page => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw <= iw, `出現橫向捲動：scrollWidth ${sw} > innerWidth ${iw}`);
  };

  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); };

  test('桌機：圖表、表格、重點句正常，沒有 JS 錯誤', async () => {
    const { page, errors } = await open();
    await chartReady(page);
    assert.ok(await page.evaluate(() => !!window.Chart && !!document.querySelector('#c').getAttribute('width')));
    const rows = await page.$$eval('#tb tr', trs => trs.map(tr => tr.querySelector('th').textContent));
    assert.deepEqual(rows.sort(), ['我家', '全市'].sort());
    assert.match(await page.textContent('#key'), /現在 €38 萬 9/);
    assert.doesNotMatch(await page.textContent('#key'), /€0 萬/);
    await noHorizontalScroll(page);
    await shot(page, 'desktop-light');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('所有控制項都能切換，不會拋錯', async () => {
    const { page, errors } = await open();
    await chartReady(page);
    await page.click('#m-raw');
    assert.equal(await page.getAttribute('#m-raw', 'aria-pressed'), 'true');
    await page.click('#smooth');
    await page.selectOption('#base', '2023Q1');
    await page.click('#v-cbs');
    assert.equal(await page.getAttribute('#v-cbs', 'aria-pressed'), 'true');
    assert.equal(await page.$$eval('#legend button', b => b.length), 8);
    assert.match(await page.textContent('#key'), /全荷蘭/);
    await page.click('#m-pct');
    await page.click('#smooth');
    await page.click('#v-m2');
    await page.hover('#c', { position: { x: 600, y: 200 } });
    await shot(page, 'desktop-interactions');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('鍵盤：Tab 到圖例按鈕，Enter 與空白鍵切換後焦點留在原按鈕', async () => {
    const { page, errors } = await open();
    await chartReady(page);
    const btn = '#legend button[data-id="nvm_zuid_m2"]';
    await page.focus(btn);
    await page.keyboard.press('Enter');
    assert.equal(await page.getAttribute(btn, 'aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'nvm_zuid_m2');
    await page.keyboard.press('Space');
    assert.equal(await page.getAttribute(btn, 'aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'nvm_zuid_m2');
    // 往後 Tab 會到下一顆圖例按鈕
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'nvm_centrum_m2');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('全部線都關掉時顯示空狀態', async () => {
    const { page, errors } = await open();
    await chartReady(page);
    for (const id of ['home', 'nvm_city_m2']) await page.click(`#legend button[data-id="${id}"]`);
    await page.waitForSelector('#chart-status[data-kind="empty"]:not([hidden])');
    assert.equal(await page.isVisible('#table-empty'), true);
    assert.equal(await page.textContent('#key').then(t => t.length > 0), true);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('手機 375px：兩個分頁都沒有橫向捲動', async () => {
    const { page, errors } = await open({ width: 375, height: 812 });
    await chartReady(page);
    await noHorizontalScroll(page);
    await shot(page, 'mobile-375');
    await page.click('#v-cbs');
    await page.click('#m-raw');
    await noHorizontalScroll(page);
    await shot(page, 'mobile-375-cbs');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('深色模式可正常顯示', async () => {
    const { page, errors } = await open({ colorScheme: 'dark' });
    await chartReady(page);
    await shot(page, 'desktop-dark');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('CDN 失敗時改用 vendor/ 的備份', async () => {
    const { page, errors } = await open({ cdn: 'fail' });
    await chartReady(page);
    assert.ok(await page.evaluate(() => !!window.Chart));
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('CDN 與備份都失敗：顯示錯誤與重試按鈕，表格照常', async () => {
    const { page, errors } = await open({ cdn: 'fail', vendor: false });
    await page.waitForSelector('#chart-status[data-kind="error"]:not([hidden])');
    assert.equal(await page.isVisible('#chart-retry'), true);
    assert.equal(await page.$$eval('#tb tr', r => r.length), 2);
    await shot(page, 'error-chart-lib');
    // 網路恢復後按重試可以畫出圖
    await page.unroute('**/vendor/chart.umd.js');
    await page.click('#chart-retry');
    await chartReady(page);
    assert.ok(await page.evaluate(() => !!window.Chart));
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('CDN 不回應時逾時，改用備份', { timeout: 30000 }, async () => {
    const { page, errors } = await open({ cdn: 'hang' });
    assert.equal(await page.getAttribute('#chart-status', 'data-kind'), 'loading');
    await chartReady(page);
    assert.deepEqual(errors, []);
    await page.close();
  });

  const indexHtml = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const withData = fn => indexHtml().replace(/(id="housing-data">)([\s\S]*?)(<\/script>)/, (m, a, json, c) => a + fn(json) + c);

  test('嵌入資料壞掉：顯示整頁錯誤訊息，不拋錯', async () => {
    const { page, errors } = await open({ html: withData(() => '{broken') });
    await page.waitForSelector('#fatal:not([hidden])');
    assert.match(await page.textContent('#fatal'), /資料讀取失敗/);
    assert.equal(await page.isVisible('.app'), false);
    await shot(page, 'error-data');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('資料格式變動（缺 cbs、數值變字串）：其餘部分照常', async () => {
    const html = withData(json => {
      const d = JSON.parse(json);
      delete d.views.cbs;
      d.views.m2.series[2].values = d.views.m2.series[2].values.map(String);
      return JSON.stringify(d);
    });
    const { page, errors } = await open({ html });
    await chartReady(page);
    await page.click('#v-cbs');
    await page.waitForSelector('#chart-status[data-kind="empty"]:not([hidden])');
    await page.click('#v-m2');
    await chartReady(page);
    assert.deepEqual(errors, []);
    await page.close();
  });
});
