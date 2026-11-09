"""Oracle table: per run/arm/genus, observed o, exclusive u given S (truth positives for real; empty for alldecoy),
decoy replicate exclusive counts. DEV only.

usage: oracle.py OUT.tsv [--analyzer FTMS|any]
The analysis set is logged to OUT.tsv.set.tsv (run, arm, included 0/1, reason) so every excluded run or arm is
stated. The analyzer restriction defaults to FTMS (the species call targets high-resolution MS2; ion-trap runs are
a low_resolution no_call in 1.12) and must be restated in the DESIGN/PREREG before a number is used."""
import json, sys
import numpy as np
from load import *
parent, rank, name = taxonomy()
man = manifest()
out = open(sys.argv[1], "w")
analyzer = "FTMS"
if "--analyzer" in sys.argv: analyzer = sys.argv[sys.argv.index("--analyzer") + 1]
aset = open(sys.argv[1] + ".set.tsv", "w")
aset.write("run\tarm\tincluded\treason\n")
def log(run, arm, inc, why):
    aset.write(f"{run}\t{arm}\t{int(inc)}\t{why}\n"); aset.flush()
out.write("run\tarm\tgenus\tstatus\to\tu\tunexpl\tn_spec\tkd_mean\tkd_var\tkd\tddb_u\tconc_u\tconc_dec_u\n")
for rd in sorted(DUMP.iterdir()):
    if not rd.is_dir(): continue
    meta = json.loads((rd / "meta.json").read_text()) if (rd / "meta.json").exists() else None
    if not meta:
        log(rd.name, "*", 0, "no meta.json"); continue
    if analyzer != "any" and meta.get("analyzer") != analyzer:
        log(rd.name, "*", 0, f"analyzer {meta.get('analyzer')} != {analyzer}"); continue
    if rd.name not in man:
        log(rd.name, "*", 0, "not in DEV manifest"); continue
    truth = parse_truth(man[rd.name]["truth"])
    human = "Homo" in truth
    for arm in ("real", "alldecoy"):
        p = rd / arm / "dump.tsv.gz"
        if not p.exists():
            log(rd.name, arm, 0, "dump.tsv.gz missing"); continue
        log(rd.name, arm, 1, "ok")
        D = load_dump(p, parent, rank)
        gn = [name[g] for g in D["genera"]]
        n = len(gn)
        def status(x):
            if arm == "alldecoy": return "negative"
            if x in truth: return "positive"
            if x in CONTAM or (x == "Homo" and not human): return "excluded"
            return "negative"
        S = {i for i, x in enumerate(gn) if status(x) == "positive"}
        T = D["T"]
        E = np.array([len(s & S) == 0 for s in T])
        nkd = len(D["KD"])
        for i, x in enumerate(gn):
            o = sum(1 for s in T if i in s)
            u = sum(1 for s, e in zip(T, E) if e and i in s)
            kd = [sum(1 for s, e in zip(D["KD"][j], E) if e and i in s) for j in range(nkd)]
            ddb = sum(1 for s, e in zip(D["DDB"], E) if e and i in s)
            cu = sum(1 for s, e in zip(D["CONC"], E) if e and i in s)
            cd = sum(1 for s, e in zip(D["CONC"], E) if e and (i + n) in s)
            out.write(f"{rd.name}\t{arm}\t{x}\t{status(x)}\t{o}\t{u}\t{int(E.sum())}\t{len(T)}\t{np.mean(kd):.3f}\t{np.var(kd, ddof=1):.3f}\t{','.join(map(str,kd))}\t{ddb}\t{cu}\t{cd}\n")
        out.flush()
        print(rd.name, arm, "done", flush=True)
