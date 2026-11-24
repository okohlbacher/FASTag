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
      restage tracks the source: changed bytes, deleted and added files.

usage: shipped_data_test.py <src> <FASTag bin dir> <ON|OFF staged> <cmake> <build dir> [<index dir>]
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

SRC, BIN, STAGED, CMAKE, BUILD = sys.argv[1:6]
INDEX_DIR = sys.argv[6] if len(sys.argv) > 6 else ""
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
        check("(c) build tree (FASTAG_STAGE_DATA_IN_BUILD)", "flat", BIN, index=bool(INDEX_DIR))
    else:
        print("note: FASTAG_STAGE_DATA_IN_BUILD is off; (c) skipped", file=sys.stderr)

    # (f) stage-data.cmake with an index folder, and a folder of the user's own
    stage = os.path.join(SRC, "cmake", "stage-data.cmake")
    TAX = os.path.join(SRC, "data", "taxonomy")

    def run_stage(src, dst, copy, index=None):
        cmd = [CMAKE, "-DSRC=" + src, "-DDST=" + dst, "-DCOPY=" + copy]
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
                    check("(g) build tree after %s" % what, "flat", BIN, index=bool(INDEX_DIR))
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
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# (d) the release workflows. Whole folders are copied, so every file above
# goes along; the counts are the archives and apps that copy them.
ci, win = read(".github/workflows/ci.yml"), read(".github/workflows/windows.yml")
# Taxonomy files the index asset does not carry: put back after it replaces the folder.
asset = {"taxonomy/tax_k7.taxdb", "taxonomy/nodes.dmp", "taxonomy/names.dmp"}
put_back = [f.split("/", 1)[1] for f in files if f.startswith("taxonomy/") and f not in asset]
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
