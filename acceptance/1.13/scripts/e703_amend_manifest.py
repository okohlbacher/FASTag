#!/usr/bin/env python3
"""Build acceptance/1.13/manifests/item07-E7-03.tsv (PREREG-item07 amendment 1) from the committed 1.12 manifest
and the Windows conversions of the 28 files that were not convertible on Linux.

Only the conversion columns of those rows change (conv_rc, fastag_input, fastag_input_bytes, fastag_input_sha256,
conversion_note). The drawn sample, the strata, the classes (truth labels), the raw files and their sha256, and every
row staged in 1.12 stay byte-identical. A row whose conversion failed keeps an empty fastag_input_sha256 (NOT_STAGED).
Usage: e703_amend_manifest.py <1.12 manifest> <conversions.tsv> <out manifest>
conversions.tsv: id, rc, fastag_input, bytes, sha256, note (one row per converted file, header line)."""
import csv
import sys

src, conv, out = sys.argv[1:4]
lines = open(src).read().splitlines(keepends=True)
head = [l for l in lines if l.startswith("# ")]
body = [l for l in lines if not l.startswith("# ")]
rows = list(csv.DictReader(body, delimiter="\t"))
cols = body[0].rstrip("\n").split("\t")
cv = {r["id"]: r for r in csv.DictReader(open(conv), delimiter="\t")}
done = set()
for r in rows:
    c = cv.get(r["id"])
    if c is None:
        continue
    if r["fastag_input_sha256"]:
        sys.exit(f"{r['id']}: already staged in 1.12, not replaced")
    r["conv_rc"] = c["rc"]
    r["conversion_note"] = c["note"]
    if c["sha256"]:
        r["fastag_input"], r["fastag_input_bytes"], r["fastag_input_sha256"] = c["fastag_input"], c["bytes"], c["sha256"]
    done.add(r["id"])
missing = set(cv) - done
if missing:
    sys.exit(f"conversion ids not in the manifest: {sorted(missing)}")
with open(out, "w", newline="") as f:
    f.write("# staged under data:/scratch/kohlbach/fastag-heldout-1.12; amendment 1 (acceptance/1.13): "
            f"{len(done)} rows converted with msconvert on Windows (flash)\n")
    w = csv.DictWriter(f, cols, delimiter="\t", lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
print(f"{len(done)} rows amended; staged now {sum(bool(r['fastag_input_sha256']) for r in rows)}/{len(rows)}")
