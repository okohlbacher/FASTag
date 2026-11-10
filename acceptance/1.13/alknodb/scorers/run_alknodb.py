#!/usr/bin/env python3
"""FASTag 1.13 alknodb held-out: the single run. One FASTag call per manifest row (primary), then one more per row
whose `db_fasta` is not `-` (secondary: the database call -alkylation_out). Nothing is scored here.

Primary:   FASTag -in <mzML> -out <scratch tsv> -tag_length 4 -extension 6 -fixed_modifications "" \
             -fragment_tolerance 20 -fragment_tolerance_unit ppm -alkylation_tags_out <out>/<PXD>/alkt.tsv -threads 8
Secondary: the same without -alkylation_tags_out, with -alkylation_out <out>/<PXD>/alkdb.tsv -alkylation_proteome <fasta>
The mzML sha256 is checked against the manifest first (mismatch: the row is not run, status `input_mismatch`).
The tag TSV goes to /dev/shm and is deleted. Refuses to start when <out>/RUN_STARTED exists (one run only).
Usage: run_alknodb.py <manifest.tsv> <staged root> <out dir> <FASTag binary> <binary sha256> [workers=8]"""
import csv, hashlib, json, os, shutil, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

MAN, ROOT, OUT, BIN, BINSHA = sys.argv[1:6]
WORKERS = int(sys.argv[6]) if len(sys.argv) > 6 else 8
FASTA = {"human": "/ceph/ibmi/abi/oliver/jpr-bench/data/PXD054073/UP000005640_9606.fasta"}
WORK = "/dev/shm/kohlbach-alkt-ho"
OPTS = ["-tag_length", "4", "-extension", "6", "-fixed_modifications", "", "-fragment_tolerance", "20",
        "-fragment_tolerance_unit", "ppm"]


def sha(f):
    h = hashlib.sha256()
    with open(f, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 24), b""):
            h.update(b)
    return h.hexdigest()


def one(r):
    a = r["pxd"]
    o = f"{OUT}/{a}"
    os.makedirs(o, exist_ok=True)
    w = f"{WORK}/{a}"
    os.makedirs(w, exist_ok=True)
    mz = f"{ROOT}/{r['mzml']}"
    st = {"pxd": a, "rc": None, "rc_db": None}
    if not os.path.exists(mz) or sha(mz) != r["mzml_sha256"]:
        st["status"] = "input_mismatch"
    else:
        env = dict(os.environ, TMPDIR=w, OPENMS_TMPDIR=w)
        cmd = [BIN, "-in", mz, "-out", f"{w}/tags.tsv"] + OPTS + ["-alkylation_tags_out", f"{o}/alkt.tsv",
                                                                 "-threads", "8"]
        t = time.time()
        with open(f"{o}/run.log", "w") as fh:
            st["rc"] = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
        st["sec"] = round(time.time() - t, 1)
        st["cmd"] = cmd
        st["status"] = "ran"
        if r["db_fasta"] != "-":
            cmd = [BIN, "-in", mz, "-out", f"{w}/tags_db.tsv"] + OPTS + [
                "-alkylation_out", f"{o}/alkdb.tsv", "-alkylation_proteome", FASTA[r["db_fasta"]], "-threads", "8"]
            with open(f"{o}/run_db.log", "w") as fh:
                st["rc_db"] = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
            st["cmd_db"] = cmd
    shutil.rmtree(w, ignore_errors=True)
    json.dump(st, open(f"{o}/status.json", "w"))
    return st["status"], st["rc"]


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    if os.path.exists(f"{OUT}/RUN_STARTED"):
        sys.exit("RUN_STARTED exists: the held-out run was already started; it is run once")
    if sha(BIN) != BINSHA:
        sys.exit("binary sha256 differs from the frozen one")
    open(f"{OUT}/RUN_STARTED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S%z\n"))
    rows = list(csv.DictReader((l for l in open(MAN) if not l.startswith("#")), delimiter="\t"))
    with ThreadPoolExecutor(WORKERS) as ex:
        res = list(ex.map(one, rows))
    print(f"{len(rows)} rows; ran {sum(1 for s, _ in res if s == 'ran')}; rc 0 {sum(1 for _, rc in res if rc == 0)}",
          flush=True)
    print("RUN_DONE", flush=True)
