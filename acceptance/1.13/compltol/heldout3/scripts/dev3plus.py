# DEV analysis for the ion-trap 3+ minimum (compltol held-out 3). Spent held-out 2 runs + DEV PXD001819.
import sys, glob
from pathlib import Path
sys.path.insert(0, sys.argv[1]); import acclib as A
A.use_native_keys()
H2 = "/scratch/kohlbach/b113/compltol/heldout2"; D4 = "/scratch/kohlbach/b113/compltol/dev4"
runs = [(f"{H2}/truth/compltol-H2/compltol/H2/{p}/{s}/results.sage.tsv", f"{H2}/run/runs/CFG-CT2-%s-it05/compltol-H2/compltol/H2/{p}/{s}")
        for p, s in (("PXD041382", "102641"), ("PXD027039", "COM-MP2-2"), ("PXD058223", "CNN1_180410113835"))]
for t in glob.glob(f"{D4}/truth/dev02/dev/PXD001819/*/results.sage.tsv"):
    rel = Path(t).parent.relative_to(f"{D4}/truth/dev02")
    runs.append((t, f"{D4}/runs/CFG-15C-%s-it05/dev02/{rel}"))
for t, r in runs:
    psms = A.sage_truth(t); ms2 = None
    z = psms["charge"].clip(upper=4)
    print(Path(t).parent.name, "psms", len(psms), "z2", int((z == 2).sum()), "z3", int((z == 3).sum()), "z4+", int((z == 4).sum()))
    for cell in ("L3_default", "L4_default", "L5_default", "L3_nodeiso", "L4_nodeiso", "L5_nodeiso"):
        out = []
        for zz in (2, 3):
            sub = psms[z == zz]
            b = A.rank1_correct(Path(r % "base") / cell / "tags.tsv", sub)
            c = A.rank1_correct(Path(r % "cand") / cell / "tags.tsv", sub)
            n = len(sub); out.append(f"z{zz} base {100*sum(b.values())/max(n,1):.2f}% cand {100*sum(c.values())/max(n,1):.2f}% clusters {sub['cluster'].nunique()}")
        print("  ", cell, " | ".join(out))
