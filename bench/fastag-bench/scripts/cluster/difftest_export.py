#!/usr/bin/env python3
"""Export the prose-auto 0.1.3 differential test of FASTag 1.8.0 (release) and 1.9.0 (release) as two per-run
tables. Runs on the node that holds the work directories; reads only layer1.json/status.json of each run and the
run list with the stored prose-auto 0.1.3 decisions (runs.json). prose-auto's code is imported only for its
model-to-protease class map (TAG_MODELS); its digest-model table is not read or written.

    python3 difftest_export.py RUNS_JSON PY013_DIR W180 W190 OUTDIR

Layer 1: prose-auto 0.1.3's detector code applied to FASTag's own full-precision tag table, compared value by
value with FASTag's native termini (-digest_out) and mass-gap (-massgap_out) reports.
Layer 2: FASTag's native calls against the calls prose-auto 0.1.3 stored from its own tagging of the runs, and
both against the run's truth label in prose-auto's validation record.
"""
import csv, json, os, sys

RUNS, PY013, W180, W190, OUT = sys.argv[1:6]
sys.path.insert(0, PY013)
import prose_auto.external as ext  # noqa: E402

CLASS013 = ext.TAG_MODELS
SHIPPED = {"Trypsin": "Trypsin", "Lys-C": "Lys-C", "Arg-C": "Arg-C", "Glu-C": "Glu-C", "Chymotrypsin": "Chymotrypsin",
           "Asp-N": "Asp-N", "Lys-N": "Lys-N", "unspecific": "unspecific cleavage"}
VERS = (("1.8.0", W180), ("1.9.0", W190))


def truth_ok(truth, cls):
    t = (truth or "").replace(" (file name)", "")
    if not t or t == "LysargiNase" or cls is None:
        return ""
    return "yes" if cls == t else "no"


def alk_ok(truth, value):
    if not truth or truth == "none stated":
        return ""
    if value in (None, "", "unknown"):
        return "unknown"
    return "yes" if value.replace(" (C)", "") == truth else "no"


def b(x):
    return "" if x is None else str(x)


R = json.load(open(RUNS))
L1 = [["fastag", "set", "acc", "run", "report", "values_checked", "differences", "inexact_floats", "max_rel_diff",
       "difference_detail"]]
L2 = [["set", "acc", "run", "instrument", "truth_enzyme", "truth_alkylation", "stored_call", "stored_runner_up",
       "stored_alkylation"]]
for v, _ in VERS:
    t = v.replace(".", "")
    L2[0] += [f"status_{t}", f"reason_{t}", f"call_{t}", f"runner_up_{t}", f"would_call_{t}", f"same_call_as_stored_{t}",
              f"correct_proseauto_table_{t}", f"call_shipped_{t}", f"correct_shipped_{t}", f"alkylation_{t}",
              f"same_alkylation_as_stored_{t}", f"alkylation_correct_{t}"]
for r in R:
    row = [r["set"], r["acc"], r["run"], r["instrument"], b(r.get("truth_enzyme")), b(r.get("truth_alk"))]
    S = r.get("termini") or {}
    sc = S.get("tag_call")
    sa = r["alk"][-1]["value"] if r.get("alk") else None
    row += [b(sc) if "cterm_tags" in S else "", b(S.get("tag_runner_up")) if "cterm_tags" in S else "", b(sa)]
    any_l1 = False
    for v, W in VERS:
        p = f"{W}/{r['set']}__{r['acc']}__{r['run']}/layer1.json"
        L = json.load(open(p)) if os.path.exists(p) else {}
        for rep, k in (("termini", "termini_cmp"), ("massgap", "massgap_cmp")):
            c = L.get(k)
            if c:
                any_l1 = True
                L1.append([v, r["set"], r["acc"], r["run"], rep, c["checked"], len(c["diffs"]), c["inexact_floats"],
                           f"{c['max_rel']:.3g}", "; ".join(" ".join(map(str, d)) for d in c["diffs"])])
        A = L.get("native_A") if "cterm_tags" in S else None
        if A:
            nc = A["model"] if A["status"] == "call" else None
            w = A["would_call"][0] if A.get("would_call") else None
            Bn = L.get("native_B") or {}
            bc = Bn.get("model") if Bn.get("status") == "call" else None
            row += [A["status"], b(A["reason"]), b(nc), b(A["runner_up"]) if nc else "", b(w),
                    ("yes" if nc == sc else "no") if (nc and sc) else "",
                    truth_ok(r.get("truth_enzyme"), CLASS013.get(nc)) if nc else "",
                    b(bc), truth_ok(r.get("truth_enzyme"), SHIPPED.get(bc)) if bc else ""]
        else:
            row += [""] * 9
        pa = L.get("py_alk") if r.get("alk") else None
        if pa:
            row += [pa[0], "yes" if pa[0] == sa else "no", alk_ok(r.get("truth_alk"), pa[0])]
        else:
            row += ["", "", ""]
    if any_l1 or any(row[9:]):
        L2.append(row)

HDR = ("# source: prose-auto 0.1.3 differential test, node data, work dirs /scratch/kohlbach/fastag-digest-val-v180rel/w "
       "(FASTag 1.8.0 release bundle) and /scratch/kohlbach/fastag-digest-val-v190/w (FASTag 1.9.0 release bundle), "
       "same runs, flags and environment; exported by scripts/cluster/difftest_export.py\n")
os.makedirs(OUT, exist_ok=True)
with open(f"{OUT}/difftest_layer1_v180_vs_v190.tsv", "w", newline="") as fh:
    fh.write(HDR)
    fh.write("# layer 1: prose-auto 0.1.3 detector code (unmodified) on FASTag's own full-precision tag table vs FASTag's "
             "native termini and mass-gap reports; one row per FASTag version, run and report; all public PXD runs\n")
    csv.writer(fh, delimiter="\t", lineterminator="\n").writerows(L1)
with open(f"{OUT}/difftest_layer2_v180_vs_v190.tsv", "w", newline="") as fh:
    fh.write(HDR)
    fh.write("# layer 2: FASTag native calls vs the calls prose-auto 0.1.3 stored from its own tagging; truth_enzyme and "
             "truth_alkylation = prose-auto validation record (runs.json; '(file name)' = inferred from the file name), not "
             "the SDRF truth of Table 5; correct_proseauto_table = call with prose-auto's model table (pass A), "
             "call_shipped/correct_shipped = FASTag's shipped models (pass B); alkylation_correct is empty where the truth is "
             "missing or 'none stated'; all public PXD runs\n")
    csv.writer(fh, delimiter="\t", lineterminator="\n").writerows(L2)
print(len(L1) - 1, len(L2) - 1)
