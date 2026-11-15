#!/usr/bin/env python3
"""acqcheck4 freeze-2 preparation (no FASTag): which drawn files are used, with their truth.

  select.py select <manifest.tsv> <stage.tsv> <truth.tsv> <drop.txt> <audited.tsv>

A row is staged when stage.tsv says md5_ok, conversion rc 0 and an mzML path, and its PXD is not in drop.txt
(PXDs found on another origin/* branch at freeze 2; such rows get staged=dropped and count as not staged).

Standard strata (DIA_orbitrap, PRM, DDA_orbitrap; acqcheck3 rule): every staged main row is used; each main row not
staged is replaced, in manifest order, by the next staged, unused backup of its stratum; otherwise it is excluded.
Target strata (DDA_astral target 12 Astral DDA units, DIA_closed target 8 closed-window DIA units): every staged
main row is used; then the backups, in manifest order: while fewer than the target units are among the used rows,
the next staged backup is used. Unused rows are listed (selected=no) and never run.
  Astral DDA unit      truth NONDIA, kind dependent, route thermo, model names Astral, astral (ASTMS share) >= 0.5
  closed-window DIA    truth DIA, route thermo, per < 0.5
Output: every manifest row, with selected (yes|no), staged (yes|no|dropped), replaces, input, input_sha256 and
truth.py's columns. Only rows with selected=yes and staged=yes enter the run.
  select.py --selftest
"""
import sys

TARGET = {"DDA_astral": 12, "DIA_closed": 8}

def fl(x):
    try: return float(x)
    except (TypeError, ValueError): return float("nan")

def astral_dda(r):
    return (r.get("truth") == "NONDIA" and r.get("kind") == "dependent" and r.get("route") == "thermo"
            and "astral" in (r.get("model") or "").lower() and fl(r.get("astral")) >= 0.5)

def closed(r):
    return r.get("truth") == "DIA" and r.get("route") == "thermo" and fl(r.get("per")) < 0.5

def is_target(s, r):
    return astral_dda(r) if s == "DDA_astral" else closed(r)

def read(path):
    rows = [l.rstrip("\n").split("\t") for l in open(path) if l.strip()]
    return rows[0], [dict(zip(rows[0], r)) for r in rows[1:]]

def select(rows, good, truth, drop):
    for r in rows:
        r.update(truth.get(r["id"], {}))
        r["route"] = "thermo"
        if r["pxd"] in drop: r["staged"] = "dropped"
        else: r["staged"] = "yes" if r["id"] in good else "no"
        r["selected"], r["replaces"] = "no", ""
        g = good.get(r["id"]) if r["staged"] == "yes" else None
        r["input"], r["input_sha256"], r["raw_sha256"] = g if g else ("", "", "")
    strata = []
    for r in rows:
        if r["stratum"] not in strata: strata.append(r["stratum"])
    for s in strata:
        mains = [r for r in rows if r["stratum"] == s and r["role"] == "main"]
        backs = [r for r in rows if r["stratum"] == s and r["role"].startswith("backup")]
        if s in TARGET:
            for m in mains:
                if m["staged"] == "yes": m["selected"] = "yes"
            used = [m for m in mains if m["selected"] == "yes"]
            for b in backs:
                if sum(is_target(s, u) for u in used) >= TARGET[s]: break
                if b["staged"] == "yes":
                    b["selected"], b["replaces"] = "yes", "target_rule"; used.append(b)
            continue
        bi = 0
        for m in mains:
            if m["staged"] == "yes": m["selected"] = "yes"; continue
            while bi < len(backs) and backs[bi]["staged"] != "yes": bi += 1
            if bi < len(backs):
                m["replaces"] = "replaced_by:" + backs[bi]["id"]
                backs[bi]["selected"], backs[bi]["replaces"] = "yes", m["id"]; bi += 1
            else:
                m["replaces"] = "no_backup"
    return rows

def selftest():
    def row(i, s, role, pxd):
        return dict(id=i, stratum=s, role=role, pxd=pxd, file=i + ".raw")
    rows = [row("a1", "DDA_astral", "main", "P1"), row("a2", "DDA_astral", "main", "P2"),
            row("ab1", "DDA_astral", "backup1", "P3"), row("ab2", "DDA_astral", "backup2", "P4"),
            row("ab3", "DDA_astral", "backup3", "P5"),
            row("o1", "DDA_orbitrap", "main", "P6"), row("o2", "DDA_orbitrap", "main", "P7"),
            row("ob1", "DDA_orbitrap", "backup1", "P8"), row("ob2", "DDA_orbitrap", "backup2", "P9")]
    good = {i: ("p", "s", "r") for i in ("a1", "a2", "ab2", "ab3", "o1", "ob1", "ob2")}
    ad = dict(truth="NONDIA", kind="dependent", model="Orbitrap_Astral", astral="0.99")
    truth = {"a1": ad, "a2": dict(ad, truth="DIA", kind="tiling_nondependent"), "ab2": ad, "ab3": ad}
    global TARGET
    TARGET = {"DDA_astral": 2, "DIA_closed": 8}
    out = {r["id"]: (r["selected"], r["staged"], r["replaces"]) for r in select([dict(r) for r in rows], good, truth, {"P6"})}
    assert out["a1"] == ("yes", "yes", "") and out["a2"] == ("yes", "yes", "")
    assert out["ab1"] == ("no", "no", "") and out["ab2"] == ("yes", "yes", "target_rule") and out["ab3"][0] == "no"
    assert out["o1"] == ("no", "dropped", "replaced_by:ob1") and out["ob1"] == ("yes", "yes", "o1")
    assert out["o2"] == ("no", "no", "replaced_by:ob2") and out["ob2"] == ("yes", "yes", "o2")
    assert not astral_dda(dict(ad, model="Orbitrap_Exploris_480")) and not astral_dda(dict(ad, astral="0.1"))
    assert closed(dict(truth="DIA", route="thermo", per="0.2")) and not closed(dict(truth="DIA", route="thermo", per="0.99"))
    assert not closed(dict(truth="DIA", route="thermo", per="NA"))
    print("select selftest ok")

def main():
    a = sys.argv[1]
    if a == "--selftest": selftest(); return
    mh, rows = read(sys.argv[2])
    good = {}
    for l in open(sys.argv[3]):
        f = l.rstrip("\n").split("\t")
        if len(f) >= 7 and f[2] == "md5_ok" and f[4] == "0" and f[5] and f[6]: good[f[0]] = (f[5], f[6], f[3])
    th, tr = read(sys.argv[4])
    truth = {r["id"]: {k: v for k, v in r.items() if k not in ("id", "route")} for r in tr}
    drop = set(l.strip() for l in open(sys.argv[5]) if l.strip() and not l.startswith("#"))
    out = select(rows, good, truth, drop)
    cols = mh + ["selected", "route", "staged", "replaces", "raw_sha256", "input", "input_sha256"] + \
        [c for c in th if c not in ("id", "route")]
    with open(sys.argv[6], "w") as o:
        o.write("\t".join(cols) + "\n")
        for r in out: o.write("\t".join(str(r.get(c, "NA")) for c in cols) + "\n")
    sel = [r for r in out if r["selected"] == "yes"]
    print("rows %d, staged %d, dropped %d, selected %d; Astral DDA units %d, closed-window DIA units %d" % (
        len(out), sum(r["staged"] == "yes" for r in out), sum(r["staged"] == "dropped" for r in out), len(sel),
        sum(astral_dda(r) for r in sel), sum(closed(r) for r in sel)))

if __name__ == "__main__":
    main()
