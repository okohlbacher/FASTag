#!/usr/bin/env python3
"""#3c reference K:R: the in-silico tryptic K:R of one fixed reference, the pooled UniProt reference proteomes of
FASTag's species index (jpr-bench/species/ref50.fasta, the 50-taxon set of data/taxonomy/reference-set.tsv).
Rule (fixed before any fit): Trypsin cleaves after K or R, not before P; fully cleaved peptides with no missed
cleavage, length 7-50 (the species Sage settings); the protein's C-terminal peptide is left out (it ends in no
cleavage); a peptide ending in K counts for K, in R for R. Duplicate sequences count once per occurrence.
Usage: kr_reference.py <fasta>   (prints sha256, K, R, ref_k, ref_r)"""
import hashlib, sys

path = sys.argv[1]
h = hashlib.sha256(open(path, "rb").read()).hexdigest()
k = r = 0


def digest(seq):
    global k, r
    start = 0
    for i, a in enumerate(seq):
        if a in "KR" and (i + 1 == len(seq) or seq[i + 1] != "P"):
            if i + 1 < len(seq):  # not the protein C-terminus
                n = i + 1 - start
                if 7 <= n <= 50:
                    if a == "K":
                        k += 1
                    else:
                        r += 1
            start = i + 1


seq = []
for line in open(path):
    if line.startswith(">"):
        if seq:
            digest("".join(seq))
        seq = []
    else:
        seq.append(line.strip().upper())
if seq:
    digest("".join(seq))
print(f"sha256\t{h}\nK\t{k}\nR\t{r}\nref_k\t{k / (k + r)!r}\nref_r\t{r / (k + r)!r}")
