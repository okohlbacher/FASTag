#!/usr/bin/env python3
"""Compare FASTag -species reports produced with different taxonomy indexes.

P5 (GUI-DESIGN.md section 8 and 10): a smaller index may replace the bundled
tax_k7.taxdb only if every species call a user would see is unchanged. This
script reads the species.tsv files of one benchmark sweep per index (the
fastag-bench `species-run` layout: <runs>/<run_id>/fastag_<arm>/species.tsv)
and reports, per run and setting:

  * the headline call the GUI shows (SpeciesPanel.tsx: the first row with
    observed > 0, or "tie:<a,b>" when the top rows tie on adjusted and
    observed),
  * the harness top-1 genus (first genus row, as the paper's harness takes it),
  * whether the whole visible table (rows with observed > 0: name, observed,
    adjusted, q) is identical to the reference index,
  * the paper's call (FASTag 1.9.0, per_run_top1.tsv) for the settings the
    paper reports.

Usage:
  compare_indexes.py --manifest species_runs.tsv --paper per_run_top1.tsv \
      --ref SHIP=<runs_SHIP> --cand B=<runs_B> --cand Bnw=<runs_Bnw> \
      [--repro <runs_v1110>] --out <dir>

Writes <out>/per_run_calls.tsv, <out>/differences.tsv and <out>/summary.tsv
and prints a short summary. Standard library only.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import sys
from pathlib import Path

ARMS = ["default", "deconv", "gapped", "all"]
PAPER_COL = {"default": "def_v190", "deconv": "dec_v190", "gapped": "gap_v190"}
CURRENT_COL = {"default": "def_v1110", "deconv": "dec_v1110", "gapped": "gap_v1110"}


def read_tsv(path: Path) -> list[dict[str, str]]:
    with open(path, newline="") as fh:
        lines = [l for l in fh if not l.startswith("#") and l.strip()]
    return list(csv.DictReader(lines, delimiter="\t"))


def num(s: str | None) -> float:
    try:
        return float((s or "").strip().rstrip("xX"))
    except ValueError:
        return 0.0


def visible(path: Path) -> list[tuple[str, str, float, float, str]]:
    """Rows the GUI lists (observed > 0), in the CLI's order."""
    out = []
    for r in read_tsv(path):
        if num(r.get("observed")) > 0:
            out.append((r.get("rank", ""), r.get("name", ""), num(r.get("observed")), num(r.get("adjusted")),
                        r.get("qvalue", "")))
    return out


def headline(rows) -> str:
    if not rows:
        return "(none)"
    top = rows[0]
    tied = [r for r in rows if r[3] == top[3] and r[2] == top[2]]
    return "tie:" + ",".join(r[1] for r in tied) if len(tied) > 1 else top[1]


def top1_genus(path: Path) -> str:
    for r in read_tsv(path):
        if r.get("rank") == "genus":
            return r.get("name", "")
    return "(none)"


def truth_set(s: str) -> set[str]:
    return {p.split("=")[0].strip() for p in s.split(";") if p.strip()}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--paper", required=True, help="per_run_top1.tsv (paper = *_v190 columns)")
    ap.add_argument("--ref", required=True, help="NAME=runs dir of the bundled index")
    ap.add_argument("--cand", action="append", default=[], help="NAME=runs dir of a candidate index")
    ap.add_argument("--repro", help="runs dir of the earlier 1.11.0 sweep, for a byte-identity check of --ref")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    man = read_tsv(Path(a.manifest))
    paper = {r["run_id"]: r for r in read_tsv(Path(a.paper))}
    ref_name, ref_dir = a.ref.split("=", 1)
    cands = [c.split("=", 1) for c in a.cand]
    cfgs = [(ref_name, Path(ref_dir))] + [(n, Path(d)) for n, d in cands]
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    per_run, diffs = [], []
    summ = {n: {"reports": 0, "headline_changed": 0, "top1_changed": 0, "table_changed": 0,
                "paper_correct_lost": 0, "paper_correct_gained": 0, "top1_correct": 0}
            for n, _ in cfgs}
    repro = {"checked": 0, "identical": 0, "calls_equal_v1110": 0, "calls_checked": 0}
    missing = []
    for m in man:
        rid, truth = m["run_id"], truth_set(m["truth"])
        for arm in ARMS:
            res = {}
            for n, d in cfgs:
                p = d / rid / f"fastag_{arm}" / "species.tsv"
                if not p.exists():
                    missing.append(f"{n}/{rid}/{arm}")
                    continue
                rows = visible(p)
                res[n] = {"path": p, "rows": rows, "head": headline(rows), "top1": top1_genus(p)}
            if ref_name not in res:
                continue
            ref = res[ref_name]
            if a.repro:
                rp = Path(a.repro) / rid / f"fastag_{arm}" / "species.tsv"
                if rp.exists():
                    repro["checked"] += 1
                    repro["identical"] += sha(rp) == sha(ref["path"])
            pc = paper.get(rid, {}).get(PAPER_COL.get(arm, ""), "")
            cur = paper.get(rid, {}).get(CURRENT_COL.get(arm, ""), "")
            if cur:
                repro["calls_checked"] += 1
                repro["calls_equal_v1110"] += cur == ref["top1"]
            row = {"run_id": rid, "class": m.get("set", ""), "truth": m["truth"], "arm": arm,
                   "paper_v190_top1": pc or "-"}
            for n, _ in cfgs:
                if n not in res:
                    row[f"{n}_headline"] = row[f"{n}_top1"] = "(missing)"
                    continue
                r = res[n]
                row[f"{n}_headline"], row[f"{n}_top1"] = r["head"], r["top1"]
                s = summ[n]
                s["reports"] += 1
                s["top1_correct"] += r["top1"] in truth
                if n == ref_name:
                    continue
                hc, tc = r["head"] != ref["head"], r["top1"] != ref["top1"]
                tab = r["rows"] != ref["rows"]
                s["headline_changed"] += hc
                s["top1_changed"] += tc
                s["table_changed"] += tab
                ref_ok, new_ok = ref["top1"] in truth, r["top1"] in truth
                if pc and pc in truth and ref_ok and not new_ok:
                    s["paper_correct_lost"] += 1
                if not ref_ok and new_ok:
                    s["paper_correct_gained"] += 1
                ref_top3 = [x[1] for x in ref["rows"][:3]]
                new_top3 = [x[1] for x in r["rows"][:3]]
                row[f"{n}_table_identical"] = "yes" if not tab else "no"
                if hc or tc:
                    diffs.append({"index": n, "run_id": rid, "arm": arm, "truth": m["truth"],
                                  "paper_v190_top1": pc or "-", f"ref_{ref_name}": ref["head"],
                                  "candidate": r["head"],
                                  "ref_correct": "yes" if ref_ok else "no",
                                  "cand_correct": "yes" if new_ok else "no",
                                  "ref_top3": ",".join(ref_top3), "cand_top3": ",".join(new_top3)})
            per_run.append(row)

    def write(name, rows):
        if not rows:
            (out / name).write_text("")
            return
        keys = list(dict.fromkeys(k for r in rows for k in r))
        with open(out / name, "w", newline="") as fh:
            w = csv.DictWriter(fh, keys, delimiter="\t", restval="")
            w.writeheader()
            w.writerows(rows)

    write("per_run_calls.tsv", per_run)
    write("differences.tsv", diffs)
    write("summary.tsv", [{"index": n, **s} for n, s in summ.items()])
    print(f"missing reports: {len(missing)}", *missing[:10], sep="\n  ")
    if a.repro:
        print(f"reproduction: {repro['identical']}/{repro['checked']} species.tsv byte-identical to --repro")
    print(f"{ref_name} top-1 equals the 1.11.0 per_run_top1 call: {repro['calls_equal_v1110']}/{repro['calls_checked']}")
    for n, s in summ.items():
        print(n, s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
