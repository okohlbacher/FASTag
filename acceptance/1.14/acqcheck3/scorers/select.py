#!/usr/bin/env python3
"""acqcheck3 freeze-2 preparation (no FASTag): which drawn files are used, and their truth.

  select.py select <manifest.tsv> <stage.tsv> <stage_sciex.tsv> <selected.tsv>
      Backup rule (PREREG): per stratum, every main file that is staged is used; for each main file that is not
      staged (in manifest order) the next staged, unused backup of the same stratum (backup1, 2, 3) replaces it.
      A main file without a staged backup stays in the list with staged=no (excluded, never a pass or a refusal).
  select.py merge <selected.tsv> <truth.tsv> <audited.tsv>
      Adds truth.py's columns to every selected row (staged=no rows get truth NA).
  select.py --selftest
"""
import sys

def staged_rows(paths):
    good = {}
    for p in paths:
        for l in open(p):
            f = l.rstrip("\n").split("\t")
            if len(f) >= 7 and f[2] in ("sha1_ok", "size_ok") and f[4] == "0" and f[5] and f[6]:
                good[f[0]] = (f[5], f[6], f[3])
    return good

def route(fn):
    fn = fn.lower()
    return "thermo" if fn.endswith(".raw") else "bruker" if fn.endswith(".d.zip") else "sciex" if fn.endswith((".wiff", ".wiff2")) else "other"

def select(man, good):
    h = man[0]; rows = [dict(zip(h, r)) for r in man[1:]]
    out, log = [], []
    strata = []
    for r in rows:
        if r["stratum"] not in strata: strata.append(r["stratum"])
    for s in strata:
        mains = [r for r in rows if r["stratum"] == s and r["role"] == "main"]
        backs = [r for r in rows if r["stratum"] == s and r["role"].startswith("backup")]
        bi = 0
        for m in mains:
            if m["id"] in good:
                out.append(dict(m, staged="yes", replaces="")); continue
            while bi < len(backs) and backs[bi]["id"] not in good: bi += 1
            if bi < len(backs):
                out.append(dict(m, staged="no", replaces="replaced_by:" + backs[bi]["id"]))
                out.append(dict(backs[bi], staged="yes", replaces=m["id"])); bi += 1
            else:
                out.append(dict(m, staged="no", replaces="no_backup"))
        for b in backs[bi:]:
            log.append(b["id"])
    for r in out:
        r["route"] = route(r["file"])
        g = good.get(r["id"]) if r["staged"] == "yes" else None
        r["input"], r["input_sha256"], r["raw_sha256"] = g if g else ("", "", "")
    return out, log

COLS = ["id", "stratum", "class", "role", "pxd", "instrument", "file", "route", "staged", "replaces", "raw_sha256",
        "input", "input_sha256", "project_title"]

def write(path, rows, cols):
    with open(path, "w") as o:
        o.write("\t".join(cols) + "\n")
        for r in rows: o.write("\t".join(str(r.get(c, "")) for c in cols) + "\n")

def selftest():
    h = ["id", "stratum", "role", "file"]
    man = [h, ["a1", "S", "main", "x.raw"], ["a2", "S", "main", "y.raw"], ["a3", "S", "main", "z.raw"],
           ["b1", "S", "backup1", "b.raw"], ["b2", "S", "backup2", "c.d.zip"], ["c1", "T", "main", "w.wiff"]]
    good = {"a1": ("p", "s", "r"), "b2": ("p", "s", "r"), "c1": ("p", "s", "r")}
    out, log = select(man, good)
    ids = [(r["id"], r["staged"], r["replaces"]) for r in out]
    assert ids == [("a1", "yes", ""), ("a2", "no", "replaced_by:b2"), ("b2", "yes", "a2"), ("a3", "no", "no_backup"),
                   ("c1", "yes", "")], ids
    assert [r["route"] for r in out] == ["thermo", "thermo", "bruker", "thermo", "sciex"] and log == []
    print("select selftest ok")

def main():
    a = sys.argv[1]
    if a == "--selftest": selftest(); return
    if a == "select":
        man = [l.rstrip("\n").split("\t") for l in open(sys.argv[2]) if l.strip()]
        out, log = select(man, staged_rows(sys.argv[3:5]))
        write(sys.argv[5], out, COLS)
        print("selected %d rows, staged %d, not staged %d; unused backups: %s" % (
            len(out), sum(r["staged"] == "yes" for r in out), sum(r["staged"] == "no" for r in out), " ".join(log)))
    elif a == "merge":
        sel = [l.rstrip("\n").split("\t") for l in open(sys.argv[2]) if l.strip()]
        h = sel[0]; rows = [dict(zip(h, r)) for r in sel[1:]]
        tr = [l.rstrip("\n").split("\t") for l in open(sys.argv[3]) if l.strip()]
        th = tr[0]; t = {r[0]: dict(zip(th, r)) for r in tr[1:]}
        extra = [c for c in th if c not in ("id", "route")]
        for r in rows:
            for c in extra: r[c] = t.get(r["id"], {}).get(c, "NA")
        write(sys.argv[4], rows, h + extra)
        print("merged", len(rows), "rows;", sum(1 for r in rows if r["staged"] == "yes" and r["id"] not in t), "staged rows without truth")

main()
