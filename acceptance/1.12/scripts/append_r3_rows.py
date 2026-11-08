#!/usr/bin/env python3
"""Append (never replace) the registry rows of round 3 (2026-11-08, DECISIONS-2026-11-08.md), one step per commit:
  a  DEC-1112-r3-NN: one user_decision note row per decision (no config in long form, so check_registry ignores them)
  b  HO-02-H2r, HO-06-H2r, HO-02-H1-r2, HO-06-H1-r2: heldout_manifest rows of the new manifests (sha256 of the file)
  c  -r3 status rows of #2/#6/#9 naming the 20 ppm and the 0.5 Da ion-trap configs as in frozen-configs.tsv
  d  HO-04-test-r3: CFG-04 frozen with PREREG-item04.md
  e  -r3 status rows of #3, #5, #7, #15B with the statuses of the decisions
Refuses a row id that already exists. Configs are written in the long form 'CFG-xx [status] <options> param_hash
<sha>' taken from frozen-configs.tsv at run time. Run check_registry.py afterwards.
Usage: append_r3_rows.py <acceptance dir> <registry.tsv> <step>"""
import csv, hashlib, sys

A, REG, STEP = sys.argv[1], sys.argv[2], sys.argv[3]
DAY = "2026-11-08"
RC = "RC a117801, FASTag.bin c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3"
SRC = "acceptance/1.12/DECISIONS-2026-11-08.md (round 3)"
def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))
cfg = {r["config"]: r for r in rd(f"{A}/frozen-configs.tsv")}
reg = rd(REG)
byid = {r["row_id"]: r for r in reg}
cols = open(REG).readline().rstrip("\n").split("\t")
def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()
def conf(cs):
    return "; ".join(f"{c} [{cfg[c]['status']}] {cfg[c]['options']} param_hash {cfg[c]['param_hash']}" for c in cs)
def row(**kw):
    r = {c: "" for c in cols}; r.update(recorded=DAY, refset=RC, source=SRC); r.update(kw); return r
def pxds(case):
    return ",".join(sorted({r["pxd"] for r in rd(f"{A}/manifests/{case}.tsv")}))
def status_row(rid, case, cs, notes, src=SRC):
    return row(row_id=rid, kind="heldout_status", item=byid_item(case), case=case, pxd=pxds(case),
               input=f"acceptance/1.12/manifests/{case}.tsv", input_sha256=sha(f"{A}/manifests/{case}.tsv"),
               flags=conf(cs), notes=notes, source=src)
def byid_item(case):
    return rd(f"{A}/manifests/{case}.tsv")[0]["item"]

rows = []
if STEP == "a":
    D = [
     ("01", "#7", "E7-03 release test", "DECISION 1 (user, 2026-11-08): E7-03 release test deferred to 1.12.1; 1.12.0 ships the #7 default (-acquisition_check refuse) with the E7-02 sweep evidence only. CFG-07 status becomes deferred_1.12.1 (step e). E7-03 not scored in 1.12.0."),
     ("02", "#2,#6,#9", "ion-trap cells at 0.5 Da + informativeness floor", "DECISION 2 (user, 2026-11-08): ion-trap cells of #2/#6/#9 are scored with NEW frozen configs identical to the existing ones except -fragment_tolerance 0.5 -fragment_tolerance_unit Da, used on ion-trap MS2 runs only; the existing 20 ppm configs stay for the high-resolution cells. Preregistered in PREREG amendments (cells, denominators, scorer sha256) before any scoring. Audit fix: a pre-specified informativeness floor on the reference (baseline) arm's rank-1 correct rate, derived from DEV ion-trap runs only (PXD001819 at 0.5 Da); below it a cell is 'uninformative' and never counts as PASS."),
     ("03", "#2,#6", "H2 reserves from PRIDE; H1 QE cell", "DECISION 3 (user, 2026-11-08): PRIDE accepted as the source of the Astral/timsTOF H2 reserves (PLAN DEVIATION from PLAN-data-types #2 'from the same corpora', recorded). PXD068073 dropped (methionine-oxidation study, excluded by the rule's intent). Registered: Astral PXD055983 (single run: underpowered, reported as such), timsTOF PXD070494 and PXD081146 (#2 only). H1 QE cell: PXD069528 (proposal's recommendation) added; PXD001540 moves to the ion-trap cell."),
     ("04", "#3,#5", "no held-out scoring in 1.12.x", "DECISION 4 (user, 2026-11-08): #3 and #5 are not scored on held-out data in 1.12.x; refit on DEV first and preregister a new config later. CFG-03-base, CFG-03-cand, CFG-05 status becomes not_scored_refit (step e). The held-out manifests stay registered and unread."),
     ("05", "#15B", "MSFragger truth", "DECISION 5 (user, 2026-11-08): the user will accept the MSFragger licence and provide its path; until then #15B is not scored. CFG-15B-base, CFG-15B-cand status becomes pending_msfragger (step e)."),
     ("06", "#4", "F4-10/11/12 and margin", "DECISION 6 (user, 2026-11-08): the user accepts the F4-10, F4-11, F4-12 proposals as recorded and the proposed margin; CFG-04 is frozen accordingly (with PREREG-item04.md: truth, cells, denominator, scorer sha256) and #4 is scored once."),
     ("07", "-", "PR #33", "DECISION 7 (user, 2026-11-08): PR #33 is merged by the main session after the release; not part of the acceptance registry."),
    ]
    for n, item, case, note in D:
        rows.append(row(row_id=f"DEC-1112-r3-{n}", kind="user_decision", item=item, case=case,
                        input="acceptance/1.12/DECISIONS-2026-11-08.md",
                        input_sha256=sha(f"{A}/DECISIONS-2026-11-08.md"), notes=note))
elif STEP == "b":
    VJ = {"item02-H2r": 6471787, "item06-H2r": 6471788, "item02-H1-r2": 6471789, "item06-H1-r2": 6471790}
    M = [("HO-02-H2r", "item02-H2r", "#2 H2 reserve from PRIDE (DECISION 3, plan deviation): Astral PXD055983 (1 run, underpowered), timsTOF PXD070494, PXD081146; PXD068073 dropped. Used only as the H2 reserve rule of PREREG-item02.md says."),
         ("HO-06-H2r", "item06-H2r", "#6 H2 reserve from PRIDE (DECISION 3, plan deviation): Astral PXD055983 only (1 run, underpowered; #6 has no timsTOF class)."),
         ("HO-02-H1-r2", "item02-H1-r2", "#2 H1 revision (DECISION 3): the 12 runs of item02-H1 with PXD001540 in stratum ion_trap (ITMS CID MS2) plus PXD069528 (Q Exactive, PRIDE) as the QE cell; 13 runs. Supersedes item02-H1 for scoring."),
         ("HO-06-H1-r2", "item06-H1-r2", "#6 H1 revision (DECISION 3): the 5 runs of item06-H1 with PXD001540 in stratum ion_trap plus PXD069528 as qe; 6 runs. Supersedes item06-H1 for scoring.")]
    for rid, case, note in M:
        rows.append(row(row_id=rid, kind="heldout_manifest", item=byid_item(case), case=case, pxd=pxds(case),
            input=f"acceptance/1.12/manifests/{case}.tsv (branch acceptance/1.12; files staged under data:/scratch/kohlbach/fastag-heldout-1.12 and BinAC2 $FT/heldout, sha256 per file in the manifest)",
            input_sha256=sha(f"{A}/manifests/{case}.tsv"),
            notes=note + f" sha256 of every FASTag input re-hashed from the staged file on node data (h2r-stage/r3_rehash.sha256, equal to the staging logs) and verified on BinAC2 against the manifest: jobs/verify-item.slurm job {VJ[case]} VERIFY_PASS. Disjointness: disjointness/summary.tsv (check_disjoint.py, PASS). Not run, not scored.",
            source="DECISIONS-2026-11-08.md; output/features-1.12/H2-reserve-proposal.md; scripts/build_r3_manifests.py"))
else:
    import importlib.util
    spec = importlib.util.spec_from_file_location("r3", f"{A}/scripts/r3_status.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    for rid, case, cs, note in m.ROWS[STEP]:
        rows.append(status_row(rid, case, cs, note))
clash = [r["row_id"] for r in rows if r["row_id"] in byid]
if clash:
    sys.exit(f"refusing: row ids already present: {clash}")
with open(REG, "a") as o:
    for r in rows:
        o.write("\t".join(r[c].replace("\t", " ").replace("\n", " ") for c in cols) + "\n")
print(f"appended {len(rows)} rows: {', '.join(r['row_id'] for r in rows)}")
