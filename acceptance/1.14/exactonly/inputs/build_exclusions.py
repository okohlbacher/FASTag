#!/usr/bin/env python3
"""Exclusion list for the -shortlist_exact_only held-out draw (1.14, acc114/exactonly). Run in the FASTag repository
after `git fetch`. Changed from msfragger2/inputs/build_exclusions.py: (2) scans the whole FASTag output folder (not
only backlog-1.13), skipping files above 20 MB and binary formats; (3) adds directory and file names under the
FASTag data folder.

A PXD is excluded when it is named
  (1) in any file of any origin/* branch, or
  (2) in any file under <output> (every report, reserved list, draft draw and manifest of earlier FASTag sets),
  (3) in a directory or file name under <data> (the local FASTag data folder),
except in files that only list candidates or exclusions and therefore say nothing about use:
  - the PRIDE candidate pool acceptance/1.12/inputs/h2r_pride_candidates.tsv (any copy of that file name),
  - files whose base name starts with excl, exclude, prereg-exclude or other_arms (exclusion lists of other arms;
    they are unions of the same sources and of each other, alknodb/prereg-exclude-pxd.txt lists the whole pool
    only because the census draw tables name it),
  - rows of a draw.tsv whose result column is not_needed (projects a draw never opened).
Every other mention excludes (manifests, disjointness tables, PREREGs, results, draw rows TAKEN/excluded/...).
Usage (from the repository root; git grep is limited to the current directory otherwise):
  build_exclusions.py <output dir> <data dir> <out.txt>   stdout: counts"""
import os, re, subprocess, sys

PXD = re.compile(r"PXD\d{6}")
def listfile(path):
    b = os.path.basename(path).lower()
    return b == "h2r_pride_candidates.tsv" or b.startswith(("excl", "prereg-exclude", "other_arms"))

def scan(path, lines, hits):
    if listfile(path):
        return
    draw = os.path.basename(path) == "draw.tsv"
    for line in lines:
        if draw and "\tnot_needed" in line:
            continue
        for a in PXD.findall(line):
            hits.setdefault(a, path)

hits = {}
refs = [r for r in subprocess.run(["git", "for-each-ref", "--format=%(refname)", "refs/remotes/origin"],
        capture_output=True, text=True, check=True).stdout.split() if not r.endswith("/HEAD")]
for ref in refs:   # git grep prints <ref>:<path>:<line>; exit 1 = no match
    out = subprocess.run(["git", "grep", "-I", "-E", r"PXD[0-9]{6}", ref], capture_output=True).stdout
    for l in out.decode("utf-8", "replace").splitlines():
        path, line = l[len(ref) + 1:].split(":", 1)
        scan(f"{ref[len('refs/remotes/'):]}:{path}", [line], hits)
BIN = (".png", ".jpg", ".jpeg", ".gif", ".pdf", ".pptx", ".docx", ".xlsx", ".zip", ".gz", ".bz2", ".xz", ".tar",
       ".mzml", ".raw", ".d", ".mgf", ".mzpeak", ".parquet", ".bin", ".so", ".dylib", ".a", ".o", ".dmg", ".ico")
for d, _, fs in os.walk(sys.argv[1]):
    for f in fs:
        p = os.path.join(d, f)
        try:
            st = os.stat(p)   # sealed (mode 000) files are not opened
            if f.lower().endswith(BIN) or st.st_size > 20e6 or not st.st_mode & 0o444:
                continue
            scan("output:" + os.path.relpath(p, sys.argv[1]), open(p, errors="replace").read().splitlines(), hits)
        except OSError:
            pass
for d, ds, fs in os.walk(sys.argv[2]):
    for n in ds + fs:
        for a in PXD.findall(n):
            hits.setdefault(a, "data:" + os.path.relpath(os.path.join(d, n), sys.argv[2]))
with open(sys.argv[3], "w") as o:
    for a in sorted(hits):
        o.write(f"{a}\t{hits[a]}\n")
print(f"refs {len(refs)} excluded_pxd {len(hits)}")
