#!/usr/bin/env python3
"""DEV test helper only: write a Sage results.sage.tsv (targets and decoys, rank 1) in the MSFragger tsv columns
score_item15B.fragger_psms reads (scannum, peptide, modification_info, protein, charge, expectscore, hit_rank), with
expectscore = 10^-(sage_discriminant_score) so that the order of the hits is Sage's. Tests the reader, the
target-decoy q-value and the scoring plumbing of score_item15B.py on DEV data; it is not an MSFragger search.
Usage: sage_as_fragger.py <results.sage.tsv> <out.tsv>"""
import re
import sys

import pandas as pd

src, dst = sys.argv[1:3]
df = pd.read_csv(src, sep="\t")
if "rank" in df.columns:
    df = df[df["rank"] == 1]
tok = re.compile(r"([A-Z])((?:\[[^\]]*\])*)")
num = re.compile(r"[-+]?\d+\.?\d*")


def msum(s):
    return sum(float(x) for x in num.findall(s))

rows = []
for pep, prot, sc, ch, lab, s in zip(df["peptide"], df["proteins"], df["scannr"], df["charge"], df["label"],
                                     df["sage_discriminant_score"]):
    p = str(pep)
    mods = []
    m = re.match(r"^((?:\[[^\]]*\])+)-", p)
    if m:
        mods.append(f"N-term({msum(m.group(1)):.4f})")
        p = p[m.end():]
    plain = ""
    for i, (aa, md) in enumerate(tok.findall(p), start=1):
        plain += aa
        if md:
            mods.append(f"{i}{aa}({msum(md):.4f})")
    scan = int(re.search(r"scan=(\d+)", str(sc)).group(1))
    protein = str(prot).split(";")[0]
    if lab == -1 and not protein.startswith("rev_"):
        protein = "rev_" + protein
    rows.append({"scannum": scan, "peptide": plain, "modification_info": ", ".join(mods), "protein": protein,
                 "charge": int(ch), "expectscore": 10 ** (-float(s)), "hit_rank": 1})
pd.DataFrame(rows).to_csv(dst, sep="\t", index=False)
print(f"{len(rows)} rows -> {dst}")
