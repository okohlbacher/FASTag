#!/usr/bin/env python3
"""Describe a FASTag taxonomy index (FTX2, written by TaxIndex::save in FASTag 1.8.0).

Reads the header, the taxon table and the posting lists through a memory map and writes one row
per taxon: taxid, genus name, distinct k-mers carried, k-mers unique to the taxon, and the share
of its k-mers it shares with its closest other taxon (by Jaccard-free containment, |A&B|/|A|).

  python3 species_index_stats.py --taxdir <share-FASTag-taxonomy> --out results/species_index.tsv

The per-pair containment needs one pass over the postings per taxon pair of interest; only the
best partner per taxon is reported, computed with a sparse co-occurrence count.
"""
import argparse
import hashlib
import struct
import sys
from pathlib import Path

import numpy as np


def names_and_genus(taxdir: Path):
    parent, rank = {}, {}
    for line in open(taxdir / "nodes.dmp", encoding="utf-8"):
        f = [x.strip() for x in line.split("|")]
        if len(f) > 2:
            parent[int(f[0])], rank[int(f[0])] = int(f[1]), f[2]
    name = {}
    for line in open(taxdir / "names.dmp", encoding="utf-8"):
        f = [x.strip() for x in line.split("|")]
        if len(f) > 3 and f[3] == "scientific name":
            name[int(f[0])] = f[1]

    def genus(t):
        seen = set()
        while t in parent and t not in seen:
            if rank.get(t) == "genus":
                return name.get(t, str(t))
            seen.add(t)
            if parent[t] == t:
                break
            t = parent[t]
        return ""
    return name, genus


def pad8(x):
    return (x + 7) // 8 * 8


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--taxdir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-sha", action="store_true")
    a = ap.parse_args()
    taxdir = Path(a.taxdir)
    idx = taxdir / "tax_k7.taxdb"
    mm = np.memmap(idx, dtype=np.uint8, mode="r")
    magic = bytes(mm[:4])
    if magic != b"FTX2":
        sys.exit(f"{idx}: not an FTX2 index ({magic!r})")
    ver, k, n_taxa = struct.unpack_from("<III", mm, 4)
    n_kmers, n_post = struct.unpack_from("<QQ", mm, 16)
    kb, tb = int(mm[32]), int(mm[33])
    pos = 40
    taxids = np.frombuffer(mm, dtype="<u4", count=n_taxa, offset=pos)
    pos = pad8(pos + 4 * n_taxa)
    tpost = np.frombuffer(mm, dtype="<u8", count=n_taxa, offset=pos)
    pos = pad8(pos + 8 * n_taxa)
    pos = pad8(pos + kb * n_kmers)  # keys
    offsets = np.frombuffer(mm, dtype="<u4", count=n_kmers + 1, offset=pos)
    pos = pad8(pos + 4 * (n_kmers + 1))
    if tb != 1:
        sys.exit("only 1-byte postings handled (<= 256 taxa)")
    post = np.frombuffer(mm, dtype=np.uint8, count=n_post, offset=pos)
    sizes = np.diff(offsets.astype(np.int64))
    uniq_mask = sizes == 1
    uniq = np.bincount(post[offsets[:-1][uniq_mask]], minlength=n_taxa)
    # pairwise co-occurrence over k-mers carried by 2..n taxa (sparse enough at 50 taxa)
    co = np.zeros((n_taxa, n_taxa), dtype=np.int64)
    multi = np.nonzero(sizes >= 2)[0]
    starts, lens = offsets[:-1][multi].astype(np.int64), sizes[multi]
    for L in np.unique(lens):
        sel = starts[lens == L]
        block = np.stack([post[sel + j] for j in range(L)], axis=1).astype(np.int64)
        for i in range(L):
            for j in range(L):
                if i != j:
                    np.add.at(co, (block[:, i], block[:, j]), 1)
    name, genus = names_and_genus(taxdir)
    sha = "" if a.no_sha else hashlib.sha256(open(idx, "rb").read()).hexdigest()
    rows = []
    for i, t in enumerate(taxids):
        c = co[i].copy()
        c[i] = -1
        j = int(np.argmax(c))
        rows.append((int(t), name.get(int(t), ""), genus(int(t)), int(tpost[i]), int(uniq[i]),
                     round(int(uniq[i]) / int(tpost[i]), 4) if tpost[i] else 0.0,
                     genus(int(taxids[j])), round(int(co[i, j]) / int(tpost[i]), 4) if tpost[i] else 0.0))
    rows.sort(key=lambda r: r[2])
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as fh:
        fh.write(f"# source: {idx} (FASTag 1.8.0 release bundle, share-FASTag-taxonomy); sha256 {sha}\n")
        fh.write(f"# FTX2 v{ver}: k={k}, taxa={n_taxa}, distinct k-mers={n_kmers}, postings={n_post}, "
                 f"file bytes={mm.shape[0]}; k-mers carried by exactly one taxon={int(uniq_mask.sum())}\n")
        fh.write("# columns: kmers = distinct I/L-folded 7-mers in the taxon's reference proteome; unique = carried by no other "
                 "indexed taxon; closest = taxon sharing most k-mers; shared_with_closest = |A&B|/|A|\n")
        fh.write("taxid\tname\tgenus\tkmers\tunique\tunique_share\tclosest\tshared_with_closest\n")
        for r in rows:
            fh.write("\t".join(map(str, r)) + "\n")
    print(out)


if __name__ == "__main__":
    main()
