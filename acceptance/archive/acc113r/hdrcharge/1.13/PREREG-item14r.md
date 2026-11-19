# PREREG item 14r: backlog 14 (hdrcharge), second held-out round, new rule

Status: **FROZEN**, 2026-11-10. This file, the manifest, the disjointness table, the frozen config and the scorers
were committed and pushed (branch `acc113r/hdrcharge`) before the candidate binary read any file of
`manifests/item14r-hdrcharge.tsv`. Before the freeze these files were only downloaded, converted
(ThermoRawFileParser), charge-stripped and searched with Sage (qualification, below). No header charge of these
files was compared with anything, and no FASTag binary read them.

The first round (`PREREG-item14.md`, rule of c1a6607) is spent; its five runs and its DEV runs are excluded here.

Files of this item:

- `hdrcharge/scripts-r/`, `hdrcharge/scorers/`, `hdrcharge/inputs-r/`, `hdrcharge/SHA256SUMS-r`;
- `manifests/item14r-hdrcharge.tsv`, `disjointness/item14r-hdrcharge.tsv`;
- the `CFG-14r-warn` row of `frozen-configs.tsv`;
- the `HO-14r-*` rows of `validation-registry.tsv`.

## What is evaluated

`-check_header_charge` of `feat/b113-hdrcharge` at 8e3f127 (rule commit 2c253e2; described in
`doc/HEADER-CHARGE-CHECK.md` of that branch). Binary: `data:/scratch/kohlbach/b113/hdrcharge/fix2/FASTag`, copied
to `data:/scratch/kohlbach/b113/hdrcharge/frozen-r/FASTag`, sha256
`509cec79d178e4b7e159c0faa0ad86d7af56431ffe8909ef73d0261db23fb835`.

Provenance check (2026-11-10): the build tree of that binary differs from `git archive 2c253e2` only in `README.md`,
`doc/HEADER-CHARGE-CHECK.md`, `gui/src/paramUi.ts`, `gui/src/params.generated.json` and
`test/header_charge_cli_test.sh`. No compiled source differs, and 2c253e2..8e3f127 changes no compiled source
either, so the binary was not rebuilt.

Frozen config `CFG-14r-warn` (param_hash = sha256 of the options string); every other option is at its default:

    -check_header_charge warn -check_header_out hc.tsv -threads 16

A flag is a row of the `-check_header_out` table with verdict `disagree`.

## Data and split

Five human, unlabelled, tryptic DDA runs from five PRIDE projects (public data only): three Q Exactive-family and
two Orbitrap Astral. `hdrcharge/scripts-r/select_heldout_r.py` holds the full rule; in short:

- Pool: `acceptance/1.12/inputs/h2r_pride_candidates.tsv`; only PXD numbers divisible by 4 (cross-arm rule); not in
  `hdrcharge/inputs-r/excl_pxd.tsv` (1,634 PXDs: `alknodb/prereg-exclude-pxd.txt`, the lists reserved by shifts,
  census and species, and the hdrcharge DEV and spent runs PXD003531 PXD001819 PXD030418 PXD031485 PXD006882
  PXD082249 PXD058340 PXD070945 PXD070580 PXD066686 PXD001769 PXD003850 PXD009815 PXD070049 PXD074582).
- Order: `random.Random('fastag-1.13:hdrcharge:heldout-r:<class>')` shuffle of the sorted pool accessions; projects
  are read in that order until 3 (qe) and 2 (astral) are taken.
- Project rule on the PRIDE record: one organism (Homo sapiens), every instrument of the class, trypsin named, no
  label, no PTM enrichment or special chemistry, no non-human or mixed material. Each passing project was read
  against its text before any download.
- File rule: a `.raw` file of 0.2-8 GB, no blank/QC/standard name, no DIA token; Astral in addition needs DDA
  evidence (file name contains "dda", or the PRIDE experiment type is data-dependent and not data-independent).
  The files are shuffled with `random.Random('fastag-1.13:hdrcharge:heldout-r:<class>:<PXD>')`; the first is the
  chosen file, the second the backup, used only when the chosen file fails the download or the conversion.
- File check after conversion: instrument of the class in the mzML, at least 5000 MS2 spectra, at least 90 % of
  them with a selected-ion charge, at least 1000 distinct isolation targets.
- Qualification: the Sage truth search (below) must give at least 500 truth spectra. A failing project is replaced
  by the next one of the seeded order.

The draw (`hdrcharge/inputs-r/draw.tsv`, 347 rows; PRIDE records in `hdrcharge/inputs-r/pride.tgz`):

| class | PXD | draw rank | instrument | sample | file | file role |
|---|---|---|---|---|---|---|
| qe | PXD037572 | 2 | Q Exactive HF | HEK293T, HA-EYA3 affinity purification, on-bead trypsin | `20210815_PHCOQEHF_PC878-Giudice_5.raw` | chosen |
| qe | PXD016408 | 4 | Q Exactive HF-X | HEK-293, GFP-METTL9 GFP-Trap pull-down | `20171128_QE5_nLC3_MJ_MT9GFPclone5_Rep1_5ul.raw` | chosen |
| qe | PXD033520 | 5 | Q Exactive | human cells, GFP-XPA co-immunoprecipitation | `q108996a.raw` | chosen |
| astral | PXD071028 | 73 | Orbitrap Astral | HCT116, 3xFLAG-UFM1 co-IP from the ribosomal pellet (MMTS alkylation) | `20251007_A2_N1_Grujic_Dagdas_GMI_ID2315_DDA_2per_S12_ANS-FLAG-IP-3.raw` | backup |
| astral | PXD080900 | 89 | Orbitrap Astral | HEK293T, PCNA immunoprecipitation from chromatin (SP3) | `20260612_AST1_IMB_HU_0491_IP_NON_90.raw` | chosen |

- qe: 228 pool projects; ranks 1 (PXD017772) and 3 (PXD010248) were rejected as mouse; ranks 2, 4 and 5 taken.
- astral: 119 pool projects; ranks 73 and 89 taken; rejected before them: organism 35, PTM or special chemistry 15, no eligible file 13,
  instrument mix 12, no trypsin 9, sample 2, label 1; 30 behind rank 89 not judged.
- Staging (`hdrcharge/inputs-r/qualification/`): the PRIDE downloads were unstable (truncated transfers). The first
  staging attempt of PXD033520 and of PXD080900 ended without a verified file (`attempt1/`); the retry count and,
  for files without a PRIDE SHA-1, a resumed verification download were then added to `stage_r.sh`, and both
  projects were staged again with their chosen file. PXD071028 had already moved to its backup file after a
  truncated verification download of the chosen file; the backup passed (two downloads, same sha256) and is kept.
  No file choice depended on any content of a run.
- Every run passed the file check and the qualification; no project was replaced.

Rule revision before any download (2026-11-10): the first form of the Astral rule took none of 86 candidates,
because no Astral project of the pool names a file "dda" and three regex terms hit ordinary text ("cysteine" the
alkylation step, "ubiquit" protein names, "phospho" the tool name phosphoRS). The revised rule widens the Astral
pool to every h2r row, accepts the PRIDE experiment type as DDA evidence and drops those three terms. The seeds
are unchanged, and the Q Exactive draw is the same under both forms.

Limits of this set, known before the freeze:

- The Astral class is close to exhaustive. The two taken projects are ranks 73 and 89 of the 119 Astral projects
  of the pool; the 87 before and between them fail the rule, and the 30 behind rank 89 were not judged. The h2r
  Astral pool equals PRIDE's full keyword result for "Astral".
- All five projects are affinity-purification samples from human cell lines, so their complexity is lower than
  that of a lysate.
- PXD071028 alkylates with MMTS and PXD033520 was searched by its authors without carbamidomethylation. The truth
  search keeps C+57 fixed, so cysteine peptides of these two runs are mostly missing from the truth. That lowers
  the number of truth spectra and does not mislabel a charge.

The held-out runs are disjoint from DEV and from the spent runs by PXD and by file sha256
(`disjointness/item14r-hdrcharge.tsv`).

## Truth

Sage 0.14.7 (`/ceph/ibmi/abi/oliver/opt/sage-0.14.7`) on the charge-stripped copy (`scripts/strip_charge.py`: every
`MS:1000041` line dropped), so Sage never sees the header charge. `hdrcharge/scripts-r/truth_r.sh` writes the
configuration:

- trypsin KR/P, 2 missed cleavages, length 7-50, b/y;
- C+57.021464 fixed, M+15.994915 variable (max 2);
- precursor 10 ppm, fragment 20 ppm, precursor_charge [1, 4], isotope_errors [-1, 3], deisotope on;
- FASTA `/ceph/ibmi/abi/oliver/jpr-bench/data/PXD054073/UP000005640_9606.fasta` (sha256
  `1f028a9ab2bca643c0e121c01ba3e05c92136beaa693a6197a32a025670df4bc`), Sage's `rev_` decoys.

A truth spectrum is a target, rank 1 PSM with `spectrum_q` <= 0.001. Its charge is the truth charge. A header is
wrong when it differs from the truth charge.

The truth search ran before the freeze as the qualification. Its result files are frozen by sha256 (manifest
columns `truth_sha256`, `chimera_sha256`), and the run script refuses other files:

| PXD | truth spectra | FASTag input (mzML) sha256 | truth `results.sage.tsv` sha256 | chimera `results.sage.tsv` sha256 |
|---|---|---|---|---|
| PXD037572 | 2,760 | `6bc0b50da474c123864a5b55b733e910474a7f429ab2fb20e82d06f483b8a284` | `040fcd9b8971ef11c2b051a274ae76800fec4d98b86786dc036fc4773d622f24` | `f126e9b8784b09e80e96bedfd421f8eee2b5b3ac1b8204eb87f18c4c75eb1ca7` |
| PXD016408 | 27,576 | `8eaf7219c88238ac213afef31c04c5ee4a9127ee39567118585f4f2d543b5692` | `040b51774b1ee5605a9b3da8f0da409aff8cd6da41e1a327a8ee08e924807fe1` | `19730935eb98a4f256f6ed70d8ca7bb7fc7d7010db5a90057520125a528fefdb` |
| PXD033520 | 3,158 | `5c3dba4b6c3533da21895257065a51b202fe79b46856f6f44693d1e01a5ffde9` | `3250e347aaceaf3c1b6287dc4fe9252c45a5b39aace70b2382e3938a8e5c9d5b` | `ecb83088cf36d1a367ef50fd88be5ac25b1c4d8116ca1889a3e6246c8714653a` |
| PXD071028 | 27,155 | `2bc92370cb2b922fb9328bf460ad9519052e9b6e7c1f62e2db7926e42ba27b2d` | `adfc05c6e05cf2a7d88c5e519f6eede6ef23ff9a74b0421e146de7b72f06b056` | `b3db210e21ad693efc59c5243563c03d960b2ad043ee0e26d3f1ba556290c05c` |
| PXD080900 | 24,657 | `4e570df09e3364dfbcf19b684961a73b191b0d749341bae688ad3045148327cd` | `3480f3a8da18560a3118ad3ba2ae16909fb7cadb55bd1554932988800995fc9a` | `a8274bfa46d655693bad478cd4956233053c2bd03a799a510fce3454efd4da66` |

Only the number of truth spectra was read from these files. Wrong headers were not counted before the freeze.

## Denominator

A truth spectrum counts when it has a row in the `-check_header_out` table with a header charge in 1..4 (Sage's
charge range). `right` = header equals the truth charge, `wrong` = it differs, `flagged` = verdict `disagree`,
tp = flagged and wrong, fp = flagged and right. Spectra are matched by scan number.

A run is evaluable when FASTag exits 0 on the as-given file, the check table exists and the run has at least 500
truth spectra in the denominator.

## Primary endpoint and criteria

Headers as given, pooled over the evaluable runs.

| | Criterion | DEV, extended (in-sample) |
|---|---|---|
| H0 | at least 4 of the 5 runs evaluable, and at least 200 wrong headers pooled | |
| H1 | precision tp / flagged: Wilson 95 % lower bound >= 0.60 (no flag at all: not met) | precision 0.75 |
| H2 | sensitivity tp / wrong >= 0.20 | 0.33 |
| H3 | right headers flagged, fp / right: <= 0.005 pooled and <= 0.010 in every evaluable run | 0.0027 |

Verdict rule:

- **PASS**: H0, H1, H2 and H3 are all met.
- **FAIL**: H0 is met and at least one of H1, H2, H3 is not.
- **INCONCLUSIVE**: H0 is not met.

A PASS does not make the option a default. A FAIL is a valid result.

## Reported, not criteria

- the same counts per run and per instrument class (qe, astral);
- perturbed copies (`scripts/perturb_charge.py`: the charge of every scan with scan % 5 == 0 changed by 1; truth =
  the original header where Sage confirms it): precision, sensitivity;
- decoy estimate of false "wrong" labels: decoy PSMs at the same threshold whose charge differs from the header
  (`decoy_other`), against the number of wrong headers;
- chimera split (`scorers/hc_chimera.py`): wrong headers for which Sage's chimera mode finds a second peptide with
  the header charge (q <= 0.01), and the counts without them;
- precision when the flagged charge must equal the Sage charge (`precision_charge`).

## Technical failure after the freeze

- FASTag exits non-zero or writes no check table on an as-given file: the run is not evaluable. It is not replaced
  and not rerun with other settings. H0 then decides between a verdict and INCONCLUSIVE.
- Infrastructure failure (node down, disk full, job killed from outside, shown by the log): the identical command
  is rerun once for that arm, after its directory is moved aside. The rerun is recorded in the result.
- A manifest sha256 mismatch stops the script before any FASTag run; nothing is scored until the staged file is
  restored to the frozen hash.
- A scorer crash: the fix is committed as an erratum that changes no criterion and no count definition, before
  the scorer runs again. A scorer that has written `score/verdict.json` is not run again.
- A failure on a perturbed copy affects only the reported perturbed numbers.

## Scorer and command

`hdrcharge/scorers/score_item14r.py`, `verdict_item14r.py` and `hc_chimera.py`; `test_item14r.py` runs the verdict
on synthetic input for PASS, each single FAIL (H1, H2, H3 pooled, H3 per run) and each INCONCLUSIVE case (too few
evaluable runs, too few wrong headers, technical failure). sha256 of every script: `hdrcharge/SHA256SUMS-r`
(its own sha256 is in registry row `HO-14r-heldout-PREREG`):

    29e35dfc5375aba7835dc81cf9f0de64bd3347efe062db6093eb1ac21b796f8d  scorers/hc_chimera.py
    357d4c9d7ab52bdffefee87ea76c84cabbb33188f4d79c8c94299a4aa8636ddb  scorers/score_item14r.py
    8cdf9f8052910852af14663f415af7e79a8146b6c841ad8da673af69d8df69ef  scorers/test_item14r.py
    9c7f7c25642ccb753804dc94dbe84167e01892ccb4347de481ace3488826e51a  scorers/verdict_item14r.py
    9527fd97b337734df71cf5b75c717e1a85b4585ca3822f3b21742dabf74fa8f8  scripts-r/build_manifest_r.py
    45ffc1096225d279ee26a666b1027b107f0b9edaa0cb2e03d95365181a4c1be4  scripts-r/draw_loop.sh
    1e52c7e1a81d9298840262b6c105b6b603797af4cbd76b749660bc40b5c5e20d  scripts-r/qualify_one.sh
    75f01f6a050a848bc916fedf5bbb94d2442770d4ba0c51eab15436ac4c773544  scripts-r/run_heldout_r.sh
    e45d201d5148f901f2a6cfa6f3c117b8b232369ce89481e942e0cdf8c321425f  scripts-r/select_heldout_r.py
    49b6e9e1df12f3ee3e46958f8576e1ee3243be3b55e12f70e09ffe1d7d19963b  scripts-r/stage_r.sh
    2f9df1fc1908287f30ee55f6b40507c33df641e9929998706e35deb6168c9177  scripts-r/truth_r.sh
    2b4e0c3753f7800c056f1be36ea7ba1872ccbec9ccdb4477a01adeaf561b34ab  scripts/strip_charge.py
    e3805379e75f2a0c531959d1f1c0e8b9130edf0b2e47c2b1c05fb252fb6f3b7a  scripts/perturb_charge.py

Interpreter: Python 3 of `/ceph/ibmi/abi/oliver/jpr-bench/envs/py` (standard library only), run with `-I`.

    bash acceptance/1.13/hdrcharge/scripts-r/run_heldout_r.sh acceptance/1.13 /scratch/kohlbach/b113/hdrcharge/heldout/r2

The script refuses another binary, a config that is not `frozen`, a script or input whose sha256 differs, and an
existing `score/`. It runs once and scores once. Nothing is tuned on these runs.

## DEV

The rule was developed on PXD003531, PXD001819 and the extended DEV runs listed above
(`output/backlog-1.13/hdrcharge/RESULTS-extended-DEV.md`): sensitivity 0.33, precision 0.75, right headers
flagged 0.27 %. The thresholds H1-H3 were set by the coordinator before this round and are below the DEV values.
