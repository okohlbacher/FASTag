#!/usr/bin/env python3
"""Write THIRD-PARTY-NOTICES.txt for a binary bundle.

    third_party_notices.py <conda-prefix> <out-file> <lib-dir>...

Every shared library in the lib dirs (.so*, .dylib, .dll) is mapped to the
conda package that installed it (conda-meta/*.json "files"), and the notice
lists each package once -- name, version, licence -- followed by the licence
texts the package ships (info/licenses in its extracted package directory).
A library no package owns (libOpenMS itself, its CLI library) is listed as
such; OpenMS's own notices travel in share-OpenMS. Exits non-zero only if the
prefix has no conda-meta at all, so a bundle step cannot silently ship
without notices.
"""
import json
import os
import sys
from pathlib import Path

SUFFIXES = (".so", ".dylib", ".dll")


def is_lib(name: str) -> bool:
    return name.endswith(SUFFIXES) or ".so." in name


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__, file=sys.stderr)
        return 2
    prefix, out, lib_dirs = Path(sys.argv[1]), Path(sys.argv[2]), [Path(d) for d in sys.argv[3:]]
    meta = prefix / "conda-meta"
    if not meta.is_dir():
        print(f"no conda-meta under {prefix}", file=sys.stderr)
        return 1

    # basename -> package record (first owner wins; conda forbids clobbering)
    owner: dict[str, dict] = {}
    for js in sorted(meta.glob("*.json")):
        try:
            rec = json.loads(js.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for f in rec.get("files", []):
            base = os.path.basename(f)
            if is_lib(base):
                owner.setdefault(base, rec)

    libs = sorted({p.name for d in lib_dirs if d.is_dir() for p in d.iterdir() if is_lib(p.name)})
    used: dict[str, dict] = {}
    libs_of: dict[str, list[str]] = {}
    unowned: list[str] = []
    for lib in libs:
        rec = owner.get(lib)
        if rec is None:
            unowned.append(lib)
            continue
        used[rec["name"]] = rec
        libs_of.setdefault(rec["name"], []).append(lib)

    lines = [
        "FASTag binary bundle: third-party notices",
        "",
        "FASTag itself is MIT-licensed (LICENSE). This bundle redistributes the",
        "shared libraries below, unmodified, from the conda-forge packages named.",
        "OpenMS's own licence and notices are in share-OpenMS/.",
        "",
        f"{'package':40} {'version':16} licence",
    ]
    for name in sorted(used):
        rec = used[name]
        lines.append(f"{name:40} {rec.get('version', '?'):16} {rec.get('license', 'unknown')}")
    if unowned:
        lines += ["", "Libraries not installed by a conda package (built with FASTag/OpenMS):"]
        lines += [f"  {lib}" for lib in unowned]
    lines += ["", "Libraries by package:"]
    for name in sorted(used):
        lines.append(f"  {name}: {', '.join(libs_of[name])}")

    for name in sorted(used):
        rec = used[name]
        pkg_dir = rec.get("extracted_package_dir") or ""
        lic_dir = Path(pkg_dir) / "info" / "licenses" if pkg_dir else None
        texts = []
        if lic_dir and lic_dir.is_dir():
            for f in sorted(p for p in lic_dir.rglob("*") if p.is_file()):
                try:
                    texts.append((f.relative_to(lic_dir), f.read_text(encoding="utf-8", errors="replace")))
                except OSError:
                    pass
        lines += ["", "=" * 78, f"{name} {rec.get('version', '')} -- {rec.get('license', 'unknown')}", "=" * 78]
        if not texts:
            lines.append(f"(licence text not found in the package cache; licence: {rec.get('license', 'unknown')})")
        for rel, text in texts:
            lines += [f"--- {rel} ---", text.rstrip()]

    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{out}: {len(used)} packages, {len(libs) - len(unowned)} of {len(libs)} libraries owned",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
