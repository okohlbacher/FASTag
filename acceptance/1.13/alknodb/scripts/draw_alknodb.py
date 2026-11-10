#!/usr/bin/env python3
"""FASTag 1.13 alknodb held-out: the draw order of the candidate projects.

Pool: acceptance/1.12/inputs/h2r_pride_candidates.tsv, classes `qe` and `astral` (Thermo instruments; the `timstof`
class is out: no converter for it runs on node data without FASTag). Every row counts, whatever its h2r `result`.
Out: every accession in alknodb/inputs/exclude_pxd.txt, and every accession whose number is divisible by 4
(reserved for the hdrcharge arm).
Order: the remaining accessions sorted, then shuffled with random.Random(SEED). Nothing else decides the order.
Usage: draw_alknodb.py <out tsv>"""
import os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = "fastag-1.13:alknodb:heldout:2026-11-10"
excl = {l.strip() for l in open(f"{HERE}/../inputs/exclude_pxd.txt") if l.strip()}
pool = set()
for i, line in enumerate(open(f"{HERE}/../../../1.12/inputs/h2r_pride_candidates.tsv")):
    f = line.rstrip("\n").split("\t")
    if i and f[0] in ("qe", "astral"):
        pool.add(f[1])
n_pool = len(pool)
ok = sorted(a for a in pool if a not in excl and int(a[3:]) % 4 != 0)
random.Random(SEED).shuffle(ok)
with open(sys.argv[1], "w") as o:
    o.write("draw_rank\tpxd\n")
    for i, a in enumerate(ok, 1):
        o.write(f"{i}\t{a}\n")
print(f"pool {n_pool}; excluded list {sum(1 for a in pool if a in excl)}; divisible by 4 (not in list) "
      f"{sum(1 for a in pool if a not in excl and int(a[3:]) % 4 == 0)}; draw order {len(ok)}")
