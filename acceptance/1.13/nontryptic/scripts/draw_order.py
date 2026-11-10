#!/usr/bin/env python3
"""Seeded reading order per protease over both pools. draw_order.py pool_sdrf.tsv pool_search.tsv excl_pxd.txt > draw_order.tsv"""
import csv, random, sys
excl = set(open(sys.argv[3]).read().split())
P = {}
for f, src in ((sys.argv[1], "sdrf"), (sys.argv[2], "search")):
    for r in csv.DictReader(open(f), delimiter="\t"):
        if r["accession"] in excl or r.get("sdrf_check", "ok") != "ok": continue
        P.setdefault(r["protease"], {}).setdefault(r["accession"], set()).add(src)
print("protease\torder\taccession\tpool")
for p in sorted(P):
    a = sorted(P[p]); random.Random("nontryptic-heldout-1.13:" + p).shuffle(a)
    for i, x in enumerate(a, 1): print(p, i, x, "+".join(sorted(P[p][x])), sep="\t")
