#!/usr/bin/env python3
"""compltol held-out 2: fill the freeze tables from the manifest and the qualification table. No FASTag run.
freeze.py <acceptance/1.13 dir>     (run once, from the repository root, before the freeze commit)
Writes disjointness/compltol-H2.tsv, the four CFG-CT2 rows of frozen-configs.tsv, the @...@ fields of
PREREG-compltol-heldout2.md and compltol/heldout2/SHA256SUMS."""
import csv, hashlib, re, subprocess, sys
from pathlib import Path

A = Path(sys.argv[1]); D = A / "compltol/heldout2"
BIN = "ea096d0c1e7b8e5816e03f5026914d0007c56632ae2fe8f1d43be143d75d3392"
IT = "-fragment_tolerance 0.5 -fragment_tolerance_unit Da"
CFG = [("CFG-CT2-base", "baseline", "defaults (-complement_tolerance_unit Da, -complement_tolerance 0.02)", "high-resolution runs (astral, qe)"),
       ("CFG-CT2-cand", "candidate", "-complement_tolerance_unit auto (-complement_probe 500, fallback -complement_tolerance 0.02: defaults)", "high-resolution runs (astral, qe)"),
       ("CFG-CT2-base-it05", "baseline", "defaults + " + IT, "ion_trap runs only"),
       ("CFG-CT2-cand-it05", "candidate", "-complement_tolerance_unit auto + " + IT, "ion_trap runs only")]


def tsv(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


man = tsv(A / "manifests/compltol-H2.tsv")
excl = set((D / "select/excl_pxd.txt").read_text().split())
# every sha256 recorded under acceptance/ before this test (own files excluded)
old = subprocess.run(["git", "grep", "-ohE", "[0-9a-f]{64}", "origin/acceptance/1.13", "--", "acceptance"],
                     capture_output=True, text=True).stdout.split()
old = set(old)
ok = True
with open(A / "disjointness/compltol-H2.tsv", "w") as f:
    f.write("# compltol held-out 2: PXD against compltol/heldout2/select/excl_pxd.txt (reserved lists, DEV, first test, every PXD used on the acceptance and acc113r branches); sha256 against every sha256 under acceptance/ of origin/acceptance/1.13\n")
    f.write("file\tpxd\tfastag_input_sha256\tsource_sha256\tpxd_excluded\tsha256_known\tresult\n")
    for r in man:
        pe = r["pxd"] in excl
        sk = r["fastag_input_sha256"] in old or r["source_sha256"] in old
        res = "PASS" if not pe and not sk else "FAIL"
        ok = ok and res == "PASS"
        f.write("\t".join([r["fastag_input"], r["pxd"], r["fastag_input_sha256"], r["source_sha256"],
                           "yes" if pe else "no", "yes" if sk else "no", res]) + "\n")
assert ok, "disjointness FAIL"
assert len(old) > 100 and len(excl) > 2000

fc = A / "frozen-configs.tsv"
txt = fc.read_text()
assert "CFG-CT2-" not in txt
hashes = {}
for name, arm, opt, scope in CFG:
    h = hashlib.sha256(f"{BIN}\t{opt}".encode()).hexdigest()
    hashes[name] = h
    txt += "\t".join([name, "compltol held-out 2 (#15 backlog)", arm, BIN, "-", opt, "-", h, "frozen",
                      f"origin/integration/1.13 e21d803 built on data (OpenMS 70cebcd144); {scope}; cell options "
                      "-tag_length 3/4/5 [-no_deisotope], -threads 16; PREREG-compltol-heldout2.md; param_hash = "
                      "sha256(binary_sha256 TAB options); scored once"]) + "\n"
fc.write_text(txt)

runs = ["| Set | PXD | Run | Draw rank | MS2 (filter) | Truth PSMs (2+, 3+, 4+) | mzML sha256 |", "|---|---|---|---|---|---|---|"]
for r in man:
    runs.append(f"| {r['stratum']} | {r['pxd']} | {r['run']} | {r['draw_rank']} | {r['ms2_filter']} | "
                f"{r['truth_psms_q01']} ({r['truth_by_charge']}) | `{r['fastag_input_sha256']}` |")
q = tsv(D / "qualification.tsv")
runs.append("")
runs.append("Not selected: " + "; ".join(f"{x['pxd']} ({x['stratum']} rank {x['draw_rank']}: "
            f"{x['qualifies'][4:] if x['qualifies'] != 'yes' else 'qualifies, beyond the first 3 projects'})"
            for x in q if x["selected"] != "yes") + ".")
na = sum(r["stratum"] == "astral" for r in man)
astral = (f"one project ({na} files of PXD069807); the metadata rule left no second Astral DDA project with files of a usable size."
          if na else "no Astral run: the two files of the only Astral project that passed the selection rule did not qualify "
          "(see the qualification table). The set where the first test failed (i) is therefore NOT re-tested.")
p = A / "PREREG-compltol-heldout2.md"
s = p.read_text()
for k, v in {"@H_BASE@": hashes["CFG-CT2-base"], "@H_CAND@": hashes["CFG-CT2-cand"], "@H_BASEIT@": hashes["CFG-CT2-base-it05"],
             "@H_CANDIT@": hashes["CFG-CT2-cand-it05"], "@NRUNS@": str(len(man)), "@RUNS@": "\n".join(runs),
             "@DISJ@": f"{len(man)}/{len(man)} PASS", "@ASTRAL@": astral}.items():
    assert k in s, k
    s = s.replace(k, v)
assert not re.search(r"@[A-Z_]+@", s)
p.write_text(s)

files = sorted(str(x.relative_to(D)) for x in D.rglob("*") if x.is_file() and x.name != "SHA256SUMS"
               and "results" not in x.parts and "__pycache__" not in x.parts)
with open(D / "SHA256SUMS", "w") as f:
    for x in files + ["../../manifests/compltol-H2.tsv", "../../disjointness/compltol-H2.tsv"]:
        f.write(f"{hashlib.sha256((D / x).read_bytes()).hexdigest()}  {x}\n")
print("FREEZE TABLES OK", len(man), "runs")
