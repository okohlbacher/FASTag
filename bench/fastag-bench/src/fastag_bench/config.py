"""Parse and validate datasets.yaml and the benchmark configuration."""
from __future__ import annotations

import copy
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

PXD_RE = re.compile(r"^PXD\d{6}$")
HEX = {"sha256": 64, "sha1": 40, "md5": 32}
FILE_ROLES = {"raw", "mzml", "mzpeak", "peak", "search", "fasta", "sdrf"}


class ConfigError(ValueError):
    pass


@dataclass
class DataFile:
    name: str
    role: str
    url: str | None = None
    size: int | None = None
    sha256: str | None = None
    sha1: str | None = None
    derived_from: str | None = None
    conversion: str | None = None
    note: str | None = None


@dataclass
class Dataset:
    id: str
    pxd: str
    species: str
    instrument: str
    experiments: list[str]
    files: list[DataFile]
    expected_genus: str | None = None
    acquisition: str | None = None
    enzyme: list[str] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    fixed_mods: dict[str, float] = field(default_factory=dict)
    variable_mods: dict[str, list[float]] = field(default_factory=dict)
    fragment_tolerance: str | None = None
    precursor_tolerance: str | None = None
    sdrf: str | None = None
    fastag_args: list[str] = field(default_factory=list)
    search: dict[str, Any] = field(default_factory=dict)   # ground-truth search settings (Sage/Comet)
    tagger: dict[str, Any] = field(default_factory=dict)   # tagger settings for the accuracy profiles
    note: str | None = None

    def file(self, role: str) -> DataFile | None:
        for f in self.files:
            if f.role == role:
                return f
        return None


def _check_hex(value: str | None, kind: str, where: str) -> None:
    if value is None:
        return
    if not re.fullmatch(rf"[0-9a-f]{{{HEX[kind]}}}", str(value)):
        raise ConfigError(f"{where}: {kind} must be {HEX[kind]} lowercase hex digits, got {value!r}")


def parse_datasets(doc: dict[str, Any]) -> list[Dataset]:
    if not isinstance(doc, dict) or "datasets" not in doc:
        raise ConfigError("datasets.yaml needs a top-level 'datasets' list")
    out, seen = [], set()
    for i, d in enumerate(doc["datasets"]):
        where = f"datasets[{i}]"
        for key in ("id", "pxd", "species", "instrument", "experiments", "files"):
            if key not in d:
                raise ConfigError(f"{where}: missing '{key}'")
        if not PXD_RE.match(str(d["pxd"])):
            raise ConfigError(f"{where}: '{d['pxd']}' is not a ProteomeXchange PXD accession; only public PXD data")
        if d["id"] in seen:
            raise ConfigError(f"{where}: duplicate id {d['id']}")
        seen.add(d["id"])
        files = []
        for j, f in enumerate(d["files"]):
            fw = f"{where}.files[{j}]"
            if "name" not in f or "role" not in f:
                raise ConfigError(f"{fw}: needs 'name' and 'role'")
            if f["role"] not in FILE_ROLES:
                raise ConfigError(f"{fw}: unknown role {f['role']!r} (one of {sorted(FILE_ROLES)})")
            _check_hex(f.get("sha256"), "sha256", fw)
            _check_hex(f.get("sha1"), "sha1", fw)
            files.append(DataFile(**{k: f.get(k) for k in DataFile.__dataclass_fields__}))
        kw = {k: d[k] for k in Dataset.__dataclass_fields__ if k in d and k != "files"}
        enz = kw.get("enzyme", [])
        kw["enzyme"] = [enz] if isinstance(enz, str) else list(enz or [])
        lab = kw.get("labels", [])
        kw["labels"] = [lab] if isinstance(lab, str) else list(lab or [])
        out.append(Dataset(files=files, **kw))
    return out


def load_datasets(path: str | Path) -> list[Dataset]:
    with open(path) as fh:
        return parse_datasets(yaml.safe_load(fh))


def select(datasets: list[Dataset], ids: list[str] | None = None, experiment: str | None = None) -> list[Dataset]:
    sel = datasets
    if ids:
        known = {d.id for d in datasets} | {d.pxd for d in datasets}
        missing = [i for i in ids if i not in known]
        if missing:
            raise ConfigError(f"unknown dataset(s): {', '.join(missing)}")
        sel = [d for d in sel if d.id in ids or d.pxd in ids]
    if experiment:
        sel = [d for d in sel if experiment in d.experiments]
    return sel


DEFAULTS: dict[str, Any] = {
    "work_dir": "work",
    "data_dir": "data",
    "results_dir": "results",
    "tools": {
        "fastag": "FASTag",
        "sage": "sage",
        "directag": "directag",
        "casanovo": "casanovo",
        "thermorawfileparser": "ThermoRawFileParser",
        "comet": "comet",
    },
    "env": {"OPENBLAS_NUM_THREADS": "1"},
    "mirrors": [],
    "fastag": {"threads": [1, 16, 64], "reps": 3, "args": [], "digest_dir": None,
               "species": {"taxdb": None, "nodes": None, "names": None, "args": ["-extension", "2"]}},
    "sage": {"fdr": 0.01, "threads": None, "fasta": None, "decoy_tag": "rev_",
             "missed_cleavages": 2, "min_len": 7, "max_len": 50,
             "precursor_ppm": 10.0, "fragment_ppm": 20.0, "max_variable_mods": 2,
             "args": [], "version_note": None},
    "comet": {"threads": 32, "version_note": None},
    "accuracy": {"threads": 32, "profiles": ["fastag_default", "fastag_matched", "directag_default", "directag_matched"],
                 "max_k": 50, "sweep_threads": 1, "sweep_reps": 3, "result_tag": "v180",
                 "gap_penalties": [1, 3, 10, 30, 100, 300, 1000, 10000],
                 "peak_budgets": [[0, 25], [0, 50], [0, 100], [0, 200], [0, 400], [0, 800],
                                  [5, 400], [10, 400], [15, 800], [20, 800]]},
    "directag": {"threads": 16, "args": ["-TagLength", "3", "-MaxTagCount", "50", "-MaxPeakCount", "100",
                                         "-FragmentMzTolerance", "0.02", "-PrecursorMzTolerance", "0.02"],
                 "cache_dir": None},
    "casanovo": {"max_spectra": 2000, "model": None, "threads": 16},
    "score": {"ks": [1, 5, 10, 50], "label_share_min": 0.01},
}


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def _expand(v: Any) -> Any:
    if isinstance(v, str):
        return os.path.expandvars(os.path.expanduser(v))
    if isinstance(v, list):
        return [_expand(x) for x in v]
    if isinstance(v, dict):
        return {k: _expand(x) for k, x in v.items()}
    return v


def parse_bench_config(doc: dict[str, Any] | None) -> dict[str, Any]:
    cfg = _expand(_merge(DEFAULTS, doc or {}))
    thr = cfg["fastag"]["threads"]
    if isinstance(thr, int):
        thr = [thr]
    if not thr or not all(isinstance(t, int) and t > 0 for t in thr):
        raise ConfigError("fastag.threads must be a positive integer or a list of them")
    cfg["fastag"]["threads"] = thr
    if not isinstance(cfg["fastag"]["reps"], int) or cfg["fastag"]["reps"] < 1:
        raise ConfigError("fastag.reps must be >= 1")
    fdr = cfg["sage"]["fdr"]
    if not (0 < float(fdr) < 1):
        raise ConfigError("sage.fdr must be in (0, 1)")
    ks = cfg["score"]["ks"]
    if not ks or any(int(k) < 1 for k in ks):
        raise ConfigError("score.ks must be positive integers")
    cfg["score"]["ks"] = sorted({int(k) for k in ks})
    return cfg


def load_bench_config(path: str | Path | None) -> dict[str, Any]:
    if path is None:
        return parse_bench_config(None)
    with open(path) as fh:
        return parse_bench_config(yaml.safe_load(fh))
