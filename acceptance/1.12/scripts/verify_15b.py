#!/usr/bin/env python3
"""#15B: stage candidate sets in order and accept a project when its first drawn file has >= 500 electron-activated
MS2 (ETD/EThcD counted over all MS2 of the TRFP mzML; amended 2026-11-08 before any c/z run: the first rule looked
at the first 50 MS2 only and rejected PXD041660/PXD041870, whose EThcD scans may be triggered later in the run);
its other drawn files are kept only if they pass the same count.
Stops after 3 accepted projects (H1 = first two, H2 = third). Writes item15B-split.tsv. No FASTag run.
Usage: verify_15b.py <cand_15b.tsv> <scripts dir> <out.tsv>"""
import csv, subprocess, sys, os
CAND, SD, OUT = sys.argv[1:4]
ROOT = "/scratch/kohlbach/fastag-heldout-1.12"
PY = "/ceph/ibmi/abi/oliver/envs/prepdda/bin/python"
rows = [r for r in csv.DictReader(open(CAND), delimiter="\t") if r["order"] != "-"]
by = {}
for r in rows: by.setdefault(int(r["order"]), []).append(r)

def stage(r, split):
    d = f"item15B/sets/{r['pxd']}"
    line = "\t".join([f"15B:{r['pxd']}:{r['file']}", d, r["file"], r["bytes"], r["pride_sha1"] or "-", r["url"], "trfp", "-"])
    lst = f"{ROOT}/item15B/.one.tsv"; os.makedirs(os.path.dirname(lst), exist_ok=True)
    open(lst, "w").write(line + "\n")
    subprocess.run(["bash", f"{SD}/stage_pride.sh", lst, lst + ".out", "1"], check=False)
    res = open(lst + ".out").read().rstrip("\n").split("\t")
    act = ""
    if res[5] and res[4] == "0":
        open(lst + ".scan", "w").write(f"x\t{ROOT}/{res[5]}\n")
        subprocess.run([PY, "-I", f"{SD}/ms2scan.py", lst + ".scan", lst + ".scanout"], check=False,
                       env=dict(os.environ, MS2SCAN_NMAX="1000000000", MS2SCAN_MAXLINES="100000000000"))
        sc = list(csv.DictReader(open(lst + ".scanout"), delimiter="\t"))[0]
        act = sc["activation"] + "|ms2=" + sc["ms2_seen"] + "|" + sc["filter"]
    return res, act

out = open(OUT, "w")
out.write("split\torder\tpxd\tfile\tbytes\tpride_sha1\tdownload\traw_sha256\tmzml\tmzml_bytes\tmzml_sha256\tactivation\tdecision\ttitle\n")
acc = 0
for k in sorted(by):
    if acc >= 3: break
    split = "H1" if acc < 2 else "H2"
    first = True; ok = False
    for r in by[k]:
        if not first and not ok: break
        res, act = stage(r, split)
        import re as _re
        n_e = sum(int(x) for k, x in _re.findall(r"(ETD|EThcD|ECD):(\d+)", act.split("|")[0]))
        etd = n_e >= 500
        dec = ("accepted" if etd else "REJECTED: < 500 electron-activated MS2 in the first file") if first else \
              ("kept" if etd else "dropped: < 500 electron-activated MS2")
        if first: ok = etd
        out.write("\t".join([split if ok else "-", str(k), r["pxd"], r["file"], r["bytes"], r["pride_sha1"], res[2], res[3],
                             res[5], res[6], res[7], act, dec, r["title"]]) + "\n"); out.flush()
        first = False
    if ok: acc += 1
out.close()
print("accepted", acc)
