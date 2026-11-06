#!/usr/bin/env python3
"""One-setting-at-a-time ablation of FASTag's defaults against the matched profile (FASTag 1.9.0).

The two FASTag profiles of the tag-accuracy benchmark (fastag_bench.accuracy.profile_args) differ in
five algorithm settings; tag length (3), tags per spectrum (50), the E-value cutoff (20) and the fixed
modifications (the dataset's fastag_args in both profiles) are the same:

  setting             fastag_matched                 fastag_default
  gaps                -gaps 0                        -gaps 1 (gap penalty 100)
  deisotoping         -no_deisotope                  on
  window quota        -peaks_per_window 0            -peaks_per_window 10 (per 100 Da)
  peak budget         -max_peaks 100                 -max_peaks 400
  fragment tolerance  tagger.fragment_tol_da (Da)    20 ppm (tagger.fastag_default_args where set)

Arms (every setting written out explicitly, so no flag is given twice):
  matched, default                 the two profiles
  add:<s>                          matched with one default setting switched on
  add:gaps_nopenalty               matched + gaps with -gap_penalty 1 (the penalty's share of 'gaps')
  add:peak_selection               matched + quota and budget together (FASTag's peak selection)
  drop:<s>                         default with one setting reverted to its matched value
  drop:gap_penalty                 default with -gap_penalty 1

Each arm runs `reps` times (arms interleaved within a rep), tags of every rep are hashed (FASTag is
deterministic: one hash per arm expected), and rep 1 is scored with the harness scorer
(fastag_bench.score.score_tags) against the Sage target PSMs at q <= sage.fdr, flank rule (primary)
and sequence rule. Output: one row per dataset x arm x rule.

Usage (on the node):
  PYTHONPATH=src python scripts/ablation_v190.py -c config/ablation-data-v190.yaml -d datasets.yaml \
      --dataset PXD000001 ... --out results/ablation_v190.tsv [--steps run,score]
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import os
import platform
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from fastag_bench import __version__  # noqa: E402
from fastag_bench import parsers as P  # noqa: E402
from fastag_bench import score as S  # noqa: E402
from fastag_bench.accuracy import ground_truth  # noqa: E402
from fastag_bench.config import load_bench_config, load_datasets, select  # noqa: E402
from fastag_bench.run import inputs, tool_path, tool_version  # noqa: E402
from fastag_bench.timing import run_timed  # noqa: E402
from fastag_bench.tsv import write_tsv  # noqa: E402

SETTINGS = ("gaps", "deisotope", "window_quota", "peak_budget", "tolerance")


def endpoints(ds) -> tuple[dict, dict]:
    """(matched, default) settings of a dataset, as in accuracy.profile_args."""
    tg = ds.tagger or {}
    tol = float(tg.get("fragment_tol_da", 0.02))
    matched = {"gaps": 0, "gap_penalty": 100.0, "deisotope": False, "peaks_per_window": 0, "max_peaks": 100,
               "tol": tol, "unit": "Da"}
    dflt = {"gaps": 1, "gap_penalty": 100.0, "deisotope": True, "peaks_per_window": 10, "max_peaks": 400,
            "tol": 20.0, "unit": "ppm"}
    a = [str(x) for x in tg.get("fastag_default_args", [])]
    if "-fragment_tolerance" in a:
        dflt["tol"] = float(a[a.index("-fragment_tolerance") + 1])
    if "-fragment_tolerance_unit" in a:
        dflt["unit"] = a[a.index("-fragment_tolerance_unit") + 1]
    return matched, dflt


def _set(s: dict, setting: str, src: dict) -> dict:
    s = dict(s)
    keys = {"gaps": ("gaps",), "deisotope": ("deisotope",), "window_quota": ("peaks_per_window",),
            "peak_budget": ("max_peaks",), "tolerance": ("tol", "unit"), "gap_penalty": ("gap_penalty",)}[setting]
    for k in keys:
        s[k] = src[k]
    return s


def arms(ds) -> list[tuple[str, str, dict]]:
    """(arm, family, settings); arms whose settings equal an earlier arm are dropped (tolerance on
    PXD001819, where the default and matched tolerance are both 0.5 Da)."""
    m, d = endpoints(ds)
    out = [("matched", "endpoint", m), ("default", "endpoint", d)]
    for s in SETTINGS:
        out.append((f"add:{s}", "add", _set(m, s, d)))
    out.append(("add:gaps_nopenalty", "add", {**_set(m, "gaps", d), "gap_penalty": 1.0}))
    out.append(("add:peak_selection", "add", _set(_set(m, "window_quota", d), "peak_budget", d)))
    for s in SETTINGS:
        out.append((f"drop:{s}", "drop", _set(d, s, m)))
    out.append(("drop:gap_penalty", "drop", {**d, "gap_penalty": 1.0}))
    seen, keep = {}, []
    for name, fam, st in out:
        key = tuple(sorted(st.items()))
        if key in seen:
            print(f"{ds.id}: {name} = {seen[key]} (same settings), skipped", flush=True)
            continue
        seen[key] = name
        keep.append((name, fam, st))
    return keep


def fastag_args(ds, st: dict) -> list[str]:
    a = [*map(str, ds.fastag_args), "-tag_length", "3", "-max_tags", "50",
         "-max_peaks", str(st["max_peaks"]), "-peaks_per_window", str(st["peaks_per_window"]),
         "-gaps", str(st["gaps"]), "-gap_penalty", f"{st['gap_penalty']:g}",
         "-fragment_tolerance", f"{st['tol']:g}", "-fragment_tolerance_unit", st["unit"]]
    if not st["deisotope"]:
        a.append("-no_deisotope")
    return a


def _dir(cfg, ds, arm: str) -> Path:
    d = Path(cfg["work_dir"]) / "ablation" / ds.id / arm.replace(":", "_")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def run(cfg, dsets, reps: int, threads: int, rep_start: int = 1, max_rep_wall: float = 0.0) -> None:
    """reps rep_start..reps; with max_rep_wall > 0, an arm whose rep-1 wall time exceeded it is not
    repeated (its time is then that single run)."""
    exe = tool_path(cfg, "fastag")
    ver = tool_version(exe)
    tlog = Path(cfg["work_dir"]) / "ablation_timing.tsv"
    new = not tlog.exists()
    slow = set()
    if max_rep_wall > 0 and not new:
        t1 = pd.read_csv(tlog, sep="\t")
        slow = {(a, b) for a, b, w in zip(t1.dataset, t1.arm, t1.wall_s) if w > max_rep_wall}
    with open(tlog, "a") as fh:
        if new:
            fh.write("dataset\tarm\trep\tthreads\twall_s\tcpu_s\tmaxrss_kb\tload1_before\tload1_after\treturncode\tsha256\n")
        for rep in range(rep_start, reps + 1):
            for ds in dsets:
                inp = inputs(cfg, ds, ("mzml",))[0][1].resolve()
                for arm, _, st in arms(ds):
                    if rep > 1 and (ds.id, arm) in slow:
                        print(f"rep {rep} {ds.id} {arm}: skipped (rep 1 wall > {max_rep_wall:g} s)", flush=True)
                        continue
                    d = _dir(cfg, ds, arm)
                    out = d / ("tags.tsv" if rep == 1 else f"tags.rep{rep}.tsv")
                    cmd = [exe, "-in", str(inp), "-out", str(out), "-threads", str(threads), *fastag_args(ds, st)]
                    (d / "command.txt").write_text(" ".join(cmd) + "\n")
                    (d / "version.txt").write_text(ver + "\n")
                    t = run_timed(cmd, log=d / f"run.rep{rep}.log", env=cfg.get("env") or {})
                    sha = _sha(out) if out.exists() else ""
                    if rep > 1 and out.exists():
                        out.unlink()  # keep rep 1 only; the hash shows the reps agree
                    fh.write(f"{ds.id}\t{arm}\t{rep}\t{threads}\t{t['wall_s']}\t{t['cpu_s']}\t{t['maxrss_kb']}\t"
                             f"{t['load1_before']}\t{t['load1_after']}\t{t['returncode']}\t{sha}\n")
                    fh.flush()
                    print(f"rep {rep} {ds.id} {arm}: {t['wall_s']} s wall, {t['cpu_s']} s CPU, rc {t['returncode']}",
                          flush=True)


def _gapped_share(tags: pd.DataFrame) -> float:
    if "gapped" not in tags:
        return np.nan
    top = tags[tags["rank"] == 1]
    return round(float((pd.to_numeric(top["gapped"], errors="coerce") == 1).mean()), 6) if len(top) else np.nan


_PSMS: dict = {}


def _score_arm(job) -> list[dict]:
    """Score one arm (worker process): the harness scorer, both rules."""
    cfg, ds, arm, fam, st, t = job
    if ds.id not in _PSMS:
        _PSMS[ds.id] = ground_truth(cfg, ds, "sage")[0]
    psms = _PSMS[ds.id]
    tags = P.read_fastag_tags(_dir(cfg, ds, arm) / "tags.tsv")
    base = {"dataset": ds.id, "pxd": ds.pxd, "arm": arm, "family": fam,
            "gaps": st["gaps"], "gap_penalty": st["gap_penalty"], "deisotope": int(st["deisotope"]),
            "peaks_per_window": st["peaks_per_window"], "max_peaks": st["max_peaks"],
            "fragment_tol": f"{st['tol']:g} {st['unit']}",
            "spectra_tagged": int(tags["spectrum"].nunique()), "tags": int(len(tags)),
            "rank1_gapped_share": _gapped_share(tags),
            "reps": int(len(t)), "rc_max": int(t["returncode"].max()) if len(t) else -1,
            "reps_identical": int(t["sha256"].nunique() == 1) if len(t) else 0,
            "tags_sha256": t["sha256"].iloc[0] if len(t) else "",
            "threads": int(t["threads"].iloc[0]) if len(t) else 0,
            "wall_median_s": float(np.median(t["wall_s"])) if len(t) else np.nan,
            "cpu_median_s": float(np.median(t["cpu_s"])) if len(t) else np.nan,
            "maxrss_mb": round(t["maxrss_kb"].max() / 1024) if len(t) else np.nan,
            "load1_min": float(t[["load1_before", "load1_after"]].min().min()) if len(t) else np.nan,
            "load1_max": float(t[["load1_before", "load1_after"]].max().max()) if len(t) else np.nan}
    rows = []
    for rule in S.RULES:
        r = S.score_tags(tags, psms, (1, 5), rule)
        rows.append({**base, "rule": rule, "psm_spectra": r["psm_spectra"],
                     "psm_spectra_tagged": r["psm_spectra_tagged"], "top1_correct": r["top1_correct"],
                     "top1_precision": r["top1_precision"], "top5_any_rate": r["top5_any_rate"],
                     "all_tags_precision": r["all_tags_precision"], "any_tag_recall": r["any_tag_recall"],
                     "tags_on_psm_spectra": r["tags_on_psm_spectra"]})
    print(f"{ds.id} {arm}: rank-1 {rows[0]['top1_precision']:.4f} per-tag {rows[0]['all_tags_precision']:.4f} "
          f"CPU {base['cpu_median_s']} s", flush=True)
    return rows


def score(cfg, dsets, out: Path, host_note: str, workers: int = 8) -> Path:
    from concurrent.futures import ProcessPoolExecutor
    tl = pd.read_csv(Path(cfg["work_dir"]) / "ablation_timing.tsv", sep="\t")
    srcs, vers, jobs = [], set(), []
    for ds in dsets:
        srcs.append(f"{ds.pxd}: {ground_truth(cfg, ds, 'sage')[1]}")
        for arm, fam, st in arms(ds):
            vers.add((_dir(cfg, ds, arm) / "version.txt").read_text().strip())
            jobs.append((cfg, ds, arm, fam, st, tl[(tl.dataset == ds.id) & (tl.arm == arm)]))
    with ProcessPoolExecutor(max_workers=workers) as ex:
        rows = [r for rs in ex.map(_score_arm, jobs) for r in rs]
    df = pd.DataFrame(rows)
    # relative to the matched arm of the same dataset and rule
    ref = df[df.arm == "matched"].set_index(["dataset", "rule"])
    for c in ("top1_precision", "all_tags_precision", "any_tag_recall"):
        df[f"d_{c}_vs_matched"] = [round(v - ref.loc[(a, b), c], 6) for a, b, v in zip(df.dataset, df.rule, df[c])]
    df["cpu_ratio_vs_matched"] = [round(v / ref.loc[(a, b), "cpu_median_s"], 3)
                                  for a, b, v in zip(df.dataset, df.rule, df["cpu_median_s"])]
    df["wall_ratio_vs_matched"] = [round(v / ref.loc[(a, b), "wall_median_s"], 3)
                                   for a, b, v in zip(df.dataset, df.rule, df["wall_median_s"])]
    now = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    prov = [f"source: fastag-bench {__version__} scripts/ablation_v190.py (one-setting-at-a-time ablation, matched -> "
            f"default and default -> matched); host {platform.node()} ({os.cpu_count()} logical CPUs); scored {now}",
            "FASTag " + "; ".join(sorted(vers)) + f"; binary {cfg['tools']['fastag']}",
            host_note,
            "arms: matched = fastag_matched (TL 3, 50 tags, -max_peaks 100, -peaks_per_window 0, -gaps 0, -no_deisotope, "
            "tagger.fragment_tol_da); default = fastag_default (TL 3, 50 tags, -max_peaks 400, -peaks_per_window 10, "
            "-gaps 1, -gap_penalty 100, deisotoping, 20 ppm or tagger.fastag_default_args); add:<s> = matched with "
            "setting s at its default value; drop:<s> = default with s at its matched value; add:gaps_nopenalty = "
            "matched + gaps at -gap_penalty 1; add:peak_selection = matched + quota and budget; drop:gap_penalty = "
            "default at -gap_penalty 1; fixed modifications = the dataset's fastag_args in every arm",
            "truth: " + "; ".join(srcs),
            "scoring: fastag_bench.score.score_tags on tags of rep 1; rule flank (tag or reverse a substring of the "
            "PSM peptide, I=L, one flank within 0.05 Da) and rule sequence (substring only); top1_precision = rank-1 "
            "tags correct / PSM spectra tagged; all_tags_precision = correct / all tags on PSM spectra; "
            "any_tag_recall = PSM spectra with >= 1 correct tag / PSM spectra",
            "time: median of reps (arms interleaved within each rep) of wall and CPU (user+sys) time of the FASTag "
            "process (parse, tag, write); shared node, so CPU time is the robust figure; reps_identical = all reps "
            "wrote byte-identical tags"]
    return write_tsv(df, out, prov)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("-c", "--config", required=True)
    ap.add_argument("-d", "--datasets", default="datasets.yaml")
    ap.add_argument("--dataset", action="append", required=True)
    ap.add_argument("--steps", default="run,score")
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--threads", type=int, default=16)
    ap.add_argument("--rep-start", type=int, default=1)
    ap.add_argument("--max-rep-wall", type=float, default=0.0,
                    help="do not repeat arms whose rep-1 wall time exceeded this many seconds (0 = repeat all)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--host-note", default="")
    ap.add_argument("--workers", type=int, default=8, help="scoring processes")
    a = ap.parse_args()
    cfg = load_bench_config(a.config)
    dsets = select(load_datasets(a.datasets), a.dataset)
    steps = a.steps.split(",")
    if "run" in steps:
        run(cfg, dsets, a.reps, a.threads, a.rep_start, a.max_rep_wall)
    if "score" in steps:
        print(score(cfg, dsets, Path(a.out), a.host_note, a.workers))


if __name__ == "__main__":
    main()
