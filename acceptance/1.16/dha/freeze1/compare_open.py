#!/usr/bin/env python3
"""FASTag -delta_spectra_out vs an MSFragger open search, spectrum by spectrum.

usage: compare_open.py <msfragger dir with <run>.tsv> <fastag dir with <run>.spectra.tsv> <out prefix>

MSFragger: top-1 PSM per spectrum; decoy = every protein of the
'proteins' column (';'-separated) starts with rev_; per-run target-decoy competition on
expectscore (lower is better), FDR = decoys / targets at or below a score,
q-value = running minimum from the worst score up; targets with q <= 0.01
are kept. The join key is the scan number (MSFragger scannum = the 'scan='
of the native ID). A shift agrees when |FASTag delta - MSFragger massdiff|
<= 0.01 Da. A site agrees when the peptides agree (I/L folded) and FASTag's
1-based site_pos is among MSFragger's localized positions (lower-case
residues of best_locs).
"""
import collections, csv, glob, math, os, re, sys

msf_dir, fa_dir, out = sys.argv[1:4]
TOL = 0.01
# name, mass, residues the site is expected on ('' = no site check)
WATCH = [("Deamidated", 0.984016, "NQ"), ("Oxidation", 15.994915, "MW"), ("Cation:Na", 21.981943, "DE"),
         ("Dioxidation", 31.989829, "W"), ("Methyl@C (vs CAM)", 14.01565 - 57.021464, "C"),
         ("Acetyl", 42.010565, "K"), ("Carbamyl", 43.005814, "K"), ("Dehydrated (Dha/Dhb)", -18.010565, "ST"),
         ("Cys->Dha (vs CAM)", -33.987721 - 57.021464, "C"), ("Cys->Dha", -33.987721, "C"),
         ("13C+1", 1.0033548, ""), ("Carbamidomethyl extra", 57.021464, "")]

def fold(p): return p.replace("I", "L")

def msf_run(path):
    rows = list(csv.DictReader(open(path), delimiter="\t"))
    best = {}
    for r in rows:
        s = int(r["scannum"])
        if s not in best or float(r["expectscore"]) < float(best[s]["expectscore"]): best[s] = r
    psms = []
    for s, r in best.items():
        field = r.get("proteins", r.get("protein", "")) + ";" + r.get("alternative_proteins", "")
        prots = [p.strip() for p in field.replace(",", ";").split(";") if p.strip()]
        decoy = all(p.strip().startswith("rev_") for p in prots)
        psms.append((float(r["expectscore"]), decoy, s, r))
    psms.sort(key=lambda x: x[0])
    t = d = 0; fdr = []
    for e, decoy, s, r in psms:
        if decoy: d += 1
        else: t += 1
        fdr.append(d / max(t, 1))
    q = [0.0] * len(fdr); m = math.inf
    for i in range(len(fdr) - 1, -1, -1):
        m = min(m, fdr[i]); q[i] = m
    kept = {s: r for (e, decoy, s, r), qq in zip(psms, q) if qq <= 0.01 and not decoy}
    return kept, len(psms), sum(1 for x in psms if x[1])

def fa_run(path):
    out = {}
    for r in csv.DictReader(open(path), delimiter="\t"):
        m = re.search(r"scan=(\d+)", r["spectrum"])
        if m: out[int(m.group(1))] = r
    return out

def locs(r):
    b = r.get("best_locs", "") or ""
    return {i + 1 for i, c in enumerate(b) if c.islower()} if b else set()

runs = sorted(os.path.basename(f)[:-len(".spectra.tsv")] for f in glob.glob(os.path.join(fa_dir, "*.spectra.tsv")))
stat = collections.Counter(); per_run = []; joined = []
for run in runs:
    kept, n_psm, n_dec = msf_run(os.path.join(msf_dir, run + ".tsv"))
    fa = fa_run(os.path.join(fa_dir, run + ".spectra.tsv"))
    both = sorted(set(kept) & set(fa))
    per_run.append((run, n_psm, n_dec, len(kept), len(fa), len(both)))
    for s in both:
        joined.append((run, s, fa[s], kept[s]))

def near(x, w): return abs(x - w) <= TOL
lines = []
P = lambda *a: lines.append("\t".join(str(x) for x in a))
P("run", "msf_top1", "msf_decoys", "msf_targets_q01", "fastag_samples", "joined")
for x in per_run: P(*x)
tot = len(joined)
same_pep = sum(1 for _, _, f, m in joined if fold(f["peptide"]) == fold(m["peptide"]))
agree_all = sum(1 for _, _, f, m in joined if near(float(f["delta"]), float(m["massdiff"])))
gap_j = [(f, m) for _, _, f, m in joined if f["interp"] != "-"]
P(); P("joined", tot); P("same_peptide", same_pep, "%.3f" % (same_pep / max(tot, 1)))
P("shift_agrees_all", agree_all, "%.3f" % (agree_all / max(tot, 1)))
P("fastag_gap_joined", len(gap_j), "shift_agrees", sum(1 for f, m in gap_j if near(float(f["delta"]), float(m["massdiff"]))))
P()
P("shift", "mass", "fastag_n", "fastag_joined", "msf_agrees", "precision", "same_pep", "msf_n", "fastag_agrees", "recall",
  "fa_localized_both", "site_checked", "site_agrees", "site_agreement", "fa_on_expected_res", "msf_on_expected_res")
detail = []
for name, w, res in WATCH:
    fa_w = [(run, s, f, m) for run, s, f, m in joined if near(float(f["delta"]), w)]
    ms_w = [(run, s, f, m) for run, s, f, m in joined if near(float(m["massdiff"]), w)]
    fa_n = 0
    for run in runs:
        fa = fa_run(os.path.join(fa_dir, run + ".spectra.tsv"))
        fa_n += sum(1 for r in fa.values() if near(float(r["delta"]), w))
    agree = [x for x in fa_w if near(float(x[3]["massdiff"]), w)]
    sp = [x for x in agree if fold(x[2]["peptide"]) == fold(x[3]["peptide"])]
    rec = [x for x in ms_w if near(float(x[2]["delta"]), w)]
    loc_both = [x for x in sp if x[2]["localized"] != "-" and x[2]["site_pos"] != "-"]
    checked = [x for x in loc_both if locs(x[3])]
    site_ok = [x for x in checked if int(x[2]["site_pos"]) in locs(x[3])]
    fa_exp = sum(1 for x in loc_both if res and x[2]["site"] in res)
    ms_exp = sum(1 for x in checked if res and any(x[3]["peptide"][i - 1] in res for i in locs(x[3])))
    P(name, "%.4f" % w, fa_n, len(fa_w), len(agree), "%.3f" % (len(agree) / len(fa_w)) if fa_w else "-", len(sp),
      len(ms_w), len(rec), "%.3f" % (len(rec) / len(ms_w)) if ms_w else "-",
      len(loc_both), len(checked), len(site_ok), "%.3f" % (len(site_ok) / len(checked)) if checked else "-",
      fa_exp if res else "-", ms_exp if res else "-")
    for run, s, f, m in fa_w + [x for x in ms_w if x not in fa_w]:
        detail.append((name, run, s, f["delta"], f["peptide"], f["site"], f["site_pos"], f["localized"], f["interp"],
                       m["massdiff"], m["peptide"], m.get("best_locs", ""), m["expectscore"]))
open(out + "summary.tsv", "w").write("\n".join(lines) + "\n")
with open(out + "watch_spectra.tsv", "w") as f:
    f.write("\t".join(["shift", "run", "scan", "fa_delta", "fa_peptide", "fa_site", "fa_site_pos", "fa_localized",
                       "fa_interp", "msf_massdiff", "msf_peptide", "msf_best_locs", "msf_expect"]) + "\n")
    for d in detail: f.write("\t".join(str(x) for x in d) + "\n")
# where MSFragger puts FASTag's top rows' spectra (largest disagreement classes)
print("\n".join(lines))
