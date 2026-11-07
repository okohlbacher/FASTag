#!/usr/bin/env python3
"""Statistics for FASTag 1.12 item #4 (tag accuracy on unidentified and chimeric spectra).

Pre-registered in output/features-1.12/validation-registry.tsv rows F4-01..F4-07 (PLAN-qc.md item #4):
- intervals: 95% percentile cluster bootstrap (scripts/stats_paired.cluster_bootstrap_diff, reused), clusters =
  I/L-normalized peptide for S0 and S3-PT size-1, pool for pool_consistent, union of both parents for chimeras;
- F4-01: rank-1 accuracy minus the decoy chance (the label's same-mass shuffled decoy), paired per spectrum;
  primary matched TL3, secondary matched TL5 (Holm over the two, one-sided bootstrap p), default descriptive;
  excluded pools dropped from every endpoint, uncertain pools as a sensitivity scope; label rules for the
  byproduct conflict (registry rows F4-10/F4-11); verdict 'not frozen' until the margin is frozen;
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
# F4-01 analysis designation (registry rows F4-10/F4-11; provisional until the user signs them off, and
# frozen with the margin before the test split): one primary profile, one primary label rule and scope.
PRIMARY_PROFILE = "matched"            # matched settings, tag length 3
SECONDARY_PROFILES = ("matched_tl5",)  # tag length 5, Holm over {primary, secondary}
PRIMARY_SCOPE = "pools_not_excluded"
PRIMARY_RULE = "no_byproduct_candidate"
SCOPES = ("pools_not_excluded", "pools_certain")
LABEL_RULES = ("all", "no_byproduct_candidate", "rank1_not_byproduct_explained", "pool_search_agrees")
ALPHA_ONE_SIDED = 0.025                # = the lower bound of the 95% two-sided interval
MAX_CLUSTER_SHARE = 0.10               # F4-04: largest chimera cluster must hold less than this share


def boot_diff_draws(cluster, a, b, n_boot: int = N_BOOT, seed: int = SEED) -> np.ndarray:
    """The draws behind stats_paired.cluster_bootstrap_diff (same generator, same order): mean(a) -
    mean(b) with whole clusters resampled. Its 2.5/97.5% quantiles are that function's interval."""
    codes, inv = np.unique(np.asarray(cluster), return_inverse=True)
    g = len(codes)
    if g < 2:
        return np.array([])
    n_g = np.bincount(inv, minlength=g).astype(float)
    a_g = np.bincount(inv, weights=np.asarray(a, float), minlength=g)
    b_g = np.bincount(inv, weights=np.asarray(b, float), minlength=g)
    rng = np.random.default_rng(seed)
    out = np.empty(n_boot)
    for i in range(n_boot):
        w = np.bincount(rng.integers(0, g, size=g), minlength=g).astype(float)
        out[i] = (w @ a_g - w @ b_g) / (w @ n_g)
    return out


def boot_p_above(draws: np.ndarray, margin: float) -> float:
    """One-sided bootstrap p-value of H0: difference <= margin, (1 + #{draw <= margin}) / (n + 1)."""
    if len(draws) == 0:
        return math.nan
    return float((1 + np.sum(draws <= margin)) / (len(draws) + 1))


def size1_table(g: pd.DataFrame) -> pd.DataFrame:
    """One row per S3-PT size-1 spectrum of one profile, the arms side by side, keyed by (pool, key)
    (scan keys repeat across pools). Columns: pool, key, cluster, tagged, n_byproduct, pool_hit and
    <arm>_top1 / <arm>_n (candidate count) for truth, decoy, chance, byproduct."""
    t = g[(g.identification == "S3-PT") & (g.size_label == "size1")]
    idx = ["pool", "key"]
    tr = t[t.arm == "truth"]
    if tr.duplicated(idx).any():
        raise ValueError("size1_table: duplicate (pool, key) in the truth arm")
    keep = [c for c in ("cluster", "tagged", "n_byproduct", "pool_hit") if c in tr.columns]
    w = tr.set_index(idx)[keep].copy()
    for arm in ("truth", "decoy", "chance", "byproduct"):
        x = t[t.arm == arm]
        if x.duplicated(idx).any():
            raise ValueError(f"size1_table: duplicate (pool, key) in the {arm} arm")
        x = x.set_index(idx)
        w[f"{arm}_top1"] = x["top1"].reindex(w.index).fillna(0).astype(int) if len(x) else 0
        w[f"{arm}_n"] = x["n_candidates"].reindex(w.index).fillna(0).astype(int) if len(x) else 0
    return w.reset_index()


def rule_mask(w: pd.DataFrame, rule: str) -> pd.Series:
    """Label rules for size-1 spectra: all; no_byproduct_candidate (no byproduct of any pool peptide fits
    the precursor); rank1_not_byproduct_explained (the rank-1 tag is not correct for a byproduct
    candidate); pool_search_agrees (the pool search's rank-1 hit at 1% FDR is the label)."""
    if rule == "all":
        return pd.Series(True, index=w.index)
    if rule == "no_byproduct_candidate":
        return w["n_byproduct"] == 0
    if rule == "rank1_not_byproduct_explained":
        return w["byproduct_top1"] == 0
    if rule == "pool_search_agrees":
        return w["pool_hit"].astype(str) == w["cluster"].astype(str)
    raise ValueError(f"unknown label rule {rule!r}")


def scope_pools(controls: pd.DataFrame | None, scope: str) -> set | None:
    """Pools in scope (None = every pool, when no controls are given). Excluded pools (agreement below
    95%) are out of every scope; pools_certain also drops the pools whose S3 labels are flagged uncertain."""
    if controls is None:
        return None
    c = controls.copy()
    for col in ("pool_excluded", "s3_labels_uncertain"):
        c[col] = c[col].astype(str).str.lower().isin(("true", "1"))
    keep = ~c["pool_excluded"]
    if scope == "pools_certain":
        keep &= ~c["s3_labels_uncertain"]
    elif scope != "pools_not_excluded":
        raise ValueError(f"unknown scope {scope!r}")
    return set(c.loc[keep, "pool"])


def _role(prof: str, scope: str, rule: str) -> str:
    if prof not in (PRIMARY_PROFILE, *SECONDARY_PROFILES):
        return "descriptive"
    if scope != PRIMARY_SCOPE or rule != PRIMARY_RULE:
        return "sensitivity"
    return "primary" if prof == PRIMARY_PROFILE else "secondary (Holm)"


def endpoint_rows(sp: pd.DataFrame, n_boot: int = N_BOOT, margin: float = MARGIN_DEFAULT,
                  controls: pd.DataFrame | None = None, margin_frozen: float | None = None) -> pd.DataFrame:
    """F4-01..F4-03 per scope x label rule x profile from the per-spectrum table (unidentified.score_pool).

    F4-01 = S3-PT size-1 rank-1 accuracy minus the decoy chance (the same-mass shuffled decoy of the label,
    same rule), paired per spectrum, over tagged size-1 spectra. The pool-swap chance is reported beside it
    with its coverage (share of spectra with any swap candidate) and conditional on coverage. Holm over the
    primary and secondary profile (one-sided bootstrap p of diff <= margin) within each scope x rule; a
    verdict only for those two profiles and only once margin_frozen is set ('not frozen' otherwise)."""
    m = margin if margin_frozen is None else float(margin_frozen)
    rows = []
    for scope in SCOPES:
        keep = scope_pools(controls, scope)
        gs = sp if keep is None else sp[sp["pool"].isin(keep)]
        for rule in LABEL_RULES:
            fam = []
            for prof in sorted(sp["profile"].unique()):
                g = gs[gs["profile"] == prof]
                w = size1_table(g)
                w = w[(w["tagged"] == 1) & rule_mask(w, rule)]
                a, b = w["truth_top1"].to_numpy(float), w["decoy_top1"].to_numpy(float)
                cl = w["cluster"].to_numpy()
                draws = boot_diff_draws(cl, a, b, n_boot, SEED) if len(a) > 1 else np.array([])
                lo, hi = (tuple(float(x) for x in np.quantile(draws, [0.025, 0.975])) if len(draws)
                          else (math.nan, math.nan))
                cov = w["chance_n"] > 0
                base = {"scope": scope, "label_rule": rule, "profile": prof, "role": _role(prof, scope, rule),
                        "pools": int(w["pool"].nunique())}
                rows.append({**base, "endpoint": "F4-01 S3PT size1 rank1 minus decoy chance", "spectra": len(a),
                             "clusters": len(set(cl)), "value": _mean(a) - _mean(b), "ci_lo": lo, "ci_hi": hi,
                             "rank1_accuracy": _mean(a), "chance": _mean(b),
                             "decoy_coverage": _mean((w["decoy_n"] > 0).to_numpy(float)),
                             "swap_chance_unconditional": _mean(w["chance_top1"].to_numpy(float)),
                             "swap_coverage": _mean(cov.to_numpy(float)), "swap_n": int(cov.sum()),
                             "swap_chance_conditional": _mean(w.loc[cov, "chance_top1"].to_numpy(float)),
                             "truth_rank1_on_swap_covered": _mean(w.loc[cov, "truth_top1"].to_numpy(float)),
                             "margin": m, "margin_frozen": margin_frozen is not None,
                             "p_one_sided": boot_p_above(draws, m)})
                if rows[-1]["role"] in ("primary", "secondary (Holm)"):
                    fam.append(len(rows) - 1)
                # F4-03 selection bias: S0 - S3 size-1, unpaired; each set resampled by its own clusters
                s0 = g[(g.identification == "S0") & (g.size_label == "s0") & (g.arm == "truth") & (g.tagged == 1)]
                a0 = s0["top1"].to_numpy(float)
                lo0, hi0 = _ci(s0["cluster"].to_numpy(), a0, n_boot)
                lo3, hi3 = _ci(cl, a, n_boot)
                dlo, dhi = _diff_ci(s0["cluster"].to_numpy(), a0, cl, a, n_boot)
                rows.append({**base, "endpoint": "F4-03 selection bias S0 - S3PT size1 rank1",
                             "spectra": len(a0) + len(a), "value": _mean(a0) - _mean(a), "ci_lo": dlo, "ci_hi": dhi,
                             "s0_rank1": _mean(a0), "s0_ci": f"{lo0:.4f}..{hi0:.4f}", "s3_ci": f"{lo3:.4f}..{hi3:.4f}",
                             "verdict": "reported"})
                # F4-02 precision transfer at E <= 0.01 (per-tag precision; spectra as clusters of tags)
                t3 = g[(g.identification == "S3-PT") & (g.size_label == "size1") & (g.arm == "truth")]
                t3 = t3.merge(w[["pool", "key"]], on=["pool", "key"])  # same label rule
                s3e = t3[t3.n_tags_e001 > 0]
                s0e = g[(g.identification == "S0") & (g.size_label == "s0") & (g.arm == "truth") & (g.n_tags_e001 > 0)]
                p0, p3 = _ratio(s0e), _ratio(s3e)
                lo2, hi2 = _ratio_diff_ci(s0e, s3e, n_boot)
                rows.append({**base, "endpoint": "F4-02 precision transfer E<=0.01 S0 - S3PT size1",
                             "spectra": len(s0e) + len(s3e), "value": p0 - p3, "ci_lo": lo2, "ci_hi": hi2,
                             "s0_precision": p0, "s3_precision": p3,
                             "verdict": transfer_verdict(p0 - p3, lo2, hi2) if not math.isnan(p0 - p3) else "not evaluable"})
            ps = [rows[i]["p_one_sided"] for i in fam]
            adj = SP.holm(ps) if fam and not any(math.isnan(x) for x in ps) else [math.nan] * len(fam)
            for i, pa in zip(fam, adj):
                rows[i]["p_holm"] = pa
                rows[i]["debug_holds_at_margin"] = bool(pa < ALPHA_ONE_SIDED) if not math.isnan(pa) else False
                rows[i]["verdict"] = ("not evaluable" if math.isnan(pa) else "not frozen" if margin_frozen is None
                                      else "holds" if pa < ALPHA_ONE_SIDED else "not shown")
            for r in rows:
                if r["endpoint"].startswith("F4-01") and "verdict" not in r:
                    r["verdict"] = r["role"]
    return pd.DataFrame(rows)


def label_conflict_rows(sp: pd.DataFrame, controls: pd.DataFrame | None = None) -> pd.DataFrame:
    """Size-1 label vs byproduct explanation of the rank-1 tag, per scope and profile (tagged size-1)."""
    rows = []
    for scope in SCOPES:
        keep = scope_pools(controls, scope)
        gs = sp if keep is None else sp[sp["pool"].isin(keep)]
        for prof in sorted(sp["profile"].unique()):
            w = size1_table(gs[gs["profile"] == prof])
            w = w[w["tagged"] == 1]
            t, bp = w["truth_top1"] == 1, w["byproduct_top1"] == 1
            nb = w["n_byproduct"] == 0
            rows.append({"scope": scope, "profile": prof, "size1_tagged": len(w),
                         "with_byproduct_candidate": int((~nb).sum()), "share_with_byproduct": _mean((~nb).to_numpy(float)),
                         "rank1_label_only": int((t & ~bp).sum()), "rank1_byproduct_only": int((~t & bp).sum()),
                         "rank1_both": int((t & bp).sum()), "rank1_neither": int((~t & ~bp).sum()),
                         "rank1_label": _mean(t.to_numpy(float)), "rank1_byproduct": _mean(bp.to_numpy(float)),
                         "rank1_label_no_byproduct_candidate": _mean(t[nb].to_numpy(float)),
                         "pool_search_agrees": int(rule_mask(w, "pool_search_agrees").sum())})
    return pd.DataFrame(rows)


def _ci(cluster, a, n_boot=N_BOOT):
    if len(a) == 0:
        return (math.nan, math.nan)
    return cluster_bootstrap_ci(cluster, a, n_boot)


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
    cluster permutation test and Holm over {both 1:1, both 1:10, pep1 1:1, pep1 1:10}; then the
    verdict row (diversity_verdict: gain in both-top-50 at 1:1 with its Holm p, and the largest pep1
    rank-1 loss over the ratios). Every row carries the largest cluster's share of the chimeras."""
    rows, fam = [], []
    for ratio, g in ch.groupby("ratio", sort=True):
        off = g[g.profile == "matched"]
        on = g[g.profile == "matched_div"]
        for x, name in ((off, "matched"), (on, "matched_div")):
            if x["key"].duplicated().any():
                raise ValueError(f"chimera_rows: duplicate chimera keys at ratio {ratio:g} ({name})")
        off = off.set_index("key")
        on = on.set_index("key").reindex(off.index)
        cl = union_clusters(off["pep1"].map(_n), off["pep2"].map(_n))
        share = float(pd.Series(cl).value_counts().iloc[0] / len(cl)) if len(cl) else math.nan
        for metric in ("both_topk", "pep1_rank1"):
            a = off[metric].astype(float).to_numpy()
            b = on[metric].astype(float).to_numpy() if on[metric].notna().all() else np.full(len(a), np.nan)
            row = {"endpoint": "F4-04 chimera", "ratio": ratio, "metric": metric, "chimeras": len(a),
                   "clusters": len(set(cl)), "max_cluster_share": share, "off": _mean(a), "on": _mean(b),
                   "diff_on_minus_off": _mean(b) - _mean(a)}
            if len(a) and not np.isnan(b).any():
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
        t = df.loc[fam]
        both1 = t[(t.metric == "both_topk") & (t.ratio == 1)]
        pep = t[t.metric == "pep1_rank1"]
        if len(both1) and len(pep):
            gain, p = float(both1["diff_on_minus_off"].iloc[0]), float(both1["p_holm"].iloc[0])
            loss = float((-pep["diff_on_minus_off"]).max())
            df = pd.concat([df, pd.DataFrame([{
                "endpoint": "F4-04 verdict", "metric": "diversity", "diff_on_minus_off": gain, "p_holm": p,
                "pep1_rank1_max_loss": loss, "max_cluster_share": float(df["max_cluster_share"].max()),
                "verdict": diversity_verdict(gain, p, loss)}])], ignore_index=True)
    return df


def _n(p):
    from fastag_bench.score import normalize_peptide
    return normalize_peptide(p)


def collect(split_dir: str | Path, log=print, n_boot: int = N_BOOT, margin_frozen: float | None = None) -> list[Path]:
    """Summaries and endpoint tables of one split directory (spectra.tsv, controls.tsv, chimeras.tsv).
    Excluded pools (controls.tsv) leave every endpoint; ValueError when the largest chimera cluster
    holds MAX_CLUSTER_SHARE or more of the chimeras (the permutation test could not reject)."""
    from fastag_bench.unidentified import summarize

    d = Path(split_dir)
    sp, prov = read_tsv(d / "spectra.tsv")
    controls = read_tsv(d / "controls.tsv")[0] if (d / "controls.tsv").exists() else None
    written = []
    summ = summarize(sp, ["profile", "identification", "arm", "size_label"])
    written.append(write_tsv(summ, d / "summary.tsv", prov[:2] + ["per cell; rank-1 and top-k over tagged scored spectra"]))
    sizes = sp[(sp.arm == "truth") & (sp.profile == sp.profile.iloc[0])].groupby(["pool", "identification", "size_label"]).size()
    written.append(write_tsv(sizes.rename("spectra").reset_index(), d / "candidate_sizes.tsv", prov[:2]))
    ep = endpoint_rows(sp, n_boot, controls=controls, margin_frozen=margin_frozen)
    keep = scope_pools(controls, "pools_not_excluded")
    excl = [] if keep is None else sorted(set(sp["pool"]) - keep)
    written.append(write_tsv(ep, d / "endpoints.tsv", prov[:1] + [
        f"cluster bootstrap {n_boot} draws seed {SEED}; margin "
        + (f"{margin_frozen} (frozen)" if margin_frozen is not None else
           f"{MARGIN_DEFAULT} (default, NOT frozen: verdict 'not frozen' until the registry freezes margin and chance)")
        + f"; F4-01 null = same-mass shuffled decoy of the label; primary {PRIMARY_PROFILE} / {PRIMARY_SCOPE} / "
          f"{PRIMARY_RULE}, secondary {','.join(SECONDARY_PROFILES)} (Holm, one-sided {ALPHA_ONE_SIDED}); "
          f"excluded pools {excl or 'none'}; transfer bound +-0.10"]))
    written.append(write_tsv(label_conflict_rows(sp, controls), d / "label_conflict.tsv", prov[:1] + [
        "tagged S3-PT size-1 spectra: rank-1 tag correct for the label vs for a byproduct candidate"]))
    if (d / "chimeras.tsv").exists():
        ch, cprov = read_tsv(d / "chimeras.tsv")
        cr = chimera_rows(ch)
        written.append(write_tsv(cr, d / "chimera_endpoints.tsv", cprov[:1] + [
            "-diversity on minus off; cluster sign-flip permutation (union-of-parents clusters), Holm over the 4 tests; "
            f"largest cluster must hold < {MAX_CLUSTER_SHARE:.0%} of the chimeras"]))
        worst = cr["max_cluster_share"].max()
        if not worst < MAX_CLUSTER_SHARE:
            raise ValueError(f"F4-04: the largest chimera cluster holds {worst:.1%} of the chimeras "
                             f"(>= {MAX_CLUSTER_SHARE:.0%}); rebuild the chimeras with chimera_max_per_identity 1")
    for p in written:
        log(f"wrote {p}")
    return written


if __name__ == "__main__":
    collect(sys.argv[1])
