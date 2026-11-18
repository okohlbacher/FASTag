#!/usr/bin/env python3
"""Blinded hand-check packet (PREREG-dha protocol §4 as amended by AMENDMENT-2 §3 G4/G5).

usage: handcheck_packet.py <calls.tsv> <mzML dir> <packet dir> <sealed key.tsv> <item prefix>

<calls.tsv> is a call list written by harden_heldout.py (it holds FASTag's site and
MSFragger's result and is NOT given to the checkers). Per call the packet holds,
under a random item id (order random.Random(20261118)):
  - the MS2 peak list and the precursor (m/z, charge);
  - FASTag's peptide (fixed carbamidomethyl-Cys) with the gap's shift placed on
    EACH residue of the gap region, in random order (labels A, B, ...);
  - b/y ions, 1+ and 2+, from OpenMS TheoreticalSpectrumGenerator for the
    unshifted peptide, shifted by the gap mass on the ions that contain the
    candidate residue; matched to the peaks at 20 ppm; plots and tables.
Not in the packet: FASTag's chosen site, MSFragger's result, run name (donor), scan.
The key (item -> run, scan, site, MSFragger) goes to <sealed key.tsv> only.
"""
import csv, json, os, random, re, string, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pyopenms as oms

CALLS, MZDIR, PK, KEY, PFX = sys.argv[1:6]
TOL_PPM = 20.0
os.makedirs(PK, exist_ok=True)
calls = list(csv.DictReader(open(CALLS), delimiter="\t"))
rng = random.Random(20261118)
order = list(range(len(calls))); rng.shuffle(order)

def load_run(run):
    exp = oms.MSExperiment(); oms.MzMLFile().load(os.path.join(MZDIR, run + ".mzML"), exp)
    return {s.getNativeID(): s for s in exp.getSpectra()}
cache = {}

def theo(peptide):
    seq = oms.AASequence.fromString(peptide.replace("C", "C(Carbamidomethyl)"))
    tsg = oms.TheoreticalSpectrumGenerator(); p = tsg.getParameters()
    for k, v in (("add_b_ions", "true"), ("add_y_ions", "true"), ("add_a_ions", "false"), ("add_c_ions", "false"),
                 ("add_x_ions", "false"), ("add_z_ions", "false"), ("add_metainfo", "true"), ("add_losses", "false"),
                 ("add_precursor_peaks", "false")):
        p.setValue(k, v)
    tsg.setParameters(p)
    sp = oms.MSSpectrum(); tsg.getSpectrum(sp, seq, 1, 2)
    names = [n.decode() if isinstance(n, bytes) else n for n in sp.getStringDataArrays()[0]]
    out = []
    for pk, nm in zip(sp, names):
        m = re.match(r"([by])(\d+)(\++)$", nm)
        if m: out.append((m.group(1), int(m.group(2)), len(m.group(3)), pk.getMZ()))
    return out

def match(mzs, ints, x):
    best = None
    for mz, it in zip(mzs, ints):
        ppm = (mz - x) / x * 1e6
        if abs(ppm) <= TOL_PPM and (best is None or abs(ppm) < abs(best[1])): best = (mz, ppm, it)
    return best

keyrows = []; template = []
for idx, ci in enumerate(order):
    c = calls[ci]; item = "%s-%03d" % (PFX, idx + 1)
    if c["run"] not in cache:
        cache.clear(); cache[c["run"]] = load_run(c["run"])
    s = cache[c["run"]][c["spectrum"]]
    mzs, ints = s.get_peaks()
    prec = s.getPrecursors()[0] if s.getPrecursors() else None
    pmz = prec.getMZ() if prec else float("nan"); pz = (prec.getCharge() if prec else 0) or int(c["charge"])
    pep = c["peptide"]; L = len(pep); delta = float(c["delta_full"])
    lo, hi = (int(x) for x in c["region"].split("-"))
    cands = list(range(lo, hi + 1)); rng.shuffle(cands)
    labels = {j: string.ascii_uppercase[i] for i, j in enumerate(cands)}
    ions = theo(pep)
    def carries(t, n, j): return n >= j if t == "b" else n >= L - j + 1
    d = os.path.join(PK, item); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "peaks.tsv"), "w") as f:
        f.write("mz\tintensity\n")
        for mz, it in zip(mzs, ints): f.write("%.5f\t%.1f\n" % (mz, it))
    ann = []; summ = []
    for j in cands:
        nm = ns = 0
        for t, n, z, mz0 in ions:
            sh = carries(t, n, j); x = mz0 + (delta / z if sh else 0.0)
            states = {carries(t, n, k) for k in cands}
            m = match(mzs, ints, x)
            if m: nm += 1; ns += sh
            ann.append([labels[j], "%s%d" % (t, n), z, "%.5f" % x, "shifted" if sh else "unshifted",
                        "yes" if len(states) > 1 else "no",
                        "%.5f" % m[0] if m else "-", "%.1f" % m[1] if m else "-", "%.1f" % m[2] if m else "-"])
        summ.append((labels[j], "%s%d" % (pep[j - 1], j), nm, ns))
    with open(os.path.join(d, "annotation.tsv"), "w") as f:
        f.write("candidate\tion\tcharge\ttheo_mz\tshift_state\tdiffers_between_candidates\tmatched_mz\tppm\tintensity\n")
        for r in sorted(ann, key=lambda r: (r[0], r[1][0], int(r[1][1:]), r[2])): f.write("\t".join(str(x) for x in r) + "\n")
    info = dict(item=item, precursor_mz=round(pmz, 5), precursor_charge=pz, peptide=pep,
                fixed_modification="Carbamidomethyl (C) on every C", shift_da=round(delta, 6),
                candidates=[dict(label=l, residue=r, matched_by_ions=nm, matched_shifted_ions=ns) for l, r, nm, ns in sorted(summ)],
                tolerance_ppm=TOL_PPM, ions="b and y, 1+ and 2+ (OpenMS TheoreticalSpectrumGenerator, no losses)")
    json.dump(info, open(os.path.join(d, "item.json"), "w"), indent=1)
    fig, axes = plt.subplots(len(cands), 1, figsize=(11, 2.6 * len(cands)), sharex=True, squeeze=False)
    top = max(ints) if len(ints) else 1.0
    for ax, j in zip(axes[:, 0], sorted(cands, key=lambda j: labels[j])):
        ax.vlines(mzs, 0, ints / top * 100, color="0.7", lw=0.6)
        for t, n, z, mz0 in ions:
            sh = carries(t, n, j); x = mz0 + (delta / z if sh else 0.0); m = match(mzs, ints, x)
            if not m: continue
            col = ("#1f5fbf" if t == "b" else "#c0392b") if not sh else ("#00a0a0" if t == "b" else "#e67e22")
            ax.vlines([m[0]], 0, [m[2] / top * 100], color=col, lw=1.4)
            ax.text(m[0], m[2] / top * 100 + 2, "%s%d%s%s" % (t, n, "+" * z, "*" if sh else ""), fontsize=6, ha="center", color=col)
        shown = "".join(("%s[%+.3f]" % (a, delta) if i + 1 == j else a) for i, a in enumerate(pep))
        ax.set_title("%s  candidate %s: %s   (* = ion carries the shift)" % (item, labels[j], shown), fontsize=8, loc="left")
        ax.set_ylabel("rel. int."); ax.set_ylim(0, 115)
    axes[-1, 0].set_xlabel("m/z   precursor %.4f, %d+" % (pmz, pz))
    fig.tight_layout(); fig.savefig(os.path.join(d, "annotated.png"), dpi=110); plt.close(fig)
    template.append([item, "%.4f" % delta, pep, ";".join("%s=%s" % (l, r) for l, r, _, _ in sorted(summ)), "", "", "", "", "", "", ""])
    keyrows.append([item, c["stratum"], c["run"], c["scan"], c["spectrum"], c["site"], c["site_pos"], labels.get(int(c["site_pos"]), "-"),
                    c["localized"], c["region"], c["msf_peptide"], c["msf_massdiff"], c["msf_best_locs"]])

with open(os.path.join(PK, "handcheck.tsv"), "w") as f:
    f.write("\t".join(["item", "shift_da", "peptide", "candidates", "a_explains (>=6 b/y, major peaks)",
                       "b_supported_candidates", "ions_cited", "checker", "second_checker", "notes", "verdict"]) + "\n")
    for r in template: f.write("\t".join(r) + "\n")
os.makedirs(os.path.dirname(os.path.abspath(KEY)), exist_ok=True)
with open(KEY, "w") as f:
    f.write("\t".join(["item", "stratum", "run", "scan", "spectrum", "fastag_site", "fastag_site_pos", "fastag_candidate_label",
                       "fastag_localized", "region", "msf_peptide", "msf_massdiff", "msf_best_locs"]) + "\n")
    for r in keyrows: f.write("\t".join(str(x) for x in r) + "\n")
print(len(template), "items ->", PK)
