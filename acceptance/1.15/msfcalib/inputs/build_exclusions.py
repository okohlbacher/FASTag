#!/usr/bin/env python3
"""Exclusion list for the msfcalib held-out draw (post-1.15, acc115/msfcalib). Run in the FASTag repository after
`git fetch`. Changed from acceptance/1.14/exactonly/inputs/build_exclusions.py: (1) also scans the refs of the bundle
of branches deleted from origin on 2026-11-13 (fetched as refs/deleted-20261113/*); (2) skips the given sub-folders
of <output> (this test's own notes folder).

A PXD is excluded when it is named
  (1) in any file of any origin/* branch or of any refs/deleted-20261113/* branch, or
  (2) in any file under <output> (every report, reserved list, draft draw and manifest of earlier FASTag sets,
      among them backlog-1.13, backlog-1.14 and backlog-1.15), or
  (3) in a directory or file name under <data> (the local FASTag data folder),
except in files that only list candidates or exclusions and therefore say nothing about use:
  - the PRIDE candidate pool acceptance/1.12/inputs/h2r_pride_candidates.tsv (any copy of that file name),
  - files whose base name starts with excl, exclude, prereg-exclude or other_arms,
  - rows of a draw.tsv whose result column is not_needed (projects a draw never opened).
Files above 20 MB, binary formats and files without read permission are not opened.
Usage (from the repository root; git grep is limited to the current directory otherwise):
  build_exclusions.py <output dir> <data dir> <out.txt> [<sub-folder of output to skip> ...]   stdout: counts"""
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
refs = [r for pre in ("refs/remotes/origin", "refs/deleted-20261113")
        for r in subprocess.run(["git", "for-each-ref", "--format=%(refname)", pre],
                                capture_output=True, text=True, check=True).stdout.split() if not r.endswith("/HEAD")]
for ref in refs:   # git grep prints <ref>:<path>:<line>; exit 1 = no match
    out = subprocess.run(["git", "grep", "-I", "-E", r"PXD[0-9]{6}", ref], capture_output=True).stdout
    for l in out.decode("utf-8", "replace").splitlines():
        path, line = l[len(ref) + 1:].split(":", 1)
        scan(f"{ref[len('refs/'):].replace('remotes/', '', 1)}:{path}", [line], hits)
BIN = (".png", ".jpg", ".jpeg", ".gif", ".pdf", ".pptx", ".docx", ".xlsx", ".zip", ".gz", ".bz2", ".xz", ".tar",
       ".mzml", ".raw", ".d", ".mgf", ".mzpeak", ".parquet", ".bin", ".so", ".dylib", ".a", ".o", ".dmg", ".ico",
       ".bundle")
SKIP = tuple(s.rstrip("/") + "/" for s in sys.argv[4:])
for d, _, fs in os.walk(sys.argv[1]):
    for f in fs:
        p = os.path.join(d, f)
        if SKIP and os.path.relpath(p, sys.argv[1]).startswith(SKIP):
            continue
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
