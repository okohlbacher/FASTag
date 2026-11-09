#!/usr/bin/env python3
"""DEV / TEST split of the 256 runs of the first label discovery evaluation, by PXD, stratified by label class.

Rule (fixed before any tuning of -label_discovery_out, 2026-11-10):
  * unit = PXD (every run of a PXD goes to the same half);
  * stratum of a PXD = the rarest truth class among its runs, in this order:
      iTRAQ4, iTRAQ8, TMTpro, dimethyl, TMT, SILAC, isotope, label-free, unknown ('' or '?');
  * forced DEV: PXD001587, PXD004541 (the implementation's probes) and PXD003531 (gate input, named in the
    task as the false call to fix);
  * within a stratum the PXDs are sorted, shuffled with random.Random('fastag-1.13:labeldisc:split:<stratum>'),
    and each is put into the half with fewer evaluable runs of that stratum so far (evaluable = True or extra; ties
    broken by all runs, then DEV); forced PXDs first.
Output columns: name, set, acc, evaluable, truth, truth_class, stratum, half.
Usage: split_labeldisc.py <runs256.tsv> <out.tsv>"""
import csv, random, sys
from collections import defaultdict

ORDER = ["iTRAQ4", "iTRAQ8", "TMTpro", "dimethyl", "TMT", "SILAC", "isotope", "label-free", "unknown"]
FORCED_DEV = {"PXD001587", "PXD004541", "PXD003531"}


def tclass(t):
    if t in ("", "?"): return "unknown"
    if t.startswith("isotope"): return "isotope"
    return t


def main(inp, out):
    rows = list(csv.DictReader((l for l in open(inp) if not l.startswith("#")), delimiter="\t"))
    by = defaultdict(list)
    for r in rows: by[r["acc"]].append(r)
    stratum = {p: min((tclass(r["truth"]) for r in rs), key=ORDER.index) for p, rs in by.items()}
    half = {}
    for s in ORDER:
        pxds = sorted(p for p in by if stratum[p] == s)
        random.Random(f"fastag-1.13:labeldisc:split:{s}").shuffle(pxds)
        pxds = [p for p in pxds if p in FORCED_DEV] + [p for p in pxds if p not in FORCED_DEV]
        n = {"DEV": (0, 0), "TEST": (0, 0)}
        for p in pxds:
            h = "DEV" if p in FORCED_DEV or n["DEV"] <= n["TEST"] else "TEST"
            half[p] = h
            ev = sum(r["evaluable"] in ("True", "extra") for r in by[p])
            n[h] = (n[h][0] + ev, n[h][1] + len(by[p]))
    with open(out, "w") as o:
        o.write(f"# split_labeldisc.py over {inp}: {len(rows)} runs, {len(by)} PXDs\n")
        o.write("name\tset\tacc\tevaluable\ttruth\ttruth_class\tstratum\thalf\n")
        for r in rows:
            o.write("\t".join([r["name"], r["set"], r["acc"], r["evaluable"], r["truth"], tclass(r["truth"]),
                               stratum[r["acc"]], half[r["acc"]]]) + "\n")


if __name__ == "__main__":
    main(*sys.argv[1:3])
