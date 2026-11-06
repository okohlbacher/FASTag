"""Summaries of the load-gated thread ladder (scripts/ladder/ladder_run.sh raw.tsv).

    python -m fastag_bench.ladder RAW.tsv [RAW2.tsv ...] --out results --ncpu 384 \
        --prov "node kim ..." [--gate 0.25] [--suffix v190] [--reuse directag=OLD_RAW.tsv]

--reuse TOOL=RAW takes the rows of TOOL from another ladder's raw table (the 1.9.0 ladder ran FASTag only
and reuses the DirecTag rows of the 1.8.0 ladder: same node, inputs and DirecTag build); rows of TOOL in the
main raw tables are dropped. Every raw row records its source table in the column 'origin'.

writes
    ladder_raw_v180.tsv       every run, plus load/core and a 'gated' flag
    ladder_summary_v180.tsv   per tool/profile/dataset/format/threads: min/median/max wall and spread,
                              CPU, peak RSS, spectra/s, speed-up and efficiency, median phase times
    ladder_identity_v180.tsv  per tool/profile/dataset: distinct sha256 of the tag file over all
                              formats and thread counts

Only runs with exit 0 and load/core below the gate before AND after the run (foreign running
threads below the gate too) enter the summary; the rest stay in the raw table with gated = no.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import numpy as np
import pandas as pd

from .tsv import write_tsv

KEYS = ["tool", "profile", "dataset", "format", "threads"]
PHASES = ["t_open", "t_pre_loop", "t_parallel", "t_write", "t_teardown", "t_program", "thr_read_s", "thr_tag_s"]


def load_raw(paths, reuse=()) -> pd.DataFrame:
    """Concatenate raw tables; reuse = [(tool, path)]: rows of tool come from path only."""
    def read(p):
        return pd.read_csv(p, sep="\t", comment=None, keep_default_na=False, na_values=[""]).assign(origin=Path(p).name)
    df = pd.concat([read(p) for p in paths], ignore_index=True)
    for tool, p in reuse:
        old = read(p)
        old = old[old["tool"] == tool]
        if old.empty:
            raise ValueError(f"--reuse {tool}={p}: no {tool} rows")
        old["origin"] = f"{old['origin'].iloc[0]} (reused {tool} rows)"
        df = pd.concat([df[df["tool"] != tool], old], ignore_index=True)
    for c in ["threads", "rep", "exit", "wall_s", "user_s", "sys_s", "maxrss_kb", "load1_before", "load1_after",
              "foreign_r_before", "foreign_r_after", "gate_wait_s", "spectra", "tags", "out_bytes", *PHASES]:
        if c in df:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def apply_corrections(df: pd.DataFrame, path) -> pd.DataFrame:
    """Overwrite 'exit' (and append to 'note') for runs listed in a corrections TSV
    (tool, profile, dataset, format, threads, rep, exit, note), e.g. a crash that the runner
    recorded as exit 0 because GNU time reports 'Exit status: 0' after a signal."""
    df = df.copy()
    c = pd.read_csv(path, sep="\t", comment="#", dtype=str)
    if "note" not in df:
        df["note"] = ""
    for r in c.itertuples(index=False):
        m = ((df["tool"] == r.tool) & (df["profile"] == r.profile) & (df["dataset"] == r.dataset)
             & (df["format"] == r.format) & (df["threads"] == int(r.threads)) & (df["rep"] == int(r.rep)))
        if not m.any():
            raise ValueError(f"correction matches no run: {r}")
        df.loc[m, "exit"] = int(r.exit)
        df.loc[m, "note"] = [f"{n}; {r.note}".strip("; ") if isinstance(n, str) else r.note for n in df.loc[m, "note"]]
    return df


def mark_gate(df: pd.DataFrame, ncpu: int, gate: float = 0.25) -> pd.DataFrame:
    df = df.copy()
    df["load_per_core_before"] = (df["load1_before"] / ncpu).round(4)
    df["load_per_core_after"] = (df["load1_after"] / ncpu).round(4)
    fr = df[["foreign_r_before", "foreign_r_after"]].max(axis=1) / ncpu
    ok = (df["exit"] == 0) & (df["load_per_core_before"] < gate) & (fr < gate)
    # load1 after a run includes the run itself (a 384-thread run lifts it); gate 'after' on the
    # running threads other than the run, which ladder_run.sh samples once the run has exited
    df["gated"] = np.where(ok, "yes", "no")
    return df


def summarize(df: pd.DataFrame) -> pd.DataFrame:
    ok = df[df["gated"] == "yes"]
    rows = []
    for key, g in ok.groupby(KEYS, sort=True):
        w = g["wall_s"]
        best = g.loc[w.idxmin()]
        r = dict(zip(KEYS, key))
        r.update({
            "n": len(g),
            "wall_min_s": round(w.min(), 3), "wall_median_s": round(w.median(), 3), "wall_max_s": round(w.max(), 3),
            "spread_pct": round(100 * (w.max() - w.min()) / w.min(), 1) if w.min() > 0 else np.nan,
            "cpu_s_of_min": round(best["user_s"] + best["sys_s"], 2),
            "cpu_s_median": round((g["user_s"] + g["sys_s"]).median(), 2),
            "rss_mb_min": round(g["maxrss_kb"].min() / 1024, 1), "rss_mb_max": round(g["maxrss_kb"].max() / 1024, 1),
            "spectra": int(g["spectra"].max()) if g["spectra"].notna().any() else np.nan,
            "tags": int(g["tags"].max()) if g["tags"].notna().any() else np.nan,
            "max_load_per_core": round(max(g["load_per_core_before"].max(), 0), 4),
        })
        r["spectra_per_s"] = round(r["spectra"] / r["wall_min_s"], 1) if pd.notna(r["spectra"]) and r["wall_min_s"] > 0 else np.nan
        for p in PHASES:
            if p in g and g[p].notna().any():
                r[p + "_median"] = round(g[p].median(), 4)
        rows.append(r)
    s = pd.DataFrame(rows)
    if s.empty:
        return s
    base = s.loc[s.groupby(KEYS[:-1])["threads"].idxmin(), KEYS[:-1] + ["threads", "wall_min_s"]]
    base = base.rename(columns={"threads": "base_threads", "wall_min_s": "base_wall_s"})
    s = s.merge(base, on=KEYS[:-1], how="left")
    s["speedup"] = (s["base_wall_s"] / s["wall_min_s"]).round(2)
    s["efficiency"] = (s["speedup"] * s["base_threads"] / s["threads"]).round(3)
    return s


def identity(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    # FASTag only: DirecTag writes the run's start time into its .tags header, so its file hash
    # differs between any two runs; its tag counts are in the summary and status tables
    for (tool, prof, ds), g in df[(df["exit"] == 0) & (df["tool"] == "fastag")].groupby(["tool", "profile", "dataset"], sort=True):
        shas = sorted(g["sha256"].dropna().unique())
        rows.append({
            "tool": tool, "profile": prof, "dataset": ds, "runs": len(g),
            "formats": ",".join(sorted(g["format"].unique())),
            "threads": ",".join(str(int(t)) for t in sorted(g["threads"].unique())),
            "distinct_sha256": len(shas), "identical": "yes" if len(shas) == 1 else "no",
            "sha256": ";".join(shas),
            "spectra": ",".join(str(int(x)) for x in sorted(g["spectra"].dropna().unique())),
            "tags": ",".join(str(int(x)) for x in sorted(g["tags"].dropna().unique())),
        })
    return pd.DataFrame(rows)


OUTSP = {"outsp_none": (0, "tags only"), "outsp_mzml": (1, "-out_spectra .mzML"), "outsp_mzpeak": (2, "-out_spectra .mzpeak")}


def directag_status(df: pd.DataFrame) -> pd.DataFrame:
    """Per dataset: did DirecTag read and tag the file? ok; truncated output (exit 0, spectra written < half the
    input MS2 that FASTag counts); '0 spectra' (exit 0, nothing tagged); fails (non-zero exit)."""
    rows = []
    fa = df[(df["tool"] == "fastag") & (df["exit"] == 0)]
    ms2 = fa.assign(base=fa["dataset"].str.replace(r"_(cvpatch|countpatch)$", "", regex=True)).groupby("base")["spectra"].max()
    for ds, g in df[df["tool"] == "directag"].groupby("dataset", sort=True):
        good = g[(g["exit"] == 0) & (g["tags"].fillna(0) > 0)]
        zero = g[(g["exit"] == 0) & (g["tags"].fillna(0) == 0)]
        base = re.sub(r"_(cvpatch|countpatch)$", "", ds)
        n_in = ms2.get(base, np.nan)
        written = good["spectra"].max() if len(good) else 0
        if len(good) and pd.notna(n_in) and written < 0.5 * n_in:
            st = f"truncated output ({int(written)} of {int(n_in)} MS2 written)"
        elif len(good):
            st = "ok"
        elif len(zero):
            st = "0 spectra"
        elif (g["exit"] >= 128).any():
            sig = int(g.loc[g["exit"] >= 128, "exit"].iloc[0]) - 128
            st = f"crashes (signal {sig})"
        else:
            st = "fails"
        notes = "; ".join(sorted({str(n) for n in g.get("note", pd.Series(dtype=str)).dropna() if str(n).strip()}))[:300]
        rows.append({"dataset": ds, "status": st, "runs": len(g), "exits": ",".join(str(int(e)) for e in sorted(g["exit"].unique())),
                     "max_wall_s": g["wall_s"].max(), "max_rss_mb": round(g["maxrss_kb"].max() / 1024, 1), "note": notes})
    return pd.DataFrame(rows)


def outspectra(summary: pd.DataFrame) -> pd.DataFrame:
    o = summary[summary["profile"].isin(OUTSP)].copy() if len(summary) else summary
    if o.empty:
        return pd.DataFrame(columns=["order", "case", "dataset", "threads", "n", "wall_min_s", "rss_mb_max"])
    o["order"] = o["profile"].map(lambda p: OUTSP[p][0])
    o["case"] = o["profile"].map(lambda p: OUTSP[p][1])
    return o[["order", "case", "profile", "dataset", "format", "threads", "n", "wall_min_s", "wall_max_s", "spread_pct",
              "rss_mb_min", "rss_mb_max", "spectra", "tags"]].sort_values("order")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("raw", nargs="+")
    ap.add_argument("--out", default="results")
    ap.add_argument("--ncpu", type=int, required=True, help="logical CPUs of the node")
    ap.add_argument("--gate", type=float, default=0.25)
    ap.add_argument("--prov", action="append", default=[], help="provenance line (repeatable)")
    ap.add_argument("--suffix", default="v180")
    ap.add_argument("--corrections", help="TSV of runs whose exit code is corrected (see apply_corrections)")
    ap.add_argument("--reuse", action="append", default=[], metavar="TOOL=RAW",
                    help="take the rows of TOOL from RAW (another ladder) instead of the main raw tables (repeatable)")
    a = ap.parse_args(argv)
    reuse = [tuple(x.split("=", 1)) for x in a.reuse]
    df = load_raw(a.raw, reuse)
    for tool, p in reuse:
        a.prov.append(f"{tool} rows reused from {Path(p).name} (--reuse)")
    if a.corrections:
        df = apply_corrections(df, a.corrections)
        a.prov.append(f"exit codes corrected from {Path(a.corrections).name}")
    df = mark_gate(df, a.ncpu, a.gate)
    out = Path(a.out)
    gate = f"gate: exit 0, 1-min load/core < {a.gate} before the run and running threads of all other processes < {a.gate} x {a.ncpu} before and after"
    prov = a.prov + [gate]
    write_tsv(df, out / f"ladder_raw_{a.suffix}.tsv", prov)
    write_tsv(summarize(df), out / f"ladder_summary_{a.suffix}.tsv",
              prov + ["min/median/max over gated repetitions; speedup = wall_min at the lowest thread count / wall_min; spectra_per_s = spectra / wall_min"])
    summ = summarize(df)
    write_tsv(directag_status(df), out / f"ladder_directag_status_{a.suffix}.tsv",
              prov + ["DirecTag 1.4.21142 per dataset: ok = tags written; 0 spectra = exit 0 without tags; fails = non-zero exit"])
    write_tsv(outspectra(summ), out / f"ladder_outspectra_{a.suffix}.tsv",
              prov + ["-out_spectra runs: tags only vs spectra written as mzML or mzPeak; same input, threads and repetitions"])
    write_tsv(identity(df[~df["profile"].isin(OUTSP)]), out / f"ladder_identity_{a.suffix}.tsv",
              prov + ["sha256 of the tag TSV (FASTag) or .tags file (DirecTag) of every run with exit 0"])
    print(f"{len(df)} runs, {int((df['gated'] == 'yes').sum())} gated -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
