#!/usr/bin/env python3
"""acqcheck3 disjointness: every drawn PXD against each exclusion source.
usage: disj.py <manifest.tsv> <out.tsv> <name>=<pxd list file> [...]"""
import re, sys
man, out = sys.argv[1:3]
srcs = []
for a in sys.argv[3:]:
    n, p = a.split("=", 1)
    srcs.append((n, set(re.findall(r"PXD\d{6}", open(p, errors="replace").read()))))
rows = [l.rstrip("\n").split("\t") for l in open(man) if l.strip()][1:]
assert len(set(r[3] for r in rows)) == len(rows), "one file per project"
bad = 0
L = ["id\tpxd\t" + "\t".join(n for n, _ in srcs)]
for r in rows:
    f = ["yes" if r[3] in s else "no" for _, s in srcs]
    bad += "yes" in f
    L.append("\t".join([r[0], r[3]] + f))
L.append("#sources\t" + "; ".join("%s=%d PXDs" % (n, len(s)) for n, s in srcs))
L.append("#overlaps\t%d of %d files" % (bad, len(rows)))
open(out, "w").write("\n".join(L) + "\n")
print(L[-2]); print(L[-1])
