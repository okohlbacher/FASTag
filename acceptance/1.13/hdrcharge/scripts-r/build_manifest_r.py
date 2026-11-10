#!/usr/bin/env python3
"""hdrcharge second held-out round: manifest and disjointness table from the staging and qualification tables.
Usage: build_manifest_r.py <acceptance/1.13 dir>
Reads hdrcharge/inputs-r/qualification/{staged_<role>.<PXD>.tsv, <PXD>.qualification.tsv, <PXD>.role} (copied from
data:/scratch/kohlbach/b113/hdrcharge/heldout/r2) and inputs-r/stage.tsv, draw.tsv. Paths in the manifest are
relative to the round root."""
import csv, os, sys
A = sys.argv[1]; H = A + "/hdrcharge"; Q = H + "/inputs-r/qualification"
rd = lambda p: list(csv.DictReader(open(p), delimiter="\t"))
url = {(r["accession"], r["file"]): r["url"] for r in rd(H + "/inputs-r/stage.tsv")}
rank = {r["accession"]: r["draw_rank"] for r in rd(H + "/inputs-r/draw.tsv") if r["result"] == "TAKEN"}
# sha256 of the DEV and first-round files that are on record (registry rows DEV-14-hdrcharge, manifests/item14-hdrcharge.tsv)
known = {"2b1da22229a9d8e8d4cde05d889c3a74dedd68bb9f00f3bdd9d78d2a8d9ace4a", "03985d6cfde59f42181d5e0a6f3a2521dcdaaef8bb8a3448f14c6d6b611c68fd"}
known |= {r["fastag_input_sha256"] for r in csv.DictReader((l for l in open(A + "/manifests/item14-hdrcharge.tsv") if not l.startswith("# ")), delimiter="\t")}
excl = {l.split("\t")[0].strip() for l in open(H + "/inputs-r/excl_pxd.tsv")}
cols = "item split class pxd run instrument input input_sha256 raw_sha256 truth truth_sha256 chimera chimera_sha256 perturbed perturbed_sha256 perturbed_tsv perturbed_tsv_sha256 truth_spectra url selection".split()
M, D = [], []
for pxd in sorted(rank, key=lambda p: (0 if any(p == r["accession"] and r["class"] == "qe" for r in rd(H + "/inputs-r/stage.tsv")) else 1, int(rank[p]))):
    role = open(f"{Q}/{pxd}.role").read().strip()
    s = rd(f"{Q}/staged_{role}.{pxd}.tsv")[-1]; q = rd(f"{Q}/{pxd}.qualification.tsv")[-1]
    assert s["check"] == "ok" and q["sage_rc_truth"] == "0" and q["sage_rc_chimera"] == "0" and int(q["truth_spectra"]) >= 500, pxd
    w = pxd + "/work/"
    M.append(["#14r", "heldout", s["class"], pxd, s["file"][:-4], s["instrument"], s["mzml"], s["mzml_sha256"], s["raw_sha256"],
              w + "truth/results.sage.tsv", q["truth_sage_sha256"], w + "chimera/results.sage.tsv", q["chimera_sage_sha256"],
              w + "pert.mzML", q["pert_sha256"], w + "pert.mzML.perturbed.tsv", q["pert_tsv_sha256"], q["truth_spectra"],
              url[(pxd, s["file"])], f"draw rank {rank[pxd]} of random.Random('fastag-1.13:hdrcharge:heldout-r:{s['class']}'); {role} file; {s['status']}"])
    a, b = pxd in excl, s["mzml_sha256"] in known
    D.append([s["mzml"], pxd, s["mzml_sha256"], "yes" if a else "no", "yes" if b else "no", "FAIL" if a or b else "PASS"])
with open(A + "/manifests/item14r-hdrcharge.tsv", "w") as f:
    f.write("# staged under data:/scratch/kohlbach/b113/hdrcharge/heldout/r2 (paths relative to it); built by hdrcharge/scripts-r/build_manifest_r.py\n")
    f.write("\t".join(cols) + "\n"); f.writelines("\t".join(r) + "\n" for r in M)
with open(A + "/disjointness/item14r-hdrcharge.tsv", "w") as f:
    f.write("file\tpxd\tfastag_input_sha256\tpxd_in_dev_or_spent_or_reserved\tfile_in_dev_or_spent\tresult\n"); f.writelines("\t".join(r) + "\n" for r in D)
print(len(M), "runs;", "disjoint" if all(r[-1] == "PASS" for r in D) else "NOT DISJOINT")
