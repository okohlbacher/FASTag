import sys
sys.path.insert(0, "/scratch/kohlbach/b113/ax/src/acceptance/1.12/scorers"); sys.path.insert(0, "/scratch/kohlbach/b113/ax/src/acceptance/1.13/scorers")
import score_item11 as SI
from pathlib import Path
T=Path("/scratch/kohlbach/b113/ax/dev/truth")
print("run\tabxy_psms\tax_only_psms")
for d in sorted(T.glob("UVPD_recal_*")):
    r=[]
    for s in ("abxy","ax"):
        f=d/s/f"{d.name}.tsv"
        r.append(len(SI.fragger_psms(f)) if f.exists() else -1)
    print(d.name.split("_")[3], d.name.split("_")[-2], *r, sep="\t")
