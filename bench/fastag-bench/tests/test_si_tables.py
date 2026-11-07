import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "si_tables.py"


def _mod():
    spec = importlib.util.spec_from_file_location("si_tables", SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_table_s7_marks_lower_bounds(tmp_path):
    pytest.importorskip("openpyxl")
    cells = _mod().table_s7(ROOT / "results", tmp_path)
    sampled = cells["sampled_peak_mb"].notna()
    assert sampled.any() and (~sampled).any()
    assert (cells.loc[sampled, "peak_memory_mb"] == cells.loc[sampled, "sampled_peak_mb"]).all()
    assert (cells.loc[~sampled, "peak_memory_basis"] == "ru_maxrss, lower bound").all()
    # a sampled peak is never below ru_maxrss of the same runs
    assert (cells.loc[sampled, "sampled_over_ru_maxrss"] >= 0.99).all()


def test_workbooks_have_readme_and_sheets(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    p = subprocess.run([sys.executable, str(SCRIPT), "--out", str(tmp_path), "--only", "S2,S3,S4,S6,S7"],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    for t in ("S2", "S3", "S4", "S6", "S7"):
        wb = openpyxl.load_workbook(tmp_path / f"Table_{t}.xlsx", read_only=True)
        assert wb.sheetnames[0] == "README" and len(wb.sheetnames) > 1
        assert str(wb["README"]["A1"].value).startswith(f"Table {t}.")


def test_si_markdown_lists_figures_and_tables(tmp_path):
    p = subprocess.run([sys.executable, str(SCRIPT), "--out", str(tmp_path), "--only", "PDF", "--no-pdf"],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    md = (tmp_path / "FASTag-JPR-SI-figures-tables.md").read_text()
    for k in ("Figure S1.", "Figure S2.", "Figure S3.", "Figure S4.", "Table S1.", "Table S5."):
        assert f"**{k}**" in md, k
    assert md.count("PASS") == 19  # one row per compared output of the nine gate cases
    assert "](Figure_S1.pdf)" in md and str(tmp_path) not in md  # figures by relative path
    assert "27,345 MS2 spectra" in md and "27345" not in md  # thousands separators in Table S1


def test_species_data_sets_one_row_per_accession(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    _mod().table_s3(ROOT / "results", tmp_path)
    import pandas as pd
    ds = pd.read_excel(tmp_path / "Table_S3.xlsx", sheet_name="data_sets")
    runs = pd.read_excel(tmp_path / "Table_S3.xlsx", sheet_name="runs")
    assert ds["pxd"].is_unique and set(ds["pxd"]) == set(runs["pxd"]) and ds["runs"].sum() == len(runs)
