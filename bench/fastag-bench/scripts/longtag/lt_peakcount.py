#!/usr/bin/env python3
"""Compare the MS2 peak count stored in an mzML with DirecTag's OriginalPeakCount (S line), per spectrum.
usage: lt_peakcount.py MZML DIRECTAG_TAGS"""
import re, sys
mz, tags = sys.argv[1:3]
sp = re.compile(r'<spectrum [^>]*id="([^"]+)"[^>]*defaultArrayLength="(\d+)"')
lv = re.compile(r'name="ms level" value="(\d+)"|accession="MS:1000511"[^>]*value="(\d+)"')
n = {}
cur = None
with open(mz) as fh:
    for line in fh:
        m = sp.search(line)
        if m:
            cur = (m.group(1), int(m.group(2))); continue
        if cur is not None:
            m = lv.search(line)
            if m:
                level = int(m.group(1) or m.group(2))
                if level == 2: n[cur[0]] = cur[1]
                cur = None
dt = {}
with open(tags) as fh:
    for line in fh:
        if line.startswith("S\t"):
            p = line.split("\t"); dt[p[1]] = int(p[14])
both = [k for k in dt if k in n]
d = [dt[k] - n[k] for k in both]
eq = sum(1 for x in d if x == 0)
print(f"MS2 in mzML {len(n)}, S lines {len(dt)}, joined {len(both)}; mzML peaks {sum(n[k] for k in both)}, DirecTag original {sum(dt[k] for k in both)}; equal {eq}; DT<mzML {sum(1 for x in d if x<0)}; DT>mzML {sum(1 for x in d if x>0)}")
