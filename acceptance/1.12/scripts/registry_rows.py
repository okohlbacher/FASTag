#!/usr/bin/env python3
"""Write the held-out manifest rows (HO-<item>-<split>) into validation-registry.tsv: one row per item and split,
with the manifest's sha256 (the manifest lists every file's sha256), the PXD list, strata, the frozen config(s) with
the RC binary sha256 and parameter hash, the disjointness result and the status. An existing row with the same id
is replaced only with --replace-uncommitted (never for a committed row); all other rows are kept as they are. Only the ids given are written (so H2 rows can be committed
before H1 rows). Usage: registry_rows.py <acceptance dir> <registry.tsv> <row_id>..."""
import collections, csv, hashlib, os, sys

A, REG = sys.argv[1], sys.argv[2]; WANT = [w for w in sys.argv[3:] if w != "--replace-uncommitted"]
REPLACE = "--replace-uncommitted" in sys.argv[3:]   # only for rows that are not committed yet (registry is append-only)
BIN = "c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3"
ROOT = "data:/scratch/kohlbach/fastag-heldout-1.12"
def rd(p):
    with open(p) as f:
        return list(csv.DictReader((l for l in f if not l.startswith("# ")), delimiter="\t"))
cfg = {r["config"]: r for r in rd(f"{A}/frozen-configs.tsv")}
dis = {r["manifest"]: r for r in rd(f"{A}/disjointness/summary.tsv")}

# row id -> (manifest, configs, plan source, status note)
SPEC = {
 "HO-01-heldout": ("item01-heldout", ["CFG-01-base", "CFG-01-cand"], "PLAN-organism-chemistry.md #1 Held-out protocol",
   "NOT READY: PREREG-species-call.md is a skeleton (DEV regeneration, grid fit and fitted species_call.tsv open). High-resolution MS2 check after conversion (column ms2_check/in_primary): the 3 PXD001819 runs have ion-trap MS2 and leave the primary set; primary = 52 runs (41 single, 11 multi-organism: PXD006118 x3, PXD023217 x3, 5 bigbio two-organism PXDs) from 48 PXDs (>= 40 runs, >= 25 PXDs, >= 10 multi: met); 25 pseudo-DDA runs reported separately."),
 "HO-10-heldout": ("item01-heldout", ["CFG-10-cand"], "PLAN-organism-chemistry.md #10 Validation",
   "NOT READY: same set as HO-01-heldout, second pre-registered config of #1; waits for the #1 fit."),
 "HO-02-H2": ("item02-H2", ["CFG-02-base", "CFG-02-cand"], "PLAN-data-types.md #2 Validation data (H2 reserve, hashed before H1)",
   "RULE NOT MET: the plan asks for >= 2 per class from the prose-auto heldout and validation_v3 corpora; ion trap 2/2 and QE 2/2 drawn, Astral 0/2 and timsTOF 0/2 (every DDA Astral and ddaPASEF run of those corpora is already an H1 run). Needs a user decision on another source before any H1 run. Used only for a retry."),
 "HO-02-H1": ("item02-H1", ["CFG-02-base", "CFG-02-cand"], "PLAN-data-types.md #2 Validation data (H1)",
   "BLOCKED: (1) H2 incomplete (HO-02-H2); (2) the plan's 'QE' run PXD001540 09JAN2014_HF_brain_new_45 fails the required analyser check: its MS2 are ion-trap CID (ITMS), not Orbitrap; the cell label or the run needs a user decision. Scored once per frozen config."),
 "HO-06-H2": ("item06-H2", ["CFG-06-base", "CFG-06-cand"], "PLAN-data-types.md #6 Validation data (H2 recorded before H1)",
   "RULE PARTLY MET: H2 per class = the #2 H2 run of that class: ion trap 2, QE 2, Astral 0 (no further DDA Astral run in the corpora); needs a user decision for Astral. Used only for a retry."),
 "HO-06-H1": ("item06-H1", ["CFG-06-base", "CFG-06-cand"], "PLAN-data-types.md #6 Validation data (H1)",
   "BLOCKED: Astral H2 missing (HO-06-H2); PXD001540 ('QE') has ion-trap MS2 (see HO-02-H1). E6-01 truth protocol (Sage charge_truth, MS1 envelope check) not run yet."),
 "HO-03-heldout": ("item03-heldout", ["CFG-03-base", "CFG-03-cand"], "PLAN-organism-chemistry.md #3 Held-out protocol",
   "NOT READY: PREREG-chem.md is a skeleton (DEV regeneration of the 254 runs, v2/calibration fits and the alkylation-proteome rule open). Amendment before any run (file formats only, replace_chem.py): 4 drawn PXDs whose files cannot be converted on Linux (PXD060719 SCIEX .wiff zips, PXD043396 an Excel file named .raw, PXD041616 Agilent .d, PXD000921 Bruker .yep/.baf) were replaced within their stratum by the next PXD of the seeded order; Arg-C has no further PXD with a usable run, so Arg-C holds 13 runs from 6 PXDs and is DESCRIPTIVE ONLY (< 15 runs). Usable now (staged, sha256 verified): 173 of 179; tryptic-truth runs 76 (>= 60 met); ddaPASEF 6 of 10 (the timsTOF endpoint needs >= 10: NOT MET until the 4 large .d downloads of PXD064980, PXD061564, PXD075150, PXD042657 verify; two PRIDE downloads differed or failed); PXD052116 and PXD050371 (tryptic) likewise unverified. Unverified rows are marked in stage_status and are not usable until re-verified. Runs whose #7 check refuses are investigated, not dropped."),
 "HO-04-test": ("item04-test", ["CFG-04"], "PLAN-qc.md #4; registry F4-06 (test split, seed 2)",
   "BLOCKED: margin not frozen; F4-10/F4-11/F4-12 need the user's sign-off before the test split is opened. Thermo_SRM_Pool_92 has no tryptic search (9 scored pools). Pool-level disjoint from dev; test pools TUM_second_pool_5 and dev TUM_first_pool_108 share LC-MS batch 01709a (the draw did not exclude dev batches for the test split); shared peptide identities are excluded by F4-12."),
 "HO-05-heldout": ("item05-heldout", ["CFG-05"], "PLAN-handoff.md #5 Validation data",
   "NOT READY: settings are frozen on dev PXD003531/PXD017035 and written to doc/SHORTLIST.md first; engine acceptance A5-02 on real data not run."),
 "HO-05-negative": ("item05-negative", ["CFG-05"], "PLAN-handoff.md #5 scenario (d)",
   "NOT READY: as HO-05-heldout. Must raise the protease error without -digest_out."),
 "HO-07-E7-03": ("item07-E7-03", ["CFG-07"], "registry E7-03/E7-10; PLAN-data-types.md #7 Release test",
   "BLOCKED: the 11 SCIEX .wiff files of DIA_swath (and 1 DDA_qexactive, 10 DDA_qtof) need msconvert on Windows. Without them the DIA strata hold 37 files (< 40) and SWATH/variable windows is not covered (DIA_swath.04 is a timsTOF .d), so the plan's rule does not allow dropping them. Not convertible on Linux either (column convertible_here): 11 more SCIEX .wiff (DDA_qtof, DDA_qexactive.03), 3 Agilent .d, 2 Bruker .baf, 1 Waters .raw. Converted here: 149 non-DIA and 37 DIA files (sha256 in the manifest); the pseudo-DDA stratum was made from all 37 convertible DIA files (23 Thermo: DIAspeXtract 1.7.0 on a constant-mobility copy; 14 timsTOF .d: diaTracer 2.2.1; pseudo_sha256 column), so the non-DIA side reaches >= 150 only with pseudo-DDA. Note: DIA_astral.03 and DIA_swath.04 are timsTOF .d files drawn into those strata by project metadata. Must pass before release."),
 "HO-09-H1": ("item09-H1", ["CFG-09-base", "CFG-09-cand"], "PLAN-data-types.md #9 Validation (B)",
   "READY when staged: 3 profile-MS2 runs (1 ion trap, 2 Orbitrap) converted without peak picking (TRFP -p) + 1 reserve (Orbitrap: the corpora hold no second ion-trap profile run with raw, so an ion-trap re-check after an analyser restriction has no reserve). Truth = Sage 1% FDR on the corpus' centroided mzML (truth_staged)."),
 "HO-11-f7test": ("item11-f7test", ["CFG-11"], "PLAN-qc.md #11 phase C (F7-test, seed 4)",
   "NOT IN SPRINT: F7 (phase C) is outside 1.12; manifest registered only. Opened only after the F7 thresholds are frozen."),
 "HO-11-final": ("item11-final", ["CFG-11"], "PLAN-qc.md #11 phase C (final, seed 5)",
   "NOT IN SPRINT: as HO-11-f7test; opened once, after F7-test."),
 "HO-15B-sets": ("item15B-sets", ["CFG-15B-base", "CFG-15B-cand"], "PLAN-data-types.md #15 phase B; registry E15B-03",
   "H1 = first two accepted sets, H2 = the third (split column), chosen together before any c/z run. Truth: MSFragger c/z 1% PSM FDR, z definition verified on PXD060724 first. An H1 failure is final unless a variant is confirmed on H2 only."),
 "HO-17-heldout": ("item17-heldout", ["CFG-17-base", "CFG-17-cand"], "PLAN-handoff.md #17 Validation data",
   "NOT READY: engine settings frozen on dev PXD003531 first; A5-02 not run. PXD000001 has a single raw file, which is also the species DEV/gate run (not #17 DEV)."),
}
lines = open(REG).read().split("\n")
if lines and lines[-1] == "": lines.pop()
cols = lines[0].split("\t")
idx = {c: i for i, c in enumerate(cols)}
have = {l.split("\t", 1)[0] for l in lines[1:]}
if (have & set(WANT)) and not REPLACE:
    sys.exit(f"refusing to replace existing rows {sorted(have & set(WANT))}: append a new row instead "
             "(scripts/append_status_rows.py), or pass --replace-uncommitted for a row that is not committed yet")
keep = [l for l in lines[1:] if l.split("\t", 1)[0] not in WANT]   # other rows kept byte for byte
for rid in WANT:
    man, cfgs, src, status = SPEC[rid]
    p = f"{A}/manifests/{man}.tsv"
    sha = hashlib.sha256(open(p, "rb").read()).hexdigest()
    m = rd(p)
    pxds = sorted({r["pxd"] for r in m})
    strata = collections.Counter(r.get("split", "") + ":" + (r.get("stratum") or r.get("pool", "")[:0] or r.get("split", "")) for r in m) \
        if "stratum" in m[0] else collections.Counter(r.get("split", "") for r in m)
    ok = sum(1 for r in m if r.get("stage_status", "").startswith(("copied", "sha1_ok", "no_pride_sha1"))
             and "FAIL" not in r.get("stage_status", "") and "MISMATCH" not in r.get("stage_status", "") and r.get("fastag_input_sha256"))
    d = dis.get(man, {})
    conf = "; ".join(f"{c} [{cfg[c]['status']}] {cfg[c]['options']} param_hash {cfg[c]['param_hash']}" for c in cfgs)
    new = [""] * len(cols)
    new[idx["row_id"]] = rid; new[idx["kind"]] = "heldout_manifest"; new[idx["item"]] = m[0].get("item", "")
    new[idx["case"]] = man; new[idx["refset"]] = f"RC a117801, FASTag.bin {BIN}"
    new[idx["pxd"]] = ",".join(pxds)
    new[idx["input"]] = f"acceptance/1.12/manifests/{man}.tsv (branch acceptance/1.12; files staged under {ROOT}, sha256 per file in the manifest)"
    new[idx["input_sha256"]] = sha
    new[idx["flags"]] = conf
    new[idx["notes"]] = (f"{len(m)} files from {len(pxds)} PXDs; strata " + ", ".join(f"{k} {v}" for k, v in sorted(strata.items()))
                         + f"; staged with sha256 {ok}/{len(m)}; disjoint from DEV: {d.get('result', 'not checked')} "
                         f"({d.get('failures', '?')} overlaps, acceptance/1.12/disjointness/{man}.tsv); STATUS: {status} "
                         "Each frozen config is scored exactly once; never re-scored after results, never tuned on held-out.")
    new[idx["recorded"]] = "2026-11-08"
    new[idx["source"]] = f"{src}; acceptance/1.12/scripts (selection rules in the script headers), frozen-configs.tsv"
    keep.append("\t".join(x.replace("\t", " ").replace("\n", " ") for x in new))
with open(REG, "w") as f:
    f.write("\n".join([lines[0]] + keep) + "\n")
print("written", WANT)
