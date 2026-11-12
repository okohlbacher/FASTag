#!/usr/bin/env python3
"""Held-out test 5 truth audit (PREREG-labeldisc5.md, "Truth audit"; the audit of test 4 unchanged but for the columns probe and silac_sub): metadata plus the reporter-ion scan, never FASTag output.
Usage: audit_heldout5.py <selected.tsv> <manual_exclusions.tsv> <scan dir> <in root> <out audited.tsv> <stage.tsv> [<stage.tsv> ...]
       audit_heldout5.py --features <scan.json>     (print the scan features of one run)"""
import sys, json, csv, os
def features(j):
    """Per high-resolution (FTMS) MS2/MS3 group with >= 100 decoded spectra: share of spectra with >= k reporter channels
    minus the share at the decoy m/z. T: TMT >= 2; P: TMTpro-only channels >= 2; I: iTRAQ4 >= 2; I8: iTRAQ8-only channels >= 1."""
    def ex(g, name, k):
        d = g["decoded"]
        s = sum(v for h, v in g["hits"].items() if h.startswith(name + ":") and int(h.split(":")[1]) >= k) / d
        dd = sum(v for h, v in g.get("decoy_hits", {}).items() if h.startswith(name + ":") and int(h.split(":")[1]) >= k) / (2 * d)
        return s - dd
    gs = [g for k, g in j["groups"].items() if "|FTMS|" in k and g["decoded"] >= 100]
    f = dict(assessable=bool(gs), low_mass_seen=any(g["minmz_q50"] is not None and g["minmz_q50"] <= 112.0 for g in gs))
    for n, name, k in (("T", "TMT", 2), ("P", "TMTproX", 2), ("I", "iTRAQ4", 2), ("I8", "iTRAQ8X", 1)):
        f[n] = round(max((ex(g, name, k) for g in gs), default=0.0), 3)
    lv = {int(k): v for k, v in j["levels"].items()}
    n2 = {a: sum(g["n"] for k, g in j["groups"].items() if k.startswith("ms2|" + a)) for a in ("FTMS", "ITMS", "other")}
    f["ms2_analyzer"] = "none" if not sum(n2.values()) else "FT" if n2["FTMS"] >= 0.9 * sum(n2.values()) else "IT" if n2["ITMS"] >= 0.9 * sum(n2.values()) else "mixed"
    f["acquisition"] = "MS3" if lv.get(3, 0) >= 100 else "MS2"
    f["ms1"] = lv.get(1, 0); f["ms2"] = lv.get(2, 0); f["ms3"] = lv.get(3, 0)
    f["iso_width"] = j.get("ms2_isolation_width_median")
    f["ms1_analyzer"] = max(j.get("ms1_analyzer") or {"none": 0}, key=lambda k: (j.get("ms1_analyzer") or {"none": 0})[k])
    return f
def verdict(truth, f):
    """-> (include, reason)"""
    if f["ms2"] == 0: return "no", "no_ms2_spectra"
    if f["iso_width"] is not None and f["iso_width"] > 4.0: return "no", "wide_isolation_dia"
    iso = truth in ("TMT", "TMTpro", "iTRAQ4", "iTRAQ8")
    if iso and not f["assessable"]: return "no", "reporter_scan_not_assessable"
    ok = {"TMT": f["T"] >= 0.3 and f["P"] < 0.05, "TMTpro": f["T"] >= 0.3 and f["P"] >= 0.3,
          "iTRAQ4": f["I"] >= 0.3 and f["I8"] < 0.05, "iTRAQ8": f["I8"] >= 0.3}.get(truth)
    if iso: return ("yes", "reporter_scan_agrees") if ok else ("no", "reporter_scan_disagrees")
    if not (f["assessable"] and f["low_mass_seen"]): return "yes", "reporter_scan_not_assessable_kept"
    if f["T"] >= 0.05 or f["I"] >= 0.05: return "no", "reporter_ions_in_non_isobaric_run"
    return "yes", "no_reporter_ions"
if __name__ == "__main__":
    if sys.argv[1] == "--features": print(features(json.load(open(sys.argv[2])))); sys.exit()
    selp, manp, scand, root, outp = sys.argv[1:6]
    sel = list(csv.DictReader((l for l in open(selp) if not l.startswith("# ")), delimiter="\t"))
    man = dict(l.rstrip("\n").split("\t")[:2] for l in open(manp) if l.strip() and not l.startswith("#"))
    st = {}
    for p in sys.argv[6:]:
        for l in open(p):
            c = l.rstrip("\n").split("\t")
            if len(c) >= 8: st[c[0]] = c
    by = {}
    for s in sel: by.setdefault(s["pxd"], []).append(s)
    cols = ["id", "pxd", "label_class", "probe", "silac_sub", "include", "audit", "cell", "digestion", "ms2_analyzer", "acquisition", "ms1_analyzer", "ms1", "ms2", "ms3", "iso_width",
            "T", "P", "I", "I8", "rank", "sdrf", "root", "fastag_input", "fastag_input_sha256", "raw_sha256"]
    with open(outp, "w") as o:
        o.write("# label-discovery held-out test 5 audited manifest; include = yes rows are run and scored\n" + "\t".join(cols) + "\n")
        for pxd, rows in by.items():
            rows.sort(key=lambda r: int(r["rank"])); use = None
            for r in rows:   # lowest rank whose download and conversion succeeded
                c = st.get(r["id"])
                if c and c[4] == "0" and c[7] and "FAILED" not in c[2] and "DIFFERS" not in c[2] and "MISMATCH" not in c[2]: use = (r, c); break
            r0 = rows[0]
            d = dict(id=r0["id"], pxd=pxd, label_class=r0["truth"], probe=r0["probe"], silac_sub=r0["silac_sub"], cell=r0["cell"], digestion=r0["digestion"], sdrf=r0["sdrf"], root=root, rank="-")
            if use is None: d.update(include="no", audit="download_or_conversion_failed")
            else:
                r, c = use; d.update(id=r["id"], rank=r["rank"], fastag_input=c[5], fastag_input_sha256=c[7], raw_sha256=c[3])
                sj = f"{scand}/{r['id']}.json"
                if not os.path.exists(sj): d.update(include="no", audit="scan_failed")
                else:
                    f = features(json.load(open(sj))); inc, why = verdict(r["truth"], f); d.update(f)
                    if pxd in man: inc, why = "no", "manual:" + man[pxd]
                    d.update(include=inc, audit=why)
            o.write("\t".join(str(d.get(c, "-")) for c in cols) + "\n")
