"""Scorer check on development data only: design truth of PXD067551 (REPORT.md) and the PXD045734 control.
Usage: python3 -I dev_truth.py BENCH_ROOT PLAN_V2 PLAN_CONTROL OUTDIR"""
import json, os, sys
root, p2, pc, out = sys.argv[1:5]
L = ("Lys4", "Arg6", "Lys8", "Arg10")
tasks = json.load(open(p2))["tasks"] + json.load(open(pc))["tasks"]
with open(os.path.join(out, "dev_truth.tsv"), "w") as tr, open(os.path.join(out, "dev_runs.tsv"), "w") as rn:
    tr.write("pxd\tfile\tinstrument_class\ttier\tdesign\t" + "\t".join(f"h_{l}\te_{l}\tshare_{l}\ttruth_{l}" for l in L) + "\n")
    rn.write("pxd\tfile\tlabel_tsv\n")
    for t in tasks:
        s = t["stem"].upper(); cls = "timstof" if t["dataset"] == "PXD067551" else "orbitrap"
        pres = set() if "FIC_" in s else {"Lys8"} if "_T0_MYO_" in s else {"Arg10"} if "_T0_EMSC_" in s else {"Lys8", "Arg10"} if "_48H_" in s else set()
        des = "light-only" if not pres else ("single-label" if len(pres) == 1 else "mixed")
        tr.write(f"{t['dataset']}\t{t['input']}\t{cls}\tdev-design\t{des}\t" +
                 "\t".join(f"-\t-\t-\t{'present' if l in pres else 'absent'}" for l in L) + "\n")
        rn.write(f"{t['dataset']}\t{t['input']}\t{os.path.join(root, 'tasks', t['id'], 'label.tsv')}\n")
