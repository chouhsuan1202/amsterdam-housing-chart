/*
 * 資料轉換層：純函式，不碰 DOM，也不依賴 Chart.js。
 * 瀏覽器裡掛在 window.HousingTransform，Node 測試裡用 require() 取得。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HousingTransform = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 格式化 ----------

  /** '2022Q2' 轉成「2022 年第 2 季」 */
  const qLabel = q => q.slice(0, 4) + ' 年第 ' + q.slice(5) + ' 季';

  /** '2022Q2' 轉成「2022 Q2」，用在表頭等窄欄位 */
  const qShort = q => q.replace('Q', ' Q');

  /** 歐元用千分位整數，指數保留一位小數 */
  const fmtRaw = (v, unit) => (unit === 'eur' ? '€' + Math.round(v).toLocaleString('en-US') : v.toFixed(1));

  /** 百分比，正數加上 + 號 */
  const fmtPct = v => (v > 0 ? '+' : '') + v.toFixed(1) + '%';

  /**
   * 歐元金額轉成「€38 萬 9」這種口語寫法（解析度一千歐元，取絕對值）。
   * 先四捨五入到千元再拆萬位，避免 38.95 萬被拆成「38 萬 10」。
   */
  function fmtWan(v) {
    const k = Math.round(Math.abs(v) / 1000);
    const wan = Math.floor(k / 10);
    const rest = k % 10;
    return '€' + wan + ' 萬' + (rest ? ' ' + rest : '');
  }

  // ---------- 序列運算 ----------

  /** 四季移動平均；窗口內任何一季缺值，那一季就回傳 null */
  function smoothSeries(vals, size = 4) {
    return vals.map((v, i) => {
      if (v == null || i < size - 1) return null;
      let sum = 0;
      for (let k = i - size + 1; k <= i; k++) {
        if (vals[k] == null) return null;
        sum += vals[k];
      }
      return sum / size;
    });
  }

  /** 以 base 為 0% 換算漲幅；base 或該點缺值時為 null */
  function toPct(vals, base) {
    return vals.map(v => (v == null || base == null || base === 0 ? null : (v / base - 1) * 100));
  }

  /** 第一個非空值的位置，全空回傳 -1 */
  const firstIndex = vals => vals.findIndex(v => v != null);

  /** 在 idx 之前（含）最後一個非空值的位置，找不到回傳 -1 */
  function lastIndexAtOrBefore(vals, idx) {
    for (let i = Math.min(idx, vals.length - 1); i >= 0; i--) if (vals[i] != null) return i;
    return -1;
  }

  /**
   * 圖表 x 軸從哪一季開始：所有一般序列（非「我家」這類單點序列）最早有資料的那一季。
   * 全部序列都沒資料時回傳 0，避免 slice(-1) 只剩一個點。
   */
  function chartStartIndex(series) {
    const idx = series.filter(s => !s.home).map(s => firstIndex(s.values)).filter(i => i >= 0);
    return idx.length ? Math.min(...idx) : 0;
  }

  /**
   * 可選的基準季：參考序列有值、不晚於最新實際季，平滑時還要湊滿四季。
   * 參考序列 = 第一條一般序列（與原本行為相同）。
   */
  function availableBases(series, quarters, lastIdx, smooth) {
    const ref = series.find(s => !s.home);
    if (!ref) return [];
    const first = firstIndex(ref.values);
    return quarters.filter((q, i) => i <= lastIdx && ref.values[i] != null && (!smooth || i - first >= 3));
  }

  /** 目前的基準季若不可用，改用 preferred，再不行用第一個可用季 */
  function resolveBase(current, bases, preferred) {
    if (bases.includes(current)) return current;
    if (bases.includes(preferred)) return preferred;
    return bases.length ? bases[0] : null;
  }

  /**
   * 把一個 view 的原始序列換算成畫面要的數字：
   * vals（平滑後或原始）、pct（對基準季漲幅）、b（基準值）、fcp（預估的漲幅版本）。
   * 「我家」這類 home 序列只有零星幾點，不做平滑。
   */
  function prepareSeries(series, quarters, base, smooth) {
    const bi = quarters.indexOf(base);
    return series.map(s => {
      const vals = smooth && !s.home ? smoothSeries(s.values) : s.values;
      const b = bi >= 0 ? vals[bi] : null;
      const fcp = s.fc ? { lo: toPct(s.fc.lo, b), mid: toPct(s.fc.mid, b), hi: toPct(s.fc.hi, b) } : null;
      return Object.assign({}, s, { vals, pct: toPct(vals, b), b, fcp });
    });
  }

  /**
   * 表格列：每條顯示中的線，從基準季到「最新實際季」的漲幅，由高到低。
   * 有些線（例如「我家」）最新實際季沒有點，改用該季之前最近的一點，並記下是哪一季。
   */
  function tableRows(prepared, quarters, lastIdx, hidden) {
    return prepared
      .filter(s => !hidden[s.id] && s.b != null)
      .map(s => {
        const li = lastIndexAtOrBefore(s.vals, lastIdx);
        if (li < 0) return null;
        return { s, base: s.b, latest: s.vals[li], latestQuarter: quarters[li], stale: li !== lastIdx, chg: (s.vals[li] / s.b - 1) * 100 };
      })
      .filter(Boolean)
      .sort((a, b) => b.chg - a.chg);
  }

  /**
   * 「我家」重點句要用的數字（總價，歐元）。
   * 現值取最新實際季以前最近的一個點（目前是 2026Q2 銀行估價），不是固定取最新季，
   * 否則最新季沒有估價時會算成 0。
   */
  function homeOutlook(homeSeries, lastIdx, homeEnd, area) {
    if (!homeSeries || !homeEnd || !(area > 0)) return null;
    const li = lastIndexAtOrBefore(homeSeries.values, lastIdx);
    if (li < 0 || homeEnd.lo == null || homeEnd.hi == null) return null;
    const cur = homeSeries.values[li] * area;
    return { cur, lo: homeEnd.lo * area, hi: homeEnd.hi * area, index: li };
  }

  /** 紅字重點句 */
  function keyMessage(view, outlook) {
    if (view === 'm2') {
      if (!outlook) return '';
      const { cur, lo, hi } = outlook;
      const loss = cur - lo;
      const gain = hi - cur;
      return (
        '我家到 2028 年底預估 ' + fmtWan(lo) + ' 到 ' + fmtWan(hi) + '（現在 ' + fmtWan(cur) + '）。' +
        '再等兩年的輸贏：' + (loss >= 0 ? '少 ' : '多 ') + fmtWan(loss) + ' 到 ' + (gain >= 0 ? '多 ' : '少 ') + fmtWan(gain) + '。' +
        '等不到大漲，也不太會大跌。'
      );
    }
    return '全荷蘭 2027 年銀行預估漲 1% 到 3.5%。阿姆斯特丹預估持平，2028 年才可能小漲。';
  }

  return {
    qLabel, qShort, fmtRaw, fmtPct, fmtWan,
    smoothSeries, toPct, firstIndex, lastIndexAtOrBefore, chartStartIndex,
    availableBases, resolveBase, prepareSeries, tableRows, homeOutlook, keyMessage,
  };
});
