#!/usr/bin/env python3
"""build_excl.py <path\\tPXD files...> > E.txt
Exclusion rule (PREREG-aspn): a PXD is excluded if it appears in any file of an acceptance branch, an output folder or a
data-node work folder that holds at most 5,000 distinct PXDs and whose path is not a candidate pool, search result,
draw order, prescreen, eligibility or selection log, or a scan of every PXD mentioned on a machine (excl-mac/excl-data/excl-b113/x_local) (files above 5,000 PXDs are PRIDE-wide catalogues or pools, not data
that was used)."""
import re, sys, collections
POOL = re.compile(r"pool|candidates|draw_order|prescreen|selection_log|eligib|draw\.tsv|search|sweep|sdrf_enzymes|aspn/PREREG-draft|/excl-mac|/excl-data|/excl-b113|x_local", re.I)
files = collections.defaultdict(set)
for fn in sys.argv[1:]:
    for l in open(fn):
        p, x = l.rstrip("\n").split("\t"); files[fn + ":" + p].add(x)
E = set()
for p, s in files.items():
    if POOL.search(p) or len(s) > 5000: continue
    E |= s
print("\n".join(sorted(E)))
