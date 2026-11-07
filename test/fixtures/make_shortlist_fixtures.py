#!/usr/bin/env python3
"""Writes the #5 shortlist fixtures (FASTag 1.12). Standard library only.

  Ecoli_shortlist.fasta  3 E. coli proteins (prsA, metK, rplF, verbatim from
                         Ecoli_MS2_small.fasta), the first 30 entries of
                         OpenMS's crap.fasta as foreign proteins, the reversed
                         prsA/metK/rplF of OpenMS's target-decoy E. coli FASTA
                         renamed rev_ -> DECOY_, and one rev_ entry verbatim.
  chymo_insilico.mgf     300 in-silico spectra (charge 2, singly charged b2..
                         b(n-1) and y1..y(n-1), exact monoisotopic masses, intensities
                         ending in .5 so no ion-count rule reads them) of
                         chymotryptic peptides (after F, W, Y, L, not before
                         P) of the first 400 target proteins of that FASTA:
                         the protease check's non-tryptic negative without
                         shipping real chymotrypsin data.

Sources, OpenMS release/3.5.0 (BSD-3-Clause):
  share/OpenMS/examples/TOPPAS/data/Identification/crap.fasta
    sha256 2f346d83abc0f4d742a93d07e4a6ccb879c030932b8fffc5a93734b67e6eefc5
  share/OpenMS/examples/TOPPAS/data/Identification/target_decoy_Ecoli_K12_TaxID_83333.proteomes.fasta
    sha256 51970c68c90e23b65b947f3448c88b36b5faa9ec4740cca563eb98b507475d29

usage: make_shortlist_fixtures.py <OpenMS share/OpenMS/examples/TOPPAS/data/Identification> <outdir>
"""
import hashlib
import os
import random
import sys

SHA = {
    "crap.fasta": "2f346d83abc0f4d742a93d07e4a6ccb879c030932b8fffc5a93734b67e6eefc5",
    "target_decoy_Ecoli_K12_TaxID_83333.proteomes.fasta":
        "51970c68c90e23b65b947f3448c88b36b5faa9ec4740cca563eb98b507475d29",
}

MONO = {
    "G": 57.02146372, "A": 71.03711379, "S": 87.03202841, "P": 97.05276385,
    "V": 99.06841391, "T": 101.04767847, "C": 103.00918478, "L": 113.08406398,
    "I": 113.08406398, "N": 114.04292744, "D": 115.02694303, "Q": 128.05857751,
    "K": 128.09496302, "E": 129.04259309, "M": 131.04048491, "H": 137.05891186,
    "F": 147.06841391, "R": 156.10111103, "Y": 163.06332853, "W": 186.07931295,
}
PROTON = 1.00727646688
WATER = 18.0105646837


def read_fasta(path):
    """[(header line, [sequence lines])] in file order, lines verbatim."""
    out = []
    head, seq = None, []
    with open(path) as f:
        for line in f:
            line = line.rstrip("\n")
            if line.startswith(">"):
                if head is not None:
                    out.append((head, seq))
                head, seq = line, []
            elif head is not None:
                seq.append(line)
    if head is not None:
        out.append((head, seq))
    return out


def check(path):
    h = hashlib.sha256(open(path, "rb").read()).hexdigest()
    want = SHA[os.path.basename(path)]
    if h != want:
        sys.exit(f"{path}: sha256 {h}, expected {want}")


def chymo_peptides(seq):
    """Chymotryptic peptides (cleave after FWYL, not before P), no missed cleavage."""
    out, start = [], 0
    for i, c in enumerate(seq):
        if c in "FWYL" and (i + 1 == len(seq) or seq[i + 1] != "P"):
            out.append(seq[start:i + 1])
            start = i + 1
    return out


def main():
    src, outdir = sys.argv[1], sys.argv[2]
    crap_p = os.path.join(src, "crap.fasta")
    td_p = os.path.join(src, "target_decoy_Ecoli_K12_TaxID_83333.proteomes.fasta")
    check(crap_p)
    check(td_p)
    crap = read_fasta(crap_p)
    td = read_fasta(td_p)
    by_id = {h[1:].split()[0]: (h, s) for h, s in td}
    ecoli = [by_id[k] for k in ("VIMSS15329", "VIMSS17021", "VIMSS17368")]  # prsA, metK, rplF
    decoys = [by_id["rev_" + k] for k in ("VIMSS15329", "VIMSS17021", "VIMSS17368")]
    decoys = [(">DECOY_" + h[len(">rev_"):], s) for h, s in decoys]
    rev_one = by_id["rev_VIMSS15051"]

    entries = crap[:15] + [ecoli[0]] + crap[15:25] + [ecoli[1], decoys[0]] + crap[25:30] + \
        [ecoli[2], decoys[1], decoys[2], rev_one]
    with open(os.path.join(outdir, "Ecoli_shortlist.fasta"), "w", newline="\n") as f:
        for h, s in entries:
            f.write(h + "\n")
            for line in s:
                f.write(line + "\n")

    rng = random.Random(20261107)
    targets = [("".join(s)) for h, s in td if not h.startswith(">rev_")][:400]
    peps = sorted({p for seq in targets for p in chymo_peptides(seq)
                   if 7 <= len(p) <= 20 and all(c in MONO and c != "C" for c in p)})
    peps = rng.sample(peps, 300)
    with open(os.path.join(outdir, "chymo_insilico.mgf"), "w", newline="\n") as f:
        for n, pep in enumerate(peps):
            m = [MONO[c] for c in pep]
            mass = sum(m) + WATER
            ions = []
            for i in range(2, len(pep)):  # b2 .. b(n-1)
                ions.append(sum(m[:i]) + PROTON)
            for i in range(1, len(pep)):  # y1 .. y(n-1)
                ions.append(sum(m[len(pep) - i:]) + WATER + PROTON)
            ions.sort()
            f.write("BEGIN IONS\n")
            f.write(f"TITLE=chymo_insilico.{n + 1}.{n + 1}.2 {pep}\n")
            f.write(f"RTINSECONDS={10.0 + n:.1f}\n")
            f.write(f"PEPMASS={(mass + 2 * PROTON) / 2:.6f}\n")
            f.write("CHARGE=2+\n")
            for k, mz in enumerate(ions):
                f.write(f"{mz:.6f} {1000 + (k * 379) % 9000}.5\n")
            f.write("END IONS\n")


if __name__ == "__main__":
    main()
