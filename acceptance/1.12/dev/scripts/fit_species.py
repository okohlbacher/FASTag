#!/usr/bin/env python3
"""#1 DEV fit of -species_call decoy on the RC regeneration (species_dev.py): go/no-go, all-decoy KS check, the
pre-registered grid, the selection rule and leave-one-PXD-out CV. In-sample DEV numbers only.

Scoring (fixed before any grid arm was read; PREREG-species-call.md, section DEV):
  - genus status per run as the paper harness (fastag_bench.species.genus_table): truth genera in the index are
    'positive'; the reagent/contaminant genera Bos, Sus, Oryctolagus, Ovis, Equus and Homo in a non-human sample are
    'excluded'; every other index genus is 'negative'. Only genera of species.tsv rows can be present.
  - metrics over the high-resolution (FTMS) DEV runs; ion-trap runs (0.3 Da) are a run-level low_resolution
    no_call under every point and are reported apart;
  - false present: a 'negative' genus called present. run-level false-present rate = share of runs with >= 1;
  - sensitivity: positives with a stated share >= 0.05 or no stated share (truth 'Homo;Mus' etc.), present / all;
  - observed-universe specificity (a): negatives with observed >= n_min, not present / all;
  - fully no_call: runs where every row's call is no_call.
Selection (PLAN-organism-chemistry #1): minimise the run-level false-present rate subject to sensitivity >= 0.85;
ties: higher sensitivity, then fewer false presents per run, then deconvolve off, smaller tau, smaller n_min,
smaller alpha. If no point reaches 0.85: the highest sensitivity, then the same ties (reported as 'constraint not met').
LOPO-CV: per DEV PXD, select on the other PXDs' runs, score the PXD's runs with that point; pooled over folds.
Go/no-go: d_g (decoy_spectra) and spill_g = decoy_expected - (d_g + 0.5)/D per genus row at the provisional point
g_0.01_0_10_off. All-decoy check: o' = decoy_spectra(ks6) - decoy_spectra(g_0.01_0_10_off) is decoy replicate j=5
alone; under lambda = (d_g + 0.5)/5 its randomised PIT p = P(X > o') + U P(X = o') (U ~ U(0,1), random.Random(112))
over every genus row of every FTMS run; Kolmogorov-Smirnov against U(0,1), pass when p > 0.01.
Usage: fit_species.py <repo> <runs dir> <dev check tsv> <out dir>"""
import csv, hashlib, json, math, os, random, sys
from pathlib import Path

REPO, RUNS, CHECK, OUT = (Path(a) for a in sys.argv[1:5])
sys.path.insert(0, str(REPO / "bench/fastag-bench/src"))
from fastag_bench import species as SP  # noqa: E402

ALPHAS, TAUS, NMINS = ["0.01", "0.05"], ["0", "0.002", "0.005", "0.01"], ["5", "10", "20"]
POINTS = [(a, t, n, d) for d in ("off", "on") for a in ALPHAS for t in TAUS for n in NMINS]
PROV = "g_0.01_0_10_off"


def arm(p):
    return f"g_{p[0]}_{p[1]}_{p[2]}_{p[3]}"


def read_species(p):
    with open(p) as f:
        rows = list(csv.DictReader(f, delimiter="\t"))
    return [r for r in rows if r["rank"] == "genus"]


def wilson(k, n, z=1.959963984540054):
    if n == 0:
        return (float("nan"), float("nan"))
    ph = k / n
    d = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / d
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def pois_pmf(k, lam):
    return math.exp(k * math.log(lam) - lam - math.lgamma(k + 1)) if lam > 0 else (1.0 if k == 0 else 0.0)


def pois_sf(k, lam):  # P(X > k)
    s, t = 0.0, 0.0
    for i in range(0, k + 1):
        t += pois_pmf(i, lam)
    s = 1.0 - t
    return max(0.0, s)


def ks_uniform(xs):
    xs = sorted(xs)
    n = len(xs)
    d = max(max((i + 1) / n - x, x - i / n) for i, x in enumerate(xs))
    en = math.sqrt(n)
    lam = (en + 0.12 + 0.11 / en) * d
    p = 0.0
    for j in range(1, 101):
        p += 2 * (-1) ** (j - 1) * math.exp(-2 * j * j * lam * lam)
    return d, min(1.0, max(0.0, p))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ok = {r["run_id"] for r in csv.DictReader(open(CHECK), delimiter="\t") if r["result"] == "PASS"}
    man = [r for r in SP.load_manifest(REPO / "bench/fastag-bench/config/species_runs.tsv").to_dict("records")
           if r["run_id"] in ok]
    universe = set(SP.load_universe(REPO / "bench/fastag-bench/config/species_universe.txt"))
    # training run list (its sha256 goes into species_call.tsv)
    tl = OUT / "training_runs.tsv"
    with open(tl, "w") as o:
        o.write("run_id\tpxd\tmzml\tbytes\n")
        for r in man:
            o.write(f"{r['run_id']}\t{r['pxd']}\t{r['mzml']}\t{os.path.getsize(r['mzml'])}\n")
    tl_sha = hashlib.sha256(tl.read_bytes()).hexdigest()

    runs = []
    for r in man:
        rd = RUNS / r["run_id"]
        meta = json.loads((rd / "meta.json").read_text())
        truth = SP.parse_truth(r["truth"])
        human = "Homo" in truth
        def status(g):
            if g in truth:
                return "positive" if g in universe else "out_of_index"
            if g in SP.CONTAMINANT_GENERA or (g == "Homo" and not human):
                return "excluded"
            return "negative"
        arms = {}
        for p in POINTS + [("ks6",)]:
            a = arm(p) if len(p) == 4 else "ks6"
            f = rd / a / "species.tsv"
            if not f.exists():
                raise SystemExit(f"missing {f}")
            arms[a] = read_species(f)
        elig = [g for g in truth if g in universe and (truth[g] is None or truth[g] >= 0.05)]
        runs.append({"run_id": r["run_id"], "pxd": r["pxd"], "an": meta["analyzer"], "truth": truth,
                     "status": status, "elig": elig, "arms": arms})
    hr = [x for x in runs if x["an"] == "FTMS"]

    def score(rs, p):
        a = arm(p)
        n_min = int(p[2])
        tp = fn = fp_runs = fp_tot = spec_n = spec_k = nocall_runs = 0
        for x in rs:
            rows = x["arms"][a]
            pres = {r["name"] for r in rows if r["call"] == "present"}
            fps = [g for g in pres if x["status"](g) == "negative"]
            fp_runs += bool(fps)
            fp_tot += len(fps)
            for g in x["elig"]:
                tp += g in pres
                fn += g not in pres
            for r in rows:
                if x["status"](r["name"]) == "negative" and int(r["observed"]) >= n_min:
                    spec_n += 1
                    spec_k += r["name"] not in pres
            nocall_runs += bool(rows) and all(r["call"] == "no_call" for r in rows)
        n = len(rs)
        return {"point": a, "runs": n, "fp_run_rate": fp_runs / n if n else float("nan"), "fp_runs": fp_runs,
                "fp_per_run": fp_tot / n if n else float("nan"), "tp": tp, "fn": fn,
                "sensitivity": tp / (tp + fn) if tp + fn else float("nan"),
                "spec_a": spec_k / spec_n if spec_n else float("nan"), "spec_a_n": spec_n,
                "spec_a_wilson_lb": wilson(spec_k, spec_n)[0], "nocall_runs": nocall_runs}

    def key(s, p):
        return (s["fp_run_rate"], -s["sensitivity"], s["fp_per_run"], p[3] != "off", float(p[1]), int(p[2]),
                float(p[0]))

    def select(rs):
        sc = [(score(rs, p), p) for p in POINTS]
        okp = [(s, p) for s, p in sc if s["sensitivity"] >= 0.85]
        if okp:
            return min(okp, key=lambda sp: key(*sp)), True, sc
        best = max(s["sensitivity"] for s, _ in sc)
        cand = [(s, p) for s, p in sc if s["sensitivity"] == best]
        return min(cand, key=lambda sp: key(*sp)), False, sc

    (sel_s, sel_p), met, grid = select(hr)
    with open(OUT / "grid.tsv", "w") as o:
        cols = list(grid[0][0].keys())
        o.write("\t".join(cols) + "\n")
        for s, _ in grid:
            o.write("\t".join(f"{s[c]:.4f}" if isinstance(s[c], float) else str(s[c]) for c in cols) + "\n")
    # LOPO-CV
    folds, cv = sorted({x["pxd"] for x in hr}), []
    agg = {"tp": 0, "fn": 0, "fp_runs": 0, "runs": 0, "fp_tot": 0.0}
    for pxd in folds:
        tr = [x for x in hr if x["pxd"] != pxd]
        te = [x for x in hr if x["pxd"] == pxd]
        (s_tr, p_tr), met_tr, _ = select(tr)
        s_te = score(te, p_tr)
        cv.append({"pxd": pxd, "point": arm(p_tr), "constraint_met": met_tr, "runs": s_te["runs"],
                   "fp_runs": s_te["fp_runs"], "tp": s_te["tp"], "fn": s_te["fn"]})
        agg["tp"] += s_te["tp"]; agg["fn"] += s_te["fn"]; agg["fp_runs"] += s_te["fp_runs"]
        agg["runs"] += s_te["runs"]; agg["fp_tot"] += s_te["fp_per_run"] * s_te["runs"]
    with open(OUT / "lopo_cv.tsv", "w") as o:
        o.write("pxd\tpoint\tconstraint_met\truns\tfp_runs\ttp\tfn\n")
        for c in cv:
            o.write("\t".join(str(c[k]) for k in ("pxd", "point", "constraint_met", "runs", "fp_runs", "tp", "fn")) + "\n")
    # go/no-go at the provisional point
    dg, spill, zero_d = [], [], 0
    per_genus = {}
    for x in hr:
        for r in x["arms"][PROV]:
            d = int(r["decoy_spectra"])
            sp = float(r["decoy_expected"]) - (d + 0.5) / 5.0
            dg.append(d); spill.append(sp); zero_d += d == 0
            per_genus.setdefault(r["name"], []).append(d)
    med = lambda v: sorted(v)[len(v) // 2] if v else float("nan")
    genus_med_d = {g: med(v) for g, v in per_genus.items()}
    all_med_zero = all(v == 0 for v in genus_med_d.values())
    # all-decoy KS
    rng = random.Random(112)
    pits, neg = [], 0
    for x in hr:
        d5 = {r["taxid"]: int(r["decoy_spectra"]) for r in x["arms"][PROV]}
        for r in x["arms"]["ks6"]:
            if r["taxid"] not in d5:
                continue
            o6 = int(r["decoy_spectra"]) - d5[r["taxid"]]
            if o6 < 0:
                neg += 1
                continue
            lam = (d5[r["taxid"]] + 0.5) / 5.0
            pits.append(pois_sf(o6, lam) + rng.random() * pois_pmf(o6, lam))
    ks_d, ks_p = ks_uniform(pits)
    res = {
        "training_runs": len(man), "training_list_sha256": tl_sha, "ftms_runs": len(hr),
        "itms_runs": len(runs) - len(hr), "ftms_pxds": len(folds),
        "selected": arm(sel_p), "constraint_met": met, "selected_scores": sel_s,
        "lopo_cv": {"runs": agg["runs"], "fp_run_rate": agg["fp_runs"] / agg["runs"],
                    "fp_per_run": agg["fp_tot"] / agg["runs"],
                    "sensitivity": agg["tp"] / (agg["tp"] + agg["fn"]) if agg["tp"] + agg["fn"] else None,
                    "points_chosen": sorted({c["point"] for c in cv})},
        "go_nogo": {"rows": len(dg), "d_g_median": med(dg), "d_g_zero_share": zero_d / max(1, len(dg)),
                    "spill_median": med(spill), "spill_positive_share": sum(1 for s in spill if s > 0) / max(1, len(spill)),
                    "genus_median_d_all_zero": all_med_zero, "genus_median_d": genus_med_d},
        "all_decoy_ks": {"n": len(pits), "D": ks_d, "p": ks_p, "pass": ks_p > 0.01, "negative_diffs": neg},
    }
    (OUT / "fit.json").write_text(json.dumps(res, indent=1, sort_keys=True) + "\n")
    print(json.dumps({k: v for k, v in res.items() if k != "go_nogo"}, indent=1))
    print("go_nogo", {k: v for k, v in res["go_nogo"].items() if k != "genus_median_d"})


if __name__ == "__main__":
    main()
