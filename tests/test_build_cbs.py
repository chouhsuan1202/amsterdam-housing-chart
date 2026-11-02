"""data/build_cbs.py 的 API 健壯性測試（不連網，用假的 urlopen）。執行：python3 -m unittest discover -s tests"""
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data"))
import build_cbs  # noqa: E402


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def resp(obj):
    return FakeResp(obj if isinstance(obj, bytes) else json.dumps(obj).encode())


ROW = {"Perioden": "2026KW03", "RegioS": "GM0363", "PrijsindexVerkoopprijzen_1": 150.1}


class CBSFetchTest(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(build_cbs.time, "sleep", lambda s: None)
        p.start()
        self.addCleanup(p.stop)

    def test_parses_quarter_rows(self):
        rows = [ROW, dict(ROW, Perioden="2026JJ00")]  # 年資料要略過
        with mock.patch.object(build_cbs.urllib.request, "urlopen", return_value=resp({"value": rows})):
            res = build_cbs.fetch("85792NED", "RegioS", ["GM0363"], "PrijsindexVerkoopprijzen_1")
        self.assertEqual(res, {"GM0363": {"2026Q3": 150.1}})

    def test_retries_then_succeeds(self):
        calls = [urllib.error.URLError("down"), TimeoutError(), resp({"value": [ROW]})]

        def side(*a, **k):
            c = calls.pop(0)
            if isinstance(c, BaseException):
                raise c
            return c

        with mock.patch.object(build_cbs.urllib.request, "urlopen", side_effect=side):
            self.assertEqual(build_cbs.get("u")["value"], [ROW])

    def test_gives_up_after_retries(self):
        with mock.patch.object(build_cbs.urllib.request, "urlopen", side_effect=urllib.error.URLError("down")):
            with self.assertRaises(build_cbs.CBSError):
                build_cbs.get("u")

    def test_format_change_raises(self):
        for body in ({"data": []}, [1, 2], {"value": [{"Perioden": "2026KW03"}]}, {"value": []}):
            with mock.patch.object(build_cbs.urllib.request, "urlopen", return_value=resp(body)):
                with self.assertRaises(build_cbs.CBSError, msg=str(body)):
                    build_cbs.fetch("85792NED", "RegioS", ["GM0363"], "PrijsindexVerkoopprijzen_1")

    def test_invalid_json_raises(self):
        with mock.patch.object(build_cbs.urllib.request, "urlopen", side_effect=lambda *a, **k: resp(b"<html>")):
            with self.assertRaises(build_cbs.CBSError):
                build_cbs.get("u")


if __name__ == "__main__":
    unittest.main()
