#!/usr/bin/env python3
"""Label discovery held-out test 3 scorer (PREREG-labeldisc3.md). Scores `ld_call` of -label_discovery_out (format 3)
against the audited truth, beside Param-Medic on the same files and the "always label-free" baseline.

Manifest: TSV (lines starting "# " skipped) with id, label_class, include and, when present, ms2_analyzer, acquisition,
digestion, cell; rows with include = yes are scored. Runs root: <root>/<id>/{rc.txt, ld.tsv}.
Param-Medic table (optional, "-" for none): TSV id, pm_class (label-free, TMT, iTRAQ4, iTRAQ8, SILAC, mixed, failed).

Truth classes: label-free, TMT, TMTpro, iTRAQ4, iTRAQ8, SILAC, dimethyl. TMTpro and iTRAQ8 are separate classes.
Call class: `no call` when rc != 0, the report is missing or status is not `call`; `label-free` for the label
label-free; otherwise the class of the `+`-separated tokens (site prefix dropped) when all tokens have one class,
else `mixed`. Token class: ambiguous... -> ambiguous; unknown:... -> other; TMTpro -> TMTpro; iTRAQ8 -> iTRAQ8;
iTRAQ4 -> iTRAQ4; TMT... -> TMT; Lys<n>, Arg<n>, Label:13C/2H/15N... -> SILAC; Dimethyl... -> dimethyl; else other.
Outcome of a run: correct (call class = truth), no_call, wrong (any other call; mixed and ambiguous are wrong).
Family (for the Param-Medic comparison): TMT and TMTpro -> TMT family; iTRAQ4 and iTRAQ8 -> iTRAQ family; others as is.

Criteria (thresholds fixed in the PREREG):
  S1  wrong calls on label-free truth runs (a call that is not label-free) = 0
  A1  0.8 * accuracy(label-free runs) + 0.2 * accuracy(labelled runs) > 0.80   (always label-free scores 0.80)
  A2  family-correct(FASTag) >= family-correct(Param-Medic, with a SILAC call on a dimethyl run counted correct)
  R   strict recall: TMT >= 0.80, TMTpro >= 0.80, iTRAQ4+iTRAQ8 >= 0.80, SILAC >= 0.60, dimethyl >= 0.50
  F   labelled runs called label-free / labelled runs <= 0.05
Usage: score_labeldisc3.py <manifest> <runs root> <param-medic tsv or -> <out dir>
Writes per_run.tsv, summary.json, tables.md."""
import csv, json, math, os, re, sys, collections

def wilson(k, n, z=1.959964):
    if n == 0: return [None, None]
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 4), round(c + h, 4)]


def betainv(p, a, b):
    # inverse of the regularised incomplete beta by bisection (exact enough for a bound)
    def ibeta(x):
        # continued fraction (Numerical Recipes betacf)
        if x <= 0: return 0.0
        if x >= 1: return 1.0
        lbt = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x)
        def cf(x, a, b):
            qab, qap, qam = a + b, a + 1, a - 1
            c, d = 1.0, 1 - qab * x / qap
            d = 1 / (d if abs(d) > 1e-300 else 1e-300); h = d
            for m in range(1, 1000):
                m2 = 2 * m
                aa = m * (b - m) * x / ((qam + m2) * (a + m2))
                d = 1 + aa * d; d = 1 / (d if abs(d) > 1e-300 else 1e-300)
                c = 1 + aa / c if abs(1 + aa / c) > 1e-300 else 1e-300; h *= d * c
                aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
                d = 1 + aa * d; d = 1 / (d if abs(d) > 1e-300 else 1e-300)
                c = 1 + aa / c if abs(1 + aa / c) > 1e-300 else 1e-300
                de = d * c; h *= de
                if abs(de - 1) < 1e-15: break
            return h
        if x < (a + 1) / (a + b + 2): return math.exp(lbt) * cf(x, a, b) / a
        return 1 - math.exp(lbt) * cf(1 - x, b, a) / b
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if ibeta(mid) < p: lo = mid
        else: hi = mid
    return (lo + hi) / 2


def clopper(k, n, alpha=0.05):
    if n == 0: return [None, None], None
    lo = 0.0 if k == 0 else betainv(alpha / 2, k, n - k + 1)
    hi = 1.0 if k == n else betainv(1 - alpha / 2, k + 1, n - k)
    up1 = 1.0 if k == n else betainv(1 - alpha, k + 1, n - k)
    return [round(lo, 4), round(hi, 4)], round(up1, 4)


def sign_p(a, b):
    n, k = a + b, min(a, b)
    if n == 0: return 1.0
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)


LABELLED = ["TMT", "TMTpro", "iTRAQ4", "iTRAQ8", "SILAC", "dimethyl"]
CLASSES = ["label-free"] + LABELLED
FAMILY = {"TMT": "TMT family", "TMTpro": "TMT family", "iTRAQ4": "iTRAQ family", "iTRAQ8": "iTRAQ family"}
fam = lambda c: FAMILY.get(c, c)


def tokens(l):
    out, cur = [], ""
    for p in l.split("+"):
        if re.search(r"(^|:)unknown:[NKRC]$", cur): cur += "+" + p
        else:
            if cur: out.append(cur)
            cur = p
    if cur: out.append(cur)
    return out


def tokclass(x):
    if x.startswith("ambiguous") or x.startswith("isobaric_ambiguous"): return "ambiguous"
    x = re.sub(r"^[NKRC]:", "", x)
    if x.startswith("unknown:"): return "other"
    if "TMTpro" in x: return "TMTpro"
    if "iTRAQ8" in x: return "iTRAQ8"
    if "iTRAQ4" in x: return "iTRAQ4"
    if x.startswith("TMT"): return "TMT"
    if re.match(r"(Lys|Arg)\d", x) or re.match(r"Label:(13C|2H|15N)", x): return "SILAC"
    if x.startswith("Dimethyl"): return "dimethyl"
    return "other"


def read_call(d):
    """-> (call class, labels, basis, reason, reporter gate)"""
    try: rc = open(f"{d}/rc.txt").read().strip()
    except OSError: return "no call", "-", "-", "run_missing", "-"
    if rc != "0" or not os.path.exists(f"{d}/ld.tsv"): return "no call", "-", "-", "run_failed", "-"
    kv = {}
    for l in open(f"{d}/ld.tsv"):
        c = l.rstrip("\n").split("\t")
        if len(c) >= 3 and c[0] in ("ld_call", "ld_reporter"): kv[(c[0], c[1])] = c[2]
    g = kv.get(("ld_reporter", "gate"), "-"); labels = kv.get(("ld_call", "labels"), "-")
    basis, reason = kv.get(("ld_call", "basis"), "-"), kv.get(("ld_call", "reason"), "-")
    if kv.get(("ld_call", "status")) != "call": return "no call", labels, basis, reason if reason != "-" else "no_call", g
    if labels == "label-free": return "label-free", labels, basis, reason, g
    cs = {tokclass(t) for t in tokens(labels)}
    return (cs.pop() if len(cs) == 1 else "mixed"), labels, basis, reason, g


def outcome(truth, call):
    return "correct" if call == truth else "no_call" if call == "no call" else "wrong"


def main(man, runs, pmp, out):
    os.makedirs(out, exist_ok=True)
    rows = [r for r in csv.DictReader((l for l in open(man) if not l.startswith("# ")), delimiter="\t")
            if r["include"] == "yes" and r["label_class"] in CLASSES]
    pm = {}
    if pmp != "-":
        for r in csv.DictReader(open(pmp), delimiter="\t"): pm[r["id"]] = r["pm_class"]
    per = []
    for r in rows:
        call, labels, basis, reason, gate = read_call(f"{runs}/{r['id']}")
        t = r["label_class"]; p = pm.get(r["id"], "failed") if pm else "-"
        per.append(dict(id=r["id"], truth=t, call=call, outcome=outcome(t, call), labels=labels, basis=basis, reason=reason, gate=gate,
                        fam_correct=int(call != "no call" and fam(call) == fam(t)),
                        pm_class=p, pm_fam_correct=int(fam(p) == fam(t)), pm_fam_correct_generous=int(fam(p) == fam(t) or (t == "dimethyl" and p == "SILAC")),
                        ms2_analyzer=r.get("ms2_analyzer", "-"), acquisition=r.get("acquisition", "-"), digestion=r.get("digestion", "-"), cell=r.get("cell", "-")))
    cols = list(per[0]) if per else []
    with open(f"{out}/per_run.tsv", "w") as o:
        o.write("\t".join(cols) + "\n")
        for p in per: o.write("\t".join(str(p[c]) for c in cols) + "\n")

    def tally(sub):
        n = len(sub); c = collections.Counter(p["outcome"] for p in sub)
        return dict(n=n, correct=c["correct"], no_call=c["no_call"], wrong=c["wrong"], recall=round(c["correct"] / n, 4) if n else None,
                    wilson95=wilson(c["correct"], n), called_label_free=sum(p["call"] == "label-free" and p["truth"] != "label-free" for p in sub))
    lf = [p for p in per if p["truth"] == "label-free"]; lab = [p for p in per if p["truth"] != "label-free"]
    S = dict(n=len(per), by_class={c: tally([p for p in per if p["truth"] == c]) for c in CLASSES})
    # S1
    w = [p for p in lf if p["outcome"] == "wrong"]; ci, up = clopper(len(w), len(lf))
    S["S1"] = dict(label_free_runs=len(lf), wrong_calls=len(w), clopper95=ci, upper95_one_sided=up, runs=[p["id"] for p in w], **{"pass": len(lf) > 0 and not w})
    # A1
    al = sum(p["outcome"] == "correct" for p in lf) / len(lf) if lf else 0.0; ab = sum(p["outcome"] == "correct" for p in lab) / len(lab) if lab else 0.0
    wa = 0.8 * al + 0.2 * ab
    S["A1"] = dict(accuracy_label_free=round(al, 4), accuracy_labelled=round(ab, 4), weighted=round(wa, 4), always_label_free=0.8,
                   raw_correct=sum(p["outcome"] == "correct" for p in per), raw_always_label_free=len(lf), **{"pass": wa > 0.80})
    # A2
    if pm:
        a = sum(p["fam_correct"] for p in per); b = sum(p["pm_fam_correct_generous"] for p in per)
        d1 = sum(p["fam_correct"] and not p["pm_fam_correct_generous"] for p in per); d2 = sum(p["pm_fam_correct_generous"] and not p["fam_correct"] for p in per)
        S["A2"] = dict(fastag_family_correct=a, param_medic_family_correct_generous=b, param_medic_family_correct_strict=sum(p["pm_fam_correct"] for p in per),
                       fastag_only=d1, param_medic_only=d2, sign_test_p=round(sign_p(d1, d2), 5), param_medic_failed=sum(p["pm_class"] == "failed" for p in per),
                       by_class={c: dict(n=sum(p["truth"] == c for p in per), fastag=sum(p["fam_correct"] for p in per if p["truth"] == c),
                                         param_medic=sum(p["pm_fam_correct_generous"] for p in per if p["truth"] == c)) for c in CLASSES},
                       **{"pass": a >= b})
    else: S["A2"] = dict(**{"pass": None})
    # R
    it = tally([p for p in per if p["truth"] in ("iTRAQ4", "iTRAQ8")])
    R = {"TMT": (S["by_class"]["TMT"], 0.80), "TMTpro": (S["by_class"]["TMTpro"], 0.80), "iTRAQ4+iTRAQ8": (it, 0.80),
         "SILAC": (S["by_class"]["SILAC"], 0.60), "dimethyl": (S["by_class"]["dimethyl"], 0.50)}
    S["R"] = {k: dict(n=t["n"], correct=t["correct"], no_call=t["no_call"], wrong=t["wrong"], recall=t["recall"], threshold=th,
                      **{"pass": t["n"] > 0 and t["recall"] >= th}) for k, (t, th) in R.items()}
    S["R"]["pass"] = all(v["pass"] for v in S["R"].values())
    # F
    fl = [p for p in lab if p["call"] == "label-free"]; ci, up = clopper(len(fl), len(lab))
    S["F"] = dict(labelled_runs=len(lab), called_label_free=len(fl), rate=round(len(fl) / len(lab), 4) if lab else None, clopper95=ci,
                  by_basis=dict(collections.Counter(p["basis"] for p in fl)), by_class=dict(collections.Counter(p["truth"] for p in fl)),
                  runs=[p["id"] for p in fl], **{"pass": bool(lab) and len(fl) / len(lab) <= 0.05})
    S["no_call_reasons"] = dict(collections.Counter(p["reason"] for p in per if p["outcome"] == "no_call"))
    S["confusion"] = {t: dict(collections.Counter(p["call"] for p in per if p["truth"] == t)) for t in CLASSES}
    S["strata"] = {k: {v: {c: tally([p for p in per if p[k] == v and p["truth"] == c]) for c in CLASSES if any(p[k] == v and p["truth"] == c for p in per)}
                       for v in sorted({p[k] for p in per})} for k in ("ms2_analyzer", "acquisition", "digestion", "cell")}
    json.dump(S, open(f"{out}/summary.json", "w"), indent=1)
    with open(f"{out}/tables.md", "w") as o:
        o.write("| criterion | value | pass |\n|---|---|---|\n")
        o.write(f"| S1 wrong calls on label-free runs | {S['S1']['wrong_calls']} of {S['S1']['label_free_runs']} (one-sided 95 % bound {S['S1']['upper95_one_sided']}) | {S['S1']['pass']} |\n")
        o.write(f"| A1 weighted accuracy | {S['A1']['weighted']} (label-free {S['A1']['accuracy_label_free']}, labelled {S['A1']['accuracy_labelled']}) | {S['A1']['pass']} |\n")
        if pm: o.write(f"| A2 family-correct, FASTag vs Param-Medic | {S['A2']['fastag_family_correct']} vs {S['A2']['param_medic_family_correct_generous']} of {len(per)} | {S['A2']['pass']} |\n")
        for k, v in S["R"].items():
            if k != "pass": o.write(f"| R recall {k} (>= {v['threshold']}) | {v['correct']} of {v['n']} = {v['recall']}; no call {v['no_call']}, wrong {v['wrong']} | {v['pass']} |\n")
        o.write(f"| F labelled runs called label-free (<= 0.05) | {S['F']['called_label_free']} of {S['F']['labelled_runs']} = {S['F']['rate']} | {S['F']['pass']} |\n")
        def table(title, d):
            o.write(f"\n{title}\n\n| truth | runs | correct | no call | wrong | called label-free |\n|---|---|---|---|---|---|\n")
            for c, t in d.items(): o.write(f"| {c} | {t['n']} | {t['correct']} | {t['no_call']} | {t['wrong']} | {t['called_label_free'] if c != 'label-free' else '-'} |\n")
        table("All runs", {c: t for c, t in S["by_class"].items() if t["n"]})
        for k, d in S["strata"].items():
            for v, dd in d.items(): table(f"{k} = {v}", dd)
    return S


def selftest():
    assert tokens("TMT+K:TMT") == ["TMT", "K:TMT"] and tokens("unknown:N+229.1+K:Lys8") == ["unknown:N+229.1", "K:Lys8"]
    assert [tokclass(t) for t in ("K:TMT", "TMTpro", "iTRAQ8plex", "K:iTRAQ4", "R:Arg10", "Dimethyl:2H(4)", "ambiguous:iTRAQ8plex|TMTpro", "unknown:K+1.0")] == \
        ["TMT", "TMTpro", "iTRAQ8", "iTRAQ4", "SILAC", "dimethyl", "ambiguous", "other"]
    assert outcome("TMT", "TMTpro") == "wrong" and outcome("SILAC", "no call") == "no_call" and outcome("iTRAQ8", "iTRAQ8") == "correct"
    assert fam("TMTpro") == fam("TMT") != fam("iTRAQ8")


if __name__ == "__main__":
    selftest()
    if len(sys.argv) == 5:
        S = main(*sys.argv[1:5])
        print(json.dumps({k: S[k] for k in ("n", "S1", "A1", "A2", "R", "F")}, indent=1))
