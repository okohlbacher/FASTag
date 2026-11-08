import math

import pandas as pd
import pytest

from fastag_bench import denovo as D


def test_parse_notations_agree():
    sage = D.parse_peptide("[+42.0106]-AC[+57.0215]M[+15.9949]K")
    pro = D.parse_peptide("[Acetyl]-AC[Carbamidomethyl]M[Oxidation]K")
    uni = D.parse_peptide("[UNIMOD:1]AC[UNIMOD:4]M[UNIMOD:35]K")
    pn = D.parse_peptide("AC+57M+16K", ngap=42.0106)
    nov = D.parse_peptide("AC(Cam)M(O)K", ngap=42.010565)
    for p in (pro, uni, pn, nov):
        assert p.plain == "ACMK"
        assert math.isclose(p.nterm, sage.nterm, abs_tol=0.01)
        assert all(math.isclose(a, b, abs_tol=0.01) for a, b in zip(p.masses, sage.masses))


def test_novor_terminal_mod():
    p = D.parse_peptide("(N-term|TMT6)RATK(TMT6)C(Mth)")
    assert p.plain == "RATKC"
    assert math.isclose(p.nterm, 229.162932) and math.isclose(p.masses[3], 128.094963 + 229.162932)
    assert math.isclose(p.masses[4], 103.009185 + 45.987721)


def test_combined_and_unknown_mod():
    p = D.parse_peptide("[+43.006-17.027]-QK")
    assert math.isclose(p.nterm, 25.979, abs_tol=1e-3)
    with pytest.raises(ValueError):
        D.parse_peptide("AX[Frobnication]K")


def test_derive_tags_masses_and_rank():
    pep = D.parse_peptide("PEPTIDEK")
    tags = D.derive_tags(pep, 3)
    assert [t["tag"] for t in tags] == ["PEP", "EPT", "PTI", "TID", "IDE", "DEK"]
    total = sum(pep.masses)
    for t in tags:
        mid = sum(pep.masses[t["start"]:t["start"] + 3])
        assert math.isclose(t["nterm_mass"] + mid + t["cterm_mass"], total, abs_tol=1e-4)
    pred = pd.DataFrame({"key": ["scan=1"], "peptide": ["PEPTIDEK"], "score": [0.9],
                         "aa_scores": [[0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.2, 0.2]]})
    t = D.tags_from_predictions(pred, 3)
    assert t.loc[t["rank"] == 1, "tag"].item() == "TID"


def test_flank_rule():
    truth = D.parse_peptide("AAPEPTIDEK")
    ok = D.parse_peptide("AAPEPTIDEK")
    t = D.derive_tags(ok, 3)[2]  # PEP at the same position
    assert D.flank_correct(t["tag"], t["nterm_mass"], t["cterm_mass"], truth) == (True, True)
    # same residues, both flanks wrong: lenient only
    assert D.flank_correct("PEP", 500.0, 900.0, truth) == (True, False)
    # one flank right is enough
    assert D.flank_correct("PEP", t["nterm_mass"], 1.0, truth) == (True, True)
    # I = L
    assert D.flank_correct("PTL", 0, 0, truth)[0]
    # reversed reading (y ladder read as b): prediction prefix = truth suffix + H2O
    ts = sum(truth.masses[8:])           # after "TID" (positions 5-7)
    assert D.flank_correct("DIT", ts + D.WATER, 1.0, truth) == (True, True)
    assert D.flank_correct("DIT", ts, 1.0, truth) == (True, False)
    assert D.flank_correct("WWW", 0, 0, truth) == (False, False)


def test_metrics_and_peptides():
    psms = pd.DataFrame({"key": ["scan=1", "scan=2"], "peptide": ["AAPEPTIDEK", "M[+15.9949]ASTER"]})
    pred = pd.DataFrame({"key": ["scan=1", "scan=2"], "peptide": ["AAPEPTLDEK", "MASTER"], "score": [1, 1],
                         "aa_scores": [None, None]})
    pm = D.peptide_metrics(pred, psms)
    assert pm["peptide_exact"] == 2 and pm["peptide_exact_mods"] == 1
    m = D.mark(D.tags_from_predictions(pred, 3), psms)
    assert m["sequence"].all()
    # every MASTER window has a flank that includes the oxidised M (prefix) or not (suffix): suffix agrees
    assert m["flank"].all()
    r = D.tag_metrics(m, 2, "flank", ks=(1, 5))
    assert r["top1_precision"] == 1.0 and r["psm_spectra_tagged"] == 2
    assert D.rank_curve(m, "flank", 2, 5)["rate"].iloc[0] == 1.0


def test_read_pepnovo(tmp_path):
    f = tmp_path / "pn.txt"
    f.write_text(">> 0 0 controllerType=0 controllerNumber=1 scan=17\n"
                 "#Index\tRnkScr\tPnvScr\tN-Gap\tC-Gap\t[M+H]\tCharge\tSequence\n"
                 "0\t5.1\t60.2\t0.000\t0.000\t1000.5\t2\tPEPM+16K\n"
                 "1\t4.0\t55.0\t0.000\t0.000\t1000.5\t2\tPEPMK\n"
                 ">> 0 1 controllerType=0 controllerNumber=1 scan=18\n"
                 "#Index\tRnkScr\tPnvScr\tN-Gap\tC-Gap\t[M+H]\tCharge\tSequence\n"
                 "0\t5.1\t40.0\t228.100\t0.000\t1000.5\t2\tLLK\n")
    df = D.read_pepnovo(f)
    assert list(df["key"]) == ["scan=17", "scan=18"]
    assert df["peptide"].iloc[0] == "PEPM+16K" and math.isclose(df["ngap"].iloc[1], 228.1)
    assert df["ngap"].iloc[0] == 0.0


def test_pepnovo_nterm_caret():
    p = D.parse_peptide("S^+229GTE")
    assert math.isclose(p.nterm, 229.162932) and math.isclose(p.masses[0], 87.032028)


def test_read_instanovo_maps_index(tmp_path):
    mgf = tmp_path / "x.mgf"
    mgf.write_text("BEGIN IONS\nTITLE=a scan=5\nSCANS=5\nEND IONS\nBEGIN IONS\nTITLE=b scan=9\nSCANS=9\nEND IONS\n")
    csv = tmp_path / "p.csv"
    csv.write_text('scan_number,spectrum_id,predictions,log_probs,token_log_probs\n'
                   '1,X:1,PEPK,-1.0,"[-0.1, -0.2, -0.3, -0.4]"\n0,X:0,,-9,[]\n')
    df = D.read_instanovo(csv, mgf)
    assert list(df["key"]) == ["scan=9"] and df["aa_scores"].iloc[0] == [-0.1, -0.2, -0.3, -0.4]


def test_flank_rule_matches_score_module():
    """denovo.flank_correct and score.tag_correct_flank agree on Sage-notation peptides."""
    from fastag_bench import score as S
    pep = "[+229.1629]-AAPEPC[+57.0215]TIDEK[+229.1629]"
    truth = D.parse_peptide(pep)
    res, pref, total = S.peptide_masses(pep)
    pre = D._flanks(truth)
    cases = [("TID", pre[6], 3.0), ("TID", 1.0, sum(truth.masses[9:])), ("TID", 2.0, 2.0),
             ("DIT", sum(truth.masses[9:]) + D.WATER, 5.0), ("DIT", 5.0, pre[6] - D.WATER), ("DIT", 5.0, pre[6])]
    for tag, n, c in cases:
        assert D.flank_correct(tag, n, c, truth)[1] == S.tag_correct_flank(tag, n, c, res, pref, total), (tag, n, c)


def test_fastag_mgf_keys(tmp_path):
    from fastag_bench import parsers as P
    mgf = tmp_path / "x.mgf"
    mgf.write_text("BEGIN IONS\nTITLE=c scan=5\nEND IONS\nBEGIN IONS\nTITLE=c scan=9\nSCANS=9\nEND IONS\n")
    tsv = tmp_path / "tags.tsv"
    tsv.write_text("spectrum\ttag\nindex=1\tPEP\nindex=1\tEPK\nindex=0\tAAA\n")
    tags = D.fastag_mgf_keys(P.read_fastag_tags(tsv), mgf)
    assert list(tags["key"]) == ["scan=9", "scan=9", "scan=5"] and list(tags["rank"]) == [1, 2, 1]
    tsv.write_text("spectrum\ttag\nindex=2\tPEP\n")
    with pytest.raises(ValueError):
        D.fastag_mgf_keys(P.read_fastag_tags(tsv), mgf)
