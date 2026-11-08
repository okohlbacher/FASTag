#!/usr/bin/env python3
"""Check chemport.py against the RC binary on the DEV regeneration: for every run with a B (v1 shipped table) and a
V0 (v2 prior table, detection shipped, flank2 auto) report, the port's per-model log-likelihoods (relative 1e-9),
the called model or no-call reason (flank2 runs excepted: they take the binary's result) must equal the report's.
Usage: check_port.py <runs dir> <digest dir> <out tsv>   (exit 1 on any mismatch)"""
import math, os, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chemport as P  # noqa: E402

RUNS, DIG, OUT = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
T1 = P.read_table(DIG / "digest_models.tsv")
T2 = P.read_table(DIG / "digest_models_v2.tsv")
rows, bad = [], 0
for d in sorted(RUNS.iterdir()):
    for tag, t, v2 in (("B", T1, False), ("V0", T2, True)):
        f = d / f"{tag}.digest.tsv"
        if not f.exists():
            continue
        rep = P.read_report(f)
        c, n = P.run_counts(rep)
        cls = P.val(rep, "meta", "instrument_class")
        det = t["detection"].get(cls) if v2 else None
        clf = P.classify(c, n, t, 0.05, det, use_spec=v2)
        worst = 0.0
        if clf["scored"]:
            for name, _, ll in clf["scores"]:
                b = float(P.val(rep, "model", f"{name}.loglik"))
                if math.isinf(b) and math.isinf(ll):
                    continue
                worst = max(worst, abs(ll - b) / max(1.0, abs(b)))
        reason = P.decide(rep, clf, v2 and det is not None and cls == "timstof")
        flank2 = P.val(rep, "call", "flank2_used") == "yes"
        b_status = P.val(rep, "call", "status")
        b_out = P.val(rep, "call", "model") if b_status == "call" else P.val(rep, "call", "reason")
        p_out = clf["scores"][clf["top"]][0] if not reason else reason
        ok = worst <= 1e-9 and (flank2 or p_out == b_out)
        bad += not ok
        rows.append(f"{d.name}\t{tag}\t{worst:.3g}\t{b_out}\t{p_out}\t{'yes' if flank2 else 'no'}\t{'OK' if ok else 'MISMATCH'}")
with open(OUT, "w") as o:
    o.write("run\tpass\tmax_rel_loglik_diff\tbinary\tport\tflank2_used\tresult\n" + "\n".join(rows) + "\n")
print(f"{len(rows)} reports, {bad} mismatches")
sys.exit(1 if bad else 0)
