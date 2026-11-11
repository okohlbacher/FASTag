#!/usr/bin/env python3
"""DEV dumps for the 1.13 species-call redesign: the 47 DEV runs of the 1.12 #1 DEV fit (base arm command lines of
species_dev.py, extracted from species_dev_reports.tgz), on the b113-species prototype binary, with
FASTAG_SPECIES_DUMP. Arms: real (shipped tax_k7.taxdb; decoy index = shuffled proteomes) and alldecoy (the shuffled
index as the target). DEV data only. Usage: devdump.py <workers> <threads>"""
import json, os, shlex, subprocess, sys, time, gzip, shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
BIN = "/scratch/kohlbach/b113/species/build/FASTag"
REP = Path("/scratch/kohlbach/b113/species/devrep/species/runs")
OUT = Path("/scratch/kohlbach/b113/species/devdump")
TAX = {"real": "/scratch/kohlbach/fastag112-dev/tax", "alldecoy": "/scratch/kohlbach/fastag112-alldecoy/tax_decoy"}
DDB = {"real": "/scratch/kohlbach/fastag112-alldecoy/tax_decoy/tax_k7.taxdb", "alldecoy": None}
IN = Path("/dev/shm/kohlbach-b113sp")

def one(run, threads, log):
    meta = json.loads((REP / run / "meta.json").read_text())
    raw = (REP / run / "base" / "command.txt").read_text().split()
    cmd = []
    for t in raw:  # command.txt was written with " ".join: re-attach '(K)' / '(N-term)' to the mod name
        if t.startswith("(") and cmd and not cmd[-1].startswith("-"):
            cmd[-1] += " " + t
        else:
            cmd.append(t)
    src = Path(meta["mzml"])
    IN.mkdir(exist_ok=True)
    mz = IN / src.name
    shutil.copyfile(src, mz)
    for arm in ("real", "alldecoy"):
        d = OUT / run / arm
        if (d / "dump.tsv.gz").exists():
            continue
        d.mkdir(parents=True, exist_ok=True)
        c = list(cmd)
        c[0] = BIN
        c[c.index("-in") + 1] = str(mz)
        c[c.index("-out") + 1] = str(d / "tags.tsv")
        c[c.index("-species_out") + 1] = str(d / "species.tsv")
        c[c.index("-threads") + 1] = str(threads)
        env = dict(os.environ, FASTAG_TAXONOMY_DIR=TAX[arm], FASTAG_SPECIES_DUMP=str(d / "dump.tsv"),
                   FASTAG_SPECIES_DUMP_DECOYS="10", TMPDIR="/dev/shm/kohlbach-tmp", OPENMS_TMPDIR="/dev/shm/kohlbach-tmp")
        env.pop("FASTAG_SPECIES_DECOYDB", None)
        if DDB[arm]:
            env["FASTAG_SPECIES_DECOYDB"] = DDB[arm]
        (d / "command.txt").write_text(" ".join(c) + "\n")
        t0 = time.time()
        with open(d / "run.log", "w") as fh:
            rc = subprocess.run(c, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
        (d / "tags.tsv").unlink(missing_ok=True)
        if rc == 0:
            subprocess.run(["gzip", "-f", str(d / "dump.tsv")])
        log.write(f"{time.strftime('%T')} {run} {arm} rc {rc} {time.time()-t0:.0f}s\n"); log.flush()
    (d.parent / "meta.json").write_text(json.dumps(meta) + "\n")
    mz.unlink()

def main():
    w, t = int(sys.argv[1]), int(sys.argv[2])
    runs = sys.argv[3:] or sorted(p.name for p in REP.iterdir() if (p / "base" / "command.txt").exists())
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "driver.log", "a") as log, ThreadPoolExecutor(w) as ex:
        log.write(f"start {len(runs)} runs\n"); log.flush()
        list(ex.map(lambda r: one(r, t, log), runs))
        log.write("DRIVER_DONE\n")
main()
