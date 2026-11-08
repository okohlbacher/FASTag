#!/usr/bin/env python3
"""Score FASTag's digest, label and alkylation calls against the SDRF ground truth (Table S4, Figure 7; output files keep the table_s3 prefix).

Inputs (results/): sdrf_truth_runs.tsv (scripts/sdrf_truth.py), digest_calls_v180.tsv
(scripts/extract_digest_calls.py on the FASTag 1.8.0 release reports), digest_val_runs.tsv (instrument).
Outputs (results/): table_s3_digest_truth.tsv (per run), fig7_digest_summary.tsv (accuracy per model set
and class), fig7_confusion.tsv (long confusion matrices).

Rules
- Protease: correct when FASTag's call class equals the SDRF class (Trypsin+Lys-C double digests count as
  Trypsin). 'accuracy_called' = correct / runs with a call; 'accuracy_all' = correct / evaluable runs
  (a no-call counts as wrong). Truth classes FASTag has no model for (LysargiNase, mixed) are listed but
  not evaluable.
- Label: TMTpro and iTRAQ8plex add the same 304.2 Da and are one class ('TMTpro/iTRAQ8'); dimethyl has no
  detector and 'isotope labeling' without a named label is not evaluable. The termini call is prose-auto's
  rule on -label_out; 'combined' also takes FASTag's own -massgap_out SILAC call.
- Alkylation: prose-auto's rule on the -massgap_out cysteine counts; 'unknown' is a no-call. An SDRF that
  lists modifications without a cysteine one is truth 'none' (correct when the call is 'unknown').
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

import pandas as pd  # noqa: E402

from fastag_bench.tsv import read_tsv, write_tsv  # noqa: E402

ENZ_MODELLED = {"Trypsin", "Lys-C", "Arg-C", "Asp-N", "Glu-C", "Chymotrypsin", "Lys-N", "unspecific"}
LAB_EVAL = {"label-free", "TMT", "TMTpro/iTRAQ8", "iTRAQ4", "SILAC"}


def lab_class(x):
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return None
    return {"TMTpro": "TMTpro/iTRAQ8", "iTRAQ8": "TMTpro/iTRAQ8"}.get(x, x)


def nz(x):
    return None if x is None or (isinstance(x, float) and pd.isna(x)) or x == "" else x


def summarize(df, task, truth, call, model, evaluable, nocall_value=None):
    ev = df[evaluable].copy()
    called = ev[ev[call].notna() & (ev[call] != nocall_value)] if nocall_value else ev[ev[call].notna()]
    corr = (called[call] == called[truth])
    out = [{"task": task, "model": model, "class": "all", "evaluable": len(ev), "called": len(called),
            "correct": int(corr.sum()), "no_call": len(ev) - len(called),
            "accuracy_called": round(corr.mean(), 4) if len(called) else None,
            "accuracy_all": round(corr.sum() / len(ev), 4) if len(ev) else None}]
    for c in sorted(ev[truth].unique()):
        e = ev[ev[truth] == c]
        k = called[called[truth] == c]
        out.append({"task": task, "model": model, "class": c, "evaluable": len(e), "called": len(k),
                    "correct": int((k[call] == c).sum()), "no_call": len(e) - len(k),
                    "accuracy_called": round((k[call] == c).mean(), 4) if len(k) else None,
                    "accuracy_all": round((k[call] == c).sum() / len(e), 4) if len(e) else None})
    return out


def confusion(df, panel, truth, call, evaluable, nocall_label="no call"):
    e = df[evaluable].copy()
    e["_c"] = e[call].fillna(nocall_label)
    m = e.groupby([truth, "_c"]).size().reset_index(name="n")
    m.columns = ["truth", "call", "n"]
    m.insert(0, "panel", panel)
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", default=str(HERE.parent / "results"))
    ap.add_argument("--tag", default="v180",
                    help="FASTag release of the calls: reads digest_calls[_nontryptic]_<tag>.tsv; outputs carry "
                         "_<tag> unless it is v180 (the published file names)")
    a = ap.parse_args()
    res = Path(a.results)
    sfx = "" if a.tag == "v180" else f"_{a.tag}"
    ver = ".".join(a.tag.lstrip("v")) if a.tag.lstrip("v").isdigit() else a.tag
    truth, tprov = read_tsv(res / "sdrf_truth_runs.tsv")
    cfiles = [p for p in (res / f"digest_calls_{a.tag}.tsv", res / f"digest_calls_nontryptic_{a.tag}.tsv") if p.exists()]
    calls = pd.concat([read_tsv(p)[0] for p in cfiles], ignore_index=True)
    cprov = ["; ".join(f"{p.name}: {read_tsv(p)[1][0]}" for p in cfiles)]
    rfiles = [p for p in (res / "digest_val_runs.tsv", res / "digest_nontryptic_runs.tsv") if p.exists()]
    runs = pd.concat([read_tsv(p)[0] for p in rfiles], ignore_index=True)
    df = truth.merge(calls, on=["set", "acc", "run"], how="left").merge(
        runs[["set", "acc", "run", "instrument"]], on=["set", "acc", "run"], how="left")

    df["enzyme_evaluable"] = df["enzyme_truth"].isin(ENZ_MODELLED) & df["prose_status"].notna()
    for m in ("prose", "shipped"):
        df[f"{m}_correct"] = df.apply(
            lambda r: (r[f"{m}_call"] == r["enzyme_truth"]) if r["enzyme_evaluable"] and nz(r[f"{m}_call"]) else None,
            axis=1)
    df["label_truth_class"] = df["label_truth"].map(lab_class)
    df["label_call_class"] = df["label_call"].map(lab_class)
    sil = df["silac_massgap"].fillna("none").str.startswith("SILAC")
    df["label_call_combined"] = [
        (c if c and "SILAC" in str(c) else ("SILAC" if s and c == "label-free" else c)) if nz(c) else ("SILAC" if s else None)
        for c, s in zip(df["label_call_class"], sil)]
    df["label_evaluable"] = df["label_truth_class"].isin(LAB_EVAL) & df["label_call_class"].notna()
    df["label_correct"] = [(c == t) if e else None for c, t, e in
                           zip(df["label_call_class"], df["label_truth_class"], df["label_evaluable"])]
    df["alk_truth_class"] = df["alk_truth"].map(lambda x: "unknown" if x == "none" else x)
    df["alk_evaluable"] = df["alk_truth"].notna() & df["alk_call"].notna() & ~df["alk_truth"].astype(str).str.startswith("mixed")
    df["alk_correct"] = [(c == t) if e else None for c, t, e in
                         zip(df["alk_call"], df["alk_truth_class"], df["alk_evaluable"])]

    prov = ["source: sdrf_truth_runs.tsv (" + tprov[0] + ")", "calls: " + cprov[0],
            "rules: see scripts/score_digest_truth.py docstring; prose = -digest_models prose-auto 0.1.3 table, "
            f"shipped = FASTag {ver} built-in models"]
    df["subset"] = ["new non-tryptic" if s == "nontryptic_new" else "validation" for s in df["set"]]
    parts = []
    for subset, sub in (("validation", df[df["subset"] == "validation"]), ("all", df)):
        sdf = summary(sub)
        sdf.insert(0, "subset", subset)
        parts.append(sdf)
    sdf = pd.concat(parts, ignore_index=True)
    write_tsv(sdf, res / f"fig7_digest_summary{sfx}.tsv", prov + [
        "subset validation = the 244 digest validation runs; all = plus the new non-tryptic runs (set nontryptic_new)",
        "accuracy_called = correct/called; accuracy_all = correct/evaluable (no-call = wrong); "
        "alkylation: 'unknown' counts as a call of 'unknown' in task 'alkylation', as a no-call in 'alkylation_nocall'"])
    write_tsv(df, res / f"table_s3_digest_truth{sfx}.tsv", prov)

    C = pd.concat([
        confusion(df, "A_protease_shipped", "enzyme_truth", "shipped_call", df["enzyme_truth"].notna() & df["shipped_status"].notna()),
        confusion(df, "A_protease_prose", "enzyme_truth", "prose_call", df["enzyme_truth"].notna() & df["prose_status"].notna()),
        confusion(df, "C_label_termini", "label_truth_class", "label_call_class",
                  df["label_truth_class"].notna() & df["label_call_class"].notna()),
        confusion(df, "C_label_combined", "label_truth_class", "label_call_combined",
                  df["label_truth_class"].notna() & df["label_call_class"].notna()),
        confusion(df, "D_alkylation", "alk_truth", "alk_call", df["alk_truth"].notna() & df["alk_call"].notna()),
    ])
    write_tsv(C, res / f"fig7_confusion{sfx}.tsv", prov + ["all runs (validation + new non-tryptic); "
                                                     "call 'no call' = FASTag gave no protease call"])
    print(sdf.to_string())


def summary(df):
    S = []
    for m in ("shipped", "prose"):
        S += summarize(df, "protease", "enzyme_truth", f"{m}_call", m, df["enzyme_evaluable"])
    S += summarize(df, "label_termini", "label_truth_class", "label_call_class", "prose-auto rule", df["label_evaluable"])
    S += summarize(df, "label_combined", "label_truth_class", "label_call_combined", "prose-auto rule + massgap SILAC",
                   df["label_evaluable"])
    S += summarize(df, "alkylation", "alk_truth_class", "alk_call", "prose-auto rule", df["alk_evaluable"])
    sdf = pd.DataFrame(S)
    a_ev = df[df["alk_evaluable"]]
    called = a_ev[a_ev["alk_call"] != "unknown"]
    extra = pd.DataFrame([{"task": "alkylation_nocall", "model": "prose-auto rule", "class": "all",
                           "evaluable": len(a_ev), "called": len(called),
                           "correct": int((called["alk_call"] == called["alk_truth_class"]).sum()),
                           "no_call": len(a_ev) - len(called),
                           "accuracy_called": round((called["alk_call"] == called["alk_truth_class"]).mean(), 4)
                           if len(called) else None,
                           "accuracy_all": round((a_ev["alk_call"] == a_ev["alk_truth_class"]).mean(), 4)}])
    return pd.concat([sdf, extra], ignore_index=True)


if __name__ == "__main__":
    main()
