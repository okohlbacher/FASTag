#!/usr/bin/env python3
"""Copy the held-out test records from the acceptance branches into acceptance/archive/.

    archive_acceptance.py [--repo <clone>] [--out <acceptance/archive>]

Reads the branches below (local branches of the clone, in this order) with git,
without checking them out, and copies every file under acceptance/ that is a
record of a test:

  PREREG-*  FREEZE*  RESULT*.md  RESULTS.md  verdict.{txt,json,tsv,md,log}
  acceptance/1.13/disjointness/item12-realchimera-reuse.tsv
  acceptance/1.13/item23/** (the registered digest-quality evaluation the docs cite)

A file is stored as <out>/<branch>/<path without the leading acceptance/>; a
file with the same path and content on a later branch is stored once, under the
first. <out>/MANIFEST.tsv lists every selected file on every branch with the
branch head, the git blob id and where it is stored. Existing branch folders
under <out> are replaced.
"""
import argparse
import re
import shutil
import subprocess
from pathlib import Path

BRANCHES = [
    "acceptance/1.12", "acceptance/1.13",
    "acc113r/acqcheck", "acc113r/alknodb", "acc113r/census", "acc113r/compltol", "acc113r/hdrcharge",
    "acc113r/hybrid", "acc113r/labeldisc3", "acc113r/msfragger", "acc113r/nontryptic", "acc113r/shifts",
    "acc113r/species",
    "post1131/msfragger-heldout2", "post1131/labeldisc-heldout4", "post1131/labeldisc-heldout5",
    "acc114/acqcheck3", "acc114/aspn", "acc114/compltol3", "acc114/exactonly",
    "acc115/acqcheck4", "acc115/msfcalib",
]
NAME = re.compile(r"^(PREREG-.*|FREEZE.*|RESULT.*\.md|RESULTS\.md|verdict\.(txt|json|tsv|md|log))$")
PATHS = {"acceptance/1.13/disjointness/item12-realchimera-reuse.tsv"}
TREES = ("acceptance/1.13/item23/",)


def selected(path: str) -> bool:
    return (NAME.match(path.rsplit("/", 1)[-1]) is not None or path in PATHS
            or any(path.startswith(t) for t in TREES))


def git(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".")
    ap.add_argument("--out", default="acceptance/archive")
    a = ap.parse_args()
    repo, out = Path(a.repo), Path(a.out)
    for top in {b.split("/")[0] for b in BRANCHES}:
        shutil.rmtree(out / top, ignore_errors=True)
    stored: dict[tuple[str, str], str] = {}
    rows = []
    for b in BRANCHES:
        head = git(repo, "rev-parse", f"refs/heads/{b}").decode().strip()
        for line in git(repo, "ls-tree", "-r", "-z", head, "--", "acceptance/").split(b"\0"):
            if not line:
                continue
            meta, path = line.decode().split("\t", 1)
            mode, kind, blob = meta.split()
            if kind != "blob" or mode == "120000" or not selected(path):
                continue
            key = (path, blob)
            if key not in stored:
                rel = f"{b}/{path.removeprefix('acceptance/')}"
                dest = out / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(git(repo, "cat-file", "blob", blob))
                stored[key] = rel
            rows.append((b, head, path, blob, stored[key]))
    with open(out / "MANIFEST.tsv", "w", encoding="utf-8") as f:
        f.write("branch\tbranch_head\tpath\tblob\tarchived_as\n")
        for r in rows:
            f.write("\t".join(r) + "\n")
    print(f"{len(rows)} rows, {len(stored)} files stored under {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
