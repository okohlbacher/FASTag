#!/usr/bin/env python3
"""score.py <manifest.tsv> <out dir> -> one TSV row per run in the test (stdout). PREREG-aspn.md, metrics section.
Reference proteins = accessions with >= 2 target PSMs at spectrum_q <= 0.01 in the first Sage search of the full FASTA
with the true protease (each protein of a shared PSM counts); recall of an arm = share of the reference proteins that the
arm's shortlist keeps (column 'kept' of sl.tsv; the metric of the 1.13 nontryptic test). Sage wall time of a search =
median of its repeats."""
import csv, json, os, re, statistics, sys
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
def medwall(d, reps):
    w = [wall(f"{d}/sage.{r}.time.log") for r in reps]
    w = [x for x in w if x is not None]
    return statistics.median(w) if len(w) == len(reps) else None
def shortlist(p):
    rule, spec, call, kept = "NA", "NA", "NA", set()
    if os.path.exists(p):
        for line in open(p):
            if line.startswith("# protease:"): call = line[len("# protease:"):].strip()
            elif line.startswith("# placement:"):
                f = [x.strip() for x in line[len("# placement:"):].split(",")]
                rule = f[0]; spec = f[1].split()[0] if len(f) > 1 and f[1] else "NA"
            elif not line.startswith("#") and not line.startswith("rank"):
                f = line.rstrip("\n").split("\t")
                if len(f) > 10 and f[10] == "1": kept.add(acc(f[1]))
    return rule, spec, call, (kept if os.path.exists(p) else None)
def semi_cfg(p):
    try: return int(bool(json.load(open(p))["database"]["enzyme"].get("semi_enzymatic", False)))
    except Exception: return "NA"
def exports(d): return int(all(os.path.exists(f"{d}/{x}") and os.path.getsize(f"{d}/{x}") > 0 for x in ("sl.tsv", "red.fasta", "sage.json")))
def fmt(x, nd=4): return "NA" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))
cols = ["run", "group", "protease", "accession", "rc_auto", "rc_autofull", "rc_tryp", "exports_auto", "exports_autofull",
        "exports_tryp", "sage_rc_full", "sage_rc_auto", "sage_rc_autofull", "sage_rc_tryp", "auto_rule", "auto_spec",
        "auto_semi_cfg", "auto_call", "autofull_rule", "autofull_spec", "ref_proteins", "full_psms", "kept_auto",
        "kept_autofull", "kept_tryp", "recall_auto", "recall_autofull", "recall_tryp", "sage_recall_auto",
        "sage_recall_autofull", "sage_recall_tryp", "sage_psms_auto", "sage_psms_autofull", "sage_psms_tryp",
        "wall_full_s", "wall_auto_s", "wall_autofull_s", "wall_tryp_s", "time_ratio_auto", "time_ratio_autofull"]
print("\t".join(cols))
for r in csv.DictReader(open(sys.argv[1]), delimiter="\t"):
    if not r["status"].startswith("in_test"): continue
    o = f"{sys.argv[2]}/{r['run']}"; asp = r["group"] == "aspn"
    fpsm, ref = sage(f"{o}/full/sage.1/results.sage.tsv")
    rule, spec, call, ka = shortlist(f"{o}/auto/sl.tsv")
    frule, fspec, _, kf = shortlist(f"{o}/autofull/sl.tsv")
    _, _, _, kt = shortlist(f"{o}/tryp/sl.tsv")
    psm = {a: sage(f"{o}/{a}/sage.1/results.sage.tsv") for a in ("auto", "autofull", "tryp")}
    rec = lambda k: len(ref & k) / len(ref) if ref and k is not None else None
    wf, wa = medwall(f"{o}/full", (1, 2, 3)), medwall(f"{o}/auto", (1, 2, 3))
    wff, wt = medwall(f"{o}/autofull", (1,)), medwall(f"{o}/tryp", (1,))
    sc = lambda d, reps=(1,): ",".join(txt(f"{d}/sage.{i}.rc") for i in reps)
    v = [r["run"], r["group"], r["protease"], r["accession"], txt(f"{o}/auto/rc"), txt(f"{o}/autofull/rc") if asp else "-",
         txt(f"{o}/tryp/rc"), exports(f"{o}/auto"), exports(f"{o}/autofull") if asp else "-", exports(f"{o}/tryp"),
         sc(f"{o}/full", (1, 2, 3)), sc(f"{o}/auto", (1, 2, 3)), sc(f"{o}/autofull") if asp else "-", sc(f"{o}/tryp"), rule, spec,
         semi_cfg(f"{o}/auto/sage.json"), call, frule if asp else "-", fspec if asp else "-",
         None if ref is None else len(ref), fpsm, None if ka is None else len(ka), None if kf is None else len(kf),
         None if kt is None else len(kt), rec(ka), rec(kf) if asp else None, rec(kt),
         rec(psm["auto"][1]), rec(psm["autofull"][1]) if asp else None, rec(psm["tryp"][1]),
         psm["auto"][0], psm["autofull"][0] if asp else None, psm["tryp"][0], wf, wa, wff, wt,
         None if not wf or not wa else wa / wf, None if not wf or not wff else wff / wf]
    print("\t".join(fmt(x) for x in v))
