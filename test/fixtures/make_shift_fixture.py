#!/usr/bin/env python3
"""Writes the #17 mass-shift fixture (FASTag 1.12). Standard library only.

  shifts_insilico.mgf  in-silico spectra (charge 2, singly charged b2..b(n-1)
                       and y1..y(n-1), exact monoisotopic masses, intensities
                       ending in .5) of the tryptic peptides (after K/R, not
                       before P, length 8-20, no C) of Ecoli_MS2_small.fasta.
                       Each spectrum carries one N-terminal mass shift: the
                       precursor and every b ion are shifted, the y ions are
                       not, so the y-ion tags place with that gap. Shifts and
                       spectra per shift:
                         0                      40  unshifted
                         +15.994915 Oxidation   30  -> variable modification
                         +42.010565 Acetyl      20  -> variable modification
                         +1.003355  13C         12  -> isotope error
                         +123.4567  unexplained 12  -> Comet offset
                         -77.7777   unexplained 10  -> negative: dropped
                       A gap-carrying -search_shifts run on a real database
                       without shipping real data.

usage: make_shift_fixture.py <Ecoli_MS2_small.fasta> <outdir>
"""
import os
import random
import sys

MONO = {
    "G": 57.02146372, "A": 71.03711379, "S": 87.03202841, "P": 97.05276385,
    "V": 99.06841391, "T": 101.04767847, "C": 103.00918478, "L": 113.08406398,
    "I": 113.08406398, "N": 114.04292744, "D": 115.02694303, "Q": 128.05857751,
    "K": 128.09496302, "E": 129.04259309, "M": 131.04048491, "H": 137.05891186,
    "F": 147.06841391, "R": 156.10111103, "Y": 163.06332853, "W": 186.07931295,
}
PROTON = 1.00727646688
WATER = 18.0105646837
SHIFTS = [(0.0, 40), (15.994915, 30), (42.010565, 20), (1.003355, 12), (123.4567, 12), (-77.7777, 10)]


def proteins(path):
    out, seq = [], None
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith(">"):
                if seq:
                    out.append(seq)
                seq = ""
            elif seq is not None:
                seq += line
    if seq:
        out.append(seq)
    return out


def tryptic(seq):
    out, start = [], 0
    for i, c in enumerate(seq):
        if c in "KR" and (i + 1 == len(seq) or seq[i + 1] != "P"):
            out.append(seq[start:i + 1])
            start = i + 1
    if start < len(seq):
        out.append(seq[start:])
    return out


def main():
    fasta, outdir = sys.argv[1], sys.argv[2]
    peps = sorted({p for s in proteins(fasta) for p in tryptic(s)
                   if 8 <= len(p) <= 20 and all(c in MONO and c != "C" for c in p)})
    rng = random.Random(20261107)
    n = 0
    with open(os.path.join(outdir, "shifts_insilico.mgf"), "w", newline="\n") as f:
        for shift, count in SHIFTS:
            for _ in range(count):
                pep = rng.choice(peps)
                n += 1
                m = [MONO[c] for c in pep]
                mass = sum(m) + WATER + shift
                ions = [sum(m[:i]) + shift + PROTON for i in range(2, len(pep))]
                ions += [sum(m[len(pep) - i:]) + WATER + PROTON for i in range(1, len(pep))]
                ions.sort()
                f.write("BEGIN IONS\n")
                f.write(f"TITLE=shifts_insilico.{n}.{n}.2 {pep} {shift:+.6f}\n")
                f.write(f"RTINSECONDS={10.0 + n:.1f}\n")
                f.write(f"PEPMASS={(mass + 2 * PROTON) / 2:.6f}\n")
                f.write("CHARGE=2+\n")
                for k, mz in enumerate(ions):
                    f.write(f"{mz:.6f} {1000 + (k * 379) % 9000}.5\n")
                f.write("END IONS\n")


if __name__ == "__main__":
    main()
