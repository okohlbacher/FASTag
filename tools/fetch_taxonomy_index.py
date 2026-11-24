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

The folder is assembled in a private temporary folder beside it (each
expected regular file of the tarball taken once, nothing else), checked
whole, and only then put in place with a rename. Its last file is the
completion marker .fastag-fetched, which names the pinned manifest (its
data release and sha256) and the size and sha256 of each checked file. A
folder without a marker that matches the manifest of these sources is no
fetched index: CMake (cmake/stage-data.cmake), the debug desktop app
(gui/src-tauri/src/data.rs) and gui/scripts/bundle-macos.sh all require it,
so an interrupted or failed fetch is never staged.

    fetch_taxonomy_index.py --check <folder>      exit 0 when <folder> holds a
                                                  complete fetch of the manifest

A linked file (--from <folder|file> without --copy) is the file it links to,
which can change after the fetch: every reader (this script's --check, CMake,
the debug desktop app) hashes a linked file again before it uses it, and a
source whose file resolves into the folder being replaced is copied, not
linked (the link would dangle, or point at itself, once the folder is
replaced). The folder replaced must be one this script could have written:
a real folder holding anything but the fetch's own files is the user's and
is refused, never deleted. If the new folder cannot be put in place, or is
not a complete fetch once there, the old one is put back.
"""
import argparse
import hashlib
import json
import os
import shutil
import stat
import sys
import tarfile
import tempfile
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


MARKER = ".fastag-fetched"


def file_sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def marker_text(mpath, release, files, folder):
    """The completion marker: the pinned manifest and every checked file."""
    lines = ["# Written by tools/fetch_taxonomy_index.py after every file below was checked;",
             "# a folder without it (or with another manifest) is no fetched index.",
             "manifest %s %s" % (release, sha256(mpath))]
    for n in sorted(files):
        p = folder / n
        lines.append("file %s %d %s" % (n, p.stat().st_size, files[n]["sha256"]))
    return "\n".join(lines) + "\n"


def read_marker(folder):
    """(release, manifest sha256, {name: (bytes, sha256)}) of @p folder's marker, or None."""
    m = folder / MARKER
    if m.is_symlink() or not m.is_file():
        return None
    release = msha = None
    files = {}
    for line in m.read_text(encoding="utf-8").splitlines():
        f = line.split()
        if len(f) == 3 and f[0] == "manifest":
            release, msha = f[1], f[2]
        elif len(f) == 4 and f[0] == "file" and f[2].isdigit():
            files[f[1]] = (int(f[2]), f[3])
    if not release or not msha:
        return None
    return release, msha, files


def fetched_complete(folder, mpath):
    """@p folder holds a complete fetch of the manifest @p mpath: its marker
    names that very manifest (sha256), lists each of the manifest's files with
    its pinned sha256, and each is a regular file of that size. The sha256 of
    a copied file is checked by the fetch, before the marker is written; a
    linked file (a symlink to the --from source) is hashed again here, since
    its target can change after the fetch at the same size (codex6 review n3)."""
    folder, mpath = Path(folder), Path(mpath)
    mk = read_marker(folder)
    if mk is None:
        return False
    man = json.loads(mpath.read_text(encoding="utf-8"))
    release, msha, listed = mk
    if release != man["data_release"] or msha != sha256(mpath):
        return False
    for n, w in man["files"].items():
        if n not in listed or listed[n][1] != w["sha256"]:
            return False
        if w.get("bytes") is not None and listed[n][0] != w["bytes"]:
            return False
        p = folder / n
        if not p.is_file() or p.stat().st_size != listed[n][0]:
            return False
        if p.is_symlink() and sha256(p) != w["sha256"]:
            return False
    return True


# The entries a fetched folder holds: what a fetch writes there, and the
# temporary marker of a marker update.
def own_entry(name, files):
    return name in files or name in ("MANIFEST.json", "species_call.tsv", MARKER) or name.startswith(".marker-")


def own_kind(path, name, files):
    """Whether the entry @p path (named @p name) is of the kind a fetch writes
    there (codex7 review n3), by lstat, never through a link: a regular file,
    or, for a pinned name (@p files), also a link to a regular file (a fetch
    --from a folder links them; removing the folder removes only the link).
    A directory, or a link to anything else, under a fetch's own name is not
    a fetch's: replacing the folder would delete it recursively."""
    st = os.lstat(path)
    if stat.S_ISREG(st.st_mode):
        return True
    if name in files and stat.S_ISLNK(st.st_mode):
        try:
            return stat.S_ISREG(os.stat(path).st_mode)
        except OSError:  # a dangling link
            return False
    return False


def refuse_unowned(folder, files):
    """Refuses to replace @p folder unless it is a link (only the link goes),
    absent, or a real folder holding nothing but a fetch's own entries
    (own_entry), each of the kind a fetch writes (own_kind: a regular file,
    or a pinned file's link): anything else there is the user's and is never
    deleted. A directory named like a pinned file (tax_k7.taxdb/) is the
    user's too."""
    if folder.is_symlink() or not folder.exists():
        return
    if not folder.is_dir():
        raise SystemExit("%s is a file, not a fetched folder; refused (move it away)" % folder)
    extra = sorted(e.name for e in os.scandir(folder) if not own_entry(e.name, files))
    if extra:
        raise SystemExit("%s holds files that are not a fetch's (%s); refused, nothing deleted (move them away, "
                         "or give --dest another folder)" % (folder, ", ".join(extra[:5]) + (" ..." if len(extra) > 5 else "")))
    odd = sorted(e.name for e in os.scandir(folder) if not own_kind(os.path.join(folder, e.name), e.name, files))
    if odd:
        raise SystemExit("%s holds %s under a fetch's file name but not as a fetch writes it (a folder, or a link to "
                         "no regular file); refused, nothing deleted (move them away, or give --dest another folder)"
                         % (folder, ", ".join(odd[:5]) + (" ..." if len(odd) > 5 else "")))


def inside(path, folder):
    """Whether @p path resolves into @p folder (as it is, or resolved)."""
    t = os.path.realpath(path)
    for f in {os.path.realpath(folder), os.path.abspath(folder)}:
        try:
            if os.path.commonpath([t, f]) == f:
                return True
        except ValueError:  # another drive
            pass
    return False


def safe_extract(tarball, into, files):
    """The asset's share-FASTag-taxonomy/ regular files into @p into: each of
    @p files (the manifest's) exactly once, and MANIFEST.json at most once;
    any other member (a link, a device, a folder elsewhere, another name, a
    second copy) refuses the tarball. Written only to new files in @p into,
    a private folder nothing else writes to."""
    allowed = set(files) | {"MANIFEST.json"}
    seen = set()
    with tarfile.open(tarball, "r:*") as t:
        for m in t:
            parts = Path(m.name).parts
            if m.isdir() and parts == (FOLDER,):
                continue
            if not m.isfile() or len(parts) != 2 or parts[0] != FOLDER or parts[1] not in allowed \
                    or Path(m.name).is_absolute() or parts[1] in seen:
                raise SystemExit("%s: unexpected member %r; not extracted" % (tarball, m.name))
            seen.add(parts[1])
            out = into / parts[1]
            # O_EXCL: never through a file or link that is already there.
            fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o644)
            with t.extractfile(m) as fin, os.fdopen(fd, "wb") as fout:
                shutil.copyfileobj(fin, fout, 1 << 20)
    missing = sorted(set(files) - seen)
    if missing:
        raise SystemExit("%s: no %s in the tarball; not used" % (tarball, ", ".join(missing)))


def publish(tmp_folder, folder, files, verify=None):
    """Put the complete @p tmp_folder at @p folder: the old one (a folder of a
    fetch, or a link; refuse_unowned) is moved aside first and removed after,
    so @p folder is either the old, the new or absent, never a partial copy.
    When the rename fails, or @p verify (called on @p folder once the new
    one is there) is false, the new one is removed and the old one put back,
    and the publication fails."""
    refuse_unowned(folder, files)
    old = None
    if folder.is_symlink() or folder.exists():
        old = Path(tempfile.mkdtemp(prefix=".old-", dir=folder.parent))
        os.rename(folder, old / "x")
    placed = False
    try:
        os.rename(tmp_folder, folder)
        placed = True
        if verify is not None and not verify(folder):
            raise SystemExit("%s is not a complete fetch once in place; the earlier folder is put back" % folder)
    except BaseException:
        if placed:
            if folder.is_symlink():
                folder.unlink()
            else:
                shutil.rmtree(folder, ignore_errors=True)
        if old is not None:
            os.rename(old / "x", folder)
            shutil.rmtree(old, ignore_errors=True)
        raise
    if old is not None:
        x = old / "x"
        if x.is_symlink() or x.is_file():
            x.unlink()
        else:
            shutil.rmtree(x, ignore_errors=True)
        shutil.rmtree(old, ignore_errors=True)


def download(url, to, want):
    """@p url into @p to (a new file in a private folder), checked against @p want."""
    part = to.with_name(to.name + ".part")
    h = hashlib.sha256()
    print("downloading %s" % url, file=sys.stderr)
    fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o644)
    with urllib.request.urlopen(url) as r, os.fdopen(fd, "wb") as f:  # noqa: S310 (a fixed https URL)
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
    """@p src as the new file @p dst of a private folder: a copy, or a link."""
    if copy:
        fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o644)
        with open(src, "rb") as fin, os.fdopen(fd, "wb") as fout:
            shutil.copyfileobj(fin, fout, 1 << 20)
    else:
        # To the file itself: a chain of links could end in the folder replaced.
        os.symlink(os.path.realpath(src), dst)


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
    ap.add_argument("--check", default="")
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

    if a.check:
        ok = fetched_complete(a.check, mpath)
        print("%s: %s" % (a.check, "a complete fetch of %s" % release if ok else "no complete fetch of %s" % release),
              file=sys.stderr)
        return 0 if ok else 1

    if not folder.is_symlink() and folder.is_dir() and all(matches(folder / n, w) for n, w in files.items()):
        # Every file is there and checked; a folder fetched before the marker
        # existed gets it now (written to a new file, then renamed over).
        if not fetched_complete(folder, mpath):
            fd, tmpm = tempfile.mkstemp(prefix=".marker-", dir=folder)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(marker_text(mpath, release, files, folder))
            os.replace(tmpm, folder / MARKER)
        print("%s: the index of %s is there and checked" % (folder, release), file=sys.stderr)
        print(folder)
        return 0
    dest.mkdir(parents=True, exist_ok=True)
    if dest.is_symlink() or not dest.is_dir():
        raise SystemExit("%s is not a folder; refused" % dest)
    # Before anything is fetched: a folder of the user's is never replaced.
    refuse_unowned(folder, files)
    # Everything is assembled in a private folder (mode 0700, a new name)
    # beside the destination, on the same file system, then renamed into place.
    work = Path(tempfile.mkdtemp(prefix=".fetch-", dir=dest))
    try:
        tmp_folder = work / FOLDER
        tmp_folder.mkdir()
        if a.source and (Path(a.source).is_dir() or (Path(a.source).is_file() and not tarfile.is_tarfile(a.source))):
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
                # A file that resolves into the folder being replaced (also
                # through a link in a source folder elsewhere) is copied: a
                # link to it would dangle, or point at itself, once the
                # folder is replaced (codex6 review n3).
                copy = a.copy or ((folder.is_symlink() or folder.exists()) and inside(hit, folder))
                put(hit, tmp_folder / n, copy)
                print("%s: %s %s %s" % (folder, n, "copied from" if copy else "linked to", hit), file=sys.stderr)
            if s.is_dir() and (s / "MANIFEST.json").is_file() and not (s / "MANIFEST.json").is_symlink():
                put(s / "MANIFEST.json", tmp_folder / "MANIFEST.json", True)
        else:
            if a.source:
                arc = Path(a.source)
                if sha256(arc) != tarball["sha256"]:
                    raise SystemExit("%s: sha256 %s, %s pins %s; refused" % (arc, sha256(arc), mpath.name, tarball["sha256"]))
            else:
                arc = work / tarball["name"]
                url = "https://github.com/%s/releases/download/%s/%s" % (a.repo, release, tarball["name"])
                download(url, arc, tarball["sha256"])
            safe_extract(arc, tmp_folder, files)
            if not a.source and a.keep_archive:
                kept = dest / tarball["name"]
                if kept.is_symlink() or kept.exists():
                    kept.unlink()
                os.replace(arc, kept)
        # The complete set, checked where it will be published from.
        for n, w in files.items():
            if not matches(tmp_folder / n, w):
                raise SystemExit("%s: %s does not match %s; not used" % (folder, n, mpath.name))
        if not (tmp_folder / "MANIFEST.json").is_file():
            put(mpath, tmp_folder / "MANIFEST.json", True)
        # The asset predates -species_call: its frozen parameters from these
        # sources (as the release workflows put them back).
        sc = Path(a.src) / "data" / "taxonomy" / "species_call.tsv"
        if sc.is_file():
            put(sc, tmp_folder / "species_call.tsv", True)
        # Last: the marker, written only once everything above is checked.
        (tmp_folder / MARKER).write_text(marker_text(mpath, release, files, tmp_folder), encoding="utf-8")
        publish(tmp_folder, folder, files, verify=lambda f: fetched_complete(f, mpath))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(folder)
    print("Build trees find it on their next cmake --build (FASTAG_TAXONOMY_INDEX_AUTO); "
          "or configure with -DFASTAG_TAXONOMY_INDEX_DIR=%s" % folder, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
