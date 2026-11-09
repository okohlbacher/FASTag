#!/usr/bin/env python3
"""#15B round 2 (user decision 2026-11-09): read-only full scan of a TRFP mzML's MS2 headers (never the peak arrays).
Per MS2 spectrum:
  * analyser from the Thermo filter string (cvParam MS:1000512): FTMS (Orbitrap), ITMS (ion trap), other;
  * activation from the precursor's cvParams and the filter string:
      electron   = ETD (MS:1000598) or ECD (MS:1000250) in the activation cvParams of every precursor block AND a
                   single '@etd'/'@ecd' activation in the filter string, with no supplemental or second activation
                   (no MS:1002678 supplemental beam-type CID, MS:1002679 supplemental CID, HCD MS:1000422, CID
                   MS:1000133, EThcD MS:1002631/MS:1003294; no second '@' and no ' sa ' flag in the filter);
      hybrid     = ETD/ECD (cvParam or filter) with any of those (EThcD, ETciD, ETcaD); TRFP 2.0.0 can label an
                   EThcD scan with HCD cvParams only, so the filter string is read as well;
      collisional= CID/HCD only;  unknown = anything else, or cvParams and filter disagree on ETD.
Output (one row per file): ms2, FTMS, ITMS, other analyser counts, electron, electron_FTMS, hybrid, collisional,
unknown, the cvParam activation counts (as ms2scan.py) and the first MS2 filter and first electron MS2 filter.
Usage: ms2scan_15b_r2.py list.tsv out.tsv   (list: id<TAB>path)"""
import re, sys

ACT = {"MS:1000133": "CID", "MS:1000422": "HCD", "MS:1000598": "ETD", "MS:1002631": "EThcD", "MS:1000250": "ECD",
       "MS:1002472": "trap_CID", "MS:1003294": "EThcD", "MS:1002678": "supplemental_beam_CID",
       "MS:1002679": "supplemental_CID"}
SECOND = {"MS:1002678", "MS:1002679", "MS:1000422", "MS:1000133", "MS:1002631", "MS:1003294", "MS:1002472"}
ELEC = {"MS:1000598", "MS:1000250"}
COLL = {"MS:1000133", "MS:1000422", "MS:1002472"}

def scan(path):
    c = dict(ms2=0, FTMS=0, ITMS=0, other_an=0, electron=0, electron_FTMS=0, hybrid=0, collisional=0, unknown=0)
    acts = {}; first = ""; first_e = ""; spec = []; on = False
    with open(path, "r", errors="replace") as f:
        for line in f:
            if "<spectrum " in line: on = True; spec = [line]; continue
            if not on: continue
            spec.append(line)
            if "</spectrum>" not in line and "<binaryDataArrayList" not in line: continue
            on = False; s = "".join(spec)
            ml = re.search(r'<cvParam[^>]*accession="MS:1000511"[^>]*>', s)
            if not (ml and 'value="2"' in ml.group(0)): continue
            c["ms2"] += 1
            m = re.search(r'<cvParam[^>]*accession="MS:1000512"[^>]*value="([^"]*)"', s); flt = m.group(1) if m else ""
            an = "FTMS" if flt.startswith("FTMS") else "ITMS" if flt.startswith("ITMS") else "other_an"
            c[an] += 1
            pa = " ".join(re.findall(r"<activation>(.*?)</activation>", s, re.S)) or s   # all precursors (TRFP writes EThcD as two)
            accs = set(re.findall(r'accession="(MS:\d+)"', pa))
            for a in accs & set(ACT): acts[ACT[a]] = acts.get(ACT[a], 0) + 1
            ms2part = flt.split("ms2", 1)[1] if "ms2" in flt else flt
            acts_f = re.findall(r"@([a-z]+)", ms2part)          # activations named in the filter string
            e_f = any(a in ("etd", "ecd") for a in acts_f)
            if accs & ELEC or e_f:
                if accs & SECOND or len(acts_f) > 1 or " sa " in f" {flt} ": c["hybrid"] += 1
                elif accs & ELEC and e_f:
                    c["electron"] += 1
                    if an == "FTMS": c["electron_FTMS"] += 1
                    if not first_e: first_e = flt
                else: c["unknown"] += 1                         # cvParams and filter string disagree
            elif accs & COLL: c["collisional"] += 1
            else: c["unknown"] += 1
            if not first: first = flt
    return c, ";".join("%s:%d" % kv for kv in sorted(acts.items())), first, first_e

if __name__ == "__main__":
    K = ["ms2", "FTMS", "ITMS", "other_an", "electron", "electron_FTMS", "hybrid", "collisional", "unknown"]
    out = open(sys.argv[2], "w")
    out.write("\t".join(["id", "path"] + K + ["activation", "filter", "first_electron_filter"]) + "\n")
    for l in open(sys.argv[1]):
        i, p = l.rstrip("\n").split("\t")[:2]
        try:
            c, a, fl, fe = scan(p); row = [str(c[k]) for k in K] + [a, fl, fe]
        except Exception as e:
            row = ["ERR:%s" % e] + [""] * (len(K) + 2)
        out.write("\t".join([i, p] + row) + "\n"); out.flush()
