#!/usr/bin/env python3
"""Fetch the pinned taxonomy k-mer index once, for local builds and the dev app.

Release builds embed tax_k7.taxdb (about 1.1 GB) from the release asset
FASTag-taxonomy-k7.tar.gz of the data release the newest manifest in
data/taxonomy/manifests names (CI: TAXDB_TAG, TAXDB_SHA256). A source build
does not: this script puts that asset, checked, where every build tree of the
machine finds it with no variable to set (CMakeLists.txt
FASTAG_TAXONOMY_INDEX_AUTO, the debug desktop app's data.rs):

    <cache>/<data release>/share-FASTag-taxonomy/
        tax_k7.taxdb nodes.dmp names.dmp MANIFEST.json   (the asset, sha256-checked)
        species_call.tsv                                 (copied from these sources)

<cache> is %LOCALAPPDATA%\\fastag on Windows, else $XDG_CACHE_HOME/fastag, else
~/.cache/fastag (CMake: FASTAG_TAXONOMY_CACHE_DIR). Then run cmake --build:
share-FASTag-taxonomy beside the built FASTag links the index.

    fetch_taxonomy_index.py                       download and check (~450 MB)
    fetch_taxonomy_index.py --from <tarball>      the asset already downloaded
    fetch_taxonomy_index.py --from <folder|file>  an unpacked copy (a release's
                                                  share-FASTag-taxonomy, or the
                                                  tax_k7.taxdb itself): linked,
                                                  or copied with --copy
    fetch_taxonomy_index.py --print-dir           the folder, and nothing else

Options: --dest <folder> (instead of <cache>/<data release>), --release <tag>
(another manifest of data/taxonomy/manifests), --manifest <file>, --src <repo>,
--keep-archive. Every file is checked against the manifest's sha256 before it
is used: the tarball's when one is downloaded or given, and each file of the
index folder (tax_k7.taxdb, nodes.dmp, names.dmp). A file that does not match
is refused, never staged. Exit 0 when the folder holds the checked index,
1 on any error.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

REPO = "okohlbacher/FASTag"
FOLDER = "share-FASTag-taxonomy"


def fastag_cache_dir():
    """The cache root, as CMakeLists.txt computes FASTAG_TAXONOMY_CACHE_DIR."""
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "fastag"
    if os.environ.get("XDG_CACHE_HOME"):
        return Path(os.environ["XDG_CACHE_HOME"]) / "fastag"
    return Path.home() / ".cache" / "fastag"


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def newest_manifest(src, release):
    d = Path(src) / "data" / "taxonomy" / "manifests"
    names = sorted(d.glob("*.json"), reverse=True)
    if release:
        names = [p for p in names if p.stem == release]
    if not names:
        raise SystemExit("no manifest%s in %s" % (" for " + release if release else "", d))
    return names[0]


def matches(p, want):
    return p.is_file() and p.stat().st_size == want.get("bytes", p.stat().st_size) and sha256(p) == want["sha256"]


def safe_extract(tarball, dest):
    """The asset's share-FASTag-taxonomy/ regular files only, nowhere else."""
    with tarfile.open(tarball, "r:*") as t:
        for m in t.getmembers():
            parts = Path(m.name).parts
            if m.isdir():
                continue
            if not m.isfile() or not parts or parts[0] != FOLDER or ".." in parts or Path(m.name).is_absolute() \
                    or len(parts) != 2:
                raise SystemExit("%s: unexpected member %r; not extracted" % (tarball, m.name))
            out = dest / FOLDER / parts[1]
            out.parent.mkdir(parents=True, exist_ok=True)
            part = out.with_name(out.name + ".part")
            with t.extractfile(m) as fin, open(part, "wb") as fout:
                shutil.copyfileobj(fin, fout, 1 << 20)
            os.replace(part, out)


def download(url, to, want):
    part = to.with_name(to.name + ".part")
    h = hashlib.sha256()
    print("downloading %s" % url, file=sys.stderr)
    with urllib.request.urlopen(url) as r, open(part, "wb") as f:  # noqa: S310 (a fixed https URL)
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            h.update(chunk)
            done += len(chunk)
            if total:
                print("\r  %d of %d MB" % (done >> 20, total >> 20), end="", file=sys.stderr)
    print("", file=sys.stderr)
    if h.hexdigest() != want:
        part.unlink()
        raise SystemExit("%s: sha256 %s, the manifest pins %s; not used" % (url, h.hexdigest(), want))
    os.replace(part, to)


def put(src, dst, copy):
    if dst.is_symlink() or dst.exists():
        dst.unlink()
    if copy:
        shutil.copyfile(src, dst)
    else:
        os.symlink(os.path.abspath(src), dst)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--release", default="")
    ap.add_argument("--manifest", default="")
    ap.add_argument("--dest", default="")
    ap.add_argument("--from", dest="source", default="")
    ap.add_argument("--copy", action="store_true")
    ap.add_argument("--keep-archive", action="store_true")
    ap.add_argument("--print-dir", action="store_true")
    ap.add_argument("--repo", default=REPO)
    a = ap.parse_args(argv)

    mpath = Path(a.manifest) if a.manifest else newest_manifest(a.src, a.release)
    man = json.loads(mpath.read_text(encoding="utf-8"))
    release = man["data_release"]
    tarball = man["tarball"]
    files = man["files"]
    if "tax_k7.taxdb" not in files:
        raise SystemExit("%s lists no tax_k7.taxdb" % mpath)
    dest = Path(a.dest) if a.dest else fastag_cache_dir() / release
    folder = dest / FOLDER
    if a.print_dir:
        print(folder)
        return 0

    def complete():
        return all(matches(folder / n, w) for n, w in files.items())

    folder.mkdir(parents=True, exist_ok=True)
    if complete():
        print("%s: the index of %s is there and checked" % (folder, release), file=sys.stderr)
    elif a.source and (Path(a.source).is_dir() or (Path(a.source).is_file() and not tarfile.is_tarfile(a.source))):
        # An unpacked copy: each file from it when it matches, else (the
        # dumps) from data/taxonomy of these sources when that matches.
        s = Path(a.source)
        for n, w in files.items():
            cands = [s / n] if s.is_dir() else ([s] if n == "tax_k7.taxdb" else [])
            cands.append(Path(a.src) / "data" / "taxonomy" / n)
            hit = next((c for c in cands if matches(c, w)), None)
            if hit is None:
                raise SystemExit("%s: no %s with the sha256 %s pins (%s) in %s or data/taxonomy; refused"
                                 % (a.source, n, mpath.name, w["sha256"][:12], s))
            put(hit, folder / n, a.copy)
            print("%s: %s from %s" % (folder, n, hit), file=sys.stderr)
    else:
        arc = Path(a.source) if a.source else dest / tarball["name"]
        if not a.source:
            url = "https://github.com/%s/releases/download/%s/%s" % (a.repo, release, tarball["name"])
            download(url, arc, tarball["sha256"])
        elif sha256(arc) != tarball["sha256"]:
            raise SystemExit("%s: sha256 %s, %s pins %s; refused" % (arc, sha256(arc), mpath.name, tarball["sha256"]))
        safe_extract(arc, dest)
        if not a.source and not a.keep_archive:
            arc.unlink()
        for n, w in files.items():
            if not matches(folder / n, w):
                raise SystemExit("%s: %s does not match %s" % (folder, n, mpath.name))
    if not (folder / "MANIFEST.json").is_file():
        shutil.copyfile(mpath, folder / "MANIFEST.json")
    # The asset predates -species_call: its frozen parameters from these
    # sources (as the release workflows put them back), refreshed every run.
    sc = Path(a.src) / "data" / "taxonomy" / "species_call.tsv"
    if sc.is_file():
        shutil.copyfile(sc, folder / "species_call.tsv")
    print(folder)
    print("Build trees find it on their next cmake --build (FASTAG_TAXONOMY_INDEX_AUTO); "
          "or configure with -DFASTAG_TAXONOMY_INDEX_DIR=%s" % folder, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
