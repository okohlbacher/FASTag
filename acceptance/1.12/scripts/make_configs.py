#!/usr/bin/env python3
"""Frozen held-out configurations (FASTag 1.12 acceptance). One row per item and arm; param_hash = sha256 of
'binary=<sha>;bundle=<SHA256SUMS sha>;options=<options>;tables=<name:sha,...>' (UTF-8, no newline).
A config whose status is not 'frozen' cannot be scored: its open part is named in the row.
Usage: make_configs.py <out.tsv>"""
import hashlib, sys

BIN = "c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3"
BUNDLE = "93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051"   # rc-a117801/SHA256SUMS
T = {"species_call.tsv": "8aa40c29d3440d2bde29941dab85426c644c6aeac68487f1403fd653ce2723bf",
     "digest_models.tsv": "b486bbb2fc97c72192956c0cf1f64ddd5868570a61edb05953a98edc7bff7c36",
     "digest_models_v2.tsv": "da18f58e28c6b91cd7391e6c5be665ad3e3052debae75d2fd62545b6615e8e6d",
     "digest_calibration.tsv": "45451faf70e8691a95d4f5593fa1013b90505d0118763b42ab6e3467ed7c6a77",
     "massgap_mods.tsv": "c1ec6f57718c4f9ea84a975d9ef35a34ca542fcfcc7026aa21ff50f109caa106",
     "nodes.dmp": "d20f4f5b38e195c1ad77beef1f82296b96bab18588808c9c7527730928cdcecf",
     "names.dmp": "397b70d74a91a8e0b46eb68e46f8669296d90396d01a472a71f0c8585df7cb2b"}
C = [
 # id, item, arm, options, tables, status, note
 ("CFG-01-base", "#1", "baseline", "-species (1.10.0 q-rule, RC defaults)", "", "pending_dev",
  "taxdb and -species_* arguments fixed in PREREG-species-call.md after the DEV regeneration"),
 ("CFG-01-cand", "#1", "candidate", "-species -species_call decoy -species_call_params <fitted species_call.tsv> (alpha, tau, n_min, deconvolve from the DEV grid)",
  "species_call.tsv,nodes.dmp,names.dmp", "pending_dev_fit",
  "species_call.tsv at a117801 is PROVISIONAL (training_sha256 none); the fitted table and its sha256 go into PREREG-species-call.md before any held-out run"),
 ("CFG-10-cand", "#10", "candidate", "CFG-01-cand + -species_orientation both", "species_call.tsv,nodes.dmp,names.dmp",
  "pending_dev_fit", "second pre-registered config of #1, scored once on the #1 held-out set; no free parameter"),
 ("CFG-02-base", "#2", "baseline", "RC defaults (-complement_rule same_charge)", "", "frozen", ""),
 ("CFG-02-cand", "#2", "candidate", "-complement_rule both (tolerance 0.02 Da, unit Da, factor 0.5, mid-p off: defaults)", "",
  "frozen", "PLAN-INTEGRATION 4.2 compl_both = defaults plus -complement_rule both; #2 dev (5 runs) has no registry row yet: a dev-driven change of tolerance/unit/mid-p would be a new config"),
 ("CFG-03-cand", "#3", "candidate", "-digest_out -digest_models_version v2 -digest_detection shipped -digest_flank2 auto -digest_min_confidence <fit> -digest_calibration <fitted> -label_out -alkylation_out -alkylation_proteome <FASTA rule in PREREG-chem.md>",
  "digest_models.tsv,digest_models_v2.tsv,digest_calibration.tsv,massgap_mods.tsv", "pending_dev_fit",
  "v2 tables and calibration fitted on the 254 DEV runs (LOPO-CV) and frozen in PREREG-chem.md; bundled alkylation proteomes are not in 1.12.0, so the proteome rule must be fixed there"),
 ("CFG-03-base", "#3", "baseline", "-digest_out -label_out (shipped tables, 1.11 digest; label_call rows of #3a); majority / always-CAM baselines computed by the scorer",
  "digest_models.tsv,massgap_mods.tsv", "frozen", ""),
 ("CFG-04", "#4", "harness", "fastag-bench unidentified (feat/f4-tag-accuracy-harness 7ef0f33) with FASTag at defaults; RC tags at defaults equal 1.11.0 (BASELINE IDENTITY PASS)", "",
  "blocked_user_signoff", "margin not frozen; F4-10, F4-11, F4-12 amendments need the user's sign-off before the test split is opened"),
 ("CFG-05", "#5", "candidate", "-shortlist_out -fasta_out -shortlist_background <host+cRAP> -search_config_out -search_engine sage|comet (shortlist defaults: min_spectra 2, max_evalue 0.1, top 0, parsimony as doc/SHORTLIST.md at a117801)",
  "", "pending_dev", "settings are frozen on dev PXD003531/PXD017035 and written to doc/SHORTLIST.md before held-out runs (PLAN-handoff #5); engine acceptance A5-02 on real data not run"),
 ("CFG-06-base", "#6", "baseline", "RC defaults (-unknown_charge assume2)", "", "frozen", ""),
 ("CFG-06-cand", "#6", "candidate", "-unknown_charge infer (charge_min 2, charge_max 4, charge_infer_margin 2, isotope_error 0)", "",
  "frozen", "E6-01 dev tuning not run; the RC constants are the frozen values (a tuned constant would need a new RC)"),
 ("CFG-07", "#7", "release", "RC defaults (-acquisition_check refuse, probe 4000; thresholds frozen at 62abb64, E7-09)", "",
  "frozen", "scored on E7-03; blocked by the SWATH stratum (SCIEX .wiff, msconvert on Windows)"),
 ("CFG-09-base", "#9", "baseline", "RC defaults (-pick_profile legacy)", "", "frozen", ""),
 ("CFG-09-cand", "#9", "candidate", "-pick_profile auto", "", "frozen", ""),
 ("CFG-11", "#11", "phase_C", "-census -census_ids <Sage 1% idXML> (F7 model not built; -census_score not in 1.12)", "",
  "not_in_sprint", "PLAN-qc #11 phase C (F7) is outside the 1.12 sprint; F7-test/final manifests registered only"),
 ("CFG-15B-base", "#15B", "baseline", "RC defaults (-ion_series by)", "", "frozen", ""),
 ("CFG-15B-cand", "#15B", "candidate", "-ion_series auto", "", "frozen", "truth: MSFragger c/z 1% PSM FDR with the z definition verified on PXD060724 (dev) first"),
 ("CFG-17-base", "#17", "baseline", "closed search (Carbamidomethyl C fixed, Oxidation M variable); FASTag -search_config_out without -search_shifts", "", "pending_dev",
  "engine settings frozen on dev PXD003531 first (PLAN-handoff #17)"),
 ("CFG-17-cand", "#17", "candidate", "-search_shifts both (Comet; variable for Sage) defaults: shift_max_variable 3, shift_max_offsets 10, no site expansion", "massgap_mods.tsv",
  "pending_dev", "engine settings frozen on dev PXD003531 first; A5-02 engine acceptance not run"),
]
with open(sys.argv[1], "w") as o:
    o.write("config\titem\tarm\tbinary_sha256\tbundle_sha256sums\toptions\ttables\tparam_hash\tstatus\tnote\n")
    for cid, item, arm, opts, tabs, st, note in C:
        tl = ",".join(f"{t}:{T[t]}" for t in tabs.split(",") if t)
        h = hashlib.sha256(f"binary={BIN};bundle={BUNDLE};options={opts};tables={tl}".encode()).hexdigest()
        o.write("\t".join([cid, item, arm, BIN, BUNDLE, opts, tl, h, st, note]) + "\n")
