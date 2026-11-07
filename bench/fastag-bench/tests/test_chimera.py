"""#4: synthetic S4 chimeras: TIC-normalised mixing, summed collapse, compatibility, attribution."""
import numpy as np
import pandas as pd
import pytest

from fastag_bench import chimera as C
from fastag_bench import score as S


def test_tic_ratio_without_overlap():
    a_mz, a_int = np.array([100.0, 200.0, 300.0]), np.array([10.0, 30.0, 60.0])
    b_mz, b_int = np.array([150.0, 250.0]), np.array([1000.0, 3000.0])  # unequal TIC (100 vs 4000)
    for ratio in (1.0, 10.0):
        mz, it, info = C.mix_peaks(a_mz, a_int, b_mz, b_int, ratio)
        from_a = it[np.isin(mz, a_mz)].sum()
        from_b = it[np.isin(mz, b_mz)].sum()
        assert from_a == pytest.approx(1.0) and from_b == pytest.approx(1.0 / ratio)
        assert from_a / from_b == pytest.approx(ratio)
        assert np.all(np.diff(mz) > 0)
        assert info["merged"] == 0
    # relative intensities inside each parent are kept
    mz, it, _ = C.mix_peaks(a_mz, a_int, b_mz, b_int, 1.0)
    sa = dict(zip(mz, it))
    assert sa[300.0] / sa[100.0] == pytest.approx(6.0) and sa[250.0] / sa[150.0] == pytest.approx(3.0)


def test_summed_collapse_weighted_centroid():
    a_mz, a_int = np.array([500.000, 600.0]), np.array([3.0, 1.0])
    b_mz, b_int = np.array([500.0015, 700.0]), np.array([1.0, 1.0])
    mz, it, info = C.mix_peaks(a_mz, a_int, b_mz, b_int, 1.0, tol=0.002)
    assert info["merged"] == 1 and len(mz) == 3
    ia, ib = 3.0 / 4.0, 1.0 / 2.0  # unit-TIC intensities of the two overlapping peaks
    assert it[0] == pytest.approx(ia + ib)
    assert mz[0] == pytest.approx((500.000 * ia + 500.0015 * ib) / (ia + ib))
    assert it.sum() == pytest.approx(2.0)
    # just outside the window: two peaks
    mz2, _, info2 = C.mix_peaks(a_mz, a_int, np.array([500.0025, 700.0]), b_int, 1.0, tol=0.002)
    assert info2["merged"] == 0 and len(mz2) == 4


def _meta(**kw):
    m = {"key": "scan=1", "instrument": "Lumos", "activation": "HCD", "nce": 28.0, "peptide": "PEPTIDEK",
         "pool": "TUM_first_pool_1", "precursor_mz": 500.0, "charge": 2, "iso_lower": 0.7, "iso_upper": 0.7}
    m.update(kw)
    return m


def test_compatibility_rules():
    a = _meta()
    assert C.compatible(a, _meta(key="scan=2", peptide="SAMPLER", pool="TUM_first_pool_2", precursor_mz=500.5))[0]
    bad = {
        "isolation": _meta(key="scan=2", peptide="SAMPLER", pool="TUM_first_pool_2", precursor_mz=500.8),
        "nce": _meta(key="scan=2", peptide="SAMPLER", pool="TUM_first_pool_2", nce=35.0),
        "activation": _meta(key="scan=2", peptide="SAMPLER", pool="TUM_first_pool_2", activation="CID"),
        "instrument": _meta(key="scan=2", peptide="SAMPLER", pool="TUM_first_pool_2", instrument="QE"),
        "peptide": _meta(key="scan=2", peptide="PEPTLDEK", pool="TUM_first_pool_2"),  # same identity (I=L)
        "pool": _meta(key="scan=2", peptide="SAMPLER", pool="TUM_first_pool_1"),
    }
    for reason, b in bad.items():
        ok, why = C.compatible(a, b)
        assert not ok and reason in why, (reason, why)
    # explicit half-width overrides the isolation offsets
    assert C.compatible(a, bad["isolation"], iso_halfwidth=1.0)[0]


def _spectra(n=12, seed=0):
    rng = np.random.default_rng(seed)
    peps = ["PEPTIDEK", "SAMPLER", "LATEMK", "AAGGSSK", "VVLLMK", "CCDDEEK"]
    out = {}
    for i in range(n):
        mz = np.sort(rng.uniform(150, 1500, 40))
        out[f"scan={i + 1}"] = (mz, rng.uniform(1, 100, 40),
                                _meta(key=f"scan={i + 1}", peptide=peps[i % len(peps)], pool=f"P_{i % 3}",
                                      precursor_mz=500.0 + 0.1 * i))
    return out


def test_pairing_and_build_deterministic_and_rejects_incompatible():
    sp = _spectra()
    meta = pd.DataFrame([m for _, _, m in sp.values()])
    p1 = C.pair_spectra(meta, seed=5)
    assert p1.equals(C.pair_spectra(meta, seed=5))
    assert len(p1) > 0
    for r in p1.itertuples():
        assert C.compatible(sp[r.key_a][2], sp[r.key_b][2])[0]
    used = list(p1["key_a"]) + list(p1["key_b"])
    assert len(used) == len(set(used))  # each parent is used once
    ch1, rej1 = C.build_chimeras(sp, p1, ratio=10.0)
    ch2, _ = C.build_chimeras(sp, p1, ratio=10.0)
    assert rej1.empty and len(ch1) == len(p1)
    for x, y in zip(ch1, ch2):
        assert np.array_equal(x["mz"], y["mz"]) and np.array_equal(x["intensity"], y["intensity"])
    # precursor and charge from the dominant peptide
    c0 = ch1[0]
    assert c0["precursor_mz"] == sp[c0["parent1"]][2]["precursor_mz"] and c0["charge"] == sp[c0["parent1"]][2]["charge"]
    assert c0["ratio"] == 10.0
    bad = pd.DataFrame({"key_a": ["scan=1"], "key_b": ["scan=7"]})  # same peptide (index 0 and 6)
    ch, rej = C.build_chimeras(sp, bad, ratio=1.0)
    assert ch == [] and list(rej["reason"].str.contains("peptide")) == [True]


def test_mgf_round_trip(tmp_path):
    pytest.importorskip("pyteomics")
    sp = _spectra()
    meta = pd.DataFrame([m for _, _, m in sp.values()])
    ch, _ = C.build_chimeras(sp, C.pair_spectra(meta, seed=1), ratio=1.0)
    out = C.write_chimeras(ch, tmp_path / "chim.mgf", tmp_path / "chim.tsv")
    from pyteomics import mgf
    rd = list(mgf.read(str(out[0])))
    assert len(rd) == len(ch)
    assert rd[0]["params"]["title"] == "scan=1"
    tab = pd.read_csv(out[1], sep="\t", comment="#")
    assert list(tab.columns[:6]) == ["key", "parent1", "parent2", "pep1", "pep2", "ratio"]


def _tag_for(peptide, pos, L):
    res, pref, total = S.peptide_masses(peptide)
    return {"tag": res[pos:pos + L], "nterm_mass": pref[pos], "cterm_mass": total - pref[pos + L]}


def test_attribution():
    chim = pd.DataFrame({"key": ["scan=1", "scan=2", "scan=3", "scan=4"],
                         "pep1": ["SAMPLER", "SAMPLER", "SAMPLER", "SAMPLER"],
                         "pep2": ["PEPTIDEK", "PEPTIDEK", "PEPTIDEK", "SAMPLEK"]})
    rows = []
    for key, tags in {
        "scan=1": [_tag_for("SAMPLER", 1, 3), _tag_for("PEPTIDEK", 2, 3)],   # pep1 rank 1, pep2 rank 2
        "scan=2": [_tag_for("PEPTIDEK", 2, 3)],                              # pep2 only
        "scan=3": [{"tag": "WWW", "nterm_mass": 1.0, "cterm_mass": 2.0}],    # neither
        "scan=4": [_tag_for("SAMPLER", 0, 4)],                               # SAMP fits both
    }.items():
        for r, t in enumerate(tags, 1):
            rows.append({"key": key, "rank": r, **t})
    per_tag, per_spec = C.attribute_tags(pd.DataFrame(rows), chim, k=50)
    assert list(per_tag["attribution"]) == ["pep1", "pep2", "pep2", "neither", "both"]
    s = per_spec.set_index("key")
    assert bool(s.loc["scan=1", "both_topk"]) and not bool(s.loc["scan=2", "both_topk"])
    assert bool(s.loc["scan=1", "pep1_rank1"]) and not bool(s.loc["scan=2", "pep1_rank1"])
    assert bool(s.loc["scan=4", "both_topk"])
    assert list(s["rank1_attribution"]) == ["pep1", "pep2", "neither", "both"]
    # top-k cut: with k = 1 scan=1 has only its pep1 tag
    _, s1 = C.attribute_tags(pd.DataFrame(rows), chim, k=1)
    assert not bool(s1.set_index("key").loc["scan=1", "both_topk"])


def test_attribution_with_no_matching_tags():
    chim = pd.DataFrame({"key": ["scan=1"], "pep1": ["SAMPLER"], "pep2": ["PEPTIDEK"]})
    tags = pd.DataFrame({"key": ["scan=9"], "rank": [1], "tag": ["AMP"], "nterm_mass": [1.0], "cterm_mass": [1.0]})
    per_tag, per_spec = C.attribute_tags(tags, chim)
    assert per_tag.empty and list(per_spec["rank1_attribution"]) == ["untagged"]


def test_pairing_caps_appearances_per_identity():
    sp = _spectra(n=36)
    meta = pd.DataFrame([m for _, _, m in sp.values()])
    free = C.pair_spectra(meta, seed=5)
    assert free.equals(C.pair_spectra(meta, seed=5, max_per_identity=None))  # default unchanged
    capped = C.pair_spectra(meta, seed=5, max_per_identity=1)
    pep = {k: S.normalize_peptide(m["peptide"]) for k, (_, _, m) in sp.items()}
    ids = [pep[k] for k in list(capped["key_a"]) + list(capped["key_b"])]
    assert len(capped) > 0 and len(ids) == len(set(ids))  # every identity in at most one chimera
    assert len(free) > len(capped)
