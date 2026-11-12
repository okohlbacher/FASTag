#!/usr/bin/env python3
"""Label discovery held-out test 5 runs (PREREG-labeldisc5.md; the test-4 runner unchanged but for names; the runner of the earlier tests unchanged but for names): one FASTag run per `include = yes` row of
the audited manifest with the frozen binary. Before any run the binary's sha256 is checked against the
given value and every input's sha256 against the manifest; an input that differs or is missing is not run and is
recorded (the scorer counts it as a no call).
Command (the item #8 termini command at 8 threads, with -label_discovery_out):
  FASTag -in <input> -out <tmp> -tag_length 4 -threads 8 -subsample_fraction 0.25 -fragment_tolerance 20.0
         -fragment_tolerance_unit ppm -digest_out digest.tsv -label_out label.tsv -label_discovery_out ld.tsv
  env FASTAG_FULL_PRECISION=1, FASTAG_DIGEST_DIR=<digest dir>
Usage: run_heldout5.py <manifest> <FASTag wrapper> <FASTag.bin> <bin sha256> <digest dir> <runs root> <jobs>
Writes <runs root>/<id>/{ld.tsv,label.tsv,digest.tsv,log.txt,rc.txt} and <runs root>/inputs_verified.tsv."""
import csv, hashlib, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

man, wrapper, binary, bin_sha, digest_dir, runs, jobs = sys.argv[1:8]
jobs = int(jobs)
CMD = ["-tag_length", "4", "-threads", "8", "-subsample_fraction", "0.25", "-fragment_tolerance", "20.0",
       "-fragment_tolerance_unit", "ppm"]


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 22), b""): h.update(b)
    return h.hexdigest()


if sha(binary) != bin_sha: sys.exit(f"binary sha256 {sha(binary)} is not the frozen {bin_sha}")
rows = [r for r in csv.DictReader((l for l in open(man) if not l.startswith("# ")), delimiter="\t") if r["include"] == "yes"]
os.makedirs(runs, exist_ok=True)


def verify(r):
    p = os.path.join(r["root"], r["fastag_input"]) if r["fastag_input"] not in ("", "-") else ""
    got = sha(p) if p and os.path.exists(p) else "missing"
    return r, p, got == r["fastag_input_sha256"], got


with ThreadPoolExecutor(jobs) as ex: checked = list(ex.map(verify, rows))
with open(f"{runs}/inputs_verified.tsv", "w") as fh:
    fh.write("id\tpath\tsha256_manifest\tsha256_found\tresult\n")
    for r, p, ok, got in checked:
        fh.write(f"{r['id']}\t{p}\t{r['fastag_input_sha256']}\t{got}\t{'OK' if ok else 'INPUT_CHANGED'}\n")


def run(item):
    r, p = item
    o, w = f"{runs}/{r['id']}", f"/dev/shm/kohlbach-ld5-{os.path.basename(runs)}/{r['id']}"
    os.makedirs(o, exist_ok=True); os.makedirs(w, exist_ok=True)
    argv = [wrapper, "-in", p, "-out", f"{w}/tags.tsv"] + CMD + \
        ["-digest_out", f"{o}/digest.tsv", "-label_out", f"{o}/label.tsv", "-label_discovery_out", f"{o}/ld.tsv"]
    env = dict(os.environ, FASTAG_FULL_PRECISION="1", FASTAG_DIGEST_DIR=digest_dir, OPENMS_TMPDIR=w, TMPDIR=w)
    with open(f"{o}/log.txt", "w") as fh:
        rc = subprocess.run(argv, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
    open(f"{o}/rc.txt", "w").write(f"{rc}\n")
    for f in os.listdir(w): os.remove(os.path.join(w, f))
    os.rmdir(w)
    return r["id"], rc


todo = [(r, p) for r, p, ok, _ in checked if ok]
with ThreadPoolExecutor(jobs) as ex:
    for i, rc in ex.map(run, todo): print(i, rc, flush=True)
print("DONE", len(todo), "runs of", len(rows), flush=True)
