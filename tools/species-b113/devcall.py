#!/usr/bin/env python3
"""-species_call on the DEV runs with the b113-species binary (DEV data only): the base command lines of the 1.12 #1
DEV fit, arms real (shipped index) and alldecoy (shuffled-proteome index as the target), modes
decoy (the 1.12 call), explain (5 decoy replicates, the default) and explain10 (10 replicates).
Writes OUT/<run>/<arm>/<mode>/species.tsv. Usage: devcall.py <workers> <threads> [run ...]"""
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
BIN = "/scratch/kohlbach/b113/species/build/FASTag"
REP = Path("/scratch/kohlbach/b113/species/devrep/species/runs")
OUT = Path("/scratch/kohlbach/b113/species/dev13")
TAX = {"real": "/scratch/kohlbach/fastag112-dev/tax", "alldecoy": "/scratch/kohlbach/fastag112-alldecoy/tax_decoy"}
MODES = {"decoy": ["-species_call", "decoy"], "explain": ["-species_call", "explain"],
         "explain10": ["-species_call", "explain", "-species_call_decoys", "10"]}
IN = Path("/dev/shm/kohlbach-b113sp")

def one(run, threads, log):
    meta = json.loads((REP / run / "meta.json").read_text())
    raw = (REP / run / "base" / "command.txt").read_text().split()
    cmd = []
    for t in raw:  # command.txt was written with " ".join: re-attach '(K)' / '(N-term)' to the mod name
        if t.startswith("(") and cmd and not cmd[-1].startswith("-"): cmd[-1] += " " + t
        else: cmd.append(t)
    IN.mkdir(exist_ok=True)
    mz = IN / Path(meta["mzml"]).name
    shutil.copyfile(meta["mzml"], mz)
    for arm in TAX:
        for mode, extra in MODES.items():
            d = OUT / run / arm / mode
            if (d / "done").exists(): continue
            d.mkdir(parents=True, exist_ok=True)
            c = list(cmd)
            c[0] = BIN
            c[c.index("-in") + 1] = str(mz)
            c[c.index("-out") + 1] = str(d / "tags.tsv")
            c[c.index("-species_out") + 1] = str(d / "species.tsv")
            c[c.index("-threads") + 1] = str(threads)
            c += extra
            env = dict(os.environ, FASTAG_TAXONOMY_DIR=TAX[arm], TMPDIR="/dev/shm/kohlbach-tmp", OPENMS_TMPDIR="/dev/shm/kohlbach-tmp")
            for k in ("FASTAG_SPECIES_DUMP", "FASTAG_SPECIES_DECOYDB"): env.pop(k, None)
            (d / "command.txt").write_text(" ".join(c) + "\n")
            t0 = time.time()
            with open(d / "run.log", "w") as fh:
                rc = subprocess.run(c, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
            (d / "tags.tsv").unlink(missing_ok=True)
            if rc == 0: (d / "done").write_text("")
            log.write(f"{time.strftime('%T')} {run} {arm} {mode} rc {rc} {time.time()-t0:.0f}s\n"); log.flush()
    mz.unlink()

if __name__ == "__main__":
    w, t = int(sys.argv[1]), int(sys.argv[2])
    runs = sys.argv[3:] or sorted(p.name for p in REP.iterdir() if (p / "base" / "command.txt").exists())
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "driver.log", "a") as log, ThreadPoolExecutor(w) as ex:
        log.write(f"start {len(runs)} runs\n"); log.flush()
        list(ex.map(lambda r: one(r, t, log), runs))
        log.write("DRIVER_DONE\n")
