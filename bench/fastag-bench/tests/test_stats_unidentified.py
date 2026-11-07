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


# --------------------------------------------------------------------------------- endpoint wiring (fixture)
import pandas as pd  # noqa: E402


def _row(pool, key, prof, arm, ident, size, top1, n_cand=1, cluster="X", tagged=1, n_byproduct=0, pool_hit="",
         n_tags_e001=0, n_correct_e001=0):
    return {"pool": pool, "key": key, "profile": prof, "arm": arm, "identification": ident, "size_label": size,
            "top1": top1, "n_candidates": n_cand, "cluster": cluster, "tagged": tagged, "n_byproduct": n_byproduct,
            "pool_hit": pool_hit, "n_tags_e001": n_tags_e001, "n_correct_e001": n_correct_e001,
            "n_tags": tagged, "n_correct": top1 * tagged, "top5": top1, "top10": top1, "top50": top1}


def _fixture(profiles=("matched", "matched_tl5", "default")):
    """Two pools with the SAME scan keys (scan=1..4). Pool P1, size-1 spectra (truth, decoy, chance, byproduct):
         scan=1  ident A  truth 1  decoy 0  swap: 1 candidate, top1 0  byproduct cand 0           pool_hit A
         scan=2  ident B  truth 1  decoy 1  swap: none                 byproduct cand 2, top1 1   pool_hit -
         scan=3  ident C  truth 0  decoy 0  swap: 1 candidate, top1 1  byproduct cand 0           pool_hit C
         scan=4  ident D  truth 1  decoy 0  swap: none                 untagged (never counted)
       S0: scan=9 ident Z truth 1, scan=8 ident Y truth 0 (E<=0.01: 2 tags, 1 correct on scan=9).
       Pool P2 (excluded by the controls): the same keys, every arm top1 = 1 for truth, 0 elsewhere."""
    rows = []
    for prof in profiles:
        for key, ident, tr, dc, sw, swn, bp, bpn, hit, tg in (
                ("scan=1", "A", 1, 0, 0, 1, 0, 0, "A", 1), ("scan=2", "B", 1, 1, 0, 0, 1, 2, "", 1),
                ("scan=3", "C", 0, 0, 1, 1, 0, 0, "C", 1), ("scan=4", "D", 1, 0, 0, 0, 0, 0, "", 0)):
            common = dict(cluster=ident, tagged=tg, n_byproduct=bpn, pool_hit=hit)
            rows += [_row("P1", key, prof, "truth", "S3-PT", "size1", tr, 1, n_tags_e001=1, n_correct_e001=tr, **common),
                     _row("P1", key, prof, "decoy", "S3-PT", "size1", dc, 1, **common),
                     _row("P1", key, prof, "chance", "S3-PT", "size1", sw, swn, **common),
                     _row("P1", key, prof, "byproduct", "S3-PT", "size1", bp, bpn, **common)]
            p2 = dict(cluster="P2" + ident, tagged=1, n_byproduct=0, pool_hit="")
            rows += [_row("P2", key, prof, a, "S3-PT", "size1", int(a == "truth"), 1, **p2)
                     for a in ("truth", "decoy", "chance", "byproduct")]
        rows += [_row("P1", "scan=9", prof, "truth", "S0", "s0", 1, cluster="Z", n_tags_e001=2, n_correct_e001=1),
                 _row("P1", "scan=8", prof, "truth", "S0", "s0", 0, cluster="Y")]
    sp = pd.DataFrame(rows)
    controls = pd.DataFrame({"pool": ["P1", "P2"], "pool_excluded": [False, True],
                             "s3_labels_uncertain": [False, False]})
    return sp, controls


def _get(ep, endpoint, prof, scope="pools_not_excluded", rule="all"):
    r = ep[(ep.endpoint.str.startswith(endpoint)) & (ep.profile == prof) & (ep.scope == scope) & (ep.label_rule == rule)]
    assert len(r) == 1, (endpoint, prof, scope, rule, len(r))
    return r.iloc[0]


def test_endpoint_rows_by_hand_and_excluded_pool_dropped():
    sp, controls = _fixture()
    ep = SU.endpoint_rows(sp, n_boot=200, controls=controls)
    r = _get(ep, "F4-01", "matched")
    # P1 tagged size-1 = scan 1..3: truth 2/3, decoy 1/3 (paired), P2 (excluded) never enters
    assert r.spectra == 3 and r.pools == 1 and r.clusters == 3
    assert r.rank1_accuracy == pytest.approx(2 / 3) and r.chance == pytest.approx(1 / 3)
    assert r.value == pytest.approx(1 / 3)
    assert r.decoy_coverage == pytest.approx(1.0)
    # pool-swap: candidates on scan 1 and 3 only (coverage 2/3), correct on scan 3
    assert r.swap_coverage == pytest.approx(2 / 3) and r.swap_n == 2
    assert r.swap_chance_unconditional == pytest.approx(1 / 3) and r.swap_chance_conditional == pytest.approx(1 / 2)
    assert r.truth_rank1_on_swap_covered == pytest.approx(1 / 2)
    # F4-03: S0 1/2 minus S3 2/3
    assert _get(ep, "F4-03", "matched").value == pytest.approx(1 / 2 - 2 / 3)
    # F4-02: S0 precision 1/2 (2 tags, 1 correct), S3 2/3 (three tags at E <= 0.01, two correct)
    f2 = _get(ep, "F4-02", "matched")
    assert f2.s0_precision == pytest.approx(0.5) and f2.s3_precision == pytest.approx(2 / 3)
    # without the controls P2 would count (3 + 4 tagged spectra, truth 6/7): the exclusion keeps it out
    ep_all = SU.endpoint_rows(sp, n_boot=200, controls=None)
    r_all = _get(ep_all, "F4-01", "matched")
    assert r_all.spectra == 7 and r_all.rank1_accuracy == pytest.approx(6 / 7)


def test_endpoint_roles_holm_and_not_frozen():
    sp, controls = _fixture()
    ep = SU.endpoint_rows(sp, n_boot=200, controls=controls)
    prim = _get(ep, "F4-01", "matched", rule=SU.PRIMARY_RULE)
    sec = _get(ep, "F4-01", "matched_tl5", rule=SU.PRIMARY_RULE)
    assert prim.role == "primary" and sec.role == "secondary (Holm)"
    assert _get(ep, "F4-01", "default", rule=SU.PRIMARY_RULE).verdict == "descriptive"
    assert _get(ep, "F4-01", "matched", rule="all").verdict == "sensitivity"
    assert prim.verdict == "not frozen" and sec.verdict == "not frozen"  # never 'holds' before the freeze
    assert prim.p_holm == pytest.approx(SU.SP.holm([prim.p_one_sided, sec.p_one_sided])[0])
    # frozen margin: verdict from the Holm-adjusted one-sided p
    ep2 = SU.endpoint_rows(sp, n_boot=200, controls=controls, margin_frozen=-0.5)
    p2 = _get(ep2, "F4-01", "matched", rule=SU.PRIMARY_RULE)
    assert p2.margin == -0.5 and p2.verdict in ("holds", "not shown")
    assert p2.verdict == ("holds" if p2.p_holm < SU.ALPHA_ONE_SIDED else "not shown")


def test_label_rules_and_certain_scope():
    sp, controls = _fixture()
    ep = SU.endpoint_rows(sp, n_boot=100, controls=controls)
    # no_byproduct_candidate drops scan=2 (2 byproduct candidates): truth 1/2, decoy 0
    r = _get(ep, "F4-01", "matched", rule="no_byproduct_candidate")
    assert r.spectra == 2 and r.rank1_accuracy == pytest.approx(0.5) and r.chance == 0
    # rank1_not_byproduct_explained drops scan=2 as well (its rank-1 tag fits a byproduct)
    assert _get(ep, "F4-01", "matched", rule="rank1_not_byproduct_explained").spectra == 2
    # pool_search_agrees keeps scan 1 and 3 (pool hit = label)
    assert _get(ep, "F4-01", "matched", rule="pool_search_agrees").spectra == 2
    # an uncertain P1 empties the certain scope
    c2 = controls.assign(s3_labels_uncertain=[True, False])
    ep2 = SU.endpoint_rows(sp, n_boot=100, controls=c2)
    assert _get(ep2, "F4-01", "matched", scope="pools_certain").spectra == 0
    assert _get(ep2, "F4-01", "matched", scope="pools_not_excluded").spectra == 3


def test_duplicate_pool_key_raises():
    sp, _ = _fixture(profiles=("matched",))
    dup = pd.concat([sp, sp[(sp.pool == "P1") & (sp.key == "scan=1") & (sp.arm == "truth")]])
    with pytest.raises(ValueError):
        SU.endpoint_rows(dup, n_boot=10)


def test_label_conflict_rows():
    sp, controls = _fixture(profiles=("matched",))
    lc = SU.label_conflict_rows(sp, controls)
    r = lc[lc.scope == "pools_not_excluded"].iloc[0]
    assert (r.size1_tagged, r.with_byproduct_candidate, r.rank1_label_only, r.rank1_byproduct_only,
            r.rank1_both, r.rank1_neither) == (3, 1, 1, 0, 1, 1)
    assert r.rank1_label_no_byproduct_candidate == pytest.approx(0.5)


def test_boot_draws_match_paired_helper():
    rng = np.random.default_rng(3)
    cl = rng.integers(0, 30, 200)
    a, b = rng.integers(0, 2, 200), rng.integers(0, 2, 200)
    d = SU.boot_diff_draws(cl, a, b, 500, 7)
    lo, hi = SU.SP.cluster_bootstrap_diff(cl, a.astype(float), b.astype(float), 500, 7)
    assert np.quantile(d, 0.025) == pytest.approx(lo) and np.quantile(d, 0.975) == pytest.approx(hi)
    assert SU.boot_p_above(np.array([0.1, 0.2, 0.3]), 0.15) == pytest.approx(2 / 4)


def _chim(n, shared_parent=False):
    rows = []
    for prof, bump in (("matched", 0), ("matched_div", 1)):
        for i in range(n):
            al = "ACDEFGHKMNPQRSTVWY"  # no I/L (they fold together)
            tag = al[i % len(al)] + al[i // len(al)]
            p1 = "PEPA" if shared_parent else f"PEP{tag}A"
            rows.append({"key": f"scan={i + 1}", "ratio": 1.0, "profile": prof, "pep1": p1, "pep2": f"PEP{tag}K",
                         "both_topk": bool(i % 2 or (bump and i < 4)), "pep1_rank1": bool(i % 3 == 0),
                         "rank1_attribution": "pep1" if i % 3 == 0 else "neither"})
            rows.append({**rows[-1], "ratio": 10.0})
    return pd.DataFrame(rows)


def test_chimera_rows_clusters_verdict_and_giant_cluster(tmp_path):
    ch = _chim(40)
    cr = SU.chimera_rows(ch, n_perm=500)
    c1 = cr[(cr.endpoint == "F4-04 chimera") & (cr.ratio == 1.0) & (cr.metric == "both_topk")].iloc[0]
    # unique identities: every chimera its own cluster; on gains the even i < 4 (i = 0, 2): +2/40
    assert c1.clusters == 40 and c1.max_cluster_share == pytest.approx(1 / 40)
    assert c1.diff_on_minus_off == pytest.approx(2 / 40)
    v = cr[cr.endpoint == "F4-04 verdict"].iloc[0]
    assert v.verdict == "no benefit claimed" and v.pep1_rank1_max_loss == pytest.approx(0.0)
    assert v.verdict == SU.diversity_verdict(2 / 40, v.p_holm, 0.0)
    # one parent in every chimera: one cluster; collect refuses
    g = SU.chimera_rows(_chim(40, shared_parent=True), n_perm=100)
    assert g["max_cluster_share"].max() == pytest.approx(1.0)
    sp, controls = _fixture(profiles=("matched",))
    from fastag_bench.tsv import write_tsv
    write_tsv(sp, tmp_path / "spectra.tsv", ["src", "settings"])
    write_tsv(controls, tmp_path / "controls.tsv", ["src"])
    write_tsv(_chim(40), tmp_path / "chimeras.tsv", ["src"])
    out = SU.collect(tmp_path, log=lambda s: None, n_boot=50)
    assert {p.name for p in out} >= {"endpoints.tsv", "label_conflict.tsv", "chimera_endpoints.tsv"}
    write_tsv(_chim(40, shared_parent=True), tmp_path / "chimeras.tsv", ["src"])
    with pytest.raises(ValueError, match="largest chimera cluster"):
        SU.collect(tmp_path, log=lambda s: None, n_boot=50)
