#!/usr/bin/env python3
"""Held-out runs of PREREG-species-explain.md on node data.
  run_species.py truth  <manifest> <root> <workers> <threads>   Sage 0.14.7 truth search per run (before the freeze)
  run_species.py fastag <manifest> <root> <workers> <threads>   CFG-explain and CFG-decoy per run (after the freeze, once)
Input <root>/mzml/<pxd>/<run>.mzML (stage.sh). Output <root>/truth/<pxd>/<run>/{sage.json,results.sage.tsv,sage.log},
<root>/runs/<CFG>/<pxd>/<run>/{species.tsv,command.txt,run.log,rc}; <root>/<mode>.log has one line per run and arm and
ends with DRIVER_DONE. A finished run (file rc) is never started again."""
import csv, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SAGE = "/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage"
FASTA = "/ceph/ibmi/abi/oliver/jpr-bench/species/ref50.fasta"
FASTAG = "/scratch/kohlbach/b113/species/opt/FASTag"
TAX = "/scratch/kohlbach/fastag112-dev/tax"
TMP = "/dev/shm/kohlbach-tmp"
CFGS = {"CFG-explain": ["-species_call", "explain"], "CFG-decoy": ["-species_call", "decoy"]}


def sage_config(r, mzml):  # fastag_bench.species.sage_species_config (FTMS / Astral MS2), mods from the manifest
    return {
        "database": {
            "bucket_size": 32768,
            "enzyme": {"missed_cleavages": 2, "min_len": 7, "max_len": 50, "cleave_at": "KR", "restrict": "P"},
            "fragment_min_mz": 150.0, "fragment_max_mz": 2000.0, "peptide_min_mass": 500.0, "peptide_max_mass": 5000.0,
            "ion_kinds": ["b", "y"], "min_ion_index": 2, "static_mods": json.loads(r["sage_static_mods"]),
            "variable_mods": json.loads(r["sage_variable_mods"]), "max_variable_mods": 2,
            "decoy_tag": "rev_", "generate_decoys": True, "fasta": FASTA},
        "precursor_tol": {"ppm": [-10.0, 10.0]}, "fragment_tol": {"ppm": [-20.0, 20.0]},
        "isotope_errors": [0, 1], "deisotope": True, "chimera": False, "wide_window": False,
        "predict_rt": True, "min_peaks": 15, "max_peaks": 150, "report_psms": 1, "mzml_paths": [str(mzml)]}


def fastag_cmd(r, mzml, d, extra, threads):  # fastag_bench.species.fastag_cmd + the configuration's option
    c = [FASTAG, "-in", str(mzml), "-out", str(d / "tags.tsv"), "-extension", "2", "-species",
         "-species_out", str(d / "species.tsv"), "-threads", str(threads)]
    if r["fastag_fixed_mods"]:
        c += ["-fixed_modifications", *r["fastag_fixed_mods"].split(";")]
    return c + extra


def run(cmd, d, env, log, tag):
    if (d / "rc").exists():
        return
    (d / "command.txt").write_text(" ".join(cmd) + "\n")
    t0 = time.time()
    with open(d / "run.log", "w") as fh:
        rc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
    (d / "rc").write_text(f"{rc}\n")
    log.write(f"{time.strftime('%F %T')}\t{tag}\trc {rc}\t{time.time() - t0:.0f}s\n")
    log.flush()


def one(mode, r, root, threads, log):
    mzml = root / "mzml" / r["pxd"] / (r["run"] + ".mzML")
    if mode == "truth":
        d = root / "truth" / r["pxd"] / r["run"]
        d.mkdir(parents=True, exist_ok=True)
        (d / "sage.json").write_text(json.dumps(sage_config(r, mzml), indent=2) + "\n")
        env = dict(os.environ, RAYON_NUM_THREADS=str(threads))
        run([SAGE, "-o", str(d), str(d / "sage.json")], d, env, log, f"truth\t{r['pxd']}\t{r['run']}")
        return
    env = dict(os.environ, FASTAG_TAXONOMY_DIR=TAX, TMPDIR=TMP, OPENMS_TMPDIR=TMP)
    for k in ("FASTAG_SPECIES_DUMP", "FASTAG_SPECIES_DECOYDB"):
        env.pop(k, None)
    for cfg, extra in CFGS.items():
        d = root / "runs" / cfg / r["pxd"] / r["run"]
        d.mkdir(parents=True, exist_ok=True)
        run(fastag_cmd(r, mzml, d, extra, threads), d, env, log, f"{cfg}\t{r['pxd']}\t{r['run']}")
        (d / "tags.tsv").unlink(missing_ok=True)


if __name__ == "__main__":
    mode, man, root, w, t = sys.argv[1], sys.argv[2], Path(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
    assert mode in ("truth", "fastag")
    rows = list(csv.DictReader(open(man), delimiter="\t"))
    Path(TMP).mkdir(exist_ok=True)
    with open(root / f"{mode}.log", "a") as log, ThreadPoolExecutor(w) as ex:
        list(ex.map(lambda r: one(mode, r, root, t, log), rows))
        log.write("DRIVER_DONE\n")
