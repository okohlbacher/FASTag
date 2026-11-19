#!/usr/bin/env python3
"""Writes acceptance/ident/splits.tsv (FASTag 1.16 item 4, identifiability).

PXD000561 is split by SAMPLE: the tissue or cell type, the token after Adult_/Fetal_ in the file name (Adult_Heart and
Fetal_Heart are one sample, so no tissue is on both sides). Never by fraction or by run. The four tissues of the six
item-2 QC development runs (Adrenalgland, Bcells, CD4Tcells, Colon) are development by rule; of the other 22, the
first 9 of a seeded shuffle (random.Random(SEED), sorted names) are development too, the remaining 13 held-out.
PXD000865 (another lab) is the out-of-lab test: every file is `oolab`, untouched in development.

Input: the PRIDE file lists in lists/ (names only; no held-out file is opened). Output: one row per RAW file.
Usage: python3 make_splits.py > splits.tsv
"""
import os
import random
import re
import sys

SEED = 20261118
FORCED_DEV = ["Adrenalgland", "Bcells", "CD4Tcells", "Colon"]  # item-2 QC dev runs
N_DEV_EXTRA = 9
HERE = os.path.dirname(os.path.abspath(__file__))


def names(fn):
    with open(os.path.join(HERE, "lists", fn)) as f:
        return [l.strip() for l in f if l.strip().lower().endswith(".raw")]


def main():
    all561, sub561 = names("PXD000561-all.txt"), set(names("PXD000561-subset.txt"))
    all865, sub865 = names("PXD000865-all.txt"), set(names("PXD000865-subset.txt"))
    pat = re.compile(r"^(Adult|Fetal)_([A-Za-z0-9]+)_")
    tissue = {}
    for n in all561:
        m = pat.match(n)
        if not m:
            sys.exit(f"unexpected PXD000561 file name: {n}")
        tissue[n] = (m.group(1), m.group(2))
    tissues = sorted({t for _, t in tissue.values()})
    rest = [t for t in tissues if t not in FORCED_DEV]
    random.Random(SEED).shuffle(rest)
    dev = set(FORCED_DEV) | set(rest[:N_DEV_EXTRA])
    w = sys.stdout
    w.write("project\tfile\tstage\tsample\tsplit\tin_subset\n")
    for n in sorted(all561):
        st, t = tissue[n]
        w.write(f"PXD000561\t{n}\t{st}\t{t}\t{'dev' if t in dev else 'heldout'}\t{int(n in sub561)}\n")
    for n in sorted(all865):
        w.write(f"PXD000865\t{n}\t\t\toolab\t{int(n in sub865)}\n")


if __name__ == "__main__":
    main()
