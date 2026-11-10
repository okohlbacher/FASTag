#!/usr/bin/env python3
"""hdrcharge second held-out round (PREREG-item14r.md): score -check_header_out tables against the Sage truth.

Truth spectrum: Sage PSM with label 1 (target), rank 1, spectrum_q <= 0.001; its charge is the truth charge.
Denominator: truth spectra that have a row in the check table with a header charge in 1..4. A header is wrong when
it differs from the truth charge. A flag is verdict `disagree`. Spectra are matched by scan number.
With a third file (perturb_charge.py's table) the truth is the original header: spectra whose original header the
truth does not confirm are left out, so `wrong` = changed headers.
Columns: tp = flagged wrong, fp = flagged right, tp_charge = flagged wrong whose flag_charge is the truth charge,
decoy_other = decoy PSMs (same threshold, rank 1) whose charge differs from the header.
Usage: score_item14r.py <out.tsv> <run>:<class>=<hc.tsv>,<sage.tsv>[,<perturbed.tsv>] ...
A run whose hc.tsv or sage.tsv is missing gets a row with status `missing` and zero counts."""
import csv
import os
import re
import sys

Q = 0.001
SCAN = re.compile(r"scan=(\d+)")
COLS = ["run", "class", "status", "truth", "wrong", "right", "flagged", "tp", "fp", "tp_charge", "decoy_other",
        "flags_ms1", "tp_ms1", "flags_compl", "tp_compl", "wrong_agree", "wrong_nocall", "wrong_ambiguous"]


def key(s):
    m = SCAN.search(s)
    return m.group(1) if m else s


def score(hc, sage, pert=None):
    c = dict.fromkeys(COLS[3:], 0)
    truth, decoy = {}, {}
    for r in csv.DictReader(open(sage), delimiter="\t"):
        if float(r["spectrum_q"]) > Q or r.get("rank", "1") not in ("", "1"):
            continue
        (truth if int(r["label"]) == 1 else decoy).setdefault(key(r["scannr"]), int(r["charge"]))
    orig = {}
    if pert:
        for r in csv.DictReader(open(pert), delimiter="\t"):
            orig[key(r["key"])] = int(r["header_original"])
    for r in csv.DictReader(open(hc), delimiter="\t"):
        k = key(r["native_id"])
        h = int(r["header_charge"])
        if not 1 <= h <= 4:
            continue
        if k in decoy and decoy[k] != h:
            c["decoy_other"] += 1
        if k not in truth:
            continue
        t = truth[k]
        if pert and orig.get(k, h) != t:
            continue
        wrong = h != t
        flag = r["verdict"] == "disagree"
        c["truth"] += 1
        c["wrong"] += wrong
        c["right"] += not wrong
        c["flagged"] += flag
        c["tp"] += flag and wrong
        c["fp"] += flag and not wrong
        c["tp_charge"] += flag and wrong and int(r["flag_charge"]) == t
        if flag:
            b = "ms1" if r["flag_basis"] == "ms1_isotope" else "compl"
            c["flags_" + b] += 1
            c["tp_" + b] += wrong
        elif wrong and r["verdict"] in ("agree", "nocall", "ambiguous"):
            c["wrong_" + r["verdict"]] += 1
    return c


def main():
    out = sys.argv[1]
    with open(out, "w") as f:
        f.write("\t".join(COLS) + "\n")
        for spec in sys.argv[2:]:
            label, p = spec.split("=", 1)
            run, cls = label.split(":")
            files = p.split(",")
            if not all(os.path.isfile(x) and os.path.getsize(x) > 0 for x in files[:2]):
                c, st = dict.fromkeys(COLS[3:], 0), "missing"
            else:
                c, st = score(*files), "ok"
            f.write("\t".join([run, cls, st] + [str(int(c[k])) for k in COLS[3:]]) + "\n")
            print(run, cls, st, c)


if __name__ == "__main__":
    main()
