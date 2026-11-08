"""#4: Sage configuration modes. 'closed' must stay the v1.9.0 config byte for byte (golden JSON cut
from the unmodified harness at the bench import); 'pool' searches the pool FASTA (targets plus the
shuffled decoy pool) without digestion."""
import json
from pathlib import Path

import pytest

from fastag_bench.config import DEFAULTS, load_datasets
from fastag_bench.sage import SAGE_MODES, sage_config

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = json.loads((ROOT / "tests" / "data" / "sage_closed_golden.json").read_text())


def _datasets():
    return load_datasets(ROOT / "datasets.yaml")


def test_modes_listed():
    assert SAGE_MODES == ("closed", "pool", "charge_truth")


@pytest.mark.parametrize("ds", [d for d in _datasets() if d.id in GOLDEN], ids=lambda d: d.id)
def test_closed_mode_is_golden(ds):
    cfg = sage_config(ds, "/db/human.fasta", ["/in/run.mzML"], DEFAULTS["sage"], mode="closed")
    assert json.dumps(cfg, sort_keys=True) == json.dumps(GOLDEN[ds.id], sort_keys=True)
    # the default mode is closed
    assert sage_config(ds, "/db/human.fasta", ["/in/run.mzML"], DEFAULTS["sage"]) == cfg


def test_every_dataset_has_a_golden_entry():
    # a dataset added later gets its golden entry in the same commit
    ids = {d.id for d in _datasets()} - {d.id for d in _datasets() if "proteometools" in d.experiments}
    assert ids <= set(GOLDEN)


def test_pool_mode_swaps_fasta_and_disables_digestion():
    ds = next(d for d in _datasets() if d.id == "PXD003531_QE_NO_03")
    closed = sage_config(ds, "/db/human.fasta", ["/in/run.mzML"], DEFAULTS["sage"])
    pool = sage_config(ds, "/db/human.fasta", ["/in/run.mzML"], DEFAULTS["sage"], mode="pool",
                       pool_fasta="/pool/pool_1.fasta")
    assert pool["database"]["fasta"] == "/pool/pool_1.fasta"
    enz = pool["database"]["enzyme"]
    assert enz["cleave_at"] == "$" and enz["missed_cleavages"] == 0 and "restrict" not in enz
    # everything outside the database block is the closed search, so the two arms differ only in the database
    for k in closed:
        if k != "database":
            assert pool[k] == closed[k], k
    for k in ("static_mods", "variable_mods", "max_variable_mods", "decoy_tag", "generate_decoys", "ion_kinds"):
        assert pool["database"][k] == closed["database"][k], k


def test_pool_mode_needs_pool_fasta_and_unknown_mode_fails():
    ds = _datasets()[0]
    with pytest.raises(ValueError):
        sage_config(ds, "/db/h.fasta", [], DEFAULTS["sage"], mode="pool")
    with pytest.raises(ValueError):
        sage_config(ds, "/db/h.fasta", [], DEFAULTS["sage"], mode="open")


def test_charge_truth_mode_widens_charge_and_isotope_only():
    # #6 truth: charges 1..4 and isotope errors -1..3; everything else is the closed search
    ds = next(d for d in _datasets() if d.id == "PXD003531_QE_NO_03")
    closed = sage_config(ds, "/db/human.fasta", ["/in/run.mzML"], DEFAULTS["sage"])
    truth = sage_config(ds, "/db/human.fasta", ["/in/run.mzML"], DEFAULTS["sage"], mode="charge_truth")
    assert truth["precursor_charge"] == [1, 4] and truth["isotope_errors"] == [-1, 3]
    assert closed["isotope_errors"] == [0, 1] and "precursor_charge" not in closed
    for k in set(closed) | set(truth):
        if k not in ("precursor_charge", "isotope_errors"):
            assert truth[k] == closed[k], k
