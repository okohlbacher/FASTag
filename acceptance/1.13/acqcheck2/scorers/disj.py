import sys, re
S, A, B = sys.argv[1:4]
def pxds(path):
    try: return set(re.findall(r"PXD\d{6}", open(path, errors="replace").read()))
    except IOError: return None
lists = [
 ("spent_E7-03", A + "/acceptance/1.13/manifests/item07-E7-03.tsv"),
 ("E7-02_dev_and_e703_exclude", A + "/acceptance/1.12/inputs/e703_exclude.txt"),
 ("E7-02_sweep", A + "/acceptance/1.12/inputs/e7-02-sweep.tsv"),
 ("alknodb_prereg_exclude", B + "/alknodb/prereg-exclude-pxd.txt"),
 ("species_heldout_draft", B + "/species/heldout-manifest-draft.tsv"),
 ("labeldisc_dev_screen", B + "/labeldisc/audit/dev-screen.tsv"),
 ("backlog-1.13_folder_any", S + "/x_backlog.txt"),
 ("acceptance_and_acc113r_branches_any", S + "/x_now.txt"),
 ("draw_exclude_list", S + "/exclude.txt"),
]
reserved = set("PXD049248 PXD058584 PXD065251 PXD082747 PXD074990 PXD037999 PXD045115 PXD055818 PXD073763 "
               "PXD073999 PXD042242 PXD067571 PXD032145 PXD003400 PXD044743 PXD068740 PXD028322".split())
sets = [(n, pxds(p)) for n, p in lists]
for n, s in sets: assert s is not None and len(s) > 0, n
rows = [l.rstrip("\n").split("\t") for l in open(S + "/manifest.tsv")][1:]
assert len(set(r[3] for r in rows)) == len(rows), "one file per project"
bad = 0
out = ["id\tpxd\treserved_shifts_census\t" + "\t".join(n for n, _ in sets)]
for r in rows:
    f = ["yes" if r[3] in reserved else "no"] + ["yes" if r[3] in s else "no" for _, s in sets]
    bad += "yes" in f
    out.append("\t".join([r[0], r[3]] + f))
out.append("#lists\t" + "; ".join("%s=%d PXDs" % (n, len(s)) for n, s in sets) + "; reserved=%d" % len(reserved))
out.append("#overlaps\t%d of %d files" % (bad, len(rows)))
open(S + "/disjointness.tsv", "w").write("\n".join(out) + "\n")
print(out[-2]); print(out[-1])
