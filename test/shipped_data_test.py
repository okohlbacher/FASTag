#!/usr/bin/env python3
"""Every data file the CLI reads is in every layout FASTag ships or builds.

The files come from the sources (tools/shipped_data.py: each data-file literal
in src/ and each -alkylation_proteome name). Checked:
  (a) data/ in the sources holds them;
  (b) cmake --install puts them in <prefix>/share/FASTag/<folder>;
  (c) the build tree has them beside the built FASTag (FASTAG_STAGE_DATA_IN_BUILD),
      the index too when FASTAG_TAXONOMY_INDEX_DIR is set;
  (d) the release workflows copy each folder into the CLI archives and the
      desktop app, and put back the taxonomy files the index asset lacks;
  (e) the Tauri bundle takes resources/fastag, and gui/scripts/bundle-macos.sh
      checks what it staged;
  (f) cmake/stage-data.cmake stages an index folder beside data/taxonomy,
      leaves a folder of the user's own (no .fastag-staged) alone in both
      modes, and cleans only what it staged;
  (g) every build restages data/ (a deleted share-FASTag-* comes back), and a
      restage tracks the source: changed bytes, deleted and added files;
  (h) the taxonomy index for local builds: stage-data.cmake takes INDEX as the
      index file itself and finds one through INDEX_SEARCH (the fetch cache,
      FASTAG_TAXONOMY_INDEX_AUTO); tools/fetch_taxonomy_index.py stages only
      files with the manifest's sha256 and pins what the release workflows pin;
      and the build tree's index, when one is configured or fetched, is that
      very file (gated: nothing to compare without one).

usage: shipped_data_test.py <src> <FASTag bin dir> <ON|OFF staged> <cmake> <build dir> [<index dir>
       [<index search> [<index manifests> [default|custom]]]]
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

SRC, BIN, STAGED, CMAKE, BUILD = sys.argv[1:6]
# The cmake that runs stage-data.cmake as a script (-P) in (f)-(h): the build's
# by default; FASTAG_SCRIPT_CMAKE names another, e.g. the oldest supported (3.28).
SCRIPT_CMAKE = os.environ.get("FASTAG_SCRIPT_CMAKE") or CMAKE
INDEX_DIR = sys.argv[6] if len(sys.argv) > 6 else ""
# FASTAG_TAXONOMY_INDEX_SEARCH: the fetch-cache folders a build looks in, "|"-separated.
INDEX_SEARCH = [c for c in (sys.argv[7] if len(sys.argv) > 7 else "").split("|") if c]
# FASTAG_TAXONOMY_INDEX_MANIFESTS: the manifest each of those folders must be a complete fetch of.
INDEX_MANIFESTS = [c for c in (sys.argv[8] if len(sys.argv) > 8 else "").split("|") if c]
# Whether FASTAG_TAXONOMY_CACHE_DIR is the default the fetch script fills.
CACHE_DEFAULT = (sys.argv[9] if len(sys.argv) > 9 else "default") == "default"
sys.path.insert(0, os.path.join(SRC, "tools"))
import fetch_taxonomy_index as fti  # noqa: E402
# The index the build tree stages: the configured one, else the first complete fetch.
INDEX_USED = INDEX_DIR or next((c for c, m in zip(INDEX_SEARCH, INDEX_MANIFESTS) if fti.fetched_complete(c, m)), "")
# The configuration of a multi-config build tree, for (g)'s cmake --build.
CONFIG = os.environ.get("FASTAG_BUILD_CONFIG", "")
sys.path.insert(0, os.path.join(SRC, "tools"))
import shipped_data as sd  # noqa: E402

failures = []


def fail(msg):
    failures.append(msg)
    print("FAIL: " + msg, file=sys.stderr)


def check(what, layout, root, index=False):
    for m in sd.missing(SRC, layout, root, index):
        fail("%s: %s" % (what, m))


def read(rel):
    with open(os.path.join(SRC, rel), encoding="utf-8") as f:
        return f.read()


FOLDERS = ("digest", "alkylation", "taxonomy")
files, problems = sd.required(SRC)
for p in problems:
    fail("list: " + p)
# The test is only as good as the list: the files every run of the tasks
# reads must be on it.
for must in ("digest/digest_models.tsv", "digest/massgap_mods.tsv", "alkylation/proteomes.tsv",
             "alkylation/human.fasta.gz", "taxonomy/nodes.dmp", "taxonomy/species_call.tsv", sd.INDEX):
    if must not in files:
        fail("list: %s is not among the files the CLI reads" % must)

# (a) the sources
check("(a) data/", "data", os.path.join(SRC, "data"))

# (b) cmake --install
tmp = tempfile.mkdtemp(prefix="fastag-shipped-")
try:
    r = subprocess.run([CMAKE, "--install", BUILD, "--prefix", os.path.join(tmp, "prefix")],
                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        fail("(b) cmake --install failed:\n" + r.stdout[-2000:])
    else:
        check("(b) cmake --install", "install", os.path.join(tmp, "prefix"))

    # (c) the build tree
    if STAGED == "ON":
        check("(c) build tree (FASTAG_STAGE_DATA_IN_BUILD)", "flat", BIN, index=bool(INDEX_USED))
        staged = os.path.join(BIN, "share-FASTag-taxonomy", "tax_k7.taxdb")
        if INDEX_USED:
            want = INDEX_USED if os.path.isfile(INDEX_USED) else os.path.join(INDEX_USED, "tax_k7.taxdb")
            same = os.path.isfile(staged) and (os.path.samefile(staged, want)
                                               or os.path.getsize(staged) == os.path.getsize(want))
            if not same:
                fail("(c) build tree: share-FASTag-taxonomy/tax_k7.taxdb is not the index %s" % want)
            else:
                print("note: (c) the build tree stages the index %s" % want, file=sys.stderr)
        elif os.path.exists(staged):
            fail("(c) build tree: a tax_k7.taxdb is staged though no index is configured or fetched")
        else:
            print("note: no taxonomy index configured or fetched; (c) checks the dumps only", file=sys.stderr)
    else:
        print("note: FASTAG_STAGE_DATA_IN_BUILD is off; (c) skipped", file=sys.stderr)

    # (f) stage-data.cmake with an index folder, and a folder of the user's own
    stage = os.path.join(SRC, "cmake", "stage-data.cmake")
    TAX = os.path.join(SRC, "data", "taxonomy")

    def run_stage(src, dst, copy, index=None):
        cmd = [SCRIPT_CMAKE, "-DSRC=" + src, "-DDST=" + dst, "-DCOPY=" + copy]
        if index:
            cmd.append("-DINDEX=" + index)
        return subprocess.run(cmd + ["-P", stage], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, text=True)

    def text(p):
        with open(p, encoding="utf-8") as fh:
            return fh.read()

    def write(p, t):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(t)

    # Symlink staging (COPY=OFF) needs the privilege to make symlinks, which a
    # Windows account has only as admin or with Developer Mode; copy staging
    # (the Windows build's) always runs, and first.
    def can_symlink():
        a = os.path.join(tmp, "probe-target")
        write(a, "probe")
        try:
            os.symlink(a, os.path.join(tmp, "probe-link"))
            return True
        except (OSError, NotImplementedError, AttributeError):
            return False

    SYMLINK = can_symlink()
    modes = ["ON"] + (["OFF"] if SYMLINK else [])
    if not SYMLINK:
        print("note: no symlink privilege; COPY=OFF (symlink staging) skipped", file=sys.stderr)
    idx = os.path.join(tmp, "index")
    os.makedirs(idx)
    for f in ("tax_k7.taxdb", "nodes.dmp", "names.dmp"):
        write(os.path.join(idx, f), "index " + f)
    for copy in modes:
        bindir = os.path.join(tmp, "bin-" + copy)
        os.makedirs(bindir)
        dst = os.path.join(bindir, "share-FASTag-taxonomy")
        r = run_stage(TAX, dst, copy, idx)
        if r.returncode != 0:
            fail("(f) stage-data.cmake with INDEX (COPY=%s) failed: %s" % (copy, r.stdout))
            continue
        for f in ("tax_k7.taxdb", "nodes.dmp", "names.dmp"):
            p = os.path.join(dst, f)
            if not os.path.isfile(p) or text(p) != "index " + f:
                fail("(f) COPY=%s: %s is not the index folder's %s" % (copy, p, f))
        if not os.path.isfile(os.path.join(dst, "species_call.tsv")):
            fail("(f) COPY=%s: no species_call.tsv beside the staged index" % copy)
        # Again without INDEX: the staged folder is ours and goes back to data/taxonomy.
        r = run_stage(TAX, dst, copy)
        if r.returncode != 0 or os.path.exists(os.path.join(dst, "tax_k7.taxdb")):
            fail("(f) COPY=%s: without INDEX the staged index folder was not replaced: %s" % (copy, r.stdout))
        elif not os.path.isfile(os.path.join(dst, "species_call.tsv")):
            fail("(f) COPY=%s: without INDEX, %s lacks data/taxonomy" % (copy, dst))
    # A folder of the user's own (no .fastag-staged marker) is left alone, in
    # both modes, with an index and without one.
    for copy in modes:
        own = os.path.join(tmp, "own-" + copy, "share-FASTag-taxonomy")
        mine = os.path.join(own, "mine.txt")
        write(mine, "mine")
        r = run_stage(TAX, own, copy, idx)
        if r.returncode != 0 or not os.path.isfile(mine) or text(mine) != "mine" \
                or os.path.exists(os.path.join(own, "tax_k7.taxdb")) \
                or os.path.exists(os.path.join(own, ".fastag-staged")):
            fail("(f) COPY=%s: a share-FASTag-taxonomy folder of the user's own was changed by an INDEX run: %s"
                 % (copy, r.stdout))
        r = run_stage(TAX, own, copy)
        if r.returncode != 0 or not os.path.isfile(mine) or text(mine) != "mine":
            fail("(f) COPY=%s: a run without INDEX removed the user's own folder or its files: %s" % (copy, r.stdout))
        elif os.path.exists(os.path.join(own, "species_call.tsv")):
            fail("(f) COPY=%s: a run without INDEX staged data/taxonomy into the user's own folder" % copy)
        if copy == "ON":
            own2 = os.path.join(tmp, "own2", "share-FASTag-taxonomy")
            write(os.path.join(own2, "species_call.tsv"), "mine")
            r = run_stage(TAX, own2, copy)
            if r.returncode != 0 or text(os.path.join(own2, "species_call.tsv")) != "mine":
                fail("(f) COPY=ON: a run without INDEX overwrote a file in the user's own folder: %s" % r.stdout)
    # A staged folder is cleaned of what the script put there, and of nothing else.
    owned = os.path.join(tmp, "owned", "share-FASTag-taxonomy")
    r1 = run_stage(TAX, owned, "ON", idx)
    write(os.path.join(owned, "extra.txt"), "extra")
    r2 = run_stage(TAX, owned, "ON")
    if r1.returncode != 0 or r2.returncode != 0:
        fail("(f) owned cleanup: stage-data.cmake failed: %s%s" % (r1.stdout, r2.stdout))
    else:
        if not os.path.isfile(os.path.join(owned, "extra.txt")):
            fail("(f) owned cleanup: a file the user added to a staged folder was removed")
        if os.path.exists(os.path.join(owned, "tax_k7.taxdb")):
            fail("(f) owned cleanup: the staged index is left after a run without INDEX")
        if not os.path.isfile(os.path.join(owned, "species_call.tsv")):
            fail("(f) owned cleanup: no species_call.tsv after the run without INDEX")

    # (g) staging runs on every build, and a restage tracks data/ exactly.
    if STAGED == "ON":
        cfg = ["--config", CONFIG] if CONFIG else []
        alk = os.path.join(BIN, "share-FASTag-alkylation")
        aside = alk + ".shipped-data-test"

        def remove_any(p):
            if os.path.islink(p) or os.path.isfile(p):
                os.remove(p)
            elif os.path.isdir(p):
                shutil.rmtree(p)

        for what, args in (("cmake --build --target fastag_stage_data", ["--target", "fastag_stage_data"]),
                           ("cmake --build (nothing changed)", [])):
            remove_any(aside)
            os.rename(alk, aside)
            try:
                r = subprocess.run([CMAKE, "--build", BUILD] + args + cfg, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                if r.returncode != 0:
                    fail("(g) %s failed:\n%s" % (what, r.stdout[-2000:]))
                elif not os.path.isdir(alk):
                    fail("(g) %s did not restore a deleted %s" % (what, alk))
                else:
                    check("(g) build tree after %s" % what, "flat", BIN, index=bool(INDEX_USED))
            finally:
                # Put the original back when the build did not restore it.
                if os.path.lexists(alk):
                    remove_any(aside)
                else:
                    os.rename(aside, alk)
    else:
        print("note: FASTAG_STAGE_DATA_IN_BUILD is off; (g) build-tree restaging skipped", file=sys.stderr)
    # A data-only update in copy mode: changed bytes are copied, deleted files go.
    tsrc = os.path.join(tmp, "src-digest")
    shutil.copytree(os.path.join(SRC, "data", "digest"), tsrc)
    write(os.path.join(tsrc, "sub", "nested.tsv"), "nested")
    names = sorted(n for n in os.listdir(tsrc) if os.path.isfile(os.path.join(tsrc, n)))
    changed, gone = names[0], names[1]
    upd = os.path.join(tmp, "bin-update", "share-FASTag-digest")
    r1 = run_stage(tsrc, upd, "ON")
    write(os.path.join(tsrc, changed), "changed bytes")
    os.remove(os.path.join(tsrc, gone))
    os.remove(os.path.join(tsrc, "sub", "nested.tsv"))
    r2 = run_stage(tsrc, upd, "ON")
    if r1.returncode != 0 or r2.returncode != 0:
        fail("(g) COPY=ON data update: stage-data.cmake failed: %s%s" % (r1.stdout, r2.stdout))
    else:
        if not os.path.isfile(os.path.join(upd, changed)) or text(os.path.join(upd, changed)) != "changed bytes":
            fail("(g) COPY=ON data update: %s does not have the new bytes" % changed)
        if os.path.exists(os.path.join(upd, gone)):
            fail("(g) COPY=ON data update: %s, deleted from the source, is still staged" % gone)
        if os.path.exists(os.path.join(upd, "sub", "nested.tsv")):
            fail("(g) COPY=ON data update: sub/nested.tsv, deleted from the source, is still staged")
    user = os.path.join(tmp, "bin-update", "share-FASTag-user")
    write(os.path.join(user, "mine.txt"), "mine")
    r = run_stage(tsrc, user, "ON")
    if r.returncode != 0 or text(os.path.join(user, "mine.txt")) != "mine" \
            or os.path.exists(os.path.join(user, changed)):
        fail("(g) COPY=ON data update: an unmarked folder of the user's own was not kept: %s" % r.stdout)
    # The same with an index, in per-file-link mode: a new file is linked, a deleted one unlinked.
    if SYMLINK:
        ttax = os.path.join(tmp, "src-taxonomy")
        shutil.copytree(TAX, ttax)
        lnk = os.path.join(tmp, "bin-links", "share-FASTag-taxonomy")
        r1 = run_stage(ttax, lnk, "OFF", idx)
        write(os.path.join(ttax, "new.tsv"), "new")
        os.remove(os.path.join(ttax, "reference-set.tsv"))
        r2 = run_stage(ttax, lnk, "OFF", idx)
        if r1.returncode != 0 or r2.returncode != 0:
            fail("(g) INDEX link update: stage-data.cmake failed: %s%s" % (r1.stdout, r2.stdout))
        else:
            p = os.path.join(lnk, "new.tsv")
            if not os.path.islink(p) or text(p) != "new":
                fail("(g) INDEX link update: a file added to the source is not linked")
            if os.path.lexists(os.path.join(lnk, "reference-set.tsv")):
                fail("(g) INDEX link update: a file deleted from the source is still linked")

    # (h) INDEX as the index file itself: staged as tax_k7.taxdb, the dumps
    # those of data/taxonomy.
    ifile = os.path.join(tmp, "elsewhere", "pinned-k7.taxdb")
    write(ifile, "index file")
    for copy in modes:
        dst = os.path.join(tmp, "bin-file-" + copy, "share-FASTag-taxonomy")
        os.makedirs(os.path.dirname(dst))
        r = run_stage(TAX, dst, copy, ifile)
        if r.returncode != 0:
            fail("(h) COPY=%s: stage-data.cmake with INDEX=<file> failed: %s" % (copy, r.stdout))
            continue
        p = os.path.join(dst, "tax_k7.taxdb")
        if not os.path.isfile(p) or text(p) != "index file":
            fail("(h) COPY=%s: INDEX=<file> is not staged as tax_k7.taxdb" % copy)
        for f in ("nodes.dmp", "names.dmp", "species_call.tsv"):
            if not os.path.isfile(os.path.join(dst, f)) or text(os.path.join(dst, f)) != text(os.path.join(TAX, f)):
                fail("(h) COPY=%s: with INDEX=<file>, %s is not data/taxonomy's" % (copy, f))
        if os.path.exists(os.path.join(dst, "pinned-k7.taxdb")):
            fail("(h) COPY=%s: INDEX=<file> is staged under its own name too" % copy)
    r = run_stage(TAX, os.path.join(tmp, "bin-nofile", "share-FASTag-taxonomy"), "ON", os.path.join(tmp, "no-such.taxdb"))
    if r.returncode == 0:
        fail("(h) stage-data.cmake accepted an INDEX that is neither a folder nor a file")

    # (h) INDEX_SEARCH, looked at on every run: none holds an index, the first
    # that holds a complete fetch of its manifest (the fetch's completion
    # marker, Codex finding 1), and a cache removed afterwards.
    import hashlib
    import json
    import tarfile

    def digest(p):
        with open(p, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()

    def run_search(dst, copy, cands, mans):
        cmd = [SCRIPT_CMAKE, "-DSRC=" + TAX, "-DDST=" + dst, "-DCOPY=" + copy, "-DINDEX_SEARCH=" + "|".join(cands),
               "-DINDEX_MANIFESTS=" + "|".join(mans), "-P", stage]
        return subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def search_manifest(path, rel, idx_text):
        files = {"tax_k7.taxdb": idx_text.encode(), "nodes.dmp": open(os.path.join(TAX, "nodes.dmp"), "rb").read(),
                 "names.dmp": open(os.path.join(TAX, "names.dmp"), "rb").read()}
        man = {"data_release": rel, "tarball": {"name": "x.tar.gz", "sha256": "0" * 64},
               "files": {n: {"sha256": hashlib.sha256(b).hexdigest(), "bytes": len(b)} for n, b in files.items()}}
        write(path, json.dumps(man))
        return man

    def fill(folder, man, idx_text):
        write(os.path.join(folder, "tax_k7.taxdb"), idx_text)
        for f in ("nodes.dmp", "names.dmp"):
            shutil.copyfile(os.path.join(TAX, f), os.path.join(folder, f))

    def mark(folder, mpath, man):
        from pathlib import Path
        write(os.path.join(folder, fti.MARKER), fti.marker_text(Path(mpath), man["data_release"], man["files"], Path(folder)))

    c1, c2 = os.path.join(tmp, "cache", "rel-2"), os.path.join(tmp, "cache", "rel-1")
    m1, m2 = os.path.join(tmp, "cache", "rel-2.json"), os.path.join(tmp, "cache", "rel-1.json")
    search_manifest(m1, "rel-2", "newer index")
    man2 = search_manifest(m2, "rel-1", "cached index")
    for copy in modes:
        dst = os.path.join(tmp, "bin-search-" + copy, "share-FASTag-taxonomy")
        os.makedirs(os.path.dirname(dst))
        r = run_search(dst, copy, [c1, c2], [m1, m2])
        if r.returncode != 0 or os.path.exists(os.path.join(dst, "tax_k7.taxdb")) \
                or not os.path.isfile(os.path.join(dst, "species_call.tsv")):
            fail("(h) COPY=%s: INDEX_SEARCH with no index found did not stage data/taxonomy alone: %s" % (copy, r.stdout))
        # Every file there, but no completion marker (an interrupted fetch,
        # an index published before its dumps were checked): not staged.
        fill(c2, man2, "cached index")
        r = run_search(dst, copy, [c1, c2], [m1, m2])
        if r.returncode != 0 or os.path.lexists(os.path.join(dst, "tax_k7.taxdb")):
            fail("(h) COPY=%s: INDEX_SEARCH staged a folder without the fetch's completion marker: %s" % (copy, r.stdout))
        mark(c2, m2, man2)
        r = run_search(dst, copy, [c1, c2], [m1, m2])
        p = os.path.join(dst, "tax_k7.taxdb")
        if r.returncode != 0 or not os.path.isfile(p) or text(p) != "cached index":
            fail("(h) COPY=%s: INDEX_SEARCH did not stage the index of its first complete fetch: %s"
                 % (copy, r.stdout))
        # A marker of another manifest (the first folder's), or a file cut
        # short after the fetch: no complete fetch, so the index goes again.
        r = run_search(dst, copy, [c1, c2], [m1, m1])
        if r.returncode != 0 or os.path.lexists(os.path.join(dst, "tax_k7.taxdb")):
            fail("(h) COPY=%s: INDEX_SEARCH staged a folder whose marker names another manifest: %s" % (copy, r.stdout))
        write(os.path.join(c2, "names.dmp"), "cut")
        r = run_search(dst, copy, [c1, c2], [m1, m2])
        if r.returncode != 0 or os.path.lexists(os.path.join(dst, "tax_k7.taxdb")):
            fail("(h) COPY=%s: INDEX_SEARCH staged a folder with a dump cut short: %s" % (copy, r.stdout))
        shutil.copyfile(os.path.join(TAX, "names.dmp"), os.path.join(c2, "names.dmp"))
        r = run_search(dst, copy, [c1, c2], [m1, m2])
        if r.returncode != 0 or not os.path.isfile(p):
            fail("(h) COPY=%s: INDEX_SEARCH did not stage the complete fetch again: %s" % (copy, r.stdout))
        shutil.rmtree(c2)
        r = run_search(dst, copy, [c1, c2], [m1, m2])
        if r.returncode != 0 or os.path.lexists(os.path.join(dst, "tax_k7.taxdb")) \
                or not os.path.isfile(os.path.join(dst, "species_call.tsv")):
            fail("(h) COPY=%s: with the cached index gone the staged one was not removed: %s" % (copy, r.stdout))

    # (h) Codex finding 4: INDEX as an index file of another name, copy mode:
    # a switch to another file with an OLDER time stamp is copied too.
    newer = os.path.join(tmp, "switch", "a-k7.taxdb")
    older = os.path.join(tmp, "switch", "b-k7.taxdb")
    write(newer, "index A")
    write(older, "index B, older")
    os.utime(older, (1_000_000_000, 1_000_000_000))
    dst = os.path.join(tmp, "bin-switch", "share-FASTag-taxonomy")
    os.makedirs(os.path.dirname(dst))
    r1 = run_stage(TAX, dst, "ON", newer)
    r2 = run_stage(TAX, dst, "ON", older)
    p = os.path.join(dst, "tax_k7.taxdb")
    if r1.returncode != 0 or r2.returncode != 0:
        fail("(h) COPY=ON index switch: stage-data.cmake failed: %s%s" % (r1.stdout, r2.stdout))
    elif text(p) != "index B, older":
        fail("(h) COPY=ON: after switching INDEX to an index file with an older time stamp, the previous index "
             "is still staged")
    # And back, and unchanged: the staged copy follows the file named.
    r3 = run_stage(TAX, dst, "ON", newer)
    if r3.returncode != 0 or text(p) != "index A":
        fail("(h) COPY=ON: switching INDEX back did not stage that index again: %s" % r3.stdout)
    r4 = run_stage(TAX, dst, "ON", newer)
    if r4.returncode != 0 or text(p) != "index A":
        fail("(h) COPY=ON: an unchanged INDEX run changed the staged index: %s" % r4.stdout)
    # Codex6 finding 4: the same file rewritten in place with the same size
    # and time stamp (to the second) is copied again: bytes, not stamps, decide.
    st = os.stat(newer)
    write(newer, "index Z")
    os.utime(newer, ns=(st.st_atime_ns, st.st_mtime_ns))
    r5 = run_stage(TAX, dst, "ON", newer)
    if r5.returncode != 0 or text(p) != "index Z":
        fail("(h) COPY=ON: an index rewritten in place with the same size and time stamp was not copied "
             "again: %s" % r5.stdout)
    # Codex6 finding 4: run as a script (cmake -P) the policies are unset
    # unless the script sets them, and CMake 3.28 (the minimum) then rejects
    # IN_LIST (CMP0057): the script sets them before its first command.
    with open(stage, encoding="utf-8") as fh:
        code = [ln.split("#", 1)[0].strip() for ln in fh]
    code = [ln for ln in code if ln]
    m = re.match(r"cmake_minimum_required\(VERSION (\d+)\.(\d+)", code[0]) if code else None
    if not m or (int(m.group(1)), int(m.group(2))) < (3, 3):
        fail("(h) stage-data.cmake does not begin with cmake_minimum_required(VERSION >= 3.3), so cmake -P on "
             "CMake 3.x leaves CMP0057 (IN_LIST) unset: %r" % (code[0] if code else ""))

    # (h) tools/fetch_taxonomy_index.py on a synthetic asset and manifest:
    # only files with the pinned sha256 are staged, assembled in a private
    # folder, checked whole and published with the completion marker.
    fx = os.path.join(tmp, "fetch")
    asset_dir = os.path.join(fx, "asset", "share-FASTag-taxonomy")
    write(os.path.join(asset_dir, "tax_k7.taxdb"), "synthetic index")
    shutil.copyfile(os.path.join(TAX, "nodes.dmp"), os.path.join(asset_dir, "nodes.dmp"))
    shutil.copyfile(os.path.join(TAX, "names.dmp"), os.path.join(asset_dir, "names.dmp"))
    tgz = os.path.join(fx, "FASTag-taxonomy-k7.tar.gz")
    with tarfile.open(tgz, "w:gz") as t:
        t.add(asset_dir, arcname="share-FASTag-taxonomy")
    entry = lambda p: {"sha256": digest(p), "bytes": os.path.getsize(p)}  # noqa: E731
    man = {"data_release": "taxonomy-k7-test", "tarball": {"name": "FASTag-taxonomy-k7.tar.gz", "sha256": digest(tgz)},
           "files": {f: entry(os.path.join(asset_dir, f)) for f in ("tax_k7.taxdb", "nodes.dmp", "names.dmp")}}
    mpath = os.path.join(fx, "taxonomy-k7-test.json")
    write(mpath, json.dumps(man))
    fetch = os.path.join(SRC, "tools", "fetch_taxonomy_index.py")

    def run_fetch(*args, manifest=None):
        return subprocess.run([sys.executable, fetch, "--src", SRC, "--manifest", manifest or mpath] + list(args),
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def complete(folder, manifest=None):
        return fti.fetched_complete(folder, manifest or mpath)

    good = os.path.join(fx, "good")
    r = run_fetch("--from", tgz, "--dest", good)
    gf = os.path.join(good, "share-FASTag-taxonomy")
    if r.returncode != 0:
        fail("(h) fetch_taxonomy_index.py --from <tarball> failed: %s" % r.stdout)
    else:
        if not os.path.isfile(os.path.join(gf, "tax_k7.taxdb")) or text(os.path.join(gf, "tax_k7.taxdb")) != "synthetic index":
            fail("(h) fetch_taxonomy_index.py: the asset's index is not in %s" % gf)
        for f in ("MANIFEST.json", "species_call.tsv"):
            if not os.path.isfile(os.path.join(gf, f)):
                fail("(h) fetch_taxonomy_index.py: no %s beside the fetched index" % f)
        if r.stdout.strip().splitlines()[-1:] != [gf] and gf not in r.stdout:
            fail("(h) fetch_taxonomy_index.py does not print the folder it filled")
        if not complete(gf) or run_fetch("--check", gf).returncode != 0:
            fail("(h) fetch_taxonomy_index.py: the fetched folder has no completion marker of its manifest")
        if [n for n in os.listdir(good) if n.startswith(".")]:
            fail("(h) fetch_taxonomy_index.py left its private folder behind: %s" % os.listdir(good))
    # A tarball whose sha256 the manifest does not pin is refused.
    bad = os.path.join(fx, "bad.tar.gz")
    with tarfile.open(bad, "w:gz") as t:
        t.add(asset_dir, arcname="share-FASTag-taxonomy")
        t.add(mpath, arcname="share-FASTag-taxonomy/extra.json")
    r = run_fetch("--from", bad, "--dest", os.path.join(fx, "bad"))
    if r.returncode == 0 or os.path.exists(os.path.join(fx, "bad", "share-FASTag-taxonomy", "tax_k7.taxdb")):
        fail("(h) fetch_taxonomy_index.py staged a tarball whose sha256 is not the pinned one: %s" % r.stdout)

    # Codex finding 1: pinned tarballs with a member twice, a link member,
    # or a pinned file missing are refused, and nothing is published.
    def pinned_tarball(name, members, files=None):
        path = os.path.join(fx, name)
        with tarfile.open(path, "w:gz") as t:
            for arc, src, kind in members:
                if kind == "file":
                    t.add(src, arcname=arc)
                else:
                    ti = tarfile.TarInfo(arc)
                    ti.type = tarfile.SYMTYPE
                    ti.linkname = src
                    t.addfile(ti)
        m = dict(man, tarball={"name": "FASTag-taxonomy-k7.tar.gz", "sha256": digest(path)}, files=files or man["files"])
        mp = path + ".json"
        write(mp, json.dumps(m))
        return path, mp

    F = lambda n: ("share-FASTag-taxonomy/" + n, os.path.join(asset_dir, n), "file")  # noqa: E731
    for name, members in (("twice.tar.gz", [F("tax_k7.taxdb"), F("nodes.dmp"), F("names.dmp"), F("tax_k7.taxdb")]),
                          ("link.tar.gz", [F("tax_k7.taxdb"), F("nodes.dmp"),
                                           ("share-FASTag-taxonomy/names.dmp", "/etc/hosts", "link")]),
                          ("short.tar.gz", [F("tax_k7.taxdb"), F("nodes.dmp")])):
        tb, mp = pinned_tarball(name, members)
        out = os.path.join(fx, "refused-" + name)
        r = run_fetch("--from", tb, "--dest", out, manifest=mp)
        if r.returncode == 0 or os.path.lexists(os.path.join(out, "share-FASTag-taxonomy")):
            fail("(h) fetch_taxonomy_index.py published %s (a member twice, a link, or a file missing): %s"
                 % (name, r.stdout))
    # A destination folder that is a link elsewhere: the fetch replaces the
    # link and writes nothing through it.
    victim = os.path.join(fx, "victim")
    write(os.path.join(victim, "keep.txt"), "keep")
    linkdest = os.path.join(fx, "linkdest")
    os.makedirs(linkdest)
    if SYMLINK:
        os.symlink(victim, os.path.join(linkdest, "share-FASTag-taxonomy"))
        r = run_fetch("--from", tgz, "--dest", linkdest)
        lf = os.path.join(linkdest, "share-FASTag-taxonomy")
        if r.returncode != 0 or os.path.islink(lf) or not complete(lf):
            fail("(h) fetch_taxonomy_index.py into a linked destination folder failed or kept the link: %s" % r.stdout)
        if sorted(os.listdir(victim)) != ["keep.txt"]:
            fail("(h) fetch_taxonomy_index.py wrote through a linked destination folder into %s: %s"
                 % (victim, os.listdir(victim)))
    # A failed fetch over a complete one (of another index, whose tarball
    # lacks a dump) leaves the complete one in place.
    write(os.path.join(fx, "idx2", "tax_k7.taxdb"), "second index")
    tb, mp = pinned_tarball("short2.tar.gz", [("share-FASTag-taxonomy/tax_k7.taxdb", os.path.join(fx, "idx2", "tax_k7.taxdb"),
                                               "file"), F("nodes.dmp")],
                            dict(man["files"], **{"tax_k7.taxdb": entry(os.path.join(fx, "idx2", "tax_k7.taxdb"))}))
    r = run_fetch("--from", tb, "--dest", good, manifest=mp)
    if r.returncode == 0 or not complete(gf) or text(os.path.join(gf, "tax_k7.taxdb")) != "synthetic index":
        fail("(h) a failed fetch damaged the complete fetch already there: %s" % r.stdout)
    # An unpacked copy: copied (always tested) or linked (with the privilege)
    # when every file matches; refused when the index does not, and when the
    # index matches but a dump does not, nothing is published (Codex finding
    # 3: the link case needs the symlink privilege, the copy case does not).
    for how in ["--copy"] + ([""] if SYMLINK else []):
        out = os.path.join(fx, "unpacked" + (how or "-link"))
        r = run_fetch("--from", asset_dir, "--dest", out, *([how] if how else []))
        lf = os.path.join(out, "share-FASTag-taxonomy", "tax_k7.taxdb")
        if r.returncode != 0 or not os.path.isfile(lf) or text(lf) != "synthetic index" \
                or not complete(os.path.dirname(lf)):
            fail("(h) fetch_taxonomy_index.py --from <folder> %s did not stage the matching index: %s" % (how, r.stdout))
        elif how == "--copy" and os.path.islink(lf):
            fail("(h) fetch_taxonomy_index.py --from <folder> --copy linked the index")
    if not SYMLINK:
        print("note: no symlink privilege; fetch_taxonomy_index.py --from <folder> without --copy skipped",
              file=sys.stderr)
    # Codex6 finding 3: (a) a destination folder of the user's (no fetch's
    # files only: an extra file) is refused, and nothing in it is deleted.
    users = os.path.join(fx, "users")
    uf = os.path.join(users, "share-FASTag-taxonomy")
    write(os.path.join(uf, "my-notes.txt"), "mine")
    write(os.path.join(uf, "tax_k7.taxdb"), "my own index")
    r = run_fetch("--from", tgz, "--dest", users)
    if r.returncode == 0 or sorted(os.listdir(uf)) != ["my-notes.txt", "tax_k7.taxdb"] \
            or text(os.path.join(uf, "my-notes.txt")) != "mine" or text(os.path.join(uf, "tax_k7.taxdb")) != "my own index":
        fail("(h) fetch_taxonomy_index.py replaced a destination folder holding the user's files: %s %s"
             % (r.stdout, os.listdir(uf) if os.path.isdir(uf) else "(gone)"))
    # ... and so does publish() itself, if such a folder appears after the checks.
    stage_tmp = os.path.join(fx, "pub-tmp")
    write(os.path.join(stage_tmp, "tax_k7.taxdb"), "new")
    try:
        fti.publish(fti.Path(stage_tmp), fti.Path(uf), man["files"])
        fail("(h) fetch_taxonomy_index.publish replaced a folder holding the user's files")
    except SystemExit:
        if text(os.path.join(uf, "my-notes.txt")) != "mine":
            fail("(h) fetch_taxonomy_index.publish deleted the user's file")
    # Codex7 review n3: a directory named like a pinned file (or like the
    # fetch's MANIFEST.json) passed the name check, and a successful
    # publication then deleted it recursively. It is the user's: refused by
    # the fetch and by publish(), and left intact.
    for pinned in ("tax_k7.taxdb", "MANIFEST.json"):
        dd = os.path.join(fx, "dir-" + pinned)
        df = os.path.join(dd, "share-FASTag-taxonomy")
        write(os.path.join(df, pinned, "inside.txt"), "kept")
        write(os.path.join(df, "nodes.dmp"), "dumps")
        r = run_fetch("--from", tgz, "--dest", dd)
        if r.returncode == 0 or not os.path.isdir(os.path.join(df, pinned)) \
                or text(os.path.join(df, pinned, "inside.txt")) != "kept" or text(os.path.join(df, "nodes.dmp")) != "dumps":
            fail("(h) fetch_taxonomy_index.py replaced a destination folder whose %s is a directory: %s %s"
                 % (pinned, r.stdout, os.listdir(df) if os.path.isdir(df) else "(gone)"))
        try:
            fti.refuse_unowned(fti.Path(df), man["files"])
            fail("(h) fetch_taxonomy_index.refuse_unowned accepted a directory named %s" % pinned)
        except SystemExit:
            pass
        pt = os.path.join(fx, "pub-dir-" + pinned)
        write(os.path.join(pt, "tax_k7.taxdb"), "new")
        try:
            fti.publish(fti.Path(pt), fti.Path(df), man["files"])
            fail("(h) fetch_taxonomy_index.publish replaced a folder whose %s is a directory" % pinned)
        except SystemExit:
            if text(os.path.join(df, pinned, "inside.txt")) != "kept":
                fail("(h) fetch_taxonomy_index.publish deleted the directory named %s" % pinned)
    if SYMLINK:
        # ... and a link under a pinned name to a directory (not to a file).
        ld = os.path.join(fx, "dirlink")
        lf = os.path.join(ld, "share-FASTag-taxonomy")
        tgt = os.path.join(fx, "dirlink-target")
        write(os.path.join(tgt, "inside.txt"), "kept")
        os.makedirs(lf)
        os.symlink(tgt, os.path.join(lf, "tax_k7.taxdb"))
        r = run_fetch("--from", tgz, "--dest", ld)
        if r.returncode == 0 or not os.path.islink(os.path.join(lf, "tax_k7.taxdb")) \
                or text(os.path.join(tgt, "inside.txt")) != "kept":
            fail("(h) fetch_taxonomy_index.py replaced a folder whose tax_k7.taxdb links to a directory: %s" % r.stdout)
    # (b) publication fails (the new folder is no complete fetch once in
    # place): the earlier complete fetch is put back, unchanged.
    try:
        fti.publish(fti.Path(stage_tmp), fti.Path(gf), man["files"], verify=lambda f: False)
        fail("(h) fetch_taxonomy_index.publish reported success for a failed verification")
    except SystemExit:
        pass
    if not complete(gf) or text(os.path.join(gf, "tax_k7.taxdb")) != "synthetic index" \
            or [n for n in os.listdir(good) if n.startswith(".old-")]:
        fail("(h) a failed publication did not put the earlier fetch back: %s" % os.listdir(good))
    if SYMLINK:
        # (c) an import folder elsewhere whose index is a link back into the
        # cache being replaced: copied, so the published index neither
        # dangles nor points at itself.
        back = os.path.join(fx, "import-back")
        os.makedirs(back)
        for n in ("tax_k7.taxdb", "nodes.dmp", "names.dmp"):
            os.symlink(os.path.join(gf, n), os.path.join(back, n))
        r = run_fetch("--from", back, "--dest", good)
        bi = os.path.join(gf, "tax_k7.taxdb")
        if r.returncode != 0 or not os.path.isfile(bi) or os.path.islink(bi) or text(bi) != "synthetic index" \
                or not complete(gf):
            fail("(h) fetch_taxonomy_index.py --from a folder linking into the cache published a broken index: %s"
                 % r.stdout)
        # (d) a linked payload whose target changes after the fetch at the
        # same size: the recorded sha256 and the live size still match, the
        # target's time stamp is not the one the fetch recorded when it hashed
        # it, so it is no complete fetch (also for CMake). The readers compare
        # size and time stamp, never hash the index again: the change is given
        # a later time stamp (a rewrite within the fetch's second keeps it).
        src_l = os.path.join(fx, "linked-src")
        os.makedirs(src_l)
        for n in ("tax_k7.taxdb", "nodes.dmp", "names.dmp"):
            shutil.copyfile(os.path.join(asset_dir, n), os.path.join(src_l, n))
        ldest = os.path.join(fx, "linked")
        r = run_fetch("--from", src_l, "--dest", ldest)
        lfold = os.path.join(ldest, "share-FASTag-taxonomy")
        if r.returncode != 0 or not os.path.islink(os.path.join(lfold, "tax_k7.taxdb")) or not complete(lfold):
            fail("(h) fetch_taxonomy_index.py --from <folder> did not link the index: %s" % r.stdout)
        else:
            li = os.path.join(src_l, "tax_k7.taxdb")
            st0 = os.stat(li)
            if ("link tax_k7.taxdb %d" % (st0.st_mtime_ns // 1000000000)) not in text(os.path.join(lfold, fti.MARKER)).splitlines():
                fail("(h) fetch_taxonomy_index.py: the marker does not record the linked index's time stamp")
            write(li, "SYNTHETIC INDEX")  # same size, other bytes, written later
            os.utime(li, ns=(st0.st_atime_ns, st0.st_mtime_ns + 5 * 1000000000))
            if complete(lfold) or run_fetch("--check", lfold).returncode == 0:
                fail("(h) a linked index changed at the same size still counts as a complete fetch")
            dl = os.path.join(tmp, "bin-linked", "share-FASTag-taxonomy")
            os.makedirs(os.path.dirname(dl))
            r = run_search(dl, "OFF", [lfold], [mpath])
            if r.returncode != 0 or os.path.lexists(os.path.join(dl, "tax_k7.taxdb")):
                fail("(h) stage-data.cmake staged a linked index changed at the same size: %s" % r.stdout)
            # The fetched bytes and time stamp again (as a restore from a backup).
            write(li, "synthetic index")
            os.utime(li, ns=(st0.st_atime_ns, st0.st_mtime_ns))
            if not complete(lfold):
                fail("(h) a linked index with the fetched size and time stamp again is no complete fetch")
            r = run_search(dl, "OFF", [lfold], [mpath])
            if r.returncode != 0 or not os.path.isfile(os.path.join(dl, "tax_k7.taxdb")):
                fail("(h) stage-data.cmake did not stage the linked index once it matched again: %s" % r.stdout)
    other = os.path.join(fx, "other")
    write(os.path.join(other, "tax_k7.taxdb"), "another index")
    r = run_fetch("--from", os.path.join(other, "tax_k7.taxdb"), "--dest", os.path.join(fx, "refused"), "--copy")
    if r.returncode == 0 or os.path.lexists(os.path.join(fx, "refused", "share-FASTag-taxonomy", "tax_k7.taxdb")):
        fail("(h) fetch_taxonomy_index.py staged an index file the manifest does not pin: %s" % r.stdout)
    dumps_bad = dict(man, files=dict(man["files"], **{"names.dmp": {"sha256": "1" * 64, "bytes": 3}}))
    mbad = os.path.join(fx, "dumps-bad.json")
    write(mbad, json.dumps(dumps_bad))
    r = run_fetch("--from", asset_dir, "--dest", os.path.join(fx, "nodumps"), "--copy", manifest=mbad)
    if r.returncode == 0 or os.path.lexists(os.path.join(fx, "nodumps", "share-FASTag-taxonomy")):
        fail("(h) fetch_taxonomy_index.py published an index whose dumps do not match: %s" % r.stdout)
    # The default folder is the one CMake looks in (FASTAG_TAXONOMY_INDEX_SEARCH),
    # compared only when FASTAG_TAXONOMY_CACHE_DIR is the default (an override
    # is the user's: the fetch then takes --dest).
    r = subprocess.run([sys.executable, fetch, "--src", SRC, "--print-dir"], stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        fail("(h) fetch_taxonomy_index.py --print-dir failed: %s" % r.stdout)
    elif INDEX_SEARCH and CACHE_DEFAULT and os.path.normcase(os.path.normpath(r.stdout.strip())) != \
            os.path.normcase(os.path.normpath(INDEX_SEARCH[0])):
        fail("(h) fetch_taxonomy_index.py fills %s, but the build looks in %s first"
             % (r.stdout.strip(), INDEX_SEARCH[0]))
    elif INDEX_SEARCH and not CACHE_DEFAULT:
        print("note: FASTAG_TAXONOMY_CACHE_DIR is set; the fetch's default folder is not compared", file=sys.stderr)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# (d) the release workflows. Whole folders are copied, so every file above
# goes along; the counts are the archives and apps that copy them.
ci, win = read(".github/workflows/ci.yml"), read(".github/workflows/windows.yml")
# Taxonomy files the index asset does not carry: put back after it replaces the folder.
asset = {"taxonomy/tax_k7.taxdb", "taxonomy/nodes.dmp", "taxonomy/names.dmp"}
put_back = [f.split("/", 1)[1] for f in files if f.startswith("taxonomy/") and f not in asset]
# The pin: the release workflows embed the asset of the newest manifest, the
# one tools/fetch_taxonomy_index.py fetches for local builds.
import json  # noqa: E402
mans = sorted(n for n in os.listdir(os.path.join(SRC, "data", "taxonomy", "manifests")) if n.endswith(".json"))
if not mans:
    fail("(h) data/taxonomy/manifests holds no manifest")
else:
    pin = json.loads(read(os.path.join("data", "taxonomy", "manifests", mans[-1])))
    for wf_name, wf in (("ci.yml", ci), ("windows.yml", win)):
        tag = re.search(r"^\s*TAXDB_TAG:\s*(\S+)", wf, re.M)
        sha = re.search(r"^\s*TAXDB_SHA256:\s*([0-9a-f]{64})", wf, re.M)
        if not tag or tag.group(1) != pin["data_release"]:
            fail("(h) %s: TAXDB_TAG is %s, the newest manifest is %s" % (wf_name, tag and tag.group(1), pin["data_release"]))
        if not sha or sha.group(1) != pin["tarball"]["sha256"]:
            fail("(h) %s: TAXDB_SHA256 is not the newest manifest's tarball sha256" % wf_name)
for wf_name, wf, n_cli, n_app in (("ci.yml", ci, 2, 2), ("windows.yml", win, 1, 1)):
    for x in FOLDERS:
        cli = len(re.findall(r"cp -r (?:fastag/)?data/%s dist/FASTag/share-FASTag-%s\b" % (x, x), wf))
        if cli < n_cli:
            fail("(d) %s: data/%s is copied into %d CLI archive(s), expected %d" % (wf_name, x, cli, n_cli))
        app = len(re.findall(r'cp -[A-Za-z]+ "?[^"\s]*share-FASTag-%s"? "\$R/share/FASTag/%s"' % (x, x), wf))
        if app < n_app:
            fail("(d) %s: share-FASTag-%s goes into %d desktop app(s), expected %d" % (wf_name, x, app, n_app))
    lines = wf.splitlines()
    for i, line in enumerate(lines):
        if re.search(r"rm -rf dist/FASTag/share-FASTag-taxonomy\b", line):
            after = "\n".join(lines[i:i + 25])
            for f in put_back:
                if not re.search(r"cp (?:fastag/)?data/taxonomy/%s dist/FASTag/share-FASTag-taxonomy/" % re.escape(f),
                                 after):
                    fail("(d) %s:%d: the index asset replaces share-FASTag-taxonomy, and %s is not put back"
                         % (wf_name, i + 1, f))
# Codex6 finding 8: the .deb's pinned-taxonomy check reads the generated
# package, extracted again after the repack, not the repack's input folder.
# The repack is dpkg-deb --build, or (1.16.5) the ar members put back with
# only the control member rebuilt.
m = re.search(r'(?:dpkg-deb [^\n]*--build "\$X" "\$DEB"|ar rcD "\$GITHUB_WORKSPACE/\$DEB"[^\n]*)\n(.*?)'
              r'check_taxonomy_manifest\.py[^\n]*\n[^\n]*the \.deb does not carry',
              ci, re.S)
if not m:
    fail("(d) ci.yml: no pinned taxonomy check of the repacked .deb found")
elif not re.search(r'rm -rf "\$X"\n\s*dpkg-deb -(?:R|x) "\$DEB" "\$X"\n', m.group(1)):
    fail("(d) ci.yml: the .deb's taxonomy check reads the repack input $X, not an extraction of the generated $DEB")

# (e) the Tauri bundle and the local macOS bundle script
conf = read("gui/src-tauri/tauri.conf.json")
if not re.search(r'"resources"\s*:\s*\[[^\]]*"resources/fastag"', conf):
    fail("(e) tauri.conf.json: bundle.resources does not take resources/fastag")
bundle = read("gui/scripts/bundle-macos.sh")
for x in FOLDERS:
    if not re.search(r'cp -R\S* "\$%s_DIR" "\$OUT/share/FASTag/%s"' % (x.upper(), x), bundle):
        fail("(e) bundle-macos.sh: does not copy the %s folder to share/FASTag/%s" % (x, x))
if not re.search(r"shipped_data\.py\" check --layout gui", bundle):
    fail("(e) bundle-macos.sh: does not check what it staged (tools/shipped_data.py check --layout gui)")
if not re.search(r'^TAXONOMY_DIR="\$\{TAXONOMY_DIR:-\$_tax\}"', bundle, re.M) \
        or not re.search(r'_tax="\$repo/data/taxonomy"', bundle):
    fail("(e) bundle-macos.sh: TAXONOMY_DIR does not fall back to data/taxonomy of the sources")

if failures:
    print("%d failure(s)" % len(failures), file=sys.stderr)
    sys.exit(1)
print("shipped data: %d files in every layout" % len(files))
