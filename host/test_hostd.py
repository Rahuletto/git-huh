"""Tests for the shaping rules: `python3 -m unittest host/test_hostd.py`."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import hostd  # noqa: E402

STATUS = json.dumps({
    "watchers": {
        "a": {"last_status": "ok", "checks": 3, "last_check": 100},
        "b": {"last_status": "fetch_error", "checks": 5, "last_check": 200},
        "c": {"last_status": "ok", "checks": 1, "last_check": 300},
    }
})


def panel(**rules):
    rules.setdefault("id", "p")
    rules.setdefault("title", "p")
    rules.setdefault("kind", "stat")
    return rules


class Pick(unittest.TestCase):
    def test_count_with_a_negated_where(self):
        p = panel(path="watchers.*", where={"last_status": "!ok"}, reduce="count")
        self.assertEqual(hostd.pick(STATUS, p), 1)

    def test_sum_of_a_field_across_an_object(self):
        p = panel(path="watchers.*.checks", reduce="sum")
        self.assertEqual(hostd.pick(STATUS, p), 9)

    def test_bars_group_by_a_field(self):
        p = panel(kind="bars", path="watchers.*", group="last_status")
        self.assertEqual(
            hostd.pick(STATUS, p),
            [{"label": "ok", "value": 2}, {"label": "fetch_error", "value": 1}],
        )

    def test_table_columns_keep_the_key(self):
        p = panel(
            kind="table",
            path="watchers.*",
            sort="checks",
            desc=True,
            columns=[{"label": "name", "path": "_key"}, {"label": "n", "path": "checks"}],
        )
        self.assertEqual(hostd.pick(STATUS, p)["rows"], [["b", "5"], ["a", "3"], ["c", "1"]])

    def test_text_becomes_lines_and_a_regex_pulls_a_number(self):
        self.assertEqual(hostd.pick("one\n\ntwo\n", panel(kind="list")), ["one", "two"])
        self.assertEqual(hostd.pick("used 42% of /", panel(regex=r"(\d+)%")), 42)

    def test_a_command_table_splits_on_whitespace(self):
        p = panel(kind="table", headers=["proc", "cpu"])
        self.assertEqual(hostd.pick("node 12.1\npython 1\n", p), {"columns": ["proc", "cpu"], "rows": [["node", "12.1"], ["python", "1"]], "total": 2})

    def test_status_against_an_expected_value(self):
        self.assertEqual(hostd.pick("ok", panel(kind="status", ok="ok", parse="text")), {"ok": True, "text": "ok"})
        self.assertEqual(hostd.pick("down", panel(kind="status", ok="ok", parse="text"))["ok"], False)

    def test_numeric_where(self):
        p = panel(path="watchers.*", where={"checks": ">2"}, reduce="count")
        self.assertEqual(hostd.pick(STATUS, p), 2)


class Config(unittest.TestCase):
    def test_interpolation_reads_env(self):
        os.environ["HOSTD_TEST"] = "secret"
        self.assertEqual(hostd.interpolate({"a": ["Bearer ${env:HOSTD_TEST}"]}), {"a": ["Bearer secret"]})

    def test_example_config_loads(self):
        from pathlib import Path

        config = hostd.load_config(Path(__file__).with_name("config.example.json"))
        self.assertTrue(config["services"])


if __name__ == "__main__":
    unittest.main()
