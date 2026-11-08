#!/usr/bin/env python3
"""#1/#10 DEV regeneration on the frozen RC (a117801): the species DEV runs with the paper harness's command
(fastag_bench.species.fastag_cmd, arm 'default': -extension 2 -species, label fixed mods, 0.3 Da on ion-trap MS2).

Arms per run (all on the RC binary, FASTAG_TAXONOMY_DIR = the RC taxonomy files + the 1.10/1.11 tax_k7.taxdb):
  base                      CFG-01-base (-species, 1.10.0 q-rule)
  g_<alpha>_<tau>_<nmin>_<off|on>
                            -species_call decoy -species_call_params <grid table> [-species_deconvolve]; the 48 points
                            of the pre-registered grid alpha {0.01,0.05} x tau {0,0.002,0.005,0.01} x n_min {5,10,20}
                            x deconvolve {off,on}; each table equals the provisional one except alpha/tau/n_min
  ks6                       -species_call decoy -species_call_decoys 6 (provisional table): decoy replicate 6 is
                            replicate j=5 of decoyTag (deterministic per (tag, j)), so decoy_spectra(ks6) minus
                            decoy_spectra(g_0.01_0_10_off) is one decoy replicate's count, scored as an all-decoy run
  both_<point>              (second pass, --both <point>) CFG-10-cand: the chosen point + -species_orientation both
Only DEV runs: the list is checked against every held-out manifest first (scripts/check_dev_inputs.py).
Usage: species_dev.py <dev list tsv> <out dir> <workers> <threads> [--both <arm>]"""
import json, os, shutil, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[4] / "bench/fastag-bench/src"
sys.path.insert(0, str(HARNESS))
from fastag_bench import species as SP  # noqa: E402

RC = "/scratch/kohlbach/fastag-heldout-1.12/rc-a117801/opt/FASTag"
DEVROOT = Path("/scratch/kohlbach/fastag112-dev")
TAX = DEVROOT / "tax"
GRID = DEVROOT / "species/grid"
SCR = DEVROOT / "species/in"
MANIFEST = Path(__file__).resolve().parents[4] / "bench/fastag-bench/config/species_runs.tsv"
ALPHAS, TAUS, NMINS = ["0.01", "0.05"], ["0", "0.002", "0.005", "0.01"], ["5", "10", "20"]


def grid_tables():
    GRID.mkdir(parents=True, exist_ok=True)
    prov = (TAX / "species_call.tsv").read_text().splitlines()
    arms = {}
    for a in ALPHAS:
        for t in TAUS:
            for n in NMINS:
                name = f"g_{a}_{t}_{n}"
                p = GRID / f"{name}.tsv"
                out = []
                for l in prov:
                    k = l.split("\t")[0]
                    if k == "version":
                        l = f"version\t1.12.0-dev-grid-{a}-{t}-{n}"
                    elif k == "alpha":
                        l = f"alpha\t{a}"
                    elif k == "tau":
                        l = f"tau\t{t}"
                    elif k == "n_min":
                        l = f"n_min\t{n}"
                    out.append(l)
                p.write_text("\n".join(out) + "\n")
                arms[name + "_off"] = ["-species_call", "decoy", "-species_call_params", str(p)]
                arms[name + "_on"] = ["-species_call", "decoy", "-species_call_params", str(p), "-species_deconvolve"]
    arms["ks6"] = ["-species_call", "decoy", "-species_call_decoys", "6", "-species_call_params",
                   str(TAX / "species_call.tsv")]
    return arms


def run_one(row, out, arms, threads, log):
    rid, src = row["run_id"], Path(row["mzml"])
    rd = out / rid
    rd.mkdir(parents=True, exist_ok=True)
    todo = [a for a in arms if not (rd / a / "species.tsv").exists()]
    if not todo:
        return rid, 0
    mz = SCR / src.name
    if not mz.exists() or mz.stat().st_size != src.stat().st_size:
        shutil.copyfile(src, mz)
    an = SP.ms2_analyzer(mz)
    (rd / "meta.json").write_text(json.dumps({"analyzer": an, "mzml": str(src), "size": src.stat().st_size}) + "\n")
    env = dict(os.environ, FASTAG_TAXONOMY_DIR=str(TAX), OPENMS_TMPDIR="/dev/shm/kohlbach-tmp",
               TMPDIR="/dev/shm/kohlbach-tmp")
    env.pop("FASTAG_DIGEST_DIR", None)
    for arm in todo:
        d = rd / arm
        d.mkdir(parents=True, exist_ok=True)
        cmd = SP.fastag_cmd(RC, mz, d, "default", row["label"], an, threads) + arms[arm]
        (d / "command.txt").write_text(" ".join(cmd) + "\n")
        t0 = time.time()
        with open(d / "run.log", "w") as fh:
            rc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
        (d / "time.json").write_text(json.dumps({"wall_s": round(time.time() - t0, 3), "returncode": rc,
                                                 "load1": os.getloadavg()[0]}) + "\n")
        (d / "tags.tsv").unlink(missing_ok=True)
        log.write(f"{time.strftime('%H:%M:%S')} {rid} {arm} rc {rc} {round(time.time() - t0, 1)} s\n")
        log.flush()
        if rc != 0:
            (d / "species.tsv").unlink(missing_ok=True)
    mz.unlink(missing_ok=True)
    return rid, len(todo)


def main():
    devlist, out, workers, threads = sys.argv[1], Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    arms = grid_tables()
    arms = {"base": [], **arms}
    if "--both" in sys.argv:
        pt = sys.argv[sys.argv.index("--both") + 1]
        arms = {f"both_{pt}": arms[pt] + ["-species_orientation", "both"]}
    os.makedirs("/dev/shm/kohlbach-tmp", exist_ok=True)
    SCR.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    ok = {l.split("\t")[0] for l in open(devlist).read().splitlines()[1:] if l.split("\t")[3] == "PASS"}
    man = [r for r in SP.load_manifest(MANIFEST).to_dict("records") if r["run_id"] in ok]
    with open(out / "driver.log", "a") as log:
        log.write(f"{time.strftime('%F %T')} start {len(man)} runs x {len(arms)} arms, {workers} workers x "
                  f"{threads} threads\n")
        log.flush()
        with ThreadPoolExecutor(workers) as ex:
            for rid, n in ex.map(lambda r: run_one(r, out, arms, threads, log), man):
                log.write(f"{time.strftime('%T')} DONE {rid} ({n} arms)\n")
                log.flush()
        log.write("DRIVER_DONE\n")


if __name__ == "__main__":
    main()
