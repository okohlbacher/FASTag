#!/usr/bin/env python3
"""Check a taxonomy directory against its MANIFEST.json.

    check_taxonomy_manifest.py <share-FASTag-taxonomy dir> [<manifest.json>]

Every file the manifest lists under "files" must be in the directory with the
sha256 (and size) the manifest records; the index must be there. With a
second argument, that manifest is first copied into the directory as
MANIFEST.json if the directory has none (the pinned index of 2026-09-01
predates the manifest; data/taxonomy/manifests/ holds the reconstructed one).
Exits 1 on any mismatch, so a bundle cannot ship an index with a manifest
that describes another one.
"""
import hashlib
import json
import shutil
import sys
from pathlib import Path


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        return 2
    d = Path(sys.argv[1])
    m = d / "MANIFEST.json"
    if not m.is_file() and len(sys.argv) == 3:
        shutil.copyfile(sys.argv[2], m)
        print(f"{m}: from {sys.argv[2]}", file=sys.stderr)
    if not m.is_file():
        print(f"{d}: no MANIFEST.json", file=sys.stderr)
        return 1
    files = json.loads(m.read_text(encoding="utf-8")).get("files", {})
    index = [n for n in files if n.endswith(".taxdb")]
    bad = []
    if not index:
        bad.append("the manifest lists no .taxdb index")
    for name, rec in sorted(files.items()):
        p = d / name
        if not p.is_file():
            bad.append(f"{name}: missing")
            continue
        if rec.get("bytes") is not None and p.stat().st_size != rec["bytes"]:
            bad.append(f"{name}: {p.stat().st_size} bytes, the manifest says {rec['bytes']}")
            continue
        got = sha256(p)
        if got != rec["sha256"]:
            bad.append(f"{name}: sha256 {got}, the manifest says {rec['sha256']}")
        else:
            print(f"{name}: sha256 {got} as in MANIFEST.json", file=sys.stderr)
    for b in bad:
        print(f"::error::taxonomy manifest: {b}", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
