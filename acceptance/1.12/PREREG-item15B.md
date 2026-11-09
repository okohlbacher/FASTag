# PREREG-item15B: #15 phase B c/z ion series (CFG-15B-cand against CFG-15B-base)

**Amendment 1 (2026-11-09) at the end of this file supersedes the text below where they differ: new sets
(item15B-sets-r2), MSFragger 4.4.1 pinned, z check passed, parameter files committed, scorer fixed. CFG-15B-base and
CFG-15B-cand are `frozen` from that commit.**

Status 2026-11-08: **protocol fixed except the truth engine's version and its z check; not run, not scored.**
Status of CFG-15B-base and CFG-15B-cand: **`pending_dev`**, not `frozen`. Two things the plan requires before any
held-out run are not done, and neither can be done in this round:

1. **MSFragger is not installed** on data or BinAC2 (only the OpenMS MSFraggerAdapter is). Installing it means
   accepting its academic licence, which only the user can do. Its version and the sha256 of its jar are therefore
   still open (`TO FILL` below).
2. **The z definition check on the DEV set PXD060724** (registry E15B-03: "with the z definition (z+1, OpenMS Zp1)
   verified on the dev set") has not run; it needs MSFragger.

When both are done (a DEV step, recorded with its numbers), this file is amended with the version, the jar sha256,
the parameter files and the check's result, and that commit sets the configs `frozen`. Everything else below is
fixed now. Each config is scored once; an H1 failure is final for 1.12 unless a variant is confirmed on H2 only.
Source: PLAN-data-types.md #15 phase B (Validation, Acceptance for auto as default), registry E15B-01..03, HO-15B-sets.

## Frozen software and configs

| What | Value |
|---|---|
| RC | a117801; FASTag.bin `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`; bundle SHA256SUMS `93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051` |
| CFG-15B-base | `RC defaults (-ion_series by)`, param_hash `3121296f353f76c9ccc630049cfd5f2b2d7309439a9c8e97445fda648aca39e3` |
| CFG-15B-cand | `-ion_series auto`, param_hash `5a5fe0c000a3c0db678e80ffee980a9fdad42b89036ac2f3a2799e3fb0e8fae5` |
| Truth engine | MSFragger, version **TO FILL** (jar sha256 **TO FILL**), standalone, output_format tsv |
| Scorer | `scorers/score_item15B.py` `0e8534dba9f513008d53f69d988157fa3fecdda8a8f0de59324427744777cc62`, `scorers/acclib.py` `d2342eb4c15e5801d9c13f2edcd1e56cec70349c941df0db2d061bb6630eeedf`, fastag_bench `score.py` `e2b8788a78f1176169f617c01b2e17f21578b8909f7c79b33d23ae1b71075f79` (REVERSED_OFFSET per ion series), `parsers.py` `01e27548bcae489d3f205960730c8bc36624e16935ea5df0bec5a6a04ea51f49` |
| Per-run truth settings | `scorers/truth/item15B.tsv` `da7d966057171fd37ba2f3d188b52d31db7da4004f5bca6b2b2595e3b95ef56e` |

The frozen option strings use the RC's 20 ppm fragment tolerance in both arms, also on the ion-trap MS2 of
PXD071331 and PXD014719; this protocol adds no tolerance.

## Runs

`manifests/item15B-sets.tsv` (sha256 `335a5212de1664c4050f309321ac072918cca934b5345bce06b079eea2c91919`, HO-15B-sets),
chosen with the split before any c/z run:

| Split | Set | PXD | Files | Activation (manifest; MS2 analyser from the file headers) |
|---|---|---|---|---|
| H1 | set6 | PXD071331 | 2 | EThcD only (ETD + supplemental beam-type CID), ion-trap MS2 |
| H1 | set7 | PXD024621 | 3 | HCD / ETD decision tree, both FTMS |
| H2 | set8 | PXD014719 | 3 | HCD / ETD decision tree, ion-trap MS2 |

Under `auto` the RC reads ETD/ECD spectra as c/z and every hybrid (EThcD/ETciD) spectrum as b/y with a warning
(registry E15B-01, the etd_auto gate case). **Consequence, stated before any run:** set6 is all hybrid, so the
candidate reads it exactly as the baseline; the electron-activated endpoint rests on the ETD spectra of set7 (about
45% of its MS2) alone.

## FASTag runs

One run per file and arm at the frozen options (cell `RC`): `FASTag -in <staged mzML> -out tags.tsv -threads <n>
<arm options>` in `runs/<CFG>/item15B-sets/<run dir>/RC/`, `FASTAG_RC=<rc>` appended to run.log.

## Truth search per run (MSFragger; version open, see Status)

Per run three searches on the staged mzML, restricted by MSFragger's `activation_types` (a search is run only when
the run has such spectra; `truth/item15B.tsv` column `searches`):

| Search | Spectra | fragment_ion_series | Output |
|---|---|---|---|
| by | HCD and CID | b,y | `msfragger_by.tsv` |
| cz | ETD (ECD) | c,z (z-dot: the definition the DEV check fixes) | `msfragger_cz.tsv` |
| hybrid | EThcD | b,y,c,z | `msfragger_hybrid.tsv` |

Common settings: database = the PRIDE project organism's panel proteome (PXD071331 Escherichia coli, PXD024621 Mus
musculus, PXD014719 Homo sapiens; paths and sha256 in `truth/item15B.tsv`) plus reversed decoys with prefix `rev_`;
strict trypsin, 2 missed cleavages, length 7-50; Carbamidomethyl C fixed; variable Oxidation M, protein N-term
Acetyl, plus Phospho S/T/Y (PXD024621, PXD014719) or AMPylation +329.0525 on H/K/S/T/Y (PXD071331), as each
project's PRIDE data-processing protocol states; at most 3 variable mods; precursor 20 ppm; fragment 20 ppm on FTMS
MS2, 0.5 Da on ITMS MS2; one hit per spectrum reported.
FDR: per search file, rank 1, target-decoy q-value on `expectscore` (q = min over thresholds of decoys / targets),
targets with q <= 0.01 (`score_item15B.fragger_psms`).

**DEV z check (to run before the freeze, PXD060724):** the cz search on PXD060724 (EThcD and ETD, chymotrypsin) must
show that MSFragger's z ions are z-dot (z+1): the median mass error of matched z ions under the z-dot definition
within 0.01 Da, and FASTag's c/z rank-1 tags (`-ion_series cz`) on its PSMs placed by the flank rule with
REVERSED_OFFSET cz. If not, the z setting is changed on DEV and the check repeated, before any held-out run.

## Denominator, cells and pooling

- Activation class per spectrum from the staged mzML's `<activation>` cvParams (the RC's phase-A classes): electron
  (ETD/ECD without supplemental collisional energy), hybrid (EThcD/ETciD), collisional (CID/HCD), unknown (not scored).
- Correct: paper flank rule on the rank-1 tag with the tag's ion series offsets (`ion_series` column; b/y otherwise).
  Denominator: every truth spectrum of the split's runs, both arms; untagged = not correct.
- E1 cell: electron spectra of the split, all charges pooled. E2 cells: hybrid and collisional x MSFragger charge 2, 3,
  4+ (an activation class without spectra has no cells), spectra pooled over the split's runs. Peptide-cluster
  bootstrap (2,000 draws) and Holm as PREREG-item02.md.

## Acceptance for `auto` as default (all must hold)

- (E1) Electron-activated spectra: cand - base >= +5.0 points and the 2.5th bootstrap percentile > 0.
- (E2) Non-inferior elsewhere (hybrid, collisional) with the #2 margins (>= 200 clusters, point > -0.5,
  Holm-adjusted bound > -1.0; underpowered cells block).
- (E3) Identical on collisional spectra: every baseline row of a collisional spectrum equals the candidate's row on
  the baseline's columns. The byte identity on collisional runs is the gate's (E15B-01: 7 collisional cases identical
  under auto); the PXD004732 robustness run is a DEV check outside this scorer.
- Any run with FASTAG_RC != 0 makes the verdict INCONCLUSIVE.

## Scoring command

    python3 -I scorers/score_item15B.py acceptance/1.12 H1 <staged root> <root>/runs <root>/truth <out>

## DEV test of the scorer (DEV outputs only)

No MSFragger output exists yet. `scorers/tests/run_dev_tests.sh` runs both arms on the collisional DEV runs PXD003531
and PXD001819 and writes the paper harness's Sage truths in MSFragger's tsv columns (`tests/sage_as_fragger.py`), which
tests the reader, the q-value, the activation classes and E2/E3 (expected: no electron spectra, so E1 FAIL with 0
clusters; collisional cells identical, E3 PASS). The c/z flank offsets are fastag-bench's own (tested there). Result:
`scorers/tests/dev_results/item15B.txt`. The MSFragger reader is checked again on the PXD060724 DEV search.

## Amendment 1 (2026-11-09): new sets, MSFragger 4.4.1, z check, parameter files, scorer fix; configs frozen

Written before any FASTag or MSFragger run on a file of item15B-sets or item15B-sets-r2. Everything below was fixed
on DEV data (PXD060724) or from file headers and PRIDE metadata only. The text above stays as the record of the
2026-11-08 protocol. Where this section differs, this section applies.

### What changes and why

| Change | Reason |
|---|---|
| set6 PXD071331 and set8 PXD014719 dropped | User decision 2026-11-09: MS2 in the ion trap; set6 is all hybrid (EThcD). Dropped before any run, never run (registry HO-15B-sets-r2-drop). Low-resolution (ion-trap) MS2 is out of scope. |
| set9 PXD009208 added to H1, set10 PXD010595 added as H2 | The 2026-11-09 decision asks for one more Orbitrap (FTMS) MS2 ETD set in H1 and one in H2, chosen by the existing selection rule (`inputs/staged/item15B-split-r2.tsv`). |
| Manifest `manifests/item15B-sets-r2.tsv` replaces `item15B-sets.tsv` | set7 rows are unchanged. |
| Ion-trap rows removed | Every run now has FTMS MS2. The fragment tolerance is 20 ppm in every truth search. No 0.5 Da setting is left in this protocol. |
| MSFragger version and jar pinned; z check done | Registry E15B-04 (DEV). |
| Held-out parameter files committed | `scorers/truth/item15B/` |
| Scorer reader fixed | MSFragger 4.4.1 names its protein column `proteins`; the old reader stopped with KeyError (E15B-04). |

### Frozen software

| What | Value |
|---|---|
| RC | a117801; FASTag.bin `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3` (verified on data 2026-11-09); bundle SHA256SUMS `93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051` |
| CFG-15B-base | `RC defaults (-ion_series by)`, param_hash `3121296f353f76c9ccc630049cfd5f2b2d7309439a9c8e97445fda648aca39e3` (unchanged) |
| CFG-15B-cand | `-ion_series auto`, param_hash `5a5fe0c000a3c0db678e80ffee980a9fdad42b89036ac2f3a2799e3fb0e8fae5` (unchanged) |
| Truth engine | MSFragger 4.4.1 standalone. Jar: `/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar`, 138742872 bytes, sha256 `56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112`. Banner "MSFragger version MSFragger-4.4.1", Batmass-IO 1.36.6. The BinAC2 copy `/pfs/10/project/bw26g016/diaspx-bench/tools/MSFragger-4.4.1.jar` has the same sha256 and may be used. |
| Java | OpenJDK 21.0.12.1 (build 21.0.12.1+1-1-24.04.4-Ubuntu), `/usr/bin/java` on data. MSFragger needs Java 17 or later. |
| Scorer | `scorers/score_item15B.py` `1d91c8f42491c34249dd2c7b6c3d40b99947ab7fa47f7a869be8e575633e4b11` (was 0e8534db). |
| Scorer libraries | `scorers/acclib.py` `fe387a3455a52678f78c20c3156b63c251e08daa5b92da2f3e205d1d9ab2b1c1` (the round 4 version). It replaces d2342eb4 in the table above. `holm_ni` is called without a floor, as for #15B before. fastag_bench `score.py` `e2b8788a78f1176169f617c01b2e17f21578b8909f7c79b33d23ae1b71075f79` and `parsers.py` `01e27548bcae489d3f205960730c8bc36624e16935ea5df0bec5a6a04ea51f49`, both unchanged. |
| Per-run truth settings | `scorers/truth/item15B.tsv` `298936f465d22e7fec241f811b033f0c5023403be95411a1a18d53fad56e54e1` (was da7d9660) |

**Scorer change: the reader only, plus the manifest name.** `fragger_psms` reads `protein` when that column
exists, else `proteins`. The default manifest is now `item15B-sets-r2`. The docstring names the new sets. Nothing
else changed.

The fixed scorer was tested on DEV data only:
- On the 6 PXD060724 MSFragger 4.4.1 DEV searches, its `cells_E2.tsv`, `identity_E3.tsv` and `runs.tsv` are
  byte-identical to the E15B-04 DEV-patched copy (`dev/item15B/results/reader_freeze.txt`).
- On the collisional Sage-as-MSFragger DEV test (`run_dev_tests.sh`, manifest dev15B), it gives the same verdict
  line and the same cell values as before. The cell table only gains acclib's informativeness columns (floor nan,
  informative True) (`dev/item15B/results/reader_freeze_sage.txt`).

### DEV z-definition check (PXD060724, E15B-04): PASS

MSFragger 4.4.1's `z` ion is z-dot (z+1, OpenMS Zp1), so the z setting is unchanged.

| Measure | Result |
|---|---|
| Median mass error of matched z ions under the z-dot definition | -0.00345 Da (n = 2386; about -5.5 ppm), within the 0.01 Da limit. c ions show the same offset (-0.00394 Da), so this is instrument calibration. |
| Theoretical ions with a peak within 20 ppm | z 0.102, z-dot 0.293, z+2 0.235 |
| MSFragger's own matched C-terminal fragments with a peak at the given definition | z-dot 0.736, even-electron z 0.154 |
| FASTag `-ion_series cz` rank-1 tags on the 299 cz PSMs placed by the flank rule with REVERSED_OFFSET cz | 205 (0.686) |
| Same tags placed with an even-electron z offset | 62 (0.207) |

On DEV, the cz ion series was run on EThcD spectra because PXD060724 has no ETD-only spectra. Full report:
`output/features-1.12/heldout-1.12/item15B-dev.md`.

### Runs (item15B-sets-r2, sha256 `9bff2fe5e33713f77b902e36c8f3ab12d459298629749ec7c91cbef397a76582`)

All runs are Thermo raw converted with ThermoRawFileParser 2.0.0 `-f 2` and staged under
`data:/scratch/kohlbach/fastag-heldout-1.12/item15B/sets/`. The sha256 of all 9 raw and 9 mzML files was re-verified
on data on 2026-11-09 against the manifest. Every MS2 is FTMS.

Activation counts:
- set7: from the manifest's cvParam counts.
- set9 and set10: from the selection scan (`inputs/staged/item15B-split-r2.tsv`). Electron means pure ETD by cvParams
  and filter string. Hybrid means ETD with supplemental CID (ETciD) or supplemental beam-type CID (EThcD).

| Split | Set | PXD | Organism | Files | electron (ETD) | hybrid (ETciD + EThcD) | collisional (HCD) | Truth searches |
|---|---|---|---|---|---|---|---|---|
| H1 | set7 | PXD024621 | Mus musculus | 3 | 33082 | 0 | 35478 | by, cz |
| H1 | set9 | PXD009208 | Homo sapiens (HeLa; Lys-C + trypsin; Af1521 ADP-ribose enrichment) | 3 | 16548 | 0 | 0 | cz |
| H2 | set10 | PXD010595 | Homo sapiens (ProteomeTools Part II, synthetic tryptic peptide pools) | 3 | 14669 | 26724 (12835 + 13889) | 0 | cz, hybrid |

Per-file counts:
- set9: 4780, 1960 and 9808 ETD.
- set10: 4510, 4538 and 5621 ETD; 8383, 8021 and 10320 hybrid.

Disjointness:
- `disjointness/item15B-sets-r2.tsv`: 9 files, 0 overlaps with the #15B DEV sets (PXD060724, PXD010783), PASS.
- `disjointness/item15B-sets-r2-cross.tsv` (`scripts/check_15b_r2_cross.py`): set9 and set10 checked against every
  item's DEV sets and every other item's manifest, by PXD and by file. 0 overlaps, PASS.
- PXD010595 is a different ProteomeTools accession from the #4 PXD004732.

### Truth search per run (replaces "Truth search per run" above)

**Database.** The PRIDE organism's prose-auto panel proteome (`/ceph/ibmi/abi/oliver/prose-auto-20261029/panel/`)
plus every entry reversed, with header prefix `rev_`, written after the targets. The files are built by
`scorers/truth/item15B/mkparams_heldout.py` (sha256 `92f34a964aaf5a4b7a82d15ea1b930a0bec36b43f01d5ff2bd1a9e2537e510a3`)
into `data:/scratch/kohlbach/fastag-heldout-1.12/item15B/truth/db/`.

| Set | Target FASTA | Target sha256 | Entries | Target-decoy FASTA | Target-decoy sha256 |
|---|---|---|---|---|---|
| set7 | `panel/Mus_musculus.fasta` | `465aa6f93f35b70a3d2e40ea3c93a703fb1e67763c1e4725fe71b700514c0d1b` | 17277 | `Mus_musculus.td.fasta` | `6fbd1069209ae5040fb9e7d64e63e4a99c549136545a1cef5b6b1b97cbe33642` |
| set9, set10 | `panel/Homo_sapiens.fasta` | `dffdff3807ec6eb7e752035b5475aaefa26d1b36e513e3344198d521a2169c42` | 20416 | `Homo_sapiens.td.fasta` | `0a26fb971c290863fa578fd77216131fd575d4efea0df513310997b5f037d671` |

**Parameter files** (`scorers/truth/item15B/`; the template is the E15B-04 DEV file). The only lines that differ
between files are `database_name`, `activation_types`, `fragment_ion_series` and the project's variable mods.

| File | Set | activation_types | fragment_ion_series | Extra variable mod | sha256 |
|---|---|---|---|---|---|
| msfragger_by_set7.params | set7 | HCD | b,y | 79.96633 STY, at most 3 (phospho) | `8a07e288439c6477e020bcfc4b4099b928ae14ab01f5dfed1d844050454d4663` |
| msfragger_cz_set7.params | set7 | ETD | c,z | 79.96633 STY, at most 3 (phospho) | `abc4db85e07923a2bdbd360df2d3d16b2706b15c3f10fae0127163860befc9cb` |
| msfragger_cz_set9.params | set9 | ETD | c,z | 541.06111 CDEHKRSTY, at most 1 (ADP-ribosylation) | `43d57a7ebc4ce5043e78d4240d745039d09a27d3764915f9f854ec912c2e11d9` |
| msfragger_cz_set10.params | set10 | ETD | c,z | none | `dbb8ae529dbb80529be07f7b16885724614010eb1e7128501a13cc1791831f1d` |
| msfragger_hybrid_set10.params | set10 | EThcD | b,y,c,z | none | `7c953f9fcd20b1189db0fbe3b6a70cf3de2c1d706e45e10b38c696e0d71c1db2` |

Common settings in every file:
- Enzyme: strict trypsin (KR, not before P), 2 missed cleavages, length 7-50, mass 500-6000.
- Fixed mod: C +57.021464.
- Variable mods: M +15.9949 (at most 3) and protein N-term +42.0106, plus the project mod above. At most 3 variable
  mods per peptide; `max_variable_mods_combinations` 5000.
- Tolerances: precursor ±20 ppm, fragment 20 ppm. `calibrate_mass = 0`, so the tolerances stay as set.
- isotope_error 0/1/2; precursor charge 1-6; max fragment charge 2; deisotope and deneutralloss on; precursor peak
  removed.
- Output: tsv, top 1, `report_alternative_proteins = 0`, 32 threads.

The project mods follow each PRIDE data-processing protocol:
- PXD024621: phospho on S/T/Y.
- PXD009208: ADP-ribosylation on C, D, E, H, K, R, S, T and Y. The authors also allowed up to 5 variable mods; this
  protocol keeps the common maximum of 3, and at most 1 ADP-ribose per peptide. That is the setting of the authors'
  unrestricted search. With at most 3 ADP-ribose, the index (1.4e9 modified peptides) did not fit in 48 GB in the
  DEV parse check.
- PXD010595: no further mods.

**DEV parse check of the frozen files (registry E15B-05;** `dev/item15B/results/paramcheck_heldout_params.txt`**).**
Each file was run once on the DEV file PXD060724 Trypsin_EThCD_WZ20spd_161224_1.mzML. No held-out file was read.
All exit codes are 0. The cz_set9 file needed `-Xmx64G` (peak RSS 57 GB). MSFragger 4.4.1's filters behave as
follows:
- `activation_types = ETD` admits EThcD scans: 10322 of 10322 were searched.
- `activation_types = HCD` admits none of them.

**MSFragger command (per run and search).**

    java -Xmx128G -jar MSFragger-4.4.1.jar <params> <truth>/item15B-sets-r2/<run_dir>/<stem>.mzML

- Run on data, or on BinAC2 with the same-sha256 jar and the database paths rewritten.
- The input is a symlink to the staged mzML inside the run's truth directory. MSFragger writes `<stem>.tsv` there,
  and that file is renamed to `msfragger_<search>.tsv`.
- Searches per run are listed in `truth/item15B.tsv` (column `searches`).
- The exit code is recorded as `FRAGGER_RC=<rc>` in `fragger.log`. The scorer is started only when every search
  of the split has FRAGGER_RC=0. A failed search (for example out of memory) may be repeated with the same
  parameter file before scoring; nothing in the parameter file may change.

**FDR (decision 4, 2026-11-09).** Plain target-decoy q-value on `expectscore`, per search file, rank 1, at 1% PSM FDR,
with no rescoring (`score_item15B.fragger_psms`).

**Which search gives a spectrum its truth.** The scorer takes the union of the PSMs of `by`, then `cz`, then
`hybrid`, and keeps the first PSM per spectrum (`drop_duplicates("key")`). Because the ETD filter admits EThcD, and
presumably ETciD, the `cz` search on set10 also covers its hybrid spectra. A set10 hybrid spectrum identified by both
searches therefore takes its `cz` PSM. This was fixed now, before any run. The activation class used for the cells
always comes from the staged mzML's cvParams, as before.

### Consequence for the endpoints, stated before any run (replaces the consequence above)

- **E1 (electron-activated, H1):** rests on set7's ETD spectra (33082; HCD/ETD decision tree) and on set9, where all
  16548 MS2 are pure ETD. H1 has no hybrid spectra.
- **E2 on H1:** only the collisional cells (set7 HCD, z2/z3/z4+). An activation class without spectra has no cells.
- **E3 on H1:** compares set7's collisional rows. set9 has no collisional spectra, so its identity check is
  satisfied with 0 rows.
- **H2 (set10), only to confirm a variant after an H1 failure:**
  - E1 on 14669 pure-ETD spectra.
  - E2 on the hybrid cells (ETciD + EThcD, which `auto` reads as b/y).
  - No collisional spectra, so E3 holds with 0 rows.
- **Known limit of the set10 truth:** the canonical Swiss-Prot panel proteome does not contain isoform-specific
  peptides of these synthetic "isoform" pools. They cannot be identified, and they do not enter the denominator.

### Scoring command (per README erratum: without `-I`)

    python3 scorers/score_item15B.py acceptance/1.12 H1 <staged root> <root>/runs <root>/truth <out>

Each config is scored once on H1. H2 is used only to confirm a variant after an H1 failure. Never re-score after
seeing results; never tune on held-out data.
