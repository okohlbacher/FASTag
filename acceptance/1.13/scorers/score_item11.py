#!/usr/bin/env python3
"""Item 11 (1.13, a/x ions) scorer: arm ax (-ion_series ax) against arm by (defaults) on UVPD spectra of
PXD018176 (dual HCD + UVPD per precursor, recalibrated MGFs).

Truth per run (MSFragger 4.4.1 tsv, rank 1, target-decoy q-value on expectscore, decoy prefix rev_, q <= 0.01,
targets only; acclib conventions):
  T1 (primary, independent of the UVPD fragments): the b/y search of the HCD partner MGF. A UVPD spectrum's
     partner is the HCD scan one below it (scan - 1) with the same precursor m/z (|delta| <= 10 ppm, PEPMASS of the
     two MGFs); the PSM's charge must equal the UVPD block's CHARGE (the HCD MGF has none); partners that fail
     this are dropped and counted.
Keys: FASTag names an MGF spectrum index=<i> (0-based block index), so truth scans are mapped to the UVPD MGF's
block index.
  T2: the search of the UVPD MGF itself with fragment_ion_series a,b,x,y.
  (Reported, not a truth: the PSM count of the a,x-only search, per run.)
Correctness: the paper flank rule with the row's ion series offsets (score.py REVERSED_OFFSET, tag TSV column
ion_series); rank 1 = the spectrum's first row; an untagged truth spectrum counts as not correct.
Cells: per truth (T1, T2), pooled over the runs of the split, and per laser time (DEV only, descriptive):
ax - by in points, 2,000 peptide-cluster bootstrap draws (acclib.paired_diff), clusters = I/L-folded unmodified
truth peptide. Also: the share of truth spectra whose rank-1 tag is correct under either arm (union) and the
shuffled-truth chance level of each arm (acclib conventions, score.shuffled_peptides).
Runs list columns: stem, laser_ms, and optionally input (mgf: PXD018176 MGF pairs, the default; mzml: an mzML
run, keys scan=<n>, T2 only, searched on <stem>.mzML).
Usage: score_item11.py <runs list tsv: stem, laser_ms[, input]> <input dir> <runs root> <truth root> <out dir>
         [--base by] [--cand ax]
Runs root: <runs>/<arm>/<UVPD stem>/{tags.tsv,run.log}. Truth root: <truth>/<stem>/<search>/<stem>.tsv."""
import argparse
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# fastag_bench of feat/b113-ax (score.py with REVERSED_OFFSET["ax"]; sha256 pinned in item11/SHA256SUMS), given by
# ITEM11_BENCH_SRC: imported first, so acclib's own `from fastag_bench import ...` reuses it.
if os.environ.get("ITEM11_BENCH_SRC"):
    sys.path.insert(0, os.environ["ITEM11_BENCH_SRC"])
    import fastag_bench.parsers  # noqa: E402,F401
    import fastag_bench.score  # noqa: E402,F401
# acclib of the 1.12 held-out scorers (acceptance/1.12/scorers/acclib.py, sha256 pinned in item11/SHA256SUMS)
sys.path.insert(0, str(HERE.parents[1] / "1.12" / "scorers"))
import acclib as A  # noqa: E402
if "ax" not in A.S.REVERSED_OFFSET:
    sys.exit("score.py has no a/x offset: set ITEM11_BENCH_SRC to feat/b113-ax bench/fastag-bench/src")

MOD = re.compile(r"(N-term|C-term|\d+)([A-Z]?)\(([-+]?\d+(?:\.\d*)?)\)")


def fragger_peptide(pep, mods):
    """MSFragger peptide + modification_info (mass deltas) -> the Sage notation score.peptide_masses reads."""
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
    df = A.pd.read_csv(path, sep="\t", dtype={"peptide": str, "modification_info": str, "protein": str,
                                              "proteins": str}, keep_default_na=False, index_col=False)
    if "hit_rank" in df.columns:
        df = df[df["hit_rank"].astype(int) == 1]
    df = df.copy()
    pcol = "protein" if "protein" in df.columns else "proteins"
    df["decoy"] = df[pcol].str.startswith(decoy)
    df = df.sort_values("expectscore", kind="mergesort").reset_index(drop=True)
    d, t = df["decoy"].cumsum(), (~df["decoy"]).cumsum()
    df["q"] = (d / t.clip(lower=1))[::-1].cummin()[::-1]
    keep = df[(~df["decoy"]) & (df["q"] <= fdr)].copy()
    keep["scan"] = keep["scannum"].astype(int)
    keep["peptide"] = [fragger_peptide(p, m) for p, m in zip(keep["peptide"], keep["modification_info"])]
    keep["cluster"] = keep["peptide"].map(A.S.normalize_peptide)
    keep["charge"] = keep["charge"].astype(int)
    return keep.drop_duplicates("scan")[["scan", "peptide", "cluster", "charge"]]


def mgf_precursors(path):
    """scan -> (PEPMASS m/z, charge, block index) of an MGF whose TITLE carries scan=<n>; charge 0 when the
    block has no CHARGE line. The block index is FASTag's MGF spectrum id (index=<i>)."""
    out, scan, mz, z, i = {}, None, None, 0, -1
    for line in open(path, errors="replace"):
        if line.startswith("BEGIN IONS"):
            scan, mz, z = None, None, 0
            i += 1
        elif line.startswith("TITLE="):
            m = re.search(r"scan=(\d+)", line)
            scan = int(m.group(1)) if m else None
        elif line.startswith("PEPMASS="):
            mz = float(line.split("=", 1)[1].split()[0])
        elif line.startswith("CHARGE="):
            z = int(re.sub(r"[^0-9]", "", line.split("=", 1)[1]) or 0)
        elif line.startswith("END IONS") and scan is not None:
            out[scan] = (mz, z, i)
    return out


def main():
    ap = argparse.ArgumentParser()
    for a in ("runs_list", "mgf", "runs", "truth", "out"):
        ap.add_argument(a)
    ap.add_argument("--base", default="by")
    ap.add_argument("--cand", default="ax")
    ap.add_argument("--split", default="DEV")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    runs = A.read_tsv(a.runs_list)
    recs = {"T1": [], "T2": []}
    per_laser = {}
    runinfo = []
    chance = {"T1": {a.base: [0, 0], a.cand: [0, 0]}}
    for r in runs:
        stem, laser = r["stem"], r["laser_ms"]
        mzml = r.get("input", "mgf") == "mzml"
        hcd = stem.replace("UVPD_recal_", "Denoised_HCD_recal_", 1)
        uv = {} if mzml else mgf_precursors(Path(a.mgf) / f"{stem}.mgf")
        hc = {} if mzml else mgf_precursors(Path(a.mgf) / f"{hcd}.mgf")
        info = {"stem": stem, "laser_ms": laser, "uvpd_spectra": len(uv)}
        # T1: HCD partner (scan - 1, same precursor within 10 ppm, same charge)
        t1f = Path(a.truth) / hcd / "by" / f"{hcd}.tsv"
        t1 = fragger_psms(t1f) if not mzml else A.pd.DataFrame(columns=["scan", "peptide", "cluster", "charge"])
        rows, dropped = [], 0
        for s, pep, cl, ch in zip(t1["scan"], t1["peptide"], t1["cluster"], t1["charge"]):
            u = uv.get(s + 1)
            h = hc.get(s)
            if u is None or h is None or u[1] != ch or abs(u[0] - h[0]) > 10e-6 * h[0]:
                dropped += 1
                continue
            rows.append((f"index={u[2]}", pep, cl, ch))
        p1 = A.pd.DataFrame(rows, columns=["key", "peptide", "cluster", "charge"])
        info.update(t1_hcd_psms=len(t1), t1_paired=len(p1), t1_unpaired=dropped)
        # T2: UVPD a,b,x,y search
        t2f = Path(a.truth) / stem / "abxy" / f"{stem}.tsv"
        t2 = fragger_psms(t2f) if t2f.exists() else A.pd.DataFrame(columns=["scan", "peptide", "cluster", "charge"])
        if not mzml:
            t2 = t2[t2["scan"].isin(list(uv))]
        p2 = A.pd.DataFrame({"key": [f"scan={s}" if mzml else f"index={uv[s][2]}" for s in t2["scan"]],
                             "peptide": list(t2["peptide"]), "cluster": list(t2["cluster"]),
                             "charge": list(t2["charge"])})
        info["t2_psms"] = len(p2)
        # descriptive: PSMs of the a,x-only search of the same UVPD MGF
        axf = Path(a.truth) / stem / "ax" / f"{stem}.tsv"
        info["ax_only_psms"] = len(fragger_psms(axf)) if axf.exists() else ""
        rd = {arm: Path(a.runs) / arm / stem for arm in (a.base, a.cand)}
        for arm, d in rd.items():
            info[f"{arm}:rc"] = A.run_rc(d)
        for name, psms in (("T1", p1), ("T2", p2)):
            if len(psms) == 0:
                continue
            d = {arm: A.rank1_correct(rd[arm] / "tags.tsv" if info[f"{arm}:rc"] == 0 else None, psms) for arm in rd}
            for k, cl in zip(psms["key"], psms["cluster"]):
                rec = (cl, d[a.base][k], d[a.cand][k])
                recs[name].append(rec)
                per_laser.setdefault((name, laser), []).append(rec)
            info[f"{name}_{a.base}_rank1"] = sum(d[a.base].values())
            info[f"{name}_{a.cand}_rank1"] = sum(d[a.cand].values())
            if name == "T1":
                sh = A.S.shuffled_peptides(psms[["key", "peptide"]], seed=11)
                for arm in rd:
                    c = A.rank1_correct(rd[arm] / "tags.tsv" if info[f"{arm}:rc"] == 0 else None, sh)
                    chance["T1"][arm][0] += sum(c.values())
                    chance["T1"][arm][1] += len(sh)
        runinfo.append(info)
    cells = []
    for name in ("T1", "T2"):
        c = A.paired_diff(f"item11:{a.split}:{name}", [(cl, b, k) for cl, b, k in recs[name]])
        c["union_pct"] = (100 * sum(1 for _, b, k in recs[name] if b or k) / len(recs[name])) if recs[name] else float("nan")
        cells.append(c)
    for (name, laser), rr in sorted(per_laser.items(), key=lambda x: (x[0][0], float(x[0][1]))):
        c = A.paired_diff(f"item11:{a.split}:{name}:{laser}ms", [(cl, b, k) for cl, b, k in rr])
        c["union_pct"] = 100 * sum(1 for _, b, k in rr if b or k) / len(rr)
        cells.append(c)
    A.write_rows(out / "cells.tsv", cells)
    A.write_rows(out / "runs.tsv", runinfo)
    ch = {arm: (100 * v[0] / v[1] if v[1] else float("nan")) for arm, v in chance["T1"].items()}
    summary = {"split": a.split, "base": a.base, "cand": a.cand, "cells": cells[:2], "chance_T1_pct": ch,
               "provenance": {"score_item11.py": A.sha256(__file__), "acclib.py": A.sha256(A.__file__),
                              "score.py": A.sha256(A.S.__file__), "parsers.py": A.sha256(A.P.__file__),
                              "score.py path": A.S.__file__, "python": sys.version.split()[0],
                              "pandas": A.pd.__version__, "numpy": A.np.__version__}}
    (out / "summary.json").write_text(json.dumps(summary, indent=1, default=str))
    for c in cells:
        print(f"{c['cell']}\tspectra {c['spectra']}\tclusters {c['clusters']}\t{a.base} {c['base_pct']:.2f}\t"
              f"{a.cand} {c['cand_pct']:.2f}\tdiff {c['diff']:+.2f} [{c.get('p2_5', float('nan')):+.2f}, "
              f"{c.get('p97_5', float('nan')):+.2f}]\tunion {c['union_pct']:.2f}")
    print("chance (T1, shuffled peptides):", {k: round(v, 2) for k, v in ch.items()})


if __name__ == "__main__":
    main()
