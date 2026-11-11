#!/usr/bin/env python3
"""feat.py <manifest> <runs root> <out.tsv>: per-run call, class and gate features of label discovery reports."""
import csv, re, sys, os
man, runs, out = sys.argv[1:4]
def tclass(t): return "TMTpro/iTRAQ8" if t in ("TMTpro", "iTRAQ8") else t
def tokens(l):
    o, cur = [], ""
    for p in l.split("+"):
        if re.search(r"(^|:)unknown:[NKRC]$", cur) or re.fullmatch(r"unknown:[NKRC]", cur): cur += "+" + p
        else:
            if cur: o.append(cur)
            cur = p
    if cur: o.append(cur)
    return o
def tokclass(x):
    x = re.sub(r"^[NKRC]:", "", x)
    if x.startswith("unknown:"): return "other"
    if "TMTpro" in x or "iTRAQ8" in x: return "TMTpro/iTRAQ8"
    if "TMT" in x: return "TMT"
    if "iTRAQ4" in x: return "iTRAQ4"
    if re.fullmatch(r"(Lys|Arg)\d+", x) or re.match(r"Label:(13C|2H|15N)", x): return "SILAC"
    if x.startswith("Dimethyl"): return "dimethyl"
    return "other"
rows = [r for r in csv.DictReader((l for l in open(man) if not l.startswith("# ")), delimiter="\t") if r["include"] == "yes"]
K = ["ld_call.status", "ld_call.labels", "ld_call.basis", "ld_call.reason", "ld_count.spectra_counted",
     "ld_reporter.gate", "ld_reporter.scans", "ld_reporter.covered", "ld_reporter.ms2_scans", "ld_reporter.ms2_ion_trap",
     "ld_reporter.tmt_excess", "ld_reporter.itraq4_excess", "ld_reporter.itraq8_excess", "ld_reporter.tmtpro_excess",
     "ld_pair.precursors", "ld_pair.lys8_pairs", "ld_pair.arg10_pairs", "ld_pair.control_pairs", "ld_pair.lys8_ratio",
     "ld_pair.arg10_ratio", "ld_pair.other_pairs", "ld_pair.other_ratio", "ld_pair.silac",
     "ld_site.N.0.spectra", "ld_site.N.0.ladder_clean", "ld_site.N.0.support_c", "ld_site.K.0.spectra", "ld_site.R.0.spectra",
     "ld_run.low_resolution", "ld_reporter.it_scans", "ld_reporter.it_covered", "ld_reporter.region_recorded"]
with open(out, "w") as fh:
    fh.write("\t".join(["id", "pxd", "truth", "cls", "ok", "rc", "stratum", "instrument"] + K) + "\n")
    for r in rows:
        d = {}
        p = f"{runs}/{r['id']}/ld.tsv"
        try: rc = open(f"{runs}/{r['id']}/rc.txt").read().strip()
        except OSError: rc = "norun"
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                f = line.rstrip("\n").split("\t")
                if len(f) >= 3: d[f[0] + "." + f[1]] = f[2]
        cls = "no call"
        if d.get("ld_call.status") == "call":
            l = d["ld_call.labels"]
            if l == "label-free": cls = "label-free"
            else:
                cs = [tokclass(t) for t in tokens(l)]; cls = cs[0] if len(set(cs)) == 1 else "mixed"
        truth = tclass(r["label_class"])
        def sh(v):
            try: return f"{float(v):.4g}"
            except (TypeError, ValueError): return v if v is not None else "NA"
        fh.write("\t".join([r["id"], r["pxd"], truth, cls, str(cls == truth), rc, r.get("stratum", r.get("set", "-")), r.get("instrument", "-")]
                           + [sh(d.get(k)) for k in K]) + "\n")
