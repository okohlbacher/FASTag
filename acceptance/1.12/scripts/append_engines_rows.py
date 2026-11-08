#!/usr/bin/env python3
"""Append (never replace) the #5/#17 engine rows of 2026-11-08 round 2: A5-02-r2 (engine acceptance on the fixture
and on real DEV data), A5-01-r2 (real `comet -p` and the negative-offset check, recorded here instead of a fixture
swap), DEV-05-FREEZE and DEV-17-FREEZE (dev/engines/FREEZE-05-17.md), and one '-r2' status row per #5/#17 manifest
with the configs as now in frozen-configs.tsv. Refuses to write a row id that already exists. Run once; then
check_registry.py. Usage: append_engines_rows.py <acceptance dir> <registry.tsv>"""
import csv, sys

A, REG = sys.argv[1], sys.argv[2]
DAY = "2026-11-08"
def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))
cfg = {r["config"]: r for r in rd(f"{A}/frozen-configs.tsv")}
byid = {r["row_id"]: r for r in rd(REG)}
cols = open(REG).readline().rstrip("\n").split("\t")
def conf(cs):
    return "; ".join(f"{c} [{cfg[c]['status']}] {cfg[c]['options']} param_hash {cfg[c]['param_hash']}" for c in cs)
RC = "RC a117801, FASTag.bin c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3"
SRC = "acceptance/1.12/dev/engines (FREEZE-RULES.md 61bda59, FREEZE-05-17.md, results/, scripts/)"
def row(**kw):
    r = {c: "" for c in cols}; r.update(recorded=DAY, refset=RC, **kw); return r
rows = [
 row(row_id="A5-02-r2", kind="engine_acceptance", item="#5", case="search_engine_smoke_test + DEV real-data searches",
     pxd="PXD003531,PXD017035", input="test/fixtures/Ecoli_MS2_small.mzML; DEV mzMLs (FREEZE-05-17.md)",
     notes="PASS. Supersedes the NOT RUN of A5-02. Node data, Sage 0.14.7 (binary d3820543...64625), Comet 2026.03.0 "
     "(ad93b4cf...fa91e7ed). (1) search_engine_smoke_test.sh at a117801 with FASTAG_ENGINES_REQUIRED=1 and both engines: "
     "all checks passed (Sage 21 target PSMs at q <= 0.05, Comet 95 target rows; results/smoke/smoke.log). (2) Real DEV "
     "data: 51 searches on FASTag-written configurations (2 DEV runs x full/9 reduced databases x 2 engines, #17 closed, "
     "shift-carrying and diagnostic configurations on PXD003531), all exit 0, target PSMs at 1 % FDR per search Sage "
     "2067-16619, Comet 2057-16220; Sage results.json echoes the exported tolerances, isotope errors and modifications. "
     "(3) Comet keys against the real comet -p of the pinned binary (A5-01-r2): 15 variable_mod slots in the 8-field "
     "format accepted; isotope_error is the mode 0..3 = 0..n (closed search with -search_isotope_errors 2: Comet +56 % "
     "PSMs); positive mass_offsets searched (399 PSMs at +17.03 Da). No held-out file read.",
     source=SRC),
 row(row_id="A5-01-r2", kind="deviation_check", item="#5", case="comet_template_and_negative_offsets", pxd="PXD003531",
     input="acceptance/1.12/dev/engines/comet.params.new (comet -p, Comet 2026.03.0)",
     input_sha256="0b6abd4c7415a9289d858d3c8fc84031c31d62acf10f174a8123070ebd8fb8fc",
     notes="CHECKED, fixture NOT replaced. test/fixtures/comet_template.params stays (RC a117801 frozen; search_config_test "
     "expects the fixture's deliberate defects: missing keys, TMT on add_Nterm_peptide, Lys_C enzyme, so a swap needs a "
     "test change in the next RC). The real comet -p output is kept on acceptance/1.12 instead. Against it: 15 slots, "
     "8-field slot format, isotope_error mode 0=off 1=0/1 2=0/1/2 3=0/1/2/3 (FASTag's n -> n mapping is right), "
     "mass_offsets 'subtracted from the deconvoluted precursor mass'. Negative offsets: on PXD003531 the closed Comet "
     "config with mass_offsets '0.0 -17.026549' gave rows byte-identical to the config without offsets (3730 target "
     "PSMs, 0 at -17.03), the mirror '0.0 17.026549' 4219 PSMs with 399 at +17.03 (results/dev17/negoff_*.txt). Comet "
     "2026.03.0 silently ignores negative offsets; the RC's dropped_engine rule for them loses nothing Comet could "
     "search. Still unverified: none of the A5-01 items.", source=SRC),
 row(row_id="DEV-05-FREEZE", kind="dev_freeze", item="#5", case="shortlist grid", pxd="PXD003531,PXD017035",
     input="ref50.fasta 2bc7295c... + cRAP 4b0e6e97...; DEV mzMLs 2b1da222..., 20f78fcc...",
     flags=f"CFG-05 param_hash {cfg['CFG-05']['param_hash']}",
     notes="DEV MISS, frozen by the pre-committed rule. Grid max_evalue {0.01,0.1,1} x min_spectra {1,2,3}, Sage and Comet, "
     "post-reduction entrapment r=1, 1 % PSM FDR, vs the full ref50+cRAP search. No point admissible (DB recall >= 0.95, "
     "retained >= 0.90 on both runs and engines). Frozen 1/1 (largest minimum retained recall 0.826, PXD003531 Sage; "
     "DB recall >= 0.830; FDP <= 1.36 %; residues reduced >= 49x). PXD017035 0.89-0.91, PXD003531 0.83-0.84. The RC "
     "defaults 0.1/2 keep 0.54 of PXD003531's peptides. Not edited into doc/SHORTLIST.md (RC frozen); "
     "FREEZE-05-17.md is the written freeze.", source=SRC),
 row(row_id="DEV-17-FREEZE", kind="dev_freeze", item="#17", case="shift grid", pxd="PXD003531",
     input="Homo_sapiens.fasta dffdff38... + shuffled entrapment r=1; DEV mzML 2b1da222...",
     flags=f"CFG-17-base param_hash {cfg['CFG-17-base']['param_hash']}; CFG-17-cand param_hash {cfg['CFG-17-cand']['param_hash']}",
     notes="RC defaults frozen (shift_max_variable 3, shift_max_offsets 10). Closed search 3930 Sage / 3730 Comet target "
     "PSMs at 1 % FDR; default candidate 9964 (+154 %, FDP 1.28 %) / 10360 (+178 %, FDP 1.34 %); (1,10) and Comet (3,3) "
     "lower. Diagnostic closed search with isotope errors 0..2 (added after the grid): +53 % / +56 %, so about a third "
     "of the gain is the exported isotope range. Exported on this run: Phospho (S), Carbamyl (N-term), Dioxidation (M), "
     "9 Comet offsets; Gln->pyro-Glu (-17.020) and Met-loss+Acetyl dropped_cap. MSFragger+PTM-Shepherd top-10 "
     "criterion not covered on DEV.", source=SRC),
]
NOTE = ("STATUS: NOT READY (pending_prereg). DEV freeze done (DEV-05-FREEZE, DEV-17-FREEZE) and A5-02 PASS (A5-02-r2); "
        "the config option strings changed with the freeze, so the param_hash differs from the earlier row. Open before "
        "any held-out run: PREREG-item%s.md with the truth database per run, %s, the denominators and the scorer with its "
        "sha256 (README gate). Not run, not scored; each config still available for exactly one scoring.")
for rid, cs, what in [("HO-05-heldout", ["CFG-05"], "the arms (full, reduced, selection-symmetric, post-reduction entrapment) and the host proteome per run; #5 also carries the DEV miss for the user to weigh"),
                      ("HO-05-negative", ["CFG-05"], "the expected protease refusal check"),
                      ("HO-17-heldout", ["CFG-17-base", "CFG-17-cand"], "entrapment and the MSFragger+PTM-Shepherd top-10 reference")]:
    o = byid[rid]
    item = "05" if rid.startswith("HO-05") else "17"
    rows.append(row(row_id=rid + "-r2", kind="heldout_status", item=o["item"], case=o["case"], pxd=o["pxd"],
        input=f"acceptance/1.12/manifests/{o['case']}.tsv", input_sha256=o["input_sha256"], flags=conf(cs),
        notes=NOTE % (item, what), source="dev/engines/FREEZE-05-17.md; frozen-configs.tsv"))
clash = [r["row_id"] for r in rows if r["row_id"] in byid]
if clash:
    sys.exit(f"refusing: rows exist already: {clash}")
with open(REG, "a") as f:
    for r in rows:
        f.write("\t".join(r[c].replace("\t", " ").replace("\n", " ") for c in cols) + "\n")
print(f"appended {len(rows)} rows")
