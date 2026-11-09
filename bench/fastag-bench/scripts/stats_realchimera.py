#!/usr/bin/env python3
"""Endpoints of FASTag 1.13 item 12 (#16): tag accuracy on real chimeric spectra.

Input: the per-spectrum table of `fastag-bench realchimera score` (spectra_<split>.tsv.gz; one row per run,
spectrum, profile and arm). Spectra are pooled over the split's runs; clusters never cross runs.

Endpoints (fixed in acceptance/1.13/PREREG-item12.md; the constants below are the frozen values):

- E1 (descriptive): on Sage-chimeric spectra, profile 'default', arm 'truth': the share whose rank-1 tag is
  correct for either peptide (union_rank1), with the 95% cluster-bootstrap interval (clusters: connected
  components over the two peptides, stats_unidentified.union_clusters), the same against the chance arm,
  the rank-1 attribution shares and pep2_top10 / both_top10.
- H1 (chimeric penalty): pep1_rank1 on chimeric spectra minus pep1_rank1 on pure single spectra (single,
  MS1 purity >= PURE_MIN); two-group cluster bootstrap (each group's clusters resampled on their own).
  'penalty shown' when the upper bound < 0, 'no penalty' when the lower bound > -PENALTY_NULL_BAND and the
  upper bound < PENALTY_NULL_BAND, else 'inconclusive'.
- H2 (non-inferiority of the union): union_rank1 on chimeric minus pep1_rank1 on pure single; 'non-inferior'
  when the lower bound > -NONINF_MARGIN, else 'not shown'.
- H3 (purity gradient): on single spectra, pep1_rank1 at purity >= PURE_MIN minus at purity < IMPURE_MAX;
  'gradient shown' when the lower bound > 0, else 'not shown'.
- H4 (-diversity, paired): both_top10 under cap10_div minus cap10 on chimeric spectra; cluster sign-flip
  permutation p (stats_unidentified.cluster_permutation); verdict stats_unidentified.diversity_verdict
  (gain >= 0.03, p < 0.05, union_rank1 loss <= 0.005; one test, so no Holm adjustment).

Evaluability: an endpoint is 'not evaluable' when a group it needs has fewer than MIN_SPECTRA spectra or the
largest cluster of the chimeric set holds MAX_CLUSTER_SHARE or more of it.

Truth check (added after the 1.13 item 12 held-out result; rows 'T truth check'): with the per-run table
truthqc_<split>.tsv of the score step (realchimera.truth_qc), a run 'without truth' (no rank-1 target at
q <= fdr, or rank-1 target:decoy below realchimera.TRUTH_MIN_RATIO) is marked and left out of every group.

Sensitivity (not preregistered; rows 'S run-stratified'): H1, H2 and H3 as run-standardized differences,
sum_r w_r (mean_A,r - mean_B,r) over the runs that have both groups, with w_r the run's share of the
chimeric spectra (H1, H2) or of the pure + impure single spectra (H3); 95 % interval from a cluster
bootstrap within each run and group; plus each run's own difference. The pooled H1-H3 compare groups with
different run mixes; this row shows how much of the pooled difference is the mix.

Usage
    python scripts/stats_realchimera.py <spectra_<split>.tsv.gz> <endpoints_<split>.tsv> [truthqc_<split>.tsv]
    python scripts/stats_realchimera.py --sensitivity <spectra_<split>.tsv.gz> <out.tsv>   # S rows only
"""
from __future__ import annotations

import gzip
import importlib.util
import io
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

_spec = importlib.util.spec_from_file_location("stats_unidentified", HERE / "stats_unidentified.py")
SU = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SU)
SP = SU.SP

from fastag_bench.tsv import write_tsv  # noqa: E402

N_BOOT = SP.N_BOOT
SEED = SP.SEED
PURE_MIN = 0.9
IMPURE_MAX = 0.5
PENALTY_NULL_BAND = 0.05
NONINF_MARGIN = 0.10
MIN_SPECTRA = 100
MAX_CLUSTER_SHARE = 0.10
PURITY_BINS = (0.0, 0.25, 0.5, 0.75, 0.9, 1.0000001)
PRIMARY_PROFILE = "default"
DIV_OFF, DIV_ON = "cap10", "cap10_div"


def read_spectra(path: str | Path) -> pd.DataFrame:
    op = gzip.open if str(path).endswith(".gz") else open
    with op(path, "rt") as fh:
        body = "".join(line for line in fh if not line.startswith("#"))
    df = pd.read_csv(io.StringIO(body), sep="\t", keep_default_na=False, na_values=[""])
    for c in [c for c in df.columns if c.startswith(("pep1_", "pep2_", "both_", "union_"))] + ["tagged"]:
        df[c] = df[c].astype(str).str.lower().isin(("true", "1"))
    df["pep2"] = df["pep2"].fillna("").astype(str)
    df["cluster2"] = df["cluster2"].fillna("").astype(str)
    return df


def two_group_boot(cl_a, a, cl_b, b, n_boot: int = N_BOOT, seed: int = SEED) -> tuple[float, float, float]:
    """mean(a) - mean(b) for two independent groups and its 95% percentile interval, whole clusters
    resampled within each group (one generator, group a drawn first in each replicate)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) == 0 or len(b) == 0:
        return (math.nan, math.nan, math.nan)
    ca, ia = np.unique(np.asarray(cl_a), return_inverse=True)
    cb, ib = np.unique(np.asarray(cl_b), return_inverse=True)
    na, sa = np.bincount(ia).astype(float), np.bincount(ia, weights=a)
    nb, sb = np.bincount(ib).astype(float), np.bincount(ib, weights=b)
    rng = np.random.default_rng(seed)
    out = np.empty(n_boot)
    for i in range(n_boot):
        wa = np.bincount(rng.integers(0, len(ca), len(ca)), minlength=len(ca)).astype(float)
        wb = np.bincount(rng.integers(0, len(cb), len(cb)), minlength=len(cb)).astype(float)
        out[i] = (wa @ sa) / (wa @ na) - (wb @ sb) / (wb @ nb)
    lo, hi = np.quantile(out, [0.025, 0.975])
    return (float(a.mean() - b.mean()), float(lo), float(hi))


def max_cluster_share(cl) -> float:
    cl = np.asarray(cl)
    if len(cl) == 0:
        return math.nan
    _, n = np.unique(cl, return_counts=True)
    return float(n.max() / len(cl))


def _row(endpoint, metric, group, n, value, lo=math.nan, hi=math.nan, clusters=math.nan, p=math.nan,
         verdict="", note="") -> dict:
    return {"endpoint": endpoint, "metric": metric, "group": group, "n": int(n), "clusters": clusters,
            "value": value, "ci_lo": lo, "ci_hi": hi, "p": p, "verdict": verdict, "note": note}


def _boot_group(cl, a, rng):
    """One cluster-bootstrap mean of a (whole clusters resampled)."""
    c, i = np.unique(np.asarray(cl), return_inverse=True)
    n, s = np.bincount(i).astype(float), np.bincount(i, weights=np.asarray(a, float))
    w = np.bincount(rng.integers(0, len(c), len(c)), minlength=len(c)).astype(float)
    return (w @ s) / (w @ n)


def stratified_diff(groups, n_boot: int = N_BOOT, seed: int = SEED) -> tuple[float, float, float]:
    """groups: list of (weight, clusters_a, a, clusters_b, b), one per run. sum_r w_r (mean a_r - mean b_r)
    with the weights normalized over the runs given, and its 95 % percentile interval (clusters resampled
    within each run and group)."""
    groups = [g for g in groups if len(g[2]) and len(g[4]) and g[0] > 0]
    if not groups:
        return (math.nan, math.nan, math.nan)
    w = np.array([g[0] for g in groups], float)
    w = w / w.sum()
    est = float(sum(wi * (np.mean(np.asarray(g[2], float)) - np.mean(np.asarray(g[4], float))) for wi, g in zip(w, groups)))
    rng = np.random.default_rng(seed)
    draws = np.empty(n_boot)
    for k in range(n_boot):
        draws[k] = sum(wi * (_boot_group(g[1], g[2], rng) - _boot_group(g[3], g[4], rng)) for wi, g in zip(w, groups))
    lo, hi = np.quantile(draws, [0.025, 0.975])
    return (est, float(lo), float(hi))


def sensitivity(df: pd.DataFrame, n_boot: int = N_BOOT) -> list[dict]:
    """'S run-stratified' rows (see the module docstring): H1, H2, H3 run-standardized and per run."""
    rows = []
    d = df[(df["profile"] == PRIMARY_PROFILE) & (df["arm"] == "truth")]
    chim = d[d["category"] == "chimeric"].reset_index(drop=True)
    ucl = SU.union_clusters(chim["cluster1"].to_numpy(), chim["cluster2"].to_numpy()) if len(chim) else np.array([])
    chim = chim.assign(ucl=ucl)
    single = d[d["category"] == "single"]
    pure, impure = single[single["purity"] >= PURE_MIN], single[single["purity"] < IMPURE_MAX]
    runs = sorted(set(d["run_id"]))
    note = "sensitivity, not preregistered"
    for ep, metric in (("H1", "pep1_rank1"), ("H2", "union_rank1")):
        gs = []
        for run in runs:
            c, p = chim[chim["run_id"] == run], pure[pure["run_id"] == run]
            gs.append((len(c), c["ucl"], c[metric], p["cluster1"], p["pep1_rank1"]))
            if len(c) and len(p):
                dd, lo, hi = two_group_boot(c["ucl"], c[metric], p["cluster1"], p["pep1_rank1"], n_boot)
                rows.append(_row(f"S run-stratified {ep}", f"{metric} chimeric - pep1_rank1 pure single", run,
                                 len(c) + len(p), dd, lo, hi, note=f"{note}; chimeric n {len(c)}, pure single n {len(p)}"))
        est, lo, hi = stratified_diff(gs, n_boot)
        rows.append(_row(f"S run-stratified {ep}", f"{metric} chimeric - pep1_rank1 pure single", "weighted by chimeric",
                         len(chim) + len(pure), est, lo, hi,
                         note=f"{note}; runs {sum(1 for g in gs if len(g[2]) and len(g[4]))}"))
    gs = []
    for run in runs:
        p, q = pure[pure["run_id"] == run], impure[impure["run_id"] == run]
        gs.append((len(p) + len(q), p["cluster1"], p["pep1_rank1"], q["cluster1"], q["pep1_rank1"]))
        if len(p) and len(q):
            dd, lo, hi = two_group_boot(p["cluster1"], p["pep1_rank1"], q["cluster1"], q["pep1_rank1"], n_boot)
            rows.append(_row("S run-stratified H3", "pep1_rank1 pure - impure (single)", run, len(p) + len(q), dd, lo, hi,
                             note=f"{note}; pure n {len(p)}, impure n {len(q)}"))
    est, lo, hi = stratified_diff(gs, n_boot)
    rows.append(_row("S run-stratified H3", "pep1_rank1 pure - impure (single)", "weighted by single",
                     len(pure) + len(impure), est, lo, hi, note=f"{note}; runs {sum(1 for g in gs if len(g[2]) and len(g[4]))}"))
    return rows


def truth_rows(qc: pd.DataFrame) -> list[dict]:
    rows = []
    for r in qc.itertuples():
        rows.append(_row("T truth check", "rank-1 target PSMs at q <= fdr", r.run_id, int(r.target_pass),
                         float(r.target_pass), verdict=r.status,
                         note=f"rank-1 target {r.rank1_target}, decoy {r.rank1_decoy}, ratio {float(r.td_ratio):.3f}"
                              + (f"; {r.reason}" if isinstance(r.reason, str) and r.reason else "")))
    return rows


def endpoints(df: pd.DataFrame, n_boot: int = N_BOOT, truthqc: pd.DataFrame | None = None) -> pd.DataFrame:
    rows = []
    if truthqc is not None and len(truthqc):
        rows += truth_rows(truthqc)
        drop = set(truthqc.loc[truthqc["status"] != "truth", "run_id"])
        df = df[~df["run_id"].isin(drop)]
    d = df[(df["profile"] == PRIMARY_PROFILE)]
    tr, ch = d[d["arm"] == "truth"], d[d["arm"] == "chance"]
    chim = tr[tr["category"] == "chimeric"].reset_index(drop=True)
    chim_c = ch[ch["category"] == "chimeric"].set_index(["run_id", "key"]).loc[
        list(zip(chim["run_id"], chim["key"]))].reset_index()
    single = tr[tr["category"] == "single"]
    pure = single[single["purity"] >= PURE_MIN]
    impure = single[single["purity"] < IMPURE_MAX]
    ucl = SU.union_clusters(chim["cluster1"].to_numpy(), chim["cluster2"].to_numpy()) if len(chim) else np.array([])
    share = max_cluster_share(ucl)
    big = not (share < MAX_CLUSTER_SHARE)
    nchim = len(chim)
    ok_chim = nchim >= MIN_SPECTRA and not big
    why_chim = "" if ok_chim else f"chimeric n={nchim} (min {MIN_SPECTRA}), largest cluster share {share:.3f} (max {MAX_CLUSTER_SHARE})"

    # counts and validity controls
    for cat in ("chimeric", "nested", "single"):
        g = tr[tr["category"] == cat]
        rows.append(_row("counts", "spectra", cat, len(g), float(len(g)), note=f"runs {g['run_id'].nunique()}"))
        rows.append(_row("V1 purity", "median_purity", cat, int(g["purity"].notna().sum()),
                         float(g["purity"].median()) if len(g) else math.nan))
    rows.append(_row("counts", "spectra", "single_pure", len(pure), float(len(pure))))
    rows.append(_row("counts", "spectra", "single_impure", len(impure), float(len(impure))))
    rows.append(_row("V2 clusters", "max_cluster_share", "chimeric", nchim, share, clusters=len(np.unique(ucl)) if nchim else 0))

    # E1
    for metric in ("union_rank1", "pep1_rank1", "pep2_rank1", "both_rank1", "pep2_top10", "both_top10", "pep2_top50",
                   "both_top50"):
        for arm, g in (("truth", chim), ("chance", chim_c)):
            if not len(g):
                rows.append(_row("E1 chimeric", metric, arm, 0, math.nan, verdict="not evaluable"))
                continue
            a = g[metric].to_numpy(float)
            lo, hi = SU.cluster_bootstrap_ci(ucl, a, n_boot)
            rows.append(_row("E1 chimeric", metric, arm, len(g), float(a.mean()), lo, hi, len(np.unique(ucl)),
                             verdict="" if ok_chim else "not evaluable", note=why_chim))
    if nchim and {"hdr1", "hdr2"} <= set(chim.columns):
        h1 = chim["hdr1"].astype(str).str.lower().isin(("true", "1"))
        h2 = chim["hdr2"].astype(str).str.lower().isin(("true", "1"))
        for lab, msk in (("pep1 at header", h1 & ~h2), ("pep2 at header", h2 & ~h1), ("both at header", h1 & h2),
                         ("neither at header", ~h1 & ~h2)):
            g = chim[msk]
            for metric in ("pep1_rank1", "pep2_rank1", "union_rank1"):
                rows.append(_row("E1 by header", metric, lab, len(g), float(g[metric].mean()) if len(g) else math.nan))
    for att in ("pep1", "pep2", "both", "neither", "untagged"):
        rows.append(_row("E1 attribution", "rank1_tag", att, nchim,
                         float((chim["attribution"] == att).mean()) if nchim else math.nan))

    # H1 / H2 (the cluster-share gate applies to every group a bootstrap resamples)
    pure_share, impure_share = max_cluster_share(pure["cluster1"]), max_cluster_share(impure["cluster1"])
    rows.append(_row("V2 clusters", "max_cluster_share", "single_pure", len(pure), pure_share,
                     clusters=pure["cluster1"].nunique()))
    rows.append(_row("V2 clusters", "max_cluster_share", "single_impure", len(impure), impure_share,
                     clusters=impure["cluster1"].nunique()))
    ok_pure = len(pure) >= MIN_SPECTRA and pure_share < MAX_CLUSTER_SHARE
    ok_impure = len(impure) >= MIN_SPECTRA and impure_share < MAX_CLUSTER_SHARE
    for ep, metric in (("H1 chimeric penalty", "pep1_rank1"), ("H2 union non-inferiority", "union_rank1")):
        if not (ok_chim and ok_pure):
            rows.append(_row(ep, f"{metric} chimeric - pep1_rank1 pure single", "chimeric vs single_pure", nchim + len(pure),
                             math.nan, verdict="not evaluable",
                             note=why_chim or f"pure single n={len(pure)} (min {MIN_SPECTRA}), largest cluster share {pure_share:.3f}"))
            continue
        diff, lo, hi = two_group_boot(ucl, chim[metric], pure["cluster1"], pure["pep1_rank1"], n_boot)
        if ep.startswith("H1"):
            v = ("penalty shown" if hi < 0 else
                 "no penalty" if lo > -PENALTY_NULL_BAND and hi < PENALTY_NULL_BAND else "inconclusive")
        else:
            v = "non-inferior" if lo > -NONINF_MARGIN else "not shown"
        rows.append(_row(ep, f"{metric} chimeric - pep1_rank1 pure single", "chimeric vs single_pure", nchim + len(pure),
                         diff, lo, hi, verdict=v,
                         note=f"chimeric {chim[metric].mean():.4f} (n {nchim}), pure single {pure['pep1_rank1'].mean():.4f} (n {len(pure)})"))

    # H3
    if ok_pure and ok_impure:
        diff, lo, hi = two_group_boot(pure["cluster1"], pure["pep1_rank1"], impure["cluster1"], impure["pep1_rank1"], n_boot)
        rows.append(_row("H3 purity gradient", "pep1_rank1 pure - impure (single)", "single", len(pure) + len(impure),
                         diff, lo, hi, verdict="gradient shown" if lo > 0 else "not shown",
                         note=f"pure {pure['pep1_rank1'].mean():.4f} (n {len(pure)}), impure {impure['pep1_rank1'].mean():.4f} (n {len(impure)})"))
    else:
        rows.append(_row("H3 purity gradient", "pep1_rank1 pure - impure (single)", "single", len(pure) + len(impure),
                         math.nan, verdict="not evaluable",
                         note=f"pure n={len(pure)} share {pure_share:.3f}, impure n={len(impure)} share {impure_share:.3f}"))
    bins = pd.cut(single["purity"], list(PURITY_BINS), right=False)
    for b, g in single.groupby(bins, observed=False):
        rows.append(_row("purity bins", "pep1_rank1", f"single {b}", len(g), float(g["pep1_rank1"].mean()) if len(g) else math.nan))
    cb = pd.cut(chim["purity"], list(PURITY_BINS), right=False)
    for b, g in chim.groupby(cb, observed=False):
        rows.append(_row("purity bins", "union_rank1", f"chimeric {b}", len(g), float(g["union_rank1"].mean()) if len(g) else math.nan))

    # H4
    t = df[(df["arm"] == "truth") & (df["category"] == "chimeric") & df["profile"].isin([DIV_OFF, DIV_ON])]
    if set(t["profile"]) == {DIV_OFF, DIV_ON} and ok_chim:
        w = t.pivot_table(index=["run_id", "key"], columns="profile", values=["both_top10", "union_rank1", "pep1_top10",
                                                                             "pep2_top10"], aggfunc="first")
        keys = list(zip(chim["run_id"], chim["key"]))
        w = w.reindex(keys)
        complete = not w.isna().any().any() and len(w) == nchim
    if set(t["profile"]) == {DIV_OFF, DIV_ON} and ok_chim and not complete:
        rows.append(_row("H4 diversity", "both_top10 cap10_div - cap10", "chimeric", nchim, math.nan,
                         verdict="not evaluable", note="cap10/cap10_div rows missing for some chimeric spectra"))
    elif set(t["profile"]) == {DIV_OFF, DIV_ON} and ok_chim:
        dboth = w[("both_top10", DIV_ON)].astype(float).to_numpy() - w[("both_top10", DIV_OFF)].astype(float).to_numpy()
        dun = w[("union_rank1", DIV_ON)].astype(float).to_numpy() - w[("union_rank1", DIV_OFF)].astype(float).to_numpy()
        p = SU.cluster_permutation(ucl, dboth)
        draws = SU.boot_diff_draws(ucl, dboth, np.zeros_like(dboth), n_boot)
        lo, hi = (np.quantile(draws, [0.025, 0.975]) if len(draws) else (math.nan, math.nan))
        gain, loss = float(dboth.mean()), float(-dun.mean())
        rows.append(_row("H4 diversity", "both_top10 cap10_div - cap10", "chimeric", nchim, gain, float(lo), float(hi),
                         len(np.unique(ucl)), p, SU.diversity_verdict(gain, p, loss),
                         note=f"union_rank1 loss {loss:.4f}; both_top10 off {w[('both_top10', DIV_OFF)].astype(float).mean():.4f}, "
                              f"on {w[('both_top10', DIV_ON)].astype(float).mean():.4f}; pep1_top10 off "
                              f"{w[('pep1_top10', DIV_OFF)].astype(float).mean():.4f}, on {w[('pep1_top10', DIV_ON)].astype(float).mean():.4f}; "
                              f"pep2_top10 off {w[('pep2_top10', DIV_OFF)].astype(float).mean():.4f}, on "
                              f"{w[('pep2_top10', DIV_ON)].astype(float).mean():.4f}"))
    else:
        rows.append(_row("H4 diversity", "both_top10 cap10_div - cap10", "chimeric", nchim, math.nan,
                         verdict="not evaluable", note=why_chim or "profiles cap10/cap10_div missing"))

    # per run (descriptive)
    for run, g in tr.groupby("run_id"):
        c, s1 = g[g["category"] == "chimeric"], g[(g["category"] == "single") & (g["purity"] >= PURE_MIN)]
        rows.append(_row("per run", "union_rank1 chimeric", run, len(c), float(c["union_rank1"].mean()) if len(c) else math.nan))
        rows.append(_row("per run", "pep1_rank1 single_pure", run, len(s1), float(s1["pep1_rank1"].mean()) if len(s1) else math.nan))
    rows += sensitivity(df, n_boot)
    return pd.DataFrame(rows)


def read_truthqc(path) -> pd.DataFrame | None:
    if path is None:
        return None
    from fastag_bench.tsv import read_tsv
    qc, _ = read_tsv(path)
    miss = [c for c in ("run_id", "status", "target_pass", "rank1_target", "rank1_decoy", "td_ratio") if c not in qc.columns]
    if miss:
        raise ValueError(f"{path}: truth check table misses {miss}")
    qc["reason"] = qc["reason"].fillna("") if "reason" in qc.columns else ""
    return qc


def report(spectra: str | Path, out: str | Path, n_boot: int = N_BOOT, log=print, truthqc=None) -> Path:
    df = read_spectra(spectra)
    ep = endpoints(df, n_boot, read_truthqc(truthqc))
    import hashlib
    me = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    p = write_tsv(ep, out, [f"source: {spectra}", f"scorer: scripts/stats_realchimera.py sha256 {me}",
                            f"truth check: {truthqc or 'none'}",
                            f"n_boot {n_boot}, seed {SEED}, PURE_MIN {PURE_MIN}, IMPURE_MAX {IMPURE_MAX}, "
                            f"NONINF_MARGIN {NONINF_MARGIN}, MIN_SPECTRA {MIN_SPECTRA}"])
    for r in ep[ep["endpoint"].str.match(r"^(H\d|E1 chimeric)") & (ep["verdict"] != "")].itertuples():
        log(f"{r.endpoint} {r.metric} [{r.group}]: {r.value:.4f} ({r.ci_lo:.4f}, {r.ci_hi:.4f}) {r.verdict}")
    return p


def report_sensitivity(spectra: str | Path, out: str | Path, n_boot: int = N_BOOT, log=print) -> Path:
    """The 'S run-stratified' rows alone (post hoc on a scored table; no endpoint is recomputed)."""
    df = read_spectra(spectra)
    s = pd.DataFrame(sensitivity(df, n_boot))
    import hashlib
    me = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    p = write_tsv(s, out, [f"source: {spectra}", f"scorer: scripts/stats_realchimera.py sha256 {me} (--sensitivity)",
                           f"n_boot {n_boot}, seed {SEED}, PURE_MIN {PURE_MIN}, IMPURE_MAX {IMPURE_MAX}; not preregistered"])
    for r in s.itertuples():
        log(f"{r.endpoint} [{r.group}]: {r.value:.4f} ({r.ci_lo:.4f}, {r.ci_hi:.4f}) n {r.n}")
    return p


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--sensitivity":
        report_sensitivity(sys.argv[2], sys.argv[3])
    elif len(sys.argv) in (3, 4) and not sys.argv[1].startswith("--"):
        report(sys.argv[1], sys.argv[2], truthqc=sys.argv[3] if len(sys.argv) == 4 else None)
    else:
        sys.exit(__doc__)
