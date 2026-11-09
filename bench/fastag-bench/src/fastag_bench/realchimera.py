"""1.13 item 12 (#16): tag accuracy on real chimeric spectra.

Benchmark only; FASTag is not changed. Inputs are hash-pinned raw-derived mzML files listed in a
manifest TSV (one row per run: split, PXD, PRIDE raw file and SHA-1, mzML and sha256, FASTA and sha256,
search settings). Two independent views of chimericity per MS2 spectrum:

- Sage truth (sage.py mode 'chimera': chimera search, wide_window, report_psms 2). A spectrum is
  'chimeric' when its rank-1 and rank-2 PSMs are both targets at spectrum_q <= fdr (rank 2 also at a
  target-decoy q <= fdr within the rank-2 PSMs alone, `rank_q`) with different I/L-normalized peptides,
  neither contained in the other; 'nested' when both pass but one peptide
  contains the other (excluded: a tag cannot be attributed); 'single' when only rank 1 passes.
- MS1 precursor purity: the share of the isolation window's MS1 intensity (preceding survey scan) that
  belongs to the header precursor's isotope envelope (`precursor_purity`, a port of OpenMS
  PrecursorPurity::computePrecursorPurity as of OpenMS develop: window around the isolation target,
  isotope search within 2 x tol_ppm of the selected ion; `center='selected'` gives the OpenMS 3.4
  window around the selected ion, which the cross-check against pyopenms 3.4 uses).

Steps (fastag-bench realchimera <step>): verify (sha256 of every mzML and FASTA against the
manifest; nothing else runs on a mismatch), sage, purity, run (FASTag profiles), score (one row per
scored spectrum and profile), report (scripts/stats_realchimera.py endpoints). The per-spectrum
scoring uses score.py's flank rule against each of the two peptides.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import math
import platform
from bisect import bisect_left
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from . import parsers as P
from . import score as S
from .tsv import read_tsv, write_tsv

C13C12 = 1.0033548378  # OpenMS Constants::C13C12_MASSDIFF_U
STEPS = ("verify", "sage", "purity", "run", "score", "report", "all")
MANIFEST_COLS = ("run_id", "split", "pxd", "raw_file", "raw_sha1", "mzml", "mzml_sha256", "fasta", "fasta_sha256",
                 "conversion", "enzyme", "fixed_mods", "variable_mods", "max_variable_mods", "precursor_ppm", "fragment_tol",
                 "missed_cleavages")
CATEGORIES = ("chimeric", "nested", "single")
DEFAULT_PROFILES = {"default": [], "cap10": ["-max_tags", "10"], "cap10_div": ["-max_tags", "10", "-diversity"]}
KS = (1, 5, 10, 50)
HEADER_PPM = 20.0
HEADER_ISOTOPES = (-1, 0, 1, 2, 3)


# ------------------------------------------------------------------------------------------------ purity
def precursor_purity(mz, intensity, target_mz: float, charge: int | None, lower_offset: float,
                     upper_offset: float, iso_target: float | None = None, tol_ppm: float = 10.0,
                     center: str = "target") -> dict:
    """Port of OpenMS PrecursorPurity::computePrecursorPurity on one centroided MS1 spectrum (mz sorted).

    Window [c - lower_offset, c + upper_offset] with c the isolation target m/z (center 'target', OpenMS
    develop; falls back to target_mz when iso_target is missing or <= 0) or target_mz (center 'selected',
    OpenMS 3.4). total = summed intensity in the window (both bounds inclusive); the precursor's isotope
    positions target_mz + k * C13C12 / z inside the window (k from the first position at or above the lower
    bound) each take the nearest remaining window peak within 2 * tol_ppm of target_mz (OpenMS doubles the
    tolerance), and that peak is removed from the window. Returns total, target, signal_proportion
    (target / total, 0 without target signal), target_peaks, interfering_peaks."""
    if center not in ("target", "selected"):
        raise ValueError("center must be 'target' or 'selected'")
    z = abs(int(charge)) if charge else 1
    z = z or 1
    c = float(iso_target) if (center == "target" and iso_target is not None and not math.isnan(iso_target)
                              and iso_target > 0) else float(target_mz)
    lo, hi = c - float(lower_offset), c + float(upper_offset)
    mz = np.asarray(mz, float)
    it = np.asarray(intensity, float)
    a, b = int(np.searchsorted(mz, lo, "left")), int(np.searchsorted(mz, hi, "right"))
    wmz, wit = list(mz[a:b]), list(it[a:b])
    out = {"total": float(sum(wit)), "target": 0.0, "signal_proportion": 0.0, "target_peaks": 0,
           "interfering_peaks": len(wmz)}
    if not wmz:
        return out
    tol = float(target_mz) * tol_ppm * 2 * 1e-6
    iso = math.ceil((lo - target_mz) * z / C13C12)
    if target_mz + iso * C13C12 / z < lo:
        iso += 1
    target = 0.0
    n_t = 0
    while True:
        nxt = target_mz + iso * C13C12 / z
        if nxt > hi:
            break
        # MSSpectrum::findNearest(mz, tol): the nearest peak (left one on a tie), accepted when it lies in
        # [mz - tol, mz + tol] with the interval ends computed first (not |peak - mz| <= tol)
        j = bisect_left(wmz, nxt)
        best = -1
        if wmz:
            if j == 0:
                best = 0
            elif j == len(wmz):
                best = j - 1
            else:
                best = j if abs(wmz[j] - nxt) < abs(wmz[j - 1] - nxt) else j - 1
            near = wmz[best]
            if not ((near < nxt and near >= nxt - tol) or (near >= nxt and near <= nxt + tol)):
                best = -1
        if best >= 0:
            target += wit[best]
            del wmz[best], wit[best]
            n_t += 1
        iso += 1
    out.update(target=float(target), target_peaks=n_t, interfering_peaks=len(wmz),
               signal_proportion=float(target / out["total"]) if target > 0 else 0.0)
    return out


def purity_table(mzml_path: str | Path, tol_ppm: float = 10.0, center: str = "target") -> pd.DataFrame:
    """One row per MS2 spectrum: key, native_id, rt, precursor_mz, charge, iso_target, iso_lower, iso_upper,
    ms1_key (the preceding MS1 spectrum, '' when there is none), purity and the purity_* parts. Spectra
    without a preceding MS1 get purity NaN."""
    from pyteomics import mzml

    rows = []
    ms1 = None
    with mzml.read(str(mzml_path), use_index=False) as rd:
        for s in rd:
            lvl = s.get("ms level")
            if lvl == 1:
                o = np.argsort(np.asarray(s["m/z array"], float), kind="stable")
                ms1 = (P.spectrum_key(s["id"]), np.asarray(s["m/z array"], float)[o],
                       np.asarray(s["intensity array"], float)[o])
                continue
            if lvl != 2:
                continue
            p = s["precursorList"]["precursor"][0]
            ion = p["selectedIonList"]["selectedIon"][0]
            iw = p.get("isolationWindow", {})
            scan = s.get("scanList", {}).get("scan", [{}])[0]
            pmz = float(ion["selected ion m/z"])
            z = int(ion["charge state"]) if "charge state" in ion else None
            tgt = float(iw.get("isolation window target m/z", np.nan))
            lo_off = float(iw.get("isolation window lower offset", 0.0))
            hi_off = float(iw.get("isolation window upper offset", 0.0))
            r = {"key": P.spectrum_key(s["id"]), "native_id": s["id"],
                 "rt": float(scan.get("scan start time", np.nan)), "precursor_mz": pmz, "charge": z,
                 "iso_target": tgt, "iso_lower": lo_off, "iso_upper": hi_off,
                 "ms1_key": ms1[0] if ms1 else ""}
            if ms1 is None or lo_off + hi_off <= 0:
                r.update(purity=np.nan, purity_total=np.nan, purity_target=np.nan, purity_target_peaks=np.nan,
                         purity_interfering_peaks=np.nan)
            else:
                q = precursor_purity(ms1[1], ms1[2], pmz, z, lo_off, hi_off, tgt, tol_ppm, center)
                r.update(purity=q["signal_proportion"], purity_total=q["total"], purity_target=q["target"],
                         purity_target_peaks=q["target_peaks"], purity_interfering_peaks=q["interfering_peaks"])
            rows.append(r)
    return pd.DataFrame(rows)


# ------------------------------------------------------------------------------------------------ truth
def _nested(a: str, b: str) -> bool:
    return a in b or b in a


def rank_q(df: pd.DataFrame, score: str = "sage_discriminant_score") -> pd.Series:
    """Target-decoy q-value computed within the given PSMs only (one rank): q = decoys / targets at or above
    the score (a tied group counted as a whole), made monotone. Index of df."""
    o = df.sort_values(score, ascending=False, kind="stable")
    dec = (o["label"] != 1).cumsum().to_numpy(float)
    tgt = (o["label"] == 1).cumsum().to_numpy(float)
    # a tied score group shares one q: the counts at the end of the group (independent of row order)
    sc = o[score].to_numpy(float)
    last = np.r_[sc[1:] != sc[:-1], True] if len(sc) else np.array([], bool)
    end = np.flatnonzero(last)
    grp = np.searchsorted(end, np.arange(len(sc)))
    dec, tgt = dec[end][grp], tgt[end][grp]
    q = np.where(tgt > 0, dec / np.maximum(tgt, 1), 1.0)
    q = np.minimum.accumulate(q[::-1])[::-1]
    return pd.Series(q, index=o.index).reindex(df.index)


def header_match(df: pd.DataFrame, ppm: float = HEADER_PPM, isotopes=HEADER_ISOTOPES) -> pd.Series:
    """Descriptive: True where the PSM's peptide explains the spectrum's header precursor, i.e.
    |expmass - calcmass - k * C13C12| <= ppm * calcmass / 1e6 for some isotope offset k (Sage's expmass is
    the header precursor's neutral mass; in wide_window mode a PSM may come from another co-isolated
    precursor). All False without expmass/calcmass columns."""
    if not {"expmass", "calcmass"} <= set(df.columns):
        return pd.Series(False, index=df.index)
    e, c = df["expmass"].to_numpy(float), df["calcmass"].to_numpy(float)
    d = np.min(np.abs(e[:, None] - c[:, None] - np.asarray(isotopes, float)[None, :] * C13C12), axis=1)
    return pd.Series(d <= ppm * c / 1e6, index=df.index)


def chimera_truth(results_sage: str | Path, fdr: float = 0.01) -> pd.DataFrame:
    """Per spectrum with a passing rank-1 target PSM (Sage spectrum_q <= fdr): key, pep1, pep2 ('' unless
    rank 2 passes), q1, q2, q2_rank, ppm1, ppm2, category (chimeric, nested, single). Rank 2 passes when it
    is a target with Sage's spectrum_q <= fdr AND a target-decoy q within the rank-2 PSMs alone
    (rank_q) <= fdr: Sage's q is computed over both ranks together, which lets the rank-2 subset run at a
    higher FDR. Needs Sage's rank column (report_psms >= 2)."""
    df = pd.read_csv(results_sage, sep="\t")
    if "rank" not in df.columns:
        raise ValueError(f"{results_sage}: needs Sage's rank column (report_psms >= 2)")
    if df["filename"].nunique() > 1:
        raise ValueError(f"{results_sage}: one mzML per Sage run expected")
    score = "sage_discriminant_score" if "sage_discriminant_score" in df.columns else "hyperscore"
    df["key"] = df["scannr"].map(P.spectrum_key)
    clash = df.groupby("key")["scannr"].nunique()
    if (clash > 1).any():
        raise ValueError(f"{results_sage}: native IDs collide on one key: {list(clash[clash > 1].index[:3])}")
    if df.duplicated(["key", "rank"]).any():
        raise ValueError(f"{results_sage}: more than one PSM per spectrum and rank")
    df["hdr"] = header_match(df)
    r1 = df[(df["rank"] == 1) & (df["label"] == 1) & (df["spectrum_q"] <= fdr)].drop_duplicates("key")
    r2a = df[df["rank"] == 2].copy()
    r2a["q2_rank"] = rank_q(r2a, score) if len(r2a) else []
    r2 = r2a[(r2a["label"] == 1) & (r2a["spectrum_q"] <= fdr) & (r2a["q2_rank"] <= fdr)].drop_duplicates("key")
    m = r1[["key", "peptide", "spectrum_q", "hdr"]].rename(columns={"peptide": "pep1", "spectrum_q": "q1", "hdr": "hdr1"}).merge(
        r2[["key", "peptide", "spectrum_q", "q2_rank", "hdr"]].rename(columns={"peptide": "pep2", "spectrum_q": "q2", "hdr": "hdr2"}),
        on="key", how="left")
    m["pep2"] = m["pep2"].fillna("")
    m["hdr2"] = m["hdr2"].fillna(False).astype(bool)
    cat = []
    for a, b in zip(m["pep1"], m["pep2"]):
        if not b:
            cat.append("single")
            continue
        na, nb = S.normalize_peptide(a), S.normalize_peptide(b)
        cat.append("nested" if _nested(na, nb) else "chimeric")
    m["category"] = cat
    return m.reset_index(drop=True)


def chance_truth(truth: pd.DataFrame, seed: int = 1) -> pd.DataFrame:
    """Chance control: every spectrum is scored against the peptides of another spectrum of its category.
    Spectra of a category are put in a seeded random cycle; each takes the (pep1, pep2) of the next spectrum
    in the cycle whose I/L-normalized identities share none with its own pep1 or pep2 (so neither slot can
    give back one of the spectrum's own identities); a spectrum without such a partner gets '' (scored as
    not correct). Keys, categories and purities stay; only the peptides scored against change."""
    ch = truth.copy()
    rng = np.random.default_rng(seed)
    for cat in sorted(truth["category"].unique()):
        idx = np.flatnonzero((truth["category"] == cat).to_numpy())
        if not len(idx):
            continue
        order = idx[rng.permutation(len(idx))]
        p1 = truth["pep1"].astype(str).to_numpy()
        p2 = truth["pep2"].astype(str).to_numpy()
        ids = {i: {S.normalize_peptide(x) for x in (p1[i], p2[i]) if x} for i in order}
        n = len(order)
        new1, new2 = {}, {}
        for pos, i in enumerate(order):
            new1[i], new2[i] = "", ""
            for step in range(1, n):
                j = order[(pos + step) % n]
                if not (ids[j] & ids[i]):
                    new1[i], new2[i] = p1[j], p2[j]
                    break
        rows = list(order)
        ch.iloc[rows, ch.columns.get_loc("pep1")] = [new1[i] for i in rows]
        ch.iloc[rows, ch.columns.get_loc("pep2")] = [new2[i] for i in rows]
    return ch


# ------------------------------------------------------------------------------------------------ scoring
def _correct_matrix(tags: pd.DataFrame, keys_peps: pd.DataFrame) -> pd.DataFrame:
    """Flank-rule correctness of every tag of the listed spectra against the given peptide (key, peptide);
    returns key, rank, correct."""
    empty = pd.DataFrame({"key": pd.Series(dtype=str), "rank": pd.Series(dtype=int), "correct": pd.Series(dtype=bool)})
    if keys_peps.empty or tags.empty:
        return empty
    m = S._mark(tags, keys_peps[["key", "peptide"]], rule="flank")
    if m.empty:
        return empty
    return m[["key", "rank", "correct"]].astype({"correct": bool})


def score_spectra(tags: pd.DataFrame, truth: pd.DataFrame, ks=KS) -> pd.DataFrame:
    """One row per truth spectrum: tagged, n_tags, and per peptide j in (pep1, pep2) pep<j>_rank1 and
    pep<j>_top<k> (some tag at rank <= k correct under the flank rule); union_rank1 (rank-1 tag correct
    for either), both_rank1 (correct for both), both_top<k> (pep1 and pep2 each covered within the top k),
    attribution of the rank-1 tag (pep1, pep2, both, neither, untagged; single spectra: pep1, neither,
    untagged). pep2 columns are False for single spectra."""
    t = tags[tags["key"].isin(set(truth["key"]))]
    n = t.groupby("key").size()
    out = truth[["key"]].copy()
    out["n_tags"] = out["key"].map(n).fillna(0).astype(int)
    out["tagged"] = out["n_tags"] > 0
    for j in (1, 2):
        kp = truth.loc[truth[f"pep{j}"].astype(str) != "", ["key", f"pep{j}"]].rename(columns={f"pep{j}": "peptide"})
        c = _correct_matrix(t, kp)
        c = c[c["correct"]]
        first = c.groupby("key")["rank"].min()
        best = out["key"].map(first)
        out[f"pep{j}_rank1"] = (best == 1).fillna(False).astype(bool)
        for k in ks:
            out[f"pep{j}_top{k}"] = (best <= k).fillna(False).astype(bool)
    out["union_rank1"] = out["pep1_rank1"] | out["pep2_rank1"]
    out["both_rank1"] = out["pep1_rank1"] & out["pep2_rank1"]
    for k in ks:
        out[f"both_top{k}"] = out[f"pep1_top{k}"] & out[f"pep2_top{k}"]
    att = np.where(~out["tagged"], "untagged",
                   np.where(out["both_rank1"], "both",
                            np.where(out["pep1_rank1"], "pep1", np.where(out["pep2_rank1"], "pep2", "neither"))))
    out["attribution"] = att
    return out


# ------------------------------------------------------------------------------------------------ config
def _now() -> str:
    return _dt.datetime.now().astimezone().isoformat(timespec="seconds")


def sha256_file(path: str | Path, chunk: int = 1 << 24) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            b = fh.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def load(path: str | Path) -> dict:
    """Config YAML: realchimera: {manifest, work_dir, split, fdr, purity_tol_ppm, purity_center, profiles,
    fastag_threads}; tools: {fastag, sage}; sage: {threads, ...} (config.DEFAULTS['sage'] filled in)."""
    from .config import DEFAULTS

    cfg = yaml.safe_load(Path(path).read_text()) or {}
    rc = cfg.setdefault("realchimera", {})
    for k in ("manifest", "work_dir", "split"):
        if k not in rc:
            raise ValueError(f"{path}: realchimera.{k} is required")
    rc.setdefault("fdr", 0.01)
    rc.setdefault("purity_tol_ppm", 10.0)
    rc.setdefault("purity_center", "target")
    rc.setdefault("profiles", DEFAULT_PROFILES)
    rc.setdefault("fastag_threads", 8)
    rc.setdefault("fastag_args", [])
    cfg["sage"] = {**DEFAULTS["sage"], **(cfg.get("sage") or {})}
    cfg.setdefault("tools", {})
    cfg["_config_path"] = str(Path(path).resolve())
    return cfg


def read_manifest(path: str | Path, split: str | None = None) -> pd.DataFrame:
    df, _ = read_tsv(path)
    miss = [c for c in MANIFEST_COLS if c not in df.columns]
    if miss:
        raise ValueError(f"{path}: manifest misses columns {miss}")
    if df["run_id"].duplicated().any():
        raise ValueError(f"{path}: duplicate run_id")
    for c in ("mzml_sha256", "fasta_sha256"):
        bad = [v for v in df[c].astype(str) if len(v) != 64 or any(ch not in "0123456789abcdef" for ch in v)]
        if bad:
            raise ValueError(f"{path}: {c} must be 64 lowercase hex digits ({bad[:2]})")
    if split is not None:
        df = df[df["split"] == split]
        if df.empty:
            raise ValueError(f"{path}: no run of split {split!r}")
    return df.reset_index(drop=True)


def _mods(s) -> dict:
    """'M:15.994915;S:79.966331' -> {'M': [15.994915], 'S': [79.966331]}; repeated residues accumulate.
    An empty cell is refused: sage.py replaces empty modification sets by its defaults (C+57, M+16), so a
    manifest must name its modifications."""
    if s is None or (isinstance(s, float) and math.isnan(s)) or not str(s).strip():
        raise ValueError("manifest: empty modification cell (name the modifications explicitly)")
    out: dict = {}
    for part in str(s).split(";"):
        part = part.strip()
        if not part:
            continue
        k, v = part.split(":")
        out.setdefault(k.strip(), []).append(float(v))
    return out


def run_dataset(r) -> "object":
    """A config.Dataset for sage.sage_config from a manifest row."""
    from .config import Dataset

    tol = str(r.fragment_tol).strip()
    search: dict = {"missed_cleavages": int(r.missed_cleavages), "max_variable_mods": int(r.max_variable_mods),
                    "precursor_ppm": float(r.precursor_ppm)}
    if tol.endswith("Da"):
        search["fragment_da"] = float(tol[:-2])
    elif tol.endswith("ppm"):
        search["fragment_ppm"] = float(tol[:-3])
    else:
        raise ValueError(f"{r.run_id}: fragment_tol must end in Da or ppm, got {tol!r}")
    fixed = {k: v[0] for k, v in _mods(r.fixed_mods).items()}
    var = _mods(r.variable_mods)
    search["variable_mods"] = var
    return Dataset(id=str(r.run_id), pxd=str(r.pxd), species="", instrument="", experiments=["realchimera"], files=[],
                   enzyme=[str(r.enzyme)], fixed_mods=fixed, variable_mods=var, search=search)


def _wd(cfg) -> Path:
    return Path(cfg["realchimera"]["work_dir"])


def _rundir(cfg, r) -> Path:
    return _wd(cfg) / "runs" / str(r.split) / str(r.run_id)


def _prov(cfg, what: str) -> list[str]:
    from . import __version__
    return [f"source: fastag-bench {__version__} realchimera {what} ({_now()}, host {platform.node()})",
            f"config: {cfg['_config_path']}; manifest: {cfg['realchimera']['manifest']}; split: {cfg['realchimera']['split']}"]


# ------------------------------------------------------------------------------------------------ steps
def step_verify(cfg, log=print) -> Path:
    rc = cfg["realchimera"]
    man = read_manifest(rc["manifest"], rc["split"])
    rows = []
    for r in man.itertuples():
        for kind in ("mzml", "fasta"):
            p = Path(getattr(r, kind))
            want = getattr(r, f"{kind}_sha256")
            got = sha256_file(p) if p.exists() else "missing"
            rows.append({"run_id": r.run_id, "kind": kind, "path": str(p), "sha256_manifest": want,
                         "sha256_found": got, "ok": got == want})
    df = pd.DataFrame(rows)
    out = write_tsv(df, _wd(cfg) / f"verify_{rc['split']}.tsv", _prov(cfg, "verify"))
    bad = df[~df["ok"]]
    if len(bad):
        raise RuntimeError(f"sha256 mismatch or missing input: {bad[['run_id', 'kind', 'path']].to_dict('records')}")
    log(f"verify: {len(df)} files match the manifest -> {out}")
    return out


def _verified(cfg) -> pd.DataFrame:
    """Gate of every step after verify: the split's verify record must exist and every manifest file must
    hash, now, to its manifest sha256 at the recorded path (the files are re-hashed on each call, so a file
    replaced after verify is caught). Returns the split's manifest."""
    rc = cfg["realchimera"]
    p = _wd(cfg) / f"verify_{rc['split']}.tsv"
    if not p.exists():
        raise RuntimeError(f"{p} missing: run the verify step first")
    df, _ = read_tsv(p)
    man = read_manifest(rc["manifest"], rc["split"])
    rec = {(a, b): (c, d) for a, b, c, d in zip(df["run_id"], df["kind"], df["path"], df["sha256_found"])}
    for r in man.itertuples():
        for k in ("mzml", "fasta"):
            want, path = getattr(r, f"{k}_sha256"), str(getattr(r, k))
            if rec.get((r.run_id, k)) != (path, want):
                raise RuntimeError(f"{p} does not cover {r.run_id} {k} ({path}): rerun verify")
            key = (path, Path(path).stat().st_mtime_ns if Path(path).exists() else None)
            got = _HASHED.get(key) or (sha256_file(path) if Path(path).exists() else "missing")
            if got != want:
                raise RuntimeError(f"{r.run_id} {k} {path}: sha256 {got} != manifest {want}")
            _HASHED[key] = got
    return man


_HASHED: dict = {}


def _record_ok(rec: Path, text: str) -> bool:
    return rec.exists() and rec.read_text() == text


def step_sage(cfg, log=print) -> None:
    from .run import tool_path, tool_version
    from .sage import sage_config, write_sage_config
    from .timing import run_timed
    man = _verified(cfg)
    exe = tool_path(cfg, "sage")
    if not exe:
        raise RuntimeError("tools.sage not found")
    exe_sha = sha256_file(exe)
    for r in man.itertuples():
        out = _rundir(cfg, r) / "sage"
        res = out / "results.sage.tsv"
        import json
        conf_d = sage_config(run_dataset(r), r.fasta, [r.mzml], cfg["sage"], mode="chimera")
        cmd = [exe, *map(str, cfg["sage"].get("args") or []), "-o", str(out), str(out / "sage.json")]
        record = (f"{' '.join(cmd)}\nsage sha256 {exe_sha}\nmzml sha256 {r.mzml_sha256}\nfasta sha256 {r.fasta_sha256}\n"
                  f"config {json.dumps(conf_d, sort_keys=True)}\n")
        if res.exists() and _record_ok(out / "inputs.txt", record):
            continue
        for f in (res, out / "inputs.txt"):
            if f.exists():
                f.unlink()
        out.mkdir(parents=True, exist_ok=True)
        write_sage_config(out / "sage.json", conf_d)
        (out / "command.txt").write_text(" ".join(cmd) + "\n")
        (out / "version.txt").write_text(tool_version(exe, ("--version",), r"sage ?([^\n]+)") + "\n")
        t = run_timed(cmd, log=out / "run.log",
                      env={**(cfg.get("env") or {}), "RAYON_NUM_THREADS": str(cfg["sage"].get("threads") or 16)})
        if t["returncode"] != 0 or not res.exists():
            raise RuntimeError(f"Sage chimera failed on {r.run_id}: see {out / 'run.log'}")
        (out / "inputs.txt").write_text(record)  # written only after success: the cache key of results.sage.tsv
        log(f"{r.run_id} sage chimera: {t['wall_s']} s")


def step_purity(cfg, log=print) -> None:
    rc = cfg["realchimera"]
    man = _verified(cfg)
    for r in man.itertuples():
        p = _rundir(cfg, r) / "purity.tsv"
        rec = p.with_suffix(".inputs.txt")
        record = (f"mzml sha256 {r.mzml_sha256}\ntol_ppm {float(rc['purity_tol_ppm'])}\ncenter {rc['purity_center']}\n"
                  f"realchimera.py sha256 {sha256_file(__file__)}\n")
        if p.exists() and _record_ok(rec, record):
            continue
        for f in (p, rec):
            if f.exists():
                f.unlink()
        df = purity_table(r.mzml, float(rc["purity_tol_ppm"]), rc["purity_center"])
        if df["key"].duplicated().any():
            raise RuntimeError(f"{r.run_id}: duplicate spectrum keys in {r.mzml}")
        write_tsv(df, p, _prov(cfg, f"purity {r.run_id}") + [
            f"OpenMS PrecursorPurity port, tol {rc['purity_tol_ppm']} ppm, center {rc['purity_center']}, from {r.mzml}"])
        rec.write_text(record)
        log(f"{r.run_id}: purity of {len(df)} MS2, median {df['purity'].median():.3f}")


def step_run(cfg, log=print) -> None:
    from .run import tool_path, tool_version
    from .timing import run_timed
    rc = cfg["realchimera"]
    man = _verified(cfg)
    exe = tool_path(cfg, "fastag")
    if not exe:
        raise RuntimeError("tools.fastag not found")
    exe_sha = sha256_file(exe)
    for r in man.itertuples():
        for prof, args in rc["profiles"].items():
            out = _rundir(cfg, r) / "fastag" / prof
            tags = out / "tags.tsv"
            inp = Path(r.mzml)
            cmd = [exe, "-in", str(inp), "-out", str(tags), "-threads", str(rc["fastag_threads"]),
                   *map(str, rc["fastag_args"]), *map(str, args)]
            record = (f"{' '.join(cmd)}\nfastag sha256 {exe_sha}\nmzml sha256 {r.mzml_sha256}\n"
                      f"env {sorted((cfg.get('env') or {}).items())}\n")
            if tags.exists() and _record_ok(out / "inputs.txt", record):
                continue
            for f in (tags, out / "inputs.txt"):
                if f.exists():
                    f.unlink()
            out.mkdir(parents=True, exist_ok=True)
            (out / "command.txt").write_text(" ".join(cmd) + "\n")
            (out / "version.txt").write_text(tool_version(exe) + "\n")
            t = run_timed(cmd, log=out / "run.log", env=cfg.get("env") or {})
            if t["returncode"] != 0 or not tags.exists():
                raise RuntimeError(f"FASTag {prof} failed on {r.run_id}: see {out / 'run.log'}")
            (out / "inputs.txt").write_text(record)  # written only after success: the cache key of tags.tsv
            log(f"{r.run_id} fastag {prof}: {t['wall_s']} s")


def score_run(cfg, r) -> pd.DataFrame:
    rc = cfg["realchimera"]
    base = _rundir(cfg, r)
    need = [base / "sage" / "inputs.txt", base / "purity.inputs.txt"] + [base / "fastag" / p / "inputs.txt" for p in rc["profiles"]]
    miss = [str(x) for x in need if not x.exists()]
    if miss:
        raise RuntimeError(f"{r.run_id}: outputs without a completion record (rerun sage/purity/run): {miss}")
    for x in need:
        if f"mzml sha256 {r.mzml_sha256}\n" not in x.read_text():
            raise RuntimeError(f"{x}: made from another mzML than the manifest's (rerun)")
    truth = chimera_truth(base / "sage" / "results.sage.tsv", float(rc["fdr"]))
    pur, _ = read_tsv(base / "purity.tsv")
    truth = truth.merge(pur[["key", "purity", "charge", "precursor_mz", "iso_lower", "iso_upper"]], on="key", how="left")
    chance = chance_truth(truth, int(rc.get("chance_seed", 1)))
    parts = []
    for prof in rc["profiles"]:
        tags = P.read_fastag_tags(base / "fastag" / prof / "tags.tsv")
        for arm, tr in (("truth", truth), ("chance", chance)):
            sc = score_spectra(tags, tr)
            parts.append(truth.merge(sc, on="key").assign(profile=prof, arm=arm))
    out = pd.concat(parts, ignore_index=True)
    out.insert(0, "run_id", r.run_id)
    out.insert(1, "pxd", r.pxd)
    out["cluster1"] = [f"{r.run_id}|{S.normalize_peptide(p)}" for p in out["pep1"]]
    out["cluster2"] = [f"{r.run_id}|{S.normalize_peptide(p)}" if p else "" for p in out["pep2"]]
    return out


def step_score(cfg, log=print) -> Path:
    rc = cfg["realchimera"]
    man = _verified(cfg)
    parts = []
    for r in man.itertuples():
        sc = score_run(cfg, r)
        parts.append(sc)
        one = sc[(sc["profile"] == next(iter(rc["profiles"]))) & (sc["arm"] == "truth")]
        log(f"{r.run_id}: " + ", ".join(f"{c} {int((one['category'] == c).sum())}" for c in CATEGORIES))
    df = pd.concat(parts, ignore_index=True)
    out = _wd(cfg) / f"spectra_{rc['split']}.tsv.gz"
    prov = _prov(cfg, "score") + [f"fdr {rc['fdr']}; profiles {dict(rc['profiles'])}"]
    out.parent.mkdir(parents=True, exist_ok=True)
    import gzip
    with gzip.open(out, "wt") as fh:
        for line in prov:
            fh.write(f"# {line}\n")
        df.to_csv(fh, sep="\t", index=False)
    log(f"score: {len(df)} rows -> {out}")
    return out


def step_report(cfg, log=print) -> Path:
    import importlib.util
    here = Path(__file__).resolve().parents[2] / "scripts" / "stats_realchimera.py"
    spec = importlib.util.spec_from_file_location("stats_realchimera", here)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rc = cfg["realchimera"]
    _verified(cfg)
    return mod.report(_wd(cfg) / f"spectra_{rc['split']}.tsv.gz", _wd(cfg) / f"endpoints_{rc['split']}.tsv", log=log)


def run_step(cfg, step: str, log=print):
    if step not in STEPS:
        raise ValueError(f"step {step!r}: one of {STEPS}")
    order = ["verify", "sage", "purity", "run", "score", "report"] if step == "all" else [step]
    fns = {"verify": step_verify, "sage": step_sage, "purity": step_purity, "run": step_run,
           "score": step_score, "report": step_report}
    res = None
    for s in order:
        res = fns[s](cfg, log=log)
    return res
