#!/usr/bin/env python3
"""Verdict script of PREREG-labeldisc5.md (label discovery, held-out test 5: single-spacing SILAC rule with site check).
  verdict_labeldisc5.py <audited.tsv> <candidate score dir> <baseline score dir> <candidate runs root> <out.md>   |   --selftest
Score dirs are outputs of score_labeldisc3.py (per_run.tsv, summary.json) on the same audited manifest; isotope-probe runs
enter the scorer with truth label-free and are told apart here by the manifest column probe = yes.
Ion-trap MS2 = audit stratum ms2_analyzer IT or mixed.
Decide: S1, S2, P-S1, E1, R-SILAC, F. Reported: I1, D1, V1.
A criterion is FAIL when its threshold is missed, else INCONCLUSIVE when a minimum number is not reached, else PASS.
Candidate: PASS only if all six deciding criteria PASS; FAIL if any is FAIL; else INCONCLUSIVE."""
import csv, json, os, re, sys, collections
MIN_LF, MIN_LF_IT, MIN_PROBE_SIG, MIN_E1, MIN_SILAC, MIN_LAB = 40, 20, 8, 15, 30, 60
E1_GAIN, R_SILAC, F_MAX, PAIRS, RATIO = 3, 0.70, 0.05, 30, 20.0
SUBS = ["light/heavy Lys8/Arg10", "light/medium Lys6/Arg6", "triple", "Arg10 only or Arg-C", "Lys only", "unknown"]
def v3(ok, enough): return "FAIL" if not ok else "PASS" if enough else "INCONCLUSIVE"
def overall(vs): return "FAIL" if "FAIL" in vs else "INCONCLUSIVE" if "INCONCLUSIVE" in vs else "PASS"
def tokens(l):   # as score_labeldisc3.tokens
    out, cur = [], ""
    for p in l.split("+"):
        if re.search(r"(^|:)unknown:[NKRC]$", cur): cur += "+" + p
        else:
            if cur: out.append(cur)
            cur = p
    if cur: out.append(cur)
    return out
def silac_token(labels):
    return any(re.match(r"(Lys|Arg)\d", re.sub(r"^[NKRC]:", "", t)) or re.match(r"Label:(13C|2H|15N)", re.sub(r"^[NKRC]:", "", t))
               for t in tokens(labels)) if labels not in ("-", "", "label-free") else False
def ld_rows(path):
    kv = {}
    try:
        for l in open(path):
            c = l.rstrip("\n").split("\t")
            if len(c) >= 3 and c[0] == "ld_pair": kv[c[1]] = c[2]
    except OSError: pass
    return kv
def fnum(x):
    try: return float(x)
    except (TypeError, ValueError): return 0.0
def silac_signal(kv):
    """a SILAC spacing with >= 30 pairs and a ratio >= 20 to the controls (pairs / (control + 5))"""
    c = fnum(kv.get("control_pairs"))
    return any(fnum(kv.get(k)) >= PAIRS and fnum(kv.get(k)) / (c + 5) >= RATIO for k in ("lys8_pairs", "arg10_pairs", "lys6arg6_pairs", "medium_heavy_pairs"))
def decide(man, cand, base, ld):
    """man: id -> manifest row (include = yes); cand, base: id -> per_run row; ld: id -> ld_pair dict of the candidate"""
    ids = [i for i in man if i in cand]
    it = lambda i: man[i].get("ms2_analyzer") in ("IT", "mixed")
    probe = lambda i: man[i].get("probe") == "yes"
    v, rep = {}, {}
    lf = [i for i in ids if cand[i]["truth"] == "label-free" and not probe(i)]
    w = [i for i in lf if cand[i]["outcome"] == "wrong"]
    v["S1"] = (v3(not w, len(lf) >= MIN_LF and sum(map(it, lf)) >= MIN_LF_IT),
               f"{len(w)} wrong calls on {len(lf)} label-free runs ({sum(map(it, lf))} with ion-trap MS2) {' '.join(w)}")
    pr = [i for i in ids if probe(i)]
    sc = [i for i in pr if silac_token(cand[i]["labels"])]
    sig = [i for i in pr if silac_signal(ld.get(i, {}))]
    v["S2"] = (v3(not sc, len(sig) >= MIN_PROBE_SIG),
               f"{len(sc)} SILAC calls on {len(pr)} isotope-probe runs ({len(sig)} with a SILAC spacing >= {PAIRS} pairs and ratio >= {RATIO:g}) {' '.join(sc)}")
    nw = [i for i in ids if cand[i]["outcome"] == "wrong" and base.get(i, {}).get("outcome") != "wrong"]
    v["P-S1"] = (v3(not nw, True), f"{len(nw)} runs wrong with the candidate and not with the baseline, of {len(ids)} {' '.join(nw)}")
    si = [i for i in ids if cand[i]["truth"] == "SILAC" and it(i)]
    gc = sum(cand[i]["outcome"] == "correct" for i in si); gb = sum(base.get(i, {}).get("outcome") == "correct" for i in si)
    v["E1"] = (v3(gc - gb >= E1_GAIN, len(si) >= MIN_E1), f"{gc} - {gb} = {gc - gb} correct (candidate - baseline) on {len(si)} SILAC runs with ion-trap MS2")
    s = [i for i in ids if cand[i]["truth"] == "SILAC"]; k = sum(cand[i]["outcome"] == "correct" for i in s)
    v["R-SILAC"] = (v3(bool(s) and k / len(s) >= R_SILAC, len(s) >= MIN_SILAC), f"{k} of {len(s)}" + (f" = {k / len(s):.3f}" if s else ""))
    lab = [i for i in ids if cand[i]["truth"] != "label-free"]; fl = [i for i in lab if cand[i]["call"] == "label-free"]
    v["F"] = (v3(not lab or len(fl) / len(lab) <= F_MAX, len(lab) >= MIN_LAB),
              f"{len(fl)} of {len(lab)} labelled runs called label-free" + (f" = {len(fl) / len(lab):.3f}" if lab else "") + f" {' '.join(fl)}")
    v["candidate overall"] = (overall([x[0] for x in v.values()]), "")
    no = [i for i in ids if ld.get(i, {}).get("silac_single", "no") == "no"]
    ch = [i for i in no if i in base and cand[i]["call"] != base[i]["call"]]
    rep["I1 (reported)"] = (v3(not ch, True), f"{len(ch)} class changes baseline -> candidate on {len(no)} runs with silac_single = no {' '.join(ch)}")
    for sub in SUBS:
        x = [i for i in s if man[i].get("silac_sub") == sub]
        if not x: continue
        t = lambda arm: "/".join(str(sum(arm.get(i, {}).get("outcome") == o for i in x)) for o in ("correct", "no_call", "wrong"))
        rep[f"D1 {sub} (reported)"] = ("-", f"{len(x)} runs; right/no call/wrong baseline {t(base)}, candidate {t(cand)}")
    vt = [i for i in ids if ld.get(i, {}).get("silac_site_veto", "-") not in ("-", "")]
    byc = collections.Counter(("probe" if probe(i) else cand[i]["truth"]) for i in vt)
    sv = [f"{i} ({ld[i]['silac_site_veto']}; {cand[i]['outcome']})" for i in vt if cand[i]["truth"] == "SILAC"]
    rep["V1 (reported)"] = ("-", f"{len(vt)} runs with silac_site_veto: {dict(sorted(byc.items()))}; SILAC runs among them: {', '.join(sv) or 'none'}")
    return v, rep
def load(d): return {r["id"]: r for r in csv.DictReader(open(d + "/per_run.tsv"), delimiter="\t")}
def selftest():
    def row(t, call, labels=None):
        return dict(truth=t, call=call, labels=labels or call, outcome="correct" if call == t else "no_call" if call == "no call" else "wrong")
    man, c, b, ld = {}, {}, {}, {}
    def add(i, t, cc, bc, ms2="IT", probe="no", sub="-", kv=None, cl=None):
        man[i] = dict(ms2_analyzer=ms2, probe=probe, silac_sub=sub); c[i] = row(t, cc, cl); b[i] = row(t, bc); ld[i] = kv or {"silac_single": "no", "silac_site_veto": "-"}
    for n in range(40): add(f"lf{n}", "label-free", "label-free", "label-free", "IT" if n < 20 else "FT")
    sigkv = {"lys6arg6_pairs": "300", "control_pairs": "5", "silac_single": "no", "silac_site_veto": "K:Lys6"}
    for n in range(8): add(f"pr{n}", "label-free", "label-free", "label-free", "FT", "yes", kv=sigkv)
    for n in range(30): add(f"si{n}", "SILAC", "SILAC" if n < 25 else "no call", "SILAC" if n < 21 else "no call", "IT" if 10 <= n < 25 else "FT", sub=SUBS[n % 2],
                            kv={"silac_single": "yes" if 21 <= n < 25 else "no", "silac_site_veto": "-"})
    for n in range(60): add(f"tm{n}", "TMT", "TMT", "TMT", "FT")
    v, r = decide(man, c, b, ld)
    assert [v[k][0] for k in ("S1", "S2", "P-S1", "E1", "R-SILAC", "F", "candidate overall")] == ["PASS"] * 7, v
    assert r["I1 (reported)"][0] == "PASS" and "8 runs with silac_site_veto" in r["V1 (reported)"][1], r
    c["pr0"] = row("label-free", "mixed", "K:Lys6+unknown:C+6.0"); v, _ = decide(man, c, b, ld); assert v["S2"][0] == "FAIL" and v["P-S1"][0] == "FAIL"
    c["pr0"] = row("label-free", "label-free"); ld["pr7"] = {}; v, _ = decide(man, c, b, ld); assert v["S2"][0] == "INCONCLUSIVE" and v["candidate overall"][0] == "INCONCLUSIVE"
    ld["pr7"] = sigkv; c["lf0"] = row("label-free", "SILAC", "K:Lys8"); b["lf0"] = c["lf0"]; v, _ = decide(man, c, b, ld)
    assert v["S1"][0] == "FAIL" and v["P-S1"][0] == "PASS" and v["candidate overall"][0] == "FAIL"
    c["lf0"] = b["lf0"] = row("label-free", "label-free"); c["si24"] = row("SILAC", "no call"); v, _ = decide(man, c, b, ld); assert v["E1"][0] == "PASS"
    c["si23"] = row("SILAC", "no call"); v, _ = decide(man, c, b, ld); assert v["E1"][0] == "FAIL", v["E1"]
    for n in range(20, 25): c[f"si{n}"] = row("SILAC", "no call")
    v, _ = decide(man, c, b, ld); assert v["R-SILAC"][0] == "FAIL"
    for n in range(20, 25): c[f"si{n}"] = row("SILAC", "SILAC")
    for n in range(5): c[f"tm{n}"] = row("TMT", "label-free")
    v, r = decide(man, c, b, ld); assert v["F"][0] == "FAIL" and r["I1 (reported)"][0] == "FAIL"
    assert silac_token("R:Arg10") and silac_token("ambiguous:x+K:Lys6") and not silac_token("unknown:C+6.0201") and not silac_token("label-free")
    print("selftest ok")
if __name__ == "__main__":
    if sys.argv[1] == "--selftest": selftest(); sys.exit()
    manp, dc, db, runs, out = sys.argv[1:6]
    man = {r["id"]: r for r in csv.DictReader((l for l in open(manp) if not l.startswith("# ")), delimiter="\t") if r["include"] == "yes"}
    cand, base = load(dc), load(db)
    ld = {i: ld_rows(f"{runs}/{i}/ld.tsv") for i in man}
    v, rep = decide(man, cand, base, ld)
    fails = [i for i in man if cand.get(i, {}).get("reason") in ("run_failed", "run_missing") or base.get(i, {}).get("reason") in ("run_failed", "run_missing")]
    with open(out, "w") as o:
        o.write("| criterion | verdict | numbers |\n|---|---|---|\n")
        for k, (x, n) in list(v.items()) + list(rep.items()): o.write(f"| {k} | {x} | {n} |\n")
        o.write(f"\nRuns: {len(man)} included; technical failures (counted as no call): {len(fails)} {' '.join(fails)}\n")
    print(open(out).read())
