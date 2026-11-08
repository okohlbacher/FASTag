#!/usr/bin/env python3
"""Append round-4 rows (DECISIONS-2026-11-08 round 4) to validation-registry.tsv. Append-only: refuses a row_id that
already exists. Rows are given as a JSON list of {column: value} on stdin; missing columns are empty.
Usage: append_r4_rows.py <acceptance dir> < rows.json"""
import csv, json, sys
A = sys.argv[1]; REG = f"{A}/validation-registry.tsv"
with open(REG) as f:
    lines = f.read().splitlines()
hdr = next(l for l in lines if not l.startswith("# ")).split("\t")
ids = {l.split("\t", 1)[0] for l in lines}
rows = json.load(sys.stdin)
out = []
for r in rows:
    if r["row_id"] in ids:
        sys.exit(f"row {r['row_id']} exists: not appended")
    bad = set(r) - set(hdr)
    if bad:
        sys.exit(f"unknown columns {bad}")
    out.append("\t".join(str(r.get(c, "")).replace("\t", " ").replace("\n", " ") for c in hdr))
with open(REG, "a") as f:
    for l in out:
        f.write(l + "\n")
print(f"appended {len(out)} rows")
