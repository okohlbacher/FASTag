#!/usr/bin/env python3
"""Label discovery evaluation 2: re-run the first evaluation's command (eval/scripts/run_eval.py: the stored item05
arm-B label-report command, or the standard settings for the massgap-only runs and the two extras) for the runs of
one half of acceptance/1.13/labeldisc/manifests/split-256.tsv, with a given binary.
Writes <out>/<name>/{ld.tsv,label.tsv,digest.tsv,log,rc.txt,status.json}.
Usage: run_set.py <split-256.tsv> <DEV|TEST> <FASTag wrapper> <out dir> <jobs> [name ...]"""
import csv, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
SPLIT, HALF, FASTAG, OUT, JOBS = sys.argv[1:6]
ONLY = set(sys.argv[6:])
ITEM05 = "/scratch/kohlbach/fastag-carryover-1.12/item05/reports"
DIGEST = "/scratch/kohlbach/fastag-labeldisc/src/data/digest"
P = "/ceph/ibmi/abi/oliver/prose-auto-20261029"
STD = ["-tag_length", "4", "-threads", "8", "-subsample_fraction", "0.25", "-fragment_tolerance", "20.0", "-fragment_tolerance_unit", "ppm"]
EXTRA = {
  "extra__PXD000001__TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01": f"{P}/mzml/PXD000001/TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01.mzML",
  "extra__PXD000865__0270_F1_R1_P75878B09_TMT8": "/ceph/ibmi/abi/projects/proteomics/kuster_proteome/MZML/8/0270_F1_R1_P75878B09_TMT8.mzML",
}
WORK = f"/dev/shm/kohlbach-ld2-{os.getpid()}"


def command(name):
    if name in EXTRA: return EXTRA[name], STD
    st = json.load(open(f"{ITEM05}/{name}/status.json"))
    if "B" not in st["cmd"]:
        a = st["cmd"]["C"]; return a[a.index("-in") + 1], STD
    argv = list(st["cmd"]["B"]); inp = argv[argv.index("-in") + 1]; rest = []; i = 1
    while i < len(argv):
        k = argv[i]
        if k in ("-in", "-out", "-digest_out", "-label_out"): i += 2; continue
        rest.append(k); i += 1
    return inp, rest


def job(name):
    inp, rest = command(name)
    o, w = f"{OUT}/{name}", f"{WORK}/{name}"
    os.makedirs(o, exist_ok=True); os.makedirs(w, exist_ok=True)
    argv = [FASTAG, "-in", inp, "-out", f"{w}/tags.tsv", "-digest_out", f"{o}/digest.tsv",
            "-label_out", f"{o}/label.tsv", "-label_discovery_out", f"{o}/ld.tsv"] + rest
    env = dict(os.environ, FASTAG_FULL_PRECISION="1", OPENMS_TMPDIR=w, TMPDIR=w, FASTAG_DIGEST_DIR=DIGEST)
    t = time.time()
    with open(f"{o}/log", "w") as fh:
        rc = subprocess.run(argv, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
    dt = round(time.time() - t, 2)
    open(f"{o}/rc.txt", "w").write(f"{rc}\n")
    json.dump({"argv": argv, "rc": rc, "wall": dt}, open(f"{o}/status.json", "w"))
    for f in os.listdir(w): os.remove(f"{w}/{f}")
    os.rmdir(w)
    return name, rc, dt


if __name__ == "__main__":
    rows = [r for r in csv.DictReader((l for l in open(SPLIT) if not l.startswith("#")), delimiter="\t") if r["half"] == HALF]
    names = [r["name"] for r in rows if not ONLY or r["name"] in ONLY]
    print(len(names), "runs", flush=True)
    with ThreadPoolExecutor(int(JOBS)) as ex:
        for name, rc, dt in ex.map(job, names): print(name, rc, dt, flush=True)
    print("DONE", flush=True)
