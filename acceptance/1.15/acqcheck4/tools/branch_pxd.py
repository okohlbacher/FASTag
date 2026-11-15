#!/usr/bin/env python3
"""acqcheck4: PXDs named on every origin/* branch (after git fetch), with collect_pxd.py's catalogue rule per file:
a file naming more than 2,000 distinct PXDs is a PRIDE catalogue and skipped (listed); PXDs in paths always count.
usage: branch_pxd.py <repo> <out.txt> <catalogues.txt>"""
import re, subprocess, sys, collections
repo, out, cat = sys.argv[1:4]
R = re.compile(r"PXD\d{6}")
refs = [r for r in subprocess.run(["git", "-C", repo, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
        capture_output=True, text=True, check=True).stdout.split() if r != "origin/HEAD" and r != "origin"]
found, skipped = set(), []
for ref in refs:
    paths = subprocess.run(["git", "-C", repo, "ls-tree", "-r", "--name-only", ref], capture_output=True, text=True).stdout
    found.update(R.findall(paths))
    g = subprocess.run(["git", "-C", repo, "grep", "-I", "-o", "-h", "--null", "-E", "PXD[0-9]{6}", ref], capture_output=True)
    # with -h and --null we lose the file name; rerun with names instead
    g = subprocess.run(["git", "-C", repo, "grep", "-I", "-o", "--null", "-E", "PXD[0-9]{6}", ref], capture_output=True)
    per = collections.defaultdict(set)
    for line in g.stdout.decode("utf-8", "replace").splitlines():
        parts = line.split("\0")
        if len(parts) < 2: continue
        per[parts[0]].add(parts[-1].split(":")[-1])
    for f, s in per.items():
        if len(s) > 2000: skipped.append("%s\t%d" % (f, len(s))); continue
        found.update(x for x in s if R.fullmatch(x))
open(out, "w").write("".join(x + "\n" for x in sorted(found)))
open(cat, "w").write("#refs\t%d\t%s\n" % (len(refs), " ".join(refs)) + "".join(x + "\n" for x in skipped))
print(len(refs), "refs", len(found), "PXDs", len(skipped), "catalogue files skipped")
