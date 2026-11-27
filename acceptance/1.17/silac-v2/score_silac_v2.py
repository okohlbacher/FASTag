"""Scorer of PREREG-silac-v2 (held-out test of -label_format 2). Run once on the held-out outputs.

Usage: python3 -I score_silac_v2.py TRUTH_TSV RUNS_TSV OUTDIR

TRUTH_TSV  (truth script output; one row per run): pxd, file, instrument_class, tier, design,
           and per label L in Lys4 Arg6 Lys8 Arg10: h_<L>, e_<L>, share_<L>, truth_<L> (present|absent|ambiguous).
RUNS_TSV   pxd, file, label_tsv (path of the run's -label_out, or empty when the task failed or is missing).
OUTDIR     endpoints.tsv, per_run.tsv, per_label.tsv, verdict.txt (written once).

Rules (PREREG-silac-v2 sections 4 and 5, frozen):
- pair (run, L) with truth present or absent; a run without label_tsv has every label not_assessable,
  silac2 no call and label_call no call.
- E1 recall = present calls / truth-present pairs (not_assessable counts as a miss).
  PASS: pooled >= 0.80 and pooled Wilson low >= 0.70, and >= 0.70 in each class.
- E2 false-present = present calls / truth-absent pairs.
  PASS: pooled <= 0.05 and pooled Wilson high <= 0.10, and <= 0.08 in each class.
- E3 on labelled runs (any truth-present label): v2 correct when silac2 status is call and its silac names at
  least one truth-present label and no truth-absent label; v1 correct when label_call silac is weak or strong.
  On light-only runs (every label truth-absent): v2 false SILAC when silac2 names any label; v1 when label_call
  silac is weak or strong. PASS: v2 - v1 >= 0.20 on labelled runs and v2 false - v1 false <= 0.02 on
  light-only runs, pooled and in each class.
- A class with fewer than 15 truth-present pairs or fewer than 15 light-only runs is inconclusive for every
  endpoint; the pooled verdict needs both classes conclusive and passing (section 5).
"""
import csv, math, os, sys

LABELS = ("Lys4", "Arg6", "Lys8", "Arg10")
CLASSES = ("orbitrap", "timstof")
Z = 1.959963984540054


def wilson(k, n):
    if n == 0: return (float("nan"), float("nan"))
    p = k / n; d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d; h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return (0.0 if k == 0 else max(0.0, c - h), 1.0 if k == n else min(1.0, c + h))


def report(path):
    out = {}
    if path and os.path.exists(path):
        with open(path) as f:
            for r in csv.DictReader(f, delimiter="\t"):
                out[(r["section"], r["key"])] = r["value"]
    return out


def main():
    truth_p, runs_p, out = sys.argv[1:4]
    truth = {(r["pxd"], r["file"]): r for r in csv.DictReader(open(truth_p), delimiter="\t")}
    runs = {(r["pxd"], r["file"]): r for r in csv.DictReader(open(runs_p), delimiter="\t")}
    per_run, pairs = [], []
    for key, t in sorted(truth.items()):
        rp = report(runs.get(key, {}).get("label_tsv", ""))
        ok_task = bool(rp)
        calls = {L: (rp.get(("silac2", f"{L}.call"), "not_assessable") if ok_task else "not_assessable") for L in LABELS}
        reasons = {L: (rp.get(("silac2", f"{L}.reason"), "task_failed") if ok_task else "task_failed") for L in LABELS}
        v2_status = rp.get(("silac2", "status"), "no_call") if ok_task else "no_call"
        v2_silac = rp.get(("silac2", "silac"), "-") if ok_task else "-"
        v1_silac = rp.get(("label_call", "silac"), "-") if ok_task else "-"
        named = set() if v2_status != "call" or v2_silac in ("none", "-") else set(v2_silac.split("+"))
        tr = {L: t[f"truth_{L}"] for L in LABELS}
        present = {L for L in LABELS if tr[L] == "present"}
        absent = {L for L in LABELS if tr[L] == "absent"}
        labelled = bool(present)
        light_only = len(absent) == len(LABELS)
        v2_ok = labelled and bool(named & present) and not (named & absent)
        v1_ok = labelled and v1_silac in ("weak", "strong")
        v2_false = light_only and bool(named)
        v1_false = light_only and v1_silac in ("weak", "strong")
        cls = t["instrument_class"]
        per_run.append(dict(pxd=key[0], file=key[1], instrument_class=cls, tier=t["tier"], design=t["design"], task_ok=ok_task,
                            **{f"truth_{L}": tr[L] for L in LABELS}, **{f"share_{L}": t[f"share_{L}"] for L in LABELS},
                            **{f"call_{L}": calls[L] + ("" if reasons[L] in ("-", "") else ":" + reasons[L]) for L in LABELS},
                            **{f"v2share_{L}": rp.get(("silac2", f"{L}.share"), "") for L in LABELS},
                            y_gate=rp.get(("route", "y.gate"), ""), v2_status=v2_status, v2_silac=v2_silac,
                            v2_reason=rp.get(("silac2", "reason"), "task_failed" if not ok_task else ""),
                            v1_label=rp.get(("label_call", "label"), ""), v1_silac=v1_silac,
                            labelled=labelled, light_only=light_only, v2_ok=v2_ok, v1_ok=v1_ok,
                            v2_false=v2_false, v1_false=v1_false))
        for L in LABELS:
            if tr[L] in ("present", "absent"):
                pairs.append(dict(pxd=key[0], file=key[1], cls=cls, label=L, truth=tr[L], call=calls[L], reason=reasons[L]))

    def e1(sel):
        P = [p for p in sel if p["truth"] == "present"]; k = sum(p["call"] == "present" for p in P)
        return k, len(P)

    def e2(sel):
        A = [p for p in sel if p["truth"] == "absent"]; k = sum(p["call"] == "present" for p in A)
        return k, len(A)

    def e3(sel):
        lab = [r for r in sel if r["labelled"]]; lo = [r for r in sel if r["light_only"]]
        return (sum(r["v2_ok"] for r in lab), sum(r["v1_ok"] for r in lab), len(lab),
                sum(r["v2_false"] for r in lo), sum(r["v1_false"] for r in lo), len(lo))

    rows, verdict = [], {}
    scopes = [(c, [p for p in pairs if p["cls"] == c], [r for r in per_run if r["instrument_class"] == c]) for c in CLASSES]
    scopes.append(("pooled", pairs, per_run))
    conclusive = {}
    for name, ps, rs in scopes:
        k1, n1 = e1(ps); k2, n2 = e2(ps); a, b, nl, fa, fb, nlo = e3(rs)
        if name != "pooled": conclusive[name] = n1 >= 15 and nlo >= 15
        lo1, hi1 = wilson(k1, n1); lo2, hi2 = wilson(k2, n2)
        r1 = k1 / n1 if n1 else float("nan"); r2 = k2 / n2 if n2 else float("nan")
        d3 = (a - b) / nl if nl else float("nan"); f3 = (fa - fb) / nlo if nlo else float("nan")
        if name == "pooled":
            p1 = n1 > 0 and r1 >= 0.80 and lo1 >= 0.70; p2 = n2 > 0 and r2 <= 0.05 and hi2 <= 0.10
        else:
            p1 = n1 > 0 and r1 >= 0.70; p2 = n2 > 0 and r2 <= 0.08
        p3 = nl > 0 and nlo > 0 and d3 >= 0.20 and f3 <= 0.02
        concl = conclusive.get(name, True) if name != "pooled" else all(conclusive.values())
        word = lambda p: ("PASS" if p else "FAIL") if concl else "INCONCLUSIVE"
        verdict[name] = dict(E1=word(p1), E2=word(p2), E3=word(p3))
        rows += [
            dict(scope=name, endpoint="E1 recall", k=k1, n=n1, value=r1, ci_low=lo1, ci_high=hi1, verdict=word(p1)),
            dict(scope=name, endpoint="E2 false-present", k=k2, n=n2, value=r2, ci_low=lo2, ci_high=hi2, verdict=word(p2)),
            dict(scope=name, endpoint="E3 labelled runs v2 correct", k=a, n=nl, value=a / nl if nl else float("nan"),
                 ci_low=wilson(a, nl)[0], ci_high=wilson(a, nl)[1], verdict=""),
            dict(scope=name, endpoint="E3 labelled runs v1 correct", k=b, n=nl, value=b / nl if nl else float("nan"),
                 ci_low=wilson(b, nl)[0], ci_high=wilson(b, nl)[1], verdict=""),
            dict(scope=name, endpoint="E3 v2 - v1 on labelled runs", k="", n=nl, value=d3, ci_low="", ci_high="", verdict=""),
            dict(scope=name, endpoint="E3 light-only false SILAC v2", k=fa, n=nlo, value=fa / nlo if nlo else float("nan"),
                 ci_low=wilson(fa, nlo)[0], ci_high=wilson(fa, nlo)[1], verdict=""),
            dict(scope=name, endpoint="E3 light-only false SILAC v1", k=fb, n=nlo, value=fb / nlo if nlo else float("nan"),
                 ci_low=wilson(fb, nlo)[0], ci_high=wilson(fb, nlo)[1], verdict=""),
            dict(scope=name, endpoint="E3", k="", n="", value=f3, ci_low="", ci_high="", verdict=word(p3)),
        ]
    # secondary: per label and class
    per_label = []
    for c in CLASSES + ("pooled",):
        for L in LABELS:
            ps = [p for p in pairs if p["label"] == L and (c == "pooled" or p["cls"] == c)]
            k1, n1 = e1(ps); k2, n2 = e2(ps)
            na = [p for p in ps if p["truth"] == "present" and p["call"] == "not_assessable"]
            reasons = {}
            for p in na: reasons[p["reason"]] = reasons.get(p["reason"], 0) + 1
            per_label.append(dict(scope=c, label=L, present_called=k1, present=n1, recall=k1 / n1 if n1 else "",
                                  absent_called_present=k2, absent=n2, false_present=k2 / n2 if n2 else "",
                                  not_assessable_present=len(na), reasons=";".join(f"{k}:{v}" for k, v in sorted(reasons.items()))))
    os.makedirs(out, exist_ok=False)
    def w(name, data):
        with open(os.path.join(out, name), "w") as f:
            wr = csv.DictWriter(f, list(data[0]), delimiter="\t"); wr.writeheader(); wr.writerows(data)
    w("endpoints.tsv", rows); w("per_run.tsv", per_run); w("per_label.tsv", per_label)
    with open(os.path.join(out, "verdict.txt"), "w") as f:
        for name in CLASSES + ("pooled",):
            f.write(f"{name}: conclusive={conclusive.get(name, all(conclusive.values()))} " +
                    " ".join(f"{k}={v}" for k, v in verdict[name].items()) + "\n")
    print(open(os.path.join(out, "verdict.txt")).read(), end="")


if __name__ == "__main__":
    main()
