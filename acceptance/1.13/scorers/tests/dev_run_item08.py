#!/usr/bin/env python3
"""Backlog #8 DEV regeneration (in-sample, descriptive): re-run arm B (the termini command) of the item05
report runs with the feat/b113-labelcall binary, at the default and at -label_call_min_tags 175.
Only the binary, the output paths and -threads (4) change. Usage: dev_run.py <FASTag> <outdir> <jobs>"""
import json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

SRC = "/scratch/kohlbach/fastag-carryover-1.12/item05/reports"
FASTAG, OUT, JOBS = sys.argv[1], sys.argv[2], int(sys.argv[3])
DIGEST_DIR = "/scratch/kohlbach/b113/labelcall/src/data/digest"
WORK = "/dev/shm/kohlbach-b113-labelcall-dev"


def job(item):
    name, argv0, arm = item
    o, w = f"{OUT}/{name}", f"{WORK}/{name}"
    os.makedirs(o, exist_ok=True); os.makedirs(w, exist_ok=True)
    argv = list(argv0)
    argv[0] = FASTAG
    argv[argv.index("-threads") + 1] = "4"
    argv[argv.index("-out") + 1] = f"{w}/{arm}.tags.tsv"
    argv[argv.index("-digest_out") + 1] = f"{o}/{arm}.digest.tsv"
    argv[argv.index("-label_out") + 1] = f"{o}/{arm}.label.tsv"
    if arm == "B175":
        argv += ["-label_call_min_tags", "175"]
    env = dict(os.environ, FASTAG_FULL_PRECISION="1", OPENMS_TMPDIR=w, TMPDIR=w, FASTAG_DIGEST_DIR=DIGEST_DIR)
    t = time.time()
    with open(f"{o}/{arm}.log", "w") as fh:
        rc = subprocess.run(argv, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
    try:
        os.remove(f"{w}/{arm}.tags.tsv")
    except OSError:
        pass
    return name, arm, rc, round(time.time() - t, 2)


items = []
for name in sorted(os.listdir(SRC)):
    st = f"{SRC}/{name}/status.json"
    if not os.path.exists(st):
        continue
    cmd = json.load(open(st))["cmd"].get("B")
    if cmd:
        items += [(name, cmd, "B0"), (name, cmd, "B175")]
print(len(items), "commands", flush=True)
with ThreadPoolExecutor(JOBS) as ex:
    for r in ex.map(job, items):
        print(*r, flush=True)
print("DONE", flush=True)
