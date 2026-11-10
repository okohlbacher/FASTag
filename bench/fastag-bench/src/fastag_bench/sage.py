"""Generate a Sage configuration (the ground-truth search) from a dataset entry."""
from __future__ import annotations

import json
from pathlib import Path

from .config import Dataset

# Sage cleave_at/restrict per enzyme class; Trypsin with Lys-C searches as Trypsin.
ENZYMES = {
    "Trypsin": ("KR", "P"),
    "Lys-C": ("K", "P"),
    "Arg-C": ("R", "P"),
    "Glu-C": ("E", None),
    "Asp-N": ("D", None),  # Sage cleaves C-terminal of the site; Asp-N needs c_terminal false
    "Chymotrypsin": ("FWYL", "P"),
    "unspecific": ("", None),  # empty cleave_at = non-specific digest in Sage
}


SAGE_MODES = ("closed", "pool", "charge_truth", "chimera")
CHIMERA_REPORT_PSMS = 2


def sage_config(ds: Dataset, fasta: str | Path, mzml: list[str | Path], scfg: dict, mode: str = "closed",
                pool_fasta: str | Path | None = None) -> dict:
    """Sage configuration. Per-dataset 'search' keys in datasets.yaml override the config defaults:
    precursor_ppm, fragment_ppm or fragment_da (symmetric), missed_cleavages, max_variable_mods,
    variable_mods (Sage keys: residues, '^' peptide N-term, '[' protein N-term), deisotope,
    no_proline_rule (Trypsin/P: cleave before P too).

    mode 'closed' (default) is the v1.9.0 ground-truth search, byte-identical (tests/test_sage.py golden
    JSON). mode 'pool' (#4 S3-PT) searches pool_fasta, one entry per pool peptide plus the shuffled decoy
    pool (pooltruth.write_pool_fasta), without digestion (cleave_at '$', no missed cleavages); everything
    else, Sage's own reversed decoys included, is the closed search. mode 'charge_truth' (#6) is the
    closed search with precursor_charge [1, 4] and isotope_errors [-1, 3]. mode 'chimera' (1.13 item 12,
    realchimera.py) is the closed search with Sage's chimera search on (after the best hit Sage removes its
    matched fragment peaks and searches the rest again), wide_window on (the precursor tolerance becomes the
    spectrum's isolation window, so a co-isolated peptide other than the header precursor can match) and
    report_psms 2 (rank 1 and the chimeric rank 2). The backlog mode 'open' (precursor_tol da [-500, 150])
    is not implemented."""
    if mode not in SAGE_MODES:
        raise ValueError(f"Sage mode {mode!r}: one of {SAGE_MODES}")
    if mode == "charge_truth":
        # #6 truth: the closed search with precursor charges 1..4 and isotope errors -1..3, so
        # each PSM's charge and isotope_error label its spectrum (read_sage_psms truth_fields).
        cfg = sage_config(ds, fasta, mzml, scfg, mode="closed")
        cfg["precursor_charge"] = [1, 4]
        cfg["isotope_errors"] = [-1, 3]
        return cfg
    if mode == "chimera":
        cfg = sage_config(ds, fasta, mzml, scfg, mode="closed")
        cfg["chimera"] = True
        cfg["wide_window"] = True
        cfg["report_psms"] = CHIMERA_REPORT_PSMS
        return cfg
    if mode == "pool":
        if pool_fasta is None:
            raise ValueError("Sage mode 'pool' needs pool_fasta")
        cfg = sage_config(ds, pool_fasta, mzml, scfg, mode="closed")
        cfg["database"]["enzyme"] = {"missed_cleavages": 0, "min_len": int(scfg["min_len"]),
                                     "max_len": int(scfg["max_len"]), "cleave_at": "$"}
        return cfg
    from .score import expected_protease

    sr = ds.search or {}
    scfg = {**scfg, **{k: sr[k] for k in ("missed_cleavages", "max_variable_mods", "precursor_ppm", "fragment_ppm")
                       if k in sr}}
    enz = expected_protease(ds.enzyme) or "Trypsin"
    cleave, restrict = ENZYMES.get(enz, ENZYMES["Trypsin"])
    if sr.get("no_proline_rule"):
        restrict = None
    enzyme = {"missed_cleavages": int(scfg["missed_cleavages"]), "min_len": int(scfg["min_len"]),
              "max_len": int(scfg["max_len"]), "cleave_at": cleave}
    if restrict:
        enzyme["restrict"] = restrict
    if enz == "Asp-N":
        enzyme["c_terminal"] = False
    cfg = {
        "database": {
            "bucket_size": 32768,
            "enzyme": enzyme,
            "fragment_min_mz": 150.0, "fragment_max_mz": 2000.0,
            "peptide_min_mass": 500.0, "peptide_max_mass": 5000.0,
            "ion_kinds": ["b", "y"], "min_ion_index": 2,
            "static_mods": {k: float(v) for k, v in (ds.fixed_mods or {"C": 57.021464}).items()},
            "variable_mods": {k: [float(x) for x in (v if isinstance(v, list) else [v])]
                              for k, v in (sr.get("variable_mods") or ds.variable_mods or {"M": [15.994915]}).items()},
            "max_variable_mods": int(scfg["max_variable_mods"]),
            "decoy_tag": scfg["decoy_tag"], "generate_decoys": True,
            "fasta": str(fasta),
        },
        "precursor_tol": {"ppm": [-float(scfg["precursor_ppm"]), float(scfg["precursor_ppm"])]},
        "fragment_tol": ({"da": [-float(sr["fragment_da"]), float(sr["fragment_da"])]} if "fragment_da" in sr
                         else {"ppm": [-float(scfg["fragment_ppm"]), float(scfg["fragment_ppm"])]}),
        "isotope_errors": [0, 1],
        "deisotope": bool(sr.get("deisotope", True)), "chimera": False, "wide_window": False,
        "predict_rt": True, "min_peaks": 15, "max_peaks": 150, "report_psms": 1,
        "mzml_paths": [str(p) for p in mzml],
    }
    return cfg


def write_sage_config(path: str | Path, cfg: dict) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2) + "\n")
    return path
