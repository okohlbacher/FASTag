#!/usr/bin/env python3
"""Check a taxonomy directory against its MANIFEST.json.

    check_taxonomy_manifest.py <share-FASTag-taxonomy dir> [<manifest.json>]
    check_taxonomy_manifest.py --pinned <manifest.json> <taxonomy dir>

Every file the manifest lists under "files" must be in the directory with the
sha256 (and size) the manifest records; the index must be there. With a
second argument, that manifest is first copied into the directory as
MANIFEST.json if the directory has none (the pinned index of 2026-09-01
predates the manifest; data/taxonomy/manifests/ holds the reconstructed one).
Exits 1 on any mismatch, so a bundle cannot ship an index with a manifest
that describes another one.

--pinned checks a final payload (a mounted disk image, an unpacked package,
an installed app) against the pinned manifest itself, writing nothing: each
file the manifest lists must be a regular file there (no symlink) with the
manifest's size and sha256, whatever MANIFEST.json the folder carries.

The index may be there in its packed form instead (tax_k7.ftz for
tax_k7.taxdb, what the installers ship; `buildtaxdb --pack`). Its header
records the size and sha256 of the .taxdb it decodes to, and those must be
the pinned ones; its sections must add up to its length (a truncated copy
fails). That the content decodes to that .taxdb is checked where it is
packed (`buildtaxdb --pack` decodes and compares, `buildtaxdb --verify`
hashes the decoded image); every load checks each section's zstd checksum.
"""
import hashlib
import json
import shutil
import struct
import sys
from pathlib import Path

FTZ_HEADER = 160


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def packed_claim(p: Path):
    """(image bytes, image sha256) a packed index (FTZ1) records, or a reason it is no valid one."""
    with open(p, "rb") as f:
        h = f.read(FTZ_HEADER)
    if len(h) < FTZ_HEADER or h[:4] != b"FTZ1" or struct.unpack_from("<I", h, 4)[0] != 1:
        return None, "not a packed taxonomy index (FTZ1 v1)"
    if struct.unpack_from("<I", h, 88)[0] != 4:
        return None, "packed index header is malformed"
    comp = sum(struct.unpack_from("<Q", h, 96 + 16 * i)[0] for i in range(4))
    if FTZ_HEADER + comp != p.stat().st_size:
        return None, f"{p.stat().st_size} bytes, its sections add up to {FTZ_HEADER + comp} (truncated?)"
    return (struct.unpack_from("<Q", h, 40)[0], h[56:88].hex()), None


def check(d: Path, files: dict) -> list:
    """The mismatches of @p d against @p files (the manifest's "files")."""
    index = [n for n in files if n.endswith(".taxdb")]
    bad = []
    if not index:
        bad.append("the manifest lists no .taxdb index")
    for name, rec in sorted(files.items()):
        p = d / name
        z = d / (name[: -len(".taxdb")] + ".ftz") if name.endswith(".taxdb") else None
        if z is not None and not p.exists() and not z.is_symlink() and z.is_file():
            claim, why = packed_claim(z)
            if claim is None:
                bad.append(f"{z.name}: {why}")
            elif rec.get("bytes") is not None and claim[0] != rec["bytes"]:
                bad.append(f"{z.name}: packs a {claim[0]}-byte {name}, the manifest says {rec['bytes']}")
            elif claim[1] != rec["sha256"]:
                bad.append(f"{z.name}: packs {name} sha256 {claim[1]}, the manifest says {rec['sha256']}")
            else:
                print(f"{z.name}: packs {name} sha256 {claim[1]} as pinned ({z.stat().st_size} bytes, sha256 {sha256(z)})",
                      file=sys.stderr)
            continue
        if p.is_symlink() or not p.is_file():
            bad.append(f"{name}: missing or not a regular file in {d}")
            continue
        if rec.get("bytes") is not None and p.stat().st_size != rec["bytes"]:
            bad.append(f"{name}: {p.stat().st_size} bytes, the manifest says {rec['bytes']}")
            continue
        got = sha256(p)
        if got != rec["sha256"]:
            bad.append(f"{name}: sha256 {got}, the manifest says {rec['sha256']}")
        else:
            print(f"{name}: sha256 {got} as pinned", file=sys.stderr)
    return bad


def main() -> int:
    if len(sys.argv) == 4 and sys.argv[1] == "--pinned":
        files = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")).get("files", {})
        bad = check(Path(sys.argv[3]), files)
        for b in bad:
            print(f"::error::taxonomy index in {sys.argv[3]}: {b}", file=sys.stderr)
        return 1 if bad else 0
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
    bad = check(d, files)
    for b in bad:
        print(f"::error::taxonomy manifest: {b}", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
