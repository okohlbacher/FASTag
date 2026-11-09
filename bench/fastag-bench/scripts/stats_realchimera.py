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

Usage
    python scripts/stats_realchimera.py <spectra_<split>.tsv.gz> <endpoints_<split>.tsv>
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


def endpoints(df: pd.DataFrame, n_boot: int = N_BOOT) -> pd.DataFrame:
    rows = []
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

    # H1 / H2
    ok_pure = len(pure) >= MIN_SPECTRA
    for ep, metric in (("H1 chimeric penalty", "pep1_rank1"), ("H2 union non-inferiority", "union_rank1")):
        if not (ok_chim and ok_pure):
            rows.append(_row(ep, f"{metric} chimeric - pep1_rank1 pure single", "chimeric vs single_pure", nchim + len(pure),
                             math.nan, verdict="not evaluable", note=why_chim or f"pure single n={len(pure)}"))
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
    if len(pure) >= MIN_SPECTRA and len(impure) >= MIN_SPECTRA:
        diff, lo, hi = two_group_boot(pure["cluster1"], pure["pep1_rank1"], impure["cluster1"], impure["pep1_rank1"], n_boot)
        rows.append(_row("H3 purity gradient", "pep1_rank1 pure - impure (single)", "single", len(pure) + len(impure),
                         diff, lo, hi, verdict="gradient shown" if lo > 0 else "not shown",
                         note=f"pure {pure['pep1_rank1'].mean():.4f} (n {len(pure)}), impure {impure['pep1_rank1'].mean():.4f} (n {len(impure)})"))
    else:
        rows.append(_row("H3 purity gradient", "pep1_rank1 pure - impure (single)", "single", len(pure) + len(impure),
                         math.nan, verdict="not evaluable", note=f"pure n={len(pure)}, impure n={len(impure)}"))
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
        w = w.loc[keys]
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
    return pd.DataFrame(rows)


def report(spectra: str | Path, out: str | Path, n_boot: int = N_BOOT, log=print) -> Path:
    df = read_spectra(spectra)
    ep = endpoints(df, n_boot)
    import hashlib
    me = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    p = write_tsv(ep, out, [f"source: {spectra}", f"scorer: scripts/stats_realchimera.py sha256 {me}",
                            f"n_boot {n_boot}, seed {SEED}, PURE_MIN {PURE_MIN}, IMPURE_MAX {IMPURE_MAX}, "
                            f"NONINF_MARGIN {NONINF_MARGIN}, MIN_SPECTRA {MIN_SPECTRA}"])
    for r in ep[ep["endpoint"].str.match(r"^(H\d|E1 chimeric)") & (ep["verdict"] != "")].itertuples():
        log(f"{r.endpoint} {r.metric} [{r.group}]: {r.value:.4f} ({r.ci_lo:.4f}, {r.ci_hi:.4f}) {r.verdict}")
    return p


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    report(sys.argv[1], sys.argv[2])
