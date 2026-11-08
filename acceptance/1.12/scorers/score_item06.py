#!/usr/bin/env python3
"""#6 held-out scorer (PREREG-item06.md): CFG-06-cand (-unknown_charge infer) against CFG-06-base (assume2).

Inputs per run: the charge-stripped copy of the staged mzML (scorers/strip_charge.py: every MS:1000041 'charge
state' cvParam blanked, byte offsets kept) tagged by both arms at -tag_length 3/4/5 (cells S_L3, S_L4, S_L5), and
the staged mzML as given tagged by both arms at -tag_length 3 (cell G_L3). Truth: Sage 0.14.7 'charge_truth'
(precursor_charge [1, 4], isotope_errors [-1, 3]) on the stripped copy: its PSM charge and isotope_error label each
spectrum (target, rank 1, spectrum_q <= 0.01). Set = manifest stratum, ion_trap when the manifest's ms2_analyser is
ion_trap (PXD001540).
Round 3 (DECISIONS-2026-11-08 #2, PREREG-item06.md amendment 1): runs of the ion_trap set are read from the 0.5 Da
twins <CFG>-it05 of both arms (acclib.arm_dir); manifest item06-H1-r2 (sets astral, ion_trap, qe); the
informativeness floor acclib.INFO_FLOOR_PCT applies to every (2a) cell.
Endpoints (PLAN-data-types #6 'A later default of infer needs'; all must hold):
  (1) charge-call accuracy >= 0.90 on S_L3: truth spectra the candidate tagged; the call is the prec_charge of the
      spectrum's selected rows (selected = 1); a spectrum with two selected charges is wrong; untagged truth spectra
      are not in this denominator (their count is reported);
  (2a) flank-correct rank-1 non-inferior in every cell set x length (S_L3..S_L5) x Sage charge 2, 3, 4+ (the #2
      cells and margins, acclib.holm_ni); Sage charge-1 spectra are reported apart (cells_charge1.tsv);
  (2b) better on at least 2 of 3 held-out sets: per set at S_L3, all charges pooled, point > 0 and 2.5th
      bootstrap percentile > 0; the sets are the H1 sets present (with fewer than 3 sets every set present must be
      better);
  (3) no change on charged spectra: on G_L3 every row of the candidate equals the baseline row on the baseline's
      columns (same rows, same order).
Reported, not gating: share of charge errors with charge_src 'ambiguous' (plan target >= 50%), the Sage isotope_error
distribution (the candidate's isotope_error is 0), precursor-flank-only rank-1 (score.tag_correct_precursor_flank),
truth 2+ spectra called 1+.
Round 4 (DECISIONS-2026-11-08 round 4, PREREG-item06.md amendment 2): <manifest> may name several manifests,
comma-separated (item06-H2,item06-H2r); each run keeps its own manifest in its run and truth paths; --sets keeps only
the runs of the named sets (low-resolution ion_trap removed: --sets astral,qe); --exclude-pxd drops runs that the
PREREG declared not evaluable before any run (PXD035981: no truth database); a truth without any target rank-1 PSM
at spectrum_q <= 0.01 counts as without truth (NO_TRUTH_0PSM, rule 4); spectra are keyed by acclib.native_key.
Usage: score_item06.py <acceptance dir> <manifest[,manifest]> <runs root> <truth root> <out dir> [--base .. --cand ..]
       [--sets astral,qe] [--exclude-pxd PXD035981]"""
import argparse
import collections
import json
from pathlib import Path

import acclib as A
from score_item02 import set_of

S_CELLS = ["S_L3", "S_L4", "S_L5"]


def charge_calls(tags_path):
    """key -> (set of selected prec_charge, set of charge_src) of the candidate's selected rows."""
    out = {}
    if not Path(tags_path).exists():
        return out
    t = A.P.read_fastag_tags(tags_path)
    if "selected" not in t.columns:
        return out
    t = t[t["selected"].astype(str) == "1"]
    for k, g in t.groupby("key"):
        out[k] = ({int(x) for x in g["prec_charge"]}, set(g["charge_src"]))
    return out


def pflank(tags_path, psms):
    out = {k: False for k in psms["key"]}
    if not Path(tags_path).exists():
        return out
    t = A.P.read_fastag_tags(tags_path)
    t = t[t["rank"] == 1].merge(psms[["key", "peptide"]], on="key")
    cache = {}
    for k, tag, n, pep in zip(t["key"], t["tag"], A.pd.to_numeric(t["nterm_mass"], errors="coerce"), t["peptide"]):
        if pep not in cache:
            cache[pep] = A.S.peptide_masses(pep)
        res, pref, _ = cache[pep]
        out[k] = out[k] or A.S.tag_correct_precursor_flank(tag, n, res, pref)
    return out


def same_rows(base_tsv, cand_tsv):
    if not (Path(base_tsv).exists() and Path(cand_tsv).exists()):
        return False, "missing"
    b = A.pd.read_csv(base_tsv, sep="\t", dtype=str, keep_default_na=False)
    c = A.pd.read_csv(cand_tsv, sep="\t", dtype=str, keep_default_na=False)
    if len(b) != len(c) or not set(b.columns) <= set(c.columns):
        return False, f"rows {len(b)} vs {len(c)}"
    diff = int((c[list(b.columns)].reset_index(drop=True) != b.reset_index(drop=True)).any(axis=1).sum())
    return diff == 0, f"{diff} differing rows of {len(b)}"


def main():
    ap = argparse.ArgumentParser()
    for a in ("acc", "manifest", "runs", "truth", "out"):
        ap.add_argument(a)
    ap.add_argument("--base", default="CFG-06-base")
    ap.add_argument("--cand", default="CFG-06-cand")
    ap.add_argument("--sets", help="comma-separated sets to score (round 4: astral,qe); default all")
    ap.add_argument("--exclude-pxd", default="", help="comma-separated PXDs declared not evaluable in the PREREG")
    a = ap.parse_args()
    A.use_native_keys()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for man in a.manifest.split(","):
        for r in A.read_tsv(Path(a.acc) / "manifests" / f"{man}.tsv"):
            r["_manifest"] = man
            rows.append(r)
    excl = {x for x in a.exclude_pxd.split(",") if x}
    keep = set(a.sets.split(",")) if a.sets else None
    rows = [r for r in rows if r["pxd"] not in excl and (keep is None or set_of(r) in keep)]
    recs, runinfo, calls, pf, iso = [], [], [], [], collections.Counter()
    for r in rows:
        rel = A.run_rel(r["fastag_input"])
        MAN = r["_manifest"]
        tp = Path(a.truth) / MAN / rel / "results.sage.tsv"
        info = {"pxd": r["pxd"], "run": rel, "set": set_of(r), "manifest": MAN}
        if not tp.exists():
            info["status"] = "NO_TRUTH"
            runinfo.append(info)
            continue
        psms = A.sage_truth(tp)
        if len(psms) == 0:      # round 4: no PSM at the preregistered q is no truth (rule 4)
            info["status"], info["truth_psms"] = "NO_TRUTH_0PSM", 0
            runinfo.append(info)
            continue
        iso.update(int(x) for x in psms["isotope_error"])
        ch, cl = dict(zip(psms["key"], psms["charge"])), dict(zip(psms["key"], psms["cluster"]))
        ok = True
        D = {arm: A.arm_dir(arm, info["set"]) for arm in (a.base, a.cand)}   # round 3: 0.5 Da twins on ion_trap
        info["arm_dirs"] = f"{D[a.base]},{D[a.cand]}"
        for cell in S_CELLS + ["G_L3"]:
            for arm in (a.base, a.cand):
                rc = A.run_rc(Path(a.runs) / D[arm] / MAN / rel / cell)
                info[f"{arm}:{cell}:rc"] = rc
                ok &= rc == 0
        for cell in S_CELLS:
            d = {arm: A.rank1_correct(Path(a.runs) / D[arm] / MAN / rel / cell / "tags.tsv", psms)
                 for arm in (a.base, a.cand)}
            for k in psms["key"]:
                recs.append((info["set"], cell, int(ch[k]), cl[k], d[a.base][k], d[a.cand][k]))
        cdir = Path(a.runs) / D[a.cand] / MAN / rel / "S_L3"
        cc = charge_calls(cdir / "tags.tsv")
        for k in psms["key"]:
            if k in cc:
                qs, src = cc[k]
                calls.append({"set": info["set"], "truth": int(ch[k]), "called": ",".join(map(str, sorted(qs))),
                              "correct": qs == {int(ch[k])}, "ambiguous": "ambiguous" in src})
        info["truth_psms"], info["cand_tagged_truth"] = len(psms), sum(1 for k in psms["key"] if k in cc)
        pb = pflank(Path(a.runs) / D[a.base] / MAN / rel / "S_L3" / "tags.tsv", psms)
        pc = pflank(cdir / "tags.tsv", psms)
        pf += [(info["set"], cl[k], pb[k], pc[k]) for k in psms["key"]]
        info["G_L3_identical"], info["G_L3_detail"] = same_rows(
            Path(a.runs) / D[a.base] / MAN / rel / "G_L3" / "tags.tsv",
            Path(a.runs) / D[a.cand] / MAN / rel / "G_L3" / "tags.tsv")
        info["status"] = "ok" if ok else "RUN_FAILED"
        runinfo.append(info)
    sets = sorted({x["set"] for x in runinfo})
    n_ok = sum(c["correct"] for c in calls)
    acc1 = n_ok / len(calls) if calls else float("nan")
    errs = [c for c in calls if not c["correct"]]
    grid = []
    for s in sets:
        for cell in S_CELLS:
            for z in ("2", "3", "4+"):
                rr = [(c, b, k) for (st, ce, chg, c, b, k) in recs if st == s and ce == cell and A.charge_stratum(chg) == z]
                grid.append(A.paired_diff(f"{a.manifest}:{s}:{cell}:z{z}", rr))
    e2a = A.holm_ni(grid, floor=A.INFO_FLOOR_PCT)
    one = [A.paired_diff(f"{a.manifest}:{s}:{cell}:z1", [(c, b, k) for (st, ce, chg, c, b, k) in recs
                                                           if st == s and ce == cell and chg == 1])
           for s in sets for cell in S_CELLS]
    better = []
    for s in sets:
        d = A.paired_diff(f"{a.manifest}:better:{s}:S_L3", [(c, b, k) for (st, ce, chg, c, b, k) in recs
                                                            if st == s and ce == "S_L3"])
        d["better"] = bool(d["clusters"] and d["diff"] > 0 and d["p2_5"] > 0)
        better.append(d)
    need = 2 if len(sets) >= 3 else len(sets)
    e2b = "PASS" if sets and sum(d["better"] for d in better) >= need else "FAIL"
    e3 = "PASS" if runinfo and all(x.get("G_L3_identical") for x in runinfo if not x["status"].startswith("NO_TRUTH")) else "FAIL"
    e1 = "PASS" if calls and acc1 >= 0.90 else "FAIL"
    failed = [x for x in runinfo if x["status"] != "ok"]
    v = [e1, e2a, e2b, e3]
    res = {"manifest": a.manifest, "sets": sets, "e1_charge_accuracy": acc1, "e1_n": len(calls),
           "e1_wilson": A.wilson(n_ok, len(calls)), "info_floor_pct": A.INFO_FLOOR_PCT, "e1": e1, "e2a": e2a, "e2b": e2b, "e2b_need": need, "e3": e3,
           "errors_ambiguous_share": (sum(c["ambiguous"] for c in errs) / len(errs)) if errs else float("nan"),
           "truth2_called1": sum(1 for c in calls if c["truth"] == 2 and c["called"] == "1"),
           "sage_isotope_error": dict(sorted(iso.items())),
           "precursor_flank_rank1": [A.paired_diff(f"{a.manifest}:pflank:{s}", [(c, b, k) for (st, c, b, k) in pf if st == s])
                                     for s in sets],
           "runs_not_ok": [(x["run"], x["status"]) for x in failed],
           "verdict": ("INCONCLUSIVE" if failed else "PASS" if all(x == "PASS" for x in v) else
                       "FAIL" if "FAIL" in v else "INCONCLUSIVE"),
           "provenance": A.provenance()}
    A.write_rows(out / "cells_2a.tsv", grid)
    A.write_rows(out / "cells_charge1.tsv", one)
    A.write_rows(out / "sets_2b.tsv", better)
    A.write_rows(out / "charge_calls.tsv", calls)
    A.write_rows(out / "runs.tsv", runinfo, sorted({k for x in runinfo for k in x}))
    (out / "result.json").write_text(json.dumps(res, indent=1, default=str) + "\n")
    print(json.dumps({k: res[k] for k in ("sets", "e1_charge_accuracy", "e1_n", "e1", "e2a", "e2b", "e3", "verdict",
                                          "runs_not_ok")}, default=str))


if __name__ == "__main__":
    main()
