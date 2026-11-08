#!/usr/bin/env python3
"""DEV test helper only: score_item03.py's call reading plus fit_chem.endpoint() over all evaluable DEV runs
(every enzyme class, as fit_chem.py mode_eval) must reproduce dev/chem/eval_passes.json for passes B and V2b.
Usage: check_item03_endpoint.py <repo> <work dir>"""
import json
import sys
from pathlib import Path

REPO, W = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(REPO / "acceptance/1.12/scorers"))
import acclib as A  # noqa: E402
import score_item03 as S3  # noqa: E402

ref = json.loads((REPO / "acceptance/1.12/dev/chem/eval_passes.json").read_text())
rows = A.read_tsv(W / "chem_runtable.tsv")
ok = True
for cfg, name in (("CFG-03-base", "B"), ("CFG-03-cand", "V2b")):
    ev = []
    for r in rows:
        if r["enzyme_truth"] not in S3.CLASSES:
            continue
        c = S3.call_of(W / "runs" / cfg / "dev03" / r["run_dir"] / "termini/digest.tsv", "call", "class")
        if c == "NO_REPORT":
            continue
        ev.append((S3.CLASSES[r["enzyme_truth"]], c))
    e = S3.endpoint(ev)
    same = all(abs(e[k] - ref[name][k]) < 1e-12 for k in ("balanced_accuracy", "called_accuracy", "accuracy_nocall_wrong")) \
        and e["n"] == ref[name]["n"] and e["called"] == ref[name]["called"]
    ok &= same
    print(name, cfg, "n", e["n"], "called", e["called"], "BA", round(e["balanced_accuracy"], 6),
          "ref BA", round(ref[name]["balanced_accuracy"], 6), "SAME" if same else "DIFFERENT")
print("ENDPOINT_REPRODUCED" if ok else "ENDPOINT_MISMATCH")
