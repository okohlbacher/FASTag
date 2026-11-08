#!/usr/bin/env python3
"""#3c-#3f DEV fits on the RC regeneration (chem_dev.py), with leave-one-PXD-out (LOPO) CV. In-sample DEV numbers.

Rules (DEV; iteration 1 = mode fit_lik as written below, iteration 2 = mode fit, see mode_fit_grid; PREREG-chem.md):
  Data: the DEV runs that pass check_dev_inputs.py, their B (v1 shipped) and V0 (v2 prior) -digest_out reports; the
  per-run P1/P1' counts are those of the report (identical in B and V0, checked). Truth: sdrf_truth_runs.tsv
  enzyme_truth ('unspecific' = class 'unspecific cleavage'); runs without an enzyme truth are not evaluable.
  3c detection, per instrument class I (orbitrap_hcd, timstof, other): the tryptic runs of class I (truth Trypsin,
     label not SILAC: heavy R+10 ends are not counted in C.P1, so SILAC distorts K:R) with n_c >= 100 give the
     pooled observed K/R; rho_I = (K/R observed) / (ref_k/ref_r) with ref the in-silico tryptic K:R of ref50.fasta
     (kr_reference.py). Weights e_I(K) = rho_I c, e_I(R) = c, c = 1 / (ref_k rho_I + ref_r) (the tryptic K/R mix
     keeps its weight), all other residues 1. A class without such a run keeps unit weights (unfitted).
  3e ends: Arg-C, Glu-C, Chymotrypsin (C end) and Asp-N (N end) get empirical ends: the MAP of the mixture
     (1-s) p + s bg on the pooled P1 (P1') counts of the class's training runs (n_c >= 100), Dirichlet prior
     kappa * rule (the v1 rule end), by EM (500 rounds, from 0.9 rule + 0.1 bg). One kappa for all four, from
     {10, 100, 1000, 10000, rule-only}. LysargiNase and Asp-N_ambic stay rule-only; Trypsin, Lys-C, Lys-N and
     unspecific keep their v1 rule ends.
     specificity: s_trypsin and one pooled s_nontryptic, each profiled over {0.02, 0.05, 0.1, 0.2, 0.4} by the
     summed log-likelihood of the training runs under their true class (tryptic runs under Trypsin; Lys-C, Arg-C,
     Glu-C, Chymotrypsin and Asp-N runs under their class's best model), ends refitted at each s_nontryptic.
     kappa: the largest LOPO-CV predictive log-likelihood of the non-tryptic runs under their true class.
  CV: per PXD, detection, ends and s refitted on the other PXDs at the chosen kappa; the PXD's runs classified by
     the port; a run whose no-call rule sends it to flank2 (timstof without detection, ms2_scan_window,
     ms2_first_peak, ion_counts, few_tags) takes the binary's result of the final-table pass (not cross-validated,
     counted apart).
  Endpoint (primary, PLAN-organism-chemistry #3): balanced accuracy over Trypsin, Lys-C and the pooled
     non-tryptic classes, no-call counted wrong; also accuracy among called and per-class recall.
Modes:
  fit  <repo> <runs> <check tsv> <RC digest dir> <kr tsv> <out dir>   -> out/digest_models_v2.tsv, fit_tables.json
  calibrate <repo> <runs> <check tsv> <pass name> <out dir>           -> out/digest_calibration.tsv, min_confidence
     3f: logistic P(correct) ~ margin + ln(n) + first_peak on the evaluable runs called in pass <name> (the fitted
     table, calibration unloaded effect irrelevant), IRLS with an L2 penalty of 0.1 on the three slopes. LOPO-CV
     p per run (refit without its PXD). min_confidence (iteration 2, see mode_calibrate): of {0, 0.5, 0.6, 0.7, 0.8,
     0.9, 0.95}, the best CV balanced accuracy among those with CV called accuracy >= 0.95; none -> 0."""
import csv, json, math, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chemport as P  # noqa: E402

CLASSES = {"Trypsin": "Trypsin", "Lys-C": "Lys-C", "Arg-C": "Arg-C", "Glu-C": "Glu-C", "Chymotrypsin": "Chymotrypsin",
           "Asp-N": "Asp-N", "LysargiNase": "LysargiNase", "unspecific": "unspecific cleavage", "Lys-N": "Lys-N"}
FIT_ENDS = {"Arg-C": "C", "Glu-C": "C", "Chymotrypsin": "C", "Asp-N": "N"}
S_GRID = [0.02, 0.05, 0.1, 0.2, 0.4]
K_GRID = [10.0, 100.0, 1000.0, 10000.0, None]
FLANK2_RULES = {"timstof", "ms2_scan_window", "ms2_first_peak", "ion_counts", "few_tags"}


def wilson(k, n, z=1.959963984540054):
    if n == 0:
        return (float("nan"), float("nan"))
    ph = k / n
    d = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / d
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def load_runs(repo, runs, check):
    ok = {r["run_id"]: r for r in csv.DictReader(open(check), delimiter="\t") if r["result"] == "PASS"}
    tr = {}
    for r in csv.DictReader((l for l in open(repo / "acceptance/1.12/inputs/sdrf_truth_runs.tsv")
                             if not l.startswith("# ")), delimiter="\t"):
        tr[f"{r['set']}__{r['acc']}__{r['run']}"] = r
    out = []
    for k, c in ok.items():
        f = runs / k / "B.digest.tsv"
        if not f.exists():
            continue
        rep = P.read_report(f)
        cc, nn = P.run_counts(rep)
        # the instrument class row is written by v2 reports only: read it from V0
        v0 = runs / k / "V0.digest.tsv"
        r0 = P.read_report(v0)
        if P.run_counts(r0) != (cc, nn):
            raise SystemExit(f"{k}: B and V0 counts differ")
        t = tr[k]
        out.append({"name": k, "pxd": c["pxd"], "rep": r0, "c": cc, "n": nn,
                    "cls": P.val(r0, "meta", "instrument_class"),
                    "truth": CLASSES.get(t["enzyme_truth"]), "label": t["label_truth"], "alk": t["alk_truth"]})
    return out


def rule_ends(prior):
    return {m["name"]: m for m in prior["models"]}


def fit_detection(train, ref_k, ref_r):
    det = {}
    for cls in ("orbitrap_hcd", "timstof", "other"):
        K = R = 0
        for x in train:
            if x["truth"] == "Trypsin" and x["label"] != "SILAC" and x["cls"] == cls and sum(x["c"]) >= P.TAG_MIN:
                K += x["c"][P.IDX["K"]]
                R += x["c"][P.IDX["R"]]
        if K > 0 and R > 0:
            rho = (K / R) / (ref_k / ref_r)
            c = 1.0 / (ref_k * rho + ref_r)
            det[cls] = {"K": rho * c, "R": c, "obs_K": K, "obs_R": R, "rho": rho}
    return det


def em_end(cnt, prior, bg, s, kappa, rounds=500):
    if kappa is None or sum(cnt) == 0:
        return list(prior)
    # start inside the simplex (a rule zero would stay zero under EM)
    p = [0.9 * a + 0.1 * b for a, b in zip(prior, bg)]
    for _ in range(rounds):
        acc = []
        for a in range(19):
            q = (1 - s) * p[a] + s * bg[a]
            r = (1 - s) * p[a] / q if q > 0 else 0.0
            acc.append(cnt[a] * r + kappa * prior[a])
        z = sum(acc)
        p = [v / z for v in acc]
    return p


def build(prior, det, s_t, s_nt, kappa, train):
    """A table dict (chemport form) from the prior table and the fits."""
    t = json.loads(json.dumps(prior))
    for m in t["models"]:
        if m["name"] in FIT_ENDS:
            end = FIT_ENDS[m["name"]]
            cnt = [0] * 19
            for x in train:
                if x["truth"] == m["cls"] and sum(x["c"]) >= P.TAG_MIN:
                    v = x["c"] if end == "C" else x["n"]
                    cnt = [a + b for a, b in zip(cnt, v)]
            bg = t["bg_c"] if end == "C" else t["bg_n"]
            m[end] = em_end(cnt, prior_model(prior, m["name"])[end], bg, s_nt, kappa)
    t["detection"] = {c: {"C": det_vec(d), "N": [1.0] * 19} for c, d in det.items()}
    t["spec"] = [s_t, s_nt]
    return t


def prior_model(prior, name):
    return next(m for m in prior["models"] if m["name"] == name)


def det_vec(d):
    v = [1.0] * 19
    v[P.IDX["K"]], v[P.IDX["R"]] = d["K"], d["R"]
    return v


def true_ll(t, x):
    """Log-likelihood of a run under its true class's best model (detection of its class)."""
    det = t["detection"].get(x["cls"])
    clf = P.classify(x["c"], x["n"], t, 0.05, det)
    if not clf["scored"]:
        return None
    v = [ll for _, cls, ll in clf["scores"] if cls == x["truth"]]
    return max(v) if v else None


def fit_all(prior, train, ref_k, ref_r, kappa):
    det = fit_detection(train, ref_k, ref_r)
    best_t = None
    for s in S_GRID:
        t = build(prior, det, s, 0.05, kappa, train)
        ll = sum(v for x in train if x["truth"] == "Trypsin" for v in [true_ll(t, x)] if v is not None)
        if best_t is None or ll > best_t[0]:
            best_t = (ll, s)
    best_nt = None
    nt = [x for x in train if x["truth"] in ("Lys-C", "Arg-C", "Glu-C", "Chymotrypsin", "Asp-N")]
    for s in S_GRID:
        t = build(prior, det, best_t[1], s, kappa, train)
        ll = sum(v for x in nt for v in [true_ll(t, x)] if v is not None)
        if best_nt is None or ll > best_nt[0]:
            best_nt = (ll, s)
    return build(prior, det, best_t[1], best_nt[1], kappa, train), det, best_t[1], best_nt[1]


def classify_run(t, x):
    det = t["detection"].get(x["cls"])
    clf = P.classify(x["c"], x["n"], t, 0.05, det)
    reason = P.decide(x["rep"], clf, det is not None and x["cls"] == "timstof")
    return clf, reason


def endpoint(rows):
    """rows: (truth class, called class or None). Balanced accuracy over Trypsin, Lys-C and pooled non-tryptic."""
    grp = {"Trypsin": [], "Lys-C": [], "nontryptic": []}
    for tr, call in rows:
        g = tr if tr in ("Trypsin", "Lys-C") else "nontryptic"
        grp[g].append(call == tr)
    rec = {g: (sum(v) / len(v) if v else float("nan"), len(v)) for g, v in grp.items()}
    ba = sum(r for r, n in rec.values() if n) / sum(1 for r, n in rec.values() if n)
    called = [(tr, c) for tr, c in rows if c is not None]
    k = sum(1 for tr, c in called if tr == c)
    return {"balanced_accuracy": ba, "recall": rec, "n": len(rows), "called": len(called), "called_correct": k,
            "called_accuracy": k / len(called) if called else float("nan"),
            "called_accuracy_wilson": wilson(k, len(called)),
            "accuracy_nocall_wrong": k / len(rows) if rows else float("nan")}


def write_table(prior_path, t, det, s_t, s_nt, kappa, ref, out, prov):
    lines = []
    for l in open(prior_path):
        if l.startswith("#"):
            continue
        lines.append(l.rstrip("\n"))
    head = ["# fastag_digest_models v2",
            "# FASTag 1.12 v2 protease models for -digest_models_version v2 (#3c-#3e). FITTED on the DEV runs of the",
            f"# 1.12 release candidate a117801 (FASTag.bin c4c2ad67...) by acceptance/1.12/dev/scripts/fit_chem.py; {prov}.",
            "# Not validated on held-out data (PLAN-organism-chemistry #3; PREREG-chem.md).",
            (f"# Empirical ends: Arg-C, Glu-C, Chymotrypsin (C) and Asp-N (N), MAP of (1-s)p + s bg with a Dirichlet prior "
             f"kappa={kappa!r} toward the v1 rule; LysargiNase, Asp-N_ambic rule-only." if kappa else
             "# Ends: every model keeps its v1 cleavage-rule end (the CV chose rule-only over the empirical Arg-C, Glu-C,"
             "\n# Chymotrypsin and Asp-N ends); LysargiNase and Asp-N_ambic are rule-only rows."),
            "# detection: K/R weights per instrument class from the pooled tryptic (non-SILAC) DEV runs over the reference",
            "# K:R; classes without such runs keep 1.",
            f"# specificity: trypsin {s_t}, nontryptic {s_nt} (profiled over {{0.02, 0.05, 0.1, 0.2, 0.4}}).",
            f"# reference: in-silico tryptic K:R of ref50.fasta (sha256 {ref['sha256']}; fully cleaved, 7-50 residues).",
            "# Rules: ExPASy PeptideCutter and OpenMS ProteaseDB (Enzymes.xml); Glu-C after E only (bicarbonate).",
            "# A model end is uniform over its cleaving residues; '*' = the background at that end.",
            "# background: residue composition of the UniProt human reference proteome UP000005640 (UP000005640_9606.fasta.gz, reference_proteomes, 20652 proteins, downloaded 2026-10-09), I counted as L, 11456316 residues.",
            "# Source: UniProt (The UniProt Consortium, Nucleic Acids Res. 2025), CC BY 4.0."]
    body = [lines[0]]
    fitted = {m["name"]: m for m in t["models"]}
    for l in lines[1:]:
        p = l.split("\t")
        name, cls, end, res, fr = p
        if name in ("detection", "specificity", "reference"):
            continue
        if name in FIT_ENDS and end == FIT_ENDS[name] and res != "*":
            fr = repr(fitted[name][end][P.IDX[res]])
        body.append("\t".join([name, cls, end, res, fr]))
    for cls in ("orbitrap_hcd", "timstof", "other"):
        d = det.get(cls)
        body.append(f"detection\t{cls}\tC\tK\t{repr(d['K']) if d else '1'}")
        body.append(f"detection\t{cls}\tC\tR\t{repr(d['R']) if d else '1'}")
    body.append(f"specificity\ttrypsin\t-\t-\t{s_t}")
    body.append(f"specificity\tnontryptic\t-\t-\t{s_nt}")
    body.append(f"reference\t-\tC\tK\t{ref['ref_k']}")
    body.append(f"reference\t-\tC\tR\t{ref['ref_r']}")
    Path(out).write_text("\n".join(head + body) + "\n")


def mode_fit(repo, runs, check, dig, krf, out):
    out.mkdir(parents=True, exist_ok=True)
    ref = dict(l.rstrip("\n").split("\t") for l in open(krf))
    ref_k, ref_r = float(ref["ref_k"]), float(ref["ref_r"])
    prior = P.read_table(dig / "digest_models_v2.tsv")
    R = load_runs(repo, runs, check)
    ev = [x for x in R if x["truth"]]
    # kappa by LOPO predictive log-likelihood of the non-tryptic runs
    ntp = sorted({x["pxd"] for x in ev if x["truth"] in FIT_ENDS})
    kap = []
    for kappa in K_GRID:
        tot = 0.0
        for pxd in ntp:
            train = [x for x in ev if x["pxd"] != pxd]
            t, _, _, _ = fit_all(prior, train, ref_k, ref_r, kappa)
            for x in ev:
                if x["pxd"] == pxd and x["truth"] in FIT_ENDS:
                    v = true_ll(t, x)
                    tot += v if v is not None else 0.0
        kap.append((tot, kappa))
    best_kappa = max(kap, key=lambda z: (z[0], -(z[1] or 1e18)))[1]
    t, det, s_t, s_nt = fit_all(prior, ev, ref_k, ref_r, best_kappa)
    prov = f"{len(ev)} evaluable DEV runs of {len(R)}"
    write_table(dig / "digest_models_v2.tsv", t, det, s_t, s_nt, best_kappa, ref, out / "digest_models_v2.tsv", prov)
    # LOPO-CV classification with the port (kappa fixed), prior and v1 for comparison
    T1 = P.read_table(dig / "digest_models.tsv")
    cv, ins, v1, v0, per = [], [], [], [], []
    for pxd in sorted({x["pxd"] for x in ev}):
        train = [x for x in ev if x["pxd"] != pxd]
        tf, _, _, _ = fit_all(prior, train, ref_k, ref_r, best_kappa)
        for x in ev:
            if x["pxd"] != pxd:
                continue
            clf, reason = classify_run(tf, x)
            call = None if reason else clf["scores"][clf["top"]][1]
            clf_i, reason_i = classify_run(t, x)
            call_i = None if reason_i else clf_i["scores"][clf_i["top"]][1]
            c1 = P.classify(x["c"], x["n"], T1, 0.05, None, use_spec=False)
            r1 = P.decide(x["rep"], c1, False)
            call1 = None if r1 else c1["scores"][c1["top"]][1]
            f2 = reason in FLANK2_RULES
            cv.append((x["truth"], call, f2))
            ins.append((x["truth"], call_i))
            v1.append((x["truth"], call1))
            per.append({"run": x["name"], "pxd": pxd, "truth": x["truth"], "class": x["cls"], "v1": call1 or r1,
                        "fit_insample": call_i or reason_i, "fit_cv": call or reason,
                        "flank2_route": "yes" if f2 else "no"})
    res = {"runs": len(R), "evaluable": len(ev), "kappa_grid": [[z[0], z[1]] for z in kap], "kappa": best_kappa,
           "s_trypsin": s_t, "s_nontryptic": s_nt, "detection": det, "reference": ref,
           "cv_port": endpoint([(a, b) for a, b, f in cv if not f]),
           "cv_flank2_route_runs": sum(1 for _, _, f in cv if f),
           "insample_port": endpoint(ins), "v1_shipped_port": endpoint(v1)}
    (out / "fit_tables.json").write_text(json.dumps(res, indent=1, sort_keys=True, default=str) + "\n")
    with open(out / "fit_tables_runs.tsv", "w") as o:
        cols = list(per[0].keys())
        o.write("\t".join(cols) + "\n")
        for p in per:
            o.write("\t".join(str(p[c]) for c in cols) + "\n")
    print(json.dumps({k: v for k, v in res.items() if k not in ("reference",)}, indent=1, default=str))


def mode_fit_grid(repo, runs, check, dig, krf, out):
    """DEV iteration 2 (after iteration 1, mode fit_lik: the likelihood-chosen kappa 100 let the empirical Arg-C end
    absorb the K ends of the Arg-C runs and 23 tryptic DEV runs were called Arg-C). Every setting is chosen by
    LOPO-CV classification instead: grid detection {fitted, unit} x kappa {10, 100, 1000, 10000, rule-only} x
    s_trypsin x s_nontryptic {0.02, 0.05, 0.1, 0.2, 0.4} (250 points). Per point and PXD fold: detection and the
    empirical ends refitted without the fold (EM at the point's s_nontryptic), the fold's runs classified by the port.
    Score: CV balanced accuracy (no-call wrong) over the evaluable runs that do not take the flank2 route; ties:
    higher CV called accuracy, then the point nearest v1 (unit detection before fitted, rule-only, then larger
    kappa, |s - 0.05| smallest for trypsin then nontryptic)."""
    out.mkdir(parents=True, exist_ok=True)
    ref = dict(l.rstrip("\n").split("\t") for l in open(krf))
    ref_k, ref_r = float(ref["ref_k"]), float(ref["ref_r"])
    prior = P.read_table(dig / "digest_models_v2.tsv")
    R = load_runs(repo, runs, check)
    ev = [x for x in R if x["truth"]]
    pxds = sorted({x["pxd"] for x in ev})
    det_cache, end_cache = {}, {}

    def det_for(excl):
        if excl not in det_cache:
            det_cache[excl] = fit_detection([x for x in ev if x["pxd"] != excl], ref_k, ref_r)
        return det_cache[excl]

    def end_for(name, excl, kappa, s_nt):
        cls = prior_model(prior, name)["cls"]
        if not any(x["pxd"] == excl and x["truth"] == cls for x in ev):
            excl = None  # the fold has no run of this class: the full-data end
        k = (name, excl, kappa, s_nt)
        if k not in end_cache:
            end = FIT_ENDS[name]
            cnt = [0] * 19
            for x in ev:
                if x["pxd"] != excl and x["truth"] == cls and sum(x["c"]) >= P.TAG_MIN:
                    v = x["c"] if end == "C" else x["n"]
                    cnt = [a + b for a, b in zip(cnt, v)]
            bg = prior["bg_c"] if end == "C" else prior["bg_n"]
            end_cache[k] = em_end(cnt, prior_model(prior, name)[end], bg, s_nt, kappa)
        return end_cache[k]

    def table(excl, use_det, kappa, s_t, s_nt):
        t = {"models": [], "bg_c": prior["bg_c"], "bg_n": prior["bg_n"], "spec": [s_t, s_nt]}
        for m in prior["models"]:
            mm = dict(m)
            if m["name"] in FIT_ENDS:
                mm[FIT_ENDS[m["name"]]] = end_for(m["name"], excl, kappa, s_nt)
            t["models"].append(mm)
        d = det_for(excl) if use_det else {}
        t["detection"] = {c: {"C": det_vec(v), "N": [1.0] * 19} for c, v in d.items()}
        return t

    points = [(dt, k, st, sn) for dt in (False, True) for k in K_GRID for st in S_GRID for sn in S_GRID]
    scored = []
    route = {}
    for p in points:
        rows = []
        for pxd in pxds:
            t = table(pxd, *p)
            for x in ev:
                if x["pxd"] != pxd:
                    continue
                clf, reason = classify_run(t, x)
                if reason in FLANK2_RULES:
                    route[x["name"]] = True
                    continue
                rows.append((x["truth"], None if reason else clf["scores"][clf["top"]][1]))
        e = endpoint(rows)
        scored.append((p, e))
    def near(p):
        dt, k, st, sn = p
        return (dt, 0 if k is None else 1, -(k or 0), abs(st - 0.05), abs(sn - 0.05))
    best_p, best_e = min(scored, key=lambda pe: (-pe[1]["balanced_accuracy"], -pe[1]["called_accuracy"], near(pe[0])))
    dt, kappa, s_t, s_nt = best_p
    t = table(None, dt, kappa, s_t, s_nt)
    det = det_for(None) if dt else {}
    prov = f"{len(ev)} evaluable DEV runs of {len(R)}; LOPO-CV grid selection"
    write_table(dig / "digest_models_v2.tsv", t, det, s_t, s_nt, kappa, ref, out / "digest_models_v2.tsv", prov)
    T1 = P.read_table(dig / "digest_models.tsv")
    v1, per = [], []
    for x in ev:
        c1 = P.classify(x["c"], x["n"], T1, 0.05, None, use_spec=False)
        r1 = P.decide(x["rep"], c1, False)
        clf, reason = classify_run(t, x)
        tf = table(x["pxd"], dt, kappa, s_t, s_nt)
        clf_cv, reason_cv = classify_run(tf, x)
        if r1 not in FLANK2_RULES:
            v1.append((x["truth"], None if r1 else c1["scores"][c1["top"]][1]))
        per.append({"run": x["name"], "pxd": x["pxd"], "truth": x["truth"], "class": x["cls"],
                    "v1": (c1["scores"][c1["top"]][1] if not r1 else r1),
                    "fit_insample": (clf["scores"][clf["top"]][1] if not reason else reason),
                    "fit_cv": (clf_cv["scores"][clf_cv["top"]][1] if not reason_cv else reason_cv),
                    "flank2_route": "yes" if x["name"] in route else "no"})
    with open(out / "fit_grid.tsv", "w") as o:
        o.write("detection\tkappa\ts_trypsin\ts_nontryptic\tcv_balanced_accuracy\tcv_called\tcv_called_correct\tcv_n\n")
        for p, e in scored:
            o.write(f"{'fitted' if p[0] else 'unit'}\t{p[1] or 'rule'}\t{p[2]}\t{p[3]}\t{e['balanced_accuracy']:.4f}\t"
                    f"{e['called']}\t{e['called_correct']}\t{e['n']}\n")
    with open(out / "fit_tables_runs.tsv", "w") as o:
        cols = list(per[0].keys())
        o.write("\t".join(cols) + "\n")
        for p in per:
            o.write("\t".join(str(p[c]) for c in cols) + "\n")
    res = {"runs": len(R), "evaluable": len(ev), "flank2_route_runs": len(route), "point": {
        "detection": "fitted" if dt else "unit", "kappa": kappa, "s_trypsin": s_t, "s_nontryptic": s_nt},
        "detection_fit": det_for(None), "cv_selected": best_e, "v1_same_runs": endpoint(v1), "reference": ref}
    (out / "fit_tables.json").write_text(json.dumps(res, indent=1, sort_keys=True, default=str) + "\n")
    print(json.dumps({k: v for k, v in res.items() if k != "reference"}, indent=1, default=str))


def irls(X, y, lam=0.1, it=100):
    k = len(X[0])
    b = [0.0] * k
    for _ in range(it):
        H = [[0.0] * k for _ in range(k)]
        g = [0.0] * k
        for xi, yi in zip(X, y):
            z = sum(a * c for a, c in zip(xi, b))
            p = 1 / (1 + math.exp(-max(-30, min(30, z))))
            w = p * (1 - p)
            for i in range(k):
                g[i] += (yi - p) * xi[i]
                for j in range(k):
                    H[i][j] += w * xi[i] * xi[j]
        for i in range(1, k):
            g[i] -= lam * b[i]
            H[i][i] += lam
        # solve H d = g (Gauss)
        A = [row[:] + [gi] for row, gi in zip(H, g)]
        for c in range(k):
            piv = max(range(c, k), key=lambda r: abs(A[r][c]))
            A[c], A[piv] = A[piv], A[c]
            for r in range(k):
                if r != c and A[c][c] != 0:
                    f = A[r][c] / A[c][c]
                    A[r] = [a - f * bb for a, bb in zip(A[r], A[c])]
        d = [A[i][k] / A[i][i] if A[i][i] else 0.0 for i in range(k)]
        b = [bi + di for bi, di in zip(b, d)]
        if max(abs(x) for x in d) < 1e-10:
            break
    return b


def mode_calibrate(repo, runs, check, name, out):
    R = load_runs(repo, runs, check)
    data = []
    for x in R:
        if not x["truth"]:
            continue
        f = runs / x["name"] / f"{name}.digest.tsv"
        rep = P.read_report(f)
        if P.val(rep, "call", "status") != "call":
            continue
        m = P.val(rep, "call", "margin")
        nm = rep[("call", "margin")][1]
        fp = P.val(rep, "nocall", "ms2_first_peak") == "yes"
        data.append({"run": x["name"], "pxd": x["pxd"], "margin": float(m) if m not in ("-", None) else 0.0,
                     "n": int(nm) if nm not in ("-", None) else 1, "fp": fp,
                     "y": 1 if P.val(rep, "call", "class") == x["truth"] else 0})
    feats = lambda d: [1.0, d["margin"], math.log(max(d["n"], 1)), 1.0 if d["fp"] else 0.0]
    b = irls([feats(d) for d in data], [d["y"] for d in data])
    for d in data:
        tr = [e for e in data if e["pxd"] != d["pxd"]]
        bb = irls([feats(e) for e in tr], [e["y"] for e in tr])
        z = sum(a * c for a, c in zip(feats(d), bb))
        d["p_cv"] = 1 / (1 + math.exp(-z))
    # DEV iteration 2 of the threshold rule (iteration 1, the smallest t meeting called accuracy >= 0.95 with LB >=
    # 0.90 else the highest called accuracy, chose 0.95 and cut the in-sample balanced accuracy from 0.65 to 0.19):
    # the threshold that maximises the LOPO-CV balanced accuracy (no-call wrong, all evaluable runs) among those whose
    # CV called accuracy is >= 0.95; none -> 0 (no call withheld). Ties: the smaller threshold.
    allrows = []
    pc = {d["run"]: d["p_cv"] for d in data}
    for x in R:
        if not x["truth"]:
            continue
        rep = P.read_report(runs / x["name"] / f"{name}.digest.tsv")
        call = P.val(rep, "call", "class") if P.val(rep, "call", "status") == "call" else None
        allrows.append((x["truth"], call, pc.get(x["name"])))
    grid = []
    for t in (0.0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95):
        kept = [d for d in data if d["p_cv"] >= t]
        k = sum(d["y"] for d in kept)
        acc = k / len(kept) if kept else float("nan")
        e = endpoint([(tr, c if (c is not None and p is not None and p >= t) else None) for tr, c, p in allrows])
        grid.append({"t": t, "kept": len(kept), "correct": k, "acc": acc, "wilson_lb": wilson(k, len(kept))[0],
                     "cv_balanced_accuracy": e["balanced_accuracy"], "cv_accuracy_nocall_wrong": e["accuracy_nocall_wrong"]})
    okt = [g for g in grid if g["kept"] and g["acc"] >= 0.95]
    if okt:
        chosen, met = max(okt, key=lambda g: (g["cv_balanced_accuracy"], -g["t"])), True
    else:
        chosen, met = grid[0], False
    cal = out / "digest_calibration.tsv"
    cal.write_text(
        "# FASTag 1.12 calibration of the protease call (#3f) for -digest_min_confidence: a logistic model\n"
        "# p_correct = 1 / (1 + exp(-(intercept + margin * margin + log_n * ln(n) + first_peak * first_peak))).\n"
        f"# FITTED on {len(data)} called evaluable DEV runs of the 1.12 RC a117801 (pass {name}, the fitted v2 table) by\n"
        "# acceptance/1.12/dev/scripts/fit_chem.py calibrate (IRLS, L2 0.1 on the slopes); not validated on held-out data.\n"
        f"# -digest_min_confidence chosen on LOPO-CV: {chosen['t']} (the best CV balanced accuracy among thresholds with CV called\n"
        f"# accuracy >= 0.95: {'found' if met else 'none, so 0'}; CV called accuracy {chosen['acc']:.3f}, Wilson LB {chosen['wilson_lb']:.3f}).\n"
        "feature\tcoef\n"
        f"intercept\t{b[0]!r}\nmargin\t{b[1]!r}\nlog_n\t{b[2]!r}\nfirst_peak\t{b[3]!r}\n")
    res = {"pass": name, "n": len(data), "correct": sum(d["y"] for d in data), "coef": b, "grid": grid,
           "min_confidence": chosen["t"], "constraint_met": met}
    (out / "fit_calibration.json").write_text(json.dumps(res, indent=1) + "\n")
    print(json.dumps(res, indent=1))


def mode_eval(repo, runs, check, passes, out):
    """The binary's calls of each pass (B v1 shipped, V0 v2 prior, V1 fitted table, V2 fitted table + calibration +
    min_confidence) on the evaluable DEV runs: the primary endpoint and per-class recall. In-sample for V1/V2."""
    R = [x for x in load_runs(repo, runs, check) if x["truth"]]
    res, per = {}, {}
    names = passes.split(",")
    for name in names:
        rows = []
        for x in R:
            rep = P.read_report(runs / x["name"] / f"{name}.digest.tsv")
            call = P.val(rep, "call", "class") if P.val(rep, "call", "status") == "call" else None
            rows.append((x["truth"], call))
            per.setdefault(x["name"], {"truth": x["truth"], "pxd": x["pxd"], "class": x["cls"]})[name] = \
                call or P.val(rep, "call", "reason")
        e = endpoint(rows)
        tims = [(t, c) for (t, c), x in zip(rows, R) if x["cls"] == "timstof"]
        e["timstof_runs"] = len(tims)
        e["timstof_called"] = sum(1 for t, c in tims if c is not None)
        e["timstof_called_correct"] = sum(1 for t, c in tims if c is not None and t == c)
        res[name] = e
    (out / "eval_passes.json").write_text(json.dumps(res, indent=1) + "\n")
    with open(out / "eval_passes_runs.tsv", "w") as o:
        o.write("run\tpxd\ttruth\tinstrument_class\t" + "\t".join(names) + "\n")
        for k, v in sorted(per.items()):
            o.write(f"{k}\t{v['pxd']}\t{v['truth']}\t{v['class']}\t" + "\t".join(str(v[n]) for n in names) + "\n")
    for n, e in res.items():
        print(n, f"BA {e['balanced_accuracy']:.4f}", {g: (round(r, 3), m) for g, (r, m) in e["recall"].items()},
              f"called {e['called']}/{e['n']} correct {e['called_correct']} acc {e['called_accuracy']:.4f}",
              f"LB {e['called_accuracy_wilson'][0]:.4f} all {e['accuracy_nocall_wrong']:.4f}",
              f"timsTOF {e['timstof_called_correct']}/{e['timstof_called']} of {e['timstof_runs']}")


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "eval":
        mode_eval(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], sys.argv[5], Path(sys.argv[6]))
    elif mode == "fit":
        mode_fit_grid(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], Path(sys.argv[5]), sys.argv[6], Path(sys.argv[7]))
    elif mode == "fit_lik":
        mode_fit(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], Path(sys.argv[5]), sys.argv[6], Path(sys.argv[7]))
    elif mode == "calibrate":
        mode_calibrate(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], sys.argv[5], Path(sys.argv[6]))
