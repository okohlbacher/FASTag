#!/usr/bin/env python3
"""Paired and baseline-aware statistics for the paper (FASTag 1.9.0 tables).

Two subcommands.

export  (run where the accuracy run directories are, e.g. on the cluster)
    Builds the per-spectrum pair table results/accuracy_pairs_v190.tsv.gz: one row per ground-truth PSM
    spectrum, ground truth and tag length, with FASTag's and DirecTag's outcome at matched settings
    (profiles fastag_matched[_tlN] and directag_matched[_tlN]). Outcome columns are 0/1: tagged, rank-1 tag
    correct, any of the top 10 tags correct (flank rule, score.tag_correct_flank). FASTag 1.9.0 matched
    output is byte-identical to 1.8.0 (BENCHMARKS-v190.md), so the 1.9.0 run directories are used.

stats   (local; needs only results/)
    results/stats_accuracy_paired_v190.tsv
        Per dataset, truth, tag length, metric (top1, top10) and scope:
        - scope both_tagged: spectra that both tools tagged (the denominator of the rank-1 precision
          comparison); scope all_psm: every PSM spectrum, an untagged spectrum counts as not correct.
        - exact two-sided McNemar test on the discordant pairs (b = only FASTag correct, c = only DirecTag
          correct), Holm-adjusted within each family (truth, tag length, metric, scope) across datasets;
        - difference FASTag - DirecTag with a 95% percentile bootstrap CI that resamples peptides (all
          spectra of a drawn peptide go in together), 2,000 draws, fixed seed.
    results/stats_runlevel_v190.tsv
        Protease, label and alkylation calls against SDRF truth (table_s3_digest_truth_v190.tsv): per task
        and subset, accuracy over evaluable runs (a no-call counts as wrong) and over called runs, the
        majority-class baseline on the same runs, balanced accuracy (mean per-class recall over the truth
        classes present; a no-call is a miss), coverage, and per class the recall with a 95% Wilson interval
        and the number of runs and PXDs.

Usage
    python scripts/stats_paired.py export --fastag-work W190 --directag-work W --data-dir D \
        --datasets datasets.yaml --out results/accuracy_pairs_v190.tsv.gz
    python scripts/stats_paired.py stats --results results
"""
from __future__ import annotations

import argparse
import gzip
import io
import math
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from fastag_bench.tsv import write_tsv  # noqa: E402

N_BOOT = 2000
SEED = 20261104
Z95 = 1.959963984540054
PAIR_COLS = ["dataset", "pxd", "truth", "tag_length", "key", "peptide",
             "ft_tagged", "ft_top1", "ft_top10", "dt_tagged", "dt_top1", "dt_top10"]


# ----------------------------------------------------------------------------------------------- statistics
def wilson(k: int, n: int, z: float = Z95) -> tuple[float, float]:
    """95% Wilson score interval for k successes in n trials; (nan, nan) for n = 0."""
    if n == 0:
        return (math.nan, math.nan)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def _log_binom_pmf(i: int, n: int) -> float:
    return math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) - n * math.log(2)


def mcnemar_exact(b: int, c: int) -> float:
    """Exact two-sided McNemar p-value: 2 * P(X <= min(b, c)), X ~ Bin(b + c, 1/2), capped at 1."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    logs = [_log_binom_pmf(i, n) for i in range(k + 1)]
    m = max(logs)
    tail = math.exp(m) * sum(math.exp(x - m) for x in logs)
    return min(1.0, 2.0 * tail)


def holm(pvals: list[float]) -> list[float]:
    """Holm step-down adjusted p-values, returned in input order."""
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i])
    adj = [0.0] * m
    running = 0.0
    for r, i in enumerate(order):
        running = max(running, min(1.0, (m - r) * pvals[i]))
        adj[i] = running
    return adj


def cluster_bootstrap_diff(cluster: np.ndarray, a: np.ndarray, b: np.ndarray, n_boot: int = N_BOOT,
                           seed: int = SEED) -> tuple[float, float]:
    """95% percentile CI of mean(a) - mean(b), resampling whole clusters with replacement."""
    codes, inv = np.unique(cluster, return_inverse=True)
    g = len(codes)
    if g < 2:
        return (math.nan, math.nan)
    n_g = np.bincount(inv, minlength=g).astype(float)
    a_g = np.bincount(inv, weights=a.astype(float), minlength=g)
    b_g = np.bincount(inv, weights=b.astype(float), minlength=g)
    rng = np.random.default_rng(seed)
    out = np.empty(n_boot)
    for i in range(n_boot):
        w = np.bincount(rng.integers(0, g, size=g), minlength=g).astype(float)
        out[i] = (w @ a_g - w @ b_g) / (w @ n_g)
    lo, hi = np.quantile(out, [0.025, 0.975])
    return (float(lo), float(hi))


# ----------------------------------------------------------------------------------------------- export
def _profile(tool: str, tl: int) -> str:
    return f"{tool}_matched" if tl == 3 else f"{tool}_matched_tl{tl}"


def pair_rows(ds_id: str, pxd: str, truth: str, tl: int, psms: pd.DataFrame, ft: pd.DataFrame | None,
              dt: pd.DataFrame | None) -> pd.DataFrame:
    """One row per PSM spectrum with both tools' outcomes (flank rule)."""
    from fastag_bench import score as S

    gt = psms[["key", "peptide"]].drop_duplicates("key").reset_index(drop=True)
    out = pd.DataFrame({"dataset": ds_id, "pxd": pxd, "truth": truth, "tag_length": tl, "key": gt["key"],
                        "peptide": [S.normalize_peptide(p) for p in gt["peptide"]]})
    for pre, tags in (("ft", ft), ("dt", dt)):
        if tags is None or tags.empty:
            out[f"{pre}_tagged"] = 0
            out[f"{pre}_top1"] = 0
            out[f"{pre}_top10"] = 0
            continue
        m = S._mark(tags, gt, "flank")
        tagged = set(m["key"])
        top1 = set(m.loc[(m["rank"] == 1) & m["correct"], "key"])
        top10 = set(m.loc[(m["rank"] <= 10) & m["correct"], "key"])
        out[f"{pre}_tagged"] = out["key"].isin(tagged).astype(int)
        out[f"{pre}_top1"] = out["key"].isin(top1).astype(int)
        out[f"{pre}_top10"] = out["key"].isin(top10).astype(int)
    return out[PAIR_COLS]


def export(args) -> Path:
    from fastag_bench import accuracy as A
    from fastag_bench.config import load_datasets

    ft_cfg = {"work_dir": args.fastag_work, "data_dir": args.data_dir, "sage": {"fdr": args.fdr}}
    dt_cfg = {"work_dir": args.directag_work, "data_dir": args.data_dir, "sage": {"fdr": args.fdr}}
    parts, notes = [], []
    for ds in load_datasets(args.datasets):
        if not (Path(args.directag_work) / "runs" / ds.id).is_dir():
            continue
        for engine in ("sage", "mascot", "comet"):
            psms, src = A.ground_truth(dt_cfg, ds, engine)
            if psms is None:
                continue
            for tl in range(3, 9):
                ft, ftv = A.read_profile_tags(ft_cfg, ds, _profile("fastag", tl))
                dt, dtv = A.read_profile_tags(dt_cfg, ds, _profile("directag", tl))
                if ft is None or dt is None:
                    continue
                df = pair_rows(ds.id, ds.pxd, engine, tl, psms, ft, dt)
                parts.append(df)
                notes.append(f"{ds.id} {engine} TL{tl}: {len(df)} PSM spectra; FASTag {ftv}; DirecTag {dtv}; "
                             f"truth {src}")
                print(notes[-1], flush=True)
    res = pd.concat(parts, ignore_index=True)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    prov = [f"source: scripts/stats_paired.py export ({datetime.now().astimezone().isoformat(timespec='seconds')}); "
            f"FASTag run dirs {args.fastag_work}, DirecTag and truth run dirs {args.directag_work}, "
            f"data {args.data_dir}; FDR {args.fdr}; matched profiles; flank rule (score.tag_correct_flank)",
            "columns ft_* = FASTag, dt_* = DirecTag; tagged = spectrum has at least one tag; top1 = rank-1 tag "
            "correct; top10 = any of the first 10 tags correct; peptide I/L-normalized (score.normalize_peptide)"]
    prov += [f"part: {n}" for n in notes]
    opener = gzip.open if out.suffix == ".gz" else open
    with opener(out, "wt") as fh:
        for line in prov:
            fh.write(f"# {line}\n")
        res.to_csv(fh, sep="\t", index=False)
    return out


# ----------------------------------------------------------------------------------------------- stats
def read_any_tsv(path: str | Path) -> tuple[pd.DataFrame, list[str]]:
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt") as fh:
        text = fh.read()
    prov, body, head = [], [], True
    for line in text.splitlines(keepends=True):
        if head and line.startswith("#"):
            prov.append(line[1:].strip())
            continue
        head = False
        body.append(line)
    return pd.read_csv(io.StringIO("".join(body)), sep="\t", keep_default_na=False, na_values=[""]), prov


def paired_table(pairs: pd.DataFrame, n_boot: int = N_BOOT, seed: int = SEED) -> pd.DataFrame:
    rows = []
    for (ds, pxd, truth, tl), g in pairs.groupby(["dataset", "pxd", "truth", "tag_length"], sort=True):
        for scope in ("both_tagged", "all_psm"):
            s = g[(g["ft_tagged"] == 1) & (g["dt_tagged"] == 1)] if scope == "both_tagged" else g
            for metric in ("top1", "top10"):
                a = s[f"ft_{metric}"].to_numpy()
                b = s[f"dt_{metric}"].to_numpy()
                n = len(s)
                nb = int(((a == 1) & (b == 0)).sum())
                nc = int(((a == 0) & (b == 1)).sum())
                lo, hi = cluster_bootstrap_diff(s["peptide"].to_numpy(), a, b, n_boot, seed) if n else (math.nan,) * 2
                rows.append({"dataset": ds, "pxd": pxd, "truth": truth, "tag_length": int(tl), "metric": metric,
                             "scope": scope, "spectra": n, "peptides": int(s["peptide"].nunique()),
                             "fastag_correct": int(a.sum()), "directag_correct": int(b.sum()),
                             "fastag_rate": round(a.mean(), 6) if n else math.nan,
                             "directag_rate": round(b.mean(), 6) if n else math.nan,
                             "diff": round(a.mean() - b.mean(), 6) if n else math.nan,
                             "diff_ci_lo": round(lo, 6), "diff_ci_hi": round(hi, 6),
                             "only_fastag": nb, "only_directag": nc, "p_mcnemar": mcnemar_exact(nb, nc)})
    df = pd.DataFrame(rows)
    df["p_holm"] = np.nan
    df["holm_family_size"] = 0
    for _, idx in df.groupby(["truth", "tag_length", "metric", "scope"]).groups.items():
        idx = list(idx)
        df.loc[idx, "p_holm"] = holm(df.loc[idx, "p_mcnemar"].tolist())
        df.loc[idx, "holm_family_size"] = len(idx)
    df["significant_0.05"] = df["p_holm"] < 0.05
    df["leader"] = np.where(~df["significant_0.05"], "none",
                            np.where(df["diff"] > 0, "FASTag", "DirecTag"))
    return df


def _flag(x) -> bool:
    return str(x).strip().lower() == "true"


def _cls(x):
    return None if x is None or (isinstance(x, float) and pd.isna(x)) or str(x) in ("", "nan") else str(x)


def runlevel_rows(df: pd.DataFrame, task: str, subset: str, truth: str, call: str, evaluable: str,
                  nocall: tuple = (None, "unknown")) -> list[dict]:
    ev = df[df[evaluable].map(_flag)].copy()
    ev["_t"] = ev[truth].map(_cls)
    ev["_c"] = ev[call].map(_cls)
    ev = ev[ev["_t"].notna()]
    n = len(ev)
    if n == 0:
        return []
    # A missing call or 'unknown' is a no-call (coverage, accuracy_called). Correctness compares call and
    # truth directly, so for alkylation an 'unknown' answer is correct where the SDRF names no cysteine
    # modification (truth 'unknown'; score_digest_truth.py rule).
    is_call = ev["_c"].notna() & ~ev["_c"].isin([x for x in nocall if x is not None])
    correct = ev["_c"].notna() & (ev["_c"] == ev["_t"])
    called = ev[is_call]
    counts = ev["_t"].value_counts().sort_index().sort_values(ascending=False, kind="stable")
    major = counts.index[0]
    classes = sorted(counts.index)
    recalls = {c: correct[ev["_t"] == c].mean() for c in classes}
    bal = float(np.mean(list(recalls.values())))
    ccounts = called["_t"].value_counts().sort_index().sort_values(ascending=False, kind="stable")
    base_called = ccounts.iloc[0] / len(called) if len(called) else math.nan
    lo, hi = wilson(int(correct.sum()), n)
    common = {"task": task, "subset": subset}
    rows = [{**common, "class": "all", "runs": n, "pxds": int(ev["acc"].nunique()), "called": int(is_call.sum()),
             "correct": int(correct.sum()), "coverage": round(is_call.mean(), 4),
             "accuracy_all": round(correct.mean(), 4), "ci_lo": round(lo, 4), "ci_hi": round(hi, 4),
             "accuracy_called": round(correct[is_call].mean(), 4) if is_call.any() else math.nan,
             "majority_class": major, "majority_accuracy_all": round(counts.iloc[0] / n, 4),
             "majority_class_called": ccounts.index[0] if len(called) else "",
             "majority_accuracy_called": round(base_called, 4),
             "balanced_accuracy": round(bal, 4), "majority_balanced_accuracy": round(1 / len(classes), 4),
             "classes": len(classes)}]
    for c in classes:
        sel = ev["_t"] == c
        k, m = int(correct[sel].sum()), int(sel.sum())
        lo, hi = wilson(k, m)
        wrong = ev.loc[sel & is_call & ~correct, "_c"].value_counts()
        rows.append({**common, "class": c, "runs": m, "pxds": int(ev.loc[sel, "acc"].nunique()),
                     "called": int((sel & is_call).sum()), "correct": k,
                     "coverage": round((sel & is_call).sum() / m, 4), "accuracy_all": round(k / m, 4),
                     "ci_lo": round(lo, 4), "ci_hi": round(hi, 4),
                     "accuracy_called": round((sel & is_call & correct).sum() / (sel & is_call).sum(), 4)
                     if (sel & is_call).any() else math.nan,
                     "wrong_calls": "; ".join(f"{x} {v}" for x, v in wrong.items())})
    return rows


def runlevel_table(truth: pd.DataFrame) -> pd.DataFrame:
    rows = []
    subsets = [("all", truth), ("validation", truth[truth["subset"] == "validation"]),
               ("independent_nontryptic", truth[truth["subset"] != "validation"])]
    if "sdrf_kind" in truth.columns:
        subsets.append(("submitter_sdrf", truth[truth["sdrf_kind"] == "submitter"]))
    for name, d in subsets:
        rows += runlevel_rows(d, "protease_shipped", name, "enzyme_truth", "shipped_call", "enzyme_evaluable")
        rows += runlevel_rows(d, "protease_prose", name, "enzyme_truth", "prose_call", "enzyme_evaluable")
        rows += runlevel_rows(d, "label_termini", name, "label_truth_class", "label_call_class", "label_evaluable")
        rows += runlevel_rows(d, "label_combined", name, "label_truth_class", "label_call_combined", "label_evaluable")
        rows += runlevel_rows(d, "alkylation", name, "alk_truth_class", "alk_call", "alk_evaluable")
    return pd.DataFrame(rows)


def stats(args) -> list[Path]:
    res = Path(args.results)
    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    written = []
    pairs_path = res / "accuracy_pairs_v190.tsv.gz"
    if pairs_path.exists():
        pairs, prov = read_any_tsv(pairs_path)
        tab = paired_table(pairs)
        written.append(write_tsv(tab, res / "stats_accuracy_paired_v190.tsv", [
            f"source: scripts/stats_paired.py stats ({stamp}) on {pairs_path.name}",
            "exact two-sided McNemar on discordant spectra; Holm within (truth, tag_length, metric, scope) across "
            f"datasets; 95% percentile bootstrap CI of the difference, peptides resampled, {N_BOOT} draws, seed {SEED}",
            "scope both_tagged = spectra tagged by both tools; all_psm = every PSM spectrum (untagged = not correct); "
            "leader = tool with the higher rate where p_holm < 0.05, else none"] + [f"input: {p}" for p in prov[:2]]))
    truth_path = res / "table_s3_digest_truth_v190.tsv"
    truth, tprov = read_any_tsv(truth_path)
    rl = runlevel_table(truth)
    written.append(write_tsv(rl, res / "stats_runlevel_v190.tsv", [
        f"source: scripts/stats_paired.py stats ({stamp}) on {truth_path.name}",
        "accuracy_all: no-call = wrong; accuracy_called: among called runs; majority_*: always answering the most "
        "frequent truth class of the same runs; balanced_accuracy: mean per-class recall (no-call = miss); "
        "ci_lo/ci_hi: 95% Wilson interval of accuracy_all; subset independent_nontryptic = the 10 runs added "
        "outside the prose-auto validation sets",
        "alkylation: 'unknown' is a no-call, and the correct answer where the SDRF lists no cysteine modification"]
        + [f"input: {p}" for p in tprov[:1]]))
    for p in written:
        print(p)
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export")
    e.add_argument("--fastag-work", required=True)
    e.add_argument("--directag-work", required=True)
    e.add_argument("--data-dir", required=True)
    e.add_argument("--datasets", default=str(HERE.parent / "datasets.yaml"))
    e.add_argument("--fdr", type=float, default=0.01)
    e.add_argument("--out", default=str(HERE.parent / "results" / "accuracy_pairs_v190.tsv.gz"))
    s = sub.add_parser("stats")
    s.add_argument("--results", default=str(HERE.parent / "results"))
    a = ap.parse_args(argv)
    export(a) if a.cmd == "export" else stats(a)


if __name__ == "__main__":
    main()
