#!/usr/bin/env python3
"""#3a parity: FASTag's label_call (B.label.tsv, RC a117801) against the pinned prose-auto 0.1.10 rule
(prose_auto.external.termini_evidence, read-only copy at prose-auto-20261029/harness/v0110c_code) on the same
-digest_out/-label_out reports of each DEV run. prose-auto's label evidence is mapped to FASTag's label names
(TMT6/10/11plex -> TMT, TMTpro (16/18plex) -> TMTpro, iTRAQ4plex -> iTRAQ4, SILAC (Lys8/Arg10) -> SILAC; no label
evidence -> label-free, or no_call below its TAG_MIN). Also the accuracy of label_call against the SDRF label
truth (TMTpro and iTRAQ8 one class; dimethyl and unspecified isotope labels not evaluable), and the majority baseline.
Usage: label_parity.py <prose_auto code dir> <repo> <runs dir> <check tsv> <out tsv>"""
import csv, collections, sys
from pathlib import Path

CODE, REPO, RUNS, CHECK, OUT = sys.argv[1:6]
sys.path.insert(0, CODE)
from prose_auto import external as X  # noqa: E402

MAP = {"TMT6/10/11plex": "TMT", "TMTpro (16/18plex)": "TMTpro", "iTRAQ4plex": "iTRAQ4", "SILAC (Lys8/Arg10)": "SILAC"}
ok = {r["run_id"] for r in csv.DictReader(open(CHECK), delimiter="\t") if r["result"] == "PASS"}
truth = {}
for r in csv.DictReader((l for l in open(f"{REPO}/acceptance/1.12/inputs/sdrf_truth_runs.tsv") if not l.startswith("# ")),
                        delimiter="\t"):
    truth[f"{r['set']}__{r['acc']}__{r['run']}"] = r["label_truth"]


def lab_class(x):
    return {"TMTpro": "TMTpro/iTRAQ8", "iTRAQ8": "TMTpro/iTRAQ8"}.get(x, x)


rows, same, n = [], 0, 0
ev_rows = []
for k in sorted(ok):
    d, lb = Path(RUNS) / k / "B.digest.tsv", Path(RUNS) / k / "B.label.tsv"
    if not d.exists():
        continue
    rd, rl = X._report(str(d)), X._report(str(lb))
    ev, stats = X.termini_evidence(rd, rl)
    labs = sorted({MAP[e.value] for e in ev if e.parameter == "label"})
    tot = stats.get("cterm_tags", 0)
    if tot < X.TAG_MIN:
        prose = "no_call"
    elif not labs:
        prose = "label-free"
    else:
        prose = "+".join(labs)
    st = rl.get(("label_call", "status"))
    fa = rl.get(("label_call", "label")) if st == "call" else "no_call"
    n += 1
    eq = prose == fa
    same += eq
    t = truth.get(k, "")
    rows.append([k, str(tot), prose, fa, "same" if eq else "DIFF", t])
    if t in ("label-free", "TMT", "TMTpro", "iTRAQ8", "iTRAQ4", "SILAC"):
        ev_rows.append((lab_class(t), lab_class(fa) if fa != "no_call" else None))
with open(OUT, "w") as o:
    o.write("run\tcterm_tags\tprose_auto_0_1_10\tfastag_label_call\tparity\tsdrf_label\n")
    for r in rows:
        o.write("\t".join(r) + "\n")
maj = collections.Counter(t for t, _ in ev_rows).most_common(1)[0] if ev_rows else ("-", 0)
acc = sum(1 for t, c in ev_rows if t == c) / len(ev_rows) if ev_rows else float("nan")
print(f"parity {same}/{n} ({same / n:.4f}); TAG_MIN prose {X.TAG_MIN}")
print(f"label accuracy (no-call wrong) {acc:.4f} on {len(ev_rows)} evaluable; majority '{maj[0]}' "
      f"{maj[1] / len(ev_rows):.4f}")
