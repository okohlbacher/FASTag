#!/usr/bin/env python3
"""DEV only (hdrcharge, backlog #14): copy an mzML with a deterministic subset of its precursor charges changed.

Every spectrum whose scan number n has n % 5 == 0 and whose precursor carries a charge z (MS:1000041) gets
z' = z + 1 when z == 2, z - 1 when z >= 3 (z = 1 is left alone). The index goes stale (FASTag rescans). Writes
<out> and <out>.perturbed.tsv (key, header_original, header_given).
Usage: perturb_charge.py <in.mzML> <out.mzML>"""
import re
import sys

SPEC = re.compile(rb'<spectrum [^>]*id="([^"]*)"')
SCAN = re.compile(rb"scan=(\d+)")
CHG = re.compile(rb'(accession="MS:1000041"[^>]*value=")(\d+)(")')


def main():
    src, dst = sys.argv[1:3]
    rows = []
    key = None
    n = None
    with open(src, "rb") as f, open(dst, "wb") as o:
        for line in f:
            m = SPEC.search(line)
            if m:
                s = SCAN.search(m.group(1))
                n = int(s.group(1)) if s else None
                key = f"scan={n}" if s else m.group(1).decode()
            if b'accession="MS:1000041"' in line and n is not None and n % 5 == 0:
                c = CHG.search(line)
                if c:
                    z = int(c.group(2))
                    if z >= 2:
                        z2 = 3 if z == 2 else z - 1
                        line = line[:c.start(2)] + str(z2).encode() + line[c.end(2):]
                        rows.append((key, z, z2))
            o.write(line)
    with open(dst + ".perturbed.tsv", "w") as t:
        t.write("key\theader_original\theader_given\n")
        for r in rows:
            t.write("%s\t%d\t%d\n" % r)
    print(f"{len(rows)} charges changed -> {dst}")


if __name__ == "__main__":
    main()
