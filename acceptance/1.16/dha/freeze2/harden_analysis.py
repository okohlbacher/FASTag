#!/usr/bin/env python3
"""Steps 2-4 of REVIEW-path-2026-11-18 on the six PXD045734 donor-4068 dev runs.

usage: harden_analysis.py <item1-dev3 dir> <item1-opensearch dir> <b1 dir> <item1-dev2/run dir> <out dir>

Reads the arms item1_dev3.sh writes (main, t1, compat, consensus, count,
unique, blind, entrap, iso01), the MSFragger 4.4.1 open search (top-1 PSM,
per-run target-decoy q <= 0.01 on expectscore, as compare_open.py) and the
1.15.0 baseline. Writes TSV tables to <out dir> and prints a summary.
Development runs only.
"""
import collections, csv, glob, hashlib, math, os, re, sys

D3, MSF, B1, DEV2, OUT = sys.argv[1:6]
os.makedirs(OUT, exist_ok=True)
csv.field_size_limit(1 << 30)
RUNS = ["ah_4068_ZW_032115_%s_%s_57yo" % (a, b) for a in ("UIF", "USF", "WSF") for b in ("IC", "N")]
TOL = 0.01    # shift agreement (as OPENSEARCH-DEV.md)
SHIFT = 0.05  # a shift at all: MSFragger's uncalibrated massdiff of an unmodified peptide reaches 0.01-0.04 Da
WATCH = [("Deamidated", 0.984016, "NQ"), ("13C+1", 1.0033548, ""), ("Oxidation", 15.994915, "MW"),
         ("Cation:Na", 21.981943, "DE"), ("Dioxidation", 31.989829, "W"), ("Methyl@C (vs CAM)", 14.01565 - 57.021464, "C"),
         ("Acetyl", 42.010565, "K"), ("Carbamyl", 43.005814, "K"), ("Carbamidomethyl extra", 57.021464, ""),
         ("Dehydrated", -18.010565, "ST"), ("Cys->Dha (vs CAM)", -33.987721 - 57.021464, "C"),
         ("Unalkylated Cys", -57.021464, "C"), ("Arg extension", 156.101111, "")]

def fold(p): return p.replace("I", "L")
def base(tag): return fold(re.sub(r"\[[^\]]*\]", "", tag))
def wilson(k, n, z=1.96):
    if n == 0: return (float("nan"), float("nan"))
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)
def binom_cdf(k, n, p):
    if k < 0: return 0.0
    if k >= n: return 1.0
    lg = lambda a: math.lgamma(a + 1)
    return sum(math.exp(lg(n) - lg(i) - lg(n - i) + (i * math.log(p) if p > 0 else (0 if i == 0 else -1e300))
                        + ((n - i) * math.log(1 - p) if p < 1 else (0 if i == n else -1e300))) for i in range(0, k + 1))
def cp(k, n, a=0.05):
    # Clopper-Pearson exact interval by bisection on the binomial CDF.
    if n == 0: return (float("nan"), float("nan"))
    def solve(f):
        lo, hi = 0.0, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if f(mid): hi = mid
            else: lo = mid
        return (lo + hi) / 2
    lower = 0.0 if k == 0 else solve(lambda p: 1 - binom_cdf(k - 1, n, p) >= a / 2)
    upper = 1.0 if k == n else solve(lambda p: binom_cdf(k, n, p) <= a / 2)
    return (lower, upper)
def fmt_cp(k, n):
    if n == 0: return "-"
    lo, hi = cp(k, n); return "%d/%d = %.3f [%.3f, %.3f]" % (k, n, k / n, lo, hi)
def fmt_ci(k, n):
    if n == 0: return "-"
    lo, hi = wilson(k, n); return "%.3f [%.3f, %.3f]" % (k / n, lo, hi)
def write(name, header, rows):
    with open(os.path.join(OUT, name), "w") as f:
        f.write("\t".join(header) + "\n")
        for r in rows: f.write("\t".join(str(x) for x in r) + "\n")
def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()
def scan(native):
    m = re.search(r"scan=(\d+)", native); return int(m.group(1)) if m else None

def msf_run(path):
    best = {}
    for r in csv.DictReader(open(path), delimiter="\t"):
        s = int(r["scannum"])
        if s not in best or float(r["expectscore"]) < float(best[s]["expectscore"]): best[s] = r
    psms = []
    for s, r in best.items():
        field = r.get("proteins", "") + ";" + r.get("alternative_proteins", "")
        prots = [p.strip() for p in field.replace(",", ";").split(";") if p.strip()]
        psms.append((float(r["expectscore"]), all(p.startswith("rev_") for p in prots), s, r))
    psms.sort(key=lambda x: x[0])
    t = d = 0; fdr = []
    for e, dec, s, r in psms:
        if dec: d += 1
        else: t += 1
        fdr.append(d / max(t, 1))
    q = [0.0] * len(fdr); m = math.inf
    for i in range(len(fdr) - 1, -1, -1):
        m = min(m, fdr[i]); q[i] = m
    return {s: r for (e, dec, s, r), qq in zip(psms, q) if qq <= 0.01 and not dec}
def msf_locs(r):
    b = r.get("best_locs", "") or ""
    return {i + 1 for i, c in enumerate(b) if c.islower()}

def spectra(arm, run):
    out = {}
    p = os.path.join(D3, arm, run + ".spectra.tsv")
    if not os.path.exists(p): return out
    for r in csv.DictReader(open(p), delimiter="\t"):
        out[scan(r["spectrum"])] = r
    return out
def counts(arm, run):
    p = os.path.join(D3, arm, run + ".counts.tsv")
    return {r["key"]: r["value"] for r in csv.DictReader(open(p), delimiter="\t")} if os.path.exists(p) else {}
def delta_rows(path):
    return list(csv.DictReader(open(path), delimiter="\t")) if os.path.exists(path) else []

summary = []
P = lambda *a: summary.append(" ".join(str(x) for x in a))

# ---------------- step 2a: reconciliation ----------------
KEYS = ["ms2_read", "ms2_tagged", "ms2_placed", "clamped_excluded", "samples", "samples_exact", "samples_gap_region",
        "samples_gap_terminal", "gap_fragment_localized", "gap_sequence_constrained", "gap_ambiguous", "gap_unlocalized",
        "gap_precursor_flank", "samples_charge_assumed", "samples_exact_vs_gapped", "gaps_in_zero_bin", "rows", "rows_spectra_sum"]
rec_rows = []; tot = collections.Counter(); checks_ok = True
for run in RUNS:
    c = counts("main", run)
    b1 = sum(int(r["spectra"]) for r in delta_rows(os.path.join(B1, run + ".delta.tsv")))
    rec_rows.append([run] + [c.get(k, "-") for k in KEYS] + [b1])
    for k in KEYS: tot[k] += int(c.get(k, 0))
    tot["b1_rows_sum"] += b1
    checks_ok &= all(v == "ok" for k, v in c.items() if k.startswith("check_"))
rec_rows.append(["total"] + [tot[k] for k in KEYS] + [tot["b1_rows_sum"]])
write("reconciliation.tsv", ["run"] + KEYS + ["b1_1.15.0_rows_sum"], rec_rows)
P("reconciliation: all checks ok =", checks_ok, "; totals", dict((k, tot[k]) for k in KEYS), "b1 rows", tot["b1_rows_sum"])

# The 28,803 / 28,524 explanation: 1.15 local-max rule per run, then again on the pooled histogram.
def legacy(counts_by_bin):
    absorbed, kept = set(), 0
    for k in sorted(counts_by_bin):
        if k in absorbed: continue
        nl, nh = counts_by_bin.get(k - 1, 0), counts_by_bin.get(k + 1, 0)
        c = counts_by_bin[k]
        if c < nl or c < nh: continue
        kept += c
        for nb in (k - 1, k + 1):
            if nb in counts_by_bin and counts_by_bin[nb] < c and nb not in absorbed:
                kept += counts_by_bin[nb]; absorbed.add(nb)
    return kept
pooled_rows = collections.Counter(); per_run_legacy = 0; samples_all = 0
for run in RUNS:
    bins = collections.Counter()
    for r in spectra("main", run).values():
        x = float(r["delta_full"]) / 0.0005  # C++ llround: half away from zero
        bins[int(math.floor(x + 0.5)) if x >= 0 else -int(math.floor(-x + 0.5))] += 1
    samples_all += sum(bins.values())
    per_run_legacy += legacy(bins)
for run in RUNS:
    for r in delta_rows(os.path.join(B1, run + ".delta.tsv")):
        pooled_rows[round(float(r["delta"]) / 0.0005)] += int(r["spectra"])
pooled_legacy = legacy(pooled_rows)
write("discrepancy.tsv", ["quantity", "spectra"], [
    ["sampled (log 'Delta histogram', every build)", samples_all],
    ["1.15 local-max rows, per run, summed (1.15.0 = a66ad9d9 = -delta_group 0)", per_run_legacy],
    ["b1 1.15.0 -delta_out rows summed", tot["b1_rows_sum"]],
    ["1.15 rule applied again to the pooled per-run rows (pool.py, a66ad9d9 RESULT)", pooled_legacy],
    ["lost per run", samples_all - per_run_legacy], ["lost again in pooling", per_run_legacy - pooled_legacy],
    ["1.16 -delta_group rows summed (59492fa2 and later)", tot["rows_spectra_sum"]]])
P("discrepancy: sampled", samples_all, "per-run 1.15 rows", per_run_legacy, "pooled 1.15 rows", pooled_legacy)

# ---------------- determinism and compat ----------------
det = []
for run in RUNS:
    for ext in ("delta.tsv", "spectra.tsv", "counts.tsv"):
        a, b = os.path.join(D3, "main", run + "." + ext), os.path.join(D3, "t1", run + "." + ext)
        det.append([run, ext, "identical" if os.path.exists(b) and md5(a) == md5(b) else "DIFF"])
comp = []
def cut(path, n):
    return [("\t".join(l.rstrip("\n").split("\t")[:n])) for l in open(path)]
for run in RUNS:
    a = os.path.join(D3, "compat", run + ".delta.tsv"); b = os.path.join(DEV2, run + ".delta.tsv")
    comp.append([run, "delta cols 1-9", "identical" if cut(a, 9) == cut(b, 9) else "DIFF"])
    a = os.path.join(D3, "compat", run + ".spectra.tsv"); b = os.path.join(DEV2, run + ".spectra.tsv")
    comp.append([run, "spectra cols 1-10", "identical" if cut(a, 10) == cut(b, 10) else "DIFF"])
write("determinism.tsv", ["run", "file", "32 vs 1 thread"], det)
write("compat.tsv", ["run", "what", "vs 59492fa2"], comp)
P("determinism:", collections.Counter(x[2] for x in det), "compat:", collections.Counter(x[2] for x in comp))

# ---------------- MSFragger join ----------------
msf = {run: msf_run(os.path.join(MSF, run + ".tsv")) for run in RUNS}
P("msfragger PSMs q<=0.01:", sum(len(v) for v in msf.values()))
def shifted(m): return abs(float(m["massdiff"])) > SHIFT

# ---------------- step 2b: loss funnel ----------------
fun = collections.Counter(); fun_w = collections.defaultdict(collections.Counter)
for run in RUNS:
    tags = collections.defaultdict(set)
    for r in csv.DictReader(open(os.path.join(D3, "main", run + ".tags.tsv")), delimiter="\t"):
        tags[scan(r["spectrum"])].add(base(r["tag"]))
    rec = collections.defaultdict(list)
    for r in csv.DictReader(open(os.path.join(D3, "main", run + ".recon.tsv")), delimiter="\t"):
        rec[scan(r["spectrum"])].append((fold(r["peptide"]), float(r["delta_mass"])))
    sp = spectra("main", run)
    for s, m in msf[run].items():
        if not shifted(m): continue
        md = float(m["massdiff"]); mp = fold(m["peptide"])
        w = [n for n, x, _ in WATCH if abs(md - x) <= TOL]
        st = []
        st.append("psm")
        if s in tags: st.append("tagged")
        if any(t in mp or t[::-1] in mp for t in tags.get(s, ())): st.append("tag_in_peptide")
        if any(p == mp for p, d in rec.get(s, ())): st.append("placed_on_peptide")
        if any(p == mp and abs(d - md) <= 0.02 for p, d in rec.get(s, ())): st.append("placed_with_shift")
        f = sp.get(s)
        if f is not None: st.append("sampled")
        if f is not None and fold(f["peptide"]) == mp and abs(float(f["delta"]) - md) <= TOL: st.append("selected")
        if "selected" in st and f["loc_class"] in ("fragment", "sequence"): st.append("localized")
        if "localized" in st and msf_locs(m):
            st.append("site_checkable")
            if f["site_pos"] != "-" and int(f["site_pos"]) in msf_locs(m): st.append("site_agrees")
        if int(m.get("num_missed_cleavages", 0) or 0) > 1: st.append("msf_mc2")
        for x in st:
            fun[x] += 1
            for n in w: fun_w[n][x] += 1
STAGES = ["psm", "tagged", "tag_in_peptide", "placed_on_peptide", "placed_with_shift", "sampled", "selected", "localized",
          "site_checkable", "site_agrees", "msf_mc2"]
write("funnel.tsv", ["shift"] + STAGES, [["all shifted"] + [fun[x] for x in STAGES]] +
      [[n] + [fun_w[n][x] for x in STAGES] for n, _, _ in WATCH])
P("funnel (all MSF-shifted PSMs):", [(x, fun[x]) for x in STAGES])

# ---------------- step 2c: selection rules ----------------
def eval_rule(arm, keep=lambda f: True):
    c = collections.Counter(); w = collections.defaultdict(collections.Counter)
    for run in RUNS:
        sp = spectra(arm, run)
        for s, f in sp.items():
            if not keep(f): continue
            m = msf[run].get(s)
            if m is None: continue
            fd, md = float(f["delta"]), float(m["massdiff"]); same = fold(f["peptide"]) == fold(m["peptide"])
            fg = abs(fd) > SHIFT; mg = abs(md) > SHIFT
            c["joined"] += 1; c["agree"] += abs(fd - md) <= TOL; c["same_pep"] += same
            c["fa_gap"] += fg; c["fa_gap_agree"] += fg and abs(fd - md) <= TOL
            c["false_shift"] += fg and not mg; c["msf_gap"] += mg
            c["msf_gap_found"] += mg and abs(fd - md) <= TOL; c["missed_shift"] += mg and not fg
            for n, x, _ in WATCH:
                if abs(fd - x) <= TOL: w[n]["fa"] += 1; w[n]["fa_ok"] += abs(md - x) <= TOL
                if abs(md - x) <= TOL: w[n]["ms"] += 1; w[n]["ms_ok"] += abs(fd - x) <= TOL
    return c, w
def nested(a, b): return a in b or b in a
def homolog_rivals(f):
    # The selected tag's gapped placements on a peptide that is not the
    # exact one's longer or shorter window (a homolog or another protein).
    if abs(float(f["delta"])) > 1e-6 or f["placements"] == "-": return []
    ex = fold(f["peptide"]); out = []
    for p in f["placements"].split(";"):
        parts = p.split("|")
        pep, d = fold(parts[-4]), float(parts[-1])
        if abs(d) > 1e-6 and not nested(pep, ex): out.append((pep, d))
    return out
def eval_alt(mode):
    c = collections.Counter(); w = collections.defaultdict(collections.Counter)
    for run in RUNS:
        for s, f in spectra("main", run).items():
            m = msf[run].get(s)
            if m is None: continue
            riv = homolog_rivals(f)
            pep, fd = fold(f["peptide"]), float(f["delta"])
            if riv and mode == "prefer_gapped":
                pep, fd = min(riv, key=lambda x: abs(x[1]))
            if riv and mode == "ambiguous": c["flagged"] += 1; continue
            md = float(m["massdiff"]); fg = abs(fd) > SHIFT; mg = abs(md) > SHIFT
            c["joined"] += 1; c["agree"] += abs(fd - md) <= TOL; c["same_pep"] += pep == fold(m["peptide"])
            c["fa_gap"] += fg; c["fa_gap_agree"] += fg and abs(fd - md) <= TOL
            c["false_shift"] += fg and not mg; c["msf_gap"] += mg
            c["msf_gap_found"] += mg and abs(fd - md) <= TOL; c["missed_shift"] += mg and not fg
    return c
rules = [("min_delta (1.15, default)", "main", lambda f: True),
         ("consensus", "consensus", lambda f: True),
         ("min_delta, blind arm (no variable mods)", "blind", lambda f: True),
         ("min_delta, exact-vs-gapped reported as ambiguous", "main", lambda f: f["n_exact"] == "0" or f["n_gapped"] == "0")]
sel_rows = []; sel_w = []
for name, arm, keep in rules:
    c, w = eval_rule(arm, keep)
    sel_rows.append([name, c["joined"], fmt_ci(c["agree"], c["joined"]), fmt_ci(c["same_pep"], c["joined"]),
                     c["fa_gap"], fmt_ci(c["fa_gap_agree"], c["fa_gap"]), fmt_ci(c["false_shift"], c["fa_gap"]),
                     c["msf_gap"], fmt_ci(c["msf_gap_found"], c["msf_gap"]), fmt_ci(c["missed_shift"], c["msf_gap"])])
    for n, _, _ in WATCH:
        sel_w.append([name, n, w[n]["fa"], fmt_ci(w[n]["fa_ok"], w[n]["fa"]), w[n]["ms"], fmt_ci(w[n]["ms_ok"], w[n]["ms"])])
for name, mode in (("min_delta, homolog rival preferred (gapped beats exact on another peptide)", "prefer_gapped"),
                   ("min_delta, exact with a homolog gapped rival reported as ambiguous", "ambiguous")):
    c = eval_alt(mode)
    sel_rows.append([name + (" [%d flagged]" % c["flagged"] if c["flagged"] else ""), c["joined"],
                     fmt_ci(c["agree"], c["joined"]), fmt_ci(c["same_pep"], c["joined"]),
                     c["fa_gap"], fmt_ci(c["fa_gap_agree"], c["fa_gap"]), fmt_ci(c["false_shift"], c["fa_gap"]),
                     c["msf_gap"], fmt_ci(c["msf_gap_found"], c["msf_gap"]), fmt_ci(c["missed_shift"], c["msf_gap"])])
# Where the missed shifts (MSFragger shifted, FASTag exact) come from.
miss = collections.Counter()
for run in RUNS:
    for s, f in spectra("main", run).items():
        m = msf[run].get(s)
        if m is None or abs(float(m["massdiff"])) <= SHIFT or abs(float(f["delta"])) > SHIFT: continue
        miss["missed"] += 1
        miss["selected_tag_carries_variable_mod"] += "[" in f["tag"]
        same = fold(f["peptide"]) == fold(m["peptide"])
        miss["exact_on_msf_peptide"] += same
        rivals = [p.split("|") for p in f["placements"].split(";")] if f["placements"] != "-" else []
        right = any(fold(r[-4]) == fold(m["peptide"]) and abs(float(r[-1]) - float(m["massdiff"])) <= 0.02 for r in rivals)
        miss["right_placement_among_selected_tags"] += right
        miss["has_homolog_rival"] += bool(homolog_rivals(f))
write("missed_shifts.tsv", ["what", "spectra"], sorted(miss.items()))
P("missed shifts:", dict(miss))
# Agreement by charge source.
byc = collections.defaultdict(collections.Counter)
for run in RUNS:
    for s, f in spectra("main", run).items():
        m = msf[run].get(s); cs = f["charge_source"]
        byc[cs]["samples"] += 1; byc[cs]["gapped"] += abs(float(f["delta"])) > SHIFT
        if m is None: continue
        fd, md = float(f["delta"]), float(m["massdiff"])
        byc[cs]["joined"] += 1; byc[cs]["agree"] += abs(fd - md) <= TOL
        byc[cs]["same_pep"] += fold(f["peptide"]) == fold(m["peptide"])
        if abs(fd) > SHIFT: byc[cs]["gap_joined"] += 1; byc[cs]["gap_agree"] += abs(fd - md) <= TOL
write("charge_strata.tsv", ["charge_source", "samples", "gapped", "joined", "shift_agreement", "same_peptide", "gap_precision"],
      [[k, v["samples"], v["gapped"], v["joined"], fmt_ci(v["agree"], v["joined"]), fmt_ci(v["same_pep"], v["joined"]),
        fmt_ci(v["gap_agree"], v["gap_joined"])] for k, v in sorted(byc.items())])
for k, v in sorted(byc.items()): P("charge stratum:", k, dict(v))
write("selection.tsv", ["rule", "joined", "shift_agreement", "same_peptide", "fastag_gaps", "gap_precision", "false_shift_rate",
                        "msf_shifted", "shift_recall", "missed_shift_rate"], sel_rows)
write("selection_watch.tsv", ["rule", "shift", "fastag_n", "precision", "msf_n", "recall"], sel_w)
for r in sel_rows: P("selection:", r)
# ambiguity: how often the selected tag's placements compete
amb = collections.Counter()
for run in RUNS:
    for f in spectra("main", run).values():
        amb["samples"] += 1
        ne, ng = int(f["n_exact"]), int(f["n_gapped"])
        amb["exact_vs_gapped"] += ne > 0 and ng > 0
        amb["several_peptides"] += int(f["n_peptides"]) > 1
        amb["selected_exact_with_gapped_rival"] += abs(float(f["delta"])) <= 1e-6 and ng > 0
write("ambiguity.tsv", ["what", "spectra"], sorted(amb.items()))
P("ambiguity:", dict(amb))

# ---------------- step 3: localization curve with null ----------------
def loc_curve(arm):
    rows = []
    real = collections.Counter(); null = collections.Counter(); n_alt = 0
    prec = collections.defaultdict(collections.Counter)
    seqc = collections.Counter()
    for run in RUNS:
        for s, f in spectra(arm, run).items():
            if f["loc_class"] in ("-",): continue
            m = msf[run].get(s)
            ok_join = m is not None and fold(f["peptide"]) == fold(m["peptide"]) and abs(float(f["delta"]) - float(m["massdiff"])) <= TOL and msf_locs(m)
            if f["loc_class"] == "sequence":
                seqc["n"] += 1
                if ok_join: seqc["checked"] += 1; seqc["agree"] += int(f["site_pos"]) in msf_locs(m)
                continue
            n_alt += 1
            ev = int(f["loc_evidence"]); nev = int(f["null_evidence"]) if f["null_class"] != "-" else 0
            for k in range(1, 9):
                real[k] += ev >= k; null[k] += nev >= k
                if ev >= k and ok_join:
                    prec[k]["checked"] += 1; prec[k]["agree"] += int(f["site_pos"]) in msf_locs(m)
    for k in range(1, 9):
        rows.append([arm, k, n_alt, real[k], "%.3f" % (real[k] / max(n_alt, 1)), null[k],
                     "%.3f" % (null[k] / max(real[k], 1)), prec[k]["checked"], fmt_ci(prec[k]["agree"], prec[k]["checked"])])
    return rows, seqc
curve = []; seqs = []
for arm in ("count", "unique", "main"):
    r, sq = loc_curve(arm); curve += r
    seqs.append([arm, sq["n"], sq["checked"], fmt_ci(sq["agree"], sq["checked"])])
write("loc_curve.tsv", ["model(arm)", "min_evidence", "gaps_with_rivals", "fragment_localized", "coverage", "null_localized",
                        "null/real (FLR est.)", "msf_checked", "msf_site_precision [95% CI]"], curve)
write("loc_sequence.tsv", ["arm", "sequence_constrained", "msf_checked", "msf_site_agreement"], seqs)
for r in curve: P("curve:", r)
for r in seqs: P("sequence-constrained:", r)
# -18 / -17 in each model: residues of fragment-localized calls
dehyd = []
for arm in ("count", "unique", "main", "blind"):
    for name, x in (("-18.011", -18.010565), ("-17.027", -17.026549)):
        res = collections.Counter(); n = 0; exc = 0
        for run in RUNS:
            for f in spectra(arm, run).values():
                if abs(float(f["delta"]) - x) > TOL: continue
                n += 1; exc += int(f["loc_excluded"])
                if f["loc_class"] == "fragment": res[f["site"]] += 1
        dehyd.append([arm, name, n, sum(res.values()), ",".join("%s:%d" % kv for kv in res.most_common(6)) or "-", exc])
write("dehydration.tsv", ["arm", "shift", "samples", "fragment_localized", "sites", "satellite_matches_excluded"], dehyd)
for r in dehyd: P("dehydration:", r)

# ---------------- blind and entrapment ----------------
def enrich(arm):
    out = []
    for name, x, res in (("Deamidated", 0.984016, "NQ"), ("Oxidation", 15.994915, "M"), ("Dioxidation", 31.989829, "W")):
        n = loc = on = 0
        for run in RUNS:
            for f in spectra(arm, run).values():
                if abs(float(f["delta"]) - x) > TOL: continue
                n += 1
                if f["loc_class"] in ("fragment", "sequence"):
                    loc += 1; on += f["site"][-1:] in res
        out.append([arm, name, n, loc, on, fmt_ci(on, loc)])
    return out
bl = enrich("main") + enrich("blind")
write("blind.tsv", ["arm", "shift", "samples(+-0.01)", "localized", "on_expected_residue", "share [95% CI]"], bl)
for r in bl: P("blind:", r)
ent = collections.Counter(); ent_rows = []
for run in RUNS:
    sp = spectra("entrap", run)
    for f in sp.values():
        e = f["protein"].startswith("ENTRAP_")
        gap = abs(float(f["delta"])) > 1e-6
        ent["samples"] += 1; ent["samples_entrap"] += e
        ent["gapped"] += gap; ent["gapped_entrap"] += gap and e
        fl = f["loc_class"] in ("fragment", "sequence")
        ent["localized"] += fl; ent["localized_entrap"] += fl and e
        ent["exact"] += not gap; ent["exact_entrap"] += (not gap) and e
    # named localized rows: the share of their localized spectra from entrapment placements
    byrow = collections.defaultdict(collections.Counter)
    for f in sp.values():
        if f["row"] == "-": continue
        if f["loc_class"] in ("fragment", "sequence"):
            byrow[f["row"]]["loc"] += 1; byrow[f["row"]]["loc_e"] += f["protein"].startswith("ENTRAP_")
    for r in delta_rows(os.path.join(D3, "entrap", run + ".delta.tsv")):
        if r["unimod"] == "-" or int(r["localized"]) == 0: continue
        b = byrow[r["delta"]]
        ent["named_rows"] += 1; ent["named_rows_loc"] += b["loc"]; ent["named_rows_loc_entrap"] += b["loc_e"]
        ent["named_rows_any_entrap"] += b["loc_e"] > 0
        ent["named_rows_majority_entrap"] += 2 * b["loc_e"] > b["loc"]
        ent_rows.append([run, r["delta"], r["spectra"], r["localized"], b["loc_e"], r["unimod"].split(";")[0]])
write("entrapment.tsv", ["what", "n"], sorted(ent.items()))
ent_rows.sort(key=lambda x: -int(x[3]))
write("entrapment_named_rows.tsv", ["run", "delta", "spectra", "localized", "localized_from_entrapment", "first_unimod"], ent_rows)
P("entrapment:", dict(ent))

# ---------------- step 4: isotope flank, charge, classes ----------------
iso = []
for arm in ("main", "iso01"):
    for name, x in (("+0.984", 0.984016), ("+1.003", 1.0033548), ("+2.007", 2.0067096)):
        n = pf = 0; cls = collections.Counter()
        for run in RUNS:
            for f in spectra(arm, run).values():
                if abs(float(f["delta"]) - x) > 0.005: continue
                n += 1; pf += f["flank"] == "precursor"; cls[f["obs_class"]] += 1
        iso.append([arm, name, n, pf, "%.3f" % (pf / max(n, 1)), ",".join("%s:%d" % kv for kv in cls.most_common(4))])
k1 = collections.Counter()
for run in RUNS:
    for f in spectra("iso01", run).values(): k1[f["precursor_isotope"]] += 1
P("iso01 selected precursor isotope k:", dict(k1))
iso.append(["iso01", "selected hypothesis k (all samples)", sum(k1.values()), "-", "-", ",".join("k=%s:%d" % kv for kv in sorted(k1.items()))])
write("isotope_flank.tsv", ["arm", "shift(+-5mDa)", "samples", "precursor_flank", "share", "obs_classes"], iso)
for r in iso: P("isotope:", r)
chg = collections.Counter()
for run in RUNS:
    for f in spectra("main", run).values():
        chg[(f["charge_source"], f["charge"])] += 1
write("charge.tsv", ["charge_source", "charge", "samples"], [[a, b, n] for (a, b), n in sorted(chg.items())])
P("charge:", dict(chg))
cls = collections.Counter()
for run in RUNS:
    for f in spectra("main", run).values():
        if abs(float(f["delta"])) > 1e-6: cls[f["obs_class"]] += 1
write("classes.tsv", ["obs_class", "gapped samples"], cls.most_common())
P("classes:", dict(cls))

# pooled rows (the -delta_group rule at 4 mDa on the pooled per-spectrum deltas)
bins = collections.defaultdict(list)
for run in RUNS:
    for f in spectra("main", run).values():
        f["_run"] = run; bins[round(float(f["delta"]) / 0.0005)].append(f)
order = sorted(bins, key=lambda k: (-len(bins[k]), k)); taken = set(); prow = []
per_run_rows = {run: delta_rows(os.path.join(D3, "main", run + ".delta.tsv")) for run in RUNS}
for k in order:
    if k in taken: continue
    mem = [b for b in range(k - 8, k + 9) if b in bins and b not in taken]
    taken.update(mem)
    fs = [f for b in mem for f in bins[b]]
    nz = [f for f in fs if abs(float(f["delta"])) > 1e-6]
    frag = sum(f["loc_class"] == "fragment" for f in fs); seq = sum(f["loc_class"] == "sequence" for f in fs)
    amb_ = sum(f["loc_class"] == "ambiguous" for f in fs)
    sites = collections.Counter(f["site"] for f in fs if f["loc_class"] in ("fragment", "sequence"))
    fsites = collections.Counter(f["site"] for f in fs if f["loc_class"] == "fragment")
    pf = sum(f["flank"] == "precursor" for f in nz); ca = sum(f["charge_source"] == "assumed" for f in fs)
    oc = collections.Counter(f["obs_class"] for f in nz)
    cands = [(int(r["spectra"]), r) for run in RUNS for r in per_run_rows[run] if abs(float(r["delta"]) - k * 0.0005) <= 0.004]
    big = max(cands, key=lambda x: x[0])[1] if cands else {}
    jn = cf = 0
    for f in fs:
        if f["charge_source"] == "assumed": continue
        m = msf[f["_run"]].get(scan(f["spectrum"]))
        if m is None: continue
        jn += 1; cf += abs(float(m["massdiff"]) - k * 0.0005) <= TOL
    prow.append(["%.4f" % (k * 0.0005), len(fs), jn, "%.2f" % (cf / jn) if jn else "-", frag, seq, amb_, ",".join("%s:%d" % kv for kv in fsites.most_common(4)) or "-",
                 ",".join("%s:%d" % kv for kv in sites.most_common(4)) or "-", pf, ca,
                 ",".join("%s:%d" % kv for kv in oc.most_common(3)) or "-",
                 ";".join(big.get("unimod", "-").split(";")[:2]), big.get("isotope_error", "-"), big.get("isobars", "-")])
prow.sort(key=lambda r: -r[1])
write("pooled_rows.tsv", ["delta", "spectra", "msf_joined(charge given)", "msf_confirmed", "fragment_localized", "sequence_constrained", "ambiguous", "fragment_sites",
                          "all_sites", "precursor_flank", "charge_assumed", "obs_classes", "unimod(largest run row)",
                          "isotope_error", "isobars"], prow)
# ---------------- numbers for the proposed amendment ----------------
amd = []
for arm in ("main", "blind"):
    for n_, x, res in WATCH:
        fa = fa_ok = ms = ms_ok = 0
        for run in RUNS:
            for s_, f in spectra(arm, run).items():
                if f["charge_source"] == "assumed": continue
                m = msf[run].get(s_)
                if m is None: continue
                fd, md = float(f["delta"]), float(m["massdiff"])
                if abs(fd - x) <= TOL: fa += 1; fa_ok += abs(md - x) <= TOL
                if abs(md - x) <= TOL: ms += 1; ms_ok += abs(fd - x) <= TOL
        amd.append([arm, n_, "%.4f" % x, fmt_cp(fa_ok, fa), fmt_cp(ms_ok, ms)])
write("amend_watch_cp.tsv", ["arm", "shift", "Da", "precision (charge given)", "recall among joined MSF positives"], amd)
# site precision at the chosen rule, charge given, by arm
sp_rows = []
for arm in ("main", "blind"):
    k_ = n_ = 0
    for run in RUNS:
        for s_, f in spectra(arm, run).items():
            if f["loc_class"] != "fragment" or f["charge_source"] == "assumed": continue
            m = msf[run].get(s_)
            if m is None or not msf_locs(m) or fold(f["peptide"]) != fold(m["peptide"]) or abs(float(f["delta"]) - float(m["massdiff"])) > TOL: continue
            n_ += 1; k_ += int(f["site_pos"]) in msf_locs(m)
    sp_rows.append([arm, fmt_cp(k_, n_)])
write("amend_site_cp.tsv", ["arm", "fragment-localized site agreement with MSFragger (charge given)"], sp_rows)
for r in amd + sp_rows: P("amend:", r)
# S/T enrichment of -18.011 fragment-localized calls against a shuffled-site null
import random as _r
st_rows = []
for arm in ("main", "blind"):
    calls = []
    for run in RUNS:
        for f in spectra(arm, run).values():
            if abs(float(f["delta"]) + 18.010565) > TOL or f["loc_class"] != "fragment": continue
            lo, hi = (int(x) for x in f["region"].split("-"))
            calls.append((f["peptide"][lo - 1:hi], f["site"][-1:]))
    obs = sum(site in "ST" for _, site in calls)
    rng = _r.Random(20261118); null = []
    for _ in range(10000):
        null.append(sum(rng.choice(reg) in "ST" for reg, _ in calls))
    null.sort()
    p = (sum(v >= obs for v in null) + 1) / (len(null) + 1)
    st_rows.append([arm, len(calls), obs, "%.2f" % (sum(null) / len(null)), null[int(0.95 * len(null)) - 1] if null else "-", "%.4f" % p])
write("amend_st_enrichment.tsv", ["arm", "-18.011 fragment-localized calls", "on S/T", "null mean", "null 95th pct", "p (one-sided)"], st_rows)
for r in st_rows: P("S/T enrichment:", r)
open(os.path.join(OUT, "summary.txt"), "w").write("\n".join(summary) + "\n")
print("\n".join(summary))
