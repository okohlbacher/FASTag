#!/usr/bin/env python3
"""results/ladder_inputs_v180.tsv from the node's in/inputs_sha.tsv (bytes, sha256 of every ladder input).

    inputs_table.py inputs_sha.tsv results/ladder_inputs_v180.tsv
"""
import csv
import sys
from pathlib import Path

LABEL = {"PXD003531": "Q Exactive DDA", "PXD076528": "Orbitrap Astral DDA", "PXD054073": "timsTOF ddaPASEF",
         "PXD028735": "timsTOF diaPASEF frames", "PXD047793": "diaTracer pseudo-MS2"}
MZML_ROUTE = {
    "PXD003531": "ThermoRawFileParser 2.0.0 -f 2 -L 1-2 (gate input, sha256 as datasets.yaml)",
    "PXD076528": "ThermoRawFileParser 2.0.0.0 -f=2 -L=1-2 (bioconda thermorawfileparser=2.0.0), 232 s, this study",
    "PXD054073": "7z x (p7zip 16.02) + mzpeak-convert 0.18.0 --to mzml on the .d, 1362 s, this study; keeps the ion-mobility array",
    "PXD028735": "existing OpenMS-written mzML (sha256 as datasets.yaml); declares <spectrumList count=\"0\">",
    "PXD047793": "existing diaTracer pseudo-MS2 mzML (sha256 as datasets.yaml)",
}


def fmt_of(name):
    if name.endswith(".point.mzpeak"):
        return "point"
    if name.endswith(".chunked.mzpeak"):
        return "chunked"
    if name.endswith(".lossless.mzpeak"):
        return "lossless"
    if name.endswith(".cvpatch.mzML"):
        return "mzML_cvpatch"
    if name.endswith(".count.mzML"):
        return "mzML_countpatch"
    return "mzML"


src, dst = sys.argv[1:3]
rows = list(csv.DictReader(open(src), delimiter="\t"))
out = []
for r in rows:
    ds, name = r["file"].split("/", 1)
    f = fmt_of(name)
    if f in ("point", "chunked", "lossless"):
        base = "count-patched mzML" if ds == "PXD028735" else "mzML"
        conv = f"mzpeak-convert 0.18.0 --layout {f} from the {base}" if f != "lossless" else "mzpeak-convert 0.18.0 --lossless (check only)"
    elif f == "mzML_cvpatch":
        conv = "patch_cv.py: 3 header CV accessions replaced by older same-length ones (DirecTag input); spectra and offsets unchanged"
    elif f == "mzML_countpatch":
        conv = "patch_count.py: spectrumList count 0 -> 156388, 5 indentation tabs removed; spectra and offsets unchanged"
    else:
        conv = MZML_ROUTE[ds]
    out.append({"dataset": ds, "format": f, "label": LABEL[ds], "file": name, "bytes": r["bytes"], "sha256": r["sha256"],
                "conversion": conv})
Path(dst).parent.mkdir(parents=True, exist_ok=True)
with open(dst, "w") as fh:
    fh.write("# source: kim:/scratch/kohlbach/ladder/in/inputs_sha.tsv (stat + sha256sum, 2026-11-03), copy in /ceph/ibmi/abi/oliver/jpr-bench/ladder/\n")
    fh.write("# inputs of the FASTag 1.8.0 thread ladder (Figures 4, 5); public PXD data only; conversions untimed\n")
    w = csv.DictWriter(fh, fieldnames=list(out[0]), delimiter="\t", lineterminator="\n")
    w.writeheader()
    w.writerows(out)
print(dst, len(out))
