#!/usr/bin/env python3
"""Check the held-out registry rows (HO-*) against frozen-configs.tsv and the manifests. Run before every held-out
run; a failure blocks the run.

For every (manifest, config) pair the LAST registry row that names the config in the long form
'CFG-xx [status] ... param_hash <sha256>' (row order = append order) must carry the config's current param_hash
and status from frozen-configs.tsv. Earlier rows stay in place as history (the registry is append-only). Every
heldout_manifest row's input_sha256 must equal the sha256 of its manifest file. Rows that name a config only in the
short form 'CFG-xx (abcd1234...)' are not checked (they are status notes, not config records).
Usage: check_registry.py <acceptance dir> [registry.tsv]   (exit 0 = pass, 1 = mismatch)"""
import csv, hashlib, re, sys

A = sys.argv[1]; REG = sys.argv[2] if len(sys.argv) > 2 else f"{A}/validation-registry.tsv"
LONG = re.compile(r"(CFG-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)?) \[([a-z_]+)\](?:(?!CFG-[0-9A-Za-z-]+ \[).)*?param_hash ([0-9a-f]{64})")
def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))
cfg = {r["config"]: r for r in rd(f"{A}/frozen-configs.tsv")}
last, fails = {}, []
for r in rd(REG):
    if not r["row_id"].startswith("HO-"):
        continue
    if r["kind"] == "heldout_manifest":
        p = f"{A}/manifests/{r['case']}.tsv"
        sha = hashlib.sha256(open(p, "rb").read()).hexdigest()
        if sha != r["input_sha256"]:
            fails.append(f"{r['row_id']}: manifest {p} sha256 {sha} != registry {r['input_sha256']}")
    for m in LONG.finditer(r["flags"]):
        last[(r["case"], m.group(1))] = (r["row_id"], m.group(2), m.group(3))
for (case, c), (rid, st, h) in sorted(last.items()):
    if c not in cfg:
        fails.append(f"{case} {c}: last row {rid} names a config not in frozen-configs.tsv"); continue
    if h != cfg[c]["param_hash"]:
        fails.append(f"{case} {c}: last row {rid} param_hash {h[:8]}... != frozen-configs {cfg[c]['param_hash'][:8]}...")
    if st != cfg[c]["status"]:
        fails.append(f"{case} {c}: last row {rid} status {st} != frozen-configs {cfg[c]['status']}")
for f in fails:
    print("FAIL", f)
print(f"registry check: {len(last)} (manifest, config) pairs, {len(fails)} failures: {'FAIL' if fails else 'PASS'}")
sys.exit(1 if fails else 0)
