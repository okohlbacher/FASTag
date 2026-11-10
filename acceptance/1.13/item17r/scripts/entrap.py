#!/usr/bin/env python3
"""Target FASTA(s) plus a shuffled entrapment copy at r = 1 (FASTag 1.12 DEV, #5/#17 engine runs).

Each target entry is written unchanged, then one entrapment entry per target entry: accession prefixed with
ENTRAP_, the sequence shuffled within each tryptic segment (split after K/R; the segment's C-terminal K/R stays in
place), seeded by the accession (deterministic). Same residue count and composition, so r = 1 by construction.
The engine adds its own decoys over target + entrapment. Identical duplicate targets are written once.
Usage: entrap.py <out.fasta> <in.fasta> [<in2.fasta> ...]   (stdout: targets, entrapment, residues)"""
import hashlib, random, re, sys

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

def shuffle(acc, seq):
    rng = random.Random(int(hashlib.sha256(acc.encode()).hexdigest()[:16], 16))
    out = []
    for seg in re.findall(r"[^KR]*[KR]|[^KR]+$", seq):
        body, end = (seg[:-1], seg[-1]) if seg[-1] in "KR" else (seg, "")
        b = list(body)
        rng.shuffle(b)
        out.append("".join(b) + end)
    return "".join(out)

def wrap(s):
    return "\n".join(s[i:i + 80] for i in range(0, len(s), 80))

out, ins = sys.argv[1], sys.argv[2:]
seen, targets = set(), []
for p in ins:
    for h, s in read(p):
        key = (h.split()[0], s)
        if key in seen:
            continue
        seen.add(key)
        targets.append((h, s))
res = 0
with open(out, "w") as o:
    for h, s in targets:
        o.write(f">{h}\n{wrap(s)}\n"); res += len(s)
    for h, s in targets:
        acc = h.split()[0]
        o.write(f">ENTRAP_{acc} entrapment shuffle of {acc}\n{wrap(shuffle(acc, s))}\n")
print(f"targets {len(targets)} entrapment {len(targets)} target_residues {res}")
