#!/usr/bin/env python3
"""從 data/series.json 產生 index.html。執行：python3 build.py

流程：
  1. load_series()      讀 series.json 並檢查格式
  2. build_payload()    挑出要畫的序列、加上「我家」與預估區間
  3. render_html()      把資料與 src/*.js 嵌進 template.html
資料有問題時以 BuildError 中止，不會寫出半壞的 index.html。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent

# 我家：2022Q2 買入合約價與 2026Q2 銀行估價，換算成每 m²（47 m²）。頁面上不放地址。
HOME_AREA = 47
HOME_M2 = {"2022Q2": round(371000 / HOME_AREA), "2026Q2": round(389000 / HOME_AREA)}
# 同棟鄰居成交（46 m²，含車位），2026 年初，每 m²。只有一個點，預設不顯示。
NEIGHBOUR_M2 = {"2026Q1": round(365500 / 46)}

NVM = [
    ("nvm_zuid_m2", "南區 Zuid", "#2a78d6"),
    ("nvm_centrum_m2", "市中心 Centrum", "#6250d6"),
    ("nvm_west_m2", "西區 West", "#e87ba4"),
    ("nvm_oost_m2", "東區 Oost", "#1baf7a"),
    ("nvm_noord_m2", "北區 Noord", "#eb6834"),
    ("nvm_nieuw_west_m2", "新西區 Nieuw-West", "#eda100"),
    ("nvm_zuidoost_m2", "東南區 Zuidoost", "#008300"),
    ("nvm_city_m2", "全市", "#898781"),
]
CBS = [
    ("cbs_amsterdam", "阿姆斯特丹", "#2a78d6"),
    ("cbs_groot_amsterdam", "大阿姆斯特丹", "#6250d6"),
    ("cbs_haarlem_agglo", "哈倫一帶", "#e87ba4"),
    ("cbs_zaanstreek", "Zaanstad 一帶", "#1baf7a"),
    ("cbs_flevoland", "Almere 一帶", "#eda100"),
    ("cbs_utrecht", "烏特勒支", "#008300"),
    ("cbs_rotterdam", "鹿特丹", "#e34948"),
    ("cbs_nl", "全荷蘭", "#898781"),
]

# ---- 預估到 2028Q4 ----
# 年變動假設（低、中、高，%）。來源：ABN AMRO 2026-10、Rabobank 2026-09、ING 2026-09、DNB 2026-06 的全荷蘭預測；
# 阿姆斯特丹沒有銀行預測，所以是依這些報告做的研究判斷（見 Notion 頁面）。2026H2 是剩下的半年。
LAST = "2026Q3"
FUTURE = ["2026Q4"] + [f"{y}Q{q}" for y in (2027, 2028) for q in (1, 2, 3, 4)]
ASSUME = {
    "home":          {"2026H2": (0.0, 0.0, 0.0), "2027": (-4.0, -0.5, 1.0), "2028": (-2.0, 1.0, 3.0)},
    "nvm_city_m2":   {"2026H2": (-0.5, 0.2, 1.0), "2027": (-3.0, 0.5, 2.0), "2028": (-1.0, 2.0, 4.0)},
    "cbs_amsterdam": {"2026H2": (-0.5, 0.2, 1.0), "2027": (-3.0, 0.5, 2.0), "2028": (-1.0, 2.0, 4.0)},
    "cbs_nl":        {"2026H2": (0.5, 1.2, 1.8),  "2027": (1.0, 2.5, 3.5),  "2028": (1.0, 3.0, 4.0)},
}
# 我家 2026Q3 沒有新估價，預估仍從 2026Q2 起算。
HOME_START = "2026Q2"

QUARTER_RE = re.compile(r"^\d{4}Q[1-4]$")
INLINE_RE = re.compile(r"/\*INLINE:([\w./-]+)\*/")


class BuildError(Exception):
    """資料或範本有問題，無法產生頁面。"""


def load_series(path):
    """讀 series.json，檢查 quarters 與每條序列的長度。回傳 (quarters, {id: series})。"""
    try:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise BuildError(f"找不到 {path}，請先執行 data/build_series.py")
    except json.JSONDecodeError as e:
        raise BuildError(f"{path} 不是合法 JSON：{e}")
    quarters = d.get("quarters")
    if not isinstance(quarters, list) or not quarters or not all(isinstance(q, str) and QUARTER_RE.match(q) for q in quarters):
        raise BuildError("series.json 的 quarters 缺少或格式不對（應為 ['2016Q1', ...]）")
    by_id = {}
    for s in d.get("series") or []:
        sid = s.get("id")
        vals = s.get("values")
        if not sid or not isinstance(vals, list):
            print("略過格式不對的序列：", sid, file=sys.stderr)
            continue
        if len(vals) != len(quarters):
            raise BuildError(f"序列 {sid} 有 {len(vals)} 個值，但 quarters 有 {len(quarters)} 季")
        by_id[sid] = s
    return d, quarters, by_id


def pick(defs, by_id):
    """依 defs 挑序列；id 寫法不同（- 和 _）也能對上，找不到的印警告後略過。"""
    out = []
    for sid, label, color in defs:
        if sid not in by_id:
            alt = [k for k in by_id if k.replace("-", "_") == sid]
            if not alt:
                print("missing", sid, file=sys.stderr)
                continue
            sid = alt[0]
        out.append({"id": sid, "label": label, "color": color, "values": list(by_id[sid]["values"])})
    return out


def forecast(start, a, all_q, start_q):
    """從 start_q 的值往後逐季複利推算 lo、mid、hi 三條路徑。
    2026 年各季走 2026H2 假設的一半（半年兩季），所以從 2026Q3 起算只會走 2026Q4 一步。"""
    if start is None:
        raise BuildError(f"預估起點 {start_q} 沒有數字")
    si = all_q.index(start_q)
    out = {}
    for k, name in enumerate(("lo", "mid", "hi")):
        v = start
        path = []
        for q in all_q[si + 1:]:
            if q.startswith("2026"):
                step = (1 + a["2026H2"][k] / 100) ** (1 / 2)
            else:
                step = (1 + a[q[:4]][k] / 100) ** (1 / 4)
            v *= step
            path.append(round(v, 1))
        out[name] = [None] * si + [start] + path
    return out


def build_payload(d, quarters, by_id):
    """組出頁面要的資料：兩個 view（各區每 m²、CBS 指數），含「我家」與預估。"""
    for q in (LAST, HOME_START, *HOME_M2, *NEIGHBOUR_M2):
        if q not in quarters:
            raise BuildError(f"series.json 沒有 {q} 這一季，請確認資料已更新或調整 build.py 的設定")

    nvm = pick(NVM, by_id)
    nvm.insert(0, {"id": "home", "label": "我家", "color": "#0b0b0b", "home": True,
                   "values": [HOME_M2.get(q) for q in quarters]})
    nvm.insert(1, {"id": "neighbour", "label": "同棟鄰居成交", "color": "#52514e", "home": True,
                   "values": [NEIGHBOUR_M2.get(q) for q in quarters]})
    cbs = pick(CBS, by_id)
    if not [s for s in nvm if not s.get("home")] or not cbs:
        raise BuildError("挑不到任何 NVM 或 CBS 序列，請檢查 series.json")

    all_q = quarters + FUTURE
    li = quarters.index(LAST)
    for group in (nvm, cbs):
        for srs in group:
            srs["values"] = srs["values"] + [None] * len(FUTURE)
            if srs["id"] == "home":
                hi_ = all_q.index(HOME_START)
                srs["fc"] = forecast(srs["values"][hi_], ASSUME["home"], all_q, HOME_START)
            elif srs["id"] in ASSUME and srs["values"][li] is not None:
                srs["fc"] = forecast(srs["values"][li], ASSUME[srs["id"]], all_q, LAST)
            elif srs["id"] in ASSUME:
                print(f"警告：{srs['id']} 在 {LAST} 沒有數字，這條線不畫預估", file=sys.stderr)

    home_fc = next(x for x in nvm if x["id"] == "home")["fc"]
    return {"quarters": all_q, "lastActual": LAST, "homeArea": HOME_AREA, "generated": d.get("generated"),
            "homeEnd": {k: home_fc[k][-1] for k in ("lo", "mid", "hi")},
            "views": {"m2": {"unit": "eur", "series": nvm}, "cbs": {"unit": "index", "series": cbs}}}


def render_html(template, payload, root=ROOT):
    """把資料 JSON 與 src/*.js 嵌進範本。"""
    if "/*DATA*/" not in template:
        raise BuildError("template.html 裡找不到 /*DATA*/")
    # 放進 <script> 裡的 JSON 要跳脫 </，避免字串中出現 </script> 時提早結束標籤
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = template.replace("/*DATA*/", data)

    def inline(m):
        src = root / m.group(1)
        if not src.is_file():
            raise BuildError(f"找不到要嵌入的檔案 {m.group(1)}")
        return src.read_text(encoding="utf-8").replace("</script", "<\\/script")

    return INLINE_RE.sub(inline, html)


def main():
    try:
        d, quarters, by_id = load_series(ROOT / "data" / "series.json")
        payload = build_payload(d, quarters, by_id)
        html = render_html((ROOT / "template.html").read_text(encoding="utf-8"), payload)
    except BuildError as e:
        print("build 失敗：", e, file=sys.stderr)
        return 1
    (ROOT / "index.html").write_text(html, encoding="utf-8")
    views = payload["views"]
    print("wrote index.html", len(html), "bytes;",
          [s["id"] for s in views["m2"]["series"]], [s["id"] for s in views["cbs"]["series"]])
    return 0


if __name__ == "__main__":
    sys.exit(main())
