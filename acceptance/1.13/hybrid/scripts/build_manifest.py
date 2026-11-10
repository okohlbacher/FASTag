#!/usr/bin/env python3
"""Qualification table and held-out manifest of the hybrid arm from the staging output. Reads no FASTag output.

Usage: build_manifest.py <candidates.tsv> <held-out root> <qualification.tsv out> <manifest out>
Rule (PREREG-hybrid.md): a run qualifies with a verified download, Sage return code 0, at least 1,000 hybrid
Orbitrap MS2 spectra and at least 200 truth spectra. Every qualifying run enters the manifest."""
import csv
import sys
from pathlib import Path

MIN_HYBRID, MIN_TRUTH = 1000, 200
cand, root, qout, mout = sys.argv[1], Path(sys.argv[2]), sys.argv[3], sys.argv[4]
qrows, mrows = [], []
for c in csv.DictReader(open(cand), delimiter="\t"):
    stem = c["file"].rsplit(".", 1)[0]
    d = root / c["project"] / stem
    st = next(csv.DictReader(open(d / "stage.tsv"), delimiter="\t")) if (d / "stage.tsv").exists() else {}
    q = dict(line.rstrip("\n").split("\t", 1) for line in open(d / "qualification.tsv")) \
        if (d / "qualification.tsv").exists() else {}
    hyb, truth = int(q.get("hybrid_ftms_ms2", 0)), int(q.get("truth_spectra", 0))
    ok = st.get("status") in ("sha1_ok", "size_ok") and q.get("sage_rc") == "0" and hyb >= MIN_HYBRID and truth >= MIN_TRUTH
    classes = "; ".join(f"{k[4:]} {v}" for k, v in sorted(q.items()) if k.startswith("ms2 "))
    qrows.append([c["project"], c["file"], st.get("status", "not staged"), q.get("ms2", ""), classes, hyb, truth,
                  q.get("truth_clusters", ""), q.get("sage_rc", ""), c["truth_config"], "yes" if ok else "no"])
    if ok:
        rel = f"{c['project']}/{stem}"
        mrows.append(["#hybrid", c["project"], stem, f"{c['project']}/{stem}.mzML", st["mzml_sha256"],
                      f"{rel}/truth/results.sage.tsv", q["sage_sha256"], f"{rel}/scans.tsv", q["scans_sha256"],
                      hyb, truth, st["raw_sha256"], c["truth_config"], c["url"]])
w = csv.writer(open(qout, "w"), delimiter="\t", lineterminator="\n")
w.writerow("project file download ms2 ms2_classes hybrid_ftms_ms2 truth_spectra truth_clusters sage_rc truth_config qualifies".split())
w.writerows(qrows)
w = csv.writer(open(mout, "w"), delimiter="\t", lineterminator="\n")
w.writerow("item project run mzml mzml_sha256 sage sage_sha256 scans scans_sha256 hybrid_ftms_ms2 truth_spectra "
           "raw_sha256 truth_config url".split())
w.writerows(mrows)
print(f"{len(mrows)} runs of {len({r[1] for r in mrows})} projects qualify")
