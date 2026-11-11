#!/usr/bin/env python3
"""Paired FASTag gap-mode benchmark using the paper's scorer plus strict mass checks.

External dependency: the paper supplement's fastag_bench Python package (pass --bench-package).
Only public PXD input and the existing Sage target PSMs at spectrum q <= .01 are used.
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import random
import re
import statistics
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
DATASETS = {
    "PXD003531": {
        "id": "PXD003531_QE_NO_03",
        "file": "20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML",
        "variables": ["Oxidation (M)", "Phospho (S)", "Phospho (T)", "Phospho (Y)"],
        "tolerance": ["20", "ppm"],
        "mzml_sha256": "2b1da22229a9d8e8d4cde05d889c3a74dedd68bb9f00f3bdd9d78d2a8d9ace4a",
    },
    "PXD001819": {
        "id": "PXD001819_UPS1_yeast_LTQ_CID",
        "file": "UPS1_25000amol_R1.mzML",
        "variables": ["Oxidation (M)"],
        "tolerance": ["0.5", "Da"],
        "mzml_sha256": "03985d6cfde59f42181d5e0a6f3a2521dcdaaef8bb8a3448f14c6d6b611c68fd",
    },
}
ARMS = {
    "baseline": [],
    "new_default": [],
    "modified_pairs": ["-gap_variable_mods"],
    "triples": ["-max_gap_residues", "3"],
    "both": ["-gap_variable_mods", "-max_gap_residues", "3"],
}
MOD_MASS = {"Oxidation": 15.994915, "Phospho": 79.966331}
FIXED_MASS = {"C": 57.021464}
TOKEN = re.compile(r"([A-Za-z])((?:\[[^\]]*\])*)")


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(8 << 20), b""):
            h.update(block)
    return h.hexdigest()


@functools.lru_cache(maxsize=200000)
def tag_masses(tag):
    """Parse visible residues, lowercase gaps and named variable mods; fixed C is implicit."""
    matches = list(TOKEN.finditer(str(tag)))
    if "".join(m.group(0) for m in matches) != tag:
        raise ValueError(f"Unrecognized tag notation: {tag}")
    residues, masses = [], []
    for m in matches:
        aa = m.group(1).upper()
        mass = S.RESIDUE_MASS[aa] + FIXED_MASS.get(aa, 0)
        for label in re.findall(r"\[([^\]]*)\]", m.group(2)):
            mass += MOD_MASS[label] if label in MOD_MASS else float(label)
        residues.append(aa.replace("I", "L"))
        masses.append(mass)
    return "".join(residues), tuple(masses)


@functools.lru_cache(maxsize=50000)
def truth_masses(peptide):
    return S.peptide_masses(peptide)


def strict_correct(tag, nterm, cterm, peptide, tolerance=0.02):
    """Require paper flank/sequence plus every residue's fixed+variable mass in that orientation."""
    seq, masses = tag_masses(tag)
    residues, pref, total = truth_masses(peptide)
    if not seq or not pref:
        return False
    n = len(seq)
    for reverse in (False, True):
        needle = seq[::-1] if reverse else seq
        tm = masses[::-1] if reverse else masses
        for start in S._find_all(residues, needle):
            if any(abs(tm[k] - (pref[start+k+1] - pref[start+k])) > tolerance for k in range(n)):
                continue
            if reverse:
                flank = abs(cterm - (pref[start] - S.WATER)) <= S.FLANK_TOL or abs(nterm - (total - pref[start+n] + S.WATER)) <= S.FLANK_TOL
            else:
                flank = abs(nterm - pref[start]) <= S.FLANK_TOL or abs(cterm - (total - pref[start+n])) <= S.FLANK_TOL
            if flank:
                return True
    return False


def self_test():
    peptide = "AC[+57.021464]M[+15.994915]ST[+79.966331]K"
    _, p, total = truth_masses(peptide)
    assert strict_correct("cM[Oxidation]", p[1], total-p[3], peptide)
    assert strict_correct("M[Oxidation]c", total-p[3]+S.WATER, p[1]-S.WATER, peptide)
    assert not strict_correct("cM", p[1], total-p[3], peptide)
    assert strict_correct("MsT[Phospho]", p[2], total-p[5], "AC[+57.021464]MST[+79.966331]K")
    assert not strict_correct("M[Oxidation]S[Phospho]t", p[2], total-p[5], peptide)
    assert not strict_correct("cM[Oxidation]", 9999, 9999, peptide)
    assert S.tag_correct_flank("cM", p[1], total-p[3], *truth_masses(peptide))
    print("Strict scorer self-tests passed", flush=True)


def command(args, pxd, length, arm, output):
    ds = DATASETS[pxd]
    binary = args.baseline if arm == "baseline" else args.feature
    return [str(binary), "-in", str(args.data_root / "data" / pxd / ds["file"]),
            "-out", str(output), "-threads", str(args.threads),
            "-tag_length", str(length), "-extension", "0", "-gaps", "1",
            "-max_tags", "50", "-max_evalue", "20", "-max_peaks", "400", "-peaks_per_window", "10",
            "-gap_penalty", "100", "-fragment_tolerance", ds["tolerance"][0],
            "-fragment_tolerance_unit", ds["tolerance"][1],
            "-fixed_modifications", "Carbamidomethyl (C)",
            "-variable_modifications", *ds["variables"], *ARMS[arm]]


def run(args):
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    timing_file = output / "timings.jsonl"
    if timing_file.exists():
        raise SystemExit(f"Refusing to append duplicate runs: {timing_file}; use another output directory")
    manifest = {
        "platform": platform.platform(), "processor": platform.processor(), "logical_cpus": os.cpu_count(),
        "args": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
        "datasets": DATASETS, "fixed_masses": FIXED_MASS, "variable_masses": MOD_MASS,
        "truth_filter": "Sage rank 1, label=1, spectrum_q<=0.01; unique filename and scan; no localization filter",
        "paper_rule": "I/L-folded sequence in either direction and at least one same-position flank within 0.05 Da",
        "strict_rule": "paper rule plus every residue's fixed+variable mass within 0.02 Da in the matching orientation",
        "timing_scope": "wall/CPU per process, including startup, input parsing and output TSV; scoring excluded",
        "baseline_sha256": sha256(args.baseline), "feature_sha256": sha256(args.feature),
        "python": sys.version, "scorer_sha256": sha256(Path(S.__file__)),
        "harness_sha256": sha256(__file__), "inputs": {},
        "python_packages": {name: importlib.metadata.version(name) for name in ("numpy", "pandas", "pyyaml")},
    }
    if sys.platform == "darwin":
        hardware = subprocess.run(["/usr/sbin/system_profiler", "SPHardwareDataType"], capture_output=True, text=True).stdout
        manifest["hardware"] = [line.strip() for line in hardware.splitlines() if line.strip().startswith(("Model Name:", "Model Identifier:", "Chip:", "Total Number of Cores:", "Memory:"))]
    for pxd in args.datasets:
        ds = DATASETS[pxd]
        inp = args.data_root / "data" / pxd / ds["file"]
        truth = args.data_root / "truth" / pxd / "results.sage.tsv"
        manifest["inputs"][pxd] = {"mzml": str(inp), "mzml_sha256": sha256(inp), "truth": str(truth), "truth_sha256": sha256(truth)}
        if ds.get("mzml_sha256") and manifest["inputs"][pxd]["mzml_sha256"] != ds["mzml_sha256"]:
            raise ValueError(f"Input checksum mismatch for {pxd}")
        manifest["inputs"][pxd]["source_mzml"] = f"data:/scratch/kohlbach/jpr-ablation-v190/data/{pxd}/{ds['file']}"
        manifest["inputs"][pxd]["source_truth"] = f"data:/ceph/ibmi/abi/oliver/jpr-bench/accuracy/work/runs/{ds['id']}/sage/default/"
        for metadata in ("sage.json", "command.txt", "version.txt"):
            meta_file = truth.parent / metadata
            if meta_file.exists():
                manifest["inputs"][pxd][metadata] = {"text": meta_file.read_text(), "sha256": sha256(meta_file)}
    for name in ("baseline", "feature"):
        binary = getattr(args, name)
        help_result = subprocess.run([str(binary), "--help"], capture_output=True, text=True)
        help_text = help_result.stdout + help_result.stderr
        manifest[name+"_version"] = next((line for line in help_text.splitlines() if line.startswith("Version:")), "unknown")
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
    rng = random.Random(20261111)
    for pxd in args.datasets:
        for length in args.lengths:
            # The hash above has warmed filesystem caches; all timings include process startup and TSV I/O.
            for rep in range(1, args.reps+1):
                order = list(args.arms)
                rng.shuffle(order)
                for position, arm in enumerate(order, 1):
                    dest = output / pxd / f"L{length}" / arm
                    dest.mkdir(parents=True, exist_ok=True)
                    tags = dest / f"rep{rep}.tags.tsv"
                    cmd = command(args, pxd, length, arm, tags)
                    print(f"RUN {pxd} L{length} {arm} rep{rep}/{args.reps}", flush=True)
                    metrics = run_timed(cmd, log=dest / f"rep{rep}.log", env={"OPENBLAS_NUM_THREADS": "1"})
                    record = dict(dataset=pxd, length=length, arm=arm, rep=rep, position=position, command=cmd, **metrics)
                    if metrics["returncode"] != 0:
                        with timing_file.open("a") as f: f.write(json.dumps(record)+"\n")
                        raise RuntimeError(f"FASTag failed; see {dest / f'rep{rep}.log'}")
                    record["tags_sha256"] = sha256(tags)
                    record["tags_bytes"] = tags.stat().st_size
                    with timing_file.open("a") as f: f.write(json.dumps(record)+"\n")
                    print(f"  wall={metrics['wall_s']} CPU={metrics['cpu_s']} load={metrics['load1_before']}/{metrics['load1_after']}", flush=True)
                    if rep > 1:
                        tags.unlink()


def score(args):
    import pandas as pd
    timings = [json.loads(line) for line in (args.output / "timings.jsonl").read_text().splitlines()]
    equivalence = []
    for pxd in args.datasets:
        for length in args.lengths:
            hashes = {r["arm"]: r["tags_sha256"] for r in timings if r["dataset"] == pxd and r["length"] == length and r["rep"] == 1}
            if "baseline" in hashes and "new_default" in hashes:
                equivalence.append(dict(dataset=pxd,length=length,identical=hashes["baseline"]==hashes["new_default"],baseline_sha256=hashes["baseline"],new_default_sha256=hashes["new_default"]))
    (args.output / "default_equivalence.json").write_text(json.dumps(equivalence, indent=2)+"\n")
    summaries, spectrum_rows = [], []
    for pxd in args.datasets:
        truth = P.read_sage_psms(args.data_root / "truth" / pxd / "results.sage.tsv", 0.01)
        filenames = truth.filename.unique()
        if len(filenames) != 1 or Path(filenames[0]).name != DATASETS[pxd]["file"]:
            raise ValueError(f"Expected single-run truth for {DATASETS[pxd]['file']}, found {filenames}")
        truth = truth.drop_duplicates("key")
        oxidation = truth.peptide.str.contains(r"M\[\+?15\.99", regex=True)
        phospho = truth.peptide.str.contains(r"[STY]\[\+?79\.96", regex=True)
        cohorts = {"all": truth, "configured_variable_mod": truth[oxidation|phospho],
                   "oxidation_M": truth[oxidation], "phospho_STY": truth[phospho],
                   "no_configured_variable_mod": truth[~(oxidation|phospho)]}
        for length in args.lengths:
            for arm in args.arms:
                dest = args.output / pxd / f"L{length}" / arm
                print(f"SCORE {pxd} L{length} {arm}", flush=True)
                tags = P.read_fastag_tags(dest / "rep1.tags.tsv")
                marked = S._mark(tags, truth, "flank")
                marked["strict"] = [bool(ok) and strict_correct(t, float(n), float(c), p)
                                    for t, n, c, p, ok in zip(marked.tag, marked.nterm_mass, marked.cterm_mass, marked.peptide, marked.correct)]
                tr = [r for r in timings if r["dataset"] == pxd and r["length"] == length and r["arm"] == arm]
                timing = {"wall_median_s": statistics.median(r["wall_s"] for r in tr),
                          "cpu_median_s": statistics.median(r["cpu_s"] for r in tr),
                          "wall_min_s": min(r["wall_s"] for r in tr), "wall_max_s": max(r["wall_s"] for r in tr),
                          "reps": len(tr), "deterministic": len({r["tags_sha256"] for r in tr}) == 1}
                if equivalence:
                    timing["default_matches_baseline"] = next(e["identical"] for e in equivalence if e["dataset"]==pxd and e["length"]==length)
                for rule, column in (("paper_flank", "correct"), ("strict_mass", "strict")):
                    any_correct = marked[marked["rank"] <= 50].groupby("key")[column].any()
                    top_correct = marked[marked["rank"] == 1].groupby("key")[column].any()
                    tagged = set(marked.key)
                    for cohort, gt in cohorts.items():
                        if gt.empty: continue
                        keys = gt.key
                        n = len(keys)
                        top = int(top_correct.reindex(keys, fill_value=False).sum())
                        any50 = int(any_correct.reindex(keys, fill_value=False).sum())
                        nt = sum(k in tagged for k in keys)
                        summaries.append(dict(dataset=pxd,length=length,arm=arm,cohort=cohort,rule=rule,psms=n,tagged_psms=nt,
                                              rank1_correct=top,rank1_accuracy=top/n,rank1_precision_tagged=top/nt if nt else 0,
                                              recall50_correct=any50,recall50=any50/n,**timing))
                    for key in truth.key:
                        spectrum_rows.append(dict(dataset=pxd,length=length,arm=arm,rule=rule,key=key,
                                                  rank1=bool(top_correct.get(key,False)),any50=bool(any_correct.get(key,False))))
    summary = pd.DataFrame(summaries)
    summary.to_csv(args.output / "summary.tsv", sep="\t", index=False)
    spectra = pd.DataFrame(spectrum_rows)
    spectra.to_csv(args.output / "spectrum_outcomes.tsv.gz", sep="\t", index=False)
    paired = []
    for (pxd,length,rule), g in spectra.groupby(["dataset","length","rule"]):
        base = g[g.arm=="baseline"].set_index("key")
        for arm in args.arms:
            if arm == "baseline": continue
            other = g[g.arm==arm].set_index("key")
            for metric in ("rank1","any50"):
                a, b = base[metric], other[metric].reindex(base.index)
                paired.append(dict(dataset=pxd,length=length,rule=rule,arm=arm,metric=metric,psms=len(a),
                                   gained=int((~a & b).sum()),lost=int((a & ~b).sum()),unchanged=int((a==b).sum())))
    pd.DataFrame(paired).to_csv(args.output / "paired_changes.tsv", sep="\t", index=False)
    print(summary[summary.cohort=="all"].to_string(index=False), flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bench-package", type=Path, required=True, help="paper supplement fastag-bench directory")
    ap.add_argument("--baseline", type=Path)
    ap.add_argument("--feature", type=Path)
    ap.add_argument("--data-root", type=Path, default=ROOT)
    ap.add_argument("--output", type=Path, default=ROOT / "results")
    ap.add_argument("--datasets", nargs="+", choices=DATASETS, default=list(DATASETS))
    ap.add_argument("--arms", nargs="+", choices=ARMS, default=list(ARMS))
    ap.add_argument("--lengths", nargs="+", type=int, default=[3,5])
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("--steps", nargs="+", choices=["test","run","score"], default=["test","run","score"])
    args = ap.parse_args()
    sys.path.insert(0, str(args.bench_package / "src"))
    global P, S, run_timed
    from fastag_bench import parsers as P, score as S
    from fastag_bench.timing import run_timed
    if "test" in args.steps: self_test()
    if "run" in args.steps:
        if args.baseline is None or args.feature is None: ap.error("run needs --baseline and --feature")
        run(args)
    if "score" in args.steps: score(args)


if __name__ == "__main__":
    main()
