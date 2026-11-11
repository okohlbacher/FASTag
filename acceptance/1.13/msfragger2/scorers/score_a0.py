#!/usr/bin/env python3
"""Informational arm a0 of the second msfragger held-out test (default shortlist, default export). No verdict.
Same FDR and peptide comparison as score_msfragger.py (imported). recall_a0 = scans identified in b that a0
identifies with the same peptide / scans identified in b; speedup_a0 = wall(b) / (wall(fastag0) + wall(a0)).
Usage: score_a0.py <list.tsv> <runs dir>   -> TSV on stdout"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_msfragger import accepted, wall, rc, fmt

print("run\tfastag0_rc\ta0_rc\tshortlist0_targets\ta0_psm\tb_psm\trecall_a0\tt_fastag0\tt_a0\tspeedup_a0")
for line in open(sys.argv[1]):
    run = line.split("\t")[0].strip()
    if not run:
        continue
    d = f"{sys.argv[2]}/{run}"
    A, B = accepted(f"{d}/a0/{run}.pin"), accepted(f"{d}/b/{run}.pin")
    try:
        n = sum(1 for l in open(f"{d}/fastag0/red.fasta") if l.startswith(">") and not l.startswith(">rev_"))
    except OSError:
        n = None
    rec = sum(1 for s, (p, _) in B.items() if s in (A or {}) and A[s][0] == p) / len(B) if B else None
    tf, ta, tb = wall(f"{d}/fastag0.time"), wall(f"{d}/a0.time"), wall(f"{d}/b.time")
    sp = tb / (tf + ta) if None not in (tf, ta, tb) else None
    print(run, rc(d, "fastag0"), rc(d, "a0"), fmt(n), fmt(None if A is None else len(A)),
          fmt(None if B is None else len(B)), fmt(rec), fmt(tf), fmt(ta), fmt(sp), sep="\t")
