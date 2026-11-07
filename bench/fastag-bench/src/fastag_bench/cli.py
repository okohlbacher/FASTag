"""fastag-bench command line."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

from . import __version__
from .config import ConfigError, load_bench_config, load_datasets, select
from .tsv import read_tsv, write_tsv


def _common(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("-c", "--config", help="benchmark config YAML (default: built-in defaults)")
    ap.add_argument("-d", "--datasets", default="datasets.yaml", help="datasets YAML (default: ./datasets.yaml)")
    ap.add_argument("--dataset", action="append", help="dataset id or PXD (repeatable; default: all)")
    ap.add_argument("--experiment", help="only datasets used in this experiment (e.g. ground_truth)")


def _load(a):
    cfg = load_bench_config(a.config)
    dss = select(load_datasets(a.datasets), a.dataset, a.experiment)
    if not dss:
        raise ConfigError("no dataset selected")
    return cfg, dss


def cmd_fetch(a) -> int:
    from .fetch import fetch_dataset
    cfg, dss = _load(a)
    roles = set(a.roles.split(",")) if a.roles else None
    rows = []
    for ds in dss:
        rows += fetch_dataset(ds, cfg["data_dir"], roles, cfg.get("mirrors"),
                              None if a.max_gb <= 0 else int(a.max_gb * 1e9), a.dry_run)
    bad = [r for r in rows if "MISMATCH" in r.get("status", "")]
    return 1 if bad else 0


def cmd_convert(a) -> int:
    from .convert import convert_dataset
    cfg, dss = _load(a)
    rows = []
    for ds in dss:
        rows += convert_dataset(ds, cfg["data_dir"], cfg["tools"], a.dry_run)
    return 1 if any("FAILED" in r.get("status", "") for r in rows) else 0


def cmd_run(a) -> int:
    from . import run as R
    cfg, dss = _load(a)
    tools = set(a.tools.split(","))
    threads = [int(t) for t in a.threads.split(",")] if a.threads else None
    formats = tuple(a.formats.split(","))
    for ds in dss:
        if "fastag" in tools:
            R.fastag_ladder(cfg, ds, formats, threads, a.reps)
        if "reports" in tools:
            R.fastag_reports(cfg, ds, max(threads or cfg["fastag"]["threads"]))
        if "sage" in tools:
            R.sage_run(cfg, ds)
        if "directag" in tools:
            R.directag_run(cfg, ds)
        if "casanovo" in tools:
            R.casanovo_run(cfg, ds)
    return 0


def cmd_score(a) -> int:
    from .evaluate import score_dataset
    cfg, dss = _load(a)
    rows = []
    for ds in dss:
        s = score_dataset(cfg, ds)
        for r in s.get("tag_precision", []):
            rows.append({"dataset": ds.id, "pxd": ds.pxd, **r})
            if r["control"] == "none":
                print(f"{ds.id} {r['tool']}: top-1 precision {r['top1_precision']:.4f} "
                      f"({r['top1_correct']}/{r['psm_spectra_tagged']} tagged PSM spectra), "
                      f"all-tag precision {r['all_tags_precision']:.4f}, top-1 recall {r['top1_recall']:.4f}")
    if rows:
        p = write_tsv(pd.DataFrame(rows), Path(cfg["results_dir"]) / "benchmark" / "tag_precision_all.tsv",
                      [f"fastag-bench {__version__} score; per-dataset files under benchmark/<dataset>/"])
        print(p)
    return 0


def cmd_accuracy(a) -> int:
    """Tag accuracy against database-search ground truth (profiles, Comet cross-check, sweeps)."""
    from . import accuracy as A
    from . import run as R
    cfg, dss = _load(a)
    acc = cfg["accuracy"]
    profiles = a.profiles.split(",") if a.profiles else acc["profiles"]
    threads = a.threads or acc["threads"]
    for step in a.steps.split(","):
        for ds in dss:
            if step == "sage":
                R.sage_run(cfg, ds, threads)
            elif step == "comet":
                R.comet_run(cfg, ds, threads)
            elif step == "run":
                for p in profiles:
                    A.run_profile(cfg, ds, p, threads)
            elif step == "score":
                for f in A.score_dataset(cfg, ds, profiles):
                    print(f)
            elif step in ("gap_penalty", "peak_budget"):
                print(A.sweep(cfg, ds, step))
            elif step == "overlap":
                r = A.truth_overlap(cfg, ds)
                if r:
                    out = Path(cfg["results_dir"]) / "accuracy" / ds.id / "truth_overlap.tsv"
                    write_tsv(pd.DataFrame([r]), out, [f"source: fastag-bench {__version__}: Sage vs Comet PSMs at "
                                                       f"q <= {cfg['sage']['fdr']}, same stripped peptide (I=L)"])
                    print(r)
            elif step != "collect":
                raise ConfigError(f"unknown accuracy step {step}")
        if step == "collect":
            tag = str(acc.get("result_tag", "v180"))
            for f in A.collect(cfg["results_dir"], tag):
                print(f)
            print(A.runs_table(cfg, tag))
    return 0


def cmd_mgf_filter(a) -> int:
    from .convert import filter_mgf_precursors
    kept, dropped = filter_mgf_precursors(a.src, a.dst)
    print(f"{a.src}: kept {kept}, dropped {dropped} spectra without precursor m/z or charge")
    return 0


def cmd_time(a) -> int:
    from .timing import run_timed
    if a.summary:
        cfg = load_bench_config(a.config)
        path = Path(a.summary if a.summary != "-" else Path(cfg["work_dir"]) / "timing.tsv")
        df = pd.read_csv(path, sep="\t")
        df = df[df["returncode"] == 0].copy()
        # ladder runs are labelled <format>_t<threads>_r<rep>; other labels (reports, species) stay separate
        df["run"] = df["label"].astype(str).str.replace(r"_t\d+_r\d+$", "", regex=True)
        df.loc[df["run"] == df["format"], "run"] = "ladder"
        g = df.groupby(["dataset", "tool", "run", "format", "threads"]).agg(
            runs=("wall_s", "size"), wall_min_s=("wall_s", "min"), wall_median_s=("wall_s", "median"),
            cpu_median_s=("cpu_s", "median"), maxrss_mb=("maxrss_kb", lambda x: round(x.max() / 1024)),
            load1_median=("load1_before", "median")).reset_index()
        out = write_tsv(g, Path(cfg["results_dir"]) / "benchmark" / "timing_summary.tsv",
                        [f"fastag-bench {__version__} time --summary of {path}",
                         "load1_median: 1-min load before each run; on a shared node these are smoke figures"])
        print(g.to_string(index=False))
        print(out)
        return 0
    if not a.command:
        print("usage: fastag-bench time [--tsv FILE] [--label L] -- <command ...>", file=sys.stderr)
        return 2
    cmd = a.command[1:] if a.command[0] == "--" else a.command
    t = run_timed(cmd, log=a.log)
    row = {"label": a.label or Path(cmd[0]).name, "command": " ".join(cmd), **t}
    print("\t".join(f"{k}={v}" for k, v in row.items() if k != "command"))
    if a.tsv:
        p = Path(a.tsv)
        new = not p.exists()
        pd.DataFrame([row]).to_csv(p, sep="\t", index=False, mode="a", header=new)
    return t["returncode"]


def cmd_figures(a) -> int:
    from .figures import render_all
    st = render_all(a.results, a.out, a.scripts, a.only.split(",") if a.only else None,
                    variants=not getattr(a, "default_only", False))
    return 1 if any(rc for _, rc in st) else 0


def cmd_all(a) -> int:
    for f in (cmd_fetch, cmd_convert, cmd_run, cmd_score):
        rc = f(a)
        if rc:
            return rc
    cfg = load_bench_config(a.config)
    a.results, a.out, a.scripts, a.only = cfg["results_dir"], "figures", None, None
    return cmd_figures(a)


def cmd_species_run(a) -> int:
    from . import species as SP
    man = SP.load_manifest(a.manifest)
    if a.run:
        man = man[man["run_id"].isin(a.run)]
    tools = {"fastag": a.fastag, "sage": a.sage, "sage_fasta": a.sage_fasta, "unipept": a.unipept}
    steps = set(a.steps.split(","))
    if "timing" in steps:  # sequential, load-gated timing of the default arm; run alone on an idle node
        if not (a.fastag and a.scratch):
            raise ConfigError("step timing needs --fastag and --scratch")
        SP.time_default(man, Path(a.work), a.fastag, a.threads, a.reps, Path(a.scratch) / "timing")
        return 0
    for k in ("fastag", "sage", "unipept"):
        if k in steps and not tools[k]:
            raise ConfigError(f"--{k} is required for step {k}")
    if "sage" in steps and not a.sage_fasta:
        raise ConfigError("--sage-fasta is required for step sage")
    SP.run_all(man, Path(a.work), tools, a.threads, a.jobs, a.arms.split(","), steps,
               Path(a.scratch) if a.scratch else None)
    return 0


def cmd_species_score(a) -> int:
    from . import species as SP
    man = SP.load_manifest(a.manifest)
    work = Path(a.work)
    uni = SP.load_universe(a.universe)
    res = SP.score_all(man, work, uni)
    prov = [f"source: {work} (fastag-bench species-score)", *a.provenance]
    out = Path(a.results)
    write_tsv(res["genus"], out / "species_genus_calls.tsv",
              prov + [f"rules: fastag_q q<={SP.RULE_Q}; fastag_dec deconvolved share>={SP.RULE_SHARE}; "
                      f"unipept share>={SP.RULE_SHARE} and >={SP.RULE_MIN_PEPTIDES} peptides; "
                      f"excluded negatives: {','.join(sorted(SP.CONTAMINANT_GENERA))}, Homo in non-human runs"])
    write_tsv(res["runs"], out / "species_runs.tsv", prov)
    if len(res["genus"]):
        write_tsv(SP.truth_ranks(res["genus"], res["runs"]), out / "species_truth_ranks.tsv", prov)
        write_tsv(SP.top1_summary(res["genus"], res["runs"]), out / "species_top1.tsv",
                  prov + ["top1_true: the best-ranked genus (FASTag rank, or most Unipept peptides) is one of the true genera"])
    if len(res["timing"]):
        write_tsv(res["timing"], out / "species_timing.tsv", prov)
    td = work / "timing_default.tsv"
    if td.exists():
        tdf = pd.read_csv(td, sep="\t")
        write_tsv(tdf, out / "species_fastag_timing.tsv",
                  prov + ["sequential default -species arm (tags + species), mzML on node-local disk after one warm read; "
                          "gate_ok = 1-min load per logical CPU < 0.25 before and after"])
    g = res["genus"]
    g.attrs["mixed_runs"] = [r for r, t in zip(man["run_id"], man["truth"]) if len(SP.parse_truth(t)) > 1]
    g.attrs["ftms_runs"] = list(res["runs"].loc[res["runs"]["analyzer"] == "FTMS", "run_id"])
    write_tsv(SP.summary_metrics(g), out / "species_metrics.tsv", prov)
    if "call_unipept" in g:
        write_tsv(SP.agreement(g), out / "species_agreement.tsv", prov)
    th = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2]
    ftms = g[g["run_id"].isin(g.attrs["ftms_runs"])]
    parts = [SP.sweep(x, s, th).assign(runs=lab) for lab, x in (("all", g), ("FTMS", ftms))
             for s in ("dec_share", "unipept_share") if s in g]
    if parts:
        write_tsv(pd.concat(parts, ignore_index=True), out / "species_sweep.tsv", prov)
    print(SP.summary_metrics(g).to_string(index=False))
    return 0


def cmd_check(a) -> int:
    """Validate datasets.yaml and a result TSV's provenance header (used by tests and CI)."""
    dss = load_datasets(a.datasets)
    print(f"{len(dss)} datasets OK: " + ", ".join(d.id for d in dss))
    for f in a.tsv or []:
        df, prov = read_tsv(f)
        if not prov:
            print(f"{f}: no provenance line", file=sys.stderr)
            return 1
        print(f"{f}: {len(df)} rows; {prov[0][:90]}")
    return 0


def cmd_unidentified(a) -> int:
    from . import unidentified as U
    cfg = U.load(a.config)
    if a.seed is not None:
        for k in ("decoy_seed", "swap_seed", "chimera_seed"):
            cfg["unidentified"][k] = a.seed
    if a.ratios:
        cfg["unidentified"]["ratios"] = [float(x) for x in a.ratios.split(",")]
    if a.modes and a.modes != "closed,pool":
        raise ConfigError("unidentified: only the modes closed,pool are implemented (open/chimera are backlog)")
    U.run_step(cfg, a.step, a.split)
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="fastag-bench", description=__doc__)
    ap.add_argument("--version", action="version", version=f"fastag-bench {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("fetch", help="download dataset files from PRIDE and verify checksums")
    _common(p)
    p.add_argument("--roles", help="comma list of file roles (raw,mzml,mzpeak,peak,search,fasta,sdrf)")
    p.add_argument("--max-gb", type=float, default=5.0, help="skip files above this size (0 = no limit)")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("convert", help="raw -> mzML (ThermoRawFileParser), mzML -> mzPeak (mzpeak-convert)")
    _common(p)
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_convert)

    p = sub.add_parser("run", help="run FASTag (thread ladder, reports), Sage, DirecTag, Casanovo")
    _common(p)
    p.add_argument("--tools", default="fastag,reports,sage", help="comma list: fastag,reports,sage,directag,casanovo")
    p.add_argument("--threads", help="comma list overriding fastag.threads")
    p.add_argument("--reps", type=int, help="repetitions per thread count (default fastag.reps)")
    p.add_argument("--formats", default="mzml", help="inputs for the ladder: mzml,mzpeak")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("score", help="tag precision/recall vs Sage, species and digest/label calls")
    _common(p)
    p.set_defaults(func=cmd_score)

    p = sub.add_parser("accuracy", help="tag accuracy vs Sage/Comet: sage,comet,run,score,overlap,collect,"
                                        "gap_penalty,peak_budget")
    _common(p)
    p.add_argument("--steps", default="sage,run,score", help="comma list of steps, run in this order")
    p.add_argument("--profiles", help="comma list (default accuracy.profiles)")
    p.add_argument("--threads", type=int, help="threads for searches and taggers (default accuracy.threads)")
    p.set_defaults(func=cmd_accuracy)

    p = sub.add_parser("mgf-filter", help="drop MGF spectra without precursor m/z or charge (AlphaTims ddaPASEF export)")
    p.add_argument("src")
    p.add_argument("dst")
    p.set_defaults(func=cmd_mgf_filter)

    p = sub.add_parser("time", help="time one command (wall, CPU, peak RSS) or summarise work/timing.tsv")
    p.add_argument("-c", "--config")
    p.add_argument("--summary", nargs="?", const="-", help="summarise a timing TSV (default work/timing.tsv)")
    p.add_argument("--tsv", help="append the measurement to this TSV")
    p.add_argument("--label")
    p.add_argument("--log", help="write the command's output here")
    p.add_argument("command", nargs=argparse.REMAINDER)
    p.set_defaults(func=cmd_time)

    p = sub.add_parser("figures", help="render all figures from result TSVs into figures/ (PDF+PNG)")
    p.add_argument("--results", default="results")
    p.add_argument("--out", default="figures")
    p.add_argument("--scripts", help="directory of fig_*.py scripts (default: the archive's scripts/)")
    p.add_argument("--only", help="comma list of figure names")
    p.add_argument("--default-only", action="store_true",
                   help="render only the default figures (1.9.0 tables for the per-release scripts), not the 1.8.0 baseline variants")
    p.set_defaults(func=cmd_figures)

    p = sub.add_parser("all", help="fetch, convert, run, score, figures")
    _common(p)
    p.add_argument("--roles")
    p.add_argument("--max-gb", type=float, default=5.0)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--tools", default="fastag,reports,sage")
    p.add_argument("--threads")
    p.add_argument("--reps", type=int)
    p.add_argument("--formats", default="mzml")
    p.set_defaults(func=cmd_all)

    p = sub.add_parser("species-run", help="species benchmark: FASTag -species arms, Sage, Unipept per manifest run")
    p.add_argument("--manifest", default="config/species_runs.tsv")
    p.add_argument("--work", required=True, help="output root (one directory per run)")
    p.add_argument("--fastag", help="FASTag executable (release bundle wrapper)")
    p.add_argument("--sage", help="Sage executable")
    p.add_argument("--sage-fasta", help="search database (the FASTag reference proteomes)")
    p.add_argument("--unipept", help="unipept CLI executable")
    p.add_argument("--steps", default="fastag,sage,unipept")
    p.add_argument("--arms", default="default,deconv,gapped")
    p.add_argument("--threads", type=int, default=32)
    p.add_argument("--jobs", type=int, default=1, help="runs processed concurrently")
    p.add_argument("--scratch", help="copy each mzML here first (node-local disk)")
    p.add_argument("--run", action="append", help="only this run_id (repeatable)")
    p.add_argument("--reps", type=int, default=3, help="repetitions for step 'timing'")
    p.set_defaults(func=cmd_species_run)

    p = sub.add_parser("species-score", help="score species runs: genus calls, sensitivity/specificity, agreement")
    p.add_argument("--manifest", default="config/species_runs.tsv")
    p.add_argument("--work", required=True)
    p.add_argument("--universe", default="config/species_universe.txt",
                   help="genera the index can call: taxonomy dir, species.tsv or text file")
    p.add_argument("--results", default="results")
    p.add_argument("--provenance", action="append", default=[], help="extra '# ' header line (repeatable)")
    p.set_defaults(func=cmd_species_score)

    p = sub.add_parser("check", help="validate datasets.yaml and result TSV provenance headers")
    p.add_argument("-d", "--datasets", default="datasets.yaml")
    p.add_argument("tsv", nargs="*")
    p.set_defaults(func=cmd_check)

    from .unidentified import SPLITS, STEPS
    p = sub.add_parser("unidentified", help="#4: tag accuracy on unidentified (S3-PT) and synthetic chimeric (S4) "
                                            "ProteomeTools spectra")
    p.add_argument("step", choices=STEPS)
    p.add_argument("-c", "--config", required=True, help="e.g. config/unidentified-data.yaml")
    p.add_argument("--split", choices=SPLITS, help="pool split (all steps except splits and v190-check)")
    p.add_argument("--modes", default="closed,pool", help="Sage modes (closed,pool; open/chimera are backlog)")
    p.add_argument("--ratios", help="chimera ratios major:minor, comma list (default unidentified.ratios)")
    p.add_argument("--seed", type=int, help="override the decoy, swap and chimera seeds")
    p.set_defaults(func=cmd_unidentified)
    return ap


def main(argv=None) -> int:
    ap = build_parser()
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(line_buffering=True)  # progress lines show up in redirected logs
    try:
        return a.func(a)
    except (ConfigError, FileNotFoundError) as e:
        print(f"fastag-bench: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
