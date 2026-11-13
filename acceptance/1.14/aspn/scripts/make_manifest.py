#!/usr/bin/env python3
"""make_manifest.py <staged.tsv> -> manifest.tsv (stdout). Per slot (column 'run') the first file whose staging check is
'ok' enters the test ('in_test'); a slot without such a file is 'excluded: staging failed' (PREREG-aspn.md, technical
failures). Run ids are the slot ids."""
import csv, sys
rows = list(csv.DictReader(open(sys.argv[1]), delimiter="\t"))
print("run\tgroup\tprotease\taccession\tdb\tfile\traw_sha256\tmzml\tmzml_sha256\tstatus")
for slot in dict.fromkeys(r["run"] for r in rows):
    ok = [r for r in rows if r["run"] == slot and r["check"] == "ok"]
    r = ok[0] if ok else [x for x in rows if x["run"] == slot][0]
    st = f"in_test (file {r['role']})" if ok else "excluded: staging failed"
    print(slot, r["group"], r["protease"], r["accession"], r["db"], r["file"], r["raw_sha256"], r["mzml"] if ok else "-", r["mzml_sha256"] if ok else "-", st, sep="\t")
