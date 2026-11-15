#!/usr/bin/env python3
"""acqcheck4 disjointness: every drawn PXD against each exclusion source.
usage: disj.py <manifest.tsv> <out.tsv> <name>=<pxd list file> [...]"""
import re, sys
man, out = sys.argv[1:3]
srcs = []
for a in sys.argv[3:]:
    n, p = a.split("=", 1)
    srcs.append((n, set(re.findall(r"PXD\d{6}", open(p, errors="replace").read()))))
rows = [l.rstrip("\n").split("\t") for l in open(man) if l.strip()][1:]
other = [r[3] for r in rows if r[1] != "DDA_astral"]
assert len(set(other)) == len(other), "one file per project outside DDA_astral"
assert not set(other) & set(r[3] for r in rows if r[1] == "DDA_astral"), "a DDA_astral project in another stratum"
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
