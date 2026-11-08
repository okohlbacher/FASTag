#!/usr/bin/env python3
"""#1/#10 held-out scorer (PREREG-species-call.md, section 'Held-out scoring protocol'): CFG-01-base (1.10.0
q-rule), CFG-01-cand (-species_call decoy at g_0.01_0.01_5_on) and CFG-10-cand (+ -species_orientation both).

Run table: the manifest rows (item01-heldout); primary = in_primary 'yes' (high-resolution MS2); the pseudo-DDA
stratum and the ion-trap runs are scored the same way and reported apart. Species report per arm:
<runs>/<CFG>/<manifest>/<run dir>/<cell>/tags.species.tsv (or species.tsv), genus rows.
Truth per run (fixed before any run):
  SDRF genera = the first word of each ';'-separated manifest 'organisms' entry. Sage 0.14.7 against ref50.fasta
  (fastag_bench.species.sage_species_config, the paper's truth search) gives the genus-unique peptides: target
  peptides at spectrum and peptide q <= 0.01 (species.sage_peptides), length >= 5, all of whose proteins map to one
  genus (ref50 header OX= -> genus by the RC's nodes.dmp/names.dmp). Status of each universe genus:
    positive     SDRF genus in the universe with >= 3 genus-unique peptides;
    excluded     SDRF genus with < 3 (truth unconfirmed); genus outside the universe; Oryctolagus, Ovis, Equus, and
                 Homo in a sample without a human SDRF organism (the DEV rule);
    Sus, Bos     positive with >= 3 genus-unique peptides, else negative (plan: 'present only when Sage supports
                 them');
    negative     every other universe genus, whatever Sage reports for it (Sage's genus-unique peptides of a genus
                 the SDRF does not name are listed per run, not used: homologous genera are what the call must
                 reject).
Calls: cand arms: call == 'present'; base: qvalue <= 0.01 (the 1.10.0 q-rule); baseline 'share1': deconvolved
share >= 0.01 of the CFG-01-cand report (adjusted column; the 1% deconvolved-share rule); Unipept 4.2.2 is scored
only when <truth>/<manifest>/<run dir>/unipept_genus.tsv exists (genus, peptides, share).
#1 acceptance (CFG-01-cand on the primary runs; all must pass):
  1 specificity (a): negatives with observed >= 5 (n_min of the chosen point) not called present: >= 0.95 and
    Wilson lower bound >= 0.90;  2 runs with any false present <= 10%;
  3 hard negatives (negatives in the same NCBI family or order as a positive genus of the run; single-organism
    runs, stratum 'single'): false-present rate <= 0.01 + the Wilson 95% half-width;
  4 sensitivity (positives present / positives; no shares are stated, so every positive counts) >= 0.80;
  5 runs with every genus row no_call <= 20%;
  6 no positive not_detected with a finite lod below its share (share 1 on single-organism runs; runs without a
    stated share are not evaluable for 6 and are listed).
  (b)'s 'pairwise overlap' clause is not used: FASTag's index overlap is not written by the RC; hard negatives are
  family/order only (PREREG-species-call.md).
#10 (CFG-10-cand vs CFG-01-cand, primary runs): (i) median over (run, positive genus) of
  (observed_both - observed_fwd) / observed_fwd >= 0.10; (ii) top-1 genus (first genus row) positive: runs lost
  (forward right, both wrong) <= 1, exact McNemar p reported; (iii) run-level false-present rate of CFG-10-cand
  <= CFG-01-cand + 0.02 and the #1 acceptance met by CFG-10-cand; (iv) reported: (non-truth observed inflation) /
  (true observed gain), and positives present under forward but not under both (ambiguity loss).
Usage: score_item01.py <acceptance dir> <runs root> <truth root> <ref50.fasta> <taxonomy dir> <out dir>
       [--runtable tsv (run, run_dir, organisms, stratum, primary, analyzer); DEV tests only] [--cell RC]"""
import argparse
import collections
import json
import math
import re
from pathlib import Path

import acclib as A

REPO = A.REPO
CFGS = ("CFG-01-base", "CFG-01-cand", "CFG-10-cand")
EXCL = {"Oryctolagus", "Ovis", "Equus"}
SUPPORT_ONLY = {"Sus", "Bos"}
MIN_PEP, N_MIN, ALPHA = 3, 5, 0.01


def taxonomy(d):
    parent, rank, name = {}, {}, {}
    for line in open(Path(d) / "nodes.dmp"):
        f = [x.strip() for x in line.split("|")]
        parent[f[0]], rank[f[0]] = f[1], f[2]
    for line in open(Path(d) / "names.dmp"):
        f = [x.strip() for x in line.split("|")]
        if f[3] == "scientific name":
            name[f[0]] = f[1]
    return parent, rank, name


def up(t, tax, want):
    parent, rank, name = tax
    seen = 0
    while t in parent and seen < 100:
        if rank.get(t) == want:
            return name.get(t)
        if parent[t] == t:
            break
        t, seen = parent[t], seen + 1
    return None


def acc_genus(fasta, tax):
    ox = re.compile(r"OX=(\d+)")
    cache, out = {}, {}
    for line in open(fasta):
        if line.startswith(">"):
            acc = line[1:].split()[0]
            m = ox.search(line)
            t = m.group(1) if m else None
            if t not in cache:
                cache[t] = up(t, tax, "genus") if t else None
            out[acc] = cache[t]
    return out


def genus_unique(sage, a2g):
    df = A.pd.read_csv(sage, sep="\t", usecols=["peptide", "proteins", "label", "spectrum_q", "peptide_q"])
    df = df[(df["label"] == 1) & (df["spectrum_q"] <= 0.01) & (df["peptide_q"] <= 0.01)]
    per = collections.defaultdict(set)
    for pep, prots in zip(df["peptide"], df["proteins"]):
        p = re.sub(r"\[[^\]]*\]|[^A-Z]", "", pep)
        if len(p) < 5:
            continue
        gs = {a2g.get(x) for x in str(prots).split(";")}
        if len(gs) == 1 and None not in gs:
            per[gs.pop()].add(p)
    return {g: len(v) for g, v in per.items()}


def read_report(d):
    for n in ("tags.species.tsv", "species.tsv"):
        p = Path(d) / n
        if p.exists():
            return [r for r in A.read_tsv(p) if r["rank"] == "genus"]
    return None


def statuses(sdrf, gu, universe):
    st = {}
    human = "Homo" in sdrf
    for g in universe:
        n = gu.get(g, 0)
        if g in sdrf:
            st[g] = "positive" if n >= MIN_PEP else "excluded"
        elif g in SUPPORT_ONLY:
            st[g] = "positive" if n >= MIN_PEP else "negative"
        elif g in EXCL or (g == "Homo" and not human):
            st[g] = "excluded"
        else:
            st[g] = "negative"
    return st


def present(cfg, rows):
    if rows is None:
        return set()
    if cfg == "CFG-01-base":
        return {r["name"] for r in rows if r["qvalue"] not in ("", "NA") and float(r["qvalue"]) <= 0.01}
    if cfg == "share1":
        tot = sum(max(0.0, float(r["adjusted"])) for r in rows)
        return {r["name"] for r in rows if tot and max(0.0, float(r["adjusted"])) / tot >= 0.01}
    return {r["name"] for r in rows if r.get("call") == "present"}


def acceptance(runs, cfg, tax):
    fp_runs = fp_tot = tp = fn = sk = sn = hk = hn = nocall = 0
    lod_bad, lod_ne = [], []
    for x in runs:
        rows = x["reports"].get(cfg)
        pres = present(cfg, rows)
        st = x["status"]
        fps = [g for g in pres if st.get(g) == "negative"]
        fp_runs += bool(fps)
        fp_tot += len(fps)
        pos = [g for g, s in st.items() if s == "positive"]
        tp += sum(g in pres for g in pos)
        fn += sum(g not in pres for g in pos)
        obs = {r["name"]: int(r["observed"]) for r in rows or []}
        for g, s in st.items():
            if s == "negative" and obs.get(g, 0) >= N_MIN:
                sn += 1
                sk += g not in pres
        if x["stratum"] == "single":
            fam = {up(t, tax, k) for g in pos for t in [x["taxid"].get(g)] if t for k in ("family", "order")}
            fam.discard(None)
            for g, s in st.items():
                t = x["taxid"].get(g)
                if s == "negative" and t and ({up(t, tax, "family"), up(t, tax, "order")} & fam):
                    hn += 1
                    hk += g in pres
        if rows and all(r.get("call", "") == "no_call" for r in rows):
            nocall += 1
        if x["share"] is None:
            lod_ne.append(x["run"])
        else:
            for r in rows or []:
                if st.get(r["name"]) == "positive" and r.get("call") == "not_detected" and r.get("lod", "NA") not in ("", "NA"):
                    if float(r["lod"]) < x["share"]:
                        lod_bad.append(f"{x['run']}:{r['name']}")
    n = len(runs)
    lb, ub = A.wilson(sk, sn)
    hlb, hub = A.wilson(hk, hn)
    hr = hk / hn if hn else float("nan")
    out = {"runs": n, "spec_a": sk / sn if sn else float("nan"), "spec_a_n": sn, "spec_a_lb": lb,
           "fp_run_rate": fp_runs / n if n else float("nan"), "fp_per_run": fp_tot / n if n else float("nan"),
           "hard_neg_rate": hr, "hard_neg_n": hn, "hard_neg_halfwidth": (hub - hlb) / 2 if hn else float("nan"),
           "sensitivity": tp / (tp + fn) if tp + fn else float("nan"), "positives": tp + fn,
           "nocall_rate": nocall / n if n else float("nan"), "lod_false_absence": lod_bad, "lod_not_evaluable": lod_ne}
    if cfg != "CFG-01-base" and cfg != "share1":
        ok = [out["spec_a"] >= 0.95 and lb >= 0.90, out["fp_run_rate"] <= 0.10,
              (hn > 0 and hr <= ALPHA + out["hard_neg_halfwidth"]), out["sensitivity"] >= 0.80,
              out["nocall_rate"] <= 0.20, not lod_bad]
        out["criteria"] = ["PASS" if o else "FAIL" for o in ok]
        out["accept"] = all(ok)
    return out


def mcnemar(b, c):
    n = b + c
    return 1.0 if n == 0 else min(1.0, 2 * sum(math.comb(n, i) for i in range(min(b, c) + 1)) / 2 ** n)


def main():
    ap = argparse.ArgumentParser()
    for a in ("acc", "runs", "truth", "ref50", "taxdir", "out"):
        ap.add_argument(a)
    ap.add_argument("--runtable")
    ap.add_argument("--cell", default="RC")
    ap.add_argument("--manifest", default="item01-heldout")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    tax = taxonomy(a.taxdir)
    a2g = acc_genus(a.ref50, tax)
    universe = [l.strip() for l in open(REPO / "bench/fastag-bench/config/species_universe.txt")
                if l.strip() and not l.startswith("#")]
    if a.runtable:
        table = A.read_tsv(a.runtable)
    else:
        table = [{"run": A.run_rel(r["fastag_input"]), "run_dir": A.run_rel(r["fastag_input"]),
                  "organisms": r["organisms"], "stratum": r["stratum"],
                  "primary": "yes" if r["in_primary"] == "yes" else "no", "analyzer": r["ms2_check"]}
                 for r in A.read_tsv(Path(a.acc) / "manifests" / f"{a.manifest}.tsv")]
    runs, info = [], []
    for t in table:
        sdrf = {o.strip().split()[0] for o in t["organisms"].split(";") if o.strip()}
        tp = Path(a.truth) / a.manifest / t["run_dir"] / "results.sage.tsv"
        rec = {"run": t["run"], "stratum": t["stratum"], "primary": t["primary"], "sdrf": ";".join(sorted(sdrf))}
        if not tp.exists():
            rec["status"] = "NO_TRUTH"
            info.append(rec)
            continue
        gu = genus_unique(tp, a2g)
        reps = {c: read_report(Path(a.runs) / c / a.manifest / t["run_dir"] / a.cell) for c in CFGS}
        reps["share1"] = reps["CFG-01-cand"]
        taxid = {}
        for rows in reps.values():
            for r in rows or []:
                taxid.setdefault(r["name"], r["taxid"])
        st = statuses(sdrf, gu, universe)
        share = 1.0 if len(sdrf) == 1 else None
        runs.append({"run": t["run"], "stratum": t["stratum"], "primary": t["primary"], "status": st,
                     "reports": reps, "taxid": taxid, "share": share})
        rec.update(status="ok" if all(reps[c] is not None for c in CFGS) else "REPORT_MISSING",
                   positives=",".join(sorted(g for g, s in st.items() if s == "positive")),
                   sage_genus_unique=json.dumps({g: n for g, n in sorted(gu.items()) if n >= MIN_PEP}))
        info.append(rec)
    prim = [x for x in runs if x["primary"] == "yes"]
    groups = {"primary": prim, "pseudo": [x for x in runs if x["stratum"] == "pseudo"],
              "not_primary_other": [x for x in runs if x["primary"] != "yes" and x["stratum"] != "pseudo"]}
    res = {"manifest": a.manifest, "provenance": A.provenance(),
           "acceptance": {g: {c: acceptance(rs, c, tax) for c in CFGS + ("share1",)} for g, rs in groups.items()}}
    # #10
    gains, lost, won, infl, gain_true, amb = [], 0, 0, 0, 0, 0
    for x in prim:
        f, b = x["reports"]["CFG-01-cand"], x["reports"]["CFG-10-cand"]
        if f is None or b is None:
            continue
        of, ob = {r["name"]: int(r["observed"]) for r in f}, {r["name"]: int(r["observed"]) for r in b}
        for g, s in x["status"].items():
            if s == "positive" and of.get(g, 0) > 0:
                gains.append((ob.get(g, 0) - of[g]) / of[g])
            if s == "positive":
                gain_true += ob.get(g, 0) - of.get(g, 0)
            elif s == "negative":
                infl += ob.get(g, 0) - of.get(g, 0)
        tf = bool(f) and x["status"].get(f[0]["name"]) == "positive"
        tb = bool(b) and x["status"].get(b[0]["name"]) == "positive"
        lost += tf and not tb
        won += tb and not tf
        pf, pb = present("CFG-01-cand", f), present("CFG-10-cand", b)
        amb += sum(1 for g in pf - pb if x["status"].get(g) == "positive")
    a1, a10 = res["acceptance"]["primary"]["CFG-01-cand"], res["acceptance"]["primary"]["CFG-10-cand"]
    med = sorted(gains)[len(gains) // 2] if gains else float("nan")
    r10 = {"i_median_gain": med, "i": "PASS" if gains and med >= 0.10 else "FAIL",
           "ii_lost": lost, "ii_won": won, "ii_p_mcnemar": mcnemar(lost, won), "ii": "PASS" if lost <= 1 else "FAIL",
           "iii": "PASS" if (a10["fp_run_rate"] <= a1["fp_run_rate"] + 0.02 and a10.get("accept")) else "FAIL",
           "iv_inflation_over_gain": infl / gain_true if gain_true else float("nan"), "iv_ambiguity_loss": amb}
    res["item10"] = r10
    res["item1_verdict"] = "PASS" if a1.get("accept") else "FAIL"
    res["item10_verdict"] = "PASS" if all(r10[k] == "PASS" for k in ("i", "ii", "iii")) else "FAIL"
    res["runs_not_ok"] = [(x["run"], x["status"]) for x in info if x["status"] != "ok"]
    if res["runs_not_ok"]:
        res["item1_verdict"] = res["item10_verdict"] = "INCONCLUSIVE"
    A.write_rows(out / "runs.tsv", info, sorted({k for x in info for k in x}))
    (out / "result.json").write_text(json.dumps(res, indent=1, default=str) + "\n")
    print(json.dumps({"item1": res["item1_verdict"], "item10": res["item10_verdict"],
                      "cand": {k: a1[k] for k in ("runs", "spec_a", "spec_a_lb", "fp_run_rate", "hard_neg_rate",
                                                  "sensitivity", "nocall_rate") },
                      "criteria": a1.get("criteria"), "item10_detail": r10, "runs_not_ok": res["runs_not_ok"]},
                     default=str))


if __name__ == "__main__":
    main()
