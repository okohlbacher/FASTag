"""Tag accuracy against database-search ground truth (paper Figure 3, open issue 2).

Four tagger profiles per dataset, all on the same mzML:

  fastag_default    FASTag defaults (TL 3, one-gap tags, gap penalty 100, 50 tags, 400 peaks with
                    10 per 100 Da window, deisotoping, 20 ppm) plus the dataset's modifications and
                    `tagger.fastag_default_args` (only the fragment tolerance of low-resolution data)
  fastag_matched    FASTag at DirecTag's default algorithm settings: TL 3, 50 tags, 100 peaks, no
                    window quota, no gaps, no deisotoping, fragment tolerance `tagger.fragment_tol_da`
  directag_default  DirecTag 1.4.21142 hard-coded defaults (TL 3, 50 tags, 100 peaks, 0.5 Da) plus
                    the dataset's static modifications
  directag_matched  DirecTag with fragment/complement tolerance `tagger.fragment_tol_da` and isotope
                    tolerance half of it (capped at DirecTag's 0.25 Da default)

Ground truth: Sage (and Comet where run) target PSMs at 1% spectrum-level FDR. Correctness: the
flank rule of score.py (primary) and the sequence-only rule (secondary); the shuffled-peptide
control gives the chance level. Result tables go to <results_dir>/accuracy/<dataset>/ and are
collected into <results_dir>/tag_accuracy_*.tsv.
"""
from __future__ import annotations

import datetime as _dt
import platform
import re
import shutil
from pathlib import Path

import numpy as np
import pandas as pd

from . import __version__
from . import parsers as P
from . import score as S
from .config import Dataset
from .run import append_timing, inputs, run_dir, tool_path, tool_version
from .timing import run_timed
from .tsv import read_tsv, write_tsv

DT_CACHE = "directag_intensity_ranksum_bins.cache"
PROFILES = ("fastag_default", "fastag_matched", "directag_default", "directag_matched")
EVALUE_BINS = [0, 1e-4, 1e-3, 1e-2, 1e-1, 1, 10, 100, 1e12]
LOG10E_EDGES = np.round(np.arange(-8.0, 4.01, 0.25), 2)
CV_PATCH = {  # same-length replacements of header-only CV terms DirecTag's 2012 ProteoWizard rejects
    b"MS:1003378": b"MS:1000483",  # Orbitrap Astral -> Thermo Fisher Scientific instrument model
    b"MS:1003379": b"MS:1000084",  # asymmetric track lossless TOF analyzer -> time-of-flight
    b"MS:1003145": b"MS:1000799",  # ThermoRawFileParser -> custom unreleased software tool
}


def _now() -> str:
    return _dt.datetime.now().astimezone().isoformat(timespec="seconds")


def profile_args(ds: Dataset, profile: str) -> tuple[str, list[str]]:
    """(tool, extra arguments) of a profile for a dataset (threads and I/O are added by the runner)."""
    tg = ds.tagger or {}
    tol = float(tg.get("fragment_tol_da", 0.02))
    m = re.fullmatch(r"(fastag|directag)_matched_tl(\d+)", profile)
    if m:  # matched settings at another tag length (precision by tag length)
        tool, args = profile_args(ds, f"{m.group(1)}_matched")
        flag = "-tag_length" if tool == "fastag" else "-TagLength"
        i = args.index(flag)
        return tool, args[:i + 1] + [m.group(2)] + args[i + 2:]
    if profile == "fastag_default":
        return "fastag", [*map(str, ds.fastag_args), *map(str, tg.get("fastag_default_args", []))]
    if profile == "fastag_matched":
        return "fastag", [*map(str, ds.fastag_args), "-tag_length", "3", "-max_tags", "50", "-max_peaks", "100",
                          "-peaks_per_window", "0", "-gaps", "0", "-no_deisotope",
                          "-fragment_tolerance", f"{tol:g}", "-fragment_tolerance_unit", "Da"]
    static = tg.get("directag_static_mods", "C 57.021464")
    base = ["-StaticMods", static] if static else []
    if profile == "directag_default":
        return "directag", base
    if profile == "directag_matched":
        return "directag", base + ["-TagLength", "3", "-MaxTagCount", "50", "-MaxPeakCount", "100",
                                   "-FragmentMzTolerance", f"{tol:g}", "-ComplementMzTolerance", f"{tol:g}",
                                   "-IsotopeMzTolerance", f"{min(0.25, tol / 2):g}"]
    raise ValueError(f"unknown profile {profile}")


def patch_cv_terms(src: Path, dst: Path, chunk: int = 1 << 24) -> int:
    """Copy src to dst replacing CV_PATCH accessions (same length, so mzML index offsets hold).
    Returns the number of replacements."""
    n, tail = 0, b""
    keep = max(len(k) for k in CV_PATCH) - 1
    with open(src, "rb") as fi, open(dst, "wb") as fo:
        while True:
            buf = fi.read(chunk)
            data = tail + buf
            for k, v in CV_PATCH.items():
                n += data.count(k)
                data = data.replace(k, v)
            if not buf:
                fo.write(data)
                break
            fo.write(data[:-keep])
            tail = data[-keep:]
    return n


def run_profile(cfg: dict, ds: Dataset, profile: str, threads: int, label: str | None = None,
                extra: list[str] | None = None, rep: int = 1, log=print) -> dict | None:
    """Run one tagger profile; outputs in work/runs/<dataset>/<tool>/<label>/."""
    tool, args = profile_args(ds, profile)
    args = args + [str(a) for a in (extra or [])]
    label = label or profile
    exe = tool_path(cfg, tool)
    if exe is None:
        log(f"{ds.id}: {tool} not found ({cfg['tools'].get(tool)}); skipping {profile}")
        return None
    ins = inputs(cfg, ds, ("mzml",))
    if not ins:
        log(f"{ds.id}: no mzML input")
        return None
    inp = ins[0][1].resolve()
    d = run_dir(cfg, ds, tool, label)
    env = dict(cfg.get("env") or {})
    if tool == "fastag":
        cmd = [exe, "-in", str(inp), "-out", str(d / "tags.tsv"), "-threads", str(threads), *args]
        ver = tool_version(exe)
        cwd = None
    else:
        if (ds.tagger or {}).get("directag_input") == "mgf":
            # DirecTag reads 0 spectra from the OpenMS-written ddaPASEF mzML; the MGF it was made
            # from carries the same spectra in the same order (pwiz native IDs index=<n> as in the mzML)
            pk = [f for f in ds.files if f.role == "peak"]
            if pk and (Path(cfg["data_dir"]) / ds.pxd / pk[0].name).exists():
                inp = (Path(cfg["data_dir"]) / ds.pxd / pk[0].name).resolve()
        if (ds.tagger or {}).get("directag_cv_patch"):
            patched = Path(cfg["work_dir"]) / "patched" / ds.id / inp.name
            if not patched.exists():
                patched.parent.mkdir(parents=True, exist_ok=True)
                n = patch_cv_terms(inp, patched)
                log(f"{ds.id}: CV-patched copy for DirecTag ({n} replacements): {patched}")
            inp = patched
        for old in d.glob("*.tags"):
            old.unlink()
        cache = cfg["directag"].get("cache_dir")
        if cache and (Path(cache) / DT_CACHE).exists():
            # DirecTag's intensity rank-sum table depends only on its settings, not on the data; a
            # shared copy avoids recomputing it (single-threaded, minutes at TL 6) in every run directory
            shutil.copy2(Path(cache) / DT_CACHE, d / DT_CACHE)
        cmd = [exe, "-cpus", str(threads), *args, "-OutputFormat", "tags", str(inp)]
        ver = "DirecTag " + tool_version(exe, ("--help",), r"DirecTag ([^\s]+)")
        env["LC_ALL"] = "C"
        cwd = d
    (d / "command.txt").write_text(" ".join(cmd) + "\n")
    (d / "version.txt").write_text(ver + "\n")
    t = run_timed(cmd, log=d / "run.log", env=env, cwd=cwd)
    cache = cfg["directag"].get("cache_dir") if tool == "directag" else None
    if cache and (d / DT_CACHE).exists() and t["returncode"] == 0:
        Path(cache).mkdir(parents=True, exist_ok=True)
        dst = Path(cache) / DT_CACHE
        if not dst.exists() or (d / DT_CACHE).stat().st_size > dst.stat().st_size:
            shutil.copy2(d / DT_CACHE, dst)
    row = {"dataset": ds.id, "pxd": ds.pxd, "tool": tool, "input": inp.name, "format": "mzml", "threads": threads,
           "rep": rep, "label": label, **t, "summary": profile, "out_dir": str(d)}
    append_timing(cfg, row)
    log(f"{ds.id} {label}: {t['wall_s']} s, {t['maxrss_kb'] // 1024} MB, load {t['load1_before']}->{t['load1_after']}, "
        f"rc {t['returncode']}")
    return row


def read_profile_tags(cfg: dict, ds: Dataset, label: str) -> tuple[pd.DataFrame | None, str]:
    """Tags of a finished profile run, with rank, key, length, nterm_mass, cterm_mass."""
    for tool in ("fastag", "directag"):
        d = Path(cfg["work_dir"]) / "runs" / ds.id / tool / label
        if tool == "fastag" and (d / "tags.tsv").exists():
            df = P.read_fastag_tags(d / "tags.tsv")
            return df, _ver(d)
        if tool == "directag":
            tags = sorted(d.glob("*.tags"))
            if tags:
                return P.read_directag_tags(tags[0]), _ver(d)
    return None, ""


def _ver(d: Path) -> str:
    v = d / "version.txt"
    return v.read_text().strip() if v.exists() else "unknown"


def ground_truth(cfg: dict, ds: Dataset, engine: str) -> tuple[pd.DataFrame | None, str]:
    fdr = cfg["sage"]["fdr"]
    if engine == "sage":
        f = Path(cfg["work_dir"]) / "runs" / ds.id / "sage" / "default" / "results.sage.tsv"
        if f.exists():
            return P.read_sage_psms(f, fdr), f"Sage {_ver(f.parent)} ({f})"
    elif engine == "comet":
        d = Path(cfg["work_dir"]) / "runs" / ds.id / "comet" / "default"
        txt = sorted(d.glob("*.txt"))
        if txt:
            static = {k: float(v) for k, v in (ds.fixed_mods or {}).items()}
            return P.read_comet_psms(txt[0], fdr, static_mods=static), f"Comet {_ver(d)} ({txt[0]})"
    elif engine == "mascot":
        if (ds.search or {}).get("mascot_truth") is False:
            return None, ""
        f = ds.file("search")
        p = Path(cfg["data_dir"]) / ds.pxd / f.name if f else None
        if p and p.exists() and p.suffix == ".dat":
            static = {k: float(v) for k, v in (ds.fixed_mods or {}).items()}
            return P.read_mascot_dat(p, fdr, static_mods=static), f"Mascot ({p.name}, deposited search)"
    return None, ""


def score_profile(tags: pd.DataFrame, psms: pd.DataFrame, max_k: int = 50, seed: int = 0) -> dict[str, pd.DataFrame]:
    """All accuracy tables for one tag set against one ground truth."""
    ks = (1, 5, 10, 50)
    sh = S.shuffled_psms(psms, seed)
    summ, topk, bylen = [], [], []
    for rule in S.RULES:
        for control, gt in (("none", psms), ("shuffled peptides", sh)):
            summ.append({"rule": rule, "control": control, **S.score_tags(tags, gt, ks, rule)})
            pl = S.precision_by(tags, gt, "length", rule=rule)
            pl.insert(0, "control", control)
            pl.insert(0, "rule", rule)
            bylen.append(pl)
        c = S.rank_curve(tags, psms, max_k, rule)
        c.insert(0, "rule", rule)
        topk.append(c)
    out = {"summary": pd.DataFrame(summ), "topk": pd.concat(topk), "by_length": pd.concat(bylen)}
    if "evalue" in tags.columns:
        m = S._mark(tags, psms, "flank")
        e = pd.to_numeric(m["evalue"], errors="coerce")
        g = pd.cut(e, EVALUE_BINS, include_lowest=True)
        be = m.groupby(g, observed=True).agg(tags=("correct", "size"), correct=("correct", "sum"),
                                             correct_seq=("correct_seq", "sum")).reset_index()
        be["precision"] = be["correct"] / be["tags"]
        be["precision_seq"] = be["correct_seq"] / be["tags"]
        be["evalue"] = be["evalue"].astype(str)
        out["by_evalue"] = be
        le = np.log10(e.clip(lower=10.0 ** LOG10E_EDGES[0]))
        rows = []
        for subset, mask in (("all tags", np.ones(len(m), bool)), ("rank 1", (m["rank"] == 1).to_numpy())):
            for cls, sel in (("correct", m["correct"].to_numpy()), ("incorrect", ~m["correct"].to_numpy())):
                v = le[mask & sel]
                h, _ = np.histogram(v, LOG10E_EDGES)
                tot = max(int(h.sum()), 1)
                for lo, hi, n in zip(LOG10E_EDGES[:-1], LOG10E_EDGES[1:], h):
                    rows.append({"subset": subset, "class": cls, "log10e_lo": lo, "log10e_hi": hi, "tags": int(n),
                                 "density": n / tot / (hi - lo), "median_evalue": float(np.median(10 ** v)) if len(v) else np.nan,
                                 "n_class": int(len(v))})
        out["evalue_density"] = pd.DataFrame(rows)
    return out


def score_dataset(cfg: dict, ds: Dataset, labels: list[str], engines=("sage", "comet", "mascot"), log=print) -> list[Path]:
    out_dir = Path(cfg["results_dir"]) / "accuracy" / ds.id
    written = []
    max_k = int((cfg.get("accuracy") or {}).get("max_k", 50))
    for engine in engines:
        psms, gsrc = ground_truth(cfg, ds, engine)
        if psms is None:
            continue
        log(f"{ds.id}: {engine}: {len(psms)} target PSMs at q <= {cfg['sage']['fdr']}")
        tabs: dict[str, list[pd.DataFrame]] = {}
        vers = []
        for label in labels:
            tags, ver = read_profile_tags(cfg, ds, label)
            if tags is None:
                continue
            vers.append(f"{label}={ver}")
            for name, df in score_profile(tags, psms, max_k).items():
                df = df.copy()
                df.insert(0, "profile", label)
                df.insert(0, "truth", engine)
                df.insert(0, "pxd", ds.pxd)
                df.insert(0, "dataset", ds.id)
                tabs.setdefault(name, []).append(df)
            s = tabs["summary"][-1]
            r = s[(s.rule == "flank") & (s.control == "none")].iloc[0]
            log(f"  {label}: rank-1 {r['top1_correct']}/{r['psm_spectra_tagged']} tagged "
                f"({r['top1_precision']:.4f}), recall any {r['any_tag_recall']:.4f}, per-tag {r['all_tags_precision']:.4f}")
        prov = [f"source: fastag-bench {__version__} accuracy: {ds.pxd} ({ds.id}); truth {gsrc}; host {platform.node()}; {_now()}",
                "tools: " + "; ".join(vers),
                "rule flank: tag or reverse is a substring of the PSM peptide (I=L) and one flanking mass agrees within "
                "0.05 Da; rule sequence: substring only; control 'shuffled peptides': peptides permuted between spectra"]
        for name, parts in tabs.items():
            written.append(write_tsv(pd.concat(parts), out_dir / f"{engine}_{name}.tsv", prov))
    return written


def truth_overlap(cfg: dict, ds: Dataset) -> dict | None:
    """Agreement of two ground truths on shared spectra (same stripped peptide, I=L)."""
    a, _ = ground_truth(cfg, ds, "sage")
    b, _ = ground_truth(cfg, ds, "comet")
    if a is None or b is None:
        return None
    m = a.merge(b, on="key", suffixes=("_sage", "_comet"))
    same = sum(S.normalize_peptide(x) == S.normalize_peptide(y) for x, y in zip(m["peptide_sage"], m["peptide_comet"]))
    return {"dataset": ds.id, "pxd": ds.pxd, "sage_psms": len(a), "comet_psms": len(b), "both": len(m),
            "same_peptide": int(same), "sage_only": len(set(a.key) - set(b.key)), "comet_only": len(set(b.key) - set(a.key))}


def collect(results_dir: str | Path, tag: str = "v180") -> list[Path]:
    """Concatenate per-dataset tables into <results_dir>/tag_accuracy_<table>_<tag>.tsv."""
    base = Path(results_dir)
    written = []
    names = sorted({re.sub(r"^[a-z]+_", "", p.stem) for p in base.glob("accuracy/*/*.tsv")})
    for name in names:
        parts, prov = [], []
        for p in sorted(base.glob(f"accuracy/*/*_{name}.tsv")):
            df, pv = read_tsv(p)
            parts.append(df)
            prov += [x for x in pv[:1]]
        if parts:
            head = [f"source: fastag-bench {__version__} accuracy collect ({_now()}): {len(parts)} tables",
                    "rule flank: tag or reverse is a substring of the PSM peptide (I=L) and one flanking mass agrees "
                    "within 0.05 Da; rule sequence: substring only"] + [f"part: {x}" for x in prov]
            written.append(write_tsv(pd.concat(parts), base / f"tag_accuracy_{name}_{tag}.tsv", head))
    return written


# ---------------------------------------------------------------- pre-port sweeps (PXD000001)

SWEEP_BASE = ["-tag_length", "4", "-gaps", "1", "-max_tags", "0"]  # protocol of the pre-port sweeps


def _sweep_metrics(tags: pd.DataFrame, psms: pd.DataFrame) -> dict:
    m = S._mark(tags, psms, "flank")
    tagged = m["key"].nunique()
    top = m[m["rank"] == 1]
    first = m[m["correct"]].groupby("key")["rank"].min()
    g1 = top[pd.to_numeric(top.get("gapped", 0), errors="coerce") == 1] if "gapped" in top else top.iloc[:0]
    return {"psm_spectra": psms["key"].nunique(), "tagged": tagged,
            "rank1_pct": round(100 * top["correct"].sum() / tagged, 3) if tagged else np.nan,
            "top5_pct": round(100 * (first <= 5).sum() / tagged, 3) if tagged else np.nan,
            "total_pct": round(100 * len(first) / tagged, 3) if tagged else np.nan,
            "rank1_recall_pct": round(100 * top["correct"].sum() / psms["key"].nunique(), 3),
            "gapped_share_rank1_pct": round(100 * len(g1) / tagged, 3) if tagged else np.nan,
            "gapped_rank1_correct_pct": round(100 * g1["correct"].mean(), 3) if len(g1) else np.nan,
            "tags": len(tags)}


def sweep(cfg: dict, ds: Dataset, kind: str, engines=("sage", "mascot"), log=print) -> Path | None:
    """-gap_penalty or peak-budget sweep: FASTag at each setting (sweep_reps timed runs at
    sweep_threads), scored against each available ground truth with the flank rule."""
    acc = cfg["accuracy"]
    if kind == "gap_penalty":
        settings = [(f"gp{g:g}", ["-gap_penalty", f"{g:g}"], {"gap_penalty": g}) for g in acc["gap_penalties"]]
    elif kind == "peak_budget":
        settings = [(f"ppw{w}_max{p}", ["-peaks_per_window", str(w), "-max_peaks", str(p)],
                     {"peaks_per_window": w, "max_peaks": p}) for w, p in acc["peak_budgets"]]
    else:
        raise ValueError(kind)
    truths = [(e, *ground_truth(cfg, ds, e)) for e in engines]
    truths = [(e, p, s) for e, p, s in truths if p is not None]
    if not truths:
        log(f"{ds.id}: no ground truth for the sweep")
        return None
    thr, reps = int(acc["sweep_threads"]), int(acc["sweep_reps"])
    ncpu = __import__("os").cpu_count() or 1
    rows, vers = [], set()
    for label, extra, meta in settings:
        times = []
        for rep in range(1, reps + 1):
            r = run_profile(cfg, ds, "fastag_default", thr, label=f"sweep_{kind}_{label}",
                            extra=SWEEP_BASE + extra, rep=rep, log=log)
            if r is None or r["returncode"] != 0:
                break
            times.append(r)
        if not times:
            continue
        tags, ver = read_profile_tags(cfg, ds, f"sweep_{kind}_{label}")
        vers.add(ver)
        walls = [t["wall_s"] for t in times]
        loads = [t["load1_before"] for t in times] + [t["load1_after"] for t in times]
        base = {**meta, "threads": thr, "reps": len(walls), "wall_min_s": min(walls),
                "wall_median_s": float(np.median(walls)), "cpu_median_s": float(np.median([t["cpu_s"] for t in times])),
                "maxrss_mb": round(max(t["maxrss_kb"] for t in times) / 1024), "load1_max": max(loads),
                "load_per_core_max": round(max(loads) / ncpu, 4),
                "timing_valid": max(loads) / ncpu < 0.25}
        for engine, psms, _ in truths:
            rows.append({**base, "truth": engine, **_sweep_metrics(tags, psms)})
    df = pd.DataFrame(rows)
    tag = str(acc.get("result_tag", "v180"))
    out = Path(cfg["results_dir"]) / f"{kind}_{ds.pxd.lower()}_{tag}.tsv"
    prov = [f"source: fastag-bench {__version__} accuracy sweep {kind}: {ds.pxd} ({ds.id}); host {platform.node()} "
            f"({ncpu} logical CPUs); {_now()}",
            f"FASTag {'; '.join(sorted(vers))}; base args {' '.join(map(str, ds.fastag_args))} {' '.join(SWEEP_BASE)}; "
            f"{thr} thread(s), {reps} reps, wall min/median; timing_valid = load/core < 0.25 before and after every rep",
            "truths: " + "; ".join(f"{e}: {s}" for e, _, s in truths),
            "rank1/top5/total over PSM spectra with >= 1 tag; rule flank (substring, I=L, one flank within 0.05 Da); "
            "rank = file order (E-value after the gap penalty)"]
    return write_tsv(df, out, prov)


def runs_table(cfg: dict, tag: str = "v180") -> Path | None:
    """Every accuracy run (searches and tagger profiles, not the sweeps) with tool version, command
    line, wall/CPU time, peak RSS and load: <results_dir>/tag_accuracy_runs_<tag>.tsv. Times come from
    a node shared with the other accuracy jobs and are not benchmarks."""
    t = Path(cfg["work_dir"]) / "timing.tsv"
    if not t.exists():
        return None
    df = pd.read_csv(t, sep="\t")
    df = df[~df["label"].astype(str).str.startswith("sweep_")].copy()
    df = df.drop_duplicates(["dataset", "tool", "label"], keep="last")

    def _read(d, name):
        f = Path(d) / name
        return f.read_text().strip() if f.exists() else ""

    df["version"] = [_read(d, "version.txt") for d in df["out_dir"]]
    df["command"] = [_read(d, "command.txt") for d in df["out_dir"]]
    df["maxrss_mb"] = (df["maxrss_kb"] / 1024).round(1)
    cols = ["dataset", "pxd", "tool", "label", "threads", "returncode", "wall_s", "cpu_s", "maxrss_mb",
            "load1_before", "load1_after", "version", "input", "command"]
    out = Path(cfg["results_dir"]) / f"tag_accuracy_runs_{tag}.tsv"
    return write_tsv(df[cols], out, [
        f"source: fastag-bench {__version__} accuracy runs from {t} ({_now()}, host {platform.node()})",
        "last run per dataset/tool/label; times on a node shared between concurrent accuracy jobs: not benchmarks; "
        "maxrss of runs before the timing-helper fix (2026-11-03 21:10) can include up to ~0.1 GB of the "
        "harness process (Linux carries the RSS high-water mark across fork/exec)"])
