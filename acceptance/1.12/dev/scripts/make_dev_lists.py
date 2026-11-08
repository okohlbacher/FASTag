#!/usr/bin/env python3
"""DEV run lists for the 1.12 DEV regeneration (#1/#10 species, #3 chemistry).
  species: bench/fastag-bench/config/species_runs.tsv (48 runs, 37 PXDs)
  chem:    acceptance/1.12/inputs/sdrf_truth_runs.tsv (254 runs) joined on (set, acc, run) with
           /ceph/ibmi/abi/oliver/fastag-digest-val/runs.json (input path, gap_cmd, termini)
Usage: make_dev_lists.py <repo> <runs.json> <out dir>"""
import csv, json, os, sys

REPO, RUNS, OUT = sys.argv[1:4]


def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))


os.makedirs(OUT, exist_ok=True)
sp = rd(f"{REPO}/bench/fastag-bench/config/species_runs.tsv")
with open(f"{OUT}/species_dev_all.tsv", "w") as o:
    o.write("run_id\tpxd\tpath\n")
    for r in sp:
        o.write(f"{r['run_id']}\t{r['pxd']}\t{r['mzml']}\n")
tr = rd(f"{REPO}/acceptance/1.12/inputs/sdrf_truth_runs.tsv")
J = json.load(open(RUNS))
idx = {(r["set"], r["acc"], r["run"]): i for i, r in enumerate(J)}
miss = 0
with open(f"{OUT}/chem_dev_all.tsv", "w") as o:
    o.write("run_id\tpxd\tpath\tjson_index\n")
    for r in tr:
        k = (r["set"], r["acc"], r["run"])
        if k not in idx:
            # the 10 nontryptic_new runs: converted by jpr-bench/sdrf/nontryptic/nt_run.sh (not in runs.json)
            p = f"/ceph/ibmi/abi/oliver/jpr-bench/sdrf/nontryptic/mzML/{r['acc']}/{r['run']}.mzML"
            if os.path.exists(p):
                o.write(f"{r['set']}__{r['acc']}__{r['run']}\t{r['acc'].split('-')[0]}\t{p}\tnt\n")
                continue
            miss += 1
            print("MISSING", k)
            continue
        i = idx[k]
        o.write(f"{r['set']}__{r['acc']}__{r['run']}\t{r['acc'].split('-')[0]}\t{J[i]['input']}\t{i}\n")
print(f"species {len(sp)}, chem {len(tr)} ({miss} not in runs.json)")
