#!/usr/bin/env python3
"""Write FASTag's shipped protease model table (data/digest/digest_models.tsv).

  digest_models.py <proteome.fasta[.gz]> <source line> > data/digest/digest_models.tsv

The cleavage-rule models (ExPASy PeptideCutter / OpenMS ProteaseDB residues,
uniform over the cleaving residues, the other end the background) and
"unspecific", over the residue composition of the given proteome (I counted as
L, other letters skipped). <source line> names the proteome, its file and
download date for the header.
"""
import gzip
import sys

AAS = "GASPVTCLNDQKEMHFRYW"
# model, class, C-terminal (P1) residues, N-terminal (P1') residues; "" = background
RULES = [
    ("Trypsin", "Trypsin", "KR", ""),
    ("Lys-C", "Lys-C", "K", ""),
    ("Arg-C", "Arg-C", "R", ""),
    ("Glu-C", "Glu-C", "E", ""),
    ("Chymotrypsin", "Chymotrypsin", "FYWL", ""),
    ("Asp-N", "Asp-N", "", "D"),
    ("Lys-N", "Lys-N", "", "K"),
    ("unspecific", "unspecific cleavage", "", ""),
]


def composition(path):
    cnt = dict.fromkeys(AAS, 0)
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt") as fh:
        for line in fh:
            if line.startswith(">"):
                continue
            for c in line.strip().upper():
                c = "L" if c == "I" else c
                if c in cnt:
                    cnt[c] += 1
    tot = sum(cnt.values())
    return {a: cnt[a] / tot for a in AAS}, tot


def main():
    path, source = sys.argv[1], sys.argv[2]
    bg, tot = composition(path)
    out = sys.stdout
    out.write("# FASTag protease models for -digest_out: cleavage rules over a proteome background.\n")
    out.write("# Rules: ExPASy PeptideCutter and OpenMS ProteaseDB (Enzymes.xml); Glu-C after E only (bicarbonate).\n")
    out.write("# A model end is uniform over its cleaving residues; '*' = the background at that end.\n")
    out.write(f"# background: residue composition of {source}, I counted as L, {tot} residues.\n")
    out.write("# Source: UniProt (The UniProt Consortium, Nucleic Acids Res. 2025), CC BY 4.0.\n")
    out.write("model\tclass\tend\tresidue\tfreq\n")
    for end in "CN":
        for a in AAS:
            out.write(f"background\t-\t{end}\t{a}\t{bg[a]!r}\n")
    for name, cls, c, n in RULES:
        for end, res in (("C", c), ("N", n)):
            if not res:
                out.write(f"{name}\t{cls}\t{end}\t*\t-\n")
                continue
            for a in AAS:
                out.write(f"{name}\t{cls}\t{end}\t{a}\t{(1 / len(res) if a in res else 0.0)!r}\n")


if __name__ == "__main__":
    main()
