#!/usr/bin/env python3
"""Rewrite PXD018176 MGF titles '<run> controllerType=0 controllerNumber=1 scan=N' to MSFragger's
'<stem>.N.N.<z>' form (peaks unchanged). Usage: mgf_titles.py <in.mgf> <out.mgf>"""
import re, sys
src, dst = sys.argv[1], sys.argv[2]
stem = dst.rsplit("/", 1)[-1].rsplit(".", 1)[0]
block = []
with open(src) as f, open(dst, "w") as o:
    for l in f:
        if l.startswith("BEGIN IONS"):
            block = [l]; continue
        if not block:
            o.write(l); continue
        block.append(l)
        if l.startswith("END IONS"):
            t = next(x for x in block if x.startswith("TITLE="))
            scan = int(re.search(r"scan=(\d+)", t).group(1))
            ch = next((x for x in block if x.startswith("CHARGE=")), "CHARGE=0+").strip().split("=")[1].rstrip("+")
            o.writelines(f"TITLE={stem}.{scan}.{scan}.{ch or 0}\n" if x.startswith("TITLE=") else x for x in block)
            block = []
