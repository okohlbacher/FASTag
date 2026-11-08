#!/usr/bin/env python3
"""Per-run table from every PXD SDRF of a bigbio/sdrf-annotated-datasets checkout (read-only).
Columns: pxd, sdrf, data_file, run, organisms, instrument, acquisition, dissociation, enzyme_truth, label_truth,
alk_truth, alk_basis, mods. Truth fields use fastag_bench.sdrftruth exactly as results/sdrf_truth_runs.tsv does.
Usage: mine_bigbio.py <bigbio checkout> <out.tsv>"""
import csv, glob, os, sys
sys.path.insert(0, os.environ.get("FASTAG_BENCH_SRC", "bench/fastag-bench/src"))
from fastag_bench.sdrftruth import read_sdrf, _col, kv, run_stem, enzyme_truth, label_truth, alkylation_truth  # noqa

ROOT, OUT = sys.argv[1:3]
cols = ["pxd", "sdrf", "data_file", "run", "organisms", "instrument", "acquisition", "dissociation", "enzyme_truth",
        "label_truth", "alk_truth", "alk_basis", "mods"]
n = 0
with open(OUT, "w") as o:
    w = csv.writer(o, delimiter="\t", lineterminator="\n"); w.writerow(cols)
    for path in sorted(glob.glob(f"{ROOT}/datasets/PXD*/*.sdrf.tsv")):
        pxd = os.path.basename(os.path.dirname(path))
        try:
            head, rows = read_sdrf(path)
        except Exception:
            continue
        fi = [i for i, h in enumerate(head) if h == "comment[data file]"]
        if not fi: continue
        by = {}
        for r in rows:
            for i in fi:
                if i < len(r) and r[i].strip():
                    by.setdefault(r[i].strip(), []).append(r)
        for f, hit in by.items():
            orgs = set()
            for v in _col(head, hit, "characteristics[organism]"):
                for x in v.replace(" and ", ";").split(";"):
                    if x.strip(): orgs.add(x.strip().lower())
            enz = _col(head, hit, "comment[cleavage agent details]")
            lab = _col(head, hit, "comment[label]")
            mods = _col(head, hit, "comment[modification parameters]")
            reag = _col(head, hit, "comment[alkylation reagent]")
            alk, basis = alkylation_truth(mods, reag)
            g = lambda name: ";".join(sorted({kv(c).get("NT", c) for c in _col(head, hit, name)}))
            w.writerow([pxd, os.path.relpath(path, ROOT), f, run_stem(f), ";".join(sorted(orgs)),
                        g("comment[instrument]"), g("comment[proteomics data acquisition method]"),
                        g("comment[dissociation method]") or g("comment[fragmentation method]"),
                        enzyme_truth(enz) or "", label_truth(lab, mods) or "", alk or "", basis,
                        ";".join(sorted({kv(c).get("NT", "") + "@" + kv(c).get("TA", kv(c).get("PP", "")) + "/" + kv(c).get("MT", "") for c in mods}))])
            n += 1
print("runs", n)
