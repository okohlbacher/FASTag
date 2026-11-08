import importlib.util
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("stats_paired", ROOT / "scripts" / "stats_paired.py")
SP = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SP)


def test_wilson_known_values():
    lo, hi = SP.wilson(5, 10)
    assert lo == pytest.approx(0.2366, abs=1e-4) and hi == pytest.approx(0.7634, abs=1e-4)
    lo, hi = SP.wilson(0, 5)
    assert lo == 0.0 and hi == pytest.approx(0.4345, abs=1e-4)
    assert all(math.isnan(x) for x in SP.wilson(0, 0))


def test_mcnemar_exact_matches_binomial():
    assert SP.mcnemar_exact(0, 0) == 1.0
    assert SP.mcnemar_exact(5, 5) == 1.0
    # b=0, c=6: 2 * 0.5^6
    assert SP.mcnemar_exact(0, 6) == pytest.approx(2 / 64)
    # b=2, c=8: 2 * (1 + 10 + 45) / 1024
    assert SP.mcnemar_exact(2, 8) == pytest.approx(2 * 56 / 1024)
    assert SP.mcnemar_exact(8, 2) == SP.mcnemar_exact(2, 8)
    # large n stays finite and tiny
    assert 0 < SP.mcnemar_exact(1000, 1712) < 1e-15


def test_holm():
    assert SP.holm([0.01, 0.04, 0.03]) == pytest.approx([0.03, 0.06, 0.06])
    assert SP.holm([0.5, 0.9]) == pytest.approx([1.0, 1.0])


def test_cluster_bootstrap_whole_clusters():
    # every cluster has a=1, b=0 -> the difference is exactly 1 in every draw
    cl = np.array(["p1", "p1", "p2", "p3"])
    lo, hi = SP.cluster_bootstrap_diff(cl, np.ones(4), np.zeros(4), n_boot=50)
    assert lo == hi == 1.0
    lo, hi = SP.cluster_bootstrap_diff(np.array(["p"] * 3), np.ones(3), np.zeros(3), n_boot=10)
    assert math.isnan(lo) and math.isnan(hi)


def _pairs():
    rows = []
    for i in range(40):
        ft = 1 if i < 30 else 0
        dt = 1 if i < 20 or i >= 38 else 0
        rows.append({"dataset": "D", "pxd": "PXD000001", "truth": "sage", "tag_length": 3, "key": f"scan={i}",
                     "peptide": f"PEP{i % 13}", "ft_tagged": 1, "ft_top1": ft, "ft_top10": 1,
                     "dt_tagged": 1 if i != 39 else 0, "dt_top1": dt if i != 39 else 0, "dt_top10": 1 if i != 39 else 0})
    return pd.DataFrame(rows)


def test_paired_table_counts_and_scopes():
    t = SP.paired_table(_pairs(), n_boot=200)
    both = t[(t.scope == "both_tagged") & (t.metric == "top1")].iloc[0]
    allp = t[(t.scope == "all_psm") & (t.metric == "top1")].iloc[0]
    assert both.spectra == 39 and allp.spectra == 40
    # only FASTag correct: i = 20..29 (10); only DirecTag: i = 38 (1, i = 39 is untagged by DirecTag)
    assert (both.only_fastag, both.only_directag) == (10, 1)
    assert both.p_mcnemar == pytest.approx(SP.mcnemar_exact(10, 1))
    assert both.diff_ci_lo <= both["diff"] <= both.diff_ci_hi
    assert both.holm_family_size == 1 and both.leader == "FASTag"


def _truth():
    rows = []
    # 8 trypsin (6 correct, 2 no-call), 2 Arg-C (both called Trypsin): accuracy 6/10, majority 8/10
    for i in range(8):
        rows.append({"acc": f"PXD{i:06d}", "subset": "validation", "enzyme_evaluable": True,
                     "enzyme_truth": "Trypsin", "shipped_call": "Trypsin" if i < 6 else None})
    for i in range(2):
        rows.append({"acc": "PXD999999", "subset": "new non-tryptic", "enzyme_evaluable": True,
                     "enzyme_truth": "Arg-C", "shipped_call": "Trypsin"})
    rows.append({"acc": "PXD888888", "subset": "validation", "enzyme_evaluable": False,
                 "enzyme_truth": "LysargiNase", "shipped_call": "Trypsin"})
    return pd.DataFrame(rows)


def test_runlevel_baselines():
    r = pd.DataFrame(SP.runlevel_rows(_truth(), "protease_shipped", "all", "enzyme_truth", "shipped_call",
                                      "enzyme_evaluable"))
    a = r[r["class"] == "all"].iloc[0]
    assert (a.runs, a.called, a.correct) == (10, 8, 6)
    assert a.accuracy_all == 0.6 and a.accuracy_called == 0.75 and a.coverage == 0.8
    assert a.majority_class == "Trypsin" and a.majority_accuracy_all == 0.8
    assert a.majority_accuracy_called == 0.75  # 6 Trypsin among 8 called
    assert a.balanced_accuracy == pytest.approx((6 / 8 + 0) / 2) and a.majority_balanced_accuracy == 0.5
    argc = r[r["class"] == "Arg-C"].iloc[0]
    assert argc.correct == 0 and argc.pxds == 1 and argc.wrong_calls == "Trypsin 2"


def test_alkylation_unknown_is_nocall_but_correct_for_unknown_truth():
    df = pd.DataFrame([{"acc": "PXD1", "alk_evaluable": True, "alk_truth_class": "unknown", "alk_call": "unknown"},
                       {"acc": "PXD2", "alk_evaluable": True, "alk_truth_class": "Carbamidomethyl", "alk_call": "unknown"},
                       {"acc": "PXD3", "alk_evaluable": True, "alk_truth_class": "Carbamidomethyl",
                        "alk_call": "Carbamidomethyl"}])
    a = SP.runlevel_rows(df, "alkylation", "all", "alk_truth_class", "alk_call", "alk_evaluable")[0]
    assert a["correct"] == 2 and a["called"] == 1 and a["accuracy_called"] == 1.0


def test_shipped_tables_if_present():
    res = ROOT / "results"
    p = res / "stats_runlevel_v190.tsv"
    if not p.exists():
        pytest.skip("stats_runlevel_v190.tsv not generated")
    df, prov = SP.read_any_tsv(p)
    assert prov and prov[0].startswith("source: scripts/stats_paired.py")
    a = df[(df.task == "protease_shipped") & (df.subset == "all") & (df["class"] == "all")].iloc[0]
    assert a.runs == 194
    q = res / "stats_accuracy_paired_v190.tsv"
    if q.exists():
        t, _ = SP.read_any_tsv(q)
        assert set(t.scope) == {"both_tagged", "all_psm"}
        assert (t.p_holm >= t.p_mcnemar - 1e-12).all()
