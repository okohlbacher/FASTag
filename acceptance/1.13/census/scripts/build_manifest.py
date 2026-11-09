#!/usr/bin/env python3
"""FASTag 1.13 item 7 (#11 triage): manifest and DEV-disjointness table from the staging outputs.

    build_manifest.py <inputs dir with stage.tsv, draw.tsv, staged/staged_chosen.<PXD>.tsv> <acceptance/1.13 dir>
Writes manifests/census-triage.tsv and disjointness/census-triage.tsv. Refuses when a file failed its checks, when a
run shares a PXD or a file name with DEV, or when two runs share a PXD.
"""
import csv, glob, os, sys

D, ACC = sys.argv[1], sys.argv[2]
DEV = {"PXD003531": "20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01", "PXD014764": "20190412_KEH_HF_SA_ANW_R11_100419_CNOT_R1_f008"}
url = {}
for r in csv.DictReader(open(f"{D}/stage.tsv"), delimiter="\t"):
    if r["role"] == "chosen":
        url[r["accession"]] = r["url"]
rows = []
for f in sorted(glob.glob(f"{D}/staged/staged_chosen.*.tsv")):
    rows += list(csv.DictReader(open(f), delimiter="\t"))
if sorted(r["accession"] for r in rows) != sorted(url):
    sys.exit(f"staged {sorted(r['accession'] for r in rows)} != drawn {sorted(url)}")
bad = [r["accession"] for r in rows if r["check"] != "ok" or r["status"] not in ("sha1_ok", "no_pride_sha1,size_ok,second_download_same")]
if bad:
    sys.exit(f"failed staging checks: {bad} (stage the backup of these and rebuild)")
os.makedirs(f"{ACC}/manifests", exist_ok=True); os.makedirs(f"{ACC}/disjointness", exist_ok=True)
cols = ["item", "split", "run", "pxd", "file", "bytes", "pride_sha1", "url", "selection", "stage_status", "staged_raw",
        "raw_sha256", "fastag_input", "fastag_input_bytes", "fastag_input_sha256", "ms2", "ms2_ftms_hcd", "ms2_charged",
        "conversion"]
with open(f"{ACC}/manifests/census-triage.tsv", "w") as out, open(f"{ACC}/disjointness/census-triage.tsv", "w") as dj:
    out.write("# staged under data:/scratch/kohlbach/b113/census/heldout\n" + "\t".join(cols) + "\n")
    dj.write("run\tpxd\tfile_stem\tdev_pxd_overlap\tdev_file_overlap\n")
    for r in sorted(rows, key=lambda r: r["accession"]):
        stem = os.path.splitext(r["file"])[0]
        po = r["accession"] in DEV
        fo = stem in DEV.values()
        if po or fo:
            sys.exit(f"{r['accession']} overlaps DEV")
        dj.write(f"{r['accession']}\t{r['accession']}\t{stem}\t0\t0\n")
        v = ["#11", "triage", r["accession"], r["accession"], r["file"], r["bytes"], r["pride_sha1"], url[r["accession"]],
             "select_census_heldout.py, seed fastag-1.13:#11:triage:qe (chosen file)", r["status"],
             f"{r['accession']}/{r['file']}", r["raw_sha256"], r["mzml"], r["mzml_bytes"], r["mzml_sha256"], r["ms2"],
             r["ms2_ftms_hcd"], r["ms2_charged"], "ThermoRawFileParser 2.0.0 -f 2"]
        out.write("\t".join(v) + "\n")
print(f"{len(rows)} runs; DEV-disjoint (PXD and file)")
