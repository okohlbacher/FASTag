#!/usr/bin/env python3
"""Truth table and scorer of PREREG-species-explain.md (FASTag 1.13, -species_call explain). Standard library only.

  score_species_explain.py truth <manifest> <root> <ref50.fasta> <taxonomy dir> <universe> <out truth_genera.tsv>
  score_species_explain.py score <manifest> <truth_genera.tsv> <root> <out dir>

truth (before the freeze, no FASTag output involved): per run, the SDRF genera (first word of each ';'-separated
manifest organism, capitalised) and, from <root>/truth/<pxd>/<run>/results.sage.tsv, the genus-unique peptides of
every genus: target peptides at spectrum_q and peptide_q <= 0.01, stripped length >= 5, all of whose proteins map to
one genus (ref50 header OX= -> genus by nodes.dmp/names.dmp). Rows: every genus that is an SDRF genus or has >= 1
genus-unique peptide, with its status; an index genus without a row is 'negative' (Oryctolagus, Ovis, Equus and Homo
in a non-human run: 'excluded'). Status, identical to acceptance/1.12 scorers/score_item01.py statuses():
  positive   an SDRF genus with >= 3 genus-unique peptides; Sus and Bos with >= 3;
  excluded   an SDRF genus with < 3 (truth unconfirmed); Oryctolagus, Ovis, Equus; Homo in a run without a human
             SDRF organism: never a false call, never expected;
  negative   every other genus, whatever Sage reports for it; Sus and Bos with < 3.
A run without results.sage.tsv gets the single row genus 'NA', status 'no_truth' and is not scored.

score (after the run, once): per run and configuration (CFG-explain, CFG-decoy; <root>/runs/<CFG>/<pxd>/<run>/
species.tsv, file rc = 0), called = the genus rows with call 'present'.
  false calls   called genera of status negative;
  recovery      positive genera in the index that are called / positive genera in the index, pooled over the
                scored runs.
A run is scored only when its truth exists and both configurations finished (rc 0, species.tsv with genus rows);
otherwise it is excluded from both configurations and listed.
Verdict (constants below):
  INCONCLUSIVE  fewer than MIN_RUNS scored runs, or fewer than MIN_TRUE positive genera in the index over them;
  primary       mean false calls per run of CFG-explain; PASS when the upper end of the 95 % bootstrap interval
                (percentiles 2.5 / 97.5 of the mean over BOOT resamples of the runs, random.Random(SEED)) <= LIMIT;
  guard         PASS when recovery(CFG-explain) >= recovery(CFG-decoy) - GUARD;
  overall       PASS when primary and guard pass, else FAIL.
Reported, not decisive: the same numbers for CFG-decoy, runs with any false call, runs where the SDRF genus (in the
index) is not called while another genus is, runs without any present call, recovery of the SDRF genera alone
(called SDRF index genera / SDRF index genera, confirmed or not), and two other countings of the same
calls: 'sdrfonly' (every called genus that is not an SDRF genus is false) and 'literal' (a genus is true when it is
an SDRF genus or has >= 3 genus-unique peptides: false = called and not true; recovery over the true index
genera)."""
import collections
import csv
import random
import re
import sys
from pathlib import Path

CFGS = ("CFG-explain", "CFG-decoy")
MIN_PEP, LIMIT, GUARD, BOOT, SEED, MIN_RUNS, MIN_TRUE = 3, 0.75, 0.05, 10000, 113, 50, 30
EXCL, SUPPORT_ONLY = {"Oryctolagus", "Ovis", "Equus"}, {"Sus", "Bos"}
csv.field_size_limit(1 << 30)


def tsv(p):
    with open(p, newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def sdrf_genera(organisms):
    return {o.split()[0].capitalize() for o in organisms.split(";") if o.strip()}


# ------------------------------------------------------------------ truth
def acc_genus(fasta, taxdir):
    parent, rank, name = {}, {}, {}
    for line in open(Path(taxdir) / "nodes.dmp"):
        f = [x.strip() for x in line.split("|")]
        parent[f[0]], rank[f[0]] = f[1], f[2]
    for line in open(Path(taxdir) / "names.dmp"):
        f = [x.strip() for x in line.split("|")]
        if f[3] == "scientific name":
            name[f[0]] = f[1]

    def genus(t):
        for _ in range(100):
            if t not in parent:
                return None
            if rank.get(t) == "genus":
                return name.get(t)
            if parent[t] == t:
                return None
            t = parent[t]

    ox, cache, out = re.compile(r"OX=(\d+)"), {}, {}
    for line in open(fasta):
        if line.startswith(">"):
            m = ox.search(line)
            t = m.group(1) if m else None
            if t not in cache:
                cache[t] = genus(t) if t else None
            out[line[1:].split()[0]] = cache[t]
    return out


def genus_unique(sage, a2g):
    per = collections.defaultdict(set)
    with open(sage, newline="") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if r["label"] != "1" or float(r["spectrum_q"]) > 0.01 or float(r["peptide_q"]) > 0.01:
                continue
            p = re.sub(r"\[[^\]]*\]|[^A-Z]", "", r["peptide"])
            if len(p) < 5:
                continue
            gs = {a2g.get(x) for x in r["proteins"].split(";")}
            if len(gs) == 1 and None not in gs:
                per[gs.pop()].add(p)
    return {g: len(v) for g, v in per.items()}


def status(g, sdrf, n, human):
    if sdrf:
        return "positive" if n >= MIN_PEP else "excluded"
    if g in SUPPORT_ONLY:
        return "positive" if n >= MIN_PEP else "negative"
    if g in EXCL or (g == "Homo" and not human):
        return "excluded"
    return "negative"


def truth_rows(run, gu, universe):
    """gu None: no truth search result."""
    if gu is None:
        return [[run["pxd"], run["run"], "NA", "", "", "", "no_truth"]]
    sd = sdrf_genera(run["organisms"])
    return [[run["pxd"], run["run"], g, int(g in universe), int(g in sd), gu.get(g, 0),
             status(g, g in sd, gu.get(g, 0), "Homo" in sd)] for g in sorted(sd | set(gu))]


def cmd_truth(man, root, fasta, taxdir, universe, out):
    uni = {l.strip() for l in open(universe) if l.strip() and not l.startswith("#")}
    a2g = acc_genus(fasta, taxdir)
    with open(out, "w", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(["pxd", "run", "genus", "in_index", "sdrf", "sage_genus_unique", "status"])
        for r in tsv(man):
            s = Path(root) / "truth" / r["pxd"] / r["run"] / "results.sage.tsv"
            w.writerows(truth_rows(r, genus_unique(s, a2g) if s.exists() else None, uni))


# ------------------------------------------------------------------ score
def called(d):
    """present genera of a finished run, None when the run failed (rc != 0, no report, no genus row)."""
    d = Path(d)
    try:
        if (d / "rc").read_text().strip() != "0":
            return None
        rows = [r for r in tsv(d / "species.tsv") if r["rank"] == "genus"]
    except (OSError, KeyError):
        return None
    return {r["name"] for r in rows if r["call"] == "present"} if rows else None


def percentile(v, q):  # numpy 'linear'
    v = sorted(v)
    k = (len(v) - 1) * q / 100.0
    lo = int(k)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def boot(x):
    rng, n = random.Random(SEED), len(x)
    means = [sum(rng.choices(x, k=n)) / n for _ in range(BOOT)]
    return sum(x) / n, percentile(means, 2.5), percentile(means, 97.5)


def score(runs, truth, calls):
    """runs: manifest rows; truth: {(pxd, run): {genus: (in_index, sdrf, n genus-unique)}} (absent = no truth);
    calls: {cfg: {(pxd, run): set | None}}. Returns (per-run rows, summary dict)."""
    per, excl = [], []
    for r in runs:
        k = (r["pxd"], r["run"])
        if k not in truth or any(calls[c].get(k) is None for c in CFGS):
            excl.append("%s/%s: %s" % (*k, "no truth" if k not in truth else "run failed"))
            continue
        t = truth[k]
        sdrf = {g for g, v in t.items() if v[1]}
        human = "Homo" in sdrf
        st = lambda g: status(g, g in sdrf, t.get(g, (0, 0, 0))[2], human)  # noqa: E731
        exp = {g for g, v in t.items() if v[0] and st(g) == "positive"}
        sd_exp = {g for g in sdrf if t[g][0]}
        lit = {g for g, v in t.items() if v[1] or v[2] >= MIN_PEP}
        lit_exp = {g for g in lit if t[g][0]}
        row = {"pxd": k[0], "run": k[1], "positive_in_index": ";".join(sorted(exp)), "n_true": len(exp),
               "n_sdrf": len(sd_exp), "n_true_literal": len(lit_exp)}
        for c in CFGS:
            p = calls[c][k]
            false = sorted(g for g in p if st(g) == "negative")
            row.update({c + ":called": ";".join(sorted(p)), c + ":false": ";".join(false), c + ":n_false": len(false),
                        c + ":n_false_sdrfonly": len(p - sdrf), c + ":n_false_literal": len(p - lit),
                        c + ":n_recovered": len(exp & p), c + ":missed": ";".join(sorted(exp - p)),
                        c + ":n_recovered_literal": len(lit_exp & p), c + ":n_sdrf_recovered": len(sd_exp & p),
                        c + ":relative_instead": int(bool(sd_exp - p) and bool(p - sdrf)), c + ":no_present": int(not p)})
        per.append(row)
    s = {"runs_manifest": len(runs), "runs_scored": len(per), "excluded": excl,
         "true_in_index": sum(r["n_true"] for r in per)}
    for c in CFGS:
        if per:
            s[c + ":false_per_run"] = boot([r[c + ":n_false"] for r in per])
            s[c + ":false_per_run_sdrfonly"] = boot([r[c + ":n_false_sdrfonly"] for r in per])
            s[c + ":false_per_run_literal"] = boot([r[c + ":n_false_literal"] for r in per])
        s[c + ":false_total"] = sum(r[c + ":n_false"] for r in per)
        s[c + ":runs_any_false"] = sum(1 for r in per if r[c + ":n_false"])
        s[c + ":recovered"] = sum(r[c + ":n_recovered"] for r in per)
        s[c + ":recovery"] = s[c + ":recovered"] / s["true_in_index"] if s["true_in_index"] else None
        s[c + ":recovered_literal"] = sum(r[c + ":n_recovered_literal"] for r in per)
        s[c + ":sdrf_recovered"] = sum(r[c + ":n_sdrf_recovered"] for r in per)
        s[c + ":relative_instead"] = sum(r[c + ":relative_instead"] for r in per)
        s[c + ":no_present"] = sum(r[c + ":no_present"] for r in per)
    s["true_in_index_literal"] = sum(r["n_true_literal"] for r in per)
    s["sdrf_in_index"] = sum(r["n_sdrf"] for r in per)
    if len(per) < MIN_RUNS or s["true_in_index"] < MIN_TRUE:
        s["primary"] = s["guard"] = s["overall"] = "INCONCLUSIVE"
    else:
        s["primary"] = "PASS" if s["CFG-explain:false_per_run"][2] <= LIMIT else "FAIL"
        s["guard"] = "PASS" if s["CFG-explain:recovery"] >= s["CFG-decoy:recovery"] - GUARD else "FAIL"
        s["overall"] = "PASS" if s["primary"] == s["guard"] == "PASS" else "FAIL"
    return per, s


def read_truth(p):
    t = {}
    for r in tsv(p):
        if r["status"] == "no_truth":
            continue
        t.setdefault((r["pxd"], r["run"]), {})[r["genus"]] = (r["in_index"] == "1", r["sdrf"] == "1", int(r["sage_genus_unique"]))
    return t


def cmd_score(man, truth, root, out):
    runs = tsv(man)
    calls = {c: {(r["pxd"], r["run"]): called(Path(root) / "runs" / c / r["pxd"] / r["run"]) for r in runs} for c in CFGS}
    per, s = score(runs, read_truth(truth), calls)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    if per:
        with open(out / "per_run.tsv", "w", newline="") as f:
            w = csv.DictWriter(f, list(per[0]), delimiter="\t", lineterminator="\n")
            w.writeheader()
            w.writerows(per)
    with open(out / "summary.tsv", "w") as f:
        for k, v in s.items():
            if isinstance(v, tuple):
                v = "%.4f [%.4f, %.4f]" % v
            elif isinstance(v, float):
                v = "%.4f" % v
            elif isinstance(v, list):
                v = "; ".join(v) or "-"
            f.write(f"{k}\t{v}\n")
    print(open(out / "summary.tsv").read(), end="")


if __name__ == "__main__":
    {"truth": cmd_truth, "score": cmd_score}[sys.argv[1]](*sys.argv[2:])
