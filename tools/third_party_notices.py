#!/usr/bin/env python3
"""Write THIRD-PARTY-NOTICES.txt for a binary bundle.

    third_party_notices.py <conda-prefix> <out-file> <lib-dir>...

Every shared library in the lib dirs (.so*, .dylib, .dll) is mapped to the
conda package that installed it (conda-meta/*.json "files"), and the notice
lists each package once -- name, version, licence -- followed by the licence
texts the package ships (its info/licenses).

The texts are looked for in the package's extracted directory, then in the
package caches (CONDA_PKGS_DIRS, the micromamba root, <prefix>/../../pkgs),
then in the package archive itself, downloaded from the URL its conda-meta
record names and checked against the record's sha256 (or md5). A CI job that
restores a cached environment has no package cache at all, which is how up to
1.15.0 every bundle shipped a notice listing licences without their texts.
FASTAG_NOTICES_OFFLINE=1 turns the download off. A package for which no text
is found makes the script fail (exit 1) without writing anything: a notice
without the licence text does not meet the licences that require it.
tools/licenses/conda/<package>.txt supplies a text for a package whose
archive carries none.

A library no package owns (libOpenMS itself, its CLI library) is listed as
such; OpenMS's own notices travel in share-OpenMS. Exits 1 as well if the
prefix has no conda-meta at all.
"""
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

SUFFIXES = (".so", ".dylib", ".dll")
OVERRIDES = Path(__file__).resolve().parent / "licenses" / "conda"
# The zstd program of the environment itself (conda-forge's zstd package),
# when none is on PATH; set in main().
ZSTD_HINTS: list[Path] = []


def is_lib(name: str) -> bool:
    return name.endswith(SUFFIXES) or ".so." in name


def texts_in_dir(lic_dir: Path) -> list[tuple[str, str]]:
    out = []
    if lic_dir.is_dir():
        for f in sorted(p for p in lic_dir.rglob("*") if p.is_file()):
            try:
                out.append((str(f.relative_to(lic_dir)), f.read_text(encoding="utf-8", errors="replace")))
            except OSError:
                pass
    return out


def zstd_decompress(data: bytes) -> bytes:
    try:  # Python 3.14
        from compression import zstd  # type: ignore
        return zstd.decompress(data)
    except ImportError:
        pass
    try:
        import zstandard  # type: ignore
        return zstandard.ZstdDecompressor().decompressobj().decompress(data)
    except ImportError:
        pass
    exe = shutil.which("zstd") or next((str(h) for h in ZSTD_HINTS if h.is_file()), None)
    if not exe:
        raise RuntimeError("no zstd decompressor (Python 3.14, the zstandard module or the zstd program)")
    return subprocess.run([exe, "-dc"], input=data, capture_output=True, check=True).stdout


def texts_in_archive(path: Path) -> list[tuple[str, str]]:
    """info/licenses/* of a .conda or .tar.bz2 package archive."""
    out = []

    def from_tar(tf: tarfile.TarFile) -> None:
        for m in tf.getmembers():
            if m.isfile() and m.name.startswith("info/licenses/"):
                f = tf.extractfile(m)
                if f is not None:
                    out.append((m.name[len("info/licenses/"):], f.read().decode("utf-8", errors="replace")))

    if path.name.endswith(".conda"):
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if n.startswith("info-") and n.endswith(".tar.zst"):
                    with tarfile.open(fileobj=io.BytesIO(zstd_decompress(z.read(n)))) as tf:
                        from_tar(tf)
    else:
        with tarfile.open(path) as tf:
            from_tar(tf)
    return sorted(out)


def pkg_dirs(prefix: Path) -> list[Path]:
    dirs = [Path(d) for d in os.environ.get("CONDA_PKGS_DIRS", "").split(os.pathsep) if d]
    for var in ("MAMBA_ROOT_PREFIX", "CONDA_ROOT"):
        if os.environ.get(var):
            dirs.append(Path(os.environ[var]) / "pkgs")
    dirs += [prefix.parent.parent / "pkgs", prefix / "pkgs", Path.home() / "micromamba" / "pkgs",
             Path.home() / ".conda" / "pkgs"]
    return [d for d in dict.fromkeys(dirs) if d.is_dir()]


def download(rec: dict, dest: Path) -> Path | None:
    url, fn = rec.get("url"), rec.get("fn")
    if not url or not fn or os.environ.get("FASTAG_NOTICES_OFFLINE") == "1":
        return None
    path = dest / fn
    if not path.is_file():
        req = urllib.request.Request(url, headers={"User-Agent": "fastag-notices"})
        data = b""
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                break
            except OSError:
                if attempt == 2:
                    raise
        if rec.get("sha256"):
            ok = hashlib.sha256(data).hexdigest() == rec["sha256"]
        elif rec.get("md5"):
            ok = hashlib.md5(data).hexdigest() == rec["md5"]
        else:
            ok = False
        if not ok:
            raise RuntimeError(f"{fn}: downloaded archive does not match its conda-meta checksum")
        path.write_bytes(data)
    return path


def licence_texts(rec: dict, prefix: Path, cache: Path, log: list[str]) -> list[tuple[str, str]]:
    pkg_dir = rec.get("extracted_package_dir") or ""
    if pkg_dir:
        t = texts_in_dir(Path(pkg_dir) / "info" / "licenses")
        if t:
            return t
    fn = rec.get("fn") or ""
    stem = fn[:-len(".conda")] if fn.endswith(".conda") else fn[:-len(".tar.bz2")] if fn.endswith(".tar.bz2") else fn
    for d in pkg_dirs(prefix):
        t = texts_in_dir(d / stem / "info" / "licenses") if stem else []
        if t:
            return t
        if fn and (d / fn).is_file():
            try:
                t = texts_in_archive(d / fn)
            except Exception as e:
                log.append(f"{rec['name']}: {d / fn}: {e}")
                t = []
            if t:
                return t
    # Licence files the package installs into the prefix (share/licenses/...).
    t = []
    for f in rec.get("files", []):
        low = f.lower()
        if "/licenses/" in low or "/licences/" in low or os.path.basename(low).startswith(("license", "copying")):
            p = prefix / f
            if p.is_file():
                t.append((f, p.read_text(encoding="utf-8", errors="replace")))
    if t:
        return t
    try:
        arch = download(rec, cache)
        if arch is not None:
            t = texts_in_archive(arch)
            if t:
                log.append(f"{rec['name']}: texts from the downloaded {arch.name}")
                return t
    except Exception as e:  # network, checksum, decompression
        log.append(f"{rec['name']}: {e}")
    over = OVERRIDES / f"{rec['name']}.txt"
    if over.is_file():
        return [(f"tools/licenses/conda/{over.name}", over.read_text(encoding="utf-8"))]
    return []


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__, file=sys.stderr)
        return 2
    prefix, out, lib_dirs = Path(sys.argv[1]), Path(sys.argv[2]), [Path(d) for d in sys.argv[3:]]
    meta = prefix / "conda-meta"
    ZSTD_HINTS.extend([prefix / "bin" / "zstd", prefix / "Library" / "bin" / "zstd.exe"])
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

    missing, log = [], []
    with tempfile.TemporaryDirectory(prefix="fastag-notices-") as tmp:
        for name in sorted(used):
            rec = used[name]
            texts = licence_texts(rec, prefix, Path(tmp), log)
            # An override supplements what the package ships (the GCC runtime
            # installs only its exception, not the GPL it is an exception to).
            over = OVERRIDES / f"{name}.txt"
            if over.is_file() and not any(r.startswith("tools/licenses/") for r, _ in texts):
                texts.append((f"tools/licenses/conda/{over.name}", over.read_text(encoding="utf-8")))
            if not texts:
                missing.append(f"{name} {rec.get('version', '')} ({rec.get('license', 'unknown')})")
                continue
            lines += ["", "=" * 78, f"{name} {rec.get('version', '')} -- {rec.get('license', 'unknown')}", "=" * 78]
            for rel, text in texts:
                lines += [f"--- {rel} ---", text.rstrip()]

    for entry in log:
        print(f"  {entry}", file=sys.stderr)
    if missing:
        print(f"no licence text found for {len(missing)} package(s); {out} not written:", file=sys.stderr)
        for m in missing:
            print(f"  {m}", file=sys.stderr)
        print(f"  (add the text as {OVERRIDES}/<package>.txt if the package archive has none)", file=sys.stderr)
        return 1
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{out}: {len(used)} packages, {len(libs) - len(unowned)} of {len(libs)} libraries owned, "
          f"every package with its licence text", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
