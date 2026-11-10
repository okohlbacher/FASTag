#!/usr/bin/env python3
"""One row per MS2 spectrum of a Thermo mzML: scan, activation class, analyzer, header charge. No FASTag code.

Class (the rule of doc/HYBRID-IONS.md, read from the first precursor's activation):
  hybrid      EThcD (MS:1002631), ETciD (MS:1003182), a supplemental term (MS:1002678, MS:1002679), or an electron
              and a collisional method together; without any method, a filter string with an electron and a
              collisional token, or an @ethcd/@etcid token
  electron    ETD (MS:1000598) or ECD (MS:1000250) alone
  collisional CID (MS:1000133), beam-type CID/HCD (MS:1000422), in-source or trap-type CID (MS:1001880, MS:1002472)
  other       anything else
Analyzer: the first word of the filter string (FTMS, ITMS, ASTMS), or NA.
Usage: hybrid_scans.py <mzML> > scans.tsv"""
import re
import sys

HYB = {"MS:1002631", "MS:1003182", "MS:1002678", "MS:1002679"}
ELEC = {"MS:1000598", "MS:1000250"}
COLL = {"MS:1000133", "MS:1000422", "MS:1001880", "MS:1002472"}
ACC = re.compile(r'accession="(MS:\d+)"')
VAL = re.compile(r'value="([^"]*)"')


def classify(acts, filt):
    if acts & (HYB | ELEC | COLL):
        if acts & HYB or (acts & ELEC and acts & COLL):
            return "hybrid"
        return "electron" if acts & ELEC else "collisional"
    f = filt.lower()
    e = bool(re.search(r"@(etd|ecd)", f))
    c = bool(re.search(r"@(hcd|cid)", f))
    if re.search(r"@(ethcd|etcid)", f) or (e and c):
        return "hybrid"
    return "electron" if e else "collisional" if c else "other"


def rows(path):
    scan = level = None
    acts, filt, charge, in_act, n_prec = set(), "", "", False, 0
    with open(path, errors="replace") as f:
        for line in f:
            if "<spectrum " in line:
                m = re.search(r'id="[^"]*scan=(\d+)', line)
                scan, level = (int(m.group(1)) if m else None), None
                acts, filt, charge, in_act, n_prec = set(), "", "", False, 0
            elif scan is None:
                continue
            elif "</spectrum>" in line:
                if level == 2:
                    yield scan, classify(acts, filt), (filt.split() or ["NA"])[0], charge or "0"
                scan = None
            elif "<precursor " in line or "<precursor>" in line:
                n_prec += 1
            elif "<activation" in line:
                in_act = n_prec == 1
            elif "</activation>" in line:
                in_act = False
            elif "<cvParam" in line:
                a = ACC.search(line)
                a = a.group(1) if a else ""
                if a == "MS:1000511":
                    level = int(VAL.search(line).group(1))
                elif a == "MS:1000512":
                    filt = VAL.search(line).group(1)
                elif a == "MS:1000041" and n_prec == 1 and not charge:
                    charge = VAL.search(line).group(1)
                elif in_act:
                    acts.add(a)


if __name__ == "__main__":
    if sys.argv[1] == "--selftest":
        assert classify({"MS:1000598", "MS:1002678"}, "") == "hybrid"
        assert classify({"MS:1000598", "MS:1000422"}, "") == "hybrid"
        assert classify({"MS:1000598"}, "FTMS ms2 400@etd50 400@hcd20") == "electron"
        assert classify({"MS:1000422"}, "") == "collisional"
        assert classify(set(), "FTMS + c NSI d Full ms2 427.3@etd95.35 427.3@hcd20.00 [140-1200]") == "hybrid"
        assert classify(set(), "ITMS + c NSI d Full ms2 427.3@cid35.00 [140-1200]") == "collisional"
        print("ok")
        sys.exit(0)
    print("scan\tkey\tclass\tanalyzer\tcharge")
    for s, c, an, z in rows(sys.argv[1]):
        print(f"{s}\tscan={s}\t{c}\t{an}\t{z}")
