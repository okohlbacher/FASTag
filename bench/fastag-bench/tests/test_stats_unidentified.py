"""#4 statistics: cluster sign-flip permutation test, cluster vs spectrum bootstrap, endpoint rules."""
import importlib.util
import math
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("stats_unidentified", ROOT / "scripts" / "stats_unidentified.py")
SU = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SU)


def test_permutation_exact_small_design():
    # 3 clusters, every cluster favours a: of the 2^3 sign patterns only all-plus and all-minus reach |T_obs|
    cluster = np.array([0, 0, 1, 1, 2, 2])
    d = np.array([1, 0, 1, 1, 1, 0])
    assert SU.cluster_permutation(cluster, d) == pytest.approx(2 / 8)


def test_permutation_null_and_zero():
    cluster = np.repeat(np.arange(6), 3)
    assert SU.cluster_permutation(cluster, np.zeros(18)) == 1.0
    # exchangeable null: symmetric cluster sums -> large p
    d = np.array([1, 0, 0, -1, 0, 0, 1, 1, 0, -1, -1, 0, 1, 0, 0, -1, 0, 0])
    assert SU.cluster_permutation(cluster, d) > 0.5


def test_permutation_counts_clusters_not_spectra():
    # one cluster with many concordant spectra must not look significant: with 2 clusters the two-sided
    # p-value cannot go below 2/4, whatever the number of spectra
    cluster = np.array([0] * 50 + [1])
    d = np.array([1] * 50 + [1])
    assert SU.cluster_permutation(cluster, d) == pytest.approx(0.5)
    # Monte Carlo path (many clusters) agrees with the exact path in distribution
    rng = np.random.default_rng(0)
    cl = np.repeat(np.arange(30), 4)
    dd = rng.choice([-1, 0, 1], size=120, p=[0.2, 0.4, 0.4])
    p_mc = SU.cluster_permutation(cl, dd, n_perm=20000, exact_max=0)
    p_ex = SU.cluster_permutation(cl[:64], dd[:64], exact_max=16)  # 16 clusters exact
    assert 0 < p_mc <= 1 and 0 < p_ex <= 1


def test_permutation_type1_rate_under_exchangeability():
    rng = np.random.default_rng(1)
    rej = 0
    for _ in range(200):
        cl = np.repeat(np.arange(12), 5)
        flip = rng.choice([-1, 1], size=12)
        d = np.repeat(flip, 5) * rng.integers(0, 2, size=60)
        rej += SU.cluster_permutation(cl, d) < 0.05
    assert rej / 200 <= 0.08


def test_cluster_bootstrap_wider_than_spectrum_bootstrap_under_duplication():
    rng = np.random.default_rng(2)
    base = rng.integers(0, 2, size=60).astype(float)
    a = np.repeat(base, 10)            # each peptide seen in 10 spectra
    cluster = np.repeat(np.arange(60), 10)
    lo_c, hi_c = SU.cluster_bootstrap_ci(cluster, a, n_boot=1000)
    lo_s, hi_s = SU.spectrum_bootstrap_ci(a, n_boot=1000)
    assert (hi_c - lo_c) > 2 * (hi_s - lo_s)
    assert lo_c <= a.mean() <= hi_c


def test_cluster_bootstrap_ci_reuses_paired_helper():
    cluster = np.repeat(np.arange(20), 2)
    a = np.tile([1.0, 0.0], 20)
    lo, hi = SU.cluster_bootstrap_ci(cluster, a, n_boot=200)
    lo2, hi2 = SU.SP.cluster_bootstrap_diff(cluster, a, np.zeros_like(a), 200, SU.SP.SEED)
    assert (lo, hi) == (lo2, hi2)


def test_endpoint_informative_rule():
    # LB of (accuracy - chance) above the margin -> holds
    assert SU.informative_verdict(lo=0.07, margin=0.05) == "holds"
    assert SU.informative_verdict(lo=0.04, margin=0.05) == "not shown"
    assert SU.informative_verdict(lo=math.nan, margin=0.05) == "not evaluable"


def test_endpoint_transfer_rule():
    assert SU.transfer_verdict(diff=0.03, lo=-0.05, hi=0.09, bound=0.10) == "transfer shown"
    assert SU.transfer_verdict(diff=0.12, lo=0.05, hi=0.2, bound=0.10) == "not shown"
    assert SU.transfer_verdict(diff=0.08, lo=-0.01, hi=0.15, bound=0.10) == "inconclusive"


def test_diversity_rule():
    assert SU.diversity_verdict(gain_both=0.04, p_both_holm=0.01, loss_pep1=0.002) == "benefit"
    assert SU.diversity_verdict(gain_both=0.02, p_both_holm=0.01, loss_pep1=0.0) == "no benefit claimed"
    assert SU.diversity_verdict(gain_both=0.05, p_both_holm=0.2, loss_pep1=0.0) == "no benefit claimed"
    assert SU.diversity_verdict(gain_both=0.05, p_both_holm=0.01, loss_pep1=0.01) == "no benefit claimed"
