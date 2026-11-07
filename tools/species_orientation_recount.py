#!/usr/bin/env python3
"""Independent recount of -species_orientation both (FASTag 1.12 #10).

Reads a FASTag tag TSV and the FASTA proteomes a toy taxonomy index was built
from (one <taxid>.fasta per taxon, as buildtaxdb reads them) and recomputes,
without the C++ lookup, the per-genus spectrum counts of the species report
under forward and under both orientations:

  * the per-tag rule of SpeciesLookup::tagSupport: every k-mer (I/L folded)
    must be in some taxon, k-mers in more than share_cap taxa are skipped, a
    taxon must carry every evaluated k-mer, margin filter;
  * the orientation rule of combineOrientations: one informative reading is
    used, two are intersected, two without a common taxon skip the tag; a
    palindrome is looked up once;
  * best evidence per spectrum (lowest E-value among informative tags, ties
    united, NaN never wins), gapped rows excluded, tags shorter than min_len
    excluded, one count per genus per spectrum.

Prints one line per genus: genus, forward, gain, loss, both, where gain are
spectra counted only under both and loss spectra counted only under forward,
then one 'tags' line with the orientation outcome counts. With --decoys D it
also recomputes the -species_call decoy null (SpeciesLookup::decoyTag, FNV-1a
plus splitmix64 shuffle, reimplemented here) and prints one 'decoy' line per
genus: genus, decoy_spectra under forward, decoy_spectra under both (summed
over the D replicates, one count per genus per spectrum and replicate).
"""
import argparse
import math
import os
import re
import sys

ALPHA = set("ACDEFGHKLMNPQRSTVWY")  # the folded 19-letter alphabet
NUM = re.compile(r"\s*[-+]?(?:inf(?:inity)?|nan|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)", re.I)


def fold(s):
    return s.replace("I", "L")


def base(tag):
    out, depth = [], 0
    for c in tag:
        if c == "[":
            depth += 1
        elif c == "]":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(c)
    return "".join(out)


def strtod(text):
    m = NUM.match(text)
    return float(m.group(0)) if m else 0.0


M64 = (1 << 64) - 1


def decoy_tag(seq, j):
    """SpeciesLookup.cpp decoyTag(): a fixed permutation of the folded tag
    that is neither the tag nor its reverse, '' when there is none."""
    f = fold(seq)
    n = len(f)
    if n < 2:
        return ""
    r = f[::-1]
    h = 0xcbf29ce484222325
    for c in f.encode() + bytes(((j >> (8 * b)) & 0xFF) for b in range(4)):
        h = ((h ^ c) * 0x100000001b3) & M64
    state = [h]

    def nxt():
        state[0] = (state[0] + 0x9e3779b97f4a7c15) & M64
        z = state[0]
        z = ((z ^ (z >> 30)) * 0xbf58476d1ce4e5b9) & M64
        z = ((z ^ (z >> 27)) * 0x94d049bb133111eb) & M64
        return z ^ (z >> 31)

    p = list(f)
    for i in range(n - 1, 0, -1):
        k = nxt() % (i + 1)
        p[i], p[k] = p[k], p[i]
    p = "".join(p)
    for _ in range(n):
        if p != f and p != r:
            return p
        p = p[1:] + p[:1]
    return ""


def read_fasta(path):
    seq = []
    with open(path) as fh:
        for line in fh:
            if line.startswith(">"):
                if seq:
                    yield "".join(seq)
                seq = []
            else:
                seq.append(line.strip())
    if seq:
        yield "".join(seq)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tags", required=True)
    ap.add_argument("--prot-dir", required=True)
    ap.add_argument("--k", type=int, default=7)
    ap.add_argument("--min-len", type=int, default=0)
    ap.add_argument("--genus", required=True, help="taxid:genus,... for every proteome")
    ap.add_argument("--share-cap", type=int, default=0, help="0 = number of taxa (no skip)")
    ap.add_argument("--min-margin", type=float, default=0.0)
    ap.add_argument("--decoys", type=int, default=0, help="D of -species_call_decoys; 0 = no decoy lines")
    a = ap.parse_args()
    k = a.k
    min_len = max(a.min_len, k)
    genus = dict(tuple(int(x) for x in p.split(":")) for p in a.genus.split(","))

    # by_spec: spectrum -> [(base tag, evalue)], reported ungapped rows only.
    # Columns are bound by header name, not position, so optional columns
    # added by other 1.12 items cannot shift them. Contract 2.3: when the TSV
    # has a "selected" column (#6 precursor hypotheses) only selected rows are
    # species evidence; when it has an "ion_series" column (#15B) only "by"
    # rows are.
    by_spec = {}
    col = None
    with open(a.tags) as fh:
        for line in fh:
            f = line.rstrip("\n").split("\t")
            if line.startswith("#") or len(f) < 2:
                continue
            if f[0] == "spectrum":
                col = {name: i for i, name in enumerate(f)}
                for need in ("spectrum", "tag", "gapped", "evalue"):
                    if need not in col:
                        sys.exit("recount: tags TSV header lacks column %r" % need)
                continue
            if col is None:
                sys.exit("recount: tags TSV without a header line")
            def get(name):
                i = col.get(name)
                return f[i] if i is not None and i < len(f) else ""
            if "selected" in col and get("selected") != "1":
                continue
            if "ion_series" in col and get("ion_series") != "by":
                continue
            if get("gapped")[:1] == "1":
                continue
            ev = strtod(get("evalue")) if get("evalue") else math.nan
            by_spec.setdefault(get("spectrum"), []).append((base(get("tag")), ev))

    # Only the k-mers the tags can ask for are indexed.
    wanted = set()
    for rows in by_spec.values():
        for seq, _ in rows:
            if len(seq) < min_len:
                continue
            variants = [seq] + [decoy_tag(seq, j) for j in range(a.decoys)]
            for v in variants:
                for s in (fold(v), fold(v[::-1])):
                    for i in range(len(s) - k + 1):
                        wanted.add(s[i:i + k])
    index = {}
    taxa_all = sorted(genus)
    for tx in taxa_all:
        for prot in read_fasta(os.path.join(a.prot_dir, "%d.fasta" % tx)):
            s = fold(prot)
            for i in range(len(s) - k + 1):
                km = s[i:i + k]
                if km in wanted and set(km) <= ALPHA:
                    index.setdefault(km, set()).add(tx)
    cap = a.share_cap if a.share_cap > 0 else len(taxa_all)

    def support(seq):
        counts, n_eval = {}, 0
        s = fold(seq)
        for i in range(len(s) - k + 1):
            km = s[i:i + k]
            tx = index.get(km, set()) if set(km) <= ALPHA else set()
            if not tx:
                return []
            if len(tx) > cap:
                continue
            n_eval += 1
            for t in tx:
                counts[t] = counts.get(t, 0) + 1
        if n_eval == 0:
            return []
        best = max(counts.values())
        if best < n_eval:
            return []
        runner = max([v for v in counts.values() if v < best], default=0)
        if (best - runner) / n_eval < a.min_margin:
            return []
        return sorted(t for t, v in counts.items() if v == best)

    outcome = {"forward": 0, "reverse": 0, "both": 0, "palindrome": 0, "ambiguous": 0}

    def both(seq, oc=outcome):
        # oc=None: a decoy tag, whose outcomes the run log does not count.
        oc = oc if oc is not None else {}
        fwd = support(seq)
        r = fold(seq[::-1])
        if r == fold(seq):
            if fwd:
                oc["palindrome"] = oc.get("palindrome", 0) + 1
            return fwd
        rev = support(r)
        if fwd and rev:
            inter = sorted(set(fwd) & set(rev))
            key = "both" if inter else "ambiguous"
            oc[key] = oc.get(key, 0) + 1
            return inter
        if fwd:
            oc["forward"] = oc.get("forward", 0) + 1
            return fwd
        if rev:
            oc["reverse"] = oc.get("reverse", 0) + 1
            return rev
        return []

    def spectrum_taxa(sup):
        inf = [(ev, t) for ev, t in sup if t]
        fin = [ev for ev, _ in inf if not math.isnan(ev)]
        if not fin:
            return {x for _, t in inf for x in t}
        b = min(fin)
        return {x for ev, t in inf if ev == b for x in t}

    fcount, bcount, gain, loss = {}, {}, {}, {}
    dfwd, dboth = {}, {}
    for rows in by_spec.values():
        fs, bs = [], []
        dfs = [[] for _ in range(a.decoys)]
        dbs = [[] for _ in range(a.decoys)]
        for seq, ev in rows:
            if len(seq) < min_len:
                continue
            for j in range(a.decoys):
                d = decoy_tag(seq, j)
                if not d:
                    continue
                dfs[j].append((ev, support(d)))
                dbs[j].append((ev, both(d, None)))
            fs.append((ev, support(seq)))
            bs.append((ev, both(seq)))
        for j in range(a.decoys):
            for g in {genus[t] for t in spectrum_taxa(dfs[j])}:
                dfwd[g] = dfwd.get(g, 0) + 1
            for g in {genus[t] for t in spectrum_taxa(dbs[j])}:
                dboth[g] = dboth.get(g, 0) + 1
        fg = {genus[t] for t in spectrum_taxa(fs)}
        bg = {genus[t] for t in spectrum_taxa(bs)}
        for g in fg:
            fcount[g] = fcount.get(g, 0) + 1
        for g in bg:
            bcount[g] = bcount.get(g, 0) + 1
        for g in bg - fg:
            gain[g] = gain.get(g, 0) + 1
        for g in fg - bg:
            loss[g] = loss.get(g, 0) + 1
    for g in sorted(set(genus.values())):
        print("%d\t%d\t%d\t%d\t%d" % (g, fcount.get(g, 0), gain.get(g, 0), loss.get(g, 0), bcount.get(g, 0)))
    if a.decoys:
        for g in sorted(set(genus.values())):
            print("decoy\t%d\t%d\t%d" % (g, dfwd.get(g, 0), dboth.get(g, 0)))
    print("tags\t%(forward)d\t%(reverse)d\t%(both)d\t%(palindrome)d\t%(ambiguous)d" % outcome)
    return 0


if __name__ == "__main__":
    sys.exit(main())
