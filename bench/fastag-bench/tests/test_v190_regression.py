"""#4 precondition: the harness's closed path still reproduces the v1.9.0 accuracy tables.

1. Always: a stored slice of the v1.9.0 runs (PXD003531, Sage truth, tag length 3, 246 PSM spectra cut by
   scripts/make_v190_fixture.py from the run directories on node data) is re-scored with today's readers
   and scorer; every pair row must equal the stored row of accuracy_pairs_v190.tsv.gz exactly.
2. With the paper results present (results/accuracy_pairs_v190.tsv.gz and stats_accuracy_paired_v190.tsv,
   not in the repository): the paired table recomputed from the stored pairs gives the stored rank-1 and
   top-10 counts of every row (Table 4) exactly. The full re-export from the run directories is the
   node-data check (unidentified.py v190-check).
"""
import importlib.util
import os
from pathlib import Path

import pandas as pd
import pytest

from fastag_bench import parsers as P

ROOT = Path(__file__).resolve().parents[1]
V190 = ROOT / "tests" / "data" / "v190"
_spec = importlib.util.spec_from_file_location("stats_paired", ROOT / "scripts" / "stats_paired.py")
SP = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SP)
RESULTS = Path(os.environ.get("FASTAG_BENCH_RESULTS", ROOT / "results"))


def test_slice_rescoring_reproduces_v190_pairs():
    exp = pd.read_csv(V190 / "expected_pairs.tsv", sep="\t", comment="#", keep_default_na=False, na_values=[""])
    psms = P.read_sage_psms(V190 / "results.sage.tsv", 0.01)  # default arguments, as in v1.9.0
    ft = P.read_fastag_tags(V190 / "fastag_tags.tsv")
    dt = P.read_directag_tags(V190 / "directag.tags")
    got = SP.pair_rows("PXD003531_QE_NO_03", "PXD003531", "sage", 3, psms, ft, dt)
    got = got.sort_values("key").reset_index(drop=True)
    exp = exp.sort_values("key").reset_index(drop=True)
    assert list(got.columns) == list(exp.columns)
    pd.testing.assert_frame_equal(got.astype(str), exp.astype(str))
    # the slice is not trivial: it holds both kinds of discordant spectra and untagged ones
    assert ((exp.ft_top1 == 1) & (exp.dt_top1 == 0)).any() and ((exp.ft_top1 == 0) & (exp.dt_top1 == 1)).any()
    assert (exp.ft_tagged == 0).any() or (exp.dt_tagged == 0).any()


@pytest.mark.skipif(not (RESULTS / "accuracy_pairs_v190.tsv.gz").exists(),
                    reason="paper results not present (set FASTAG_BENCH_RESULTS)")
def test_paired_table_reproduces_stored_counts():
    pairs, _ = SP.read_any_tsv(RESULTS / "accuracy_pairs_v190.tsv.gz")
    stored, _ = SP.read_any_tsv(RESULTS / "stats_accuracy_paired_v190.tsv")
    tab = SP.paired_table(pairs, n_boot=10)  # counts do not depend on the bootstrap
    key = ["dataset", "truth", "tag_length", "metric", "scope"]
    cols = ["spectra", "peptides", "fastag_correct", "directag_correct", "only_fastag", "only_directag"]
    m = stored[key + cols].merge(tab[key + cols], on=key, suffixes=("_stored", "_new"), how="outer", indicator=True)
    assert (m["_merge"] == "both").all()
    for c in cols:
        assert (m[f"{c}_stored"] == m[f"{c}_new"]).all(), c
    assert len(m) == len(stored)
