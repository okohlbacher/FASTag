"""#4 (FASTag 1.12, cluster F): synthetic S4 chimeras from pairs of identified ProteomeTools spectra.

Construction (PLAN-qc.md item #4):
- parents: two S0-identified spectra with the same instrument, activation and NCE, different
  I/L-normalized peptides from different synthesis pools, precursor m/z within the isolation half-width
  (the dominant parent's isolation window offsets unless a half-width is given);
- both spectra normalised to unit TIC, the minor one scaled by 1/ratio (ratio = major:minor, 1 or 10);
- peaks of the two parents within tol (0.002 Da) are summed into one peak at the intensity-weighted
  centroid m/z;
- precursor m/z and charge come from the dominant parent (parent1).

Spectra are read with pyteomics (the harness's optional reader; the plan named pyopenms, which the
harness environments on node data do not have) and written as MGF, which FASTag reads; the parents
and the ratio of every chimera go to a side table.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from . import score as S


def tic_normalize(intensity) -> np.ndarray:
    it = np.asarray(intensity, dtype=float)
    tot = it.sum()
    return it / tot if tot > 0 else it.copy()


def mix_peaks(mz_a, int_a, mz_b, int_b, ratio: float, tol: float = 0.002):
    """Mix two centroided spectra at ratio major:minor. Returns (mz, intensity, info) sorted by m/z;
    info['merged'] counts the cross-parent peak pairs collapsed into one peak (each a-peak takes at most
    its nearest b-peak within tol)."""
    if not ratio > 0:
        raise ValueError("ratio must be > 0")
    ma, mb = np.asarray(mz_a, float), np.asarray(mz_b, float)
    ia, ib = tic_normalize(int_a), tic_normalize(int_b) / float(ratio)
    oa, ob = np.argsort(ma, kind="stable"), np.argsort(mb, kind="stable")
    ma, ia, mb, ib = ma[oa], ia[oa], mb[ob], ib[ob]
    used_b = np.zeros(len(mb), bool)
    out_mz, out_int = [], []
    merged = 0
    for x, w in zip(ma, ia):
        j = np.searchsorted(mb, x)
        best, bd = -1, tol + 1.0
        for k in (j - 1, j):
            if 0 <= k < len(mb) and not used_b[k]:
                d = abs(mb[k] - x)
                if d <= tol and d < bd:
                    best, bd = k, d
        if best >= 0:
            used_b[best] = True
            tot = w + ib[best]
            out_mz.append((x * w + mb[best] * ib[best]) / tot if tot > 0 else x)
            out_int.append(tot)
            merged += 1
        else:
            out_mz.append(x)
            out_int.append(w)
    out_mz += list(mb[~used_b])
    out_int += list(ib[~used_b])
    o = np.argsort(np.asarray(out_mz), kind="stable")
    return np.asarray(out_mz)[o], np.asarray(out_int)[o], {"merged": merged}


def compatible(a: dict, b: dict, iso_halfwidth: float | None = None) -> tuple[bool, str]:
    """(ok, reason). a is the dominant parent. Reasons name the failed rule: instrument, activation, nce,
    peptide, pool, isolation."""
    if str(a.get("instrument")) != str(b.get("instrument")):
        return False, "instrument differs"
    if str(a.get("activation")) != str(b.get("activation")):
        return False, "activation differs"
    na, nb = a.get("nce"), b.get("nce")
    if na is None or nb is None or abs(float(na) - float(nb)) > 1e-6:
        return False, "nce differs"
    if S.normalize_peptide(a["peptide"]) == S.normalize_peptide(b["peptide"]):
        return False, "same peptide identity"
    if str(a.get("pool")) == str(b.get("pool")):
        return False, "same synthesis pool"
    if iso_halfwidth is None:
        lo, hi = float(a.get("iso_lower") or 0.0), float(a.get("iso_upper") or 0.0)
    else:
        lo = hi = float(iso_halfwidth)
    d = float(b["precursor_mz"]) - float(a["precursor_mz"])
    if not (-lo - 1e-9 <= d <= hi + 1e-9):
        return False, f"isolation: precursor m/z {d:+.4f} outside -{lo}/+{hi}"
    return True, ""


def pair_spectra(meta: pd.DataFrame, seed: int, iso_halfwidth: float | None = None,
                 max_pairs: int | None = None) -> pd.DataFrame:
    """Deterministic pairing: parents in a seeded random order; each takes a random compatible partner
    among the unused spectra; every spectrum is used at most once. Columns key_a, key_b."""
    m = meta.sort_values("precursor_mz", kind="stable").reset_index(drop=True)
    recs = m.to_dict("records")
    mz = m["precursor_mz"].to_numpy(float)
    rng = np.random.default_rng(seed)
    used = np.zeros(len(m), bool)
    pairs = []
    span = float(iso_halfwidth) if iso_halfwidth is not None else float(
        max(m.get("iso_lower", pd.Series([0.0])).max(), m.get("iso_upper", pd.Series([0.0])).max()))
    for i in rng.permutation(len(m)):
        if used[i]:
            continue
        lo, hi = np.searchsorted(mz, mz[i] - span - 1e-9), np.searchsorted(mz, mz[i] + span + 1e-9, "right")
        cand = [j for j in range(lo, hi) if j != i and not used[j] and compatible(recs[i], recs[j], iso_halfwidth)[0]]
        if not cand:
            continue
        j = cand[int(rng.integers(len(cand)))]
        used[i] = used[j] = True
        pairs.append((recs[i]["key"], recs[j]["key"]))
        if max_pairs is not None and len(pairs) >= max_pairs:
            break
    return pd.DataFrame(pairs, columns=["key_a", "key_b"])


def build_chimeras(spectra: dict, pairs: pd.DataFrame, ratio: float, iso_halfwidth: float | None = None,
                   tol: float = 0.002) -> tuple[list[dict], pd.DataFrame]:
    """Chimeras for the pairs. spectra: key -> (mz, intensity, meta dict). Incompatible pairs are not
    built; they are returned with the reason. Chimera i (1-based, in pair order) gets key 'scan=<i>'."""
    out, rej = [], []
    for r in pairs.itertuples(index=False):
        a, b = spectra[r.key_a], spectra[r.key_b]
        ok, why = compatible(a[2], b[2], iso_halfwidth)
        if not ok:
            rej.append({"key_a": r.key_a, "key_b": r.key_b, "reason": why})
            continue
        mz, it, info = mix_peaks(a[0], a[1], b[0], b[1], ratio, tol)
        out.append({"key": f"scan={len(out) + 1}", "parent1": r.key_a, "parent2": r.key_b,
                    "pep1": a[2]["peptide"], "pep2": b[2]["peptide"], "ratio": float(ratio),
                    "precursor_mz": a[2]["precursor_mz"], "charge": a[2]["charge"], "merged": info["merged"],
                    "mz": mz, "intensity": it})
    return out, pd.DataFrame(rej, columns=["key_a", "key_b", "reason"])


def write_chimeras(chimeras: list[dict], mgf_path: str | Path, table_path: str | Path,
                   provenance: list[str] | None = None) -> tuple[Path, Path]:
    """MGF (TITLE = key, SCANS = number) plus the side table key, parent1, parent2, pep1, pep2, ratio,
    precursor_mz, charge, merged."""
    from pyteomics import mgf

    from .tsv import write_tsv

    mgf_path, table_path = Path(mgf_path), Path(table_path)
    mgf_path.parent.mkdir(parents=True, exist_ok=True)
    ents = [{"m/z array": c["mz"], "intensity array": c["intensity"],
             "params": {"title": c["key"], "scans": c["key"].split("=")[1], "pepmass": c["precursor_mz"],
                        "charge": f"{int(c['charge'])}+"}} for c in chimeras]
    mgf.write(ents, str(mgf_path))
    cols = ["key", "parent1", "parent2", "pep1", "pep2", "ratio", "precursor_mz", "charge", "merged"]
    write_tsv(pd.DataFrame([{k: c[k] for k in cols} for c in chimeras], columns=cols), table_path,
              provenance or ["source: fastag-bench chimera.build_chimeras"])
    return mgf_path, table_path


def read_ms2(mzml_path: str | Path, keys: set | None = None) -> dict:
    """key -> (mz, intensity, meta) for MS2 spectra of an mzML (pyteomics). meta: key, activation, nce,
    precursor_mz, charge, iso_lower, iso_upper, instrument (filled by the caller), scan_filter."""
    from pyteomics import mzml

    from .parsers import spectrum_key

    out = {}
    with mzml.read(str(mzml_path), use_index=False) as rd:
        for s in rd:
            if s.get("ms level") != 2:
                continue
            k = spectrum_key(s["id"])
            if keys is not None and k not in keys:
                continue
            p = s["precursorList"]["precursor"][0]
            ion = p["selectedIonList"]["selectedIon"][0]
            act = p.get("activation", {})
            kind = next((x for x in ("beam-type collision-induced dissociation", "collision-induced dissociation",
                                     "electron transfer dissociation", "higher energy beam-type collision-induced dissociation")
                         if x in act), "unknown")
            iw = p.get("isolationWindow", {})
            scan = s.get("scanList", {}).get("scan", [{}])[0]
            out[k] = (np.asarray(s["m/z array"], float), np.asarray(s["intensity array"], float),
                      {"key": k, "activation": kind, "nce": float(act.get("collision energy", np.nan)),
                       "precursor_mz": float(ion["selected ion m/z"]),
                       "charge": int(ion["charge state"]) if "charge state" in ion else None,
                       "iso_lower": float(iw.get("isolation window lower offset", 0.0)),
                       "iso_upper": float(iw.get("isolation window upper offset", 0.0)),
                       "scan_filter": str(scan.get("filter string", ""))})
    return out


def attribute_tags(tags: pd.DataFrame, chim: pd.DataFrame, k: int = 50) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Per-tag attribution (pep1, pep2, both, neither; paper flank rule against each parent) and per
    chimera: pep1_rank1 (rank-1 tag correct for pep1), pep1_topk, pep2_topk, both_topk and the rank-1
    attribution. tags: key, rank, tag, nterm_mass, cterm_mass. chim: key, pep1, pep2."""
    c = chim[["key", "pep1", "pep2"]]
    m = tags.merge(c, on="key", how="inner")
    cache: dict[str, tuple] = {}

    def ok(t, n, cm, p):
        if not S.tag_matches(t, p):
            return False
        if p not in cache:
            cache[p] = S.peptide_masses(p)
        return S.tag_correct_flank(t, float(n), float(cm), *cache[p])

    c1 = [ok(t, n, cm, p) for t, n, cm, p in zip(m["tag"], m["nterm_mass"], m["cterm_mass"], m["pep1"])]
    c2 = [ok(t, n, cm, p) for t, n, cm, p in zip(m["tag"], m["nterm_mass"], m["cterm_mass"], m["pep2"])]
    m = m.assign(c1=c1, c2=c2)
    m["attribution"] = np.select([m.c1 & m.c2, m.c1, m.c2], ["both", "pep1", "pep2"], "neither")
    rows = []
    for key in c["key"]:
        g = m[m["key"] == key]
        top = g[g["rank"] <= k]
        r1 = g[g["rank"] == 1]
        rows.append({"key": key, "tagged": int(len(g) > 0),
                     "pep1_rank1": bool(r1["c1"].any()), "pep1_topk": bool(top["c1"].any()),
                     "pep2_topk": bool(top["c2"].any()), "both_topk": bool(top["c1"].any() and top["c2"].any()),
                     "rank1_attribution": r1["attribution"].iloc[0] if len(r1) else "untagged"})
    return m.drop(columns=["c1", "c2"]), pd.DataFrame(rows)
