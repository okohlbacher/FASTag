"""Truth-label check (DEV only): which proteins of a 'negative' genus do the tags come from that the true genus
does not explain? usage: truthcheck.py RUN TRUE_LEAF_TAXID[,..] NEG_LEAF_TAXID"""
import gzip, sys, collections
run, true_leaf, neg = sys.argv[1], set(sys.argv[2].split(",")), sys.argv[3]
fa = sys.argv[4] if len(sys.argv) > 4 else neg
specs = {}
for l in gzip.open(f"/scratch/kohlbach/b113/species/devdump/{run}/real/dump.tsv.gz", "rt"):
    if l[0] == "#": continue
    f = l.rstrip("\n").split("\t")
    if f[4] == "-": continue
    specs.setdefault(f[1], []).append((float(f[2]), f[3], set(f[4].split(","))))
tags = collections.Counter(); nspec = 0; only = collections.Counter()
for s, tg in specs.items():
    b = min(e for e, _, _ in tg)
    best = [(q, t) for e, q, t in tg if e == b]
    u = set().union(*[t for _, t in best])
    if u & true_leaf or neg not in u: continue
    nspec += 1
    for q, t in best:
        if neg in t:
            tags[q] += 1
            if len(t) == 1: only[q] += 1
prot = []
name = None; seq = []
for l in open(f"/scratch/kohlbach/fastag112-alldecoy/real/{fa}.fasta"):
    if l[0] == ">":
        if name: prot.append((name, "".join(seq).replace("I", "L")))
        name = l[1:].strip(); seq = []
    else: seq.append(l.strip())
prot.append((name, "".join(seq).replace("I", "L")))
hit = collections.Counter(); spec_hit = collections.Counter(); found = 0
for q, c in tags.items():
    ps = [n for n, s in prot if q in s]
    if ps: found += 1
    for n in ps[:1] if len(ps) > 3 else ps: hit[n] += 1; spec_hit[n] += c
print(f"{run}: {nspec} spectra not explained by {sorted(true_leaf)} support taxon {neg}; {len(tags)} distinct tags, "
      f"{len(only)} of them specific to this taxon alone; {found} found in its proteome; {len(hit)} distinct proteins")
for n, c in hit.most_common(15): print(f"  {c:4d} tags {spec_hit[n]:5d} spectra  {n[:110]}")
