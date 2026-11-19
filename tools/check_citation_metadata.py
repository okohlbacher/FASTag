#!/usr/bin/env python3
"""Check that CITATION.cff and codemeta.json describe one release.

    check_citation_metadata.py <version> [repository root]

Both files must parse (YAML, JSON) and carry their required keys, and name
<version> and the date of its CHANGELOG.md heading "## <version> (<date>)":

  CITATION.cff   version, date-released
  codemeta.json  version, softwareVersion, datePublished,
                 downloadUrl  .../releases/tag/v<version>,
                 releaseNotes .../blob/v<version>/CHANGELOG.md

Run on tags by the release-notes job of .github/workflows/ci.yml, so a tag
whose citation metadata still names the previous release is a red run.
Exits 1 listing every mismatch. Needs PyYAML.
"""
import datetime
import json
import re
import sys
from pathlib import Path

import yaml

REPO = "https://github.com/okohlbacher/FASTag"
CFF_REQUIRED = ["cff-version", "message", "title", "type", "authors", "version", "date-released",
                "license", "repository-code"]
CODEMETA_REQUIRED = ["@context", "@type", "name", "version", "softwareVersion", "datePublished",
                     "license", "codeRepository", "author", "downloadUrl", "releaseNotes"]


def changelog_date(text: str, version: str) -> str | None:
    m = re.search(r"^##\s+v?" + re.escape(version) + r"\s+\((\d{4}-\d{2}-\d{2})\)", text, re.M)
    return m.group(1) if m else None


def check(version: str, root) -> list[str]:
    root = Path(root)
    errors = []
    try:
        cff = yaml.safe_load((root / "CITATION.cff").read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as e:
        return [f"CITATION.cff: {e}"]
    try:
        meta = json.loads((root / "codemeta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [f"codemeta.json: {e}"]
    if not isinstance(cff, dict):
        return ["CITATION.cff is not a YAML mapping"]
    if not isinstance(meta, dict):
        return ["codemeta.json is not a JSON object"]
    errors += [f"CITATION.cff has no '{k}'" for k in CFF_REQUIRED if not cff.get(k)]
    errors += [f"codemeta.json has no '{k}'" for k in CODEMETA_REQUIRED if not meta.get(k)]

    try:
        date = changelog_date((root / "CHANGELOG.md").read_text(encoding="utf-8"), version)
    except OSError as e:
        return errors + [f"CHANGELOG.md: {e}"]
    if date is None:
        errors.append(f"CHANGELOG.md has no heading '## {version} (YYYY-MM-DD)'")

    # YAML reads an unquoted date as datetime.date; compare as text.
    def text(v):
        return v.isoformat() if isinstance(v, datetime.date) else str(v) if v is not None else None

    want = [
        ("CITATION.cff", "version", text(cff.get("version")), version),
        ("codemeta.json", "version", text(meta.get("version")), version),
        ("codemeta.json", "softwareVersion", text(meta.get("softwareVersion")), version),
        ("codemeta.json", "downloadUrl", meta.get("downloadUrl"), f"{REPO}/releases/tag/v{version}"),
        ("codemeta.json", "releaseNotes", meta.get("releaseNotes"), f"{REPO}/blob/v{version}/CHANGELOG.md"),
    ]
    if date is not None:
        want += [
            ("CITATION.cff", "date-released", text(cff.get("date-released")), date),
            ("codemeta.json", "datePublished", text(meta.get("datePublished")), date),
        ]
    for f, k, got, exp in want:
        if got is not None and got != exp:
            errors.append(f"{f}: {k} is '{got}', expected '{exp}'")
    return errors


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        return 2
    version = sys.argv[1].removeprefix("v")
    root = Path(sys.argv[2] if len(sys.argv) == 3 else Path(__file__).resolve().parent.parent)
    errors = check(version, root)
    for e in errors:
        print(f"citation metadata: {e}", file=sys.stderr)
    if errors:
        return 1
    print(f"citation metadata: CITATION.cff and codemeta.json name {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
