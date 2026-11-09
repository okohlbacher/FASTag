"""Oracle table: per run/arm/genus, observed o, exclusive u given S (truth positives for real; empty for alldecoy),
k-mer decoy replicate exclusive counts. DEV only."""
import json, sys
import numpy as np
from load import *
parent, rank, name = taxonomy()
man = manifest()
out = open(sys.argv[1], "w")
out.write("run\tarm\tgenus\tstatus\to\tu\tunexpl\tn_spec\tkd_mean\tkd_var\tkd\tddb_u\tconc_u\tconc_dec_u\n")
for rd in sorted(DUMP.iterdir()):
    if not rd.is_dir(): continue
    meta = json.loads((rd / "meta.json").read_text()) if (rd / "meta.json").exists() else None
    if not meta or meta.get("analyzer") != "FTMS": continue
    truth = parse_truth(man[rd.name]["truth"])
    human = "Homo" in truth
    for arm in ("real", "alldecoy"):
        p = rd / arm / "dump.tsv.gz"
        if not p.exists(): continue
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
