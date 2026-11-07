#!/usr/bin/env python3
"""Cross-platform runtime of FASTag 1.9.0 (release binaries) on PXD063151 Proteome_EIF5A.mzML.

Reads the per-run tables of each machine (columns machine, os, cpu, cores_phys, cores_log, profile,
threads, rep, wall_s, cpu_s, peak_rss_mb, tags_sha256, load_before, note) and writes one row per
machine x profile x threads: median/min/max wall time over the repetitions, speed-up of the median
against the 1-thread median of the same machine and profile, median CPU time, occupancy
cpu / (wall x threads), the largest peak RSS, the tag-table sha256 (all repetitions must agree), the
sha256 after CRLF -> LF normalisation (Windows writes CRLF; --lf-sha maps raw to normalised hashes,
columns sha256_raw and sha256_lf_normalised) and whether the thread count exceeds the physical cores.

Usage:
  python scripts/xplat_runtime_v190.py --out results/xplat_runtime_v190.tsv \
      --lf-sha results/xplat_v190/windows_lf_sha.tsv \
      results/xplat_v190/runs_linux_epyc7763.tsv results/xplat_v190/runs_macos_m3ultra.tsv results/xplat_v190/runs_windows_ryzen7900x.tsv
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from fastag_bench.tsv import write_tsv  # noqa: E402


def summarise(runs: pd.DataFrame, lf: dict[str, str] | None = None) -> pd.DataFrame:
    lf = lf or {}
    rows = []
    for (machine, profile, threads), g in runs.groupby(["machine", "profile", "threads"], sort=False):
        shas = sorted(set(g["tags_sha256"]))
        if len(shas) != 1:
            raise SystemExit(f"{machine} {profile} t{threads}: tag tables differ between repetitions")
        first = g.iloc[0]
        rows.append({
            "machine": machine, "os": first["os"], "cpu": first["cpu"],
            "cores_phys": int(first["cores_phys"]), "cores_log": int(first["cores_log"]),
            "profile": profile, "threads": int(threads), "n_reps": len(g),
            "wall_median_s": round(g["wall_s"].median(), 2), "wall_min_s": round(g["wall_s"].min(), 2),
            "wall_max_s": round(g["wall_s"].max(), 2),
            "cpu_median_s": round(g["cpu_s"].median(), 2),
            "peak_rss_max_mb": round(g["peak_rss_mb"].max(), 1),
            "load_before_max": round(g["load_before"].max(), 2),
            "oversubscribed": int(threads) > int(first["cores_phys"]),
            "tags_sha256": shas[0],
            "tags_sha256_lf": lf.get(shas[0], shas[0]),
            "_wall": g["wall_s"].median(),
        })
    out = pd.DataFrame(rows)
    one = out[out["threads"] == 1].set_index(["machine", "profile"])["_wall"]
    out["speedup_vs_1t"] = [round(one[(m, p)] / w, 2) for m, p, w in zip(out["machine"], out["profile"], out["_wall"])]
    out["occupancy"] = (out["cpu_median_s"] / (out["_wall"] * out["threads"])).round(2)
    cols = ["machine", "os", "cpu", "cores_phys", "cores_log", "profile", "threads", "n_reps",
            "wall_median_s", "wall_min_s", "wall_max_s", "speedup_vs_1t", "cpu_median_s", "occupancy",
            "peak_rss_max_mb", "load_before_max", "oversubscribed", "tags_sha256", "tags_sha256_lf"]
    return out.sort_values(["profile", "machine", "threads"])[cols]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("runs", nargs="+", help="per-machine per-run TSVs")
    ap.add_argument("--out", required=True)
    ap.add_argument("--lf-sha", help="TSV with sha256_raw and sha256_lf_normalised (CRLF outputs)")
    a = ap.parse_args()
    lf: dict[str, str] = {}
    if a.lf_sha:
        t = pd.read_csv(a.lf_sha, sep="\t", comment="#")
        for raw, g in t.groupby("sha256_raw"):
            norm = set(g["sha256_lf_normalised"])
            if len(norm) != 1:
                raise SystemExit(f"{raw}: several LF-normalised hashes")
            lf[raw] = norm.pop()
    runs = pd.concat([pd.read_csv(p, sep="\t", comment="#") for p in a.runs], ignore_index=True)
    prov = [
        "source: scripts/xplat_runtime_v190.py from the per-run tables "
        + ", ".join(Path(p).parent.name + "/" + Path(p).name for p in a.runs)
        + f" (results/xplat_v190, renamed runs_*.tsv); {datetime.now().astimezone().isoformat(timespec='seconds')}",
        "FASTag 1.9.0 release binaries (Linux tarball, macOS dmg, Windows CLI zip); input PXD063151 Proteome_EIF5A.mzML "
        "(3238158580 bytes, sha256 4e3e1f249d6c67a12b40f0205268562fa8755c9420024a83fb245a8e442ca3ab, 372032 MS2 spectra); "
        "profiles default and matched; serial runs after one untimed warm-up",
        "wall from the harness clock; cpu = user+sys; peak RSS: ibminode05 max(VmRSS every 50 ms, ru_maxrss), "
        "Studio /usr/bin/time -l maximum resident set, flash PeakWorkingSetSize; speedup = 1-thread median / median; "
        "occupancy = cpu_median / (wall_median x threads); oversubscribed = threads > physical cores",
        "load_before: 1-min load average on ibminode05 and Studio, mean Win32_Processor.LoadPercentage (% of logical CPUs) on flash; "
        "flash was shared with the owner's FLASHTnT batch (4 runs overlapped a 13-14-core burst, see Table S5)",
        "not measured: ibminode06 (run not started)",
        "default tags differ Linux vs macOS in one spectrum (scan=1201892: E-values 4.8-8.8x larger on macOS, ranks 22-50 differ, 12 tags each side); "
        "matched tags byte-identical; Windows writes CRLF (raw sha256 differs), after LF normalisation both profiles equal Linux "
        "(per-spectrum MD5 of default identical to Linux incl. scan=1201892); evidence in results/xplat_v190",
    ]
    write_tsv(summarise(runs, lf), a.out, prov)


if __name__ == "__main__":
    main()
