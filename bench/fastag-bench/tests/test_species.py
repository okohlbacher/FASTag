from pathlib import Path

import pandas as pd
import pytest

from fastag_bench import species as SP

ROOT = Path(__file__).resolve().parents[1]


def test_parse_truth():
    assert SP.parse_truth("Homo=0.65;Escherichia=0.05") == {"Homo": 0.65, "Escherichia": 0.05}
    assert SP.parse_truth("Homo;Mus") == {"Homo": None, "Mus": None}


def test_manifest_and_universe():
    man = SP.load_manifest(ROOT / "config" / "species_runs.tsv")
    assert len(man) >= 40 and man["run_id"].is_unique
    uni = SP.load_universe(ROOT / "config" / "species_universe.txt")
    assert len(uni) == 50 and "Homo" in uni and "Saccharomyces" in uni
    # every in-index truth genus is spelled as in the index
    for t in man["truth"]:
        for g in SP.parse_truth(t):
            assert g[0].isupper() and " " not in g


def _species(rows):
    df = pd.DataFrame(rows, columns=["rank", "taxid", "name", "observed", "adjusted", "expected", "log_pvalue", "qvalue"])
    df["fastag_rank"] = range(1, len(df) + 1)
    return df


def test_genus_table_rules_and_confusion():
    uni = ["Homo", "Macaca", "Escherichia", "Sus", "Danio"]
    default = _species([("genus", 1, "Homo", 100, 100, 10, -50, 0.0), ("genus", 2, "Macaca", 90, 90, 10, -40, 0.0),
                        ("genus", 3, "Escherichia", 5, 5, 4, -1, 0.2), ("genus", 4, "Sus", 20, 20, 5, -9, 0.0)])
    deconv = _species([("genus", 1, "Homo", 100, 80, 10, -50, 0.0), ("genus", 2, "Escherichia", 5, 15, 4, -1, 0.2),
                       ("genus", 3, "Macaca", 90, 4, 10, -40, 0.0), ("genus", 4, "Sus", 20, 1, 5, -9, 0.0)])
    up = pd.DataFrame({"genus": ["Homo", "Escherichia", "Shigella"], "unipept_peptides": [50, 10, 2],
                       "unipept_share": [50 / 62, 10 / 62, 2 / 62], "unipept_rank": [1, 2, 3]})
    t = SP.genus_table(uni, {"Homo": 0.9, "Escherichia": 0.1}, {"default": default, "deconv": deconv}, up)
    row = t.set_index("genus")
    assert row.loc["Sus", "status"] == "excluded"
    assert row.loc["Shigella", "in_index"] == False  # noqa: E712
    assert row.loc["Escherichia", "call_fastag_q"] == False  # noqa: E712 (q 0.2)
    assert row.loc["Escherichia", "call_fastag_dec"] == True  # noqa: E712 (15/100)
    assert row.loc["Danio", "observed"] == 0 and pd.isna(row.loc["Danio", "rank_default"])
    c = SP.confusion(t, "call_fastag_q")
    assert (c["tp"], c["fn"], c["fp"], c["tn"]) == (1, 1, 1, 1)
    c = SP.confusion(t, "call_unipept")
    assert (c["tp"], c["fp"], c["fp_outside_index"]) == (2, 0, 0)  # Shigella: 2 peptides < 3
    assert SP.rates({"tp": 1, "fn": 1, "fp": 0, "tn": 3}) == {"sensitivity": 0.5, "specificity": 1.0}


def test_kappa():
    assert SP.cohen_kappa([True, False, True, False], [True, False, True, False]) == 1.0
    assert SP.cohen_kappa([True, True, False, False], [True, False, True, False]) == 0.0


def test_pept2lca_genus_fill(tmp_path):
    p = tmp_path / "lca.csv"
    p.write_text("peptide,taxon_id,taxon_name,taxon_rank,genus_id,genus_name\n"
                 "AAA,9606,Homo sapiens,species,9605,Homo\n"
                 "BBB,561,Escherichia,genus,,\n"
                 "CCC,40674,Mammalia,class,,\n")
    c = SP.unipept_genus_counts(SP.read_pept2lca(p)).set_index("genus")
    assert c.loc["Homo", "unipept_peptides"] == 1 and c.loc["Escherichia", "unipept_peptides"] == 1
    assert len(c) == 2


def test_sage_peptides(tmp_path):
    p = tmp_path / "r.tsv"
    p.write_text("peptide\tlabel\tspectrum_q\tpeptide_q\n"
                 "PEPTM[+15.9949]IDEK\t1\t0.001\t0.001\nPEPTMIDEK\t1\t0.002\t0.002\n"
                 "DECOYPEPK\t-1\t0.001\t0.001\nLATEPEPK\t1\t0.5\t0.001\n")
    assert SP.sage_peptides(p) == ["PEPTMIDEK"]


def test_ms2_analyzer(tmp_path):
    p = tmp_path / "x.mzML"
    p.write_text('<cvParam name="filter string" value="FTMS + p NSI Full ms [350-1800]"/>\n'
                 + '<cvParam name="filter string" value="ITMS + c NSI d Full ms2 500.1@cid35.00 [125-1500]"/>\n' * 3)
    assert SP.ms2_analyzer(p) == "ITMS"
    q = tmp_path / "y.mzML"  # ThermoRawFileParser attribute order
    q.write_text('<cvParam cvRef="MS" accession="MS:1000512" value="ITMS + c NSI d Full ms2 500.1@cid35.00" name="filter string" />\n')
    assert SP.ms2_analyzer(q) == "ITMS"


def test_fastag_cmd_labels(tmp_path):
    cmd = SP.fastag_cmd("FASTag", "a.mzML", tmp_path, "deconv", "TMTpro", "ITMS", 8)
    assert "-species_deconvolve" in cmd and "TMTpro (K)" in cmd and "0.3" in cmd
    with pytest.raises(KeyError):
        SP.fastag_cmd("FASTag", "a.mzML", tmp_path, "nope", "LF", "FTMS", 8)
