#!/usr/bin/env python3
"""score.py <manifest.tsv> <out dir> -> one TSV row per run in the test (stdout).
Metric of the DEV check (dev/score.py): reference proteins = accessions with >= 2 target PSMs at spectrum_q <= 0.01 in
the Sage search of the full FASTA with the true protease (each protein of a shared PSM counts); recall of an arm =
share of the reference proteins that the arm's shortlist keeps (column 'kept' of sl.tsv)."""
import csv, os, re, sys
def sage(path):
    if not os.path.exists(path): return None, None
    psm, count = 0, {}
    with open(path) as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if row["label"] != "1" or float(row["spectrum_q"]) > 0.01: continue
            psm += 1
            for p in row["proteins"].split(";"): count[p] = count.get(p, 0) + 1
    return psm, {acc(p) for p, n in count.items() if n >= 2}
def acc(p):
    m = re.match(r"^(?:sp|tr)\|([^|]+)\|", p); return m.group(1) if m else p
def txt(p): return open(p).read().strip() if os.path.exists(p) else "NA"
def wall(p):
    m = re.search(r"Elapsed \(wall clock\) time.*?: ([\d:.]+)", txt(p))
    if not m: return None
    s = 0.0
    for x in m.group(1).split(":"): s = s * 60 + float(x)
    return s
def shortlist(p):
    rule, call, kept = "NA", "NA", set()
    if os.path.exists(p):
        for line in open(p):
            if line.startswith("# protease:"): call = line[len("# protease:"):].strip()
            elif line.startswith("# placement:"): rule = line[len("# placement:"):].split(",")[0].strip()
            elif not line.startswith("#") and not line.startswith("rank"):
                f = line.rstrip("\n").split("\t")
                if len(f) > 10 and f[10] == "1": kept.add(acc(f[1]))
    return rule, call, kept
def fmt(x, nd=4): return "NA" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))
cols = ["run", "protease", "accession", "rc_default", "rc_forced", "rc_auto", "auto_exports", "sage_rc_auto", "sage_rc_forced",
        "sage_rc_full", "auto_rule", "auto_rule_is_truth", "auto_call", "ref_proteins", "full_psms", "kept_auto", "kept_forced",
        "recall_auto", "recall_forced", "diff", "sage_recall_auto", "sage_recall_forced", "sage_psms_auto", "sage_psms_forced",
        "sage_wall_full_s", "sage_wall_auto_s", "speedup_auto", "fasta_entries_auto"]
print("\t".join(cols))
for r in csv.DictReader(open(sys.argv[1]), delimiter="\t"):
    if not r["status"].startswith("in_test"): continue
    o = f"{sys.argv[2]}/{r['run']}"
    fpsm, ref = sage(f"{o}/full/results.sage.tsv")
    rule, call, ka = shortlist(f"{o}/auto/sl.tsv"); _, _, kf = shortlist(f"{o}/forced/sl.tsv")
    apsm, aprot = sage(f"{o}/auto/sage/results.sage.tsv"); qpsm, qprot = sage(f"{o}/forced/sage/results.sage.tsv")
    rec = lambda k: len(ref & k) / len(ref) if ref and k is not None else None
    ra, rf = rec(ka), rec(kf)
    wf, wa = wall(f"{o}/full/sage.time.log"), wall(f"{o}/auto/sage.time.log")
    exports = all(os.path.exists(f"{o}/auto/{x}") and os.path.getsize(f"{o}/auto/{x}") > 0 for x in ("sl.tsv", "red.fasta", "sage.json"))
    nfa = sum(1 for l in open(f"{o}/auto/red.fasta") if l.startswith(">")) if os.path.exists(f"{o}/auto/red.fasta") else None
    v = [r["run"], r["protease"], r["accession"], txt(f"{o}/default/rc"), txt(f"{o}/forced/rc"), txt(f"{o}/auto/rc"),
         int(exports), txt(f"{o}/auto/sage.rc"), txt(f"{o}/forced/sage.rc"), txt(f"{o}/full/sage.rc"), rule,
         int(rule == r["protease"]), call, None if ref is None else len(ref), fpsm, len(ka), len(kf), ra, rf,
         None if ra is None or rf is None else ra - rf, rec(aprot), rec(qprot), apsm, qpsm, wf, wa,
         None if not wf or not wa else wf / wa, nfa]
    print("\t".join(fmt(x) for x in v))
