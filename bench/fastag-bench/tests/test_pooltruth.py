"""#4: S3-PT pool truth: mass-constrained candidates, decoy pool, byproducts, pool swap, splits."""
import pandas as pd
import pytest

from fastag_bench import pooltruth as T
from fastag_bench.score import normalize_peptide

STATIC = {"C": 57.021464}
VAR = {"M": [15.994915]}


def _mz(peptide, z, iso=0):
    return (T.peptide_mass(peptide) + iso * T.C13 + z * T.PROTON) / z


def test_peptide_mass_known_value():
    # PEPTIDE monoisotopic neutral mass 799.359964
    assert T.peptide_mass("PEPTIDE") == pytest.approx(799.359964, abs=1e-5)
    assert T.peptide_mass("PEPC[+57.021464]K") == pytest.approx(
        T.peptide_mass("PEPCK") + 57.021464, abs=1e-9)


def test_expand_variants_static_and_variable():
    v = T.expand_variants("AMCMK", STATIC, VAR, max_var=1)
    assert v[0] == "AMC[+57.021464]MK"  # unmodified (static only) first
    assert set(v) == {"AMC[+57.021464]MK", "AM[+15.994915]C[+57.021464]MK", "AMC[+57.021464]M[+15.994915]K"}
    assert len(T.expand_variants("AMCMK", STATIC, VAR, max_var=2)) == 4


def _pool():
    targets = ["PEPTIDEK", "SAMPLER", "LATEMK", "ELVISLIVESK", "KLATEM"]  # LATEMK/KLATEM: same composition
    return T.PoolIndex.from_peptides(targets, STATIC, VAR, max_var=1, cls="target")


def test_candidates_size_one_charge_given():
    pool = _pool()
    c = T.candidates_by_mass({"precursor_mz": _mz("SAMPLER", 2), "charge": 2}, pool, tol_ppm=10)
    assert list(c["target"]) == ["SAMPLER"]
    assert T.size_label(len(c["target"])) == "size1"


def test_candidates_size_gt1_isobaric():
    pool = _pool()
    c = T.candidates_by_mass({"precursor_mz": _mz("LATEMK", 2), "charge": 2}, pool, tol_ppm=10)
    assert sorted(c["target"]) == ["KLATEM", "LATEMK"]
    assert T.size_label(len(c["target"])) == "pool_consistent"


def test_candidates_size_zero_and_tolerance():
    pool = _pool()
    mz = _mz("SAMPLER", 2)
    # 0.3 m/z off (0.6 Da) fits neither isotope error 0 nor 1 (+0.5 m/z would be the 13C peak)
    assert T.candidates_by_mass({"precursor_mz": mz + 0.3, "charge": 2}, pool, tol_ppm=10)["target"] == {}
    assert T.size_label(0) == "no_pool_candidate"
    # 5 ppm off is inside 10 ppm, 15 ppm off is outside
    m = T.peptide_mass("SAMPLER")
    assert T.candidates_by_mass({"precursor_mz": (m * (1 + 5e-6) + 2 * T.PROTON) / 2, "charge": 2}, pool, 10)["target"]
    assert not T.candidates_by_mass({"precursor_mz": (m * (1 + 15e-6) + 2 * T.PROTON) / 2, "charge": 2}, pool, 10)["target"]


def test_candidates_isotope_error_and_unknown_charge():
    pool = _pool()
    # precursor picked on the first 13C peak: found only with isotope error 1
    mz = _mz("PEPTIDEK", 2, iso=1)
    # identities are I/L-normalized
    assert list(T.candidates_by_mass({"precursor_mz": mz, "charge": 2}, pool, 10, iso=(0, 1))["target"]) == ["PEPTLDEK"]
    assert T.candidates_by_mass({"precursor_mz": mz, "charge": 2}, pool, 10, iso=(0,))["target"] == {}
    # no charge given: charges 2-4 are tried
    mz3 = _mz("ELVISLIVESK", 3)
    assert list(T.candidates_by_mass({"precursor_mz": mz3, "charge": None}, pool, 10)["target"]) == ["ELVLSLLVESK"]
    assert T.candidates_by_mass({"precursor_mz": mz3, "charge": 0}, pool, 10, charges=(2,))["target"] == {}


def test_candidates_variable_mod_and_identity_grouping():
    pool = _pool()
    c = T.candidates_by_mass({"precursor_mz": _mz("LATEM[+15.994915]K", 2), "charge": 2}, pool, 10)
    # identities are I/L-normalized, modification-free peptides; the variant strings are kept for the flank rule
    assert sorted(c["target"]) == ["KLATEM", "LATEMK"]
    assert c["target"]["LATEMK"] == ["LATEM[+15.994915]K"]


def test_decoy_pool_same_size_disjoint_and_deterministic():
    targets = ["PEPTIDEK", "SAMPLER", "LATEMK", "ELVISLIVESK", "KLATEM", "AAGGSSTTK", "VVLLIIK"]
    d1 = T.decoy_pool(targets, seed=3)
    assert len(d1) == len(targets)
    tn = {normalize_peptide(p) for p in targets}
    assert not {normalize_peptide(p) for p in d1} & tn
    assert len({normalize_peptide(p) for p in d1}) == len(d1)
    for t, d in zip(targets, d1):
        assert sorted(t) == sorted(d) and t[-1] == d[-1]  # composition (mass) and C-terminal residue kept
    assert d1 == T.decoy_pool(targets, seed=3)
    assert d1 != T.decoy_pool(targets, seed=4)


def test_decoy_pool_impossible_raises():
    with pytest.raises(ValueError):
        T.decoy_pool(["AAAAK"], seed=1)  # every shuffle is the target itself


def test_byproducts():
    b = T.byproducts("PEPTIDEK", min_len=5)
    assert b["EPTIDEK"] == "nterm-1" and b["PTIDEK"] == "nterm-2"
    assert b["PEPTIDE"] == "cterm-1" and b["PEPTID"] == "cterm-2"
    assert b["EPTIDEK"] == "nterm-1"
    assert b["PPTIDEK"] == "del2"   # deleting E at position 2 (1-based)
    assert "PEPTIDEK" not in b
    # deletions that give the same sequence keep the first kind; short variants are dropped
    assert all(len(s) >= 5 for s in b)
    assert "PEK" not in T.byproducts("PEPTK", min_len=5)
    pool = T.PoolIndex.from_peptides(["SAMPLER"], STATIC, VAR, max_var=0, cls="target", byproducts=True)
    c = T.candidates_by_mass({"precursor_mz": _mz("SAMPLE", 2), "charge": 2}, pool, 10)
    assert c["target"] == {} and list(c["byproduct"]) == ["SAMPLE"]


POOLS = pd.DataFrame({
    "pool": ["A_1", "A_2", "A_3", "B_1", "B_2", "C_1"],
    "batch": ["q1", "q1", "q1", "q2", "q2", "q3"],
    "size": [1000, 990, 1010, 1000, 1005, 998],
})


def test_pool_swap_is_cross_batch_derangement():
    for seed in range(10):
        sw = T.pool_swap(POOLS, seed)
        b = dict(zip(POOLS["pool"], POOLS["batch"]))
        assert set(sw) == set(POOLS["pool"])
        assert all(sw[p] != p and b[sw[p]] != b[p] for p in sw)
    assert T.pool_swap(POOLS, 1) == T.pool_swap(POOLS, 1)
    with pytest.raises(ValueError):
        T.pool_swap(POOLS[POOLS["batch"] == "q1"], 0)  # one batch only: no cross-batch partner


def test_swap_peptides_excludes_shared_identities_and_matches_size():
    src = ["PEPTIDEK", "SAMPLER", "LATEMK"]
    swap = ["PEPTLDEK", "AAAK", "CCCK", "DDDK", "EEEK", "SAMPLER"]
    got = T.swap_peptides(src, swap, seed=0)
    assert len(got) == len(src)
    assert not {normalize_peptide(p) for p in got} & {normalize_peptide(p) for p in src}
    assert got == T.swap_peptides(src, swap, seed=0)


def test_carryover_neighbours():
    pools = pd.DataFrame({"pool": ["S_1", "S_2", "S_3", "S_5", "T_2"], "set": ["S", "S", "S", "S", "T"],
                          "num": [1, 2, 3, 5, 2], "batch": ["q", "q", "q", "q", "q"]})
    nb = T.carryover_pools(pools)
    assert nb["S_2"] == ["S_1", "S_3"] and nb["S_1"] == ["S_2"] and nb["S_5"] == [] and nb["T_2"] == []


SPLIT_POOLS = pd.DataFrame({
    "pool": [f"P_{i}" for i in range(1, 25)],
    "set": ["P"] * 24,
    "batch": [f"q{i % 12}" for i in range(1, 25)],
})
PLAN = [
    {"split": "dev", "seed": 1, "n": 3},
    {"split": "test", "seed": 2, "n": 5},
    {"split": "f7train", "seed": 3, "n": 3, "exclude_batches_of": ["dev", "test"]},
]


def test_split_pools_disjoint_and_deterministic():
    a = T.split_pools(SPLIT_POOLS, PLAN)
    assert a.groupby("split").size().to_dict() == {"dev": 3, "test": 5, "f7train": 3}
    assert a["pool"].is_unique
    T.assert_disjoint(a)
    assert a.equals(T.split_pools(SPLIT_POOLS, PLAN))
    b = dict(zip(SPLIT_POOLS["pool"], SPLIT_POOLS["batch"]))
    used = {b[p] for p in a.loc[a["split"].isin(["dev", "test"]), "pool"]}
    assert not {b[p] for p in a.loc[a["split"] == "f7train", "pool"]} & used


def test_split_pools_groups_shared_peptides_and_repeats():
    pools = pd.DataFrame({"pool": ["P_1", "P_1", "P_2", "P_3", "P_4", "P_5", "P_6"],
                          "repeat": ["01_01", "02_01", "01_01", "01_01", "01_01", "01_01", "01_01"],
                          "set": ["P"] * 7, "batch": ["q1"] * 7})
    peps = {"P_1": {"AAAK"}, "P_2": {"CCCK", "PEPTIDEK"}, "P_3": {"PEPTLDEK"}, "P_4": {"DDDK"},
            "P_5": {"EEEK"}, "P_6": {"FFFK"}}
    for seed in range(20):
        a = T.split_pools(pools, [{"split": "x", "seed": seed, "n": 2}, {"split": "y", "seed": seed + 100, "n": 2}],
                          peptides=peps)
        T.assert_disjoint(a, peptides=peps)
        s = dict(zip(a["pool"], a["split"]))
        # P_2 and P_3 share PEPTIDEK (I=L) and always land in the same split
        if "P_2" in s or "P_3" in s:
            assert s.get("P_2") == s.get("P_3")
        assert a["pool"].is_unique  # repeats of P_1 travel together as one pool


def test_assert_disjoint_catches_planted_overlap():
    a = pd.DataFrame({"pool": ["P_1", "P_2"], "split": ["dev", "test"]})
    T.assert_disjoint(a, peptides={"P_1": {"AAAK"}, "P_2": {"CCCK"}})
    with pytest.raises(ValueError, match="peptide"):
        T.assert_disjoint(a, peptides={"P_1": {"AAAK", "PEPTIDEK"}, "P_2": {"CCCK", "PEPTLDEK"}})
    with pytest.raises(ValueError, match="pool"):
        T.assert_disjoint(pd.DataFrame({"pool": ["P_1", "P_1"], "split": ["dev", "test"]}))
    with pytest.raises(ValueError, match="batch"):
        T.assert_disjoint(pd.DataFrame({"pool": ["P_1", "P_2"], "split": ["dev", "f7train"]}),
                          batches={"P_1": "q1", "P_2": "q1"}, batch_exclusive=[("dev", "f7train")])


def test_shared_identities_across_splits():
    a = pd.DataFrame({"pool": ["P_1", "P_2", "P_3"], "split": ["dev", "test", "test"]})
    peps = {"P_1": {"AAAK", "PEPTIDEK"}, "P_2": {"PEPTLDEK", "CCCK"}, "P_3": {"CCCK", "DDDK"}}
    # PEPTIDEK (I=L) is in dev and test; CCCK is only within test
    assert T.shared_identities(a, peps) == {"PEPTLDEK": ["dev", "test"]}
