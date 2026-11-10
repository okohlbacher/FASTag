#!/usr/bin/env python3
"""Scorer of the hybrid arm (-ion_series auto -ion_series_hybrid both against -ion_series auto).

Usage: score_hybrid.py <runs.tsv> <out dir>
runs.tsv columns: project, run, run_dir (holding by/ and both/ with tags.tsv, run.log, run.err), sage (Sage
results.sage.tsv of the truth search), scans (hybrid_scans.py table).

Truth: hybtruth.truth (hybrid Orbitrap MS2, Sage target rank 1, 1 % FDR). Correctness: the paper flank rule
(bench/fastag-bench score.py `_mark`, rule 'flank', with the row's ion_series offset). A truth spectrum an arm
leaves untagged has no correct tag.

Writes <out dir>/spectra.tsv, one row per truth spectrum: project, run, key, cluster, charge and per arm
(by_, both_): rows (tag rows of the spectrum), correct (correct rows), r1 (rank-1 row correct); for the both arm
also the split by the row's ion_series (both_rows_by, both_correct_by, both_rows_cz, both_correct_cz).
Writes <out dir>/runs.tsv, one row per run: counts, FASTag return codes, CPU seconds (user + system), wall
seconds and peak memory of each arm from /usr/bin/time -v."""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[3] / "bench/fastag-bench/src"))

import pandas as pd  # noqa: E402
from fastag_bench import parsers as P  # noqa: E402
from fastag_bench import score as S  # noqa: E402
import hybtruth  # noqa: E402

ARMS = ("by", "both")


def timing(arm_dir):
    rc, out = None, {"cpu_s": float("nan"), "wall_s": float("nan"), "rss_mb": float("nan")}
    log = Path(arm_dir) / "run.log"
    if log.exists():
        for line in open(log, errors="replace"):
            if line.startswith("FASTAG_RC="):
                rc = int(line.strip().split("=", 1)[1])
    err = Path(arm_dir) / "run.err"
    if err.exists():
        txt = err.read_text(errors="replace")
        u = re.search(r"User time \(seconds\): ([\d.]+)", txt)
        s = re.search(r"System time \(seconds\): ([\d.]+)", txt)
        w = re.search(r"Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): ([\d:.]+)", txt)
        m = re.search(r"Maximum resident set size \(kbytes\): (\d+)", txt)
        if u and s:
            out["cpu_s"] = float(u.group(1)) + float(s.group(1))
        if w:
            sec = 0.0
            for part in w.group(1).split(":"):
                sec = sec * 60 + float(part)
            out["wall_s"] = sec
        if m:
            out["rss_mb"] = int(m.group(1)) / 1024
    return rc, out


def arm_marks(tags_path, psms):
    """Tag rows of the truth spectra with 'correct' and 'ion_series'; empty frame when there is no tag file."""
    cols = ["key", "rank", "correct", "ion_series"]
    if not Path(tags_path).exists():
        return pd.DataFrame(columns=cols)
    tags = P.read_fastag_tags(tags_path)
    tags = tags[tags["key"].isin(set(psms["key"]))]
    if len(tags) == 0:
        return pd.DataFrame(columns=cols)
    m = S._mark(tags, psms[["key", "peptide"]], "flank")
    m["ion_series"] = m["ion_series"].replace("", "by").fillna("by") if "ion_series" in m.columns else "by"
    return m[cols]


def score_run(project, run, run_dir, sage, scans):
    psms, n_hyb = hybtruth.truth(sage, scans)
    rec = psms[["key", "cluster", "charge"]].copy()
    rec.insert(0, "run", run)
    rec.insert(0, "project", project)
    summ = {"project": project, "run": run, "hybrid_ftms_ms2": n_hyb, "truth_spectra": len(psms)}
    for arm in ARMS:
        m = arm_marks(Path(run_dir) / arm / "tags.tsv", psms)
        g = m.groupby("key")
        cnt = pd.DataFrame({f"{arm}_rows": g.size(), f"{arm}_correct": g["correct"].sum().astype(int),
                            f"{arm}_r1": m[m["rank"] == 1].groupby("key")["correct"].any().astype(int)})
        if arm == "both":
            for sr in ("by", "cz"):
                gs = m[m["ion_series"] == sr].groupby("key")
                cnt[f"both_rows_{sr}"] = gs.size()
                cnt[f"both_correct_{sr}"] = gs["correct"].sum().astype(int)
        rec = rec.merge(cnt.reset_index(), on="key", how="left")
        rc, t = timing(Path(run_dir) / arm)
        summ[f"{arm}_rc"] = rc
        summ.update({f"{arm}_{k}": v for k, v in t.items()})
    num = [c for c in rec.columns if c.startswith(("by_", "both_"))]
    rec[num] = rec[num].fillna(0).astype(int)
    for arm in ARMS:
        summ[f"{arm}_spectra_correct"] = int((rec[f"{arm}_correct"] > 0).sum())
        summ[f"{arm}_rows"] = int(rec[f"{arm}_rows"].sum())
        summ[f"{arm}_rows_correct"] = int(rec[f"{arm}_correct"].sum())
    return rec, summ


def main():
    runs = pd.read_csv(sys.argv[1], sep="\t", comment="#")
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    recs, summs = [], []
    for r in runs.itertuples():
        rec, summ = score_run(r.project, r.run, r.run_dir, r.sage, r.scans)
        recs.append(rec)
        summs.append(summ)
    pd.concat(recs).to_csv(out / "spectra.tsv", sep="\t", index=False)
    pd.DataFrame(summs).to_csv(out / "runs.tsv", sep="\t", index=False, float_format="%.3f")


if __name__ == "__main__":
    main()
