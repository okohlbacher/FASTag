#!/usr/bin/env python3
"""Score the FASTag 1.13 #17 held-out test (PREREG-item17.md): -search_shifts vs the closed search.

Input: one or more searches.tsv (run_item17.sh), columns run arm(base|cand) engine(sage|comet) result config shifts
open. Output dir: cells.tsv (one row per run x engine), peaks.tsv (open-search top-10 peaks per run x engine with
the recovery call), verdict.tsv (criteria per engine and the item verdict).

PSMs (unchanged from the DEV scorer acceptance/1.12/dev/engines/scripts/score.py): rank-1 PSMs at 1 % PSM FDR
(Sage spectrum_q <= 0.01, decoys label -1 / rev_; Comet target-decoy q over rank-1 e-values, DECOY_ proteins).
Target = not all proteins ENTRAP_ (and not decoy); entrapment = all proteins ENTRAP_. FDP = 2 E / (T + E) (r = 1),
fdp_ub = 2 x one-sided 95 % Clopper-Pearson upper bound of E / (T + E). Peptides: distinct stripped, I -> L.

Criteria per engine (4 held-out runs):
  P1 gain: psm_t(cand) >= 1.02 psm_t(base) on >= 3 of 4 runs.
  P2 fdp:  fdp(cand) <= 0.015 on every run.
  P3 loss: psm_t(cand) >= 0.99 psm_t(base) on every run.
  P4 open-search recovery: on >= 3 of 4 runs, recovered >= ceil(0.6 n) of the n (<= 10) top open-search peaks;
           a run with n < 5 peaks is not evaluable for P4; fewer than 3 evaluable runs -> P4 INCONCLUSIVE.
  Engine verdict: FAIL if P1, P2 or P3 fails or P4 fails; INCONCLUSIVE if P1-P3 pass and P4 is INCONCLUSIVE;
  else PASS. Item verdict: PASS if both engines PASS; FAIL if any engine FAILs; else INCONCLUSIVE.

Open-search peaks (MSFragger 4.4.1 tsv of the run, same chemistry as base): rank-1 PSMs, target-decoy q over
expectscore (decoy = every protein rev_), q <= 0.01, targets only; x = massdiff. Histogram of x in 0.002 Da bins
(bin b covers [0.002 b, 0.002 (b+1))), smoothed S(b) = sum of counts b-5..b+5. Apex bins: S(b) > 0 and S(b) is the
maximum of S over b-10..b+10 (ties: the lowest such b). Peak members: PSMs with |x - centre(b)| <= 0.02; centroid =
median of members; count = members. Peaks with |centroid| < 0.05 Da (the unshifted peak) are dropped. Peaks are
taken by count desc (ties |centroid| asc); a peak whose centroid lies within 0.04 Da of an already taken peak is
skipped; at most 10 taken, each with count >= 5.
Recovered: the cand configuration searches a NEW mass m with |centroid - m| <= 0.02 Da. New masses = cand variable
modification masses not in base (|d| > 1e-4), cand static masses that differ from base on the same site (the
difference), Comet mass offsets != 0, and k x 1.0033548 for base_iso < k <= cand_iso (precursor isotope errors).
Single masses only: a peak at the sum of two searched masses is not counted as recovered.
Usage: score_item17.py <out dir> <searches.tsv> [<searches.tsv> ...]
       score_item17.py --selftest"""
import csv, json, math, os, re, sys

ISO = 1.0033548
csv.field_size_limit(1 << 30)


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
            out.append((r["scannr"], strip(r["peptide"]), prots, k))
    return out


def qfilter(rows, q=0.01):
    """rows: (score_lower_is_better, is_decoy, payload); returns payloads of targets at q <= 0.01."""
    rows = sorted(rows, key=lambda x: x[0])
    d = t = 0; qs = []
    for r in rows:
        if r[1]: d += 1
        else: t += 1
        qs.append(d / max(t, 1))
    for i in range(len(qs) - 2, -1, -1):
        qs[i] = min(qs[i], qs[i + 1])
    return [r[2] for r, qq in zip(rows, qs) if qq <= q and not r[1]]


def comet(path):
    rows = []
    with open(path) as f:
        f.readline()
        for r in csv.DictReader(f, delimiter="\t"):
            if r["num"] != "1": continue
            prots = [x for x in r["protein"].split(",") if x]
            k = kind(prots, "DECOY_")
            rows.append((float(r["e-value"]), k == "d", (r["scan"], strip(r["plain_peptide"]), prots, k)))
    return qfilter(rows)


def msfragger(path):
    rows = []
    with open(path) as f:
        rd = csv.DictReader(f, delimiter="\t")
        pc = "proteins" if "proteins" in rd.fieldnames else "protein"
        for r in rd:
            if r.get("hit_rank", "1") not in ("1", ""): continue
            prots = [x for x in re.split(r"[;,]", r[pc]) if x.strip()]
            dec = all(x.strip().startswith("rev_") for x in prots) if prots else False
            rows.append((float(r["expectscore"]), dec, float(r["massdiff"])))
    return qfilter(rows)


def peaks(xs, top=10, min_count=5):
    W = 0.002
    cnt = {}
    for x in xs:
        b = math.floor(x / W)
        cnt[b] = cnt.get(b, 0) + 1
    if not cnt: return []
    lo, hi = min(cnt) - 10, max(cnt) + 10
    S = {}
    for b in range(lo - 10, hi + 11):
        S[b] = sum(cnt.get(i, 0) for i in range(b - 5, b + 6))
    apex = []
    for b in range(lo, hi + 1):
        if S[b] <= 0: continue
        win = [S[i] for i in range(b - 10, b + 11)]
        if S[b] < max(win): continue
        if any(S[i] == S[b] for i in range(b - 10, b)): continue
        apex.append(b)
    xs_sorted = sorted(xs)
    import bisect
    cand = []
    for b in apex:
        c = (b + 0.5) * W
        i, j = bisect.bisect_left(xs_sorted, c - 0.02), bisect.bisect_right(xs_sorted, c + 0.02)
        mem = xs_sorted[i:j]
        if not mem: continue
        n = len(mem)
        med = mem[n // 2] if n % 2 else (mem[n // 2 - 1] + mem[n // 2]) / 2
        if abs(med) < 0.05: continue
        cand.append((n, med))
    cand.sort(key=lambda p: (-p[0], abs(p[1])))
    out = []
    for n, med in cand:
        if n < min_count or len(out) >= top: break
        if any(abs(med - m) <= 0.04 for _, m in out): continue
        out.append((n, med))
    return out


def sage_masses(path):
    d = json.load(open(path))
    db = d["database"]
    static = {k: float(v) for k, v in db.get("static_mods", {}).items()}
    var = []
    for k, vs in db.get("variable_mods", {}).items():
        for v in (vs if isinstance(vs, list) else [vs]):
            var.append(float(v))
    iso = d.get("isotope_errors", [0, 0])
    return static, var, [], int(iso[1]) if len(iso) > 1 else 0


def comet_masses(path):
    static, var, offs, iso = {}, [], [], 0
    for line in open(path):
        line = line.split("#")[0].strip()
        if "=" not in line: continue
        k, v = [x.strip() for x in line.split("=", 1)]
        if k.startswith("add_") and v:
            static[k] = float(v)
        elif re.fullmatch(r"variable_mod\d\d", k) and v:
            m = float(v.split()[0])
            if m != 0.0: var.append(m)
        elif k == "mass_offsets":
            offs = [float(x) for x in v.split() if float(x) != 0.0]
        elif k == "isotope_error" and v:
            iso = {0: 0, 1: 1, 2: 2, 3: 3, 4: 3, 5: 1}.get(int(v), 0)
    return static, var, offs, iso


def new_masses(engine, base_cfg, cand_cfg):
    f = sage_masses if engine == "sage" else comet_masses
    bs, bv, bo, bi = f(base_cfg)
    cs, cv, co, ci = f(cand_cfg)
    M = [m for m in cv if not any(abs(m - b) <= 1e-4 for b in bv)]
    for k, v in cs.items():
        d = v - bs.get(k, 0.0)
        if abs(d) > 1e-4: M.append(d)
    M += [o for o in co if not any(abs(o - b) <= 1e-4 for b in bo)]
    M += [k * ISO for k in range(bi + 1, ci + 1)]
    return M


def selftest():
    import random
    rng = random.Random(17)
    xs = [rng.gauss(0, 0.004) for _ in range(5000)]
    xs += [rng.gauss(15.9949, 0.004) for _ in range(300)]
    xs += [rng.gauss(79.9663, 0.004) for _ in range(200)]
    xs += [rng.gauss(1.0034, 0.004) for _ in range(150)]
    xs += [rng.gauss(42.0106, 0.004) for _ in range(4)]          # below min_count
    xs += [rng.uniform(-150, 500) for _ in range(200)]           # background
    P = peaks(xs)
    cents = [round(m, 2) for _, m in P]
    assert len(P) == 3, P
    assert abs(P[0][1] - 15.9949) < 0.005 and abs(P[1][1] - 79.9663) < 0.005 and abs(P[2][1] - 1.0034) < 0.005, P
    assert not any(abs(c) < 0.05 for c in cents)
    # a shoulder within 0.04 Da of a bigger peak is suppressed
    P2 = peaks([15.99] * 50 + [16.02] * 30)
    assert len(P2) == 1, P2
    # recovery masses
    import tempfile
    t = tempfile.mkdtemp()
    b = os.path.join(t, "b.params"); c = os.path.join(t, "c.params")
    open(b, "w").write("variable_mod01 = 15.994915 M 0 3 -1 0 0 0.0\nadd_C_cysteine = 57.021464\nisotope_error = 0\n"
                       "mass_offsets = \n")
    open(c, "w").write("variable_mod01 = 15.994915 M 0 3 -1 0 0 0.0\nvariable_mod02 = 79.966331 S 0 3 -1 0 0 0.0\n"
                       "add_C_cysteine = 57.021464\nisotope_error = 2\nmass_offsets = 0.0 17.0270\n")
    M = new_masses("comet", b, c)
    assert sorted(round(m, 3) for m in M) == [1.003, 2.007, 17.027, 79.966], M
    print("selftest OK")


def main():
    if sys.argv[1:] == ["--selftest"]:
        return selftest()
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    S = []
    for p in sys.argv[2:]:
        S += list(csv.DictReader(open(p), delimiter="\t"))
    by = {(s["run"], s["engine"], s["arm"]): s for s in S}
    open_cache = {}
    cells, peakrows = [], []
    for (run, eng, arm), s in sorted(by.items()):
        if arm != "cand": continue
        b = by[(run, eng, "base")]
        res = {}
        for a, x in (("base", b), ("cand", s)):
            ps = sage(x["result"]) if eng == "sage" else comet(x["result"])
            T = sum(1 for p in ps if p[3] == "t"); E = sum(1 for p in ps if p[3] == "e")
            n = T + E
            res[a] = dict(T=T, E=E, fdp=2 * E / n if n else 0.0, ub=2 * cp_upper(E, n) if n else 1.0,
                          pep=len({p[1] for p in ps if p[3] == "t"}), scans={p[0] for p in ps if p[3] == "t"})
        if s["open"] not in open_cache:
            open_cache[s["open"]] = peaks(msfragger(s["open"]))
        P = open_cache[s["open"]]
        M = new_masses(eng, b["config"], s["config"])
        rec = 0
        for i, (n, c) in enumerate(P, 1):
            hit = [m for m in M if abs(c - m) <= 0.02]
            rec += bool(hit)
            peakrows.append([run, eng, i, f"{c:.4f}", n, "yes" if hit else "no",
                             ",".join(f"{m:.4f}" for m in hit) or "-"])
        Bc, Cc = res["base"], res["cand"]
        lost = len(Bc["scans"] - Cc["scans"]) / len(Bc["scans"]) if Bc["scans"] else 0.0
        need = math.ceil(0.6 * len(P))
        cells.append(dict(run=run, engine=eng, psm_base=Bc["T"], psm_cand=Cc["T"],
                          gain=Cc["T"] / Bc["T"] - 1 if Bc["T"] else float("nan"),
                          pep_base=Bc["pep"], pep_cand=Cc["pep"],
                          pep_gain=Cc["pep"] / Bc["pep"] - 1 if Bc["pep"] else float("nan"),
                          ent_base=Bc["E"], ent_cand=Cc["E"], fdp_base=Bc["fdp"], fdp_cand=Cc["fdp"],
                          fdp_ub_cand=Cc["ub"], base_scans_lost=lost, new_masses=len(M), open_peaks=len(P),
                          recovered=rec, p4_need=need if len(P) >= 5 else "-",
                          P1="pass" if Bc["T"] and Cc["T"] >= 1.02 * Bc["T"] else "fail",
                          P2="pass" if Cc["fdp"] <= 0.015 else "fail",
                          P3="pass" if Cc["T"] >= 0.99 * Bc["T"] else "fail",
                          P4=("na" if len(P) < 5 else ("pass" if rec >= need else "fail"))))
    cols = ["run", "engine", "psm_base", "psm_cand", "gain", "pep_base", "pep_cand", "pep_gain", "ent_base",
            "ent_cand", "fdp_base", "fdp_cand", "fdp_ub_cand", "base_scans_lost", "new_masses", "open_peaks",
            "recovered", "p4_need", "P1", "P2", "P3", "P4"]
    fmt = lambda v: f"{v:.4f}" if isinstance(v, float) else str(v)
    with open(os.path.join(out, "cells.tsv"), "w") as o:
        o.write("\t".join(cols) + "\n")
        for c in cells: o.write("\t".join(fmt(c[k]) for k in cols) + "\n")
    with open(os.path.join(out, "peaks.tsv"), "w") as o:
        o.write("run\tengine\trank\tcentroid\tpsms\trecovered\tmatched_masses\n")
        for r in peakrows: o.write("\t".join(map(str, r)) + "\n")
    V = {}
    with open(os.path.join(out, "verdict.tsv"), "w") as o:
        o.write("engine\truns\tP1_pass\tP2_pass\tP3_pass\tP4_pass\tP4_evaluable\tP1\tP2\tP3\tP4\tverdict\n")
        for eng in sorted({c["engine"] for c in cells}):
            C = [c for c in cells if c["engine"] == eng]
            n = len(C)
            p1 = sum(c["P1"] == "pass" for c in C); p2 = sum(c["P2"] == "pass" for c in C)
            p3 = sum(c["P3"] == "pass" for c in C); p4 = sum(c["P4"] == "pass" for c in C)
            ev = sum(c["P4"] != "na" for c in C)
            r1 = "PASS" if p1 >= 3 else "FAIL"; r2 = "PASS" if p2 == n else "FAIL"; r3 = "PASS" if p3 == n else "FAIL"
            r4 = "INCONCLUSIVE" if ev < 3 else ("PASS" if p4 >= 3 else "FAIL")
            if "FAIL" in (r1, r2, r3, r4): v = "FAIL"
            elif r4 == "INCONCLUSIVE": v = "INCONCLUSIVE"
            else: v = "PASS"
            V[eng] = v
            o.write("\t".join(map(str, [eng, n, p1, p2, p3, p4, ev, r1, r2, r3, r4, v])) + "\n")
        item = "PASS" if V and all(v == "PASS" for v in V.values()) else (
            "FAIL" if "FAIL" in V.values() else "INCONCLUSIVE")
        o.write(f"# item verdict\t{item}\n")
    print(open(os.path.join(out, "verdict.tsv")).read())


if __name__ == "__main__":
    main()
