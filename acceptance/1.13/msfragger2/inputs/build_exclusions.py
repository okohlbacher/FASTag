#!/usr/bin/env python3
"""Exclusion list for the msfragger held-out draw (backlog item 18). Run in the FASTag repository after `git fetch`.

A PXD is excluded when it is named
  (1) in any file of any origin/* branch, or
  (2) in any file under <output>/backlog-1.13 (the arm reports and reserved lists, e.g. the shifts and census
      reserved PXDs, species/heldout-manifest-draft.tsv, alknodb manifests),
except in files that only list candidates or exclusions and therefore say nothing about use:
  - the PRIDE candidate pool acceptance/1.12/inputs/h2r_pride_candidates.tsv (any copy of that file name),
  - files whose base name starts with excl, exclude, prereg-exclude or other_arms (exclusion lists of other arms;
    they are unions of the same sources and of each other, alknodb/prereg-exclude-pxd.txt lists the whole pool
    only because the census draw tables name it),
  - rows of a draw.tsv whose result column is not_needed (projects a draw never opened).
Every other mention excludes (manifests, disjointness tables, PREREGs, results, draw rows TAKEN/excluded/...).
Usage (from the repository root; git grep is limited to the current directory otherwise):
  build_exclusions.py <output/backlog-1.13 dir> <out.txt> [<sub-folder of output to skip> ...]   stdout: counts"""
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
SKIP = tuple(sys.argv[3:])   # second test: sub-folders of <output> not scanned (this track's own draft draw)
for d, _, fs in os.walk(sys.argv[1]):
    for f in fs:
        p = os.path.join(d, f)
        if os.path.relpath(p, sys.argv[1]).startswith(SKIP) and SKIP:
            continue
        try:
            scan("output:" + os.path.relpath(p, sys.argv[1]), open(p, errors="replace").read().splitlines(), hits)
        except OSError:
            pass
with open(sys.argv[2], "w") as o:
    for a in sorted(hits):
        o.write(f"{a}\t{hits[a]}\n")
print(f"refs {len(refs)} excluded_pxd {len(hits)}")
