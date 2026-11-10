#!/usr/bin/env python3
"""make_manifest.py <picks.tsv> <staged.tsv> -> the runs that enter the test (stdout, TSV).
A primary run enters with its staged file (check == ok; chosen, else backup). A primary run without a staged file is
excluded; the first unused reserve run of the same protease (run-id order) with a staged file then enters instead."""
import csv, sys
picks = list(csv.DictReader(open(sys.argv[1]), delimiter="\t"))
ok = {}
for r in csv.DictReader(open(sys.argv[2]), delimiter="\t"):
    if r["check"] == "ok": ok.setdefault(r["run"], r)
used = set()
print("run\tprotease\taccession\trole\tfile_role\tfile\traw_sha256\tmzml\tmzml_sha256\tms2\tstatus")
def row(p, s, status):
    print(p["run"], p["protease"], p["accession"], p["role"], *(([s[k] for k in ("role", "file", "raw_sha256", "mzml", "mzml_sha256", "ms2")]) if s else ["-"] * 6), status, sep="\t")
for p in picks:
    if p["role"] != "primary": continue
    if p["run"] in ok: row(p, ok[p["run"]], "in_test"); continue
    row(p, None, "excluded_staging")
    for q in picks:
        if q["role"] == "reserve" and q["protease"] == p["protease"] and q["run"] not in used and q["run"] in ok:
            used.add(q["run"]); row(q, ok[q["run"]], "in_test_replaces_" + p["run"]); break
