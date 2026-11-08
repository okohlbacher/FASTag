"""Python port of FASTag 1.12's protease classifier (src/Digest.cpp classify(), rankScores(), weigh/mix/endOf;
src/DigestReport.cpp no-call order) for the #3 DEV fits. It reads the per-run counts from a -digest_out report and
scores them under any model table. Checked against the RC binary's log-likelihoods and calls (check_port in
fit_chem.py) before any fit; the two-residue flank path (classify2) is not ported (its dipeptide counts are not in
the report), so a run whose call goes through flank2 takes the binary's result."""
import math

AAS = "GASPVTCLNDQKEMHFRYW"
IDX = {a: i for i, a in enumerate(AAS)}
TAG_MIN = 100


def read_report(path):
    rep = {}
    with open(path) as f:
        next(f)
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) >= 4:
                rep[(p[0], p[1])] = (p[2], p[3])
    return rep


def val(rep, s, k, default=None):
    v = rep.get((s, k))
    return v[0] if v else default


def run_counts(rep):
    c = [int(val(rep, "pos", f"C.P1.{a}", "0")) for a in AAS]
    n = [int(val(rep, "pos", f"N.P1'.{a}", "0")) for a in AAS]
    return c, n


def read_table(path):
    t = {"models": [], "bg_c": [0.0] * 19, "bg_n": [0.0] * 19, "detection": {}, "spec": None, "v2": False,
         "header": [], "rows": []}
    order = {}
    with open(path) as f:
        for line in f:
            if line.startswith("#"):
                t["header"].append(line.rstrip("\n"))
                if line.strip("# \n") == "fastag_digest_models v2":
                    t["v2"] = True
                continue
            p = line.rstrip("\n").split("\t")
            if p[0] == "model":
                continue
            t["rows"].append(p)
            name, cls, end, res, fr = p
            if name == "background":
                (t["bg_c"] if end == "C" else t["bg_n"])[IDX[res]] = float(fr)
                continue
            if name == "specificity":
                s = t["spec"] or [0.05, 0.05]
                s[0 if cls == "trypsin" else 1] = float(fr)
                t["spec"] = s
                continue
            if name == "reference":
                continue
            if name == "detection":
                d = t["detection"].setdefault(cls, {"C": [1.0] * 19, "N": [1.0] * 19})
                d[end][IDX[res]] = float(fr)
                continue
            if name not in order:
                order[name] = len(t["models"])
                t["models"].append({"name": name, "cls": cls, "C": None, "N": None})
            m = t["models"][order[name]]
            if res == "*":
                continue
            if m[end] is None:
                m[end] = [0.0] * 19
            m[end][IDX[res]] = float(fr)
    return t


def weigh(p, e):
    if e is None:
        return p
    out = [e[a] * p[a] for a in range(19)]
    z = math.fsum(out)
    if not z > 0:
        return p
    k = math.fsum(p) / z
    return [x * k for x in out]


def mix(p, bg, s):
    return [(1 - s) * p[a] + s * bg[a] for a in range(19)]


def loglik(cnt, p):
    z = math.fsum(p)
    terms = []
    for a in range(19):
        if cnt[a]:
            q = p[a] / z
            terms.append(cnt[a] * (math.log(q) if q > 0 else -math.inf))
    if any(t == -math.inf for t in terms):
        return -math.inf
    return math.fsum(terms)


def classify(cterm, nterm, t, share=0.05, det=None, tag_min=TAG_MIN, use_spec=True):
    """det: the detection dict {'C': [...], 'N': [...]} of the run's class, or None. Specificity rows apply when the
    table has them (use_spec), as in the binary."""
    r = {"n_c": sum(cterm), "n_n": sum(nterm), "scored": False}
    if r["n_c"] < tag_min:
        return r
    r["scored"] = True
    r["uses_nterm"] = r["n_n"] >= tag_min
    spec = t["spec"] if use_spec else None
    scores = []
    for m in t["models"]:
        s = share if spec is None else (spec[0] if m["cls"] == "Trypsin" else spec[1])
        ends = []
        for end, cnt in (("C", cterm), ("N", nterm)):
            if end == "N" and not r["uses_nterm"]:
                continue
            bg = t["bg_c"] if end == "C" else t["bg_n"]
            p = bg if m[end] is None else m[end]
            e = det[end] if det else None
            ends.append(loglik(cnt, mix(weigh(p, e), weigh(bg, e), s)))
        scores.append((m["name"], m["cls"], ends[0] + (ends[1] if len(ends) > 1 else 0.0)))
    r["scores"] = scores
    rk = sorted(range(len(scores)), key=lambda i: math.inf if math.isnan(scores[i][2]) else -scores[i][2])
    top = rk[0]
    ru = next((k for k in rk if scores[k][1] != scores[top][1]), None)
    best = scores[top][2]
    r["top"], r["runner_up"] = top, ru
    r["nonfinite"] = (not math.isfinite(best)) or (ru is not None and not math.isfinite(scores[ru][2]))
    r["tied"] = [s[0] for s in scores if s[2] == best] if (ru is not None and not r["nonfinite"]
                                                           and scores[ru][2] == best) else []
    n = r["n_c"] + (r["n_n"] if r["uses_nterm"] else 0)
    r["margin"] = (best - scores[ru][2]) / n if ru is not None else None
    return r


def decide(rep, clf, tims_call):
    """The first no-call rule that applies (DigestReport.cpp order), '' for a call. tims_call: detection weights
    for the run's class are applied and the class is timstof."""
    tims = val(rep, "nocall", "timstof")
    counts = val(rep, "nocall", "ion_counts")
    tot = int(val(rep, "count", "tot", "0"))
    rules = [("low_resolution", val(rep, "nocall", "low_resolution")),
             ("timstof", "no" if tims_call and tims == "yes" else tims),
             ("ms2_scan_window", val(rep, "nocall", "ms2_scan_window")),
             ("ms2_first_peak", val(rep, "nocall", "ms2_first_peak")),
             ("ion_counts", "no" if tims_call and counts == "yes" else counts),
             ("few_tags", "yes" if (tot < TAG_MIN or not clf["scored"]) else "no"),
             ("nonfinite_score", "yes" if clf["scored"] and clf["nonfinite"] else "no"),
             ("tie", "yes" if clf["scored"] and clf["tied"] else "no")]
    for name, v in rules:
        if v == "yes":
            return name
    return ""


def p_correct(cal, margin, n, first_peak):
    z = cal["intercept"] + cal["margin"] * margin + cal["log_n"] * math.log(max(n, 1)) + \
        cal["first_peak"] * (1.0 if first_peak else 0.0)
    return 1.0 / (1.0 + math.exp(-z))
