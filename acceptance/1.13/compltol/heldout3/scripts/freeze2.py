#!/usr/bin/env python3
"""compltol held-out 3, freeze 2: disjointness table, the runs section of the PREREG and SHA256SUMS. No FASTag run.
freeze2.py <acceptance/1.13 dir>       (from the repository root, after git fetch, before the freeze-2 commit)
Inputs: manifests/compltol-H3.tsv and compltol/heldout3/{qualification.tsv,audit.tsv} (written on data by qualify.py
and the truth audit). Disjointness: PXD against select/excl_pxd.txt (FAIL if listed); every PXD named on another
origin branch now, outside exclusion lists and h2r_pride_candidates.tsv, is reported (a conflict with another test is
settled by the truth audit rule of the PREREG); raw and mzML sha256 against every sha256 named
under acceptance/ on any origin branch other than this one."""
import csv, hashlib, re, subprocess, sys
from pathlib import Path

A = Path(sys.argv[1]); D = A / "compltol/heldout3"
ME = "refs/remotes/origin/acc114/compltol3"


def tsv(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True).stdout


man = tsv(A / "manifests/compltol-H3.tsv")
excl = set((D / "select/excl_pxd.txt").read_text().split())
refs = [r for r in git("for-each-ref", "--format=%(refname)", "refs/remotes/origin").split() if not r.endswith("HEAD") and r != ME]
pxd_now, sha_old = set(), set()
for r in refs:
    pxd_now |= set(re.findall(r"PXD\d{6}", git("grep", "-ohE", r"PXD[0-9]{6}", r, "--", ".", ":(exclude)*h2r_pride_candidates.tsv",
                                                 ":(exclude)*excl*", ":(exclude)*exclude*")))
    sha_old |= set(git("grep", "-ohE", "[0-9a-f]{64}", r, "--", "acceptance").split())
assert len(sha_old) > 100 and len(excl) > 20000 and len(pxd_now) > 1000
ok = True
with open(A / "disjointness/compltol-H3.tsv", "w") as f:
    f.write(f"# compltol held-out 3: PXD against compltol/heldout3/select/excl_pxd.txt and against every PXD named on the {len(refs)} other origin branches at freeze 2; raw and mzML sha256 against every sha256 under acceptance/ on those branches\n")
    f.write("file\tpxd\tfastag_input_sha256\tsource_sha256\tpxd_excluded\tpxd_named_elsewhere\tsha256_known\tresult\n")
    for r in man:
        pe, pn = r["pxd"] in excl, r["pxd"] in pxd_now
        sk = r["fastag_input_sha256"] in sha_old or r["source_sha256"] in sha_old
        res = "PASS" if not (pe or sk) else "FAIL"   # pn: reported; a conflict with another test is settled in the audit
        ok = ok and res == "PASS"
        f.write("\t".join([r["fastag_input"], r["pxd"], r["fastag_input_sha256"], r["source_sha256"],
                           *("yes" if x else "no" for x in (pe, pn, sk)), res]) + "\n")
assert ok, "disjointness FAIL"

q = tsv(D / "qualification.tsv")
L = ["| Set | PXD | Run | Draw rank | MS2 (filter) | Truth PSMs (2+, 3+, 4+) | mzML sha256 |", "|---|---|---|---|---|---|---|"]
for r in man:
    L.append(f"| {r['stratum']} | {r['pxd']} | {r['run']} | {r['draw_rank']} | {r['ms2_filter']} | "
             f"{r['truth_psms_q01']} ({r['truth_by_charge']}) | `{r['fastag_input_sha256']}` |")
L.append("")
L.append("Not selected: " + "; ".join(f"{x['pxd']} ({x['draw']} rank {x['draw_rank']}, set {x['set']}: "
         f"{x['qualifies'][4:] if x['qualifies'] != 'yes' else 'qualifies, beyond the first 3 projects of its set'})"
         for x in q if x["selected"] != "yes") + ".")
n = {s: sum(r["stratum"] == s for r in man) for s in ("ion_trap", "ft_old", "timstof")}
L.append("")
L.append(f"Selected per set: ion_trap {n['ion_trap']}, ft_old {n['ft_old']}, timstof {n['timstof']}. "
         f"Disjointness (`disjointness/compltol-H3.tsv`): {len(man)}/{len(man)} PASS.")
p = A / "PREREG-compltol-heldout3.md"
s = p.read_text()
assert "@RUNS@" in s
p.write_text(s.replace("@RUNS@", "\n".join(L)))

files = sorted(str(x.relative_to(D)) for x in D.rglob("*") if x.is_file() and x.name != "SHA256SUMS"
               and "results" not in x.parts and "__pycache__" not in x.parts)
with open(D / "SHA256SUMS", "w") as f:
    for x in files + ["../../manifests/compltol-H3.tsv", "../../disjointness/compltol-H3.tsv"]:
        f.write(f"{hashlib.sha256((D / x).read_bytes()).hexdigest()}  {x}\n")
print("FREEZE 2 TABLES OK", len(man), "runs", n)
