"""#4: per-spectrum scoring against candidate sets, the summary by axis cell, and the CLI wiring."""
import pandas as pd
import pytest

from fastag_bench import score as S
from fastag_bench import unidentified as U


def _tag(peptide, pos, L, key, rank, evalue=0.001):
    res, pref, total = S.peptide_masses(peptide)
    return {"key": key, "rank": rank, "tag": res[pos:pos + L], "nterm_mass": pref[pos],
            "cterm_mass": total - pref[pos + L], "evalue": evalue, "length": L}


def _wrong(key, rank, evalue=0.5):
    return {"key": key, "rank": rank, "tag": "WWW", "nterm_mass": 1.0, "cterm_mass": 1.0, "evalue": evalue, "length": 3}


TAGS = pd.DataFrame([
    _tag("SAMPLER", 1, 3, "scan=1", 1), _wrong("scan=1", 2),
    _wrong("scan=2", 1), _tag("PEPTIDEK", 2, 3, "scan=2", 2, 0.02),
    _wrong("scan=3", 1),
    _tag("LATEMK", 0, 3, "scan=5", 1),   # candidate set of size 2, correct for one member
])
TRUTH = pd.DataFrame({
    "key": ["scan=1", "scan=2", "scan=3", "scan=4", "scan=5", "scan=6"],
    "candidates": [["SAMPLER"], ["PEPTIDEK"], ["AAAK"], ["CCCK"], ["KLATEM", "LATEMK"], []],
    "identification": ["S3-PT", "S3-PT", "S3-PT", "S3-PT", "S3-PT", "S3-PT"],
    "chimericity": ["none"] * 6,
})


def test_score_spectra():
    out = U.score_spectra(TAGS, TRUTH, ks=(1, 5)).set_index("key")
    assert list(out.loc["scan=1", ["tagged", "top1", "top5"]]) == [1, 1, 1]
    assert list(out.loc["scan=2", ["tagged", "top1", "top5"]]) == [1, 0, 1]
    assert list(out.loc["scan=3", ["tagged", "top1", "top5"]]) == [1, 0, 0]
    assert list(out.loc["scan=4", ["tagged", "top1", "top5"]]) == [0, 0, 0]
    assert out.loc["scan=5", "size_label"] == "pool_consistent" and out.loc["scan=5", "top1"] == 1
    assert out.loc["scan=6", "size_label"] == "no_pool_candidate"
    assert out.loc["scan=1", "size_label"] == "size1"
    assert out.loc["scan=1", "n_tags"] == 2 and out.loc["scan=1", "n_correct"] == 1
    # per-tag counts at E <= 0.01
    assert out.loc["scan=2", "n_tags_e001"] == 0 and out.loc["scan=1", "n_tags_e001"] == 1
    assert out.loc["scan=1", "n_correct_e001"] == 1


def test_summarize_separates_size_classes_and_skips_no_candidate():
    sc = U.score_spectra(TAGS, TRUTH, ks=(1, 5))
    summ = U.summarize(sc, by=["identification", "chimericity", "size_label"], ks=(1, 5))
    s = summ.set_index("size_label")
    assert set(s.index) == {"size1", "pool_consistent", "no_pool_candidate"}
    assert s.loc["size1", "spectra"] == 4 and s.loc["size1", "tagged"] == 3
    assert s.loc["size1", "rank1_accuracy"] == pytest.approx(1 / 3)   # over tagged spectra
    assert s.loc["size1", "top5_any"] == pytest.approx(2 / 3)
    assert s.loc["size1", "tag_precision"] == pytest.approx(2 / 5)
    assert s.loc["no_pool_candidate", "scored"] == 0  # reported, not scored


def test_chance_uses_swapped_candidates():
    swapped = TRUTH.assign(candidates=[["PEPTIDEK"], ["SAMPLER"], ["AAAK"], ["CCCK"], ["SAMPLER"], []])
    ch = U.score_spectra(TAGS, swapped, ks=(1,)).set_index("key")
    assert ch.loc["scan=1", "top1"] == 0 and ch.loc["scan=2", "top1"] == 0


def test_cli_subcommands_registered():
    from fastag_bench.cli import build_parser
    ap = build_parser()
    for sub in ("sage-modes", "pool-truth", "chimera-build", "run", "score", "collect", "splits", "v190-check"):
        a = ap.parse_args(["unidentified", sub, "--config", "x.yaml"])
        assert a.cmd == "unidentified" and a.step == sub
    a = ap.parse_args(["unidentified", "run", "--config", "x.yaml", "--split", "dev", "--ratios", "1,10",
                       "--modes", "closed,pool", "--seed", "3"])
    assert (a.split, a.ratios, a.modes, a.seed) == ("dev", "1,10", "closed,pool", 3)
    with pytest.raises(SystemExit):
        ap.parse_args(["unidentified", "run", "--config", "x.yaml", "--split", "nosuch"])
