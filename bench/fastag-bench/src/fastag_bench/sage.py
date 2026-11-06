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


def sage_config(ds: Dataset, fasta: str | Path, mzml: list[str | Path], scfg: dict) -> dict:
    """Sage configuration. Per-dataset 'search' keys in datasets.yaml override the config defaults:
    precursor_ppm, fragment_ppm or fragment_da (symmetric), missed_cleavages, max_variable_mods,
    variable_mods (Sage keys: residues, '^' peptide N-term, '[' protein N-term), deisotope,
    no_proline_rule (Trypsin/P: cleave before P too)."""
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
