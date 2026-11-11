#!/usr/bin/env python3
"""Target-decoy database for the msfragger held-out test (backlog item 18).

Reads a FASTA, drops every entry whose accession starts with rev_ (decoys FASTag appended), writes
  the targets unchanged;
  with --entrap: one entrapment entry per target, accession ENTRAP_<accession>, the sequence shuffled within
    each tryptic segment (split after K/R, the C-terminal K/R stays), seeded by the accession. The shuffle is
    acceptance/1.12/dev/engines/scripts/entrap.py's, unchanged (r = 1 by construction);
  one reversed decoy per written entry (targets and entrapment): rev_<accession>, full-sequence reversal,
    the rule FASTag's -fasta_out uses for -search_engine msfragger.
Identical duplicate targets (accession and sequence) are written once.
Usage: mkdb.py [--entrap] <out.fasta> <in.fasta>      stdout: targets, entrapment, decoys, target_residues"""
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

def build(entries, entrap):
    seen, targets = set(), []
    for h, s in entries:
        acc = h.split()[0]
        if acc.startswith("rev_") or (acc, s) in seen:
            continue
        seen.add((acc, s))
        targets.append((h, s))
    ent = [(f"ENTRAP_{h.split()[0]} entrapment shuffle of {h.split()[0]}", shuffle(h.split()[0], s))
           for h, s in targets] if entrap else []
    dec = [("rev_" + h, s[::-1]) for h, s in targets + ent]
    return targets, ent, dec

if __name__ == "__main__":
    a = sys.argv[1:]
    entrap = a[0] == "--entrap"
    out, src = a[-2], a[-1]
    t, e, d = build(read(src), entrap)
    with open(out, "w") as o:
        for h, s in t + e + d:
            o.write(f">{h}\n{wrap(s)}\n")
    print(f"targets {len(t)} entrapment {len(e)} decoys {len(d)} target_residues {sum(len(s) for _, s in t)}")
