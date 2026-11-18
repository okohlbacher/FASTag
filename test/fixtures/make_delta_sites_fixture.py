#!/usr/bin/env python3
"""Writes delta_sites.mgf, the 1.16 mass-shift survey fixture. Standard library only.

In-silico spectra (charge 2, singly charged b1..b(n-1) and y1..y(n-1), 20
noise peaks between m/z 150 and the peptide mass) of four tryptic peptides of
Ecoli_MS2_small.fasta, each carrying one modification FASTag is not told
about; every other Cys carries Carbamidomethyl, FASTag's default fixed mod:

  scan 1  TLTLSGM[+15.994915]LAEAIR       Oxidation on M7
  scan 2  FVIGGPMGDC[-33.987721]GLTGR     Cys->Dha on C10, no Carbamidomethyl
                                          (-91.009 vs the searched CAM-Cys)
  scan 3  [+42.010565]LLNDTDMAIIDK        Acetyl on the peptide N-terminus
  scan 4  ALLNS[-18.010565]MVIGVTEGFTK    Dehydrated (Dha) on S5

Each is written three times (scans n, n+10, n+20) with fresh noise, so a
-delta_out row has three spectra. Every fragment m/z carries a Gaussian error
of sd 0.001 Da; intensities: ladder 1000-10000, noise 20-400. Deterministic
(random.Random seed 20261118).

usage: make_delta_sites_fixture.py <outfile>
"""
import random
import sys

MONO = {
    "G": 57.02146372, "A": 71.03711379, "S": 87.03202841, "P": 97.05276385,
    "V": 99.06841391, "T": 101.04767847, "C": 103.00918478, "L": 113.08406398,
    "I": 113.08406398, "N": 114.04292744, "D": 115.02694303, "Q": 128.05857751,
    "K": 128.09496302, "E": 129.04259309, "M": 131.04048491, "H": 137.05891186,
    "F": 147.06841391, "R": 156.10111103, "Y": 163.06332853, "W": 186.07931295,
}
WATER = 18.0105646837
PROTON = 1.00727646677
CAM = 57.02146372

# (peptide, 0-based site or -1 for the N-terminus, shift)
PEPTIDES = [
    ("TLTLSGMLAEAIR", 6, 15.994915),
    ("FVIGGPMGDCGLTGR", 9, -33.987721),
    ("LLNDTDMAIIDK", -1, 42.010565),
    ("ALLNSMVIGVTEGFTK", 4, -18.010565),
]


def residues(pep, site, shift):
    # Carbamidomethyl on every Cys but a modified one: Dha replaces it.
    m = [MONO[c] + (CAM if c == "C" and i != site else 0.0) for i, c in enumerate(pep)]
    if site >= 0:
        m[site] += shift
    else:
        m[0] += shift  # an N-terminal group rides on every b ion, like residue 1
    return m


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    rnd = random.Random(20261118)
    out = []
    for rep in range(3):
        for k, (pep, site, shift) in enumerate(PEPTIDES):
            scan = 1 + k + 10 * rep
            m = residues(pep, site, shift)
            mass = sum(m) + WATER
            peaks = []
            for i in range(1, len(pep)):
                b = sum(m[:i]) + PROTON
                y = sum(m[i:]) + WATER + PROTON
                for mz in (b, y):
                    peaks.append((mz + rnd.gauss(0.0, 0.001), rnd.uniform(1000.0, 10000.0)))
            for _ in range(20):
                peaks.append((rnd.uniform(150.0, mass), rnd.uniform(20.0, 400.0)))
            peaks.sort()
            out.append("BEGIN IONS")
            out.append("TITLE=scan=%d" % scan)
            out.append("PEPMASS=%.6f" % ((mass + 2 * PROTON) / 2))
            out.append("CHARGE=2+")
            out.append("RTINSECONDS=%.1f" % (60.0 * scan))
            out.append("SCANS=%d" % scan)
            for mz, inten in peaks:
                out.append("%.5f %.1f" % (mz, inten))
            out.append("END IONS")
    with open(sys.argv[1], "w", newline="\n") as f:
        f.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
