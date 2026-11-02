"""Checks for build.py output. Run: python3 -m unittest discover tests"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def payload_of(html):
    m = re.search(r"const DATA = (\{.*?\});\n", html)
    return json.loads(m.group(1))


class BuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tmp = Path(tempfile.mkdtemp())
        for f in ("build.py", "template.html"):
            shutil.copy(ROOT / f, tmp / f)
        (tmp / "data").mkdir()
        shutil.copy(ROOT / "data" / "series.json", tmp / "data" / "series.json")
        subprocess.run([sys.executable, str(tmp / "build.py")], check=True, capture_output=True)
        cls.built = (tmp / "index.html").read_text()
        cls.d = payload_of(cls.built)
        shutil.rmtree(tmp)

    def test_index_is_up_to_date(self):
        self.assertEqual(self.built, (ROOT / "index.html").read_text(),
                         "index.html is stale: run python3 build.py")

    def test_quarters_and_last_actual(self):
        q = self.d["quarters"]
        self.assertEqual(q[-1], "2028Q4")
        self.assertIn(self.d["lastActual"], q)
        self.assertEqual(len(q), len(set(q)))

    def test_series_lengths(self):
        n = len(self.d["quarters"])
        for v in self.d["views"].values():
            for s in v["series"]:
                self.assertEqual(len(s["values"]), n, s["id"])
                for k in ("lo", "mid", "hi"):
                    if "fc" in s:
                        self.assertEqual(len(s["fc"][k]), n, s["id"])

    def test_no_actuals_after_last_actual(self):
        li = self.d["quarters"].index(self.d["lastActual"])
        for v in self.d["views"].values():
            for s in v["series"]:
                self.assertTrue(all(x is None for x in s["values"][li + 1:]), s["id"])

    def test_forecast_band_ordered_and_starts_at_actual(self):
        for v in self.d["views"].values():
            for s in v["series"]:
                if "fc" not in s:
                    continue
                lo, mid, hi = (s["fc"][k] for k in ("lo", "mid", "hi"))
                start = next(i for i, x in enumerate(mid) if x is not None)
                self.assertEqual(mid[start], s["values"][start], s["id"])
                for a, b, c in zip(lo[start:], mid[start:], hi[start:]):
                    self.assertLessEqual(a, b + 1e-9, s["id"])
                    self.assertLessEqual(b, c + 1e-9, s["id"])

    def test_home_points(self):
        home = next(s for s in self.d["views"]["m2"]["series"] if s["id"] == "home")
        q = self.d["quarters"]
        self.assertEqual(home["values"][q.index("2022Q2")], round(371000 / 47))
        self.assertEqual(home["values"][q.index("2026Q2")], round(389000 / 47))
        self.assertEqual(self.d["homeEnd"]["mid"], home["fc"]["mid"][-1])

    def test_cbs_annual_assumption(self):
        # cbs_nl 2027 mid is +2.5%: 2027Q4 / 2026Q4 must be 1.025
        q = self.d["quarters"]
        s = next(s for s in self.d["views"]["cbs"]["series"] if s["id"] == "cbs_nl")
        r = s["fc"]["mid"][q.index("2027Q4")] / s["fc"]["mid"][q.index("2026Q4")]
        self.assertAlmostEqual(r, 1.025, places=2)

    def test_no_em_dash_in_page(self):
        self.assertNotIn("—", (ROOT / "template.html").read_text())


if __name__ == "__main__":
    unittest.main()
