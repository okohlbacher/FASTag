# PREREG-item09: #9 profile centroiding (CFG-09-cand against CFG-09-base)

**Amendment 1 (round 3, 2026-11-08) at the end of this file: the ion_trap stratum is scored with 0.5 Da twins,
and an informativeness floor applies.**

Status 2026-11-08: **protocol fixed; CFG-09-base and CFG-09-cand `frozen` in the commit that adds this file. Not
run, not scored.** It closes the four gaps of `output/features-1.12/heldout-1.12/item09.md` (truth search per run,
the run without a truth database, the cells, the scorer). Each config is scored exactly once, on data or on BinAC2
under the README's conditions; nothing is tuned on held-out data.
Source: PLAN-data-types.md #9 (Validation (B), (C); Analyser restriction), registry HO-09-H1, HO-09-H1-NOTRUN.

## Frozen software and configs

| What | Value |
|---|---|
| RC | a117801; FASTag.bin `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`; bundle SHA256SUMS `93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051` |
| CFG-09-base | `RC defaults (-pick_profile legacy)`, param_hash `d8f123767df353602ac8b908f32867d99184d8e893c6df85b9b1ff59b24c59b2` |
| CFG-09-cand | `-pick_profile auto`, param_hash `7552cfe4ff8f72d0ffb3649c6e89bd9a1fb4d40c97e94f502b191f70444022a2` |
| Truth engine | Sage v0.14.7, binary sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625` |
| Scorer | `scorers/score_item09.py` `0f8078b77675f7a57013bdccbfe0c20ef6f4b8836e8a32f33ba9d169670afe34` (uses `score_item02.collect`: `7928403d16627a7fab4f7e2faadaa76c87225b5f039ea42071af1f7a3b68c52e`), `scorers/acclib.py` `d2342eb4c15e5801d9c13f2edcd1e56cec70349c941df0db2d061bb6630eeedf`, fastag_bench `score.py` `e2b8788a78f1176169f617c01b2e17f21578b8909f7c79b33d23ae1b71075f79`, `parsers.py` `01e27548bcae489d3f205960730c8bc36624e16935ea5df0bec5a6a04ea51f49` |
| Truth configs | `scorers/truth_config.py` `899e387c2d08e02c371f7c1318994c0ecc3e0f208d7bce2eab740b0c25c66ec5` from `scorers/truth/item09.tsv` `fb13f923b75fa571c29aceab8ea7274bfc63b74b139b5539633222d3933b5b4b` |

Both configs run at the RC defaults, so PXD009049 (ion-trap MS2) is tagged at 20 ppm fragment tolerance in both
arms; this protocol adds no tolerance (that would change the frozen configs). On the centroided ion-trap DEV run
PXD001819 these options give about 4% rank-1 correct (PREREG-item02.md), so the ion_trap stratum may well be
underpowered (fewer than 200 clusters with a difference to measure) and block the endpoint.

## Runs

`manifests/item09-H1.tsv` (sha256 `0fe7d7ba4fbe0748952e86541f970f8e9fc6a386d981ee6260cc66c38b36e013`): 3 H1
profile-MS2 runs (converted without peak picking, ThermoRawFileParser -p) and 1 reserve, staged and verified on data
and BinAC2 (verify job 6467070, inputs and truth mzMLs).

**Rule for a run without a truth database (fixed now, before any run, from metadata only):** PXD035981 (orbitrap_tof)
has the SDRF organism "gut metagenome", for which no proteome of the panel exists, so no truth database can be named.
It is not evaluable, as in PREREG-chem.md's alkylation rule. The reserve PXD018024 (orbitrap_tof; the corpora hold no
second ion-trap profile run, so the reserve could never serve the plan's ion-trap re-check) takes its place. The
scored set is:

| Stratum | PXD | Run | Truth database |
|---|---|---|---|
| ion_trap | PXD009049 | Nsco_Citro_CPX_rep1_fraction04 | panel/extra/Citrobacter_rodentium.fasta |
| orbitrap_tof | PXD016519 | 170524_15_Orbi2_SK_SER_G90_T125_Chalmers_Campbell_EasyPhos_Glucose_P-R1-9 | panel/Saccharomyces_cerevisiae.fasta |
| orbitrap_tof | PXD018024 (reserve) | Fozzie_20170704_GY_GBM_T3_Rph8 | panel/Homo_sapiens.fasta |

With this, the plan's minimum (3 runs, >= 1 ion trap, >= 1 Orbitrap/TOF) holds and **no reserve remains**.

## FASTag runs (cells)

Per run and arm: `L3_default`, `L4_default`, `L5_default` = the frozen option string plus `-tag_length 3/4/5` (CLI
default profile; #9 does not change deisotoping). Command: `FASTag -in <staged profile mzML> -out tags.tsv -threads
<n> <arm options> -tag_length <L>` in `runs/<CFG>/item09-H1/<run dir>/<cell>/`, `FASTAG_RC=<rc>` appended to run.log.

## Truth search per run

Sage 0.14.7, `scorers/truth_config.py scorers/truth/item09.tsv <staged root> <panel dir> <out>` (mode `closed`), on
the run's **centroided corpus mzML** (manifest `truth_input`, staged as `truth_staged`, same sha256; same raw file,
so the scan numbers join), as PREREG-item02.md (same fixed search settings), with per run:

- PXD009049: Citrobacter rodentium; SILAC (prose-auto Lys4/Arg6; SDRF "SILAC"): Lys4/Lys8 and Arg6/Arg10 variable;
  CAM static; Trypsin/P; fragment 0.5 Da, deisotoping off (ion-trap MS2).
- PXD016519: Saccharomyces cerevisiae; EasyPhos phospho enrichment: Phospho S/T/Y variable; CAM static; Trypsin/P;
  20 ppm.
- PXD018024: Homo sapiens; TMT (prose-auto TMT10/11): TMT6plex mass static on K and peptide N-term; CAM static;
  Trypsin; 20 ppm.
- All: Oxidation M variable, max_variable_mods 2, precursor 10 ppm; target, rank 1, spectrum_q <= 0.01.

## Denominator, cells and pooling

- Correct: paper flank rule on the rank-1 tag (as PREREG-item02.md). Denominator: every truth spectrum of the run,
  both arms; untagged = not correct.
- Cells: analyser stratum (ion_trap, orbitrap_tof) x length (3, 4, 5) x Sage charge (2, 3, 4+) = 18 cells, spectra
  pooled over the stratum's runs (orbitrap_tof: 2 runs). Charge-1 PSMs reported apart.
- Statistic: as PREREG-item02.md (cand - base in points; 2,000 peptide-cluster bootstrap draws; Holm over the
  powered cells at one-sided 0.025).

## Acceptance (all must hold; failure keeps `legacy` the default)

- (B1) Non-inferiority of `auto` in every cell with the #2 margins: >= 200 clusters, point > -0.5, Holm-adjusted
  bound > -1.0. An empty or underpowered cell is inconclusive and blocks.
- (B2) No fewer tagged spectra: for every run and length, spectra with >= 1 tag row under `auto` >= under `legacy`.
- (C) Picking cost per spectrum: reported from the Slurm accounting (or `/usr/bin/time`) of the runs; not gating.
- Any run with FASTAG_RC != 0 or without truth makes the verdict INCONCLUSIVE.
- **If the ion_trap stratum fails (B1 or B2):** the verdict carries `ANALYSER_RESTRICTION_NEEDED`. The plan's
  analyser restriction is not in the RC; enabling it is a new RC and a new config, and no ion-trap reserve exists to
  re-check it, so in 1.12 `auto` could at most be recommended for high-resolution MS2, after the user decides
  (PLAN-INTEGRATION section 8, decision 6).

## Scoring command

    python3 -I scorers/score_item09.py acceptance/1.12 <root>/runs <root>/truth <out>

Output (`result.json`, `cells_B1.tsv`, `tagged_B2.tsv`) to `results/item09/` with a registry row. One array: 3 runs x
2 configs x 3 cells, plus the 3 Sage truth searches.

## DEV test of the scorer (DEV outputs only)

No profile DEV run has a Sage truth, so the test uses the centroided #2 DEV runs PXD003531 and PXD001819 as
stand-ins in both arms (centroided input: `legacy` and `auto` tag the same). Expected and found: difference 0 in
every cell (pass where powered), B2 PASS, B1 INCONCLUSIVE because every 4+ cell has fewer than 200 clusters (106,
169). Result: `scorers/tests/dev_results/item09.txt`, `dev_results/item09/`.


## Amendment 1 (round 3, 2026-11-08): ion-trap stratum at 0.5 Da, informativeness floor

Decision 2 of `DECISIONS-2026-11-08.md`. It is committed before any #9 run. CFG-09-base and CFG-09-cand were
`frozen` by this file and have not been run or scored. They stay frozen with their option strings unchanged. From
now on they are scored only on the orbitrap_tof stratum.

| Arm | orbitrap_tof (PXD016519, PXD018024) | ion_trap (PXD009049) |
|---|---|---|
| baseline | CFG-09-base `d8f123767df353602ac8b908f32867d99184d8e893c6df85b9b1ff59b24c59b2` | CFG-09-base-it05 `5f161daa1462998386eab74831aac7113dd7171d1a608f18226444dfa521b6ac` |
| candidate | CFG-09-cand `7552cfe4ff8f72d0ffb3649c6e89bd9a1fb4d40c97e94f502b191f70444022a2` | CFG-09-cand-it05 `91cd355288bdeb1a97ed93c4c9945cc8a5149c4b3066d1c186b14795c0cc51b9` |

- The twins add only `-fragment_tolerance 0.5 -fragment_tolerance_unit Da`. PXD009049's truth search was already at
  0.5 Da.
- The run directories of the ion_trap stratum are `runs/CFG-09-*-it05/item09-H1/...`. The array is 3 runs x 2 arms
  x 3 cells, with the ion-trap run using the twins. Each of the four configs is scored exactly once.
- Cells, denominators, B1/B2 and the ANALYSER_RESTRICTION_NEEDED rule are unchanged. B2 compares the twins on the
  ion-trap run.

| Scorer file (scorers/) | sha256 |
|---|---|
| `acclib.py` | `7dd85f2888b4b082aae2762ca9ff4a8464adf1b811dafad01caf1551416ef15a` |
| `score_item02.py` | `f2693089ba38c71a3d0ab5984b2700348d16ef6a5014149c1e92c7dcba52900a` |
| `score_item06.py` | `ef24599a4e978e3ed67f100333fd4cdf10c5b48f59eb5470248a1a8ab52ecc72` |
| `score_item09.py` | `b0ef694172e5bb64e0487233819d663389cac0c4c3c540549bf2f8eef88cd3ca` |
| `truth_config.py` (unchanged) | `899e387c2d08e02c371f7c1318994c0ecc3e0f208d7bce2eab740b0c25c66ec5` |
| `truth/item02.tsv` | `42920f3b4d4b27ce72efc998aa12d156aaafcfd081fc0f350e916c9e8aba720e` |
| `truth/item09.tsv` (unchanged) | `fb13f923b75fa571c29aceab8ea7274bfc63b74b139b5539633222d3933b5b4b` |
| `strip_charge.py` (unchanged) | `2b4e0c3753f7800c056f1be36ea7ba1872ccbec9ccdb4477a01adeaf561b34ab` |
| `tests/run_dev_tests_r3.sh` | `818e8dc4f1896d51d91287b8d2f2225f2addbc3aae53db2ba8dbfdb31317eb3e` |

The fastag_bench files `score.py` (`e2b8788a78f1176169f617c01b2e17f21578b8909f7c79b33d23ae1b71075f79`) and
`parsers.py` (`01e27548bcae489d3f205960730c8bc36624e16935ea5df0bec5a6a04ea51f49`) are unchanged. Commit f93b33c
already carried the scorer edits of this amendment, before SHA256SUMS and this text were updated. Nothing was run in
between. The hashes above are the binding ones.

**Informativeness floor (audit finding).** Non-inferiority passed on cells where both arms are near zero. The scorer
now marks a cell `uninformative` when the reference (baseline) arm's rank-1 correct rate in that cell is below
**1.8%** (`acclib.INFO_FLOOR_PCT`). Such a cell is not tested, is not in the Holm family, and never counts as a pass.
Unless another cell fails, it makes the endpoint INCONCLUSIVE. The floor applies to every cell of the endpoint, in
every set.

The floor was derived from DEV ion-trap data only: the #2/#6 DEV run PXD001819 (LTQ Orbitrap Velos, ion-trap MS2),
tagged at 0.5 Da by CFG-02-base-it05 in the 18 cells of #2, scored against its paper-harness Sage truth
(`tests/run_dev_tests_r3.sh`; scored first without a floor,
`tests/dev_results_r3/floor_input_cells_i_nofloor.tsv`).
- The rule: one half of the lowest reference rate among the DEV ion-trap cells with at least 200 clusters, rounded
  down to 0.1 point.
- The lowest such cell is L5_nodeiso z3 at 3.678% (1,088 clusters), which gives 1.8%.
- The other powered DEV ion-trap cells at 0.5 Da are L3-L5 z2 at 18.8-35.3% and z3 at 3.7-6.9%. The z4+ cells
  have 106 clusters and are at 0.2-0.4%.
- At 20 ppm, 16 of the 18 DEV ion-trap cells are below 1.8% (`tests/dev_results/item02/cells_i.tsv`). These are
  the cells the audit named.
- No held-out file was read.

**DEV test (DEV outputs only).** `tests/dev_results_r3/item09.txt`, with the stand-in arms of the first test and
PXD001819 at 0.5 Da. B1 is INCONCLUSIVE: the ion-trap 4+ cells are uninformative and the orbitrap 4+ cells are
underpowered. B2 is PASS.
