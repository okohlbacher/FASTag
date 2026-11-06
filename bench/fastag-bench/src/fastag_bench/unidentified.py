"""#4 (FASTag 1.12, cluster F): tag accuracy on unidentified (S3-PT) and synthetic chimeric (S4) spectra.

`fastag-bench unidentified <step> --config config/unidentified-data.yaml [--split dev]`

Steps (each reads what the previous one wrote under work_dir; every table carries provenance lines):
  splits         draw all ProteomeTools splits at once from the PRIDE file list and write the splits table
                 (PLAN-qc.md #4: dev seed 1, test seed 2, F7 seeds 3/4/5 on batches #4 does not use, reserved
                 seeds 6/7/8). Refuses to overwrite an existing table.
  pool-truth     per pool of the split: fetch the tryptic MaxQuant searches, pool peptide list (union), decoy
                 pool, pool FASTA; peptide-level disjointness of every split whose lists are present.
  sage-modes     fetch and convert the 3xHCD raw file; Sage 'closed' (full human proteome) and 'pool' searches.
  run            FASTag profiles on each pool run (and on the chimera MGFs when present).
  chimera-build  synthetic chimeras from S0 spectra of different pools of the split, per ratio.
  score          per-spectrum outcome tables (S0, S3-PT with mass-constrained candidates, pool-swap chance,
                 chimeras with attribution) plus the validity controls per pool.
  collect        summaries and the pre-registered endpoint statistics (scripts/stats_unidentified.py).
  v190-check     re-export the stored v1.9.0 accuracy pairs with this harness and compare with the stored table.

FASTag is never modified: the runs use the 1.11.0 release binary at matched settings.
"""
from __future__ import annotations

import json
import platform
import shutil
import zipfile
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from . import __version__
from . import chimera as CH
from . import parsers as P
from . import pooltruth as T
from . import proteometools as PT
from . import score as S
from .strata import assign_axes
from .tsv import read_tsv, write_tsv

STEPS = ("splits", "pool-truth", "sage-modes", "run", "chimera-build", "score", "collect", "v190-check")
SPLITS = ("dev", "test", "f7train", "f7test", "final")
ROOT = Path(__file__).resolve().parents[2]


# ----------------------------------------------------------------------------------------------- scoring

def score_spectra(tags: pd.DataFrame, truth: pd.DataFrame, ks=(1, 5, 10, 50), evalue_max: float = 0.01) -> pd.DataFrame:
    """One row per truth spectrum. truth: key, candidates (list of peptide strings in Sage notation) and
    any label columns (kept). tags: key, rank, tag, nterm_mass, cterm_mass[, evalue]. A tag is correct when
    the paper flank rule holds for at least one candidate (score.tag_correct_any).

    Columns added: n_candidates, size_label, tagged, top1, top<k> for k in ks, n_tags, n_correct, and
    n_tags_e001 / n_correct_e001 (tags with E-value <= evalue_max)."""
    tr = truth.copy()
    tr["n_candidates"] = [len(c) for c in tr["candidates"]]
    tr["size_label"] = [T.size_label(len({S.normalize_peptide(p) for p in c})) for c in tr["candidates"]]
    cand = dict(zip(tr["key"], tr["candidates"]))
    m = tags[tags["key"].isin(cand)]
    ok = [S.tag_correct_any(t, (float(n), float(c)), cand[k])
          for t, n, c, k in zip(m["tag"], m["nterm_mass"], m["cterm_mass"], m["key"])]
    m = m.assign(_ok=ok)
    if "evalue" in m.columns:
        m = m.assign(_e=pd.to_numeric(m["evalue"], errors="coerce") <= evalue_max)
    else:
        m = m.assign(_e=False)
    g = m.groupby("key")
    agg = pd.DataFrame({"n_tags": g.size(), "n_correct": g["_ok"].sum(),
                        "n_tags_e001": g["_e"].sum(), "n_correct_e001": (m["_ok"] & m["_e"]).groupby(m["key"]).sum()})
    for k in ks:
        agg[f"top{k}"] = m[m["rank"] <= k].groupby("key")["_ok"].any()
    agg["top1"] = m[m["rank"] == 1].groupby("key")["_ok"].any()
    out = tr.merge(agg.reset_index(), on="key", how="left")
    out["tagged"] = (out["n_tags"].fillna(0) > 0).astype(int)
    for c in ["n_tags", "n_correct", "n_tags_e001", "n_correct_e001", "top1"] + [f"top{k}" for k in ks]:
        out[c] = out[c].fillna(0).astype(int)
    return out


def summarize(sc: pd.DataFrame, by: list[str], ks=(1, 5, 10, 50)) -> pd.DataFrame:
    """Per cell: spectra, scored (size > 0), tagged, rank-1 accuracy and top-k any-correct over tagged
    scored spectra, recall over scored spectra, per-tag precision, and per-tag precision at E <= 0.01.
    no_pool_candidate spectra are counted but never scored."""
    rows = []
    for key, g in sc.groupby(by, dropna=False, sort=True):
        key = key if isinstance(key, tuple) else (key,)
        s = g[g["size_label"] != "no_pool_candidate"] if "size_label" in g else g
        t = s[s["tagged"] == 1]
        r = dict(zip(by, key))
        r.update({"spectra": len(g), "scored": len(s), "tagged": len(t),
                  "tagged_rate": _f(len(t), len(s)), "rank1_accuracy": _f(t["top1"].sum(), len(t)),
                  "rank1_recall": _f(t["top1"].sum(), len(s))})
        for k in ks:
            if k != 1 and f"top{k}" in t:
                r[f"top{k}_any"] = _f(t[f"top{k}"].sum(), len(t))
        r["tag_precision"] = _f(s["n_correct"].sum(), s["n_tags"].sum())
        r["tags_e001"] = int(s["n_tags_e001"].sum())
        r["tag_precision_e001"] = _f(s["n_correct_e001"].sum(), s["n_tags_e001"].sum())
        rows.append(r)
    return pd.DataFrame(rows)


def _f(a, b) -> float:
    return round(float(a) / float(b), 6) if b else float("nan")


# ----------------------------------------------------------------------------------------------- config

def load(path: str | Path) -> dict:
    from .config import load_bench_config
    cfg = load_bench_config(path)
    u = cfg.setdefault("unidentified", {})
    u.setdefault("ratios", [1, 10])
    u.setdefault("tol_ppm", 10.0)
    u.setdefault("charges", [2, 3, 4])
    u.setdefault("iso", [0, 1])
    u.setdefault("max_var", 1)
    u.setdefault("decoy_seed", 1)
    u.setdefault("swap_seed", 1)
    u.setdefault("chimera_seed", 1)
    u.setdefault("max_pairs", 3000)
    u.setdefault("static", {"C": 57.021464})
    u.setdefault("variable", {"M": [15.994915]})
    u.setdefault("fastag_args", ["-fixed_modifications", "Carbamidomethyl (C)"])
    u.setdefault("profiles", {
        "default": [],
        "matched": ["-tag_length", "3", "-max_tags", "50", "-max_peaks", "100", "-peaks_per_window", "0", "-gaps", "0",
                    "-no_deisotope", "-fragment_tolerance", "0.02", "-fragment_tolerance_unit", "Da"],
        "matched_tl5": ["-tag_length", "5", "-max_tags", "50", "-max_peaks", "100", "-peaks_per_window", "0", "-gaps",
                        "0", "-no_deisotope", "-fragment_tolerance", "0.02", "-fragment_tolerance_unit", "Da"],
    })
    u.setdefault("chimera_profiles", ["matched", "matched_div"])
    u["profiles"].setdefault("matched_div", u["profiles"]["matched"] + ["-diversity"])
    return cfg


def _wd(cfg) -> Path:
    return Path(cfg["work_dir"])


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _prov(cfg, what: str) -> str:
    return f"source: fastag-bench {__version__} unidentified {what} ({_now()}, host {platform.node()})"


def _splits_path(cfg) -> Path:
    p = Path(cfg["unidentified"].get("splits_tsv", "config/proteometools_splits.tsv"))
    return p if p.is_absolute() else ROOT / p


def _split_pools(cfg, split: str) -> pd.DataFrame:
    df, _ = read_tsv(_splits_path(cfg))
    sel = df[df["split"] == split]
    if sel.empty:
        raise ValueError(f"no pools for split {split!r} in {_splits_path(cfg)}")
    return sel


def _files(cfg) -> pd.DataFrame:
    return PT.parse_files(json.loads(Path(cfg["unidentified"]["files_json"]).read_text()))


# ----------------------------------------------------------------------------------------------- steps

def step_splits(cfg, log=print) -> Path:
    out = _splits_path(cfg)
    if out.exists():
        raise FileExistsError(f"{out} exists: splits are drawn once (delete it only to redraw before any scoring)")
    pools = PT.pool_table(_files(cfg))
    pools = pools[pools["raw_3xhcd"] != ""]
    plan = cfg["unidentified"].get("plan") or PT.DEFAULT_PLAN
    a = T.split_pools(pools, plan)
    excl = [(x, s["split"]) for s in plan for x in (s.get("exclude_batches_of") or [])]
    T.assert_disjoint(a, batches=dict(zip(a["pool"], a["batch"])), batch_exclusive=excl)
    tab = a.merge(pools.drop(columns=["batch"]), on="pool", how="left")
    src = cfg["unidentified"]["files_json"]
    from .fetch import file_digest
    write_tsv(tab, out, [
        _prov(cfg, "splits"),
        f"PRIDE file list {src} (sha256 {file_digest(Path(src), 'sha256')}; PXD004732, {len(pools)} pools with a 3xHCD run); plan: "
        + "; ".join(f"{s['split']} seed {s['seed']} n {s['n']}" + (f" excl. batches of {','.join(s['exclude_batches_of'])}"
                                                                     if s.get('exclude_batches_of') else "") for s in plan),
        "pool = synthesis set + pool number (all repeats together); batch = LC-MS queue of the 3xHCD run; "
        "peptide-level disjointness is checked by pool-truth once the pool lists are fetched"])
    log(f"wrote {out}: " + ", ".join(f"{k} {v}" for k, v in a.groupby("split", sort=False).size().items()))
    return out


def _fetch(url: str, dest: Path, sha1: str | None, log=print) -> Path:
    from .fetch import download, file_digest
    if dest.exists() and (not sha1 or file_digest(dest, "sha1") == sha1):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    log(f"fetch {url}")
    download(url, dest)
    if sha1 and file_digest(dest, "sha1") != sha1:
        raise ValueError(f"{dest}: sha1 differs from PRIDE ({sha1})")
    return dest


def pool_dir(cfg, pool: str) -> Path:
    d = _wd(cfg) / "pools" / pool
    d.mkdir(parents=True, exist_ok=True)
    return d


def pool_peptides(cfg, pool: str) -> list[str]:
    p = pool_dir(cfg, pool) / "peptides.tsv"
    df, _ = read_tsv(p)
    return list(df["peptide"])


def _pool_truth(cfg, pools: list[str], files: pd.DataFrame, log=print) -> list[Path]:
    u = cfg["unidentified"]
    written = []
    for pool in pools:
        d = pool_dir(cfg, pool)
        if (d / "peptides.tsv").exists():
            continue
        zips = files[(files["kind"] == "search") & (files["pool"] == pool) & (files["search"] == "tryptic")]
        if zips.empty:
            raise ValueError(f"{pool}: no tryptic MaxQuant search in the PRIDE file list")
        peps: set[str] = set()
        srcs = []
        for z in zips.itertuples():
            zp = _fetch(z.url, d / "search" / z.file, z.sha1 or None, log)
            with zipfile.ZipFile(zp) as zf:
                name = next(n for n in zf.namelist() if Path(n).name == "peptides.txt")
                tmp = d / "search" / (z.file + ".peptides.txt")
                tmp.write_bytes(zf.read(name))
            got = PT.maxquant_pool_peptides(tmp, pool)
            srcs.append(f"{z.file} sha1 {z.sha1} ({len(got)})")
            peps |= got
        targets = sorted(peps)
        decoys = T.decoy_pool(targets, seed=int(u["decoy_seed"]))
        T.write_pool_fasta(d / "pool.fasta", targets, decoys, pool=pool)
        write_tsv(pd.DataFrame({"peptide": decoys}), d / "decoys.tsv", [
            _prov(cfg, f"pool-truth {pool}"), f"decoy pool: pooltruth.decoy_pool seed {u['decoy_seed']}"])
        write_tsv(pd.DataFrame({"peptide": targets}), d / "peptides.tsv", [
            _prov(cfg, f"pool-truth {pool}"),
            "pool list = union of MaxQuant-identified peptides assigned to the pool over its tryptic searches: "
            + "; ".join(srcs)])
        written.append(d / "peptides.tsv")
        log(f"{pool}: {len(targets)} pool peptides from {len(zips)} searches")
    return written


def _has_list(cfg, pool: str) -> bool:
    return (_wd(cfg) / "pools" / pool / "peptides.tsv").exists()


def step_pool_truth(cfg, split: str, log=print) -> list[Path]:
    """Pool lists of the split's pools and of their pool-swap partners; then peptide-level disjointness
    over every split whose lists are present."""
    files = _files(cfg)
    pools = list(_split_pools(cfg, split)["pool"])
    sw = swap_partners(cfg)
    written = _pool_truth(cfg, pools + sorted({sw[p] for p in pools}), files, log)
    sp, _ = read_tsv(_splits_path(cfg))
    have = {q: set(pool_peptides(cfg, q)) for q in sp["pool"] if _has_list(cfg, q)}
    T.assert_disjoint(sp[sp["pool"].isin(have)], peptides=have)
    swl = {sw[p]: set(pool_peptides(cfg, sw[p])) for p in pools}
    log(f"peptide-level disjointness holds over {len(have)} split pools with lists "
        f"({', '.join(f'{k} {v}' for k, v in sp[sp['pool'].isin(have)].groupby('split').size().items())}); "
        f"swap partners {', '.join(f'{p}->{sw[p]} ({len(swl[sw[p]])})' for p in pools)}")
    return written


def swap_partners(cfg) -> dict[str, str]:
    """Pool-swap partner of every split pool: a pool of another LC-MS batch that is in no split (so the
    chance candidates never come from scored or reserved pools), drawn with unidentified.swap_seed. Pool
    sizes are unknown before the lists are fetched, so all candidates count as equal size; swap_peptides
    matches the size afterwards."""
    sp, _ = read_tsv(_splits_path(cfg))
    allp = PT.pool_table(_files(cfg))
    allp = allp[allp["raw_3xhcd"] != ""]
    free = allp[~allp["pool"].isin(sp["pool"])]
    out = {}
    seed = int(cfg["unidentified"]["swap_seed"])
    for i, r in enumerate(sp.sort_values("pool").itertuples()):
        cand = sorted(free.loc[free["batch"] != r.batch, "pool"])
        if not cand:
            raise ValueError(f"{r.pool}: no unassigned pool in another batch")
        out[r.pool] = cand[int(np.random.default_rng([seed, i]).integers(len(cand)))]
    return out


def _mzml(cfg, r) -> Path:
    return _wd(cfg) / "data" / r.pool / (Path(r.raw_3xhcd).stem + ".mzML")


def _dataset(cfg):
    from .config import load_datasets
    ds_id = cfg["unidentified"].get("dataset_id", "PXD004732_ProteomeTools")
    return next(d for d in load_datasets(ROOT / "datasets.yaml") if d.id == ds_id)


def _sage(cfg, mode: str, mzml: Path, out: Path, pool_fasta: Path | None, log=print) -> Path:
    from .run import tool_path, tool_version
    from .sage import sage_config, write_sage_config
    from .timing import run_timed
    res = out / "results.sage.tsv"
    if res.exists():
        return res
    out.mkdir(parents=True, exist_ok=True)
    exe = tool_path(cfg, "sage")
    conf = write_sage_config(out / "sage.json", sage_config(_dataset(cfg), cfg["unidentified"]["human_fasta"], [mzml],
                                                         cfg["sage"], mode=mode, pool_fasta=pool_fasta))
    cmd = [exe, *map(str, cfg["sage"].get("args") or []), "-o", str(out), str(conf)]
    (out / "command.txt").write_text(" ".join(cmd) + "\n")
    (out / "version.txt").write_text(tool_version(exe, ("--version",), r"sage ?([^\n]+)") + "\n")
    t = run_timed(cmd, log=out / "run.log", env={**(cfg.get("env") or {}), "RAYON_NUM_THREADS": str(cfg["sage"].get("threads") or 32)})
    if t["returncode"] != 0 or not res.exists():
        raise RuntimeError(f"Sage {mode} failed on {mzml.name}: see {out / 'run.log'}")
    log(f"{mzml.name} sage {mode}: {t['wall_s']} s")
    return res


def step_sage_modes(cfg, split: str, log=print) -> None:
    from .convert import trfp_command
    from .run import tool_path
    from .timing import run_timed
    for r in _split_pools(cfg, split).itertuples():
        mz = _mzml(cfg, r)
        if not mz.exists():
            raw = _fetch(r.raw_url, mz.parent / r.raw_3xhcd, r.raw_sha1, log)
            t = run_timed(trfp_command(tool_path(cfg, "thermorawfileparser"), raw, mz.parent), log=mz.parent / "trfp.log")
            if t["returncode"] != 0 or not mz.exists():
                raise RuntimeError(f"ThermoRawFileParser failed on {raw}")
            raw.unlink()  # the raw file is ours (downloaded above) and re-fetchable; the mzML stays
        base = _wd(cfg) / "runs" / r.pool / "sage"
        _sage(cfg, "closed", mz, base / "closed", None, log)
        _sage(cfg, "pool", mz, base / "pool", pool_dir(cfg, r.pool) / "pool.fasta", log)


def _fastag(cfg, inp: Path, out: Path, profile: str, log=print) -> Path:
    from .run import tool_path, tool_version
    from .timing import run_timed
    tags = out / "tags.tsv"
    if tags.exists():
        return tags
    out.mkdir(parents=True, exist_ok=True)
    u = cfg["unidentified"]
    exe = tool_path(cfg, "fastag")
    cmd = [exe, "-in", str(inp), "-out", str(tags), "-threads", str(cfg["accuracy"]["threads"])]
    cmd += [str(a) for a in u["fastag_args"]] + [str(a) for a in u["profiles"][profile]]
    (out / "command.txt").write_text(" ".join(cmd) + "\n")
    (out / "version.txt").write_text(tool_version(exe) + "\n")
    t = run_timed(cmd, log=out / "run.log", env=cfg.get("env") or {})
    if t["returncode"] != 0:
        raise RuntimeError(f"FASTag {profile} failed on {inp}: see {out / 'run.log'}")
    log(f"{inp.name} fastag {profile}: {t['wall_s']} s")
    return tags


def step_run(cfg, split: str, log=print) -> None:
    u = cfg["unidentified"]
    for r in _split_pools(cfg, split).itertuples():
        for prof in [p for p in u["profiles"] if not p.endswith("_div")]:  # -diversity runs only on the chimeras
            _fastag(cfg, _mzml(cfg, r), _wd(cfg) / "runs" / r.pool / "fastag" / prof, prof, log)
    for ratio in u["ratios"]:
        mgf = _wd(cfg) / "chimeras" / split / f"ratio{ratio:g}" / "chimeras.mgf"
        if mgf.exists():
            for prof in u["chimera_profiles"]:
                _fastag(cfg, mgf, mgf.parent / "fastag" / prof, prof, log)


def _meta_table(cfg, r) -> pd.DataFrame:
    """Per-MS2 precursor meta of a pool run (cached TSV)."""
    p = _wd(cfg) / "runs" / r.pool / "ms2_meta.tsv"
    if p.exists():
        return read_tsv(p)[0]
    sp = CH.read_ms2(_mzml(cfg, r))
    df = pd.DataFrame([m for _, _, m in sp.values()])
    write_tsv(df, p, [_prov(cfg, f"ms2 meta {r.pool}"), f"from {_mzml(cfg, r)} (pyteomics)"])
    return df


def _s0(cfg, pool: str) -> pd.DataFrame:
    return P.read_sage_psms(_wd(cfg) / "runs" / pool / "sage" / "closed" / "results.sage.tsv", cfg["sage"]["fdr"])


def _pool_hits(cfg, pool: str) -> pd.DataFrame:
    f = _wd(cfg) / "runs" / pool / "sage" / "pool" / "results.sage.tsv"
    df = pd.read_csv(f, sep="\t")
    keep = (df["label"] == 1) & (df["spectrum_q"] <= cfg["sage"]["fdr"]) & (df["rank"] == 1)
    out = df.loc[keep, ["scannr", "peptide", "proteins", "spectrum_q"]].copy()
    out["key"] = out["scannr"].map(P.spectrum_key)
    out["entrapment"] = out["proteins"].astype(str).str.split(";").map(lambda ps: all(p.startswith("ENTRAP_") for p in ps))
    return out.drop_duplicates("key")


def step_chimera_build(cfg, split: str, log=print) -> list[Path]:
    u = cfg["unidentified"]
    spectra, metas = {}, []
    for r in _split_pools(cfg, split).itertuples():
        s0 = _s0(cfg, r.pool)
        sp = CH.read_ms2(_mzml(cfg, r), set(s0["key"]))
        pep = dict(zip(s0["key"], s0["peptide"]))
        for k, (mz, it, m) in sp.items():
            kk = f"{r.pool}:{k}"
            m = {**m, "key": kk, "peptide": pep[k], "pool": r.pool, "instrument": "Orbitrap Fusion Lumos"}
            spectra[kk] = (mz, it, m)
            metas.append(m)
    meta = pd.DataFrame(metas)
    pairs = CH.pair_spectra(meta, seed=int(u["chimera_seed"]), max_pairs=int(u["max_pairs"]))
    written = []
    for ratio in u["ratios"]:
        ch, rej = CH.build_chimeras(spectra, pairs, ratio=float(ratio))
        d = _wd(cfg) / "chimeras" / split / f"ratio{ratio:g}"
        written += CH.write_chimeras(ch, d / "chimeras.mgf", d / "chimeras.tsv", [
            _prov(cfg, f"chimera-build {split} ratio {ratio:g}"),
            f"{len(ch)} chimeras from {len(pairs)} pairs of S0 spectra (closed Sage q <= {cfg['sage']['fdr']}) of "
            f"different pools; seed {u['chimera_seed']}; rejected {len(rej)}; unit-TIC, minor 1/ratio, 0.002 Da summed collapse"])
        log(f"{split} ratio {ratio:g}: {len(ch)} chimeras")
    return written


def _tags(path: Path, prefix: str = "") -> pd.DataFrame:
    t = P.read_fastag_tags(path)
    if prefix:
        t["key"] = prefix + t["key"]
    return t


def _norm_set(c) -> set[str]:
    return {S.normalize_peptide(p) for p in c}


def _cluster(c, pool: str) -> str:
    ids = _norm_set(c)
    return next(iter(ids)) if len(ids) == 1 else pool


def score_pool(cfg, r, swap_pool: str, carry_pools: list[str], log=print) -> tuple[pd.DataFrame, dict]:
    """All arms of one pool run. Rows: key x profile x arm with the score_spectra columns plus
    identification, size_label, cluster, pool. Arms: S0 'truth' (closed-search peptide) and 'chance'
    (shuffled_peptides over S0); S3-PT 'truth' (pool candidates), 'chance' (pool-swap candidates under
    the same mass constraint) and 'byproduct' (byproduct candidates only). size_label and cluster always
    come from the real candidate set ('s0' for S0)."""
    u = cfg["unidentified"]
    st, var, mv = u["static"], u["variable"], int(u["max_var"])
    tol, zs, iso = float(u["tol_ppm"]), tuple(u["charges"]), tuple(u["iso"])
    peps = pool_peptides(cfg, r.pool)
    sw_peps = T.swap_peptides(peps, pool_peptides(cfg, swap_pool), seed=int(u["swap_seed"]))
    co = [p for q in carry_pools if _has_list(cfg, q) for p in pool_peptides(cfg, q)]
    decoys = list(read_tsv(pool_dir(cfg, r.pool) / "decoys.tsv")[0]["peptide"])
    idx = T.PoolIndex.from_peptides(peps, st, var, mv, cls="target", byproducts=True, decoys=decoys, carryover=co)
    sidx = T.PoolIndex.from_peptides(sw_peps, st, var, mv, cls="target")
    meta = _meta_table(cfg, r)
    s0 = _s0(cfg, r.pool)
    ax = assign_axes(meta[["key"]], set(s0["key"]), pt_keys=set(meta["key"]))
    ax = ax.merge(meta[["key", "precursor_mz", "charge", "nce"]], on="key").assign(pool=r.pool)
    s0p = dict(zip(s0["key"], s0["peptide"]))
    shp = dict(zip(*S.shuffled_peptides(s0, seed=int(u["swap_seed"]))[["key", "peptide"]].to_numpy().T)) if len(s0) else {}
    arms: dict[str, list] = {"truth": [], "chance": [], "byproduct": []}
    extra = []
    for m in ax.itertuples():
        if m.identification == "S0":
            arms["truth"].append([s0p[m.key]])
            arms["chance"].append([shp[m.key]] if m.key in shp else [])
            arms["byproduct"].append([])
            extra.append({"size_label": "s0", "cluster": S.normalize_peptide(s0p[m.key]),
                          "n_byproduct": 0, "n_decoy": 0, "n_carryover": 0})
            continue
        ms = {"precursor_mz": m.precursor_mz, "charge": None if pd.isna(m.charge) else int(m.charge)}
        c = T.candidates_by_mass(ms, idx, tol, zs, iso)
        cs = T.candidates_by_mass(ms, sidx, tol, zs, iso)
        tv = [v for vs in c["target"].values() for v in vs]
        arms["truth"].append(tv)
        arms["chance"].append([v for vs in cs["target"].values() for v in vs])
        arms["byproduct"].append([v for vs in c["byproduct"].values() for v in vs])
        extra.append({"size_label": T.size_label(len(c["target"])), "cluster": _cluster(tv, r.pool),
                      "n_byproduct": len(c["byproduct"]), "n_decoy": len(c["decoy"]), "n_carryover": len(c["carryover"])})
    lab = pd.concat([ax.reset_index(drop=True), pd.DataFrame(extra)], axis=1)
    parts = []
    for prof in [p for p in u["profiles"] if not p.endswith("_div")]:
        tags = _tags(_wd(cfg) / "runs" / r.pool / "fastag" / prof / "tags.tsv")
        for arm, cl in arms.items():
            tr = lab[["key"]].assign(candidates=cl)
            sc = score_spectra(tags, tr).drop(columns=["candidates", "size_label"])
            parts.append(lab.merge(sc, on="key").assign(arm=arm, profile=prof, swap_pool=swap_pool))
    # validity controls
    ph = _pool_hits(cfg, r.pool)
    both = s0.merge(ph[~ph["entrapment"]], on="key", suffixes=("_closed", "_pool"))
    agree = float(np.mean([S.normalize_peptide(a) == S.normalize_peptide(b)
                           for a, b in zip(both["peptide_closed"], both["peptide_pool"])])) if len(both) else np.nan
    s3 = lab[lab["identification"] == "S3-PT"]
    ph3 = ph[ph["key"].isin(set(s3["key"]))]
    ctl = {"pool": r.pool, "batch": r.batch, "swap_pool": swap_pool, "pool_peptides": len(peps),
           "swap_peptides": len(sw_peps), "ms2": len(meta), "s0": len(s0), "s3": len(s3),
           "both_identified": len(both), "pool_agreement": round(agree, 6) if len(both) else np.nan,
           "pool_excluded": bool(len(both) and agree < 0.95),
           "s3_pool_target_hits": int((~ph3["entrapment"]).sum()), "s3_entrapment_hits": int(ph3["entrapment"].sum()),
           "s3_entrapment_share": _f(ph3["entrapment"].sum(), len(ph3)),
           "s3_labels_uncertain": bool(len(ph3) and ph3["entrapment"].sum() / len(ph3) > 1.5 * cfg["sage"]["fdr"]),
           **{f"s3_{k}": int((s3["size_label"] == k).sum()) for k in T.SIZE_LABELS},
           "s3_with_byproduct": int((s3["n_byproduct"] > 0).sum()), "s3_with_decoy_candidate": int((s3["n_decoy"] > 0).sum()),
           "s3_with_carryover": int((s3["n_carryover"] > 0).sum()), "carryover_pools": ";".join(carry_pools)}
    log(f"{r.pool}: MS2 {len(meta)}, S0 {len(s0)}, S3 {len(s3)} (size1 {ctl['s3_size1']}, pool_consistent "
        f"{ctl['s3_pool_consistent']}, none {ctl['s3_no_pool_candidate']}), agreement {agree:.4f}")
    return pd.concat(parts, ignore_index=True), ctl


def step_score(cfg, split: str, log=print) -> list[Path]:
    u = cfg["unidentified"]
    pools = _split_pools(cfg, split)
    sw = swap_partners(cfg)
    carry = T.carryover_pools(PT.pool_table(_files(cfg)))
    out_dir = Path(cfg["results_dir"]) / "unidentified" / split
    parts, controls = [], []
    for r in pools.itertuples():
        sc, ctl = score_pool(cfg, r, sw[r.pool], carry.get(r.pool, []), log)
        parts.append(sc)
        controls.append(ctl)
    prov = [_prov(cfg, f"score {split}"),
            f"FASTag {_ver(_wd(cfg) / 'runs' / pools['pool'].iloc[0] / 'fastag' / 'matched')}; truth Sage closed (full human "
            f"proteome) q <= {cfg['sage']['fdr']}; S3-PT candidates: pool peptides within {u['tol_ppm']} ppm, charges "
            f"{u['charges']} when none given, isotope errors {u['iso']}, static {u['static']}, variable {u['variable']} "
            f"(max {u['max_var']}); flank rule for any candidate (score.tag_correct_any)",
            "arm truth = real candidates; chance = S0: shuffled_peptides, S3-PT: pool-swap candidates (another batch, "
            "shared identities removed, same mass constraint); byproduct = byproduct candidates only; cluster = "
            "normalized peptide (one identity) or pool (pool_consistent)"]
    written = [write_tsv(pd.concat(parts, ignore_index=True), out_dir / "spectra.tsv", prov),
               write_tsv(pd.DataFrame(controls), out_dir / "controls.tsv", prov[:2])]
    rows = []
    for ratio in u["ratios"]:
        d = _wd(cfg) / "chimeras" / split / f"ratio{ratio:g}"
        if not (d / "chimeras.tsv").exists():
            continue
        chim = read_tsv(d / "chimeras.tsv")[0]
        for prof in u["chimera_profiles"]:
            f = d / "fastag" / prof / "tags.tsv"
            if f.exists():
                _, per = CH.attribute_tags(_tags(f), chim, k=50)
                per = per.merge(chim[["key", "parent1", "parent2", "pep1", "pep2"]], on="key")
                rows.append(per.assign(ratio=float(ratio), profile=prof))
    if rows:
        written.append(write_tsv(pd.concat(rows, ignore_index=True), out_dir / "chimeras.tsv", prov[:1] + [
            "both_topk: a correct tag for each parent within the top 50 (flank rule against each parent's peptide); "
            "pep1_rank1: rank-1 tag correct for the dominant parent"]))
    for p in written:
        log(f"wrote {p}")
    return written


def _ver(d: Path) -> str:
    v = d / "version.txt"
    return v.read_text().strip() if v.exists() else "unknown"


def step_collect(cfg, split: str, log=print) -> list[Path]:
    import importlib.util
    spec = importlib.util.spec_from_file_location("stats_unidentified", ROOT / "scripts" / "stats_unidentified.py")
    SU = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(SU)
    return SU.collect(Path(cfg["results_dir"]) / "unidentified" / split, log=log)


def step_v190_check(cfg, log=print) -> Path:
    """Re-export the v1.9.0 pair table from the stored run directories with this harness and compare it
    with the stored table (provenance lines excluded)."""
    import importlib.util
    import types
    spec = importlib.util.spec_from_file_location("stats_paired", ROOT / "scripts" / "stats_paired.py")
    SP = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(SP)
    v = cfg["unidentified"]["v190"]
    out = _wd(cfg) / "v190" / "accuracy_pairs_v190.rerun.tsv.gz"
    out.parent.mkdir(parents=True, exist_ok=True)
    SP.export(types.SimpleNamespace(fastag_work=v["fastag_work"], directag_work=v["directag_work"], data_dir=v["data_dir"],
                                    datasets=str(ROOT / "datasets.yaml"), fdr=0.01, out=str(out)))
    new, _ = SP.read_any_tsv(out)
    old, _ = SP.read_any_tsv(v["pairs"])
    same = new.shape == old.shape and new.astype(str).equals(old.astype(str))
    counts, nst = True, 0
    if v.get("stats") and Path(v["stats"]).exists():
        st, _ = SP.read_any_tsv(v["stats"])
        tab = SP.paired_table(new, n_boot=10)
        key = ["dataset", "truth", "tag_length", "metric", "scope"]
        cols = ["spectra", "peptides", "fastag_correct", "directag_correct", "only_fastag", "only_directag"]
        m = st[key + cols].merge(tab[key + cols], on=key, suffixes=("_s", "_n"), how="outer", indicator=True)
        counts = bool((m["_merge"] == "both").all() and all((m[f"{c}_s"] == m[f"{c}_n"]).all() for c in cols))
        nst = len(m)
    rep = _wd(cfg) / "v190" / "v190_check.txt"
    rep.write_text(f"{_prov(cfg, 'v190-check')}\npairs rows {len(new)} vs stored {len(old)}; identical: {same}\n"
                   f"stats rows {nst}; counts identical: {counts}\n")
    log(rep.read_text())
    if not (same and counts):
        raise RuntimeError("v1.9.0 regression check FAILED")
    return rep


def run_step(cfg, step: str, split: str | None, log=print):
    if step == "splits":
        return step_splits(cfg, log)
    if step == "v190-check":
        return step_v190_check(cfg, log)
    if split is None:
        raise ValueError(f"step {step} needs --split")
    return {"pool-truth": step_pool_truth, "sage-modes": step_sage_modes, "run": step_run,
            "chimera-build": step_chimera_build, "score": step_score, "collect": step_collect}[step](cfg, split, log)
