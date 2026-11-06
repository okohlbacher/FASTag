"""#4: two independent axes (identification, chimericity) instead of one stratum precedence."""
from pathlib import Path

import pandas as pd
import pytest

from fastag_bench import parsers as P
from fastag_bench.strata import CHIMERICITY_NONE, IDENTIFICATION, assign_axes

V190 = Path(__file__).resolve().parent / "data" / "v190"


def test_axes_are_independent_columns():
    spectra = pd.DataFrame({"key": ["scan=1", "scan=2", "scan=3", "scan=4"]})
    chim = pd.DataFrame({"key": ["chimera=1", "chimera=2"], "parent1": ["scan=1", "scan=2"],
                         "parent2": ["scan=2", "scan=1"], "ratio": [1.0, 10.0]})
    ax = assign_axes(spectra, s0_keys={"scan=1", "scan=2"}, pt_keys={"scan=1", "scan=2", "scan=3"}, chimeras=chim)
    assert IDENTIFICATION == ("S0", "S3-PT", "S5")
    a = ax.set_index("key")
    assert list(ax.columns[:3]) == ["key", "identification", "chimericity"]
    assert a.loc["scan=1", "identification"] == "S0" and a.loc["scan=1", "chimericity"] == CHIMERICITY_NONE
    assert a.loc["scan=3", "identification"] == "S3-PT"
    assert a.loc["scan=4", "identification"] == "S5"
    # chimeras carry their own chimericity and the identification of the dominant parent
    assert a.loc["chimera=1", "chimericity"] == "synthetic-mix:1"
    assert a.loc["chimera=2", "chimericity"] == "synthetic-mix:10"
    assert a.loc["chimera=1", "identification"] == "S0"
    assert a.loc["chimera=1", "parent1"] == "scan=1" and a.loc["chimera=1", "parent2"] == "scan=2"
    # every combination of the two axes can occur: the S0 parent stays S0 although it is a chimera parent
    assert {(r.identification, r.chimericity) for r in ax.itertuples()} >= {
        ("S0", "none"), ("S0", "synthetic-mix:1"), ("S3-PT", "none"), ("S5", "none")}


def test_no_pt_keys_means_no_s3():
    spectra = pd.DataFrame({"key": ["scan=1", "scan=2"]})
    ax = assign_axes(spectra, s0_keys={"scan=1"})
    assert list(ax["identification"]) == ["S0", "S5"]
    assert set(ax["chimericity"]) == {CHIMERICITY_NONE}


def test_rejects_unknown_parents_and_duplicate_keys():
    spectra = pd.DataFrame({"key": ["scan=1", "scan=1"]})
    with pytest.raises(ValueError):
        assign_axes(spectra, s0_keys=set())
    spectra = pd.DataFrame({"key": ["scan=1"]})
    chim = pd.DataFrame({"key": ["chimera=1"], "parent1": ["scan=9"], "parent2": ["scan=1"], "ratio": [1.0]})
    with pytest.raises(ValueError):
        assign_axes(spectra, s0_keys={"scan=1"}, chimeras=chim)


def test_s0_equals_todays_scored_set():
    """S0 on the stored v1.9.0 fixture is exactly the spectrum set the v1.9.0 scorer used."""
    psms = P.read_sage_psms(V190 / "results.sage.tsv", 0.01)
    sage = pd.read_csv(V190 / "results.sage.tsv", sep="\t", dtype=str)
    spectra = pd.DataFrame({"key": sorted(set(sage["scannr"].map(P.spectrum_key)))})
    ax = assign_axes(spectra, s0_keys=set(psms["key"]))
    exp = pd.read_csv(V190 / "expected_pairs.tsv", sep="\t", comment="#")
    assert set(ax.loc[ax["identification"] == "S0", "key"]) == set(exp["key"]) == set(psms["key"])
