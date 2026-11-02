# 阿姆斯特丹房價線圖

每一季一個點的房價線圖。滑鼠移上去看每一區從基準季到那一季漲了多少，並附到 2028 年底的預估範圍。

- 網頁：https://chouhsuan1202.github.io/amsterdam-housing-chart/

## 用途

- 比較「我家」（買入價與銀行估價，換算成每 m²）和阿姆斯特丹各區公寓每 m² 中位價的走勢。
- 切換到 CBS 房價指數，比較阿姆斯特丹、周邊區域與全荷蘭。
- 可切換「漲幅 %」或「原始數字」、選基準季、開四季平滑；點圖例按鈕加入或拿掉一條線。
- 下方表格列出每條顯示中的線，從基準季到最新一季的漲幅。

## 資料來源

| 來源 | 內容 | 取得方式 |
| --- | --- | --- |
| NVM / MVA 季報 | 各區公寓成交中位價每 m²（只算中古屋） | `data/build_series.py --download` 從 mva.nl 下載 PDF，用 `pdftotext` 轉文字後由 `data/parse_nvm.py` 解析 |
| CBS 開放資料 | 既有住宅價格指數（2020 = 100） | `data/build_cbs.py` 呼叫 CBS OData API（表 85792NED、85819NED、85791NED） |
| 手動輸入 | 我家買入價與銀行估價、同棟鄰居成交、預估假設 | 寫在 `build.py` 最上方的常數 |

每一季每一條序列的出處列在 `data/sources.md`，資料口徑與缺值說明在 `data/notes.json`。

網頁本身**不會在執行時呼叫任何資料 API**：資料在 build 時就嵌進 `index.html`。執行時唯一的外部資源是 Chart.js，先從 cdnjs 載入，失敗或 8 秒沒回應就改用 `vendor/chart.umd.js`（同版本 4.4.1 的備份）。兩個都失敗時，圖表區會顯示錯誤與「重新載入圖表」按鈕，表格和文字照常可用。

## 在本機打開

直接用瀏覽器打開 `index.html` 即可（雙擊或拖進瀏覽器）。不需要伺服器。

如果想用本機伺服器：

```bash
python3 -m http.server 8000
```

再打開 http://localhost:8000/ 。

## 更新資料與重新產生頁面

1. 更新資料（需要網路；NVM 部分還需要 `pdftotext`，屬於 poppler）：

   ```bash
   python3 data/build_series.py --download
   ```

2. 產生 `index.html`：

   ```bash
   python3 build.py
   ```

改了 `template.html` 或 `src/` 之後也要重跑 `python3 build.py`，`index.html` 才會更新。測試會檢查 `index.html` 是否和原始檔同步。

新的一季資料進來時，記得調整 `build.py` 的 `LAST`（最新實際季）與 `data/build_cbs.py` 的 `Q1`。

## 測試

```bash
npm test
```

跑資料轉換與資料驗證的單元測試（Node 內建 test runner），以及 `build.py`、`data/build_cbs.py` 的 Python 測試。不需要安裝任何套件。

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm run test:smoke
```

用 Playwright 實際打開頁面，檢查桌機與 375px 手機版沒有橫向捲動、鍵盤操作、深色模式，以及 Chart.js 載入失敗、逾時、資料壞掉時的錯誤狀態。設定 `SCREENSHOT_DIR=某個資料夾` 會順便存下截圖。

## 檔案結構

```
.
├── index.html            產生出來的頁面（不要直接改，改 template.html 或 src/ 再 build）
├── template.html         頁面骨架與 CSS，含資料與程式碼的插入點
├── build.py              讀 data/series.json，加上我家與預估，嵌入 template.html 產生 index.html
├── src/
│   ├── data.js           資料取得：讀嵌入的 JSON、驗證格式、載入 Chart.js（含備援與逾時）
│   ├── transform.js      資料轉換：平滑、漲幅、基準季、表格列、重點句、數字格式（純函式）
│   └── render.js         畫面渲染：圖表、圖例、表格、文字、事件處理、載入與錯誤狀態
├── vendor/
│   └── chart.umd.js      Chart.js 4.4.1 備份（MIT 授權），CDN 失敗時使用
├── data/
│   ├── series.json       所有序列的季資料（build_series.py 產生）
│   ├── sources.md        每條序列每一季的出處
│   ├── notes.json        資料口徑與缺值說明
│   ├── build_series.py   重建 series.json 與 sources.md
│   ├── build_cbs.py      抓 CBS OData（含重試與格式檢查）
│   └── parse_nvm.py      解析 NVM / MVA 報告文字
├── tests/
│   ├── transform.test.js 資料轉換單元測試
│   ├── data.test.js      資料驗證單元測試
│   ├── smoke.test.js     Playwright smoke test
│   ├── test_build.py     build.py 測試
│   └── test_build_cbs.py CBS 抓取健壯性測試
└── package.json          測試指令
```
