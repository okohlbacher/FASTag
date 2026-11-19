#!/usr/bin/env python3
"""PREREG-dha AMENDMENT-2 scoring (G1-G7) with freeze2/harden_analysis.py's logic.

usage: harden_heldout.py <harden_analysis.py> <arm root (blind/ main/ entrap/)> <msfragger dir>
                         <run list> <out dir> [--informed-g7]

The frozen harden_analysis.py is executed up to its first analysis section
(`summary = []`): its constants (WATCH, TOL, SHIFT), the Clopper-Pearson code,
the MSFragger q-value filter (msf_run, msf_locs) and the readers (spectra,
counts, delta_rows) are used unchanged. Its RUNS list (the dev runs) is
replaced by <run list>. The criteria follow AMENDMENT-2 §2-§4; operational
choices the amendment leaves open are those of AMENDMENT-3.
Writes TSV tables and summary.txt to <out dir>, and the G4/G5 call lists
(with sites: NOT for checkers) to <out dir>/calls/.
"""
import collections, csv, hashlib, json, math, os, random, sys

HA, ROOT, MSF, LIST, OUT = sys.argv[1:6]
os.makedirs(OUT, exist_ok=True)
src = open(HA).read().split("summary = []")[0]
ns = {"__name__": "harden_frozen"}
_argv = sys.argv
sys.argv = ["harden_analysis.py", ROOT, MSF, "-", "-", OUT]
exec(compile(src, HA, "exec"), ns)
sys.argv = _argv
cp, fmt_cp, msf_run, msf_locs = ns["cp"], ns["fmt_cp"], ns["msf_run"], ns["msf_locs"]
spectra, counts, delta_rows, fold, scan = ns["spectra"], ns["counts"], ns["delta_rows"], ns["fold"], ns["scan"]
TOL, SHIFT = ns["TOL"], ns["SHIFT"]
ALL_RUNS = [l.strip() for l in open(LIST) if l.strip()]

summary = []
def P(*a):
    summary.append(" ".join(str(x) for x in a)); print(*a, flush=True)
def write(name, header, rows):
    with open(os.path.join(OUT, name), "w") as f:
        f.write("\t".join(header) + "\n")
        for r in rows: f.write("\t".join(str(x) for x in r) + "\n")
def lb(k, n): return cp(k, n)[0] if n else float("nan")

# ---------------- run exclusion (AMENDMENT-2 §2) ----------------
excl = []; RUNS = []
for run in ALL_RUNS:
    bad = {}
    for arm in ("blind", "main", "entrap"):
        c = counts(arm, run)
        if not c: bad[arm] = "no counts file"; continue
        nb = [k for k, v in c.items() if k.startswith("check_") and v != "ok"]
        if nb: bad[arm] = ",".join(nb)
    excl.append([run] + [bad.get(a, "ok") for a in ("blind", "main", "entrap")])
    if "blind" not in bad: RUNS.append(run)
write("run_checks.tsv", ["run", "blind", "main(informed)", "entrap"], excl)
P("runs:", len(ALL_RUNS), "gating runs (blind checks ok):", len(RUNS),
  "excluded:", [r[0] for r in excl if r[1] != "ok"])
INF_RUNS = [r[0] for r in excl if r[2] == "ok"]

msf = {run: msf_run(os.path.join(MSF, run + ".tsv")) for run in ALL_RUNS}
P("msfragger PSMs q<=0.01 (all runs):", sum(len(v) for v in msf.values()))

G1 = [("Oxidation", 15.994915), ("Cation:Na", 21.981943), ("Dioxidation", 31.989829),
      ("Methyl@C (vs CAM)", 14.01565 - 57.021464), ("Acetyl", 42.010565), ("Carbamyl", 43.005814),
      ("Carbamidomethyl extra", 57.021464), ("Unalkylated Cys", -57.021464)]
REPORTED = [("Deamidated", 0.984016), ("13C+1", 1.0033548), ("Dehydrated", -18.010565),
            ("Cys->Dha (vs CAM)", -33.987721 - 57.021464), ("Cys->Dha (unalkylated)", -33.987721),
            ("Arg extension", 156.101111)]
RARE = [("Cys->Dha (vs CAM)", -33.987721 - 57.021464, "C"), ("Cys->Dha (unalkylated)", -33.987721, "C"),
        ("Dehydrated S/T", -18.010565, "ST")]

def given(f): return f["charge_source"] != "assumed"

# ---------------- G1 / G2 (amend_watch_cp logic, per arm) ----------------
def watch(arm, runs, shifts):
    out = []
    for name, x in shifts:
        fa = fa_ok = ms = ms_ok = ms_all = ms_all_found = 0
        for run in runs:
            sp = spectra(arm, run)
            for s_, f in sp.items():
                if not given(f): continue
                m = msf[run].get(s_)
                if m is None: continue
                fd, md = float(f["delta"]), float(m["massdiff"])
                if abs(fd - x) <= TOL: fa += 1; fa_ok += abs(md - x) <= TOL
                if abs(md - x) <= TOL: ms += 1; ms_ok += abs(fd - x) <= TOL
            for s_, m in msf[run].items():  # reported: recovery against all MSFragger positives
                if abs(float(m["massdiff"]) - x) > TOL: continue
                ms_all += 1; f = sp.get(s_)
                ms_all_found += f is not None and given(f) and abs(float(f["delta"]) - x) <= TOL
        out.append(dict(name=name, x=x, fa=fa, fa_ok=fa_ok, ms=ms, ms_ok=ms_ok, ms_all=ms_all, ms_all_found=ms_all_found))
    return out
def verdict_shift(k, n, ms, floor):
    if ms < 30: return "INCONCLUSIVE"
    if n == 0: return "INCONCLUSIVE"
    return "PASS" if lb(k, n) >= floor else "FAIL"
def combine(vs):
    if "FAIL" in vs: return "FAIL"
    if "INCONCLUSIVE" in vs: return "INCONCLUSIVE"
    return "PASS"

res = {}
wb = watch("blind", RUNS, G1)
rows = []; v1 = []; v2 = []
for w in wb:
    a = verdict_shift(w["fa_ok"], w["fa"], w["ms"], 0.80); b = verdict_shift(w["ms_ok"], w["ms"], w["ms"], 0.60)
    v1.append(a); v2.append(b)
    rows.append([w["name"], "%.4f" % w["x"], fmt_cp(w["fa_ok"], w["fa"]), a, fmt_cp(w["ms_ok"], w["ms"]), b, w["ms"],
                 fmt_cp(w["ms_all_found"], w["ms_all"])])
write("G1_G2_blind.tsv", ["shift", "Da", "G1 precision (CP 95%)", "G1 (LB>=0.80)", "G2 recovery among joined MSF (CP 95%)",
                          "G2 (LB>=0.60)", "joined MSF positives", "recovery vs all MSF positives (reported)"], rows)
res["G1"] = combine(v1); res["G2"] = combine(v2)
for r in rows: P("G1/G2:", r)
for arm, runs in (("blind", RUNS), ("main", INF_RUNS)):
    rr = []
    for w in watch(arm, runs, G1 + REPORTED):
        rr.append([arm, w["name"], "%.4f" % w["x"], fmt_cp(w["fa_ok"], w["fa"]), fmt_cp(w["ms_ok"], w["ms"]), w["ms"],
                   fmt_cp(w["ms_all_found"], w["ms_all"])])
    write("watch_%s.tsv" % arm, ["arm", "shift", "Da", "precision", "recovery (joined)", "joined MSF positives",
                                 "recovery (all MSF)"], rr)

# ---------------- G3 (amend_site_cp logic) + moved-peak null ----------------
k_ = n_ = frag = nullf = 0
for run in RUNS:
    for s_, f in spectra("blind", run).items():
        if not given(f): continue
        if f["loc_class"] == "fragment": frag += 1
        if f["null_class"] == "fragment": nullf += 1
        if f["loc_class"] != "fragment": continue
        m = msf[run].get(s_)
        if m is None or not msf_locs(m) or fold(f["peptide"]) != fold(m["peptide"]) or abs(float(f["delta"]) - float(m["massdiff"])) > TOL: continue
        n_ += 1; k_ += int(f["site_pos"]) in msf_locs(m)
null_share = nullf / frag if frag else float("nan")
g3 = "INCONCLUSIVE" if n_ < 30 else ("PASS" if lb(k_, n_) >= 0.80 and null_share <= 0.02 else "FAIL")
res["G3"] = g3
write("G3_blind.tsv", ["what", "value"], [["site agreement (CP 95%)", fmt_cp(k_, n_)], ["fragment-localized (charge given)", frag],
                                          ["null fragment-localized", nullf], ["null share", "%.4f" % null_share], ["G3", g3]])
P("G3:", fmt_cp(k_, n_), "null", nullf, "/", frag, "=", "%.4f" % null_share, g3)

# ---------------- calls for G4 / G5 / G6 ----------------
def calls(arm, runs):
    out = []
    for run in runs:
        for s_, f in spectra(arm, run).items():
            if not given(f) or f["loc_class"] != "fragment": continue
            m = msf[run].get(s_)
            out.append(dict(run=run, scan=s_, spectrum=f["spectrum"], delta=f["delta"], delta_full=f["delta_full"],
                            peptide=f["peptide"], site=f["site"], site_pos=f["site_pos"], localized=f["localized"],
                            region=f["region"], gap_side=f["gap_side"], charge=f["charge"], loc_evidence=f["loc_evidence"],
                            msf_peptide=m["peptide"] if m else "-", msf_massdiff=m["massdiff"] if m else "-",
                            msf_best_locs=(m.get("best_locs", "") or "-") if m else "-"))
    out.sort(key=lambda c: (c["run"], c["scan"]))
    return out
C = calls("blind", RUNS)
CALLCOLS = ["stratum", "run", "scan", "spectrum", "delta", "delta_full", "peptide", "site", "site_pos", "localized", "region",
            "gap_side", "charge", "loc_evidence", "msf_peptide", "msf_massdiff", "msf_best_locs"]
os.makedirs(os.path.join(OUT, "calls"), exist_ok=True)
def write_calls(name, items):
    p = os.path.join(OUT, "calls", name)
    with open(p, "w") as f:
        f.write("\t".join(CALLCOLS) + "\n")
        for st, c in items: f.write("\t".join([st] + [str(c[k]) for k in CALLCOLS[1:]]) + "\n")
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

g4_pop = [(n, c) for c in C for n, x in G1 if abs(float(c["delta"]) - x) <= TOL]
g5_pop = [(n, c) for c in C for n, x, r in RARE if abs(float(c["delta"]) - x) <= TOL and c["site"] in r]
h4 = write_calls("G4_population.tsv", g4_pop); h5 = write_calls("G5_population.tsv", g5_pop)

# G4 allocation: 100, proportional to the stratum's calls, at least 8 (all when fewer), largest remainder.
TOTAL, MIN = 100, 8
nst = collections.OrderedDict((n, sum(1 for s, _ in g4_pop if s == n)) for n, _ in G1)
N = sum(nst.values())
if N <= TOTAL:
    alloc = dict(nst)
else:
    ideal = {n: TOTAL * k / N for n, k in nst.items()}
    alloc = {n: min(k, max(MIN, int(math.floor(ideal[n])))) for n, k in nst.items()}
    while sum(alloc.values()) < TOTAL:
        n = max((n for n in nst if alloc[n] < nst[n]), key=lambda n: (ideal[n] - alloc[n], -list(nst).index(n)))
        alloc[n] += 1
    while sum(alloc.values()) > TOTAL:
        n = max((n for n in nst if alloc[n] > MIN), key=lambda n: (alloc[n] - ideal[n], -list(nst).index(n)))
        alloc[n] -= 1
rng = random.Random(20261118)
g4_sample = []
for n, _ in G1:
    pop = [c for s, c in g4_pop if s == n]
    g4_sample += [(n, c) for c in rng.sample(pop, alloc[n])]
h4s = write_calls("G4_sample.tsv", g4_sample)
write("G4_allocation.tsv", ["stratum", "calls", "sampled"], [[n, nst[n], alloc[n]] for n in nst])
P("G4 population", N, "allocation", dict(alloc), "sample", len(g4_sample))
g5c = collections.Counter(s for s, _ in g5_pop)
P("G5 calls:", dict(g5c), "total", len(g5_pop))
res["G4"] = "PENDING (hand-check)" if len(g4_sample) >= 30 else "INCONCLUSIVE (n<30)"
res["G5"] = {n: ("PENDING (hand-check)" if g5c[n] >= 20 else "INCONCLUSIVE (%d < 20 calls)" % g5c[n]) for n, _, _ in RARE}

# ---------------- G6 (amend_st_enrichment logic, charge given) ----------------
def st_enrich(arm, runs, charge_given):
    cl = []
    for run in runs:
        for f in spectra(arm, run).values():
            if abs(float(f["delta"]) + 18.010565) > TOL or f["loc_class"] != "fragment": continue
            if charge_given and not given(f): continue
            lo, hi = (int(x) for x in f["region"].split("-"))
            cl.append((f["peptide"][lo - 1:hi], f["site"][-1:]))
    obs = sum(site in "ST" for _, site in cl)
    r = random.Random(20261118); null = []
    for _ in range(10000):
        null.append(sum(r.choice(reg) in "ST" for reg, _ in cl))
    null.sort()
    p = (sum(v >= obs for v in null) + 1) / (len(null) + 1)
    return len(cl), obs, sum(null) / len(null), p
g6rows = []
for arm, runs in (("blind", RUNS), ("main", INF_RUNS)):
    for cg in (True, False):
        n6, o6, m6, p6 = st_enrich(arm, runs, cg)
        g6rows.append([arm, "charge given" if cg else "all (dev convention)", n6, o6, "%.2f" % m6, "%.4f" % p6])
        if arm == "blind" and cg:
            res["G6"] = "INCONCLUSIVE (%d < 10 calls)" % n6 if n6 < 10 else ("PASS" if p6 <= 0.05 else "FAIL")
            P("G6:", n6, "calls,", o6, "on S/T, null mean %.2f, p %.4f" % (m6, p6), res["G6"])
write("G6_st_enrichment.tsv", ["arm", "spectra", "-18.011 fragment-localized calls", "on S/T", "null mean", "p (one-sided)"], g6rows)

# ---------------- G7 naming (pooled rows of charge-given spectra) ----------------
def pooled(arm, runs):
    bins = collections.defaultdict(list)
    for run in runs:
        for f in spectra(arm, run).values():
            if not given(f): continue
            f["_run"] = run; bins[round(float(f["delta"]) / 0.0005)].append(f)
    order = sorted(bins, key=lambda k: (-len(bins[k]), k)); taken = set(); prow = []
    per_run_rows = {run: delta_rows(os.path.join(ROOT, arm, run + ".delta.tsv")) for run in runs}
    for k in order:
        if k in taken: continue
        mem = [b for b in range(k - 8, k + 9) if b in bins and b not in taken]
        taken.update(mem)
        fs = [f for b in mem for f in bins[b]]
        nz = [f for f in fs if abs(float(f["delta"])) > 1e-6]
        oc = collections.Counter(f["obs_class"] for f in nz)
        top_cls = oc.most_common(1)[0][0] if oc else "-"
        det = collections.Counter(f["obs_detail"] for f in nz if f["obs_class"] == top_cls and f["obs_detail"] not in ("-", ""))
        cands = [(int(r["spectra"]), r) for run in runs for r in per_run_rows[run] if abs(float(r["delta"]) - k * 0.0005) <= 0.004]
        big = max(cands, key=lambda x: x[0])[1] if cands else {}
        jn = cf = 0
        for f in fs:
            m = msf[f["_run"]].get(scan(f["spectrum"]))
            if m is None: continue
            jn += 1; cf += abs(float(m["massdiff"]) - k * 0.0005) <= TOL
        prow.append(dict(delta=k * 0.0005, spectra=len(fs), joined=jn, conf=cf / jn if jn else 0.0, cls=top_cls,
                         classes=",".join("%s:%d" % kv for kv in oc.most_common(3)) or "-",
                         detail=det.most_common(1)[0][0] if det else "-",
                         unimod=";".join(big.get("unimod", "-").split(";")[:2]), iso=big.get("isotope_error", "-"),
                         isobars=big.get("isobars", "-")))
    prow.sort(key=lambda r: (-r["spectra"], r["delta"]))
    return prow
def g7(arm, runs):
    top = [r for r in pooled(arm, runs) if abs(r["delta"]) > 1e-6][:20]
    out = []; ok = 0
    for r in top:
        named = r["unimod"] not in ("-", "") or r["iso"] not in ("-", "") or r["detail"] != "-"
        a = r["cls"] not in ("unknown", "-") and named
        b = r["joined"] > 0 and r["conf"] >= 0.5
        ok += a and b
        out.append(["%.4f" % r["delta"], r["spectra"], r["classes"], r["detail"], r["unimod"], r["iso"], r["isobars"],
                    r["joined"], "%.2f" % r["conf"], "yes" if a else "no", "yes" if b else "no", "yes" if a and b else "no"])
    return ok, out
G7H = ["delta", "spectra(charge given)", "obs_classes", "class detail (majority class)", "unimod (largest run row)",
       "isotope_error", "isobars", "msf_joined", "msf_confirmed", "(a) class+name", "(b) msf>=0.5", "counts"]
ok7, t7 = g7("blind", RUNS); write("G7_blind.tsv", G7H, t7)
res["G7"] = "PASS" if ok7 >= 14 else "FAIL"
P("G7 blind:", ok7, "of 20", res["G7"])
ok7i, t7i = g7("main", INF_RUNS); write("G7_informed.tsv", G7H, t7i)
P("G7 informed (reported):", ok7i, "of 20")

# ---------------- reported, not gating ----------------
KEYS = ["ms2_read", "ms2_tagged", "ms2_placed", "clamped_excluded", "samples", "samples_exact", "samples_gap_region",
        "samples_gap_terminal", "gap_fragment_localized", "gap_sequence_constrained", "gap_ambiguous", "gap_unlocalized",
        "gap_precursor_flank", "samples_charge_assumed", "rows_spectra_sum"]
rec = []
for arm, runs in (("blind", RUNS), ("main", INF_RUNS)):
    tot = collections.Counter()
    for run in runs:
        c = counts(arm, run)
        for k in KEYS: tot[k] += int(c.get(k, 0))
    rec.append([arm, len(runs)] + [tot[k] for k in KEYS])
write("reconciliation_totals.tsv", ["arm", "runs"] + KEYS, rec)
byc = collections.defaultdict(collections.Counter)
for run in RUNS:
    for s, f in spectra("blind", run).items():
        m = msf[run].get(s); cs = f["charge_source"]
        byc[cs]["samples"] += 1
        if m is None: continue
        fd, md = float(f["delta"]), float(m["massdiff"])
        byc[cs]["joined"] += 1; byc[cs]["agree"] += abs(fd - md) <= TOL
        if abs(fd) > SHIFT: byc[cs]["gap_joined"] += 1; byc[cs]["gap_agree"] += abs(fd - md) <= TOL
write("charge_strata_blind.tsv", ["charge_source", "samples", "joined", "shift_agreement", "gap_precision"],
      [[k, v["samples"], v["joined"], fmt_cp(v["agree"], v["joined"]), fmt_cp(v["gap_agree"], v["gap_joined"])] for k, v in sorted(byc.items())])
iso = []
for arm, runs in (("blind", RUNS), ("main", INF_RUNS)):
    for name, x in (("+0.984", 0.984016), ("+1.003", 1.0033548), ("+2.007", 2.0067096)):
        n = pf = 0
        for run in runs:
            for f in spectra(arm, run).values():
                if abs(float(f["delta"]) - x) > 0.005: continue
                n += 1; pf += f["flank"] == "precursor"
        iso.append([arm, name, n, pf, "%.3f" % (pf / max(n, 1))])
write("isotope_flank.tsv", ["arm", "shift(+-5mDa)", "samples", "precursor_flank", "share"], iso)
ent = collections.Counter()
ENT_RUNS = [r[0] for r in excl if r[3] == "ok"]
for run in ENT_RUNS:
    for f in spectra("entrap", run).values():
        e = f["protein"].startswith("ENTRAP_"); gap = abs(float(f["delta"])) > 1e-6
        fl = f["loc_class"] in ("fragment", "sequence")
        ent["samples"] += 1; ent["samples_entrap"] += e; ent["gapped"] += gap; ent["gapped_entrap"] += gap and e
        ent["localized"] += fl; ent["localized_entrap"] += fl and e
write("entrapment.tsv", ["what", "n"], sorted(ent.items()) + [["runs", len(ENT_RUNS)],
      ["gapped entrapment share", "%.4f" % (ent["gapped_entrap"] / max(ent["gapped"], 1))]])
P("entrapment gapped share: %d/%d" % (ent["gapped_entrap"], ent["gapped"]))
agree = {}
for arm, runs in (("blind", RUNS), ("main", INF_RUNS)):
    c = collections.Counter()
    for run in runs:
        for s, f in spectra(arm, run).items():
            m = msf[run].get(s)
            if m is None: continue
            fd, md = float(f["delta"]), float(m["massdiff"])
            c["joined"] += 1; c["agree"] += abs(fd - md) <= TOL; c["same_pep"] += fold(f["peptide"]) == fold(m["peptide"])
            c["msf_gap"] += abs(md) > SHIFT; c["missed"] += abs(md) > SHIFT and abs(fd) <= SHIFT
    agree[arm] = c
write("agreement.tsv", ["arm", "joined", "shift agreement", "same peptide", "missed shift rate"],
      [[a, c["joined"], fmt_cp(c["agree"], c["joined"]), fmt_cp(c["same_pep"], c["joined"]), fmt_cp(c["missed"], c["msf_gap"])]
       for a, c in agree.items()])

# ---------------- outcome ----------------
g5v = list(res["G5"].values())
final = dict(res)
gating = [res["G1"], res["G2"], res["G3"], res["G6"], res["G7"]]
if any(v.startswith("FAIL") for v in gating): overall = "FAIL"
else: overall = "PENDING (G4/G5 hand-check)"
final["overall"] = overall
final["call_list_sha256"] = {"G4_population.tsv": h4, "G5_population.tsv": h5, "G4_sample.tsv": h4s}
json.dump(final, open(os.path.join(OUT, "verdicts.json"), "w"), indent=1)
P("verdicts:", json.dumps(final))
open(os.path.join(OUT, "summary.txt"), "w").write("\n".join(summary) + "\n")
