#!/usr/bin/env python3
"""Build index.html from data/series.json. Run: python3 build.py"""
import json
from pathlib import Path

ROOT = Path(__file__).parent
d = json.loads((ROOT / "data" / "series.json").read_text())
quarters = d["quarters"]
by_id = {s["id"]: s for s in d["series"]}

# My home: purchase contract 2022Q2 and bank valuation 2026Q2, per m2 (47 m2). No address on the page.
HOME_M2 = {"2022Q2": round(371000 / 47), "2026Q2": round(389000 / 47)}

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


def pick(defs):
    out = []
    for sid, label, color in defs:
        if sid not in by_id:
            # tolerate id naming differences
            alt = [k for k in by_id if k.replace("-", "_") == sid]
            if not alt:
                print("missing", sid)
                continue
            sid = alt[0]
        out.append({"id": sid, "label": label, "color": color, "values": by_id[sid]["values"]})
    return out


nvm = pick(NVM)
nvm.insert(0, {"id": "home", "label": "我家", "color": "#0b0b0b", "home": True,
               "values": [HOME_M2.get(q) for q in quarters]})
# Same-building sales (46 m2, incl. parking), early 2026, per m2. One point, off by default.
NEIGHBOUR_M2 = {"2026Q1": round(365500 / 46)}
nvm.insert(1, {"id": "neighbour", "label": "同棟鄰居成交", "color": "#52514e", "home": True,
               "values": [NEIGHBOUR_M2.get(q) for q in quarters]})
cbs = pick(CBS)

# ---- Forecast to 2028Q4 ----
# Annual change assumptions (low, mid, high). Sources: ABN AMRO 2026-10, Rabobank 2026-09, ING 2026-09,
# DNB 2026-06 for the Netherlands; for Amsterdam there is no bank forecast, so these are a research
# judgement built on those reports (see Notion page). H2 2026 is the remaining half year.
LAST = "2026Q2"
FUTURE = ["2026Q3", "2026Q4"] + [f"{y}Q{q}" for y in (2027, 2028) for q in (1, 2, 3, 4)]
ASSUME = {
    "home":          {"2026H2": (0.0, 0.0, 0.0), "2027": (-4.0, -0.5, 1.0), "2028": (-2.0, 1.0, 3.0)},
    "nvm_city_m2":   {"2026H2": (-0.5, 0.2, 1.0), "2027": (-3.0, 0.5, 2.0), "2028": (-1.0, 2.0, 4.0)},
    "cbs_amsterdam": {"2026H2": (-0.5, 0.2, 1.0), "2027": (-3.0, 0.5, 2.0), "2028": (-1.0, 2.0, 4.0)},
    "cbs_nl":        {"2026H2": (0.5, 1.2, 1.8),  "2027": (1.0, 2.5, 3.5),  "2028": (1.0, 3.0, 4.0)},
}
all_q = quarters + FUTURE
li = quarters.index(LAST)


def forecast(start, a):
    out = {"lo": [], "mid": [], "hi": []}
    for k, name in enumerate(("lo", "mid", "hi")):
        v = start
        path = []
        for q in FUTURE:
            if q.startswith("2026"):
                step = (1 + a["2026H2"][k] / 100) ** (1 / 2)
            else:
                step = (1 + a[q[:4]][k] / 100) ** (1 / 4)
            v *= step
            path.append(round(v, 1))
        out[name] = [None] * li + [start] + path
    return out


for group in (nvm, cbs):
    for srs in group:
        srs["values"] = srs["values"] + [None] * len(FUTURE)
        if srs["id"] in ASSUME and srs["values"][li] is not None:
            srs["fc"] = forecast(srs["values"][li], ASSUME[srs["id"]])

home_fc = next(x for x in nvm if x["id"] == "home")["fc"]
payload = {"quarters": all_q, "lastActual": LAST, "homeArea": 47, "generated": d["generated"],
           "homeEnd": {k: home_fc[k][-1] for k in ("lo", "mid", "hi")},
           "views": {"m2": {"unit": "eur", "series": nvm}, "cbs": {"unit": "index", "series": cbs}}}

html = (ROOT / "template.html").read_text().replace("/*DATA*/", json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
(ROOT / "index.html").write_text(html)
print("wrote index.html", len(html), "bytes;", [s["id"] for s in nvm], [s["id"] for s in cbs])
