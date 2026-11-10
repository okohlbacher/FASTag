#!/usr/bin/env python3
"""FASTag 1.13 item 7 (#11 triage), second held-out test: disjointness table of the 8 drawn projects.

    build_disjointness2.py <acceptance/1.13 dir> <git repo dir>
Reads census/inputs2 (stage.tsv, excl_pxd_draw2.txt, other_arms.*.txt, cluster_sweep.txt) and census/inputs/draw.tsv
(the first draw). Sweeps every branch of the repository (refs/heads, refs/remotes) for the drawn accessions.
Writes disjointness/census-triage-2.tsv and refuses (exit 1) on any overlap that is not one of the allowed kinds:
  - the PRIDE candidate pool acceptance/1.12/inputs/h2r_pride_candidates.tsv (a pool, not a test set);
  - a `not_needed` row of the first draw table census/inputs/draw.tsv (the draw lists all 135 pool projects; a
    `not_needed` project was never looked at). This is also the only reason an accession may be in the alknodb
    exclusion list, which is a grep of acceptance/ without the pool;
  - this test's own files (census/inputs2, manifests/census-triage-2*, disjointness/census-triage-2.tsv,
    PREREG-census-2.md, census/results2, the registry and config rows);
  - on the cluster: PRIDE metadata caches, SDRF catalogues (bigbio), copies of the pool and of the census draw tables.
"""
import csv, os, re, subprocess, sys

ACC, REPO = sys.argv[1], sys.argv[2]
I = f"{ACC}/census/inputs2"
DEV = {"PXD003531", "PXD014764"}
FIRST = {"PXD016143", "PXD069084", "PXD034582", "PXD017427", "PXD003903", "PXD037976"}


def lines(p):
    return {l.strip() for l in open(p) if l.strip() and not l.startswith("#")}


shifts = lines(f"{I}/other_arms.shifts-reserved-pxd.txt")
species = lines(f"{I}/other_arms.species-heldout-draft-pxd.txt")
alk = lines(f"{I}/other_arms.alknodb-prereg-exclude-pxd.txt")
excl = lines(f"{I}/excl_pxd_draw2.txt")
first_draw = {r["accession"]: r["result"] for r in csv.DictReader(open(f"{ACC}/census/inputs/draw.tsv"), delimiter="\t")}
chosen, backup = {}, {}
for r in csv.DictReader(open(f"{I}/stage.tsv"), delimiter="\t"):
    (chosen if r["role"] == "chosen" else backup)[r["accession"]] = os.path.splitext(r["file"])[0]
pxds = sorted(chosen)
if len(pxds) != 8:
    sys.exit("expected 8 drawn projects")

OWN = re.compile(r"^acceptance/1\.13/(census/inputs2/|census/results2/|manifests/census-triage-2|disjointness/census-triage-2"
                 r"|PREREG-census-2\.md|validation-registry\.tsv|frozen-configs\.tsv|census/scripts/build_disjointness2\.py)")
POOL = "acceptance/1.12/inputs/h2r_pride_candidates.tsv"
DRAW1 = "acceptance/1.13/census/inputs/draw.tsv"
refs = subprocess.run(["git", "-C", REPO, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
                      capture_output=True, text=True, check=True).stdout.split()
git_other = {p: set() for p in pxds}
git_draw1 = {p: 0 for p in pxds}
for ref in refs:
    out = subprocess.run(["git", "-C", REPO, "grep", "-oE", "|".join(pxds), ref, "--", "."], capture_output=True, text=True).stdout
    for l in out.splitlines():
        _, path, p = l.rsplit(":", 2) if l.count(":") >= 2 else (None, None, None)
        path = l[len(ref) + 1:].rsplit(":", 1)[0]
        p = l.rsplit(":", 1)[1]
        if path == POOL or OWN.match(path):
            continue
        if path == DRAW1:
            git_draw1[p] += 1
            continue
        git_other[p].add(f"{ref}:{path}")

ALLOWED_CLUSTER = re.compile(r"/pride_cache/|/bigbio(-sdrf)?/datasets/|/h2r_pride_candidates\.tsv$|/census/(acc/1\.13/census/inputs/draw\.tsv|"
                             r"cand\.txt|cand_order\.txt|draw_out/draw\.tsv|reassess/(cand\.txt|fetch_list\.txt|draw2/out/(draw|stage)\.tsv))$")
cl_other = {p: [] for p in pxds}
cl_content_other = []
for l in open(f"{I}/cluster_sweep.txt"):
    if l.startswith("#") or not l.strip():
        continue
    kind, path = l.rstrip("\n").split("\t")
    if ALLOWED_CLUSTER.search(path):
        continue
    if kind == "content":
        cl_content_other.append(path)
    for p in pxds:
        if p in path:
            cl_other[p].append(path)

cols = ["run", "pxd", "chosen_file_stem", "backup_file_stem", "dev_pxd_overlap", "first_test_pxd_overlap",
        "shifts_reserved_overlap", "species_draft_overlap", "in_excl_pxd_draw2", "in_alknodb_exclude_list",
        "alknodb_list_cause", "first_draw_result", "git_branches_other_files", "cluster_other_paths", "pxd_mod_4",
        "new_draw_domain", "disjoint"]
bad = []
os.makedirs(f"{ACC}/disjointness", exist_ok=True)
with open(f"{ACC}/disjointness/census-triage-2.tsv", "w") as o:
    o.write("\t".join(cols) + "\n")
    for p in pxds:
        fd = first_draw.get(p, "absent")
        cause = "-"
        if p in alk:
            cause = ("first draw table census/inputs/draw.tsv, row not_needed (project never looked at)"
                     if fd == "not_needed" and git_draw1[p] > 0 else "UNEXPLAINED")
        m = int(p[3:]) % 4
        ok = (p not in DEV and p not in FIRST and p not in shifts and p not in species and p not in excl
              and cause != "UNEXPLAINED" and fd in ("not_needed", "absent") and not git_other[p] and not cl_other[p])
        if not ok:
            bad.append(p)
        o.write("\t".join(map(str, [p, p, chosen[p], backup.get(p, "-"), int(p in DEV), int(p in FIRST), int(p in shifts),
                                    int(p in species), int(p in excl), int(p in alk), cause, fd, len(git_other[p]),
                                    len(cl_other[p]), m, "hdrcharge (reserved for census per HELDOUT-COMMON)" if m == 0 else
                                    "alknodb (reserved for census per HELDOUT-COMMON)", int(ok)])) + "\n")
if cl_content_other:
    bad.append("cluster content: " + ",".join(cl_content_other))
print(f"{len(refs)} branches swept; {len(pxds)} projects; overlaps: {bad or 'none'}")
sys.exit(1 if bad else 0)
