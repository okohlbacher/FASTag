#!/usr/bin/env python3
"""Writes the label-discovery CLI fixtures (test/label_discovery_cli_test.sh).

Standard library only, deterministic (fixed seeds, no wall-clock input). The
fixtures are written from doc/DESIGN-label-discovery.md, independently of the
implementation: in-silico b/y spectra (precursor charge 2, singly charged
fragments, exact monoisotopic masses with a small seeded jitter) of random
tryptic-like peptides. The internal residues are drawn from
G A S P V T L N D Q E M H F Y W (no C, so the default fixed
Carbamidomethyl (C) never applies; no internal K or R, so a labelled K never
breaks a tag); the last residue is K or R.

A labelled spectrum with N-terminal label L_N and lysine label L_K carries:
  b0 = L_N + H+                 (only when the label has a b0 ion: not dimethyl)
  b_i = L_N + m(r1..ri) + H+    i = 1..n-1
  y_i = m(last i) + H2O + H+ (+ L_K when the last residue is K)   i = 1..n-1
  y_n' = M - L_N + H+           (the precursor that lost the N-terminal label: image N0f)
  L_K + H2O + H+                (K-terminal peptides only: image K0f)
  M = L_N + m(peptide) + H2O (+ L_K for a C-terminal K)
plus five seeded noise peaks. The design's images then follow from the
FASTagger flank formulas: N0r (c = L_N - H2O), N1r (c = L_N + r - H2O),
N0f (n = L_N), N1f (n = L_N + r), K0f (c = L_K), K1f (c = K + L_K),
K1r (n = K + L_K + H2O).

Sets (one MGF each, under <outdir>):
  ld_tmt.mgf          TMT6plex   229.162932 at N and K, b and y ladders
  ld_tmtpro.mgf       TMTpro     304.207146 at N and K
  ld_itraq4.mgf       iTRAQ4plex 144.102063 at N and K
  ld_dimethyl.mgf     Dimethyl    28.031300 at N and K, no b0 ion
  ld_unknown.mgf      +123.4567 at N only (no Unimod entry), K unlabelled
  ld_tmt_bonly.mgf    TMT6plex at N and K, b ions only (b0..b(n-1)): every
                      tag is a reversed (b-ladder) reading
  ld_labelfree.mgf    no label; 50 % of the peptides start with AL and 40 %
                      end with LK, so the residue flanks (A, L, K, R) and the
                      dipeptide flanks (A+L 184.1212 in n, L+K 241.1790 in c)
                      are strong peaks that must not be called labels
  ld_labelfree_iso.mgf  ld_labelfree's spectra with 20 % of the precursors
                      picked +1.003355 and 5 % +2.006710 high (13C picks)
  ld_noise.mgf        60 spectra of random peaks only: no tags
  ld_largeflank.mgf   long peptides (30-36 residues) with only the fragments
                      between 760 Da and M - 760 Da: every flank is above the
                      default -label_discovery_max_flank 700
  ld_peptides.fasta   the peptides of the labelled and label-free sets,
                      joined into proteins (for -recon_out / -delta_out /
                      -massgap_out in the identity checks)

usage: make_label_discovery_fixtures.py <outdir>
"""
import os
import random
import sys

MONO = {
    "G": 57.02146372, "A": 71.03711379, "S": 87.03202841, "P": 97.05276385,
    "V": 99.06841391, "T": 101.04767847, "L": 113.08406398, "N": 114.04292744,
    "D": 115.02694303, "Q": 128.05857751, "K": 128.09496302, "E": 129.04259309,
    "M": 131.04048491, "H": 137.05891186, "F": 147.06841391, "R": 156.10111103,
    "Y": 163.06332853, "W": 186.07931295,
}
INNER = "GASPVTLNDQEMHFYW"
PROTON = 1.00727646688
WATER = 18.0105646837
C13 = 1.0033548378

TMT = 229.162932
TMTPRO = 304.207146
ITRAQ4 = 144.102063
DIMETHYL = 28.0313
UNKNOWN = 123.4567

N_SPECTRA = 240


def peptides(rng, count, lmin=8, lmax=16, start=None, start_share=0.0, end=None, end_share=0.0):
    out = []
    for _ in range(count):
        n = rng.randint(lmin, lmax)
        body = [rng.choice(INNER) for _ in range(n - 1)]
        last = rng.choice("KR")
        if start and rng.random() < start_share:
            body[:len(start)] = list(start)
        pep = "".join(body) + last
        if end and rng.random() < end_share:
            pep = pep[:-len(end)] + end
        out.append(pep)
    return out


def jitter(rng, mz, sd=0.0002):
    return mz + rng.gauss(0.0, sd)


def spectrum(rng, pep, ln, lk, b0, with_b=True, with_y=True, extra=True, window=None, iso=0):
    m = [MONO[c] for c in pep]
    n = len(pep)
    kterm = pep[-1] == "K"
    mk = lk if kterm else 0.0
    mass = ln + sum(m) + WATER + mk
    ions = []
    if with_b:
        if b0 and ln > 0:
            ions.append(ln + PROTON)
        ions += [ln + sum(m[:i]) + PROTON for i in range(1, n)]
    if with_y:
        ions += [sum(m[n - i:]) + WATER + mk + PROTON for i in range(1, n)]
        if extra and ln > 0:
            ions.append(mass - ln + PROTON)            # N0f
        if extra and kterm and lk > 0:
            ions.append(lk + WATER + PROTON)           # K0f
    if window:
        lo, hi = window(mass)
        ions = [x for x in ions if lo <= x <= hi]
        noise = [rng.uniform(lo, hi) for _ in range(5)]
    else:
        noise = [rng.uniform(150.0, max(400.0, mass - 50.0)) for _ in range(5)]
    peaks = [(jitter(rng, x), 2000 + rng.randrange(20000)) for x in ions]
    peaks += [(x, 100 + rng.randrange(900)) for x in noise]
    peaks.sort()
    prec = mass + iso * C13
    prec_mz = (prec * (1.0 + rng.gauss(0.0, 1e-6)) + 2 * PROTON) / 2
    return prec_mz, peaks


def write_mgf(path, name, items):
    with open(path, "w", newline="\n") as f:
        for k, (pep, prec_mz, peaks) in enumerate(items, 1):
            f.write("BEGIN IONS\n")
            f.write(f"TITLE={name}.{k}.{k}.2 {pep}\n")
            f.write(f"RTINSECONDS={10.0 + k:.1f}\n")
            f.write(f"PEPMASS={prec_mz:.6f}\n")
            f.write("CHARGE=2+\n")
            for mz, inten in peaks:
                f.write(f"{mz:.5f} {inten}\n")
            f.write("END IONS\n")


def labelled(outdir, name, seed, ln, lk, b0, with_y=True):
    rng = random.Random(seed)
    peps = peptides(rng, N_SPECTRA)
    items = []
    for pep in peps:
        prec_mz, peaks = spectrum(rng, pep, ln, lk, b0, with_y=with_y)
        items.append((pep, prec_mz, peaks))
    write_mgf(os.path.join(outdir, name + ".mgf"), name, items)
    return peps


def main():
    outdir = sys.argv[1]
    os.makedirs(outdir, exist_ok=True)
    allpeps = []
    allpeps += labelled(outdir, "ld_tmt", 101, TMT, TMT, True)
    allpeps += labelled(outdir, "ld_tmtpro", 102, TMTPRO, TMTPRO, True)
    allpeps += labelled(outdir, "ld_itraq4", 103, ITRAQ4, ITRAQ4, True)
    allpeps += labelled(outdir, "ld_dimethyl", 104, DIMETHYL, DIMETHYL, False)
    allpeps += labelled(outdir, "ld_unknown", 105, UNKNOWN, 0.0, True)
    allpeps += labelled(outdir, "ld_tmt_bonly", 106, TMT, TMT, True, with_y=False)

    # label-free, with strong residue and dipeptide flanks
    rng = random.Random(107)
    peps = peptides(rng, N_SPECTRA, start="AL", start_share=0.5, end="LK", end_share=0.4)
    allpeps += peps
    lf = [(p,) + spectrum(rng, p, 0.0, 0.0, False) for p in peps]
    write_mgf(os.path.join(outdir, "ld_labelfree.mgf"), "ld_labelfree", lf)
    # the same peptides, 20 % / 5 % of the precursors picked one / two 13C high
    rng = random.Random(108)
    iso = []
    for k, p in enumerate(peps):
        shift = 1 if k % 20 < 4 else 2 if k % 20 == 4 else 0
        iso.append((p,) + spectrum(rng, p, 0.0, 0.0, False, iso=shift))
    write_mgf(os.path.join(outdir, "ld_labelfree_iso.mgf"), "ld_labelfree_iso", iso)

    # no tags: random peaks only
    rng = random.Random(109)
    noise = []
    for k in range(60):
        mass = rng.uniform(900.0, 2500.0)
        peaks = sorted((rng.uniform(150.0, mass), 100 + rng.randrange(20000)) for _ in range(30))
        noise.append((f"noise{k}", (mass + 2 * PROTON) / 2, peaks))
    write_mgf(os.path.join(outdir, "ld_noise.mgf"), "ld_noise", noise)

    # every flank above 700 Da: fragments only inside [760, M - 760]
    rng = random.Random(110)
    big = []
    for p in peptides(rng, N_SPECTRA, lmin=30, lmax=36):
        prec_mz, peaks = spectrum(rng, p, 0.0, 0.0, False,
                                  window=lambda mass: (760.0 + PROTON, mass - 760.0 + PROTON))
        big.append((p, prec_mz, peaks))
    write_mgf(os.path.join(outdir, "ld_largeflank.mgf"), "ld_largeflank", big)

    # the peptides as proteins (60 peptides each), sorted and de-duplicated
    uniq = sorted(set(allpeps))
    with open(os.path.join(outdir, "ld_peptides.fasta"), "w", newline="\n") as f:
        for i in range(0, len(uniq), 60):
            f.write(f">sp|LDSYN{i // 60:03d}|LDSYN{i // 60:03d}_SYNTH synthetic label-discovery protein {i // 60}\n")
            seq = "".join(uniq[i:i + 60])
            for j in range(0, len(seq), 60):
                f.write(seq[j:j + 60] + "\n")


if __name__ == "__main__":
    main()
