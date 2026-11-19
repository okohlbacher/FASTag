#!/usr/bin/env python3
"""Stage 2 of the Thermo .raw acceptance: FASTag outputs from a .raw against
the same run's mzML conversion.

    thermo_parity_stage2.py <raw-prefix> <mzml-prefix> [<label>]

Each prefix names one FASTag run's outputs: <prefix>.tags.tsv, and where
present .census.tsv, .recon.tsv, .delta.tsv, .spectra.tsv, .counts.tsv.

Tags: the Jaccard index of the sets of (scan, tag, N-flank, C-flank), the
flanks rounded to 0.01 Da, over the whole run and over the spectra that have
tags on both sides; also how many spectra have identical tag lists.

Census, recon and survey (delta) tables: byte-identical after masking what
names the input (the file name and its extension in the run rows and
paths), else the number of differing lines.

Preregistered expectation (FASTag 1.16 item 3, before the comparison):
against a conversion with the same peaks (ThermoRawFileParser -x, which,
like OpenMS's reader, drops Thermo's reference and exception peaks) every
table is identical and the tag Jaccard is 1; against ThermoRawFileParser's
default conversion (which keeps the lock-mass reference peaks) the tag
Jaccard is reported, not required.
"""
import os
import re
import sys

SCAN = re.compile(r"scan=(\d+)")


def tag_set(path):
    keys, per_scan = set(), {}
    with open(path) as f:
        head = f.readline().rstrip("\n").split("\t")
        ci = {c: i for i, c in enumerate(head)}
        for line in f:
            c = line.rstrip("\n").split("\t")
            m = SCAN.search(c[0])
            scan = int(m.group(1)) if m else c[0]
            k = (scan, c[ci["tag"]], round(float(c[ci["nterm_mass"]]), 2), round(float(c[ci["cterm_mass"]]), 2))
            keys.add(k)
            per_scan.setdefault(scan, []).append(line.split("\t", 1)[1])
    return keys, per_scan


def masked(path, names):
    out = []
    with open(path) as f:
        for line in f:
            for n in names:
                line = line.replace(n, "<IN>")
            out.append(line)
    return out


def main():
    a, b = sys.argv[1], sys.argv[2]
    label = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(b)
    ka, sa = tag_set(a + ".tags.tsv")
    kb, sb = tag_set(b + ".tags.tsv")
    inter, union = len(ka & kb), len(ka | kb)
    both = set(sa) & set(sb)
    kab = {k for k in ka if k[0] in both}
    kbb = {k for k in kb if k[0] in both}
    j_both = len(kab & kbb) / max(1, len(kab | kbb))
    same_lists = sum(1 for s in both if sa[s] == sb[s])
    print(f"label\t{label}")
    print(f"tags_raw\t{len(ka)}\ntags_mzml\t{len(kb)}")
    print(f"jaccard_run\t{inter / max(1, union):.6f}")
    print(f"spectra_tagged_raw\t{len(sa)}\nspectra_tagged_mzml\t{len(sb)}\nspectra_tagged_both\t{len(both)}")
    print(f"jaccard_spectra_both\t{j_both:.6f}")
    print(f"spectra_identical_tag_lists\t{same_lists}")
    # Names of the two inputs, longest first, as they appear in the tables.
    names = []
    for p in (a, b):
        base = os.path.basename(p)
        names += [base + ".raw", base + ".mzML", base]
    names.sort(key=len, reverse=True)
    for ext in ("census.tsv", "recon.tsv", "delta.tsv", "spectra.tsv", "counts.tsv"):
        pa, pb = f"{a}.{ext}", f"{b}.{ext}"
        if not (os.path.exists(pa) and os.path.exists(pb)):
            continue
        la, lb = masked(pa, names), masked(pb, names)
        diff = sum(1 for x, y in zip(la, lb) if x != y) + abs(len(la) - len(lb))
        print(f"{ext}\t{'IDENTICAL' if diff == 0 else 'DIFFER'} lines={len(la)}/{len(lb)} differing={diff}")


if __name__ == "__main__":
    main()
