#!/usr/bin/env python3
"""Statistics for FASTag 1.12 item #4 (tag accuracy on unidentified and chimeric spectra).

Pre-registered in output/features-1.12/validation-registry.tsv rows F4-01..F4-07 (PLAN-qc.md item #4):
- intervals: 95% percentile cluster bootstrap (scripts/stats_paired.cluster_bootstrap_diff, reused), clusters =
  I/L-normalized peptide for S0 and S3-PT size-1, pool for pool_consistent, union of both parents for chimeras;
- paired comparisons (-diversity on/off): cluster sign-flip permutation test on the cluster-summed
  differences, exact up to 16 clusters, Monte Carlo otherwise, Holm over the family; exact McNemar is
  descriptive only (not cluster-corrected).

Usage
    python scripts/stats_unidentified.py <results>/unidentified/<split>
"""
from __future__ import annotations

import importlib.util
import itertools
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

_spec = importlib.util.spec_from_file_location("stats_paired", HERE / "stats_paired.py")
SP = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SP)

from fastag_bench.tsv import read_tsv, write_tsv  # noqa: E402

N_BOOT = SP.N_BOOT
SEED = SP.SEED
N_PERM = 20000
MARGIN_DEFAULT = 0.05
TRANSFER_BOUND = 0.10
DIVERSITY_GAIN = 0.03
DIVERSITY_LOSS = 0.005


# ----------------------------------------------------------------------------------------------- tests
def cluster_permutation(cluster, d, n_perm: int = N_PERM, seed: int = SEED, exact_max: int = 16) -> float:
    """Two-sided sign-flip permutation p-value of sum(d) with whole clusters flipped together.
    Exact enumeration of all 2^G sign patterns when G <= exact_max, else n_perm random patterns with the
    (k + 1) / (n + 1) correction."""
    cluster = np.asarray(cluster)
    d = np.asarray(d, dtype=float)
    _, inv = np.unique(cluster, return_inverse=True)
    s = np.bincount(inv, weights=d)
    t_obs = abs(s.sum())
    if t_obs == 0:
        return 1.0
    g = len(s)
    eps = 1e-9 * max(1.0, t_obs)
    if g <= exact_max:
        signs = np.array(list(itertools.product((1.0, -1.0), repeat=g)))
        return float((np.abs(signs @ s) >= t_obs - eps).sum()) / 2 ** g
    rng = np.random.default_rng(seed)
    signs = rng.choice((-1.0, 1.0), size=(n_perm, g))
    k = int((np.abs(signs @ s) >= t_obs - eps).sum())
    return (k + 1) / (n_perm + 1)


def cluster_bootstrap_ci(cluster, a, n_boot: int = N_BOOT, seed: int = SEED) -> tuple[float, float]:
    """95% percentile CI of mean(a), whole clusters resampled (stats_paired.cluster_bootstrap_diff vs 0)."""
    a = np.asarray(a, dtype=float)
    return SP.cluster_bootstrap_diff(np.asarray(cluster), a, np.zeros_like(a), n_boot, seed)


def spectrum_bootstrap_ci(a, n_boot: int = N_BOOT, seed: int = SEED) -> tuple[float, float]:
    """The naive interval (every spectrum its own cluster), for comparison only."""
    a = np.asarray(a, dtype=float)
    return cluster_bootstrap_ci(np.arange(len(a)), a, n_boot, seed)


def union_clusters(p1, p2) -> np.ndarray:
    """Cluster ids for chimeras: connected components over parent peptides (a chimera joins its two
    parents' peptides; chimeras sharing a parent peptide fall into one cluster)."""
    parent: dict = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in zip(p1, p2):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    return np.array([find(a) for a in p1])


# ----------------------------------------------------------------------------------------------- verdicts
def informative_verdict(lo: float, margin: float = MARGIN_DEFAULT) -> str:
    if lo is None or (isinstance(lo, float) and math.isnan(lo)):
        return "not evaluable"
    return "holds" if lo > margin else "not shown"


def transfer_verdict(diff: float, lo: float, hi: float, bound: float = TRANSFER_BOUND) -> str:
    if abs(diff) > bound:
        return "not shown"
    if -bound <= lo and hi <= bound:
        return "transfer shown"
    return "inconclusive"


def diversity_verdict(gain_both: float, p_both_holm: float, loss_pep1: float) -> str:
    ok = gain_both >= DIVERSITY_GAIN and p_both_holm < 0.05 and loss_pep1 <= DIVERSITY_LOSS
    return "benefit" if ok else "no benefit claimed"


# ----------------------------------------------------------------------------------------------- tables
def _ci(cluster, a, n_boot=N_BOOT):
    if len(a) == 0:
        return (math.nan, math.nan)
    return cluster_bootstrap_ci(cluster, a, n_boot)


def endpoint_rows(sp: pd.DataFrame, n_boot: int = N_BOOT, margin: float = MARGIN_DEFAULT) -> pd.DataFrame:
    """F4-01..F4-03 per profile from the per-spectrum table (unidentified.score_pool rows)."""
    rows = []
    for prof, g in sp.groupby("profile", sort=True):
        t3 = g[(g.identification == "S3-PT") & (g.size_label == "size1") & (g.tagged == 1)]
        tr = t3[t3.arm == "truth"].set_index("key")
        ch = t3[t3.arm == "chance"].set_index("key").reindex(tr.index)
        a, b = tr["top1"].to_numpy(float), ch["top1"].fillna(0).to_numpy(float)
        cl = tr["cluster"].to_numpy()
        lo, hi = SP.cluster_bootstrap_diff(cl, a, b, n_boot, SEED) if len(a) > 1 else (math.nan, math.nan)
        rows.append({"endpoint": "F4-01 S3PT size1 rank1 minus pool-swap chance", "profile": prof, "spectra": len(a),
                     "clusters": len(set(cl)), "value": _mean(a) - _mean(b), "ci_lo": lo, "ci_hi": hi,
                     "rank1_accuracy": _mean(a), "chance": _mean(b), "margin": margin,
                     "verdict": informative_verdict(lo, margin)})
        s0 = g[(g.identification == "S0") & (g.size_label == "s0") & (g.arm == "truth") & (g.tagged == 1)]
        a0 = s0["top1"].to_numpy(float)
        # F4-03 selection bias: S0 - S3 size-1, unpaired; clusters from both sets (bootstrap per set)
        lo0, hi0 = _ci(s0["cluster"].to_numpy(), a0, n_boot)
        lo3, hi3 = _ci(cl, a, n_boot)
        rows.append({"endpoint": "F4-03 selection bias S0 - S3PT size1 rank1", "profile": prof,
                     "spectra": len(a0) + len(a), "value": _mean(a0) - _mean(a),
                     "ci_lo": _diff_ci(s0["cluster"].to_numpy(), a0, cl, a, n_boot)[0],
                     "ci_hi": _diff_ci(s0["cluster"].to_numpy(), a0, cl, a, n_boot)[1],
                     "s0_rank1": _mean(a0), "s0_ci": f"{lo0:.4f}..{hi0:.4f}", "s3_ci": f"{lo3:.4f}..{hi3:.4f}",
                     "verdict": "reported"})
        # F4-02 precision transfer at E <= 0.01 (per-tag precision; spectra as clusters of tags)
        s3e = g[(g.identification == "S3-PT") & (g.size_label == "size1") & (g.arm == "truth") & (g.n_tags_e001 > 0)]
        s0e = g[(g.identification == "S0") & (g.size_label == "s0") & (g.arm == "truth") & (g.n_tags_e001 > 0)]
        p0 = _ratio(s0e)
        p3 = _ratio(s3e)
        lo2, hi2 = _ratio_diff_ci(s0e, s3e, n_boot)
        rows.append({"endpoint": "F4-02 precision transfer E<=0.01 S0 - S3PT size1", "profile": prof,
                     "spectra": len(s0e) + len(s3e), "value": p0 - p3, "ci_lo": lo2, "ci_hi": hi2,
                     "s0_precision": p0, "s3_precision": p3,
                     "verdict": transfer_verdict(p0 - p3, lo2, hi2) if not math.isnan(p0 - p3) else "not evaluable"})
    return pd.DataFrame(rows)


def _mean(a) -> float:
    return float(np.mean(a)) if len(a) else math.nan


def _ratio(df) -> float:
    n = df["n_tags_e001"].sum()
    return float(df["n_correct_e001"].sum() / n) if n else math.nan


def _diff_ci(c0, a0, c1, a1, n_boot):
    """CI of mean(a0) - mean(a1) for two independent cluster samples (each resampled by its clusters)."""
    if len(a0) < 2 or len(a1) < 2:
        return (math.nan, math.nan)
    rng = np.random.default_rng(SEED)
    out = np.empty(n_boot)
    g0 = _groups(c0, a0)
    g1 = _groups(c1, a1)
    for i in range(n_boot):
        out[i] = _resample(g0, rng) - _resample(g1, rng)
    lo, hi = np.quantile(out, [0.025, 0.975])
    return (float(lo), float(hi))


def _groups(c, a):
    codes, inv = np.unique(c, return_inverse=True)
    return np.bincount(inv, weights=a), np.bincount(inv).astype(float)


def _resample(g, rng):
    s, n = g
    w = np.bincount(rng.integers(0, len(s), size=len(s)), minlength=len(s)).astype(float)
    return (w @ s) / (w @ n)


def _ratio_diff_ci(d0, d1, n_boot):
    if len(d0) < 2 or len(d1) < 2:
        return (math.nan, math.nan)
    rng = np.random.default_rng(SEED)
    g0 = _groups(d0["cluster"].to_numpy(), d0["n_correct_e001"].to_numpy(float))
    n0 = _groups(d0["cluster"].to_numpy(), d0["n_tags_e001"].to_numpy(float))[0]
    g1 = _groups(d1["cluster"].to_numpy(), d1["n_correct_e001"].to_numpy(float))
    n1 = _groups(d1["cluster"].to_numpy(), d1["n_tags_e001"].to_numpy(float))[0]
    out = np.empty(n_boot)
    for i in range(n_boot):
        w0 = np.bincount(rng.integers(0, len(n0), size=len(n0)), minlength=len(n0)).astype(float)
        w1 = np.bincount(rng.integers(0, len(n1), size=len(n1)), minlength=len(n1)).astype(float)
        out[i] = (w0 @ g0[0]) / (w0 @ n0) - (w1 @ g1[0]) / (w1 @ n1)
    lo, hi = np.quantile(out, [0.025, 0.975])
    return (float(lo), float(hi))


def chimera_rows(ch: pd.DataFrame, n_perm: int = N_PERM) -> pd.DataFrame:
    """F4-04: both-in-top-50 and pep1 rank-1 per ratio and profile; -diversity off vs on with the
    cluster permutation test and Holm over {both 1:1, both 1:10, pep1 1:1, pep1 1:10}."""
    rows, fam = [], []
    for ratio, g in ch.groupby("ratio", sort=True):
        off = g[g.profile == "matched"].set_index("key")
        on = g[g.profile == "matched_div"].set_index("key").reindex(off.index)
        cl = union_clusters(off["pep1"].map(_n), off["pep2"].map(_n))
        for metric in ("both_topk", "pep1_rank1"):
            a = off[metric].astype(float).to_numpy()
            b = on[metric].fillna(False).astype(float).to_numpy() if len(on) else np.full(len(a), np.nan)
            row = {"endpoint": "F4-04 chimera", "ratio": ratio, "metric": metric, "chimeras": len(a),
                   "clusters": len(set(cl)), "off": _mean(a), "on": _mean(b), "diff_on_minus_off": _mean(b) - _mean(a)}
            if len(on) and not np.isnan(b).any():
                lo, hi = SP.cluster_bootstrap_diff(cl, b, a, N_BOOT, SEED)
                row.update({"ci_lo": lo, "ci_hi": hi, "p_perm": cluster_permutation(cl, b - a, n_perm)})
                fam.append(len(rows))
            rows.append(row)
        for k in ("pep1", "pep2", "both", "neither", "untagged"):
            rows.append({"endpoint": "F4-04 attribution (rank-1 tag)", "ratio": ratio, "metric": k,
                         "chimeras": len(off), "off": float((off["rank1_attribution"] == k).mean()) if len(off) else math.nan,
                         "on": float((on["rank1_attribution"] == k).mean()) if len(on) else math.nan})
    df = pd.DataFrame(rows)
    if fam:
        df.loc[fam, "p_holm"] = SP.holm(df.loc[fam, "p_perm"].tolist())
    return df


def _n(p):
    from fastag_bench.score import normalize_peptide
    return normalize_peptide(p)


def collect(split_dir: str | Path, log=print, n_boot: int = N_BOOT) -> list[Path]:
    """Summaries and endpoint tables of one split directory (spectra.tsv, controls.tsv, chimeras.tsv)."""
    from fastag_bench.unidentified import summarize

    d = Path(split_dir)
    sp, prov = read_tsv(d / "spectra.tsv")
    written = []
    summ = summarize(sp, ["profile", "identification", "arm", "size_label"])
    written.append(write_tsv(summ, d / "summary.tsv", prov[:2] + ["per cell; rank-1 and top-k over tagged scored spectra"]))
    sizes = sp[(sp.arm == "truth") & (sp.profile == sp.profile.iloc[0])].groupby(["pool", "identification", "size_label"]).size()
    written.append(write_tsv(sizes.rename("spectra").reset_index(), d / "candidate_sizes.tsv", prov[:2]))
    ep = endpoint_rows(sp, n_boot)
    written.append(write_tsv(ep, d / "endpoints.tsv", prov[:1] + [
        f"cluster bootstrap {n_boot} draws seed {SEED}; margin {MARGIN_DEFAULT} (default, to be frozen from the dev "
        "chance estimate before the test split is scored); transfer bound +-0.10"]))
    if (d / "chimeras.tsv").exists():
        ch, cprov = read_tsv(d / "chimeras.tsv")
        written.append(write_tsv(chimera_rows(ch), d / "chimera_endpoints.tsv", cprov[:1] + [
            "-diversity on minus off; cluster sign-flip permutation (union-of-parents clusters), Holm over the 4 tests"]))
    for p in written:
        log(f"wrote {p}")
    return written


if __name__ == "__main__":
    collect(sys.argv[1])
