#!/usr/bin/env python3
"""The data files the FASTag CLI reads from its shipped data, and a check that
a layout holds them.

The list is read from the sources, so a new file the CLI reads cannot be
forgotten by a layout: every data-file literal in src/ (digest_models.tsv,
"/nodes.dmp", ...) must be in FOLDER_OF below, and every proteome name the CLI
accepts (-alkylation_proteome) must have a row and a file in
data/alkylation/proteomes.tsv.

  shipped_data.py list  [--src <repo>]                 one "<folder>/<file>" per line
  shipped_data.py check [--src <repo>] --layout install|flat|gui|data <root> [--index]

Layouts (where <folder> is digest, alkylation or taxonomy):
  install  <root>/share/FASTag/<folder>   (cmake --install prefix)
  flat     <root>/share-FASTag-<folder>   (release tarball/zip; build tree)
  gui      <root>/share/FASTag/<folder>   (the app's resources/fastag)
  data     <root>/<folder>                (data/ of the sources)
--index also asks for the taxonomy index tax_k7.taxdb (release layouts and a
build with FASTAG_TAXONOMY_INDEX_DIR; the sources and a source install have
the dumps only).
Exit 0 when every file is there, 1 (and the missing ones on stderr) when not.
"""
import argparse
import csv
import os
import re
import sys

# Which shipped folder each data file the CLI reads lives in.
FOLDER_OF = {
    "digest_models.tsv": "digest",
    "digest_models_v2.tsv": "digest",
    "massgap_mods.tsv": "digest",
    "digest_calibration.tsv": "digest",
    "proteomes.tsv": "alkylation",
    "nodes.dmp": "taxonomy",
    "names.dmp": "taxonomy",
    "species_call.tsv": "taxonomy",
    "tax_k7.taxdb": "taxonomy",
}
# Not in the sources: the ~1 GB index is a release asset
# (FASTag-<version>-taxonomy-k7.tar.gz).
INDEX = "taxonomy/tax_k7.taxdb"

LITERAL = re.compile(r'"/?([A-Za-z0-9_]+\.(?:tsv|dmp|taxdb))"')
PROTEOME_NAMES = re.compile(r'prot == "([a-z0-9_]+)"')


def repo_of(path):
    return os.path.abspath(path or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def source_literals(src):
    """Every data-file name the CLI sources spell out, with where."""
    found = {}
    sdir = os.path.join(src, "src")
    for name in sorted(os.listdir(sdir)):
        if not name.endswith((".cpp", ".h")):
            continue
        with open(os.path.join(sdir, name), encoding="utf-8", errors="replace") as f:
            for n, line in enumerate(f, 1):
                for m in LITERAL.finditer(line):
                    found.setdefault(m.group(1), "src/%s:%d" % (name, n))
    return found


def proteome_names(src):
    """The proteome names -alkylation_proteome takes (FASTag.cpp, "named")."""
    with open(os.path.join(src, "src", "FASTag.cpp"), encoding="utf-8") as f:
        for line in f:
            if "const bool named" in line and "prot ==" in line:
                return [n for n in PROTEOME_NAMES.findall(line) if n != "auto"]
    return []


def required(src):
    """(files, problems): "<folder>/<file>" the CLI reads, and what is wrong
    with the list itself."""
    problems = []
    files = set()
    for lit, where in source_literals(src).items():
        if lit not in FOLDER_OF:
            problems.append("%s names %s, which is in no shipped folder: add it to FOLDER_OF in "
                            "tools/shipped_data.py and to data/" % (where, lit))
            continue
        files.add("%s/%s" % (FOLDER_OF[lit], lit))
    names = proteome_names(src)
    if not names:
        problems.append("src/FASTag.cpp: no proteome names found (const bool named = prot == ...)")
    manifest = os.path.join(src, "data", "alkylation", "proteomes.tsv")
    rows = {}
    if os.path.isfile(manifest):
        with open(manifest, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                rows[row.get("name", "")] = row.get("file", "")
    for n in names:
        if not rows.get(n):
            problems.append("data/alkylation/proteomes.tsv has no row for the %s proteome" % n)
            files.add("alkylation/%s.fasta.gz" % n)
        else:
            files.add("alkylation/%s" % rows[n])
    return sorted(files), problems


def folder(layout, root, name):
    if layout in ("install", "gui"):
        return os.path.join(root, "share", "FASTag", name)
    if layout == "flat":
        return os.path.join(root, "share-FASTag-" + name)
    return os.path.join(root, name)


def missing(src, layout, root, index):
    files, problems = required(src)
    out = list(problems)
    for f in files:
        if f == INDEX and not index:
            continue
        name, base = f.split("/", 1)
        p = os.path.join(folder(layout, root, name), base)
        if not os.path.isfile(p):
            out.append("missing: " + p)
    return out


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    pl = sub.add_parser("list")
    pl.add_argument("--src")
    pc = sub.add_parser("check")
    pc.add_argument("--src")
    pc.add_argument("--layout", required=True, choices=["install", "flat", "gui", "data"])
    pc.add_argument("--index", action="store_true")
    pc.add_argument("root")
    a = ap.parse_args(argv)
    src = repo_of(a.src)
    if a.cmd == "list":
        files, problems = required(src)
        for f in files:
            print(f)
        for p in problems:
            print(p, file=sys.stderr)
        return 1 if problems else 0
    bad = missing(src, a.layout, a.root, a.index)
    for b in bad:
        print(b, file=sys.stderr)
    if not bad:
        print("shipped data complete (%s layout at %s)" % (a.layout, a.root))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
