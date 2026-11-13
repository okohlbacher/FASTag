#!/usr/bin/env python3
"""Label discovery held-out test 5: collect every PXD named under the given roots (exclusion list, PREREG-labeldisc5.md).
A file counts when it is a text file (no NUL byte in its first 64 KiB) of at most 64 MiB; the PXDs in its path count
always. A file naming more than 2,000 PXDs is a PRIDE catalogue (pool table) and is skipped; so is a directory (with everything
below it) whose file or subdirectory names name more than 2,000 PXDs (e.g. a copy of the bigbio SDRF catalogue), or whose files' contents together name more than 2,000 PXDs (metadata caches of earlier
selections: one file per PRIDE project or pages of the PRIDE search); and a page or pool of the PRIDE project search (a JSON
list of project records, starting `[ {"accession"`, or a JSON object of them keyed by accession). All of them are listed on stderr. Project file lists (files/<PXD>.json),
manifests and results are not catalogues and count.
Usage: collect_pxd.py <out.txt> <root> [<root> ...]"""
import os, re, sys
R = re.compile(rb"PXD\d{6}")
out, roots = sys.argv[1], sys.argv[2:]
found, skipped = set(), []
for root in roots:
    for d, dirs, files in os.walk(root, onerror=lambda e: print("unreadable", e, file=sys.stderr)):
        dirs[:] = [x for x in dirs if x not in (".git",)]
        found.update(m.decode() for m in R.findall(d.encode()))
        names = {m for f in files + dirs for m in R.findall(f.encode())}
        if len(names) > 2000: skipped.append((d + "/ (directory)", len(names))); dirs[:] = []; continue
        dirset = set()
        for f in files:
            p = os.path.join(d, f)
            found.update(m.decode() for m in R.findall(f.encode()))
            try:
                st = os.lstat(p)
                if not os.path.isfile(p) or os.path.islink(p) or st.st_size > 64 * 2**20 or not (st.st_mode & 0o444): continue
                with open(p, "rb") as fh:
                    head = fh.read(65536)
                    if b"\0" in head: continue
                    if re.match(rb'\s*(\[\s*\{\s*"accession"|\{\s*"(PXD|PRD)\d{6}"\s*:\s*\{\s*"accession")', head): skipped.append((p + " (search page)", 0)); continue
                    s = set(R.findall(head + fh.read()))
            except OSError: continue
            if len(s) > 2000: skipped.append((p, len(s))); continue
            dirset |= s
        if len(dirset) > 2000: skipped.append((d + "/ (directory contents)", len(dirset))); continue
        found.update(m.decode() for m in dirset)
with open(out, "w") as o:
    for x in sorted(found): o.write(x + "\n")
for p, n in skipped: print("catalogue_skipped", n, p, file=sys.stderr)
print(len(found), "PXDs", file=sys.stderr)
