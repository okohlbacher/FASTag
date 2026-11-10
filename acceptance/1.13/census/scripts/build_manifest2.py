#!/usr/bin/env python3
"""FASTag 1.13 item 7 (#11 triage), second held-out test: the two manifests of PREREG-census-2.

    build_manifest2.py drawn  <acceptance/1.13 dir>
        manifests/census-triage-2.tsv from census/inputs2/stage.tsv: the drawn files (chosen and backup), before any download.
    build_manifest2.py staged <acceptance/1.13 dir> <staging out.tsv of stage_census.sh> ...
        manifests/census-triage-2.staged.tsv: one row per drawn project. The chosen file when it passed staging, otherwise
        the backup when that passed, otherwise use = excluded (PREREG rule; no redraw). Empty fields are written as '-'.
"""
import csv, os, sys

MODE, ACC = sys.argv[1], sys.argv[2]
SEL = "select_census_heldout2.py, seed fastag-1.13:#11:triage2:qe"
OKST = ("sha1_ok", "no_pride_sha1,size_ok,second_download_same")
stage = list(csv.DictReader(open(f"{ACC}/census/inputs2/stage.tsv"), delimiter="\t"))
pxds = sorted({r["accession"] for r in stage})
assert len(pxds) == 8 and sum(r["role"] == "chosen" for r in stage) == 8
if MODE == "drawn":
    with open(f"{ACC}/manifests/census-triage-2.tsv", "w") as o:
        o.write("# drawn files of PREREG-census-2 (before download); staged files: census-triage-2.staged.tsv\n")
        o.write("item\tsplit\trun\tpxd\trole\tfile\tbytes\tpride_sha1\turl\tselection\n")
        for r in sorted(stage, key=lambda r: (r["accession"], r["role"] != "chosen")):
            o.write("\t".join(["#11", "triage2", r["accession"], r["accession"], r["role"], r["file"], r["bytes"],
                               r["pride_sha1"], r["url"], f"{SEL} ({r['role']} file)"]) + "\n")
    print(f"{len(stage)} drawn files, {len(pxds)} projects")
elif MODE == "staged":
    drawn = {(r["accession"], r["file"]): r for r in stage}
    got = {}
    for f in sys.argv[3:]:
        for r in csv.DictReader(open(f), delimiter="\t"):
            k = (r["accession"], r["file"])
            if k not in drawn:
                sys.exit(f"{k} was not drawn")
            got[k] = r
    cols = ["item", "split", "run", "pxd", "use", "role", "file", "bytes", "pride_sha1", "url", "selection", "stage_status",
            "stage_check", "staged_raw", "raw_sha256", "fastag_input", "fastag_input_bytes", "fastag_input_sha256", "ms2",
            "ms2_ftms_hcd", "ms2_charged", "conversion", "note"]
    with open(f"{ACC}/manifests/census-triage-2.staged.tsv", "w") as o:
        o.write("# staged under data:/scratch/kohlbach/b113/census/heldout/census2/raw\n" + "\t".join(cols) + "\n")
        for p in pxds:
            tried, pick = [], None
            for role in ("chosen", "backup"):
                d = next((r for r in stage if r["accession"] == p and r["role"] == role), None)
                if d is None:
                    tried.append(f"{role}: none drawn")
                    continue
                s = got.get((p, d["file"]))
                if s is None:
                    tried.append(f"{role}: not staged")
                    if role == "chosen":
                        sys.exit(f"{p}: chosen file has no staging row")
                    continue
                ok = s["status"] in OKST and s["check"] == "ok"
                tried.append(f"{role} {d['file']}: {s['status']}, check {s['check']} (ms2 {s['ms2']}, FTMS HCD {s['ms2_ftms_hcd']}, charged {s['ms2_charged']})")
                pick = (role, d, s)
                if ok:
                    break
            role, d, s = pick
            ok = s["status"] in OKST and s["check"] == "ok"
            note = "-" if (ok and role == "chosen") else "; ".join(tried)
            v = ["#11", "triage2", p, p, "run" if ok else "excluded", role, d["file"], d["bytes"], d["pride_sha1"], d["url"],
                 f"{SEL} ({role} file)", s["status"], s["check"], f"{p}/{d['file']}", s["raw_sha256"], s["mzml"],
                 s["mzml_bytes"], s["mzml_sha256"], s["ms2"], s["ms2_ftms_hcd"], s["ms2_charged"],
                 "ThermoRawFileParser 2.0.0 -f 2", note]
            o.write("\t".join(x if x not in ("", None) else "-" for x in v) + "\n")
            print(p, v[4], role, note)
else:
    sys.exit("drawn|staged")
