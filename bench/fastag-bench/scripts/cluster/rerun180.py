"""Re-run the digest-validation termini (A: prose-auto models, B: shipped models) and mass-gap (C) passes with the
FASTag 1.8.0 RELEASE bundle, same options as fastag-digest-val/run_one.py (RC 71a68e0). Usage: rerun180.py <i>"""
import json, os, subprocess, sys, time

V = "/ceph/ibmi/abi/oliver/fastag-digest-val"
OUT = "/ceph/ibmi/abi/oliver/jpr-bench/sdrf/rerun180"
W = "/scratch/kohlbach/sdrf-rerun180"
FASTAG = "/ceph/ibmi/abi/oliver/opt/fastag-1.8.0/FASTag/FASTag"
MODELS = f"{V}/prose_auto_013_digest_models.tsv"
TH = os.environ.get("VAL_THREADS", "8")


def run(cmd, log, env):
    t = time.time()
    with open(log, "w") as fh:
        rc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
    return rc, round(time.time() - t, 2)


R = json.load(open(f"{V}/runs.json"))
i = int(sys.argv[1]); r = R[i]
name = f"{r['set']}__{r['acc']}__{r['run']}"
d, o = f"{W}/{name}", f"{OUT}/{name}"
os.makedirs(d, exist_ok=True); os.makedirs(o, exist_ok=True)
env = dict(os.environ, FASTAG_FULL_PRECISION="1", OPENMS_TMPDIR="/dev/shm/kohlbach-tmp", TMPDIR="/dev/shm/kohlbach-tmp")
env.pop("FASTAG_DIGEST_DIR", None)
st = {"cmd": {}}
term = [FASTAG, "-in", r["input"], "-tag_length", "4", "-threads", TH, "-subsample_fraction", "0.25",
        "-fragment_tolerance", "20.0", "-fragment_tolerance_unit", "ppm"]
if "cterm_tags" in r["termini"]:
    a = term + ["-out", f"{d}/A.tags.tsv", "-digest_out", f"{o}/A.digest.tsv", "-label_out", f"{o}/A.label.tsv", "-digest_models", MODELS]
    b = term + ["-out", f"{d}/B.tags.tsv", "-digest_out", f"{o}/B.digest.tsv", "-label_out", f"{o}/B.label.tsv"]
    st["A"] = run(a, f"{o}/A.log", env); st["cmd"]["A"] = a
    st["B"] = run(b, f"{o}/B.log", env); st["cmd"]["B"] = b
if r.get("gap_cmd"):
    c = list(r["gap_cmd"]); c[0] = FASTAG
    for k, v in (("-out", f"{d}/C.tags.tsv"), ("-recon_out", f"{d}/C.recon.tsv"), ("-delta_out", f"{d}/C.delta.tsv"), ("-threads", TH)):
        c[c.index(k) + 1] = v
    c += ["-massgap_out", f"{o}/C.massgap.tsv"]
    st["C"] = run(c, f"{o}/C.log", env); st["cmd"]["C"] = c
for f in os.listdir(d):
    os.remove(f"{d}/{f}")
json.dump(st, open(f"{o}/status.json", "w"))
print(i, name, {k: v for k, v in st.items() if k != "cmd"}, flush=True)
