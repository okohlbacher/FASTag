#!/usr/bin/env python3
"""Census identifiability score: labels, fit and evaluation (FASTag 1.16 item 4).

Subcommands
-----------
labels   Exact one-to-one join of a first search (Sage results.sage.tsv) to a census table (-census -census_score).
         Every rank-1 PSM must name exactly one census spectrum by its native id; the Sage `filename` must be the
         run's mzML; the PSM's precursor m/z must agree with the census row's (a wrong-run file with the same scan
         numbers fails here). Output, one row per census row: spectrum, label (1 = rank-1 target at spectrum_q <= --q),
         category (accepted | target_above_q | decoy | no_psm), psm_q. A census row the search did not export is
         no_psm (searched, nothing reported); a PSM that names no census row is refused (unmappable), never dropped.
fit      Logistic model on per-run mid-ranks of the census features (the C++ score's features, src/CensusScore.h),
         fitted on the runs of a run table (development runs only). Repeated spectra are down-weighted (weight
         1 / cluster size, cluster: same charge_used, precursor m/z within 10 ppm and RT within 60 s of the
         cluster's first spectrum, sorted by m/z) and every run has the same total weight. Ridge 1e-3 on the
         coefficients. Optionally writes the frozen block of src/CensusScore.cpp and leave-one-sample-out
         predictions (columns ident_cv, mlog_e appended to a copy of each census table).
eval     Per-run AUC (cluster-weighted) of a score column for the first-search label, against best E-value and
         n_peaks; mean over runs, ΔAUC with run-cluster and sample-cluster bootstrap intervals; precision of the
         top 10% per run. Second-search recovery at a fixed review budget: among the first search's unidentified
         spectra, the hit rate (semi search, subset FDR, as tools/census_triage_eval.py) of the top-k by each
         ranker, with k = the run's triage candidates and k = 10% of the unidentified. The unidentified are the
         label-0 rows of the exact join; the triage set is their rows with triage = 1.
check    Recomputes the score from a census table's features with a model JSON and compares it to its
         ident_score column (the C++ and Python implementations must agree to the printed precision).

Run table (TSV, columns by name): run, sample, census, labels [, second, mzml].
Only `fit` needs numpy; the rest uses the Python standard library.
"""
import argparse
import csv
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import census_triage_eval as cte  # noqa: E402

FEATURES = ["pre_best_evalue", "pre_best_len", "pre_best_mean_conf", "pre_tag_cover", "n_found", "n_peaks",
            "n_compl", "n_edges", "n_peaks_kept", "int_gini", "charge_used", "precursor_mz"]
ZERO_E = 400.0
PROTON = 1.007276466812
MZ_PPM = 20.0
CLUSTER_PPM = 10.0
CLUSTER_RT = 60.0
RIDGE = 1e-3


class IdentError(Exception):
    pass


def read_table(path):
    with open(path, newline="") as f:
        r = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(r)
        rows = [row for row in r if row]
    for row in rows:
        if len(row) != len(header):
            raise IdentError(f"{path}: a row has {len(row)} fields, the header {len(header)}")
    return header, rows


def colmap(header, names, path):
    out = {}
    for n in names:
        if n not in header:
            raise IdentError(f"{path}: no column '{n}'")
        out[n] = header.index(n)
    return out


# ---- features, as src/CensusScore.cpp ----------------------------------------------------------------------------

def parse(s):
    if s == "":
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return None if math.isnan(v) else v


def raw_feature(k, s):
    v = parse(s)
    if v is None:
        return -math.inf
    if k == 0:
        if v < 0:
            return -math.inf
        if v == 0:
            return ZERO_E
        return min(ZERO_E, -math.log10(v))
    return v


def mid_ranks(v):
    n = len(v)
    ix = sorted(range(n), key=lambda i: v[i])  # stable, as std::stable_sort
    r = [0.0] * n
    i = 0
    while i < n:
        j = i + 1
        while j < n and v[ix[j]] == v[ix[i]]:
            j += 1
        mid = ((i + 1) + j) / 2.0
        for t in range(i, j):
            r[ix[t]] = (mid - 0.5) / n
        i = j
    return r


def rank_features(header, rows, path):
    c = colmap(header, FEATURES, path)
    cols = []
    for k, name in enumerate(FEATURES):
        cols.append(mid_ranks([raw_feature(k, row[c[name]]) for row in rows]))
    return [[cols[k][i] for k in range(len(FEATURES))] for i in range(len(rows))]


def logistic(model, x):
    z = model["intercept"]
    for b, v in zip(model["coef"], x):
        z += b * v
    return 1.0 / (1.0 + math.exp(-z))


def mlog_e(s):
    """-log10(best E) with untagged lowest (the best-E-value baseline)."""
    return raw_feature(0, s)


# ---- repeated spectra ----------------------------------------------------------------------------------------------

def clusters(header, rows, path):
    """Cluster id per row (see the module docstring)."""
    c = colmap(header, ["index", "rt", "precursor_mz", "charge_used"], path)
    keyed, cid = [], [None] * len(rows)
    for i, row in enumerate(rows):
        mz, z, rt = parse(row[c["precursor_mz"]]), parse(row[c["charge_used"]]), parse(row[c["rt"]])
        if mz is None or z is None or rt is None:
            cid[i] = ("s", i)
        else:
            keyed.append((z, mz, rt, int(row[c["index"]]), i))
    keyed.sort()
    n, a = len(keyed), 0
    for s in range(n):
        z, mz, rt, _, i = keyed[s]
        if cid[i] is not None:
            continue
        cid[i] = ("c", i)
        t = s + 1
        hi = mz * (1 + CLUSTER_PPM * 1e-6)
        while t < n and keyed[t][0] == z and keyed[t][1] <= hi:
            j = keyed[t][4]
            if cid[j] is None and abs(keyed[t][2] - rt) <= CLUSTER_RT:
                cid[j] = ("c", i)
            t += 1
        a += 1
    return cid


def cluster_weights(cid):
    size = {}
    for c in cid:
        size[c] = size.get(c, 0) + 1
    return [1.0 / size[c] for c in cid]


# ---- labels ------------------------------------------------------------------------------------------------------

def labels(census, sage, mzml, q):
    h, rows = read_table(census)
    c = colmap(h, ["spectrum", "precursor_mz"], census)
    by_id = {}
    for i, row in enumerate(rows):
        sid = row[c["spectrum"]]
        if sid in by_id:
            raise IdentError(f"{census}: two census rows for '{sid}'")
        by_id[sid] = i
    sh, srows = cte.read_tsv(sage, quoted=True)
    sc = {n: cte.col(sh, n, sage) for n in ("filename", "scannr", "rank", "label", "spectrum_q", "expmass", "charge")}
    psm = {}
    n_rank1 = n_mz_bad = 0
    for row in srows:
        if os.path.basename(row[sc["filename"]]) != mzml:
            raise IdentError(f"{sage}: filename '{row[sc['filename']]}' is not the run's mzML '{mzml}' (wrong run)")
        if row[sc["rank"]] != "1":
            continue
        n_rank1 += 1
        sid = row[sc["scannr"]]
        if sid not in by_id:
            raise IdentError(f"{sage}: the rank-1 PSM of '{sid}' names no census spectrum (unmappable)")
        if sid in psm:
            raise IdentError(f"{sage}: two rank-1 PSMs for '{sid}'")
        lab = row[sc["label"]]
        if lab not in ("1", "-1"):
            raise IdentError(f"{sage}: label '{lab}' (1 target, -1 decoy)")
        q_ = cte.finite(row[sc["spectrum_q"]], sage, "spectrum_q")
        z = int(row[sc["charge"]])
        mz = float(row[sc["expmass"]]) / z + PROTON
        cmz = parse(rows[by_id[sid]][c["precursor_mz"]])
        if cmz is None or abs(mz - cmz) > MZ_PPM * 1e-6 * cmz:
            n_mz_bad += 1
        psm[sid] = (lab == "1", q_)
    if n_rank1 and n_mz_bad > 0.01 * n_rank1:
        raise IdentError(f"{sage}: {n_mz_bad} of {n_rank1} rank-1 PSMs have a precursor m/z more than {MZ_PPM} ppm "
                         f"from the census row's (wrong run?)")
    out = []
    for row in rows:
        sid = row[c["spectrum"]]
        if sid not in psm:
            out.append((sid, 0, "no_psm", ""))
            continue
        t, q_ = psm[sid]
        cat = "decoy" if not t else ("accepted" if q_ <= q else "target_above_q")
        out.append((sid, 1 if cat == "accepted" else 0, cat, repr(q_)))
    return out, {"rank1": n_rank1, "mz_mismatch": n_mz_bad}


def write_labels(out, path):
    with open(path, "w") as f:
        f.write("spectrum\tlabel\tcategory\tpsm_q\n")
        for r in out:
            f.write("\t".join(str(x) for x in r) + "\n")


def read_labels(path, census_rows, spec_col):
    h, rows = read_table(path)
    c = colmap(h, ["spectrum", "label"], path)
    if len(rows) != len(census_rows):
        raise IdentError(f"{path}: {len(rows)} labels for {len(census_rows)} census rows")
    y = []
    for lr, cr in zip(rows, census_rows):
        if lr[c["spectrum"]] != cr[spec_col]:
            raise IdentError(f"{path}: label row '{lr[c['spectrum']]}' is not census row '{cr[spec_col]}'")
        y.append(int(lr[c["label"]]))
    return y


# ---- run data ----------------------------------------------------------------------------------------------------

class Run:
    def __init__(self, meta):
        self.meta = meta
        self.name, self.sample = meta["run"], meta["sample"]
        self.header, self.rows = read_table(meta["census"])
        self.c = {n: i for i, n in enumerate(self.header)}
        self.x = rank_features(self.header, self.rows, meta["census"])
        self.y = read_labels(meta["labels"], self.rows, self.c["spectrum"])
        self.w = cluster_weights(clusters(self.header, self.rows, meta["census"]))

    def column(self, name, conv=float):
        k = self.c[name]
        return [conv(r[k]) for r in self.rows]


def read_runs(path):
    h, rows = cte.read_tsv(path)
    need = ["run", "sample", "census", "labels"]
    for n in need:
        cte.col(h, n, path)
    base = os.path.dirname(os.path.abspath(path))
    out = []
    for r in rows:
        m = dict(zip(h, r))
        for k in ("census", "labels", "second"):
            if k in m and m[k] and not os.path.isabs(m[k]):
                m[k] = os.path.join(base, m[k])
        out.append(m)
    return out


# ---- fit -----------------------------------------------------------------------------------------------------------

def fit_model(runs, ridge=RIDGE, iters=50):
    import numpy as np
    X, Y, W = [], [], []
    for r in runs:
        tw = sum(r.w)
        X.extend(r.x)
        Y.extend(r.y)
        W.extend(w / tw for w in r.w)
    X = np.hstack([np.ones((len(X), 1)), np.asarray(X)])
    Y, W = np.asarray(Y, float), np.asarray(W)
    beta = np.zeros(X.shape[1])
    pen = ridge * np.eye(X.shape[1])
    pen[0, 0] = 0.0
    for _ in range(iters):
        p = 1.0 / (1.0 + np.exp(-X @ beta))
        g = X.T @ (W * (Y - p)) - pen @ beta
        H = (X * (W * p * (1 - p))[:, None]).T @ X + pen
        step = np.linalg.solve(H, g)
        beta += step
        if np.max(np.abs(step)) < 1e-10:
            break
    return {"intercept": float(beta[0]), "coef": [float(b) for b in beta[1:]], "features": FEATURES}


CPP_BEGIN = "    // FROZEN-MODEL-BEGIN"
CPP_END = "    // FROZEN-MODEL-END"


def write_cpp(model, path):
    with open(path) as f:
        s = f.read()
    a, b = s.index(CPP_BEGIN), s.index(CPP_END)
    line_end = s.index("\n", a) + 1
    coef = ", ".join(repr(round(c, 6)) for c in model["coef"])
    block = (f'    static const Model m{{"{model["id"]}", {round(model["intercept"], 6)!r},\n'
             f"                         {{{coef}}}}};\n")
    s = s[:line_end] + block + s[b:]
    with open(path, "w") as f:
        f.write(s)


def frozen(model):
    """The model as the C++ block stores it (coefficients rounded to 6 decimals)."""
    return {"id": model["id"], "intercept": round(model["intercept"], 6), "coef": [round(c, 6) for c in model["coef"]],
            "features": FEATURES}


# ---- evaluation ----------------------------------------------------------------------------------------------------

def wauc(scores, y, w):
    """Weighted Mann-Whitney AUC (ties count one half); None when a class is empty."""
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    wp = sum(wi for wi, yi in zip(w, y) if yi)
    wn = sum(wi for wi, yi in zip(w, y) if not yi)
    if wp == 0 or wn == 0:
        return None
    acc, neg_below, i = 0.0, 0.0, 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        gp = sum(w[order[k]] for k in range(i, j + 1) if y[order[k]])
        gn = sum(w[order[k]] for k in range(i, j + 1) if not y[order[k]])
        acc += gp * (neg_below + 0.5 * gn)
        neg_below += gn
        i = j + 1
    return acc / (wp * wn)


def top_precision(scores, y, w, frac=0.10):
    """Cluster-weighted precision of the top frac of rows (ties by input order)."""
    n = max(1, int(round(frac * len(scores))))
    order = sorted(range(len(scores)), key=lambda i: (-scores[i], i))[:n]
    tw = sum(w[i] for i in order)
    return sum(w[i] for i in order if y[i]) / tw if tw else None


def boot_ci(values, groups, B, seed):
    """Percentile 95% interval of the mean of per-run values, resampling the groups (lists of indices)."""
    rng = random.Random(seed)
    keys = sorted(groups)
    stats = []
    for _ in range(B):
        pick = [rng.choice(keys) for _ in keys]
        vs = [values[i] for k in pick for i in groups[k]]
        stats.append(sum(vs) / len(vs))
    stats.sort()
    return stats[int(0.025 * B)], stats[min(B - 1, int(0.975 * B))]


def recovery(run, rankers, q=0.01):
    """Second-search hits among the first search's unidentified spectra (identified = 0), at two budgets."""
    psms = cte.second_psms(run.meta["second"], run.meta.get("mzml") or None)
    cs, ctr = run.c["spectrum"], run.c["triage"]
    # U from the exact label join (the Sage TSV), not from the idXML column `identified`: SageAdapter
    # (OpenMS 70cebcd144) writes no charge-1 PSM to its idXML, so a few identified spectra read identified = 0.
    u = [i for i in range(len(run.rows)) if run.y[i] == 0]
    truth = cte.subset_truth(psms, {run.rows[i][cs] for i in u}, q)
    hit = {i: run.rows[i][cs] in truth for i in u}
    k_tri = sum(1 for i in u if run.rows[i][ctr] == "1")
    k_10 = max(1, int(round(0.10 * len(u))))
    out = {"n_u": len(u), "t_u": sum(hit.values()), "k_triage": k_tri, "k_10": k_10,
           "hits_triage_set": sum(1 for i in u if run.rows[i][ctr] == "1" and hit[i])}
    for name, sc in rankers.items():
        order = sorted(u, key=lambda i: (-sc[i], i))
        out[f"hits_{name}_k_triage"] = sum(1 for i in order[:k_tri] if hit[i])
        out[f"hits_{name}_k_10"] = sum(1 for i in order[:k_10] if hit[i])
    return out


def evaluate(runs, score_of, B, seed, with_recovery, min_class=100):
    """score_of(run) -> list of scores. Returns (per-run rows, pooled dict)."""
    per = []
    for r in runs:
        s = score_of(r)
        rankers = {"ident": s, "best_e": [mlog_e(x[r.c["pre_best_evalue"]]) for x in r.rows],
                   "n_peaks": r.column("n_peaks")}
        row = {"run": r.name, "sample": r.sample, "n": len(r.rows), "pos": sum(r.y),
               "clusters_w": round(sum(r.w), 1)}
        for k, v in rankers.items():
            row[f"auc_{k}"] = wauc(v, r.y, r.w)
            row[f"top10_{k}"] = top_precision(v, r.y, r.w)
        if with_recovery and r.meta.get("second"):
            row.update(recovery(r, rankers))
        per.append(row)
    # evaluable: at least min_class accepted and min_class label-0 rows
    ok = [i for i, p in enumerate(per) if p["pos"] >= min_class and p["n"] - p["pos"] >= min_class
          and all(p[f"auc_{k}"] is not None for k in ("ident", "best_e", "n_peaks"))]
    pooled = {"runs": len(per), "evaluable": len(ok)}
    by_run = {i: [i] for i in ok}
    by_sample = {}
    for i in ok:
        by_sample.setdefault(per[i]["sample"], []).append(i)
    for k in ("ident", "best_e", "n_peaks"):
        pooled[f"auc_{k}"] = sum(per[i][f"auc_{k}"] for i in ok) / len(ok)
        pooled[f"top10_{k}"] = sum(per[i][f"top10_{k}"] for i in ok) / len(ok)
    for b in ("best_e", "n_peaks"):
        d = {i: per[i]["auc_ident"] - per[i][f"auc_{b}"] for i in ok}
        pooled[f"dauc_{b}"] = sum(d.values()) / len(d)
        pooled[f"dauc_{b}_runs_positive"] = sum(1 for v in d.values() if v > 0)
        pooled[f"dauc_{b}_ci_run"] = boot_ci(d, by_run, B, seed)
        pooled[f"dauc_{b}_ci_sample"] = boot_ci(d, by_sample, B, seed)
        t = {i: per[i]["top10_ident"] - per[i][f"top10_{b}"] for i in ok}
        pooled[f"dtop10_{b}"] = sum(t.values()) / len(t)
        pooled[f"dtop10_{b}_ci_run"] = boot_ci(t, by_run, B, seed)
    if with_recovery and all("n_u" in p for p in per):
        keys = [k for k in per[0] if k.startswith("hits_") or k in ("n_u", "t_u", "k_triage", "k_10")]
        for k in keys:
            pooled[k] = sum(p[k] for p in per)
        # hit rate at the triage budget: ident top-k vs the triage set (same k per run)
        for name in ("ident", "best_e", "n_peaks"):
            for budget in ("k_triage", "k_10"):
                pooled[f"rate_{name}_{budget}"] = pooled[f"hits_{name}_{budget}"] / pooled[budget]
        pooled["rate_triage_set"] = pooled["hits_triage_set"] / pooled["k_triage"]
        pooled["recovery_evaluable"] = sum(1 for p in per if p["t_u"] > 0)
        idx = list(range(len(per)))
        rng = random.Random(seed)
        diffs = []
        for _ in range(B):
            pick = [rng.choice(idx) for _ in idx]
            k = sum(per[i]["k_triage"] for i in pick)
            if k == 0:
                continue
            diffs.append((sum(per[i]["hits_ident_k_triage"] for i in pick)
                          - sum(per[i]["hits_triage_set"] for i in pick)) / k)
        diffs.sort()
        pooled["d_rate_ident_vs_triage"] = pooled["rate_ident_k_triage"] - pooled["rate_triage_set"]
        pooled["d_rate_ident_vs_triage_ci_run"] = (diffs[int(0.025 * len(diffs))],
                                                   diffs[min(len(diffs) - 1, int(0.975 * len(diffs)))])
    return per, pooled


def write_eval(per, pooled, path):
    with open(path, "w") as f:
        f.write("scope\tkey\tvalue\n")
        for p in per:
            for k, v in p.items():
                if k not in ("run",):
                    f.write(f"{p['run']}\t{k}\t{fmt(v)}\n")
        for k, v in pooled.items():
            f.write(f"pooled\t{k}\t{fmt(v)}\n")


def fmt(v):
    if isinstance(v, tuple):
        return ",".join(fmt(x) for x in v)
    if isinstance(v, float):
        return f"{v:.4f}"
    return str(v)


# ---- main ----------------------------------------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("labels")
    a.add_argument("--census", required=True)
    a.add_argument("--sage", required=True)
    a.add_argument("--mzml", required=True, help="basename the Sage filename column must name")
    a.add_argument("--q", type=float, default=0.01)
    a.add_argument("--out", required=True)
    f = sub.add_parser("fit")
    f.add_argument("runs")
    f.add_argument("--id", required=True)
    f.add_argument("--out", required=True, help="model JSON")
    f.add_argument("--write-cpp")
    f.add_argument("--loso", help="directory for leave-one-sample-out census copies (ident_cv, mlog_e)")
    e = sub.add_parser("eval")
    e.add_argument("runs")
    e.add_argument("--score", default="ident_score", help="census column (default ident_score)")
    e.add_argument("--recovery", action="store_true")
    e.add_argument("--min-class", type=int, default=100, help="accepted and label-0 rows a run needs (AUC endpoints)")
    e.add_argument("--boot", type=int, default=10000)
    e.add_argument("--seed", type=int, default=20261118)
    e.add_argument("--out", required=True)
    c = sub.add_parser("check")
    c.add_argument("--census", required=True)
    c.add_argument("--model", required=True)
    args = ap.parse_args(argv)
    try:
        if args.cmd == "labels":
            out, st = labels(args.census, args.sage, args.mzml, args.q)
            write_labels(out, args.out)
            cats = {}
            for r in out:
                cats[r[2]] = cats.get(r[2], 0) + 1
            print(json.dumps({"rows": len(out), **st, **cats}))
        elif args.cmd == "fit":
            runs = [Run(m) for m in read_runs(args.runs)]
            model = fit_model(runs)
            model["id"] = args.id
            model = frozen(model)
            with open(args.out, "w") as fo:
                json.dump(model, fo, indent=1)
            if args.write_cpp:
                write_cpp(model, args.write_cpp)
            if args.loso:
                os.makedirs(args.loso, exist_ok=True)
                cv = {}
                for s in sorted({r.sample for r in runs}):
                    m = frozen({**fit_model([r for r in runs if r.sample != s]), "id": f"loso-{s}"})
                    cv[s] = m
                    for r in runs:
                        if r.sample != s:
                            continue
                        with open(os.path.join(args.loso, r.name + ".census.tsv"), "w") as fo:
                            fo.write("\t".join(r.header + ["ident_cv", "mlog_e"]) + "\n")
                            for row, x in zip(r.rows, r.x):
                                fo.write("\t".join(row + [f"{logistic(m, x):.6f}",
                                                          repr(mlog_e(row[r.c['pre_best_evalue']]))]) + "\n")
                with open(os.path.join(args.loso, "models.json"), "w") as fo:
                    json.dump(cv, fo, indent=1)
            print(json.dumps(model))
        elif args.cmd == "eval":
            runs = [Run(m) for m in read_runs(args.runs)]
            per, pooled = evaluate(runs, lambda r: r.column(args.score), args.boot, args.seed, args.recovery,
                                   args.min_class)
            write_eval(per, pooled, args.out)
            print(json.dumps({k: v for k, v in pooled.items()}, default=list))
        elif args.cmd == "check":
            with open(args.model) as fi:
                m = json.load(fi)
            h, rows = read_table(args.census)
            x = rank_features(h, rows, args.census)
            k = colmap(h, ["ident_score"], args.census)["ident_score"]
            worst = max(abs(logistic(m, xi) - float(r[k])) for xi, r in zip(x, rows))
            print(json.dumps({"rows": len(rows), "max_abs_diff": worst}))
            if worst > 1.5e-6:
                raise IdentError(f"{args.census}: ident_score differs from the model by {worst}")
    except (IdentError, cte.EvalError) as ex:
        print(f"error: {ex}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
