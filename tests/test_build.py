"""build.py 單元測試。執行：python3 -m unittest discover -s tests"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


class ForecastTest(unittest.TestCase):
    def test_flat_assumption_keeps_value(self):
        all_q = ["2026Q2", "2026Q3", "2026Q4", "2027Q1"]
        a = {"2026H2": (0, 0, 0), "2027": (0, 0, 0)}
        fc = build.forecast(100, a, all_q, "2026Q3")
        self.assertEqual(fc["mid"], [None, 100, 100.0, 100.0])

    def test_2026_quarters_take_half_of_h2(self):
        all_q = ["2026Q3", "2026Q4"]
        a = {"2026H2": (0, 4.0, 0)}
        fc = build.forecast(100, a, all_q, "2026Q3")
        # 半年 4%，一季走 sqrt(1.04)
        self.assertAlmostEqual(fc["mid"][1], round(100 * 1.04 ** 0.5, 1))

    def test_full_year_compounds_quarterly(self):
        all_q = ["2026Q4", "2027Q1", "2027Q2", "2027Q3", "2027Q4"]
        a = {"2026H2": (0, 0, 0), "2027": (-4.0, 0, 8.0)}
        fc = build.forecast(1000, a, all_q, "2026Q4")
        self.assertAlmostEqual(fc["lo"][-1], 960.0, places=0)
        self.assertAlmostEqual(fc["hi"][-1], 1080.0, places=0)

    def test_missing_start_raises(self):
        with self.assertRaises(build.BuildError):
            build.forecast(None, build.ASSUME["home"], ["2026Q2"], "2026Q2")


class LoadAndPayloadTest(unittest.TestCase):
    def test_real_series_builds(self):
        d, quarters, by_id = build.load_series(ROOT / "data" / "series.json")
        payload = build.build_payload(d, quarters, by_id)
        self.assertEqual(payload["lastActual"], "2026Q3")
        self.assertEqual(payload["quarters"][-1], "2028Q4")
        n = len(payload["quarters"])
        for view in payload["views"].values():
            for s in view["series"]:
                self.assertEqual(len(s["values"]), n, s["id"])
                if "fc" in s:
                    for k in ("lo", "mid", "hi"):
                        self.assertEqual(len(s["fc"][k]), n, s["id"])
        home = payload["views"]["m2"]["series"][0]
        self.assertEqual(home["id"], "home")
        # 我家的預估從 2026Q2 起算（2026Q3 沒有新估價）
        self.assertEqual(home["fc"]["mid"][payload["quarters"].index("2026Q2")], round(389000 / 47))

    def test_missing_file(self):
        with self.assertRaises(build.BuildError):
            build.load_series(ROOT / "data" / "does-not-exist.json")

    def _write(self, tmp, obj):
        p = Path(tmp) / "s.json"
        p.write_text(json.dumps(obj) if not isinstance(obj, str) else obj, encoding="utf-8")
        return p

    def test_bad_json_and_bad_quarters(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(build.BuildError):
                build.load_series(self._write(tmp, "{not json"))
            with self.assertRaises(build.BuildError):
                build.load_series(self._write(tmp, {"quarters": ["2026-1"], "series": []}))
            with self.assertRaises(build.BuildError):
                build.load_series(self._write(tmp, {"quarters": ["2026Q1"], "series": [{"id": "a", "values": [1, 2]}]}))

    def test_missing_last_quarter_raises(self):
        d = {"quarters": ["2022Q2"], "series": []}
        with self.assertRaises(build.BuildError):
            build.build_payload(d, d["quarters"], {})


class RenderTest(unittest.TestCase):
    def test_escapes_script_close_in_json(self):
        html = build.render_html("<script>/*DATA*/</script>", {"x": "</script><b>"})
        self.assertNotIn("</script><b>", html)
        self.assertEqual(json.loads(html[len("<script>"):-len("</script>")])["x"], "</script><b>")

    def test_inlines_src_files(self):
        html = build.render_html("/*DATA*/<script>/*INLINE:src/transform.js*/</script>", {})
        self.assertIn("HousingTransform", html)

    def test_missing_placeholder_or_inline_file(self):
        with self.assertRaises(build.BuildError):
            build.render_html("no placeholder", {})
        with self.assertRaises(build.BuildError):
            build.render_html("/*DATA*//*INLINE:src/nope.js*/", {})

    def test_index_html_is_up_to_date(self):
        d, quarters, by_id = build.load_series(ROOT / "data" / "series.json")
        expected = build.render_html((ROOT / "template.html").read_text(encoding="utf-8"), build.build_payload(d, quarters, by_id))
        self.assertEqual((ROOT / "index.html").read_text(encoding="utf-8"), expected,
                         "index.html 跟 template.html、src/ 或資料不同步，請執行 python3 build.py")


if __name__ == "__main__":
    unittest.main()
