from pathlib import Path

import pytest
import yaml

from fastag_bench.config import ConfigError, load_datasets, parse_bench_config, parse_datasets, select
from fastag_bench.tsv import read_tsv, write_tsv
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

GOOD = {"datasets": [{"id": "x", "pxd": "PXD000001", "species": "E. coli", "instrument": "QE",
                      "experiments": ["ground_truth"], "enzyme": "Trypsin",
                      "files": [{"name": "a.raw", "role": "raw", "url": "https://x/a.raw",
                                 "sha1": "871d4cfeb716ec00e944aab6d9da2eab4d24167b"}]}]}


def test_shipped_datasets_yaml_is_valid_and_public():
    ds = load_datasets(ROOT / "datasets.yaml")
    assert len(ds) >= 10
    assert all(d.pxd.startswith("PXD") for d in ds)
    for d in ds:
        assert d.file("mzml") is not None, d.id
        for f in d.files:
            assert f.url or f.derived_from, (d.id, f.name)
            if f.url:
                assert f.url.startswith("https://ftp.pride.ebi.ac.uk/"), f.url


def test_parse_good_and_string_enzyme():
    (d,) = parse_datasets(GOOD)
    assert d.enzyme == ["Trypsin"] and d.file("raw").name == "a.raw" and d.file("mzml") is None


@pytest.mark.parametrize("mutate,msg", [
    (lambda g: g["datasets"][0].update(pxd="MSV000096674"), "not a ProteomeXchange"),
    (lambda g: g["datasets"][0].pop("species"), "missing 'species'"),
    (lambda g: g["datasets"][0]["files"][0].update(role="video"), "unknown role"),
    (lambda g: g["datasets"][0]["files"][0].update(sha256="abc"), "sha256"),
    (lambda g: g["datasets"].append(dict(g["datasets"][0])), "duplicate id"),
])
def test_parse_rejects(mutate, msg):
    g = yaml.safe_load(yaml.safe_dump(GOOD))
    mutate(g)
    with pytest.raises(ConfigError, match=msg):
        parse_datasets(g)


def test_select():
    ds = parse_datasets(GOOD)
    assert select(ds, ["PXD000001"]) == ds
    assert select(ds, experiment="species") == []
    with pytest.raises(ConfigError):
        select(ds, ["PXD999999"])


def test_bench_config_defaults_merge_and_env(monkeypatch):
    monkeypatch.setenv("FB_TEST_DIR", "/tmp/fb")
    cfg = parse_bench_config({"work_dir": "$FB_TEST_DIR/work", "fastag": {"threads": 8}, "score": {"ks": [10, 1, 1]}})
    assert cfg["work_dir"] == "/tmp/fb/work"
    assert cfg["fastag"]["threads"] == [8]
    assert cfg["fastag"]["reps"] == 3            # default kept
    assert cfg["tools"]["sage"] == "sage"        # default kept
    assert cfg["score"]["ks"] == [1, 10]


@pytest.mark.parametrize("bad", [{"fastag": {"threads": [0]}}, {"fastag": {"reps": 0}}, {"sage": {"fdr": 1.5}}])
def test_bench_config_rejects(bad):
    with pytest.raises(ConfigError):
        parse_bench_config(bad)


def test_example_configs_parse():
    for p in (ROOT / "config").glob("*.yaml"):
        parse_bench_config(yaml.safe_load(p.read_text()))


def test_tsv_provenance_roundtrip(tmp_path):
    p = write_tsv(pd.DataFrame({"a": [1, 2], "b": ["x", "y"]}), tmp_path / "t.tsv", ["source: test", "second"])
    df, prov = read_tsv(p)
    assert prov == ["source: test", "second"] and list(df["a"]) == [1, 2]


def test_shipped_results_have_provenance():
    for p in (ROOT / "results").glob("*.tsv"):
        df, prov = read_tsv(p)
        assert prov and prov[0].startswith("source"), p.name
        assert len(df) > 0, p.name


def test_public_runs_manifest_covers_every_collection_run():
    """Every species and digest-validation run has a public PRIDE file in config/public_runs.tsv."""
    man = pd.read_csv(ROOT / "config" / "public_runs.tsv", sep="\t", comment="#", dtype=str).fillna("")
    assert (man["match"] != "none").all()
    assert man["pxd"].str.match(r"^PXD\d{6}$").all()
    assert man["url"].str.startswith("https://ftp.pride.ebi.ac.uk/").all()
    sp = pd.read_csv(ROOT / "config" / "species_runs.tsv", sep="\t", comment="#", dtype=str)
    dg = pd.read_csv(ROOT / "results" / "sdrf_truth_runs.tsv", sep="\t", comment="#", dtype=str)
    have = set(man["run_id"])
    assert set(sp["run_id"]) <= have
    assert set(dg["acc"] + "_" + dg["run"]) <= have


def test_derived_inputs_have_checksums():
    """Every derived file used for a reported number has a sha256 (except the documented exceptions)."""
    ds = load_datasets(ROOT / "datasets.yaml")
    used = {"PXD000001", "PXD003531", "PXD076528", "PXD054073", "PXD001819", "PXD047793", "PXD028735"}
    for d in ds:
        if d.pxd not in used:
            continue
        for f in d.files:
            if f.role in ("mzml", "mzpeak", "peak") and not f.url:
                assert f.sha256, (d.id, f.name)
