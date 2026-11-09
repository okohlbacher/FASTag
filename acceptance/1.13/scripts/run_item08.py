#!/usr/bin/env python3
"""Backlog #8 held-out runs (PREREG-item08.md): the termini command of PREREG-chem on every `include = yes` row of
manifests/item08-heldout.tsv, once per frozen config. Before any FASTag run the binary's sha256 is checked
against the PREREG and every input's sha256 against the manifest; an input that differs is not run and is
recorded as INPUT_CHANGED (the scorer counts it as described in the PREREG).
Usage: run_item08.py <manifest> <FASTag binary> <binary sha256> <digest dir> <staged root> <runs root> <jobs>
Writes <runs root>/<CFG>/<pxd>__<run>/{label.tsv,digest.tsv,log.txt,rc.txt} and <runs root>/inputs_verified.tsv."""
import csv
import hashlib
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

man, fastag, bin_sha, digest_dir, staged, runs, jobs = sys.argv[1:8]
jobs = int(jobs)
CONFIGS = {"CFG-08-cand": [], "CFG-08-base": ["-label_call_min_tags", "175"]}
TERMINI = ["-tag_length", "4", "-threads", "4", "-subsample_fraction", "0.25", "-fragment_tolerance", "20.0",
           "-fragment_tolerance_unit", "ppm"]


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


if sha(fastag) != bin_sha:
    sys.exit(f"binary sha256 {sha(fastag)} is not the frozen {bin_sha}")
rows = [r for r in csv.DictReader((l for l in open(man) if not l.startswith("# ")), delimiter="\t")
        if r["include"] == "yes"]
os.makedirs(runs, exist_ok=True)


def verify(r):
    p = os.path.join(staged, r["fastag_input"])
    got = sha(p) if os.path.exists(p) else "missing"
    return r, p, got == r["fastag_input_sha256"], got


with ThreadPoolExecutor(jobs) as ex:
    checked = list(ex.map(verify, rows))
with open(f"{runs}/inputs_verified.tsv", "w") as fh:
    fh.write("pxd\trun\tpath\tsha256_manifest\tsha256_found\tresult\n")
    for r, p, ok, got in checked:
        fh.write(f"{r['pxd']}\t{r['run']}\t{p}\t{r['fastag_input_sha256']}\t{got}\t{'OK' if ok else 'INPUT_CHANGED'}\n")
todo = [(cfg, r, p) for r, p, ok, _ in checked if ok for cfg in CONFIGS]


def run(item):
    cfg, r, p = item
    o = f"{runs}/{cfg}/{r['pxd']}__{r['run']}"
    w = f"/dev/shm/kohlbach-item08/{cfg}/{r['pxd']}__{r['run']}"
    os.makedirs(o, exist_ok=True)
    os.makedirs(w, exist_ok=True)
    argv = [fastag, "-in", p, "-out", f"{w}/tags.tsv"] + TERMINI + \
        ["-digest_out", f"{o}/digest.tsv", "-label_out", f"{o}/label.tsv"] + CONFIGS[cfg]
    env = dict(os.environ, FASTAG_FULL_PRECISION="1", FASTAG_DIGEST_DIR=digest_dir, OPENMS_TMPDIR=w, TMPDIR=w)
    with open(f"{o}/log.txt", "w") as fh:
        fh.write(" ".join(argv) + "\n")
        fh.flush()
        rc = subprocess.run(argv, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
    open(f"{o}/rc.txt", "w").write(f"{rc}\n")
    try:
        os.remove(f"{w}/tags.tsv")
    except OSError:
        pass
    return cfg, r["pxd"], r["run"], rc


print(len(rows), "rows,", sum(ok for _, _, ok, _ in checked), "inputs verified,", len(todo), "runs", flush=True)
with ThreadPoolExecutor(jobs) as ex:
    for res in ex.map(run, todo):
        print(*res, flush=True)
print("DONE", flush=True)
