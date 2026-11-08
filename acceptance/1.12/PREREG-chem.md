# PREREG-chem: #3 chemistry calls (SKELETON)

Status 2026-11-08: **skeleton, not frozen.** The 254 DEV runs have not been regenerated with the RC, and the v2
tables, the calibration and the minimum confidence have not been fitted. No held-out run may start until the
sections marked TO FILL are filled, this file is committed with the fitted tables' sha256 and the final parameter
hash, and registry row HO-03-heldout names that commit. One primary endpoint per piece; every other metric is
secondary and descriptive. Each config is scored exactly once; nothing is tuned on held-out data.

## Frozen software

| What | Value |
|---|---|
| Release candidate | origin/integration/1.12 at a117801 |
| FASTag.bin sha256 | c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3 |
| Bundle | data:/scratch/kohlbach/fastag-heldout-1.12/rc-a117801, SHA256SUMS sha256 93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051 |
| digest_models.tsv (shipped, v1) | b486bbb2fc97c72192956c0cf1f64ddd5868570a61edb05953a98edc7bff7c36 |
| digest_models_v2.tsv at a117801 | da18f58e28c6b91cd7391e6c5be665ad3e3052debae75d2fd62545b6615e8e6d (to be replaced by the fitted table: TO FILL) |
| digest_calibration.tsv at a117801 | 45451faf70e8691a95d4f5593fa1013b90505d0118763b42ab6e3467ed7c6a77 (to be replaced by the fitted calibration: TO FILL) |
| massgap_mods.tsv | c1ec6f57718c4f9ea84a975d9ef35a34ca542fcfcc7026aa21ff50f109caa106 |
| Alkylation proteomes | NOT in 1.12.0 (CHANGELOG: `-alkylation_out` needs `-recon_fasta` or a FASTA path). Rule for the per-run FASTA (from the SDRF organism; UniProt release; sha256): TO FILL |
| Label rule (#3a) | ported from pinned prose-auto 0.1.10; parity on 193 DEV runs required (100%): result TO FILL |
| Scoring script | TO FILL (path, commit, sha256) |

Defaults in force: the RC's (1.11 plus #7 refuse). PLAN-INTEGRATION section 8 decision 2: the fits use this RC;
a later #2/#6/#9 default flip triggers a recorded refit before a #3 default flip.

## TRAIN/DEV (TO FILL after the regeneration)

- results/sdrf_truth_runs.tsv: 254 runs, 234 PXDs (trypsin 192, unspecific 16, Arg-C 7, Lys-C 6, Chymo 5, Asp-N 4,
  Glu-C 4, LysargiNase 1; CAM 153, none 19, methylthio 2), regenerated with the RC on node data. Run list sha256: TO FILL.
- Fits with leave-one-PXD-out CV: v2 tables, detection, flank2, calibration, `-digest_min_confidence`. Values and
  CV table: TO FILL.

## Configurations (acceptance/1.12/frozen-configs.tsv)

| Config | Options | Parameter hash |
|---|---|---|
| CFG-03-base | `-digest_out -label_out` (shipped tables, 1.11 digest, #3a label_call rows) | 37c1ff84...dc7 |
| CFG-03-cand | `-digest_out -digest_models_version v2 -digest_detection shipped -digest_flank2 auto -digest_min_confidence <fit> -digest_calibration <fitted> -label_out -alkylation_out -alkylation_proteome <FASTA rule>` | 9c04f9c1...6f9 (pre-fit; final TO FILL) |

Baselines: the majority class on the held-out set (protease, label) and always-CAM (alkylation).

## Held-out set (registry HO-03-heldout; manifest acceptance/1.12/manifests/item03-heldout.tsv)

Mined by acceptance/1.12/scripts/mine_bigbio.py and select_chem.py (rules in their headers) from
bigbio/sdrf-annotated-datasets 452596762d38f46924b5719aae9969c467c7fa17, PXDs outside the 234 DEV PXDs, the
prose-auto validation sets and corpora, and the 37 species DEV PXDs; committed before any run:

| Stratum | Runs | PXDs | Gates? |
|---|---|---|---|
| nontryptic:Lys-C | 15 | 15 | yes (>= 15 runs from >= 3 PXDs) |
| nontryptic:Arg-C | 13 | 6 | descriptive only (after the format replacement, see below) |
| nontryptic:Chymotrypsin | 15 | 15 | yes |
| nontryptic:Glu-C | 15 | 15 | yes |
| nontryptic:Asp-N | 15 | 15 | yes |
| nontryptic:unspecific | 15 | 15 | yes |
| nontryptic:LysargiNase | 6 | 3 | descriptive only |
| ddapasef | 10 | 10 | timsTOF endpoint (>= 10 runs) |
| alkylation_noncam | 15 | 15 | 'none' recall condition (>= 15 runs) |
| tryptic | 60 | 60 | protease endpoint (>= 60 tryptic runs) |

At most 3 runs per PXD per class; each PXD in one stratum. Amendment before any run (scripts/replace_chem.py, from file
formats only): PXD060719, PXD043396, PXD041616 and PXD000921 had files that cannot be converted on Linux and were
replaced within their stratum by the next PXD of the seeded order (Asp-N, Chymotrypsin, tryptic restored; Arg-C has
no further usable PXD). Runs whose staged file fails conversion, or whose
#7 check refuses (to be investigated, not dropped silently), are recorded in the manifest. Pseudo-DDA is not
in this set (no DIA stratum was drawn). Disjointness: acceptance/1.12/disjointness/item03-heldout.tsv.

## Primary endpoints and acceptance (PLAN-organism-chemistry #3)

- 3c-3f protease: balanced accuracy over trypsin, Lys-C and the pooled non-tryptic classes >= 0.75, with called
  accuracy >= 0.95 (Wilson LB >= 0.90) and accuracy with no-call counted wrong >= baseline.
- timsTOF: called accuracy >= 0.9 on >= 10 runs; otherwise the timsTOF call stays withheld.
- 3g alkylation: accuracy with no-call counted wrong >= always-CAM, with called accuracy >= 0.97 and 'none' recall >= 0.7.
- 3a label: accuracy >= majority baseline + 5 points.
Each piece passes or fails on its own. Metrics also reported: accuracy among called, per-class recall with Wilson CIs.
