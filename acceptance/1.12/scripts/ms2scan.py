#!/usr/bin/env python3
"""Read-only header scan of mzML files: instrument model, MS2 analyser, MS2 spectrum
representation (profile MS:1000128 / centroid MS:1000127), activation and filter string of
the first N MS2 spectra. Stops after N MS2 spectra; never reads peak arrays.
Usage: ms2scan.py list.tsv out.tsv   (list: id<TAB>path)"""
import sys, re, os

ANALYSERS = {"MS:1000484": "orbitrap", "MS:1000264": "ion_trap", "MS:1000082": "qit",
             "MS:1000291": "linear_ion_trap", "MS:1000084": "tof", "MS:1000079": "ft_icr",
             "MS:1003378": "astral", "MS:1000081": "quadrupole"}
ACT = {"MS:1000133": "CID", "MS:1000422": "HCD", "MS:1000598": "ETD", "MS:1002631": "EThcD",
       "MS:1000250": "ECD", "MS:1002472": "trap_CID", "MS:1003294": "EThcD", "MS:1002678": "supplemental_beam_CID"}

def scan(path, nmax=int(os.environ.get('MS2SCAN_NMAX', 50))):
    model, confs, cur_conf, in_conf = "", {}, None, False
    ms2 = 0; prof = cent = 0; acts = {}; filt = ""; conf_ref = ""; spec = []; in_spec = False
    default_conf = ""
    with open(path, "r", errors="replace") as f:
        for nline, line in enumerate(f):
            if nline > int(os.environ.get('MS2SCAN_MAXLINES', 400000)): break
            if "<referenceableParamGroup " in line: in_conf = True; cur_conf = "_group"; confs.setdefault(cur_conf, []); continue
            if "</referenceableParamGroup>" in line: in_conf = False; continue
            if "<instrumentConfiguration " in line:
                m = re.search(r'id="([^"]+)"', line); cur_conf = m.group(1) if m else None; confs[cur_conf] = []; in_conf = True
            elif "</instrumentConfiguration>" in line:
                in_conf = False
            elif in_conf and "cvParam" in line:
                m = re.search(r'accession="(MS:\d+)"[^>]*name="([^"]*)"', line)
                if m:
                    if m.group(1) in ANALYSERS: confs[cur_conf].append(ANALYSERS[m.group(1)])
                    elif not model and not re.search(r"analy[sz]er|source|detector|electrospray|ionization|multiplier|inductive|array|serial|ion trap|orbitrap$|time-of-flight|quadrupole|channeltron|photomultiplier", m.group(2), re.I):
                        model = m.group(2)
            if "<run " in line:
                m = re.search(r'defaultInstrumentConfigurationRef="([^"]+)"', line); default_conf = m.group(1) if m else ""
            if "<spectrum " in line:
                in_spec = True; spec = [line]; continue
            if in_spec:
                spec.append(line)
                if "</spectrum>" in line or "<binaryDataArrayList" in line:
                    in_spec = False
                    s = "".join(spec)
                    ml = re.search(r'<cvParam[^>]*accession="MS:1000511"[^>]*>', s)
                    if ml and 'value="2"' in ml.group(0):
                        ms2 += 1
                        if "MS:1000128" in s: prof += 1
                        if "MS:1000127" in s: cent += 1
                        for a, n in ACT.items():
                            if 'accession="%s"' % a in s: acts[n] = acts.get(n, 0) + 1
                        if not filt:
                            m = re.search(r'<cvParam[^>]*accession="MS:1000512"[^>]*value="([^"]*)"', s); filt = m.group(1) if m else ""
                            m = re.search(r'instrumentConfigurationRef="([^"]+)"', s); conf_ref = m.group(1) if m else default_conf
                        if ms2 >= nmax: break
    an = ",".join(confs.get(conf_ref or default_conf, [])) or ";".join(",".join(v) for k, v in confs.items() if k != "_group")
    return model, an, ms2, prof, cent, ";".join("%s:%d" % kv for kv in sorted(acts.items())), filt

if __name__ == "__main__":
    out = open(sys.argv[2], "w")
    out.write("id\tpath\tmodel\tms2_analyser\tms2_seen\tprofile\tcentroid\tactivation\tfilter\n")
    for l in open(sys.argv[1]):
        i, p = l.rstrip("\n").split("\t")[:2]
        try: r = scan(p)
        except Exception as e: r = ("ERR:%s" % e, "", 0, 0, 0, "", "")
        out.write("\t".join([i, p] + [str(x) for x in r]) + "\n"); out.flush()
