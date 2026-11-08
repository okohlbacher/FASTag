"""#4: ProteomeTools (PXD004732) file list and pool peptide lists."""
import pytest

from fastag_bench import proteometools as PT

BASE = "ftp://ftp.pride.ebi.ac.uk/pride/data/archive/2017/02/PXD004732/"


def _f(name, cat, size=100, sha1="a" * 40):
    return {"fileName": name, "fileCategory": {"value": cat}, "fileSizeBytes": size, "checksum": sha1,
            "publicFileLocations": [{"name": "FTP Protocol", "value": BASE + name}]}


FILES = [
    _f("01625b_GF4-TUM_first_pool_30_01_01-3xHCD-1h-R1.raw", "RAW", 790),
    _f("01625b_GF4-TUM_first_pool_30_01_01-ETD-1h-R2.raw", "RAW", 430),
    _f("01625b_GF4-TUM_first_pool_30_01_01-DDA-1h-R2.raw", "RAW", 760),
    _f("01625b_GF4-TUM_first_pool_30_01_01-2xIT_2xHCD-1h-R1.raw", "RAW", 870),
    _f("TUM_first_pool_30_01_01_3xHCD-1h-R1-tryptic.zip", "SEARCH", 28),
    _f("TUM_first_pool_30_01_01_ETD-1h-R2-tryptic.zip", "SEARCH", 20),
    _f("TUM_first_pool_30_01_01_3xHCD-1h-R1-unspecific.zip", "SEARCH", 40),
    _f("01748a_BD1-TUM_second_pool_10_02_01-3xHCD-1h-R1.raw", "RAW", 700),
    _f("01812a_GA3-TUM_third_pool_1_01_01-3xHCD-1h-R1.raw", "RAW", 700),
    _f("TUM_second_pool_129_01_01_2xIT_2xHCD-1h-tryptic.zip", "SEARCH", 20),  # deposited without -R<rep>
    _f("sdrf.tsv", "EXPERIMENTAL DESIGN", 5),
]


def test_parse_files():
    df = PT.parse_files(FILES)
    raw = df[df["kind"] == "raw"].set_index("file")
    r = raw.loc["01625b_GF4-TUM_first_pool_30_01_01-3xHCD-1h-R1.raw"]
    assert (r["set"], r["num"], r["pool"], r["repeat"], r["batch"], r["well"], r["method"], r["rep"]) == (
        "TUM_first_pool", 30, "TUM_first_pool_30", "01_01", "01625b", "GF4", "3xHCD", 1)
    assert r["url"].startswith("https://ftp.pride.ebi.ac.uk/") and r["sha1"] == "a" * 40
    assert raw.loc["01748a_BD1-TUM_second_pool_10_02_01-3xHCD-1h-R1.raw", "repeat"] == "02_01"
    assert raw.loc["01812a_GA3-TUM_third_pool_1_01_01-3xHCD-1h-R1.raw", "set"] == "TUM_third_pool"
    z = df[df["kind"] == "search"].set_index("file")
    assert z.loc["TUM_first_pool_30_01_01_3xHCD-1h-R1-tryptic.zip", "search"] == "tryptic"
    assert z.loc["TUM_first_pool_30_01_01_3xHCD-1h-R1-unspecific.zip", "search"] == "unspecific"
    assert z.loc["TUM_first_pool_30_01_01_ETD-1h-R2-tryptic.zip", "method"] == "ETD"
    assert z.loc["TUM_second_pool_129_01_01_2xIT_2xHCD-1h-tryptic.zip", "rep"] == 0
    assert "sdrf.tsv" not in set(df["file"])


def test_parse_files_rejects_unknown_raw_names():
    with pytest.raises(ValueError):
        PT.parse_files([_f("weird_name.raw", "RAW")])


def test_pool_table():
    pt = PT.pool_table(PT.parse_files(FILES)).set_index("pool")
    p = pt.loc["TUM_first_pool_30"]
    assert p["batch"] == "01625b" and p["raw_3xhcd"] == "01625b_GF4-TUM_first_pool_30_01_01-3xHCD-1h-R1.raw"
    assert p["n_raw"] == 4 and p["repeats"] == "01_01"
    assert sorted(p["zips"].split(";")) == ["TUM_first_pool_30_01_01_3xHCD-1h-R1-tryptic.zip",
                                           "TUM_first_pool_30_01_01_ETD-1h-R2-tryptic.zip"]
    assert pt.loc["TUM_second_pool_10", "repeats"] == "02_01"


PEPTIDES_TXT = ("Sequence\tProteins\tLeading razor protein\tReverse\tPotential contaminant\n"
                "AAASGSVLQR\tTUM_first_pool_30\tTUM_first_pool_30\t\t\n"
                "AAASPPTPIR\tTUM_first_pool_30\tTUM_first_pool_30\t\t\n"
                "AAASPPTPIR\tTUM_first_pool_30\tTUM_first_pool_30\t\t\n"
                "LGEHNIDVLEGNEQFINAAK\tCON__P02769\tCON__P02769\t\t+\n"
                "KRIPEDKLAA\tREV__TUM_first_pool_30\tREV__TUM_first_pool_30\t+\t\n"
                "TTVDLSPEK\tRTQC;TUM_first_pool_30\tRTQC\t\t\n"
                "GLSDGEWQQVLNVWGK\tsp|P68082\tsp|P68082\t\t\n")


def test_maxquant_pool_peptides(tmp_path):
    p = tmp_path / "peptides.txt"
    p.write_text(PEPTIDES_TXT)
    assert PT.maxquant_pool_peptides(p, "TUM_first_pool_30") == {"AAASGSVLQR", "AAASPPTPIR", "TTVDLSPEK"}
    assert PT.maxquant_pool_peptides(p, "TUM_first_pool_3") == set()  # no prefix matches


def test_default_plan_seeds():
    seeds = {s["split"]: s["seed"] for s in PT.DEFAULT_PLAN}
    assert seeds == {"dev": 1, "test": 2, "f7train": 3, "f7test": 4, "final": 5,
                     "reserved_2": 6, "reserved_15": 7, "reserved_16": 8}
    n = {s["split"]: s["n"] for s in PT.DEFAULT_PLAN}
    assert n["dev"] == 3 and n["test"] == 10
    for s in PT.DEFAULT_PLAN:
        if s["split"] in ("f7train", "f7test", "final"):
            assert set(s["exclude_batches_of"]) == {"dev", "test"}
