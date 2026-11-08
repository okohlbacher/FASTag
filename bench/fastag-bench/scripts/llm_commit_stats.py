#!/usr/bin/env python3
"""Commits of the FASTag repository with and without an LLM co-author trailer (Note S4).

Reads `git log <rev>` of a FASTag clone (read-only) and writes one row per co-author model (the
`Co-Authored-By:` trailer naming Claude) and one for commits without such a trailer: commits, first
and last commit date, and lines added and deleted per area of the tree (git --numstat; binary files
counted as 0 lines).

    python3 scripts/llm_commit_stats.py --repo <FASTag clone> --rev v1.9.0 --out results/llm_commits_v190.tsv
"""
from __future__ import annotations

import argparse
import re
import subprocess
from collections import defaultdict
from pathlib import Path

AREAS = [  # first match wins
    ("tool", re.compile(r"^(src|include)/")),
    ("tests", re.compile(r"^test/")),
    ("gui", re.compile(r"^gui/")),
    ("docs", re.compile(r"^(doc/|README|BOM|CHANGELOG|.*\.md$)")),
    ("ci_build", re.compile(r"^(\.github/|cmake/|CMakeLists\.txt)")),
    ("data_tools", re.compile(r"^(data/|tools/|bench/)")),
]
TRAILER = re.compile(r"^Co-Authored-By:\s*(Claude[^<]*?)\s*<", re.I | re.M)
ANY_TRAILER = re.compile(r"^Co-Authored-By:\s*([^<]*?)\s*<", re.I | re.M)


def area(path: str) -> str:
    for name, rx in AREAS:
        if rx.search(path):
            return name
    return "other"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--rev", default="v1.9.0")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    sha = subprocess.run(["git", "-C", a.repo, "rev-parse", f"{a.rev}^{{commit}}"], check=True,
                         capture_output=True, text=True).stdout.strip()
    log = subprocess.run(["git", "-C", a.repo, "log", a.rev, "--numstat", "--date=short",
                          "--format=%x00%H%x01%ad%x01%B%x01"], check=True, capture_output=True, text=True).stdout
    merges = int(subprocess.run(["git", "-C", a.repo, "rev-list", "--count", "--merges", a.rev], check=True,
                                capture_output=True, text=True).stdout)
    stats = defaultdict(lambda: {"commits": 0, "first": "9999", "last": "0000",
                                 **{f"{n}_{d}": 0 for n, _ in AREAS + [("other", None)] for d in ("add", "del")}})
    total = 0
    others = []  # (short hash, non-Claude co-author, Claude models of the same commit)
    for rec in log.split("\x00")[1:]:
        h, date, body, numstat = rec.split("\x01", 3)
        models = sorted(set(m.strip() for m in TRAILER.findall(body)))
        key = " + ".join(models) if models else "(no Claude trailer)"
        for o in sorted(set(m.strip() for m in ANY_TRAILER.findall(body)) - set(models)):
            others.append((h[:7], o, key))
        s = stats[key]
        s["commits"] += 1
        s["first"] = min(s["first"], date)
        s["last"] = max(s["last"], date)
        total += 1
        for line in numstat.strip().splitlines():
            p = line.split("\t")
            if len(p) != 3:
                continue
            add = int(p[0]) if p[0] != "-" else 0
            dele = int(p[1]) if p[1] != "-" else 0
            ar = area(p[2])
            s[f"{ar}_add"] += add
            s[f"{ar}_del"] += dele
    cols = ["co_author", "commits", "first_date", "last_date"] + \
           [f"{n}_{d}" for n, _ in AREAS + [("other", None)] for d in ("add", "del")]
    order = sorted(stats, key=lambda k: (k.startswith("("), stats[k]["first"]))
    with open(a.out, "w") as fh:
        fh.write(f"# source: scripts/llm_commit_stats.py on git log {a.rev} (commit {sha}) of the FASTag repository; "
                 f"commits: {total}, of which {merges} merge commits (their lines are not counted: git log --numstat lists no diff for merges)\n")
        fh.write("# non-Claude co-author trailers: " + ("; ".join(f"{o} in {h} (with {k})" for h, o, k in others)
                                                         if others else "none") +
                 "; such commits are counted in the row of their Claude trailer\n")
        fh.write("# co_author = model named in the commit's 'Co-Authored-By: Claude ...' trailer (one Claude model per commit here); "
                 "*_add/_del = lines added/deleted (git --numstat) by area: tool = src/ include/; tests = test/; gui = gui/; "
                 "docs = doc/ and *.md; ci_build = .github/ cmake/ CMakeLists.txt; data_tools = data/ tools/ bench/\n")
        fh.write("\t".join(cols) + "\n")
        for k in order:
            s = stats[k]
            fh.write("\t".join([k, str(s["commits"]), s["first"], s["last"]] +
                               [str(s[c]) for c in cols[4:]]) + "\n")
        tot = {c: sum(stats[k][c] for k in stats) for c in cols[4:]}
        fh.write("\t".join(["all", str(total), min(s["first"] for s in stats.values()),
                            max(s["last"] for s in stats.values())] + [str(tot[c]) for c in cols[4:]]) + "\n")
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
