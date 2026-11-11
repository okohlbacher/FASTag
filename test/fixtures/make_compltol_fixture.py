#!/usr/bin/env python3
"""Writes the 1.13 item 15 complement-tolerance fixtures. Standard library only.

  compltol_hires.mgf   250 in-silico spectra (charge 2, singly charged b2..b(n-1)
                       and y1..y(n-1), 25 noise peaks between m/z 150 and the
                       peptide mass) of the tryptic peptides (after K/R, not
                       before P, length 8-20, no C) of Ecoli_MS2_small.fasta.
                       Every fragment m/z carries a Gaussian error of sd
                       0.004 Da, the precursor none, so a complement pair's
                       mass error has sd 0.004*sqrt(2) = 0.00566 Da and its
                       95% two-sided window is 1.96 * 0.00566 = 0.0111 Da.
  compltol_lowres.mgf  the same with fragment sd 0.1 Da (pair sd 0.141, 95%
                       window 0.277 Da), for a 0.5 Da fragment tolerance.

Intensities: b and y ions 1000-10000, noise 20-400, so the ladder ranks above
the noise. Deterministic (random.Random seeds 20261109 and 20261110).

usage: make_compltol_fixture.py <Ecoli_MS2_small.fasta> <outdir>
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
N_SPECTRA = 250
N_NOISE = 25


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


def write(path, name, peps, sd, seed):
    rng = random.Random(seed)
    with open(path, "w", newline="\n") as f:
        for n in range(1, N_SPECTRA + 1):
            pep = rng.choice(peps)
            m = [MONO[c] for c in pep]
            mass = sum(m) + WATER
            ions = [sum(m[:i]) + PROTON for i in range(2, len(pep))]
            ions += [sum(m[len(pep) - i:]) + WATER + PROTON for i in range(1, len(pep))]
            peaks = [(mz + rng.gauss(0.0, sd), 1000.0 + 9000.0 * rng.random()) for mz in ions]
            peaks += [(150.0 + (mass - 150.0) * rng.random(), 20.0 + 380.0 * rng.random()) for _ in range(N_NOISE)]
            peaks.sort()
            f.write("BEGIN IONS\n")
            f.write(f"TITLE={name}.{n}.{n}.2 {pep}\n")
            f.write(f"RTINSECONDS={10.0 + n:.1f}\n")
            f.write(f"PEPMASS={(mass + 2 * PROTON) / 2:.6f}\n")
            f.write("CHARGE=2+\n")
            for mz, it in peaks:
                f.write(f"{mz:.6f} {it:.1f}\n")
            f.write("END IONS\n")


def main():
    fasta, outdir = sys.argv[1], sys.argv[2]
    peps = sorted({p for s in proteins(fasta) for p in tryptic(s)
                   if 8 <= len(p) <= 20 and all(c in MONO and c != "C" for c in p)})
    write(os.path.join(outdir, "compltol_hires.mgf"), "compltol_hires", peps, 0.004, 20261109)
    write(os.path.join(outdir, "compltol_lowres.mgf"), "compltol_lowres", peps, 0.1, 20261110)


if __name__ == "__main__":
    main()
