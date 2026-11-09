#!/usr/bin/env python3
"""hdrcharge (FASTag 1.13, backlog #14) held-out selection. Run before any FASTag or Sage run on a selected file.

Rule (fixed before selection; nothing about these files' charges has been looked at):
  - qe stratum: rows of acceptance/1.12/manifests/item03-heldout.tsv (scored for #3 chemistry only) with
    stratum 'tryptic', label_truth 'label-free', alk_truth 'Carbamidomethyl', an instrument of the Q Exactive
    family (name contains 'q exactive', case-insensitive), an organism with a panel FASTA (homo sapiens, mus
    musculus, saccharomyces cerevisiae, escherichia coli) and a staged FASTag input; 3 drawn with
    random.Random('fastag-1.13:hdrcharge:heldout:qe').sample over the candidates sorted by PXD.
  - astral stratum: the astral rows of acceptance/1.12/manifests/item02-H1-r2.tsv that no charge item (#6) used:
    PXD070049 and PXD074582 (PXD066944 was #6 H1-r2); both taken.
  - Disjoint from DEV (PXD003531, PXD001819) by PXD.
Usage: select_heldout.py <acceptance/1.12/manifests dir> <out manifest tsv>"""
import csv
import random
import sys
from pathlib import Path

PANEL = {"homo sapiens": "Homo_sapiens.fasta", "mus musculus": "Mus_musculus.fasta",
         "saccharomyces cerevisiae": "Saccharomyces_cerevisiae.fasta", "escherichia coli": "Escherichia_coli.fasta"}
DEV = {"PXD003531", "PXD001819"}
USED_BY_6 = {"PXD066944", "PXD000806", "PXD001473", "PXD002429", "PXD001540", "PXD069528", "PXD020394",
             "PXD055983", "PXD000266", "PXD004644", "PXD035981"}


def rows(path):
    with open(path) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


def main():
    mdir, out = Path(sys.argv[1]), sys.argv[2]
    sel = []
    cand = []
    for r in rows(mdir / "item03-heldout.tsv"):
        org = r["organisms"].strip().lower()
        if (r["stratum"] == "tryptic" and r["label_truth"] == "label-free" and r["alk_truth"] == "Carbamidomethyl"
                and "q exactive" in r["instrument"].lower() and org in PANEL and r["fastag_input"]
                and r["fastag_input_sha256"] and r["pxd"] not in DEV | USED_BY_6):
            cand.append(r)
    cand.sort(key=lambda r: r["pxd"])
    pick = random.Random("fastag-1.13:hdrcharge:heldout:qe").sample(cand, 3)
    for r in sorted(pick, key=lambda r: r["pxd"]):
        sel.append({"stratum": "qe", "pxd": r["pxd"], "run": r["run"], "instrument": r["instrument"],
                    "organism": r["organisms"], "fasta": PANEL[r["organisms"].strip().lower()],
                    "static_mods": '{"C": 57.021464}', "variable_mods": '{"M": [15.994915]}',
                    "fastag_input": r["fastag_input"], "fastag_input_sha256": r["fastag_input_sha256"],
                    "source_manifest": "acceptance/1.12/manifests/item03-heldout.tsv",
                    "selection": f"random.Random('fastag-1.13:hdrcharge:heldout:qe').sample(3) over {len(cand)}: "
                                 + ",".join(c["pxd"] for c in cand)})
    tt = {}
    with open(mdir.parent / "scorers" / "truth" / "item02.tsv") as f:
        for t in csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"):
            if t["manifest"] == "item02-H1-r2":
                tt[t["pxd"]] = t
    for r in rows(mdir / "item02-H1-r2.tsv"):
        if r["stratum"] == "astral" and r["pxd"] not in USED_BY_6 | DEV:
            t = tt[r["pxd"]]
            sel.append({"stratum": "astral", "pxd": r["pxd"], "run": r["run"], "instrument": r["instrument"] or "Orbitrap Astral",
                        "organism": t["organism"], "fasta": t["fasta"], "static_mods": t["static_mods"],
                        "variable_mods": t["variable_mods"], "fastag_input": r["fastag_input"],
                        "fastag_input_sha256": r["fastag_input_sha256"],
                        "source_manifest": "acceptance/1.12/manifests/item02-H1-r2.tsv",
                        "selection": "astral rows of item02-H1-r2 not used by #6"})
    cols = ["item", "split", "stratum", "pxd", "run", "instrument", "organism", "fasta", "static_mods",
            "variable_mods", "fastag_input", "fastag_input_sha256", "source_manifest", "selection"]
    with open(out, "w") as f:
        f.write("# staged under data:/scratch/kohlbach/fastag-heldout-1.12 (fastag_input relative to it)\n")
        f.write("\t".join(cols) + "\n")
        for s in sel:
            s["item"], s["split"] = "#14", "heldout"
            f.write("\t".join(s[c] for c in cols) + "\n")
    print(f"{len(sel)} runs -> {out}")


if __name__ == "__main__":
    main()
