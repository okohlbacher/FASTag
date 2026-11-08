#!/usr/bin/env python3
"""#15B held-out scorer (PREREG-item15B.md): CFG-15B-cand (-ion_series auto) against CFG-15B-base (-ion_series by).

Runs: the manifest rows of one split (H1 = set6 + set7; H2 = set8, used only to confirm a variant after an H1
failure). One FASTag run per arm at the frozen options (cell 'RC'). Activation per spectrum from the staged mzML
(<activation> cvParams; the RC's own phase-A classes): electron = ETD (MS:1000598) or ECD (MS:1000250) without a
supplemental collisional activation; hybrid = ETD/ECD with supplemental beam-type CID (MS:1002678) or supplemental
CID (MS:1002679), or EThcD (MS:1002631); collisional = CID (MS:1000133), HCD (MS:1000422), trap-type CID
(MS:1002472) without ETD/ECD; anything else = unknown (reported, not scored).
Truth: MSFragger (version and parameter file fixed in PREREG-item15B.md) output tsv per run in
<truth>/<manifest>/<run dir>/: msfragger_by.tsv (collisional spectra, b/y), msfragger_cz.tsv (electron spectra,
c/z-dot), msfragger_hybrid.tsv (hybrid spectra, b/y/c/z-dot). Per file: rank-1 hits, target-decoy q-value on
expectscore (decoy prefix rev_), q <= 0.01, targets only; modification_info masses are read as mass deltas
(MSFragger tsv convention; checked on the PXD060724 DEV search before any held-out run). Correctness: the paper flank rule with the tag's ion
series offsets (score.py REVERSED_OFFSET; ion_series column of the tag TSV).
Endpoints (PLAN-data-types #15 'Acceptance for auto as default'; all must hold):
  (E1) electron-activated spectra, all charges, pooled over the split's runs: cand - base >= +5.0 points and the
       2.5th bootstrap percentile > 0;
  (E2) non-inferior elsewhere: cells hybrid and collisional x truth (MSFragger) charge 2, 3, 4+ (#2 margins,
       acclib.holm_ni; an empty activation class has no cells);
  (E3) identical on collisional spectra: every base row of a collisional spectrum equals the candidate's row on the
       base columns (the candidate writes ion_series 'by' for them or no such column).
  The PXD004732 robustness run and the collisional-run identity of the gate cases (registry E15B-01) are DEV
  checks outside this script.
Usage: score_item15B.py <acceptance dir> <split H1|H2> <inputs root> <runs root> <truth root> <out dir>
       [--manifest <name>] (DEV tests only)"""
import argparse
import json
import re
from pathlib import Path

import acclib as A

MANIFEST = "item15B-sets"
ELECTRON = {"MS:1000598", "MS:1000250"}
SUPPL = {"MS:1002678", "MS:1002679"}
HYBRID = {"MS:1002631"}
COLL = {"MS:1000133", "MS:1000422", "MS:1002472"}
SID = re.compile(r'<spectrum [^>]*\bid="([^"]+)"')
ACC = re.compile(r'accession="(MS:\d+)"')
MOD = re.compile(r"(N-term|C-term|\d+)([A-Z]?)\(([-+]?\d+(?:\.\d*)?)\)")


def activation_classes(mzml):
    """spectrum key -> electron | hybrid | collisional | unknown (MS2 spectra with an <activation> block)."""
    out, sid, acts, inact = {}, None, set(), False
    with open(mzml, errors="replace") as f:
        for line in f:
            m = SID.search(line)
            if m:
                sid, acts = m.group(1), set()
            if "<activation" in line:
                inact = True
            if inact:
                acts.update(ACC.findall(line))
            if "</activation>" in line:
                inact = False
            if "</spectrum>" in line and sid is not None:
                if acts:
                    e, c = bool(acts & ELECTRON), bool(acts & COLL)
                    cls = ("hybrid" if (e and (acts & SUPPL or c)) or acts & HYBRID else
                           "electron" if e else "collisional" if c else "unknown")
                    out[A.P.spectrum_key(sid)] = cls
                sid = None
    return out


def fragger_peptide(pep, mods):
    """MSFragger peptide + modification_info -> the Sage notation score.peptide_masses reads."""
    add, nterm, cterm = {}, 0.0, 0.0
    for pos, _aa, mass in MOD.findall(mods or ""):
        if pos == "N-term":
            nterm += float(mass)
        elif pos == "C-term":
            cterm += float(mass)
        else:
            add[int(pos)] = add.get(int(pos), 0.0) + float(mass)
    s = "".join(aa + (f"[{add[i]:+.6f}]" if i in add else "") for i, aa in enumerate(pep, start=1))
    return (f"[{nterm:+.6f}]-" if nterm else "") + s + (f"-[{cterm:+.6f}]" if cterm else "")


def fragger_psms(path, fdr=0.01, decoy="rev_"):
    df = A.pd.read_csv(path, sep="\t", dtype={"peptide": str, "modification_info": str, "protein": str},
                       keep_default_na=False)
    if "hit_rank" in df.columns:
        df = df[df["hit_rank"].astype(int) == 1]
    df = df.copy()
    df["decoy"] = df["protein"].str.startswith(decoy)
    df = df.sort_values("expectscore", kind="mergesort").reset_index(drop=True)
    d, t = df["decoy"].cumsum(), (~df["decoy"]).cumsum()
    df["q"] = (d / t.clip(lower=1))[::-1].cummin()[::-1]
    keep = df[(~df["decoy"]) & (df["q"] <= fdr)].copy()
    keep["key"] = keep["scannum"].map(lambda s: f"scan={int(s)}")
    keep["peptide"] = [fragger_peptide(p, m) for p, m in zip(keep["peptide"], keep["modification_info"])]
    keep["cluster"] = keep["peptide"].map(A.S.normalize_peptide)
    keep["charge"] = keep["charge"].astype(int)
    return keep.drop_duplicates("key")[["key", "peptide", "cluster", "charge"]]


def main():
    ap = argparse.ArgumentParser()
    for a in ("acc", "split", "inputs", "runs", "truth", "out"):
        ap.add_argument(a)
    ap.add_argument("--base", default="CFG-15B-base")
    ap.add_argument("--cand", default="CFG-15B-cand")
    ap.add_argument("--cell", default="RC")
    ap.add_argument("--manifest", default=MANIFEST, help="DEV tests only")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = [r for r in A.read_tsv(Path(a.acc) / "manifests" / f"{a.manifest}.tsv") if r["split"] == a.split]
    recs, runinfo, ident = [], [], []
    for r in rows:
        rel = A.run_rel(r["fastag_input"])
        info = {"pxd": r["pxd"], "set": r["stratum"], "run": rel}
        td = Path(a.truth) / a.manifest / rel
        parts = [A.pd.DataFrame(columns=["key", "peptide", "cluster", "charge"])]
        for n in ("by", "cz", "hybrid"):
            f = td / f"msfragger_{n}.tsv"
            info[f"truth_{n}"] = f.exists()
            if f.exists():
                parts.append(fragger_psms(f))
        psms = A.pd.concat(parts).drop_duplicates("key")
        act = activation_classes(Path(a.inputs) / r["fastag_input"])
        info["truth_psms"] = len(psms)
        info.update({f"spectra_{c}": sum(1 for v in act.values() if v == c)
                     for c in ("electron", "hybrid", "collisional", "unknown")})
        rd = {arm: Path(a.runs) / arm / a.manifest / rel / a.cell for arm in (a.base, a.cand)}
        rcs = {arm: A.run_rc(rd[arm]) for arm in rd}
        info.update({f"{arm}:rc": rc for arm, rc in rcs.items()})
        d = {arm: A.rank1_correct(rd[arm] / "tags.tsv" if rcs[arm] == 0 else None, psms) for arm in rd}
        for k, cl, ch in zip(psms["key"], psms["cluster"], psms["charge"]):
            recs.append((act.get(k, "unknown"), int(ch), cl, d[a.base][k], d[a.cand][k]))
        # E3: rows of collisional spectra
        if all(rc == 0 for rc in rcs.values()):
            b = A.pd.read_csv(rd[a.base] / "tags.tsv", sep="\t", dtype=str, keep_default_na=False)
            c = A.pd.read_csv(rd[a.cand] / "tags.tsv", sep="\t", dtype=str, keep_default_na=False)
            ck = lambda df: df["spectrum"].map(lambda s: act.get(A.P.spectrum_key(s)) == "collisional")
            bb, cc = b[ck(b)].reset_index(drop=True), c[ck(c)].reset_index(drop=True)
            same = len(bb) == len(cc) and bool((cc[list(b.columns)] == bb).all(axis=None))
            ident.append({"run": rel, "collisional_rows_base": len(bb), "collisional_rows_cand": len(cc), "same": same})
        info["status"] = "ok" if all(rc == 0 for rc in rcs.values()) else "RUN_FAILED"
        runinfo.append(info)
    e1c = A.paired_diff(f"{a.manifest}:{a.split}:electron", [(c, b, k) for (ac, ch, c, b, k) in recs if ac == "electron"])
    e1 = "PASS" if e1c["clusters"] and e1c["diff"] >= 5.0 and e1c["p2_5"] > 0 else "FAIL"
    grid = []
    for ac in ("hybrid", "collisional"):
        if not any(x[0] == ac for x in recs):
            continue
        for z in ("2", "3", "4+"):
            grid.append(A.paired_diff(f"{a.manifest}:{a.split}:{ac}:z{z}",
                                      [(c, b, k) for (x, ch, c, b, k) in recs if x == ac and A.charge_stratum(ch) == z]))
    e2 = A.holm_ni(grid) if grid else "PASS"
    e3 = "PASS" if ident and all(x["same"] for x in ident) else "FAIL"
    failed = [x for x in runinfo if x["status"] != "ok"]
    v = [e1, e2, e3]
    res = {"manifest": a.manifest, "split": a.split, "E1": e1, "E1_cell": e1c, "E2": e2, "E3": e3,
           "verdict": ("INCONCLUSIVE" if failed else "PASS" if all(x == "PASS" for x in v) else
                       "FAIL" if "FAIL" in v else "INCONCLUSIVE"),
           "runs_not_ok": [(x["run"], x["status"]) for x in failed], "provenance": A.provenance()}
    A.write_rows(out / "cells_E2.tsv", grid)
    A.write_rows(out / "identity_E3.tsv", ident)
    A.write_rows(out / "runs.tsv", runinfo, sorted({k for x in runinfo for k in x}))
    (out / "result.json").write_text(json.dumps(res, indent=1, default=str) + "\n")
    print(json.dumps({k: res[k] for k in ("split", "E1", "E2", "E3", "verdict", "runs_not_ok")}, default=str),
          json.dumps({k: e1c[k] for k in ("clusters", "base_pct", "cand_pct", "diff", "p2_5")}))


if __name__ == "__main__":
    main()
