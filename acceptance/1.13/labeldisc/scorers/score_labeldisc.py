#!/usr/bin/env python3
"""Label discovery scorer (PREREG-labeldisc.md): scores `ld_call` of -label_discovery_out against the SDRF truth,
beside -label_out's `label_call` from the same FASTag run and the majority baseline.

Manifest: TSV with columns id, pxd, label_class, include (rows with include = yes are scored).
Runs root: <root>/<id>/{rc.txt, ld.tsv, label.tsv}; <root>/inputs_verified.tsv (id, result) when present (an input
whose result is not OK counts as a no call for both methods).

Classes. Truth: label_class, with TMTpro and iTRAQ8 one class ("TMTpro/iTRAQ8"). A call's tokens are the
`+`-separated labels of `ld_call labels` (an `unknown:<site>+<mass>` token is one token; a site prefix K:, R:, N:,
C: is dropped). Token class by name: contains TMTpro or iTRAQ8 -> TMTpro/iTRAQ8 (also an ambiguous or
isobaric_ambiguous pair of the two); TMT (TMT6plex, TMT10plex, ...) -> TMT; iTRAQ4 -> iTRAQ4; Lys<n>, Arg<n> or a
Unimod SILAC name (Label:13C..., Label:2H..., Label:15N...) -> SILAC; Dimethyl... -> dimethyl; anything else
(unknown:, other Unimod names) -> other.
  ld class: `no call` unless status = call; `label-free` for the label `label-free`; else the class of the tokens
  when they all have one class, `mixed` otherwise (mixed is never correct).
  label_call class: `label_call label` when status = call (TMTpro -> TMTpro/iTRAQ8), else `no call`.
  A failed or missing run (rc != 0, no report) is a no call.
Endpoints (each set scored once):
  P1 (primary, safety): false label calls on label-free truth runs = runs with ld status call and a label other
     than label-free. PASS iff 0. Reported with the Clopper-Pearson 95% interval (two-sided) and the one-sided
     95% upper bound.
  P2 (primary): correct(ld) >= correct(majority baseline), the baseline calling every run the most frequent
     truth class of the set.
  P3 (primary): correct(ld) >= correct(label_call) on the same runs (paired).
Descriptive: Wilson 95% intervals, confusion, per-class recall, lenient correctness (the truth class among the
tokens' classes), discordant pairs with the exact two-sided sign test, no-call reasons, the TMTpro/iTRAQ8 names.
Usage: score_labeldisc.py <manifest> <runs root> <out dir> <set name>"""
import csv
import json
import math
import os
import re
import sys

man, runs, out, setname = sys.argv[1:5]


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


def tclass(t):
    return "TMTpro/iTRAQ8" if t in ("TMTpro", "iTRAQ8") else t


def tokens(l):
    out, cur = [], ""
    for p in l.split("+"):
        if re.search(r"(^|:)unknown:[NKRC]$", cur) or re.fullmatch(r"unknown:[NKRC]", cur): cur += "+" + p
        else:
            if cur: out.append(cur)
            cur = p
    if cur: out.append(cur)
    return out


def tokclass(x):
    x = re.sub(r"^[NKRC]:", "", x)
    if x.startswith("unknown:"): return "other"
    if "TMTpro" in x or "iTRAQ8" in x: return "TMTpro/iTRAQ8"
    if "TMT" in x: return "TMT"
    if "iTRAQ4" in x: return "iTRAQ4"
    if re.fullmatch(r"(Lys|Arg)\d+", x) or re.match(r"Label:(13C|2H|15N)", x): return "SILAC"
    if x.startswith("Dimethyl"): return "dimethyl"
    return "other"


def kv(p, sec):
    d = {}
    try:
        for line in open(p, encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if len(f) >= 3 and f[0] == sec: d[f[1]] = f[2]
    except OSError:
        return None
    return d


rows = [r for r in csv.DictReader((l for l in open(man) if not l.startswith("# ")), delimiter="\t") if r["include"] == "yes"]
verified = {}
vf = f"{runs}/inputs_verified.tsv"
if os.path.exists(vf):
    for v in csv.DictReader(open(vf), delimiter="\t"): verified[v["id"]] = v["result"]
res = []
for r in rows:
    d = f"{runs}/{r['id']}"
    truth = tclass(r["label_class"])
    e = dict(id=r["id"], pxd=r["pxd"], truth=truth, ld_status="-", ld_labels="-", ld_reason="-", ld_class="no call",
             ld_token_classes="-", lc_class="no call", note="")
    if vf and os.path.exists(vf) and verified.get(r["id"]) != "OK":
        e["note"] = "input_not_verified"; res.append(e); continue
    try:
        rc = int(open(f"{d}/rc.txt").read().strip())
    except (OSError, ValueError):
        e["note"] = "not_run"; res.append(e); continue
    if rc != 0:
        e["note"] = f"rc_{rc}"; res.append(e); continue
    ld = kv(f"{d}/ld.tsv", "ld_call") or {}
    e["ld_status"], e["ld_labels"], e["ld_reason"] = ld.get("status", "-"), ld.get("labels", "-"), ld.get("reason", "-")
    if e["ld_status"] == "call":
        if e["ld_labels"] == "label-free": e["ld_class"] = "label-free"
        else:
            cs = [tokclass(t) for t in tokens(e["ld_labels"])]
            e["ld_token_classes"] = ",".join(cs)
            e["ld_class"] = cs[0] if len(set(cs)) == 1 else "mixed"
    lc = kv(f"{d}/label.tsv", "label_call") or {}
    if lc.get("status") == "call": e["lc_class"] = tclass(lc.get("label", "-"))
    res.append(e)

n = len(res)
truths = [e["truth"] for e in res]
classes = sorted(set(truths))
maj_class = max(classes, key=lambda c: (truths.count(c), c)) if classes else "-"
ok_ld = [e["ld_class"] == e["truth"] for e in res]
ok_lc = [e["lc_class"] == e["truth"] for e in res]
ok_mj = [e["truth"] == maj_class for e in res]
lenient = [e["ld_class"] == e["truth"] or (e["truth"] in e["ld_token_classes"].split(",")) for e in res]
lf = [e for e in res if e["truth"] == "label-free"]
fp = [e for e in lf if e["ld_status"] == "call" and e["ld_labels"] != "label-free"]
ci2, up1 = clopper(len(fp), len(lf))
a = sum(1 for x, y in zip(ok_ld, ok_lc) if x and not y)
b = sum(1 for x, y in zip(ok_ld, ok_lc) if y and not x)
am = sum(1 for x, y in zip(ok_ld, ok_mj) if x and not y)
bm = sum(1 for x, y in zip(ok_ld, ok_mj) if y and not x)
conf = {}
for e in res: conf.setdefault(e["truth"], {}).setdefault(e["ld_class"], 0); conf[e["truth"]][e["ld_class"]] += 1
S = dict(set=setname, n=n, majority_class=maj_class,
         P1=dict(label_free_runs=len(lf), false_label_calls=len(fp), rate=round(len(fp) / len(lf), 4) if lf else None,
                 clopper_pearson_95=ci2, one_sided_upper_95=up1, verdict="PASS" if lf and not fp else ("FAIL" if lf else "NA"),
                 runs=[f"{e['id']}:{e['ld_labels']}" for e in fp]),
         P2=dict(correct_ld=sum(ok_ld), correct_majority=sum(ok_mj), verdict="PASS" if sum(ok_ld) >= sum(ok_mj) else "FAIL",
                 discordant_ld_only=am, discordant_majority_only=bm, sign_p=round(sign_p(am, bm), 4)),
         P3=dict(correct_ld=sum(ok_ld), correct_label_call=sum(ok_lc), verdict="PASS" if sum(ok_ld) >= sum(ok_lc) else "FAIL",
                 discordant_ld_only=a, discordant_label_call_only=b, sign_p=round(sign_p(a, b), 4)),
         accuracy=dict(ld=[sum(ok_ld), n, wilson(sum(ok_ld), n)], label_call=[sum(ok_lc), n, wilson(sum(ok_lc), n)],
                       majority=[sum(ok_mj), n, wilson(sum(ok_mj), n)], ld_lenient=[sum(lenient), n]),
         recall={c: dict(ld=sum(1 for e, o in zip(res, ok_ld) if e["truth"] == c and o),
                         label_call=sum(1 for e, o in zip(res, ok_lc) if e["truth"] == c and o), n=truths.count(c)) for c in classes},
         confusion=conf,
         no_call_reasons={k: sum(1 for e in res if e["ld_class"] == "no call" and (e["ld_reason"] if e["note"] == "" else e["note"]) == k)
                          for k in sorted({(e["ld_reason"] if e["note"] == "" else e["note"]) for e in res if e["ld_class"] == "no call"})},
         isobaric_names=sorted({e["ld_labels"] for e in res if e["truth"] == "TMTpro/iTRAQ8"}))
os.makedirs(out, exist_ok=True)
with open(f"{out}/summary_{setname}.json", "w") as f: json.dump(S, f, indent=1, sort_keys=True)
with open(f"{out}/per_run_{setname}.tsv", "w") as f:
    cols = list(res[0].keys()) if res else []
    f.write("\t".join(cols + ["ld_correct", "lc_correct"]) + "\n")
    for e, x, y in zip(res, ok_ld, ok_lc): f.write("\t".join([str(e[c]) for c in cols] + [str(x), str(y)]) + "\n")
print(json.dumps({k: S[k] for k in ("set", "n", "P1", "P2", "P3")}, indent=1))
