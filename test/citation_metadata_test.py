#!/usr/bin/env python3
"""Unit tests of tools/check_citation_metadata.py on the repository's own files and on edited copies.

    citation_metadata_test.py <tools/check_citation_metadata.py> <repository root> <version>

Skips (77) without PyYAML.
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest

try:
    import yaml  # noqa: F401
except ImportError:
    print("PyYAML not installed: skipped")
    sys.exit(77)

TOOL, ROOT, VERSION = (sys.argv[1:4] if len(sys.argv) >= 4 else
                       (os.path.join(os.path.dirname(__file__), "..", "tools", "check_citation_metadata.py"),
                        os.path.join(os.path.dirname(__file__), ".."), None))
del sys.argv[1:4]
SPEC = importlib.util.spec_from_file_location("ccm", TOOL)
ccm = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ccm)


class CitationMetadata(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        for f in ("CITATION.cff", "codemeta.json"):
            shutil.copy(os.path.join(ROOT, f), self.dir)
        meta = json.load(open(os.path.join(self.dir, "codemeta.json")))
        self.version = meta["version"]
        self.date = meta["datePublished"]
        with open(os.path.join(self.dir, "CHANGELOG.md"), "w") as f:
            f.write(f"# Changelog\n\n## Unreleased\n\n- x\n\n## {self.version} ({self.date})\n\n- y\n")

    def tearDown(self):
        shutil.rmtree(self.dir)

    def edit(self, name, old, new):
        p = os.path.join(self.dir, name)
        s = open(p).read()
        self.assertIn(old, s)
        open(p, "w").write(s.replace(old, new))

    def test_repository_files_agree(self):
        if VERSION:
            self.assertEqual(self.version, VERSION, "codemeta.json and CMakeLists.txt disagree")
        self.assertEqual(ccm.check(self.version, ROOT if VERSION else self.dir), [])

    def test_copy_passes(self):
        self.assertEqual(ccm.check(self.version, self.dir), [])

    def test_other_version_fails_everywhere(self):
        errors = ccm.check("99.0.0", self.dir)
        for k in ("CHANGELOG.md has no heading", "CITATION.cff: version", "codemeta.json: version",
                  "softwareVersion", "downloadUrl", "releaseNotes"):
            self.assertTrue(any(k in e for e in errors), (k, errors))

    def test_stale_date(self):
        self.edit("CITATION.cff", f"date-released: {self.date}", "date-released: 2000-01-01")
        errors = ccm.check(self.version, self.dir)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("date-released", errors[0])

    def test_missing_key(self):
        self.edit("codemeta.json", '"softwareVersion"', '"softwareVersionX"')
        self.assertIn("codemeta.json has no 'softwareVersion'", ccm.check(self.version, self.dir))

    def test_broken_yaml(self):
        with open(os.path.join(self.dir, "CITATION.cff"), "a") as f:
            f.write("authors: [\n")
        errors = ccm.check(self.version, self.dir)
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith("CITATION.cff:"), errors)

    def test_broken_json(self):
        with open(os.path.join(self.dir, "codemeta.json"), "a") as f:
            f.write("}")
        self.assertTrue(ccm.check(self.version, self.dir)[0].startswith("codemeta.json:"))


if __name__ == "__main__":
    unittest.main()
