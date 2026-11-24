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
  (f) cmake/stage-data.cmake stages an index folder beside data/taxonomy and
      leaves a folder of the user's own alone.

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
    idx = os.path.join(tmp, "index")
    os.makedirs(idx)
    for f in ("tax_k7.taxdb", "nodes.dmp", "names.dmp"):
        with open(os.path.join(idx, f), "w") as fh:
            fh.write("index " + f)
    for copy in ("OFF", "ON"):
        bindir = os.path.join(tmp, "bin-" + copy)
        os.makedirs(bindir)
        dst = os.path.join(bindir, "share-FASTag-taxonomy")
        base = [CMAKE, "-DSRC=" + os.path.join(SRC, "data", "taxonomy"), "-DDST=" + dst, "-DCOPY=" + copy]
        r = subprocess.run(base + ["-DINDEX=" + idx, "-P", stage], stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, text=True)
        if r.returncode != 0:
            fail("(f) stage-data.cmake with INDEX (COPY=%s) failed: %s" % (copy, r.stdout))
            continue
        for f in ("tax_k7.taxdb", "nodes.dmp", "names.dmp"):
            p = os.path.join(dst, f)
            if not os.path.isfile(p) or open(p).read() != "index " + f:
                fail("(f) COPY=%s: %s is not the index folder's %s" % (copy, p, f))
        if not os.path.isfile(os.path.join(dst, "species_call.tsv")):
            fail("(f) COPY=%s: no species_call.tsv beside the staged index" % copy)
        # Again without INDEX: the staged folder is ours and goes back to data/taxonomy.
        r = subprocess.run(base + ["-P", stage], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if r.returncode != 0 or os.path.exists(os.path.join(dst, "tax_k7.taxdb")):
            fail("(f) COPY=%s: without INDEX the staged index folder was not replaced: %s" % (copy, r.stdout))
        elif not os.path.isfile(os.path.join(dst, "species_call.tsv")):
            fail("(f) COPY=%s: without INDEX, %s lacks data/taxonomy" % (copy, dst))
    # A folder of the user's own (no marker) is left alone.
    own = os.path.join(tmp, "own", "share-FASTag-taxonomy")
    os.makedirs(own)
    with open(os.path.join(own, "mine.txt"), "w") as fh:
        fh.write("mine")
    subprocess.run([CMAKE, "-DSRC=" + os.path.join(SRC, "data", "taxonomy"), "-DDST=" + own, "-DINDEX=" + idx,
                    "-P", stage], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if not os.path.isfile(os.path.join(own, "mine.txt")) or os.path.exists(os.path.join(own, "tax_k7.taxdb")):
        fail("(f) a share-FASTag-taxonomy folder of the user's own was changed")
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
