"""Digest, label and alkylation calls from FASTag's -digest_out, -label_out and -massgap_out reports.

The protease call is FASTag's own (section 'call'). FASTag reports label and cysteine counts but makes no
label or alkylation call itself; the calls here apply prose-auto 0.1.3's rules (prose_auto/external.py,
fastag_termini and fastag_alkylation) to the report counts, so they reproduce what prose-auto calls from
the same FASTag run.
"""
from __future__ import annotations

ENZ_CLASS = {"unspecific cleavage": "unspecific"}

# prose-auto 0.1.3 fastag_termini: isobaric label when count >= 1% of tags and >= 20 x max(background, 1)
NLABEL = {"TMT": "TMT", "TMTpro": "TMTpro", "iTRAQ4": "iTRAQ4"}
LABEL_MIN_SHARE, LABEL_BG_FOLD = 0.01, 20
# SILAC (Lys8/Arg10): both heavy shares >= 0.2, tryptic K/R share >= 0.8, >= 50 K- and R-terminal tags
HEAVY_MIN, KR_TRYPTIC, SILAC_MIN_TAGS = 0.2, 0.8, 50
# prose-auto 0.1.3 fastag_alkylation: the largest Cys gap count wins when it reaches 10 spectra
CYS = ["Carbamidomethyl", "Propionamide", "Nethylmaleimide", "Methylthio", "Carboxymethyl"]
ALK_MIN = 10


def _f(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def enzyme_class(name: str | None) -> str | None:
    if name is None:
        return None
    return ENZ_CLASS.get(name, name)


def digest(rep: dict) -> dict:
    """FASTag's protease call; 'would' is the class of the best model also for a no-call."""
    status = rep.get(("call", "status"), "missing")
    rows = [(k[1][: -len(".loglik")], _f(v)) for k, v in rep.items() if k[0] == "model" and k[1].endswith(".loglik")]
    rows = [(m, x) for m, x in rows if x is not None]
    would = None
    if rows:
        top = max(range(len(rows)), key=lambda i: (rows[i][1], -i))
        would = enzyme_class(rep.get(("model", rows[top][0] + ".class")))
    reasons = sorted(k[1] for k, v in rep.items() if k[0] == "nocall" and v == "yes")
    return {
        "status": status,
        "call": enzyme_class(rep.get(("call", "class"))) if status == "call" else None,
        "would": enzyme_class(rep.get(("call", "class"))) or would,
        "runner_up": enzyme_class(rep.get(("call", "runner_up_class"))),
        "margin": _f(rep.get(("call", "margin"))),
        "nocall_reasons": ",".join(reasons),
        "models": rep.get(("run", "models")),
    }


def label(lab: dict, dig: dict | None = None) -> dict:
    """Label call by prose-auto 0.1.3's termini rule on the -label_out counts.

    Isobaric: every label whose count reaches 1% of the filtered tags and 20x its +0.5 Da background.
    SILAC: heavy K8 and R10 shares both >= 0.2 with >= 50 K- and R-terminal tags (heavy gate) and a C-terminal
    K/R share >= 0.8 (from -digest_out). Several hits are joined with '+'; none gives 'label-free'.
    """
    tags = _f(lab.get(("count", "tags_filtered")), 0.0)
    hits = []
    for key, name in NLABEL.items():
        cnt = _f(lab.get(("nlabel", f"{key}.count")), 0.0)
        bg = _f(lab.get(("nlabel", f"{key}.background")), 0.0)
        if tags and cnt >= LABEL_MIN_SHARE * tags and cnt >= LABEL_BG_FOLD * max(bg, 1.0):
            hits.append(name)
    hk, hr = _f(lab.get(("heavy", "K8.share")), 0.0), _f(lab.get(("heavy", "R10.share")), 0.0)
    kr = _f((dig or {}).get(("share", "kr")), None)
    gate = lab.get(("heavy", "gate")) == "yes"
    if hk >= HEAVY_MIN and hr >= HEAVY_MIN and gate and (kr is None or kr >= KR_TRYPTIC):
        hits.append("SILAC")
    return {"label_call": "+".join(hits) if hits else "label-free", "K8_share": hk, "R10_share": hr, "kr": kr}


def silac_massgap(mg: dict) -> str:
    """FASTag's own SILAC call in -massgap_out ('none' or the SILAC pair)."""
    return mg.get(("silac", "call"), "missing")


def alkylation(mg: dict) -> dict:
    """prose-auto 0.1.3 rule on the -massgap_out cys counts: best >= 10 placed spectra, else 'unknown'.
    margin = (best + 1) / (second + 1)."""
    counts = {c: _f(mg.get(("cys", f"{c} (C)")), 0.0) for c in CYS}
    if not any(("cys", f"{c} (C)") in mg for c in CYS):
        return {"alk_call": None, "alk_ratio": None, "alk_best_count": None, "cys_spectra": None}
    best = max(counts, key=counts.get)  # first listed wins ties, as in prose-auto
    second = sorted(counts.values())[-2]
    ratio = (counts[best] + 1) / (second + 1)
    call = best if counts[best] >= ALK_MIN else "unknown"
    return {"alk_call": call, "alk_ratio": round(ratio, 3), "alk_best_count": counts[best],
            "cys_spectra": _f(mg.get(("cys", "spectra")))}
