# 阿姆斯特丹房價線圖

每一季一個點的房價線圖。滑鼠移上去看每一區的漲幅。

- 網頁：https://chouhsuan1202.github.io/amsterdam-housing-chart/
- 資料：NVM 與 MVA 季報（公寓每平方公尺成交中位價）、CBS 既有住宅價格指數。
- 重新產生：`python3 data/build_series.py` 更新資料，再 `python3 build.py` 產生 `index.html`。
