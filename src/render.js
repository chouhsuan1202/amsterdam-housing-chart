/*
 * 畫面渲染層：讀狀態、呼叫 HousingTransform 算數字、更新 DOM 與 Chart.js。
 * 依賴 window.HousingData 與 window.HousingTransform（build.py 會把三支檔案依序嵌進 index.html）。
 */
(function () {
  'use strict';
  const T = window.HousingTransform;
  const D = window.HousingData;

  const CHART_SOURCES = [
    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
    'vendor/chart.umd.js',
  ];
  const DEFAULT_BASE = '2022Q2'; // 買房那一季
  const DEFAULT_ON = { m2: ['home', 'nvm_city_m2'], cbs: ['cbs_amsterdam', 'cbs_nl'] };
  const VIEW_TEXT = { m2: '阿姆斯特丹各區公寓每 m² 價格', cbs: '荷蘭各地房價指數' };
  const FORECAST_NOTE =
    ' 虛線和淡色區塊是到 2028 年底的預估範圍。全荷蘭用銀行預測（ABN AMRO、Rabobank、ING、荷蘭央行，2026 年 6 月到 10 月發布）。' +
    '沒有銀行針對阿姆斯特丹做預測，阿姆斯特丹和我家的範圍是依這些報告做的判斷，不是保證。';

  const $ = id => document.getElementById(id);
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  let DATA = null;
  let Q = [];
  let LI = 0;
  let chart = null;
  let chartLib = null; // Chart.js 載入成功後才有值
  const state = { view: 'm2', mode: 'pct', base: DEFAULT_BASE, smooth: false, hidden: {} };

  // ---------- 狀態訊息 ----------

  /** 整頁無法使用時：隱藏控制項，只留錯誤訊息 */
  function showFatal(message) {
    document.body.classList.add('is-fatal');
    const el = $('fatal');
    el.hidden = false;
    el.querySelector('[data-msg]').textContent = message;
  }

  /** 圖表區的覆蓋訊息：loading、error、empty，或傳 null 清掉 */
  function setChartStatus(kind, message) {
    const box = $('chart-status');
    const retry = $('chart-retry');
    if (!kind) { box.hidden = true; box.dataset.kind = ''; return; }
    box.hidden = false;
    box.dataset.kind = kind;
    box.querySelector('[data-msg]').textContent = message;
    retry.hidden = kind !== 'error';
  }

  // ---------- 各區塊渲染 ----------

  function renderBaseSelect(bases) {
    const sel = $('base');
    sel.textContent = '';
    for (const q of bases) {
      const opt = document.createElement('option');
      opt.value = q;
      opt.textContent = T.qLabel(q) + (q === DEFAULT_BASE ? '（我買房那季）' : '');
      opt.selected = q === state.base;
      sel.appendChild(opt);
    }
    sel.disabled = bases.length === 0;
  }

  function renderLegend(series) {
    const box = $('legend');
    // 重畫前記住鍵盤焦點在哪一顆，重畫後放回去，否則按 Enter 之後焦點會掉到 body
    const focusedId = box.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    box.textContent = '';
    for (const s of series) {
      const on = !state.hidden[s.id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = s.id;
      btn.className = on ? '' : 'off';
      btn.setAttribute('aria-pressed', String(on));
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.setAttribute('aria-hidden', 'true');
      sw.style.background = s.home ? css('--home') : s.color;
      btn.append(sw, document.createTextNode(s.label));
      box.appendChild(btn);
    }
    if (focusedId) {
      const again = box.querySelector('button[data-id="' + CSS.escape(focusedId) + '"]');
      if (again) again.focus();
    }
  }

  function renderTable(prepared, unit) {
    $('th-base').textContent = state.base ? T.qShort(state.base) : '基準季';
    $('th-last').textContent = T.qShort(Q[LI]);
    const rows = T.tableRows(prepared, Q, LI, state.hidden);
    const tb = $('tb');
    tb.textContent = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.s.home) tr.className = 'home';
      const cells = [r.s.label, T.fmtRaw(r.base, unit), T.fmtRaw(r.latest, unit), T.fmtPct(r.chg)];
      cells.forEach((text, i) => {
        const td = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) td.scope = 'row';
        td.textContent = text;
        if (i === 3) td.className = r.chg >= 0 ? 'up' : 'down';
        // 這條線最新實際季沒有點（例如「我家」），標出實際用的是哪一季
        if (i === 2 && r.stale) {
          const asof = document.createElement('small');
          asof.className = 'asof';
          asof.textContent = T.qShort(r.latestQuarter);
          td.append(' ', asof);
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }
    $('table-empty').hidden = rows.length > 0;
  }

  function renderText(viewSeries) {
    const home = viewSeries.find(s => s.id === 'home');
    const outlook = state.view === 'm2' ? T.homeOutlook(home, LI, DATA.homeEnd, DATA.homeArea) : null;
    $('key').textContent = T.keyMessage(state.view, outlook);
    const updated = '實際數字更新到 ' + T.qLabel(Q[LI]) + '。';
    $('note').textContent =
      (state.view === 'm2'
        ? '資料：NVM 與 MVA 季報，公寓成交中位價每平方公尺，只算中古屋。小區每季成交件數少，單季會跳，看趨勢比較準。「我家」只有兩個點：買入價與 2026 年銀行估價，換算成每平方公尺。' + updated
        : '資料：荷蘭統計局 CBS 既有住宅價格指數（2020 年 = 100），所有房型。區域是 CBS 的統計區，不是單一城市。' + updated) + FORECAST_NOTE;
  }

  /** 給螢幕閱讀器的圖表摘要，跟著目前顯示的線更新 */
  function chartAriaLabel(prepared) {
    const on = prepared.filter(s => !state.hidden[s.id]).map(s => s.label);
    return '線圖：' + VIEW_TEXT[state.view] + '逐季' + (state.mode === 'pct' ? '漲幅' : '數字') +
      '，含到 2028 年底的預估。目前顯示：' + (on.length ? on.join('、') : '無') + '。各線數字見下方表格。';
  }

  // ---------- Chart.js 設定 ----------

  /** 每個年份標籤大約需要 36px，不夠就每 2 年（或更多）標一次 */
  function yearStep(width, labels) {
    const years = labels.filter(q => q.endsWith('Q1')).length || 1;
    return Math.max(1, Math.ceil((36 * years) / Math.max(width, 1)));
  }

  function buildChartConfig(prepared, firstIdx, unit) {
    const labels = Q.slice(firstIdx);
    const lastLabelIdx = labels.indexOf(Q[LI]);
    const muted = css('--muted');
    const line = css('--line');
    const homeColor = css('--home');
    const pctMode = state.mode === 'pct';

    const datasets = prepared.map(s => {
      const color = s.home ? homeColor : s.color;
      return {
        label: s.label, data: (pctMode ? s.pct : s.vals).slice(firstIdx),
        _raw: s.vals.slice(firstIdx), _pct: s.pct.slice(firstIdx),
        borderColor: color, backgroundColor: color, borderWidth: s.home ? 3 : 2, borderDash: s.home ? [6, 4] : [],
        pointRadius: s.home ? 5 : 2.5, pointHoverRadius: s.home ? 7 : 5, pointStyle: s.home ? 'rectRot' : 'circle',
        spanGaps: !!s.home, tension: 0, hidden: !!state.hidden[s.id], _id: s.id,
      };
    });

    // 預估：低、高兩條細線中間填色，再加一條中位虛線
    for (const s of prepared) {
      if (!s.fc || state.hidden[s.id]) continue;
      const color = s.home ? homeColor : s.color;
      const pick = k => (pctMode ? s.fcp[k] : s.fc[k]).slice(firstIdx);
      const common = { borderColor: color, backgroundColor: color + '22', pointRadius: 0, pointHoverRadius: 0, tension: 0, _fc: true, _id: s.id };
      datasets.push(Object.assign({}, common, { label: s.label + ' 預估低', data: pick('lo'), borderWidth: 1, borderDash: [2, 3], fill: false, _band: 'lo' }));
      datasets.push(Object.assign({}, common, { label: s.label + ' 預估高', data: pick('hi'), borderWidth: 1, borderDash: [2, 3], fill: '-1', _band: 'hi' }));
      datasets.push(Object.assign({}, common, {
        label: s.label + ' 預估', data: pick('mid'), borderWidth: 2, borderDash: [5, 4], pointRadius: 2, pointHoverRadius: 5, _band: 'mid',
        _raw: s.fc.mid.slice(firstIdx), _pct: s.fcp.mid.slice(firstIdx),
        _lo: s.fc.lo.slice(firstIdx), _hi: s.fc.hi.slice(firstIdx), _plo: s.fcp.lo.slice(firstIdx), _phi: s.fcp.hi.slice(firstIdx),
      }));
    }

    // 「← 實際 | 預估 →」分隔線
    const nowLine = {
      id: 'nowLine',
      afterDraw(c) {
        if (lastLabelIdx < 0) return;
        const x = c.scales.x.getPixelForValue(lastLabelIdx);
        const a = c.chartArea;
        const g = c.ctx;
        g.save();
        g.strokeStyle = muted; g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(x, a.top); g.lineTo(x, a.bottom); g.stroke();
        g.setLineDash([]); g.fillStyle = muted; g.font = '12px -apple-system,sans-serif';
        g.textAlign = 'left'; g.fillText('預估 →', x + 6, a.top + 12);
        g.textAlign = 'right'; g.fillText('← 實際', x - 6, a.top + 12);
        g.restore();
      },
    };

    const tooltipLabel = c => {
      const ds = c.dataset;
      const i = c.dataIndex;
      if (ds._fc) {
        let t = ds.label + '：' + T.fmtRaw(ds._lo[i], unit) + ' 到 ' + T.fmtRaw(ds._hi[i], unit);
        if (ds._plo[i] != null && ds._phi[i] != null) t += '（' + T.fmtPct(ds._plo[i]) + ' 到 ' + T.fmtPct(ds._phi[i]) + '）';
        return t;
      }
      let t = ds.label + '：' + T.fmtRaw(ds._raw[i], unit);
      if (ds._pct[i] != null) t += '，' + T.fmtPct(ds._pct[i]);
      return t;
    };

    return {
      type: 'line',
      data: { labels, datasets },
      plugins: [nowLine],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            itemSort: (a, b) => (b.parsed.y ?? -1e9) - (a.parsed.y ?? -1e9),
            // 實際線全部顯示；預估只顯示中位線，而且只在預估季
            filter: i => i.parsed.y != null && (!i.dataset._fc || (i.dataset._band === 'mid' && i.dataIndex > lastLabelIdx)),
            callbacks: {
              title: items => (items.length ? T.qLabel(items[0].label) + (state.base ? '（對比 ' + T.qLabel(state.base) + '）' : '') : ''),
              label: tooltipLabel,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: muted, autoSkip: false, maxRotation: 0,
              // 只在每年第 1 季標年份；寬度不夠時（手機看 2016 起的指數）隔年標一次，避免文字重疊
              callback(v) {
                const q = this.getLabelForValue(v);
                if (!q.endsWith('Q1')) return '';
                const step = yearStep(this.chart.width, labels);
                return (Number(q.slice(0, 4)) - Number(labels[0].slice(0, 4))) % step === 0 ? q.slice(0, 4) : '';
              },
            },
            grid: { display: false },
          },
          y: {
            ticks: { color: muted, callback: v => (pctMode ? (v > 0 ? '+' : '') + v + '%' : unit === 'eur' ? '€' + v.toLocaleString('en-US') : v) },
            grid: { color: ctx => (pctMode && ctx.tick.value === 0 ? muted : line) },
          },
        },
      },
    };
  }

  function renderChart(prepared, firstIdx, unit) {
    const canvas = $('c');
    canvas.setAttribute('aria-label', chartAriaLabel(prepared));
    if (!chartLib) return; // 還在載入或載入失敗，狀態訊息已經顯示
    if (chart) { chart.destroy(); chart = null; }
    if (!prepared.length) { setChartStatus('empty', '這個資料組目前沒有可顯示的數字。'); return; }
    if (prepared.every(s => state.hidden[s.id])) {
      setChartStatus('empty', '目前沒有選任何一條線。點上方的地區按鈕加回來。');
    } else {
      setChartStatus(null);
    }
    try {
      chart = new chartLib(canvas, buildChartConfig(prepared, firstIdx, unit));
    } catch (e) {
      console.error('[圖表]', e);
      setChartStatus('error', '圖表畫不出來。下方表格的數字仍可使用。');
    }
  }

  // ---------- 主流程 ----------

  /** 依目前 state 重畫全部 */
  function render() {
    const view = DATA.views[state.view];
    const bases = T.availableBases(view.series, Q, LI, state.smooth);
    state.base = T.resolveBase(state.base, bases, DEFAULT_BASE);
    renderBaseSelect(bases);

    const prepared = T.prepareSeries(view.series, Q, state.base, state.smooth);
    const firstIdx = T.chartStartIndex(view.series);
    renderLegend(view.series);
    renderTable(prepared, view.unit);
    renderText(view.series);
    renderChart(prepared, firstIdx, view.unit);
  }

  /** 兩顆一組的切換按鈕（aria-pressed） */
  function bindSegment(idA, idB, key, valA, valB) {
    const a = $(idA);
    const b = $(idB);
    const set = v => {
      state[key] = v;
      a.setAttribute('aria-pressed', String(v === valA));
      b.setAttribute('aria-pressed', String(v === valB));
      render();
    };
    a.addEventListener('click', () => set(valA));
    b.addEventListener('click', () => set(valB));
  }

  function bindControls() {
    $('legend').addEventListener('click', e => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      state.hidden[btn.dataset.id] = !state.hidden[btn.dataset.id];
      render();
    });
    bindSegment('v-m2', 'v-cbs', 'view', 'm2', 'cbs');
    bindSegment('m-pct', 'm-raw', 'mode', 'pct', 'raw');
    $('base').addEventListener('change', e => { state.base = e.target.value; render(); });
    $('smooth').addEventListener('change', e => { state.smooth = e.target.checked; render(); });
    $('chart-retry').addEventListener('click', loadChart);
    // 系統切換深淺色時，圖表顏色要跟著換
    const mq = matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', render);
  }

  function loadChart() {
    setChartStatus('loading', '圖表載入中…');
    D.loadChartLib(CHART_SOURCES)
      .then(lib => { chartLib = lib; render(); })
      .catch(err => {
        console.error('[圖表元件]', err);
        setChartStatus('error', '圖表元件載入失敗，可能是網路不穩或被擋廣告外掛擋下。下方表格的數字仍可使用。');
      });
  }

  function init() {
    const result = D.validateData(D.readEmbeddedData('housing-data'));
    result.warnings.forEach(w => console.warn('[資料]', w));
    if (result.error) {
      showFatal('資料讀取失敗（' + result.error + '）。請重新產生 index.html 或稍後再試。');
      return;
    }
    DATA = result.data;
    Q = DATA.quarters;
    LI = Q.indexOf(DATA.lastActual);
    for (const vid in DATA.views) {
      for (const s of DATA.views[vid].series) if (!(DEFAULT_ON[vid] || []).includes(s.id)) state.hidden[s.id] = true;
    }
    bindControls();
    // 表格與文字不需要 Chart.js，先畫出來；圖表等元件載入完再補上
    render();
    loadChart();
  }

  init();
})();
