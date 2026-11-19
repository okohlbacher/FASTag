#!/usr/bin/env python3
"""Append a shuffled entrapment proteome of equal size to a FASTA.

Each target protein gets one entrapment twin, ENTRAP_<accession>: every
tryptic peptide (cleaved after K/R) has its residues shuffled with its
C-terminal K/R kept in place, so the twin has the same length, composition,
cleavage sites and peptide masses as its target, but other sequences.
Deterministic (random.Random(20261118) per run of the script).

usage: make_entrap.py <in.fasta> <out.fasta>
"""
import random, re, sys

src, dst = sys.argv[1:3]
rnd = random.Random(20261118)
ent, h, seq = [], None, []
for line in open(src):
    line = line.rstrip("\n")
    if line.startswith(">"):
        if h is not None: ent.append((h, "".join(seq)))
        h, seq = line[1:], []
    elif line: seq.append(line.strip())
if h is not None: ent.append((h, "".join(seq)))

def shuffle(s):
    out = []
    for pep in re.findall(r"[^KR]*[KR]|[^KR]+$", s):
        if pep[-1] in "KR":
            body = list(pep[:-1]); rnd.shuffle(body); out.append("".join(body) + pep[-1])
        else:
            body = list(pep); rnd.shuffle(body); out.append("".join(body))
    return "".join(out)

with open(dst, "w") as f:
    for hh, s in ent: f.write(">%s\n%s\n" % (hh, s))
    for hh, s in ent:
        f.write(">ENTRAP_%s\n%s\n" % (hh.split()[0], shuffle(s)))
print(len(ent), "targets +", len(ent), "entrapment")
