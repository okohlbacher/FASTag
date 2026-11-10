import pandas as pd
import pytest

from fastag_bench import score as S
from fastag_bench.parsers import spectrum_key


@pytest.mark.parametrize("tag,pep,ok", [
    ("PEP", "APEPTIDEK", True),        # forward substring
    ("PEP", "KEDITPEPA", True),        # reverse orientation also counts
    ("EDI", "APEPTIDEK", True),        # reversed EDI = IDE, in the peptide
    ("TLD", "APEPTIDEK", True),        # I=L: TLD == TID
    ("DLT", "APEPTIDEK", True),        # reversed and I=L
    ("LLL", "AIIIK", True),            # I and L fold both ways
    ("KKK", "APEPTIDEK", False),
    ("PEPX", "APEPTIDEK", False),
    ("", "APEPTIDEK", False),
    ("PEP", "", False),
])
def test_tag_matches(tag, pep, ok):
    assert S.tag_matches(tag, pep) is ok


def test_modifications_and_termini_are_stripped():
    assert S.normalize_peptide("[+42.0106]-M[+15.9949]PEPTIDEK") == "MPEPTLDEK"
    assert S.normalize_peptide("n[42]PEPS(Phospho)TIDE") == "PEPSTLDE"
    assert S.tag_matches("MPE", "[+42.0106]-M[+15.9949]PEPTIDEK")
    # a tag must not match across a stripped modification mass written as digits
    assert not S.tag_matches("159", "M[+15.9949]PEP")


def test_lowercase_and_gap_spelling():
    assert S.tag_matches("pep", "APEPTIDEK")
    assert S.normalize_tag("t-i-d") == "TLD"


def _tags(rows):
    df = pd.DataFrame(rows, columns=["spectrum", "tag"])
    df["rank"] = df.groupby("spectrum").cumcount() + 1
    df["key"] = df["spectrum"].map(spectrum_key)
    return df


def test_score_tags_counts():
    psms = pd.DataFrame({"key": ["scan=1", "scan=2", "scan=3"], "peptide": ["PEPTIDEK", "SAMPLER", "LLLK"]})
    tags = _tags([
        ("controllerType=0 controllerNumber=1 scan=1", "PEP"),   # rank 1 correct
        ("controllerType=0 controllerNumber=1 scan=1", "WWW"),
        ("controllerType=0 controllerNumber=1 scan=2", "WWW"),   # rank 1 wrong
        ("controllerType=0 controllerNumber=1 scan=2", "ELP"),   # rank 2 correct (reverse PLE in SAMPLER)
        ("controllerType=0 controllerNumber=1 scan=9", "PEP"),   # no PSM: ignored
    ])
    r = S.score_tags(tags, psms, ks=(1, 2), rule="sequence")
    assert r["psm_spectra"] == 3
    assert r["psm_spectra_tagged"] == 2
    assert r["tags_on_psm_spectra"] == 4
    assert r["top1_correct"] == 1
    assert r["top1_precision"] == 0.5
    assert r["top1_recall"] == pytest.approx(1 / 3, abs=1e-6)
    assert r["all_tags_precision"] == 0.5
    assert r["top2_any_correct"] == 2
    assert r["top2_any_rate"] == 1.0


def test_rank_curve_monotone():
    psms = pd.DataFrame({"key": ["scan=1", "scan=2"], "peptide": ["PEPTIDEK", "SAMPLER"]})
    tags = _tags([("scan=1", "WWW"), ("scan=1", "PEP"), ("scan=2", "AMP")])
    c = S.rank_curve(tags, psms, 3, rule="sequence")
    assert list(c["spectra"]) == [1, 2, 2]
    assert c["rate"].is_monotonic_increasing


def test_shuffled_control_moves_every_peptide():
    psms = pd.DataFrame({"key": [f"scan={i}" for i in range(50)], "peptide": [f"PEP{i}" for i in range(50)]})
    sh = S.shuffled_psms(psms, seed=1)
    assert (sh["peptide"].to_numpy() != psms["peptide"].to_numpy()).all()
    assert sorted(sh["peptide"]) == sorted(psms["peptide"])


def test_spectrum_key():
    assert spectrum_key("controllerType=0 controllerNumber=1 scan=981") == "scan=981"
    assert spectrum_key("ms_run[1]:scan=981") == "scan=981"
    assert spectrum_key("index=5") == "index=5"


def test_protease_and_label_mapping():
    assert S.expected_protease(["Lys-C", "Trypsin"]) == "Trypsin"
    assert S.expected_protease(["Trypsin/P"]) == "Trypsin"
    assert S.expected_protease(["Asp-N"]) == "Asp-N"
    assert S.expected_protease(["Glu-C", "Trypsin"]) == "mixed"
    assert S.expected_protease([]) is None
    assert S.expected_label(["label free sample"], []) == "label-free"
    assert S.expected_label(["TMT126"], ["TMT6plex"]) == "TMT"
    assert S.expected_label(["TMT 16-plex"], ["TMTpro"]) == "TMTpro"
    assert S.expected_label(["SILAC heavy"], []) == "SILAC"


def test_digest_and_label_calls():
    rep = {("call", "status"): "call", ("call", "class"): "Trypsin", ("call", "model"): "Trypsin",
           ("call", "runner_up_class"): "Lys-C", ("call", "margin"): "1.02"}
    d = S.digest_call(rep)
    assert d["call"] == "Trypsin" and d["margin"] == pytest.approx(1.02)
    lab = {("nlabel", "TMT.share"): "0.2", ("nlabel", "TMT.count"): "500", ("nlabel", "TMT.background"): "3",
           ("nlabel", "iTRAQ4.share"): "0.001", ("nlabel", "iTRAQ4.count"): "2", ("nlabel", "iTRAQ4.background"): "1"}
    assert S.label_call(lab)["label"] == "TMT"
    assert S.label_call({("nlabel", "TMT.share"): "5e-06"})["label"] == "label-free"


def test_species_rank():
    sp = pd.DataFrame({"name": ["Homo", "Macaca", "Sus"], "observed": [12998, 12390, 11073]})
    r = S.score_species(sp, "Homo")
    assert r["expected_rank"] == 1 and r["top1_correct"]
    assert r["top_vs_second_observed"] == pytest.approx(12998 / 12390, abs=1e-4)
    assert S.score_species(sp, "Bos")["expected_rank"] is None


def test_inline_tag_modifications_are_not_residues():
    # FASTag writes variable modifications inline as X[Name]; the name must not become residues
    assert S.normalize_tag("S[Phospho]AK") == "SAK"
    assert S.tag_matches("M[Oxidation]PE", "AMPEK")
    assert not S.tag_matches("S[Phospho]A", "SPHOSPHOA")


# ---------------------------------------------------------------- flank rule

def _flank_case():
    # PEPTIDEK, no modifications: prefix masses before each residue
    res, pref, total = S.peptide_masses("PEPTIDEK")
    return res, pref, total


def test_peptide_masses_parses_sage_notation():
    res, pref, total = S.peptide_masses("[+229.162932]-PEPC[+57.021464]K[+229.162932]")
    assert res == "PEPCK"
    assert pref[0] == pytest.approx(229.162932)
    exp = 229.162932 + 97.052764 + 129.042593 + 97.052764 + 103.009185 + 57.021464 + 128.094963 + 229.162932
    assert total == pytest.approx(exp)
    assert S.peptide_masses("PEPTIDEK-[+0.984016]")[2] == pytest.approx(S.peptide_masses("PEPTIDEK")[2] + 0.984016)
    assert S.peptide_masses("PEPXK")[1] == []


def test_flank_forward_and_reverse():
    res, pref, total = _flank_case()        # P E P T L D E K (I folded)
    i = res.index("TLD")
    n_fwd, c_fwd = pref[i], total - pref[i + 3]
    assert S.tag_correct_flank("TID", n_fwd, c_fwd, res, pref, total)              # both flanks agree
    assert S.tag_correct_flank("TID", n_fwd + 0.04, c_fwd + 5, res, pref, total)   # one flank within 0.05 Da
    assert not S.tag_correct_flank("TID", n_fwd + 0.06, c_fwd + 5, res, pref, total)
    # b-ion read: the tag appears reversed, flanks carry one water (y-ion convention)
    j = res.index("TLD")
    assert S.tag_correct_flank("DLT", total - pref[j + 3] + S.WATER, pref[j] - S.WATER, res, pref, total)
    assert not S.tag_correct_flank("DLT", total - pref[j + 3], pref[j], res, pref, total)
    # right letters at the wrong place: sequence rule yes, flank rule no
    assert S.tag_matches("PEP", "PEPTIDEK")
    assert not S.tag_correct_flank("PEP", 500.0, 500.0, res, pref, total)


def test_flank_reversed_offset_per_ion_series():
    # FASTag 1.12 #15 phase B: a reversed c-ion read carries offC - offN = -15.034708, not +H2O.
    res, pref, total = _flank_case()
    j = res.index("TLD")
    off = S.REVERSED_OFFSET["cz"]
    assert abs(off + 15.034708) < 1e-6 and S.REVERSED_OFFSET["by"] == S.WATER
    n_cz, c_cz = total - pref[j + 3] + off, pref[j] - off
    assert S.tag_correct_flank("DLT", n_cz, c_cz, res, pref, total, reversed_offset=off)
    assert not S.tag_correct_flank("DLT", n_cz, c_cz, res, pref, total)          # read as b/y: wrong
    # forward reads use the same residue-sum convention in every series
    i = res.index("TLD")
    assert S.tag_correct_flank("TID", pref[i], total - pref[i + 3], res, pref, total, reversed_offset=off)
    # the tag TSV's ion_series column selects the offset per row; no column means b/y
    psms = pd.DataFrame({"key": ["scan=1", "scan=2"], "peptide": ["PEPTIDEK", "PEPTIDEK"]})
    tags = _tags([("scan=1", "DLT"), ("scan=2", "DLT")])
    tags["nterm_mass"] = [n_cz, n_cz]
    tags["cterm_mass"] = [c_cz, c_cz]
    plain = S.score_tags(tags, psms, ks=(1,), rule="flank")
    assert plain["all_tags_correct"] == 0
    tags["ion_series"] = ["cz", "by"]
    mixed = S.score_tags(tags, psms, ks=(1,), rule="flank")
    assert mixed["all_tags_correct"] == 1
    tags["ion_series"] = ["zz", "by"]
    with pytest.raises(ValueError):
        S.score_tags(tags, psms, ks=(1,), rule="flank")


def test_flank_reversed_offset_ax():
    # FASTag 1.13 item 11: a reversed a-ion read carries offC - offN = CO2 + CO = +71.984744.
    res, pref, total = _flank_case()
    j = res.index("TLD")
    off = S.REVERSED_OFFSET["ax"]
    assert abs(off - 71.984744) < 1e-5
    n_ax, c_ax = total - pref[j + 3] + off, pref[j] - off
    assert S.tag_correct_flank("DLT", n_ax, c_ax, res, pref, total, reversed_offset=off)
    assert not S.tag_correct_flank("DLT", n_ax, c_ax, res, pref, total)          # read as b/y: wrong
    assert not S.tag_correct_flank("DLT", n_ax, c_ax, res, pref, total, reversed_offset=S.REVERSED_OFFSET["cz"])
    psms = pd.DataFrame({"key": ["scan=1", "scan=2"], "peptide": ["PEPTIDEK", "PEPTIDEK"]})
    tags = _tags([("scan=1", "DLT"), ("scan=2", "DLT")])
    tags["nterm_mass"] = [n_ax, n_ax]
    tags["cterm_mass"] = [c_ax, c_ax]
    tags["ion_series"] = ["ax", "by"]
    assert S.score_tags(tags, psms, ks=(1,), rule="flank")["all_tags_correct"] == 1
    tags["ion_series"] = ["ax", "ax"]
    assert S.score_tags(tags, psms, ks=(1,), rule="flank")["all_tags_correct"] == 2


def test_score_tags_flank_vs_sequence_and_chance():
    res, pref, total = S.peptide_masses("PEPTIDEK")
    i = res.index("TLD")
    psms = pd.DataFrame({"key": ["scan=1", "scan=2"], "peptide": ["PEPTIDEK", "SAMPLER"]})
    tags = _tags([("scan=1", "TID"), ("scan=1", "PEP"), ("scan=2", "AMP")])
    tags["nterm_mass"] = [pref[i], 900.0, 900.0]
    tags["cterm_mass"] = [total - pref[i + 3], 900.0, 900.0]
    f = S.score_tags(tags, psms, ks=(1, 2), rule="flank")
    q = S.score_tags(tags, psms, ks=(1, 2), rule="sequence")
    assert f["all_tags_correct"] == 1 and q["all_tags_correct"] == 3
    assert f["top1_correct"] == 1 and f["any_tag_recall"] == 0.5
    c = S.rank_curve(tags, psms, 2, rule="flank")
    assert list(c["spectra"]) == [1, 1] and list(c["recall"]) == [0.5, 0.5]
    with pytest.raises(ValueError):
        S.score_tags(tags.drop(columns=["nterm_mass"]), psms, rule="flank")


def test_accuracy_profiles():
    from fastag_bench import accuracy as A
    from fastag_bench.config import Dataset
    ds = Dataset(id="x", pxd="PXD000001", species="s", instrument="i", experiments=[], files=[],
                 fastag_args=["-fixed_modifications", "Carbamidomethyl (C)"],
                 tagger={"fragment_tol_da": 0.5, "directag_static_mods": "C 57.021464",
                         "fastag_default_args": ["-fragment_tolerance", "0.5", "-fragment_tolerance_unit", "Da"]})
    tool, a = A.profile_args(ds, "fastag_default")
    assert tool == "fastag" and a[-3:] == ["0.5", "-fragment_tolerance_unit", "Da"]
    tool, a = A.profile_args(ds, "fastag_matched_tl6")
    assert a[a.index("-tag_length") + 1] == "6" and "-gaps" in a and "-no_deisotope" in a
    tool, a = A.profile_args(ds, "directag_matched_tl5")
    assert tool == "directag" and a[a.index("-TagLength") + 1] == "5"
    assert a[a.index("-IsotopeMzTolerance") + 1] == "0.25"
    assert A.profile_args(ds, "directag_default") == ("directag", ["-StaticMods", "C 57.021464"])


def test_cv_patch_keeps_length(tmp_path):
    from fastag_bench import accuracy as A
    src = tmp_path / "a.mzML"
    src.write_bytes(b"<cvParam accession=\"MS:1003378\"/>" + b"x" * 100 + b"MS:1003145")
    dst = tmp_path / "b.mzML"
    assert A.patch_cv_terms(src, dst, chunk=7) == 2
    assert dst.stat().st_size == src.stat().st_size and b"MS:1000483" in dst.read_bytes()


# ---------------------------------------------------------------- #4 additions

DUP_PSMS = pd.DataFrame({"key": [f"scan={i}" for i in range(1, 9)],
                         "peptide": ["PEPTIDEK", "PEPTLDEK", "PEPTIDEK", "SAMPLER", "SAMPLER",
                                     "M[+15.994915]PEPK", "MPEPK", "LLLK"]})


def test_shuffled_psms_unchanged():
    # the v1.9.0 control is kept as it was (row derangement); these are its outputs at the bench import
    assert list(S.shuffled_psms(DUP_PSMS, 0)["peptide"]) == [
        "PEPTLDEK", "LLLK", "SAMPLER", "MPEPK", "SAMPLER", "PEPTIDEK", "M[+15.994915]PEPK", "PEPTIDEK"]
    assert list(S.shuffled_psms(DUP_PSMS, 1)["peptide"]) == [
        "PEPTLDEK", "SAMPLER", "MPEPK", "LLLK", "PEPTIDEK", "PEPTIDEK", "SAMPLER", "M[+15.994915]PEPK"]


def test_shuffled_psms_can_leak_identity():
    # why shuffled_peptides exists: a row derangement can hand a spectrum its own (I/L, mod-stripped) peptide
    leaks = sum(any(S.normalize_peptide(a) == S.normalize_peptide(b)
                    for a, b in zip(DUP_PSMS["peptide"], S.shuffled_psms(DUP_PSMS, s)["peptide"])) for s in range(20))
    assert leaks > 0


@pytest.mark.parametrize("seed", range(50))
def test_shuffled_peptides_is_an_identity_derangement(seed):
    sh = S.shuffled_peptides(DUP_PSMS, seed)
    assert list(sh["key"]) == list(DUP_PSMS["key"])
    own = [S.normalize_peptide(p) for p in DUP_PSMS["peptide"]]
    got = [S.normalize_peptide(p) for p in sh["peptide"]]
    assert all(a != b for a, b in zip(own, got))
    # every assigned peptide is one of the input peptide strings (modifications kept for the flank rule)
    assert set(sh["peptide"]) <= set(DUP_PSMS["peptide"])
    # spectra sharing an identity get the same replacement identity (a permutation of identities)
    by_id = {}
    for a, b in zip(own, got):
        by_id.setdefault(a, set()).add(b)
    assert all(len(v) == 1 for v in by_id.values())


def test_shuffled_peptides_deterministic_and_degenerate():
    assert S.shuffled_peptides(DUP_PSMS, 7).equals(S.shuffled_peptides(DUP_PSMS, 7))
    one = pd.DataFrame({"key": ["scan=1", "scan=2"], "peptide": ["PEPTIDEK", "PEPTLDEK"]})
    # a single identity has no derangement: no chance pairs at all
    assert S.shuffled_peptides(one, 0).empty


def _flanks(peptide, tag_pos, L):
    res, pref, total = S.peptide_masses(peptide)
    return pref[tag_pos], total - pref[tag_pos + L]


def test_tag_correct_any():
    n, c = _flanks("SAMPLER", 1, 3)  # tag AMP after S
    assert S.tag_correct_any("AMP", (n, c), ["PEPTIDEK", "SAMPLER"])
    assert not S.tag_correct_any("AMP", (n, c), ["PEPTIDEK"])
    assert not S.tag_correct_any("AMP", (n, c), [])
    # the sequence is present but neither flank fits: not correct
    assert not S.tag_correct_any("AMP", (n + 1.0, c + 1.0), ["SAMPLER"])
    # equals the paper rule against the single candidate
    assert S.tag_correct_any("AMP", (n, c), ["SAMPLER"]) == S.tag_correct_flank("AMP", n, c, *S.peptide_masses("SAMPLER"))
    assert S.correct_candidates("AMP", (n, c), ["SAMPLER", "PEPTIDEK", "SAMPLER"]) == ["SAMPLER"]


def test_precursor_flank_scores_the_nterm_flank_of_forward_reads_only():
    # #6: APEPTIDEK, tag PTI at position 3 (I=L); the residue mass before it is A+P+E
    res, pref, total = S.peptide_masses("APEPTIDEK")
    n = pref[3]
    c = total - pref[6]
    assert S.tag_correct_flank("PTL", n, c, res, pref, total)
    assert S.tag_correct_precursor_flank("PTL", n, res, pref)
    # a precursor flank off by one isotope (1.00336 Da) fails, even with the C-terminal flank right
    assert S.tag_correct_flank("PTL", n + 1.00336, c, res, pref, total)
    assert not S.tag_correct_precursor_flank("PTL", n + 1.00336, res, pref)
    # a reversed read never scores here
    assert not S.tag_correct_precursor_flank("LTP", n, res, pref)
    assert not S.tag_correct_precursor_flank("", n, res, pref)
