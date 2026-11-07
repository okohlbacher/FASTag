"""Write plans_resume/<plan> with the rows of plans/<plan> that have no row in res/raw.tsv yet
(key: tool, profile, dataset, format, threads, rep)."""
import csv, glob, os
done = set()
with open("res/raw.tsv") as f:
    for r in csv.DictReader(f, delimiter="\t"):
        done.add((r["tool"], r["profile"], r["dataset"], r["format"], r["threads"], r["rep"]))
os.makedirs("plans_resume", exist_ok=True)
for p in sorted(glob.glob("plans/*.plan")):
    keep = [l for l in open(p) if l.strip() and tuple(l.rstrip("\n").split("\t")[i] for i in (0, 1, 2, 3, 5, 6)) not in done]
    open("plans_resume/" + os.path.basename(p), "w").writelines(keep)
    print(p, len(keep))
