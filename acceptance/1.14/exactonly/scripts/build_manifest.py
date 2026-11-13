#!/usr/bin/env python3
"""Manifest and disjointness table of the -shortlist_exact_only held-out split (1.14; after msfragger2/scripts/build_manifest.py). Run from the repository root
after `git fetch`. Reads exactonly/inputs/{draw.tsv,stage.tsv,excl_pxd.tsv,cluster_sweep.txt}; with a staged table
(<staged chosen.tsv> [<staged backup.tsv>], written by stage_msfragger.sh) it adds the staging columns.
cluster_sweep.txt: `find /scratch/kohlbach /ceph/ibmi/abi/oliver -maxdepth 5 -name '*<PXD>*'` on node data
(/scratch/kohlbach/fastag-labeldisc pruned), taken before any download.
Usage: build_manifest.py [staged_chosen.tsv [staged_backup.tsv]]"""
import csv, os, subprocess, sys
B = "acceptance/1.14"
I = f"{B}/exactonly/inputs"
rd = lambda p: list(csv.DictReader(open(p), delimiter="\t"))
stage, draw = rd(f"{I}/stage.tsv"), {r["accession"]: r for r in rd(f"{I}/draw.tsv")}
excl = {l.split("\t")[0] for l in open(f"{I}/excl_pxd.tsv")}
sweep = [l.strip() for l in open(f"{I}/cluster_sweep.txt") if l.strip()]
staged = {}
for p in sys.argv[1:]:
    for r in rd(p):
        staged[(r["accession"], r["file"])] = r
order = [a for a, r in sorted(draw.items(), key=lambda x: int(x[1]["draw_rank"])) if r["result"] == "TAKEN"]
runid = {a: f"EX{i:02d}" for i, a in enumerate(order, 1)}

SC = ["stage_status", "raw_sha256", "mzml", "mzml_bytes", "mzml_sha256", "ms2", "ms2_ftms_hcd", "ms2_charged", "stage_check"]
with open(f"{B}/manifests/exactonly-heldout.tsv", "w") as f:
    f.write("\t".join(["item", "split", "run", "pxd", "role", "file", "bytes", "pride_sha1", "url", "selection", "use"] + SC) + "\n")
    for r in stage:
        a = r["accession"]; s = staged.get((a, r["file"]))
        okc = staged.get((a, next(x["file"] for x in stage if x["accession"] == a and x["role"] == "chosen")))
        if not staged:
            use = "pending"
        elif r["role"] == "chosen":
            use = "run" if s and s["check"] == "ok" else "failed_staging"
        else:
            use = "not_staged" if not s else ("run" if s["check"] == "ok" and not (okc and okc["check"] == "ok") else "failed_staging")
        sc = [s["status"], s["raw_sha256"], s["mzml"], s["mzml_bytes"], s["mzml_sha256"], s["ms2"], s["ms2_ftms_hcd"],
              s["ms2_charged"], s["check"]] if s else ["-"] * len(SC)
        f.write("\t".join(["1.14 shortlist_exact_only", "exactonly-heldout", runid[a], a, r["role"], r["file"], r["bytes"], r["pride_sha1"], r["url"],
                           f"draw rank {draw[a]['draw_rank']}; {draw[a]['note']}", use] + sc) + "\n")

refs = [r for r in subprocess.run(["git", "for-each-ref", "--format=%(refname)", "refs/remotes/origin"],
        capture_output=True, text=True, check=True).stdout.split() if not r.endswith("/HEAD")]
with open(f"{B}/disjointness/exactonly-heldout.tsv", "w") as f:
    f.write("\t".join(["run", "pxd", "chosen_file", "backup_file", "in_excl_pxd", "git_files_naming_pxd_all_origin_refs",
                       "cluster_paths_naming_pxd", "cluster_raw_or_mzml", "disjoint"]) + "\n")
    for a in order:
        files = set()
        for ref in refs:
            out = subprocess.run(["git", "grep", "-I", "-l", a, ref], capture_output=True, text=True).stdout
            files |= {os.path.basename(l[len(ref) + 1:]) + ("" if "/census/inputs/" not in l else "(census1)") for l in out.splitlines()}
        files.discard("exactonly-heldout.tsv")
        cl = [p for p in sweep if a in p and "/acc114/exactonly/" not in p]
        data = [p for p in cl if p.lower().endswith((".raw", ".mzml", ".mgf", ".d"))]
        ch = {x["role"]: x["file"] for x in stage if x["accession"] == a}
        ok = a not in excl and not data
        f.write("\t".join([runid[a], a, ch["chosen"], ch.get("backup", "-"), str(int(a in excl)), ";".join(sorted(files)),
                           ";".join(cl) or "-", ";".join(data) or "none", "yes" if ok else "NO"]) + "\n")
        if not ok:
            sys.exit(f"{a} not disjoint")
print("ok", len(order))
