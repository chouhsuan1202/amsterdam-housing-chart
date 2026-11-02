/*
 * 資料取得層：
 *   1. readEmbeddedData()：讀出 build.py 嵌在頁面裡的 JSON。
 *   2. validateData()：檢查格式，壞掉的部分丟掉並記下警告，整份不能用時回傳 error。
 *   3. loadChartLib()：載入 Chart.js，CDN 失敗或逾時就改用 repo 裡的備份檔。
 * validateData 是純函式，Node 測試可直接 require()。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HousingData = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const QUARTER_RE = /^\d{4}Q[1-4]$/;
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const FALLBACK_COLOR = '#898781';
  const VIEW_IDS = ['m2', 'cbs'];

  /** 數字或 null 以外的值一律當缺值 */
  const cleanValue = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  /**
   * 把陣列整理成跟 quarters 一樣長：太短補 null、太長截掉、非數字變 null。
   * 回傳 { values, changed }，changed 表示有做過修正。
   */
  function normalizeValues(arr, length) {
    if (!Array.isArray(arr)) return null;
    const values = [];
    let changed = arr.length !== length;
    for (let i = 0; i < length; i++) {
      const raw = i < arr.length ? arr[i] : null;
      const v = cleanValue(raw);
      if (v === null && raw != null) changed = true;
      values.push(v);
    }
    return { values, changed };
  }

  function normalizeSeries(s, length, where, warnings) {
    if (!s || typeof s !== 'object') { warnings.push(where + '：不是物件，略過'); return null; }
    if (typeof s.id !== 'string' || !s.id) { warnings.push(where + '：缺少 id，略過'); return null; }
    const name = where + ' ' + s.id;
    const norm = normalizeValues(s.values, length);
    if (!norm) { warnings.push(name + '：values 不是陣列，略過'); return null; }
    if (norm.changed) warnings.push(name + '：values 長度或內容不符，已補齊或清掉非數字');
    if (norm.values.every(v => v == null)) { warnings.push(name + '：沒有任何數字，略過'); return null; }

    const out = {
      id: s.id,
      label: typeof s.label === 'string' && s.label ? s.label : s.id,
      color: typeof s.color === 'string' && COLOR_RE.test(s.color) ? s.color : FALLBACK_COLOR,
      home: !!s.home,
      values: norm.values,
    };
    // 預估區間：lo、mid、hi 三條都要能用才保留，否則只丟掉預估，實際線照畫
    if (s.fc != null) {
      const fc = {};
      const ok = ['lo', 'mid', 'hi'].every(k => {
        const n = s.fc && normalizeValues(s.fc[k], length);
        if (n) fc[k] = n.values;
        return !!n;
      });
      if (ok) out.fc = fc;
      else warnings.push(name + '：預估資料格式不對，只畫實際數字');
    }
    return out;
  }

  /**
   * 檢查並整理嵌入資料。
   * 回傳 { data, warnings }；整份無法使用時回傳 { error, warnings }。
   */
  function validateData(raw) {
    const warnings = [];
    if (raw == null) return { error: '沒有讀到資料，可能是 JSON 格式錯誤或資料區塊不見了', warnings };
    if (typeof raw !== 'object' || Array.isArray(raw)) return { error: '資料格式不對，應該是一個物件', warnings };

    const quarters = raw.quarters;
    if (!Array.isArray(quarters) || !quarters.length || !quarters.every(q => typeof q === 'string' && QUARTER_RE.test(q))) {
      return { error: '季別清單（quarters）缺少或格式不對', warnings };
    }
    const n = quarters.length;

    const views = {};
    const rawViews = raw.views && typeof raw.views === 'object' ? raw.views : {};
    for (const vid of VIEW_IDS) {
      const v = rawViews[vid];
      const list = v && Array.isArray(v.series) ? v.series : [];
      if (!v) warnings.push('views.' + vid + '：缺少，這個分頁會顯示空狀態');
      const series = list.map((s, i) => normalizeSeries(s, n, 'views.' + vid + '[' + i + ']', warnings)).filter(Boolean);
      views[vid] = { unit: v && v.unit === 'eur' ? 'eur' : 'index', series };
    }
    if (VIEW_IDS.every(vid => views[vid].series.length === 0)) {
      return { error: '所有資料組都沒有可用的序列', warnings };
    }

    // 最新實際季：缺少或不在清單裡時，改用有資料的最後一季
    let lastActual = raw.lastActual;
    if (!quarters.includes(lastActual)) {
      let li = -1;
      for (const vid of VIEW_IDS) for (const s of views[vid].series) {
        if (s.home) continue;
        for (let i = n - 1; i > li; i--) if (s.values[i] != null) { li = i; break; }
      }
      lastActual = quarters[Math.max(li, 0)];
      warnings.push('lastActual 不在季別清單裡，改用 ' + lastActual);
    }

    const homeArea = typeof raw.homeArea === 'number' && raw.homeArea > 0 ? raw.homeArea : null;
    const he = raw.homeEnd;
    const homeEnd = he && cleanValue(he.lo) != null && cleanValue(he.hi) != null ? { lo: he.lo, mid: cleanValue(he.mid), hi: he.hi } : null;
    if (homeArea == null || homeEnd == null) warnings.push('homeArea 或 homeEnd 缺少，不顯示「我家」重點句');

    return { data: { quarters, lastActual, homeArea, homeEnd, generated: raw.generated || null, views }, warnings };
  }

  /** 從 <script type="application/json"> 讀資料，JSON 壞掉時回傳 null */
  function readEmbeddedData(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch { return null; }
  }

  /** 動態載入一支 script，逾時或失敗都 reject */
  function loadScript(src, timeoutMs) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      let done = false;
      const finish = (ok, why) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (ok) resolve(); else { el.remove(); reject(new Error(why + '：' + src)); }
      };
      const timer = setTimeout(() => finish(false, '逾時'), timeoutMs);
      el.src = src;
      el.async = true;
      el.onload = () => finish(true);
      el.onerror = () => finish(false, '載入失敗');
      document.head.appendChild(el);
    });
  }

  /**
   * 依序嘗試每個來源，直到 window.Chart 出現。
   * 預設先用 cdnjs，失敗再用 vendor/ 裡同版本的備份。
   */
  async function loadChartLib(sources, timeoutMs = 8000) {
    if (typeof window !== 'undefined' && window.Chart) return window.Chart;
    let lastErr = null;
    for (const src of sources) {
      try {
        await loadScript(src, timeoutMs);
        if (window.Chart) return window.Chart;
        lastErr = new Error('載入後找不到 Chart：' + src);
      } catch (e) {
        lastErr = e;
        console.warn('[圖表元件]', e.message);
      }
    }
    throw lastErr || new Error('沒有可用的 Chart.js 來源');
  }

  return { validateData, normalizeValues, readEmbeddedData, loadScript, loadChartLib };
});
