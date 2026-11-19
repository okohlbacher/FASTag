#!/usr/bin/env python3
"""Print the CHANGELOG.md section of one version, as the GitHub release body.

    release_notes.py <version> [CHANGELOG.md]

The section runs from its "## <version> (<date>)" heading to the next "## "
heading; the heading itself is left out (GitHub shows the release title).
A short footer points at the assets and the full changelog. Exits 1 when
the CHANGELOG has no section for the version, so a tag without release notes
is a red run, not a release that says "release notes pending".
"""
import re
import sys
from pathlib import Path


def section(text: str, version: str) -> str | None:
    lines = text.splitlines()
    head = re.compile(r"^##\s+v?" + re.escape(version) + r"(\s|$)")
    start = next((i for i, l in enumerate(lines) if head.match(l)), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    body = "\n".join(lines[start + 1:end]).strip()
    return body or None


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        return 2
    version = sys.argv[1].removeprefix("v")
    path = Path(sys.argv[2] if len(sys.argv) == 3 else Path(__file__).resolve().parent.parent / "CHANGELOG.md")
    body = section(path.read_text(encoding="utf-8"), version)
    if body is None:
        print(f"{path} has no section '## {version}'", file=sys.stderr)
        return 1
    print(body)
    print()
    print("---")
    print(f"Full changelog: [CHANGELOG.md](https://github.com/okohlbacher/FASTag/blob/v{version}/CHANGELOG.md). "
          "Every bundle carries LICENSE, THIRD-PARTY-NOTICES.txt and, for the desktop app, "
          "GUI-THIRD-PARTY-NOTICES.txt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
