#!/usr/bin/env python3
"""A5-01 Comet mass-offset check: count 1 % FDR target PSMs (score.py's Comet q) whose exp - calc neutral mass is
within 0.02 Da of each given offset (whether calc_neutral_mass carries the offset is read off the most frequent
rounded differences, printed last; comet -p: mass_offsets are "subtracted from the deconvoluted precursor mass"). Usage: negoff.py <comet.txt> <offset> [<offset> ...]"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score

ps = [p for p in score.comet(sys.argv[1]) if p[3] == "t"]
print(f"target_psms_1pct\t{len(ps)}")
for o in map(float, sys.argv[2:]):
    n = sum(1 for p in ps if abs(p[4] - o) <= 0.02)
    nq = sum(1 for p in ps if abs(p[4] - o) <= 0.02 and p[1].startswith("Q"))
    print(f"offset {o:+.6f}\tpsms {n}\tof_which_Nterm_Q {nq}")
from collections import Counter
for d, n in Counter(round(p[4], 2) for p in ps).most_common(8):
    print(f"diff {d:+.2f}\tpsms {n}")
