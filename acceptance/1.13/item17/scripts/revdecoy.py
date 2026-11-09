#!/usr/bin/env python3
"""Target FASTA plus reversed decoys (prefix rev_) for the MSFragger open-search reference of #17 (FASTag 1.13).
Identical duplicate targets are written once. Usage: revdecoy.py <out.fasta> <in.fasta>"""
import sys

def read(p):
    h, s = None, []
    with open(p) as f:
        for line in f:
            line = line.rstrip("\n\r")
            if line.startswith(">"):
                if h is not None:
                    yield h, "".join(s)
                h, s = line[1:], []
            elif line:
                s.append(line.strip())
    if h is not None:
        yield h, "".join(s)

def wrap(s):
    return "\n".join(s[i:i + 80] for i in range(0, len(s), 80))

seen, t = set(), []
for h, s in read(sys.argv[2]):
    k = (h.split()[0], s)
    if k not in seen:
        seen.add(k); t.append((h, s))
with open(sys.argv[1], "w") as o:
    for h, s in t:
        o.write(f">{h}\n{wrap(s)}\n")
    for h, s in t:
        o.write(f">rev_{h.split()[0]} reversed\n{wrap(s[::-1])}\n")
print(f"targets {len(t)} decoys {len(t)}")
