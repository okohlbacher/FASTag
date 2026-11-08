"""#4 (FASTag 1.12, cluster F): the two evaluation axes of a spectrum.

Axis 1, identification:
    S0     identified by the closed full-database Sage search at the harness FDR (the v1.9.0 scored set);
    S3-PT  a ProteomeTools pool spectrum that the closed search does not identify;
    S5     everything else (no label).
Axis 2, chimericity:
    none, or 'synthetic-mix:<ratio>' for a synthetic S4 chimera built from two parents (chimera.py).

The axes are independent columns, not one stratum with a precedence: an S0 spectrum that is also a
chimera parent stays S0 in its own row, and its chimeras are separate rows that carry the
identification of their dominant parent (parent1).
"""
from __future__ import annotations

import pandas as pd

IDENTIFICATION = ("S0", "S3-PT", "S5")
CHIMERICITY_NONE = "none"


def chimericity_label(ratio: float) -> str:
    return f"synthetic-mix:{float(ratio):g}"


def assign_axes(spectra: pd.DataFrame, s0_keys: set, pt_keys: set | None = None,
                chimeras: pd.DataFrame | None = None) -> pd.DataFrame:
    """One row per spectrum (and per chimera) with columns key, identification, chimericity, parent1,
    parent2, ratio.

    spectra: one row per spectrum of the run, column 'key' (parsers.spectrum_key); keys must be unique.
    s0_keys: keys identified by the closed search. pt_keys: keys of ProteomeTools pool spectra (None for
    lysate runs, which then have no S3-PT). chimeras: columns key, parent1, parent2, ratio (parents must
    be spectra of the run)."""
    keys = spectra["key"].astype(str)
    if not keys.is_unique:
        raise ValueError("assign_axes: duplicate spectrum keys")
    s0 = set(map(str, s0_keys))
    pt = set(map(str, pt_keys)) if pt_keys is not None else set()

    def ident(k: str) -> str:
        if k in s0:
            return "S0"
        if k in pt:
            return "S3-PT"
        return "S5"

    base = pd.DataFrame({"key": keys.to_numpy(), "identification": [ident(k) for k in keys],
                         "chimericity": CHIMERICITY_NONE, "parent1": "", "parent2": "", "ratio": float("nan")})
    if chimeras is None or chimeras.empty:
        return base
    known = set(keys)
    bad = sorted((set(chimeras["parent1"].astype(str)) | set(chimeras["parent2"].astype(str))) - known)
    if bad:
        raise ValueError(f"assign_axes: chimera parents not in the run: {bad[:5]}")
    if set(chimeras["key"].astype(str)) & known:
        raise ValueError("assign_axes: chimera keys collide with spectrum keys")
    lab = dict(zip(base["key"], base["identification"]))
    ch = pd.DataFrame({"key": chimeras["key"].astype(str).to_numpy(),
                       "identification": [lab[p] for p in chimeras["parent1"].astype(str)],
                       "chimericity": [chimericity_label(r) for r in chimeras["ratio"]],
                       "parent1": chimeras["parent1"].astype(str).to_numpy(),
                       "parent2": chimeras["parent2"].astype(str).to_numpy(),
                       "ratio": chimeras["ratio"].astype(float).to_numpy()})
    return pd.concat([base, ch], ignore_index=True)
