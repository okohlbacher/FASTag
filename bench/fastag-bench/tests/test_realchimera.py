"""1.13 item 12 (#16): real-chimera benchmark — MS1 purity port, Sage chimera truth, per-spectrum scoring,
manifest verification, endpoints and the CLI."""
import gzip
import hashlib
import importlib.util
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from fastag_bench import realchimera as RC
from fastag_bench import score as S
from fastag_bench.cli import main
from fastag_bench.config import DEFAULTS, load_datasets
from fastag_bench.sage import sage_config

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("stats_realchimera", ROOT / "scripts" / "stats_realchimera.py")
SR = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SR)
C = RC.C13C12


# ------------------------------------------------------------------------------------------------ purity
def test_purity_counts_isotopes_and_interference():
    # precursor 500.0 2+, isotopes 500.5017, 501.0034; one interfering peak at 500.3 inside the window
    mz = [498.0, 500.0, 500.3, 500.0 + C / 2, 500.0 + C, 502.0]
    it = [50.0, 100.0, 40.0, 60.0, 20.0, 70.0]
    q = RC.precursor_purity(mz, it, 500.0, 2, 1.2, 1.2, iso_target=500.0, tol_ppm=10)
    assert q["total"] == pytest.approx(220.0)  # 500.0, 500.3, 500.50, 501.00; 498.0 and 502.0 are outside [498.8, 501.2]
    assert q["target"] == pytest.approx(180.0)
    assert q["signal_proportion"] == pytest.approx(180.0 / 220.0)
    assert q["target_peaks"] == 3 and q["interfering_peaks"] == 1


def test_purity_window_bounds_inclusive_and_peak_outside_tolerance():
    mz = [499.0, 500.0, 500.0 + C / 2 + 0.02]  # third peak is 40 ppm off its isotope position
    it = [10.0, 30.0, 60.0]
    q = RC.precursor_purity(mz, it, 500.0, 2, 1.0, 1.0, 500.0, tol_ppm=10)
    assert q["total"] == pytest.approx(100.0)  # 499.0 sits on the lower bound and counts
    assert q["target"] == pytest.approx(30.0) and q["target_peaks"] == 1
    # with a wider tolerance (2 x 25 ppm of 500 = 0.025) it becomes an isotope
    assert RC.precursor_purity(mz, it, 500.0, 2, 1.0, 1.0, 500.0, tol_ppm=25)["target"] == pytest.approx(90.0)


def test_purity_center_target_vs_selected():
    # isolation target 500.6, selected (monoisotopic) ion 500.0, offsets 0.5: the window is [500.1, 501.1]
    # around the target, so the monoisotopic peak lies outside and only the two upper isotopes count
    mz = [500.0, 500.0 + C / 2, 500.8, 500.0 + C]
    it = [100.0, 80.0, 30.0, 40.0]
    t = RC.precursor_purity(mz, it, 500.0, 2, 0.5, 0.5, iso_target=500.6, tol_ppm=10, center="target")
    assert t["total"] == pytest.approx(150.0) and t["target"] == pytest.approx(120.0)
    s = RC.precursor_purity(mz, it, 500.0, 2, 0.5, 0.5, iso_target=500.6, tol_ppm=10, center="selected")
    assert s["total"] == pytest.approx(100.0) and s["target"] == pytest.approx(100.0)  # [499.5, 500.5]: 500.0 only
    # a missing target falls back to the selected ion
    m = RC.precursor_purity(mz, it, 500.0, 2, 0.5, 0.5, iso_target=float("nan"), tol_ppm=10)
    assert m == s
    with pytest.raises(ValueError):
        RC.precursor_purity(mz, it, 500.0, 2, 0.5, 0.5, center="middle")


def test_purity_empty_window_and_unknown_charge():
    q = RC.precursor_purity([100.0, 900.0], [1.0, 1.0], 500.0, 2, 1.0, 1.0, 500.0)
    assert q["total"] == 0 and q["signal_proportion"] == 0.0
    # charge None is charge 1: the isotope one full C13 step above counts, the half step does not
    mz = [500.0, 500.0 + C / 2, 500.0 + C]
    q = RC.precursor_purity(mz, [10.0, 10.0, 10.0], 500.0, None, 1.5, 1.5, 500.0)
    assert q["target_peaks"] == 2 and q["signal_proportion"] == pytest.approx(2 / 3)


def test_purity_table_reads_mzml(tmp_path):
    pytest.importorskip("pyteomics")
    from pyteomics import mzml  # noqa: F401
    p = tmp_path / "t.mzML"
    p.write_text(_MZML)
    df = RC.purity_table(p, tol_ppm=10)
    assert list(df["key"]) == ["scan=2", "scan=3"]
    assert df.loc[0, "ms1_key"] == "scan=1"
    assert df.loc[0, "purity"] == pytest.approx(150.0 / 200.0)
    assert math.isnan(df.loc[1, "purity"])  # no isolation window -> no purity


def _b64(a, dtype):
    import base64
    return base64.b64encode(np.asarray(a, dtype).tobytes()).decode()


def _spec_xml(idx, ms, mz, it, prec=None):
    cv_ms = f'<cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="{ms}"/>'
    pre = ""
    if prec:
        pmz, z, lo, hi = prec
        iw = ("" if lo is None else
              f'<isolationWindow><cvParam cvRef="MS" accession="MS:1000827" name="isolation window target m/z" value="{pmz}"/>'
              f'<cvParam cvRef="MS" accession="MS:1000828" name="isolation window lower offset" value="{lo}"/>'
              f'<cvParam cvRef="MS" accession="MS:1000829" name="isolation window upper offset" value="{hi}"/></isolationWindow>')
        pre = (f'<precursorList count="1"><precursor>{iw}<selectedIonList count="1"><selectedIon>'
               f'<cvParam cvRef="MS" accession="MS:1000744" name="selected ion m/z" value="{pmz}"/>'
               f'<cvParam cvRef="MS" accession="MS:1000041" name="charge state" value="{z}"/>'
               f'</selectedIon></selectedIonList><activation><cvParam cvRef="MS" accession="MS:1000422" '
               f'name="beam-type collision-induced dissociation"/></activation></precursor></precursorList>')
    arr = (f'<binaryDataArrayList count="2">'
           f'<binaryDataArray encodedLength="0"><cvParam cvRef="MS" accession="MS:1000523" name="64-bit float"/>'
           f'<cvParam cvRef="MS" accession="MS:1000576" name="no compression"/>'
           f'<cvParam cvRef="MS" accession="MS:1000514" name="m/z array"/><binary>{_b64(mz, "<f8")}</binary></binaryDataArray>'
           f'<binaryDataArray encodedLength="0"><cvParam cvRef="MS" accession="MS:1000523" name="64-bit float"/>'
           f'<cvParam cvRef="MS" accession="MS:1000576" name="no compression"/>'
           f'<cvParam cvRef="MS" accession="MS:1000515" name="intensity array"/><binary>{_b64(it, "<f8")}</binary></binaryDataArray>'
           f'</binaryDataArrayList>')
    return (f'<spectrum index="{idx}" id="controllerType=0 controllerNumber=1 scan={idx + 1}" defaultArrayLength="{len(mz)}">'
            f'{cv_ms}{pre}{arr}</spectrum>')


_MZML = ('<?xml version="1.0" encoding="utf-8"?><mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">'
         '<cvList count="1"><cv id="MS" fullName="PSI-MS" URI="x"/></cvList><run id="r"><spectrumList count="3">'
         + _spec_xml(0, 1, [499.0, 500.0, 500.3, 500.0 + C / 2, 502.0], [10.0, 100.0, 50.0, 50.0, 70.0])
         + _spec_xml(1, 2, [200.0, 300.0], [1.0, 1.0], (500.0, 2, 0.8, 0.8))
         + _spec_xml(2, 2, [200.0, 300.0], [1.0, 1.0], (500.0, 2, None, None))
         + '</spectrumList></run></mzML>')


# ------------------------------------------------------------------------------------------------ truth
def _sage_tsv(path, rows):
    df = pd.DataFrame(rows, columns=["filename", "scannr", "rank", "label", "peptide", "spectrum_q", "sage_discriminant_score"])
    df.to_csv(path, sep="\t", index=False)
    return path


def test_chimera_truth_categories(tmp_path):
    f = "run.mzML"
    p = _sage_tsv(tmp_path / "results.sage.tsv", [
        (f, "scan=1", 1, 1, "PEPTIDEK", 0.001, 9), (f, "scan=1", 2, 1, "SAMPLER", 0.005, 8),     # chimeric
        (f, "scan=2", 1, 1, "PEPTLDEK", 0.001, 9), (f, "scan=2", 2, 1, "PEPTIDE", 0.002, 8),     # nested (I=L, substring)
        (f, "scan=3", 1, 1, "AAAAK", 0.001, 9), (f, "scan=3", 2, -1, "KAAAA", 0.001, 1),         # rank 2 decoy -> single
        (f, "scan=4", 1, 1, "CCCCK", 0.001, 9), (f, "scan=4", 2, 1, "DDDDK", 0.05, 7),           # rank 2 above fdr -> single
        (f, "scan=5", 1, 1, "EEEEK", 0.001, 9),                                                  # one PSM -> single
        (f, "scan=6", 1, 1, "FFFFK", 0.2, 2), (f, "scan=6", 2, 1, "GGGGK", 0.001, 8),            # rank 1 fails -> not scored
        (f, "scan=7", 1, -1, "HHHHK", 0.001, 9),                                                 # decoy rank 1 -> not scored
    ])
    t = RC.chimera_truth(p, fdr=0.01).set_index("key")
    assert t.loc["scan=1", "category"] == "chimeric" and t.loc["scan=1", "pep2"] == "SAMPLER"
    assert t.loc["scan=2", "category"] == "nested"
    assert (t.loc[["scan=3", "scan=4", "scan=5"], "category"] == "single").all()
    assert (t.loc[["scan=3", "scan=4", "scan=5"], "pep2"] == "").all()
    assert "scan=6" not in t.index and "scan=7" not in t.index


def test_rank2_needs_its_own_fdr(tmp_path):
    # Sage's spectrum_q passes every rank-2 target, but within rank 2 a decoy outscores two of the three
    # targets: their rank-2 q is 1/3 (monotone) > 0.01, so only the best one stays chimeric
    f = "run.mzML"
    rows = []
    for i, sc in enumerate((10.0, 6.0, 5.0)):
        rows += [(f, f"scan={i}", 1, 1, f"PEPT{'A' * (i + 1)}K", 0.001, 20.0),
                 (f, f"scan={i}", 2, 1, f"SAMPL{'G' * (i + 1)}R", 0.001, sc)]
    rows += [(f, "scan=9", 1, 1, "WWWWK", 0.001, 20.0), (f, "scan=9", 2, -1, "KWWWW", 0.001, 7.0)]
    t = RC.chimera_truth(_sage_tsv(tmp_path / "r.tsv", rows), fdr=0.01).set_index("key")
    assert t.loc["scan=0", "category"] == "chimeric"
    assert (t.loc[["scan=1", "scan=2", "scan=9"], "category"] == "single").all()
    q = RC.rank_q(pd.DataFrame({"label": [1, -1, 1, 1], "sage_discriminant_score": [10, 7, 6, 5]}))
    assert list(q) == [0.0, pytest.approx(1 / 3), pytest.approx(1 / 3), pytest.approx(1 / 3)]


def test_header_match():
    df = pd.DataFrame({"expmass": [1000.0, 1000.0 + C, 1000.0 + 0.5, 1000.03], "calcmass": [1000.0, 1000.0, 1000.0, 1000.0]})
    assert list(RC.header_match(df)) == [True, True, False, False]  # 0.03 Da = 30 ppm > 20 ppm
    assert not RC.header_match(pd.DataFrame({"x": [1]})).any()


def test_chimera_truth_needs_rank_column(tmp_path):
    p = tmp_path / "r.tsv"
    pd.DataFrame({"filename": ["a"], "scannr": ["scan=1"], "label": [1], "peptide": ["AK"], "spectrum_q": [0.0]}).to_csv(
        p, sep="\t", index=False)
    with pytest.raises(ValueError):
        RC.chimera_truth(p)


# ------------------------------------------------------------------------------------------------ scoring
def _fwd(tag, peptide):
    """Tag row (as FASTag writes it) reading `tag` forward at its first occurrence in `peptide`."""
    res, pref, tot = S.peptide_masses(peptide)
    i = res.index(tag)
    return {"tag": tag, "nterm_mass": pref[i], "cterm_mass": tot - pref[i + len(tag)]}


def _tags(rows):
    df = pd.DataFrame(rows)
    df["rank"] = df.groupby("spectrum", sort=False).cumcount() + 1
    df["key"] = df["spectrum"]
    return df


def test_score_spectra_attribution_and_topk():
    p1, p2 = "PEPTIDEK", "SAMPLERWK"
    truth = pd.DataFrame({"key": ["scan=1", "scan=2", "scan=3", "scan=4", "scan=5"],
                          "pep1": [p1, p1, p1, p1, p1], "pep2": [p2, p2, p2, "", p2],
                          "category": ["chimeric", "chimeric", "chimeric", "single", "chimeric"]})
    junk = {"tag": "WWW", "nterm_mass": 1.0, "cterm_mass": 2.0}
    tags = _tags([
        {"spectrum": "scan=1", **_fwd("PTL", p1)}, {"spectrum": "scan=1", **junk}, {"spectrum": "scan=1", **_fwd("MPL", p2)},
        {"spectrum": "scan=2", **_fwd("MPL", p2)}, {"spectrum": "scan=2", **_fwd("TLD", p1)},
        {"spectrum": "scan=3", **junk},
        {"spectrum": "scan=4", **_fwd("TLD", p1)},
        # scan=5 untagged
    ])
    # the rank-1 tag of scan=1 with a wrong flank does not count (flank rule)
    sc = RC.score_spectra(tags, truth, ks=(1, 2, 3)).set_index("key")
    assert sc.loc["scan=1", "attribution"] == "pep1" and sc.loc["scan=1", "union_rank1"]
    assert not sc.loc["scan=1", "both_top2"] and sc.loc["scan=1", "both_top3"]
    assert sc.loc["scan=2", "attribution"] == "pep2" and sc.loc["scan=2", "both_top2"]
    assert sc.loc["scan=3", "attribution"] == "neither" and not sc.loc["scan=3", "union_rank1"]
    assert sc.loc["scan=4", "attribution"] == "pep1" and not sc.loc["scan=4", "pep2_top3"]
    assert sc.loc["scan=5", "attribution"] == "untagged" and sc.loc["scan=5", "n_tags"] == 0
    bad = _tags([{"spectrum": "scan=1", "tag": "PTL", "nterm_mass": 0.0, "cterm_mass": 0.0}])
    assert not RC.score_spectra(bad, truth, ks=(1,)).set_index("key").loc["scan=1", "pep1_rank1"]


def test_chance_truth_deranges_peptides():
    truth = pd.DataFrame({"key": [f"scan={i}" for i in range(6)],
                          "pep1": ["AAAK", "CCCK", "DDDK", "EEEK", "FFFK", "GGGK"],
                          "pep2": ["HHHK", "", "LLLK", "", "MMMK", ""], "category": ["chimeric", "single"] * 3})
    ch = RC.chance_truth(truth, seed=3)
    assert (ch["pep1"] != truth["pep1"]).all()
    has2 = truth["pep2"] != ""
    assert (ch.loc[has2, "pep2"] != truth.loc[has2, "pep2"]).all() and (ch.loc[~has2, "pep2"] == "").all()
    assert (ch["category"] == truth["category"]).all()


# ------------------------------------------------------------------------------------------------ sage
def test_sage_chimera_mode_is_closed_plus_chimera_switches():
    ds = next(d for d in load_datasets(ROOT / "datasets.yaml") if d.id == "PXD003531_QE_NO_03")
    closed = sage_config(ds, "/db/h.fasta", ["/in/r.mzML"], DEFAULTS["sage"])
    ch = sage_config(ds, "/db/h.fasta", ["/in/r.mzML"], DEFAULTS["sage"], mode="chimera")
    assert ch["chimera"] is True and ch["wide_window"] is True and ch["report_psms"] == 2
    assert closed["chimera"] is False and closed["wide_window"] is False and closed["report_psms"] == 1
    for k in closed:
        if k not in ("chimera", "wide_window", "report_psms"):
            assert ch[k] == closed[k], k


def test_run_dataset_from_manifest_row():
    r = pd.DataFrame([{**_man_row("a", "x", "y"), "fixed_mods": "C:57.021464", "variable_mods": "M:15.994915;S:79.966331;S:1.0",
                       "fragment_tol": "20ppm", "missed_cleavages": 2, "enzyme": "Trypsin"}]).iloc[0]
    ds = RC.run_dataset(r)
    cfg = sage_config(ds, "/db.fasta", ["/r.mzML"], DEFAULTS["sage"], mode="chimera")
    assert cfg["database"]["static_mods"] == {"C": 57.021464}
    assert cfg["database"]["variable_mods"] == {"M": [15.994915], "S": [79.966331, 1.0]}
    assert cfg["fragment_tol"] == {"ppm": [-20.0, 20.0]}
    assert cfg["database"]["enzyme"]["missed_cleavages"] == 2 and cfg["database"]["enzyme"]["cleave_at"] == "KR"
    assert cfg["database"]["max_variable_mods"] == 3 and cfg["precursor_tol"] == {"ppm": [-10.0, 10.0]}
    r2 = r.copy()
    r2["fragment_tol"] = "0.5"
    with pytest.raises(ValueError):
        RC.run_dataset(r2)


# ------------------------------------------------------------------------------------------------ manifest / CLI
def _man_row(run_id, mzml, fasta, split="DEV", sha_m=None, sha_f=None):
    return {"run_id": run_id, "split": split, "pxd": "PXD000000", "raw_file": "x.raw", "raw_sha1": "0" * 40,
            "mzml": str(mzml), "mzml_sha256": sha_m or "0" * 64, "fasta": str(fasta), "fasta_sha256": sha_f or "0" * 64,
            "conversion": "trfp", "enzyme": "Trypsin", "fixed_mods": "C:57.021464", "variable_mods": "M:15.994915",
            "max_variable_mods": 3, "precursor_ppm": 10, "fragment_tol": "0.02Da", "missed_cleavages": 2}


def _setup(tmp_path, good=True):
    m, f = tmp_path / "r.mzML", tmp_path / "db.fasta"
    m.write_bytes(b"mzml bytes")
    f.write_bytes(b">p\nPEPTIDEK\n")
    sm = hashlib.sha256(m.read_bytes()).hexdigest()
    sf = hashlib.sha256(f.read_bytes()).hexdigest() if good else "f" * 64
    man = tmp_path / "manifest.tsv"
    pd.DataFrame([_man_row("r1", m, f, sha_m=sm, sha_f=sf), _man_row("h1", m, f, split="HO")]).to_csv(man, sep="\t", index=False)
    cfg = tmp_path / "cfg.yaml"
    cfg.write_text(f"realchimera:\n  manifest: {man}\n  work_dir: {tmp_path / 'work'}\n  split: DEV\n")
    return cfg


def test_verify_accepts_matching_and_refuses_mismatch(tmp_path):
    cfg = _setup(tmp_path)
    assert main(["realchimera", "verify", "-c", str(cfg)]) == 0
    assert (tmp_path / "work" / "verify_DEV.tsv").exists()
    (tmp_path / "b").mkdir()
    bad = _setup(tmp_path / "b", good=False)
    assert main(["realchimera", "verify", "-c", str(bad)]) == 1
    # later steps refuse to run without a passing verify of the same split
    c = RC.load(bad)
    with pytest.raises(RuntimeError):
        RC.step_purity(c)
    # the HO split was never verified for the good config
    assert main(["realchimera", "purity", "-c", str(cfg), "--split", "HO"]) == 1


def test_manifest_validation(tmp_path):
    man = tmp_path / "m.tsv"
    pd.DataFrame([_man_row("a", "x", "y", sha_m="ABC")]).to_csv(man, sep="\t", index=False)
    with pytest.raises(ValueError):
        RC.read_manifest(man)
    pd.DataFrame([_man_row("a", "x", "y"), _man_row("a", "x", "y")]).to_csv(man, sep="\t", index=False)
    with pytest.raises(ValueError):
        RC.read_manifest(man)
    pd.DataFrame([{k: v for k, v in _man_row("a", "x", "y").items() if k != "raw_sha1"}]).to_csv(man, sep="\t", index=False)
    with pytest.raises(ValueError):
        RC.read_manifest(man)
    pd.DataFrame([_man_row("a", "x", "y")]).to_csv(man, sep="\t", index=False)
    with pytest.raises(ValueError):
        RC.read_manifest(man, split="HO")


# ------------------------------------------------------------------------------------------------ statistics
def test_two_group_boot():
    rng = np.random.default_rng(0)
    a = rng.random(400) < 0.6
    b = rng.random(400) < 0.3
    d, lo, hi = SR.two_group_boot(np.arange(400), a, np.arange(400), b, n_boot=500)
    assert d == pytest.approx(a.mean() - b.mean()) and lo < d < hi and lo > 0
    d, lo, hi = SR.two_group_boot(np.arange(400), a, np.arange(400), a, n_boot=500)
    assert d == 0 and lo < 0 < hi
    assert all(math.isnan(x) for x in SR.two_group_boot([], [], [1], [1]))


def _spectra(n_chim=300, n_single=600, chim_rate=0.4, pure_rate=0.7, impure_rate=0.4, div_gain=0.0, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n_chim):
        u = rng.random() < chim_rate
        both = rng.random() < 0.1
        base = {"run_id": "r1", "key": f"scan={i}", "category": "chimeric", "pep1": f"P{i}K", "pep2": f"Q{i}K",
                "cluster1": f"r1|P{i}K", "cluster2": f"r1|Q{i}K", "purity": rng.uniform(0.2, 0.9), "tagged": True,
                "pep1_rank1": u, "pep2_rank1": False, "union_rank1": u, "both_rank1": False,
                "attribution": "pep1" if u else "neither", "pep1_top10": True, "pep2_top10": both, "pep2_top50": both, "both_top50": both}
        for prof in ("default", "cap10", "cap10_div"):
            b10 = both or (prof == "cap10_div" and rng.random() < div_gain)
            for arm in ("truth", "chance"):
                r = {**base, "profile": prof, "arm": arm, "both_top10": b10 if arm == "truth" else False}
                if arm == "chance":
                    r.update(union_rank1=False, pep1_rank1=False)
                rows.append(r)
    for j in range(n_single):
        pur = 0.95 if j % 2 == 0 else 0.3
        c = rng.random() < (pure_rate if pur > 0.9 else impure_rate)
        base = {"run_id": "r1", "key": f"scan={10000 + j}", "category": "single", "pep1": f"S{j}K", "pep2": "",
                "cluster1": f"r1|S{j}K", "cluster2": "", "purity": pur, "tagged": True, "pep1_rank1": c,
                "pep2_rank1": False, "union_rank1": c, "both_rank1": False, "attribution": "pep1" if c else "neither",
                "pep1_top10": c, "pep2_top10": False, "pep2_top50": False, "both_top10": False, "both_top50": False}
        for prof in ("default", "cap10", "cap10_div"):
            for arm in ("truth", "chance"):
                rows.append({**base, "profile": prof, "arm": arm})
    return pd.DataFrame(rows)


def _ep(df, name):
    e = SR.endpoints(df, n_boot=400)
    return e[e["endpoint"] == name].iloc[0]


def test_endpoints_verdicts():
    df = _spectra()
    assert _ep(df, "H1 chimeric penalty")["verdict"] == "penalty shown"
    assert _ep(df, "H2 union non-inferiority")["verdict"] == "not shown"
    assert _ep(df, "H3 purity gradient")["verdict"] == "gradient shown"
    assert _ep(df, "H4 diversity")["verdict"] == "no benefit claimed"
    flat = _spectra(chim_rate=0.7, pure_rate=0.7, impure_rate=0.7, div_gain=0.3, seed=1)
    assert _ep(flat, "H1 chimeric penalty")["verdict"] in ("no penalty", "inconclusive")
    assert _ep(flat, "H2 union non-inferiority")["verdict"] == "non-inferior"
    assert _ep(flat, "H3 purity gradient")["verdict"] == "not shown"
    assert _ep(flat, "H4 diversity")["verdict"] == "benefit"


def test_endpoints_not_evaluable_when_small_or_one_cluster():
    small = _spectra(n_chim=50)
    for name in ("H1 chimeric penalty", "H2 union non-inferiority", "H4 diversity"):
        assert _ep(small, name)["verdict"] == "not evaluable"
    one = _spectra()
    m = one["category"] == "chimeric"
    one.loc[m, "cluster1"] = "r1|SAME"  # every chimera shares one peptide: one cluster
    assert _ep(one, "H1 chimeric penalty")["verdict"] == "not evaluable"


def test_report_round_trip(tmp_path):
    df = _spectra()
    p = tmp_path / "spectra_DEV.tsv.gz"
    with gzip.open(p, "wt") as fh:
        fh.write("# test\n")
        df.to_csv(fh, sep="\t", index=False)
    out = SR.report(p, tmp_path / "ep.tsv", n_boot=200, log=lambda *_: None)
    text = out.read_text()
    assert "scorer: scripts/stats_realchimera.py sha256" in text and "H4 diversity" in text
