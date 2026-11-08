#!/usr/bin/env python3
"""Score the FASTag 1.12 DEV engine searches (#5 shortlist arms, #17 shift arms). DEV data only.

Input: a TSV with columns  run arm engine params result fasta ref
  engine  sage (results.sage.tsv) | comet (Comet .txt)
  fasta   the target database of that search WITHOUT entrapment (reduced FASTA + background, or the full DB); used
          for residues and database recall
  ref     arm name of the reference search of the same run and engine (#5: F, the full database), or '-'
Per search, at 1 % PSM FDR (Sage spectrum_q; Comet: target-decoy q over rank-1 e-values, DECOY_ proteins):
  psm_t / psm_e     target and entrapment PSMs (entrapment = every protein ENTRAP_)
  fdp               combined entrapment FDP at r = 1: 2 E / (T + E); fdp_ub: 2 x the one-sided 95 % Clopper-Pearson
                    upper bound of E / (T + E)
  pep_t             distinct target peptides (stripped, I -> L)
  residues          target residues of `fasta`
vs ref (same run, engine): db_recall = share of the ref's target peptides that occur in this search's target
  database; retained = |P_this & P_ref| / |P_ref|; reduction = ref residues / residues; psm_gain = psm_t / ref psm_t - 1
Usage: score.py <searches.tsv> <out.tsv>"""
import csv, math, re, sys

def lbinom_cdf(k, n, p):
    if p <= 0: return 1.0
    if p >= 1: return 0.0 if k < n else 1.0
    s, lp, lq = 0.0, math.log(p), math.log1p(-p)
    for i in range(k + 1):
        s += math.exp(math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * lp + (n - i) * lq)
    return s

def cp_upper(k, n, a=0.05):
    if n == 0: return 1.0
    lo, hi = k / n, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if lbinom_cdf(k, n, mid) > a: lo = mid
        else: hi = mid
    return hi

def strip(p):
    return re.sub(r"[^A-Z]", "", re.sub(r"\[[^\]]*\]", "", p)).replace("I", "L")

def kind(prots, decoy):
    if all(x.startswith(decoy) for x in prots): return "d"
    if all(x.startswith("ENTRAP_") for x in prots): return "e"
    return "t"

def sage(path):
    out = []
    with open(path) as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if r.get("rank", "1") != "1" or float(r["spectrum_q"]) > 0.01: continue
            prots = r["proteins"].split(";")
            k = "d" if r["label"] == "-1" else kind(prots, "rev_")
            if k == "d": continue
            out.append((r["scannr"], strip(r["peptide"]), prots, k, float(r["expmass"]) - float(r["calcmass"])))
    return out

def comet(path):
    rows = []
    with open(path) as f:
        f.readline()
        for r in csv.DictReader(f, delimiter="\t"):
            if r["num"] != "1": continue
            prots = [x for x in r["protein"].split(",") if x]
            rows.append((float(r["e-value"]), r["scan"], r["plain_peptide"], prots, kind(prots, "DECOY_"),
                         float(r["exp_neutral_mass"]) - float(r["calc_neutral_mass"])))
    rows.sort(key=lambda x: x[0])
    d = t = 0; q = []
    for r in rows:
        if r[4] == "d": d += 1
        else: t += 1
        q.append(d / max(t, 1))
    for i in range(len(q) - 2, -1, -1):
        q[i] = min(q[i], q[i + 1])
    return [(r[1], strip(r[2]), r[3], r[4], r[5]) for r, qq in zip(rows, q) if qq <= 0.01 and r[4] != "d"]

def fasta(path):
    acc, seqs, h, s = set(), [], None, []
    with open(path) as f:
        for line in f:
            line = line.rstrip()
            if line.startswith(">"):
                if h is not None: seqs.append("".join(s))
                h, s = line[1:].split()[0], []; acc.add(h)
            else: s.append(line)
    if h is not None: seqs.append("".join(s))
    return acc, "#".join(seqs).replace("I", "L"), sum(map(len, seqs))

def main():
    S = list(csv.DictReader(open(sys.argv[1]), delimiter="\t"))
    res, dbs = {}, {}
    for s in S:
        ps = sage(s["result"]) if s["engine"] == "sage" else comet(s["result"])
        T = sum(1 for p in ps if p[3] == "t"); E = sum(1 for p in ps if p[3] == "e")
        peps = {}
        for p in ps:
            if p[3] == "t": peps.setdefault(p[1], set()).update(p[2])
        if s["fasta"] not in dbs: dbs[s["fasta"]] = fasta(s["fasta"])
        n = T + E
        res[(s["run"], s["engine"], s["arm"])] = dict(s, psm_t=T, psm_e=E, fdp=2 * E / n if n else 0.0,
            fdp_ub=2 * cp_upper(E, n) if n else 1.0, pep_t=len(peps), residues=dbs[s["fasta"]][2], _peps=peps)
    cols = ["run", "arm", "engine", "params", "psm_t", "psm_e", "fdp", "fdp_ub", "pep_t", "residues",
            "db_recall", "retained", "reduction", "psm_gain", "ref"]
    with open(sys.argv[2], "w") as o:
        o.write("\t".join(cols) + "\n")
        for k, r in res.items():
            ref = res.get((r["run"], r["engine"], r["ref"])) if r["ref"] != "-" else None
            if ref:
                acc, big, _ = dbs[r["fasta"]]
                P = ref["_peps"]
                inside = sum(1 for p, pr in P.items() if (pr & acc) or p in big)
                r["db_recall"] = f"{inside / len(P):.4f}" if P else "NA"
                r["retained"] = f"{len(P.keys() & r['_peps'].keys()) / len(P):.4f}" if P else "NA"
                r["reduction"] = f"{ref['residues'] / r['residues']:.2f}"
                r["psm_gain"] = f"{r['psm_t'] / ref['psm_t'] - 1:+.4f}" if ref["psm_t"] else "NA"
            else:
                r["db_recall"] = r["retained"] = r["reduction"] = r["psm_gain"] = "-"
            r["fdp"] = f"{r['fdp']:.4f}"; r["fdp_ub"] = f"{r['fdp_ub']:.4f}"
            o.write("\t".join(str(r[c]) for c in cols) + "\n")

if __name__ == "__main__":
    main()
