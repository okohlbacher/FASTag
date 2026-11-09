#!/usr/bin/env python3
"""Backlog #8 (label call refit): the held-out manifest item08-heldout and its disjointness check.

Source: acceptance/1.12/manifests/item03-heldout.tsv (registry HO-03-heldout-r2/-r3: registered, never scored,
"refit on DEV first, a new config is preregistered later"). Every row is kept; `include` says whether it is
scored for the label piece, decided from the manifest columns only (no FASTag output is read):
  - label_truth must be label-free, TMT, TMTpro, iTRAQ4, iTRAQ8 or SILAC (else not_label_evaluable);
  - stage_status must not contain DOWNLOAD_FAILED or SECOND_DOWNLOAD_DIFFERS (else excluded:<status>);
  - fastag_input and fastag_input_sha256 must be set.
TMTpro and iTRAQ8 are one class (same mass). Disjointness: no PXD of the manifest is a PXD of the 254 DEV
truth rows of output/jpr-paper/carryover-1.12/label_call.tsv (the 193 evaluable runs are among them).
Usage: build_item08.py <item03-heldout.tsv> <label_call.tsv> <out manifest> <out disjointness>"""
import csv
import hashlib
import sys

src, dev, out_m, out_d = sys.argv[1:5]
EVAL = {"label-free", "TMT", "TMTpro", "iTRAQ4", "iTRAQ8", "SILAC"}
CLS = {"TMTpro": "TMTpro/iTRAQ8", "iTRAQ8": "TMTpro/iTRAQ8"}
rows = list(csv.DictReader((l for l in open(src) if not l.startswith("# ")), delimiter="\t"))
devrows = list(csv.DictReader((l for l in open(dev) if not l.startswith("#")), delimiter="\t"))
devpxd = {r["acc"] for r in devrows}
cols = ["item", "split", "pxd", "run", "stratum", "instrument", "label_truth", "label_class", "fastag_input",
        "fastag_input_sha256", "stage_status", "include"]
src_sha = hashlib.sha256(open(src, "rb").read()).hexdigest()
with open(out_m, "w", newline="") as fh:
    fh.write(f"# item08-heldout: the rows of acceptance/1.12/manifests/item03-heldout.tsv (sha256 {src_sha}); "
             "inputs under data:/scratch/kohlbach/fastag-heldout-1.12\n")
    w = csv.writer(fh, delimiter="\t", lineterminator="\n")
    w.writerow(cols)
    for r in rows:
        st = r["stage_status"]
        if r["label_truth"] not in EVAL:
            inc = "not_label_evaluable"
        elif "DOWNLOAD_FAILED" in st or "SECOND_DOWNLOAD_DIFFERS" in st:
            inc = "excluded:" + st
        elif not r["fastag_input"] or not r["fastag_input_sha256"]:
            inc = "excluded:no_input"
        else:
            inc = "yes"
        w.writerow(["#8", "heldout", r["pxd"], r["run"], r["stratum"], r["instrument"], r["label_truth"],
                    CLS.get(r["label_truth"], r["label_truth"]) if r["label_truth"] in EVAL else "",
                    r["fastag_input"], r["fastag_input_sha256"], st, inc])
bad = 0
with open(out_d, "w", newline="") as fh:
    w = csv.writer(fh, delimiter="\t", lineterminator="\n")
    w.writerow(["pxd", "run", "pxd_in_dev_truth_rows", "result"])
    for r in rows:
        hit = r["pxd"] in devpxd
        bad += hit
        w.writerow([r["pxd"], r["run"], "yes" if hit else "no", "FAIL" if hit else "PASS"])
print(f"{len(rows)} rows; DEV PXD overlap {bad}; source sha256 {src_sha}")
sys.exit(1 if bad else 0)
