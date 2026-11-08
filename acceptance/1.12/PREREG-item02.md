# PREREG-item02: #2 complement rules (CFG-02-cand against CFG-02-base)

**Amendment 1 (round 3, 2026-11-08) at the end of this file supersedes the provisional rules below. CFG-02-base,
CFG-02-cand and their 0.5 Da ion-trap twins are `frozen`.**

Status 2026-11-08: **protocol fixed; not run, not scored.** This file fixes the truth search per run, the cells and
their pooling, the denominator and the scorer (README, scoring-protocol gate). Status of CFG-02-base and CFG-02-cand:
**`blocked_user_signoff`**, not `frozen`: two open user decisions change what this protocol scores (release
readiness, decision 4): (1) the plan's QE run PXD001540 has ion-trap MS2, and (2) the H2 reserve has no Astral and no
timsTOF run. The provisional rules for both are written below; when the user accepts them, the commit that records
the decision in this file sets the configs `frozen` (README gate), with an appended registry row and no other change. Each config is scored once; nothing is tuned on held-out data.
Source: PLAN-data-types.md #2 (Pre-registered protocol, Acceptance), PLAN-INTEGRATION.md section 6 (#2).

## Frozen software and configs

| What | Value |
|---|---|
| RC | origin/integration/1.12 a117801; FASTag.bin `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`; bundle SHA256SUMS `93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051` |
| CFG-02-base | `RC defaults (-complement_rule same_charge)`, param_hash `caa9e94e553ca38298013f20049118f8ef339b130679fe28ef38531625046cb6` |
| CFG-02-cand | `-complement_rule both` (tolerance 0.02 Da, unit Da, factor 0.5, mid-p off: defaults), param_hash `ca907ff64dad8a861dc143c34a100b98cdf5caaad338a7dc2f8ba1840a92ad13` |
| Truth engine | Sage v0.14.7 (GitHub release, commit 99407db; the binary prints 0.14.6), binary sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625` (data: `/ceph/ibmi/abi/oliver/opt/sage-0.14.7/...`; BinAC2: `$FT/opt/sage-0.14.7/...`, same sha256) |
| Scorer | `scorers/score_item02.py` sha256 `7928403d16627a7fab4f7e2faadaa76c87225b5f039ea42071af1f7a3b68c52e`, with `scorers/acclib.py` `d2342eb4c15e5801d9c13f2edcd1e56cec70349c941df0db2d061bb6630eeedf`, `bench/fastag-bench/src/fastag_bench/score.py` `e2b8788a78f1176169f617c01b2e17f21578b8909f7c79b33d23ae1b71075f79` and `parsers.py` `01e27548bcae489d3f205960730c8bc36624e16935ea5df0bec5a6a04ea51f49` (unchanged since a117801) |
| Truth configs | `scorers/truth_config.py` `899e387c2d08e02c371f7c1318994c0ecc3e0f208d7bce2eab740b0c25c66ec5` from `scorers/truth/item02.tsv` `6d46734dd6b915c521dba00d5edcfe533fe85bbe878483def888081f02064050` |

The frozen option strings carry no per-run fixed modifications and no fragment tolerance, so every run (ion-trap
MS2 included) is tagged at the RC's 20 ppm fragment tolerance in both arms. This protocol does not add either: that
would change the frozen configs. **DEV observation (scorer test, not a result):** at these options the ion-trap DEV
run PXD001819 has 4.0% rank-1 correct at L3, charge 2, in both arms (the QE DEV run PXD003531: 71.9%), so the
ion_trap cells measure almost nothing at the frozen options; the plan's diagnostic used 0.5 Da. A tolerance-matched
ion-trap arm would be a new config (and a user decision); it is not part of this protocol.

## Runs

- H1: `manifests/item02-H1.tsv` (sha256 `f47f10c0d021c9d235039c5c6ee2cb4378d02ed98efa50a81ba3c7c0494918aa`, registry
  HO-02-H1): 12 runs, 12 PXDs, staged and sha256-verified on data and BinAC2 (verify job 6466745).
- H2 reserve: `manifests/item02-H2.tsv` (`62a78f2e6e28d5759b432cfd81fb1ec62cf361a5479a22f5bcf2ea28ae207af9`, HO-02-H2):
  ion trap PXD000266, PXD004644; QE PXD020394, PXD035981. Used only to confirm a variant chosen after an H1 failure;
  otherwise an H1 failure is final for 1.12 and H1 becomes development data. PXD035981 has no truth database
  ('gut metagenome') and is not evaluable.
- **Set of a run (provisional, user decision 4):** the manifest stratum, except that a run whose recorded MS2
  analyser is ion trap is scored in the ion_trap set. PXD001540 ("QE" in the plan, ITMS CID MS2) is therefore an
  ion_trap run, and H1 has no QE set. The sets are astral (3 runs), ion_trap (6), timstof (3).
- **H2 (provisional, user decision 4):** the reserve is used as drawn (ion trap 2, QE 1 evaluable). Astral and
  timsTOF have no reserve: a variant after an H1 failure in those sets cannot be confirmed in 1.12. A replacement
  reserve drawn from PRIDE is proposed (commit cb76d59, `scripts/select_h2r_pride.py`; not registered); if the user
  accepts it, it becomes a new registered H2 manifest and this file is amended before any H1 run.

## FASTag runs (cells)

Per run and arm, six FASTag runs, each with the arm's frozen option string plus the cell's options:

| Cell | Added options |
|---|---|
| `L3_default`, `L4_default`, `L5_default` | `-tag_length 3`, `4`, `5` (CLI default profile) |
| `L3_nodeiso`, `L4_nodeiso`, `L5_nodeiso` | `-tag_length 3/4/5 -no_deisotope` (the matched profile) |

Command: `FASTag -in <staged fastag_input> -out tags.tsv -threads <n> <arm options> <cell options>`, written to
`runs/<CFG>/item02-H1/<run dir>/<cell>/` (`jobs/example-fastag.slurm` layout plus the cell level), with
`FASTAG_RC=<rc>` appended to `run.log`. `-threads` does not change the output (threads_test).

## Truth search per run

Sage 0.14.7, configuration `scorers/truth_config.py scorers/truth/item02.tsv <staged root> <panel dir> <out>`
(mode `closed`) on the staged `fastag_input` of each run, one JSON per run:

- Fixed for every run: Sage-generated reversed decoys (`rev_`), missed cleavages 2, length 7-50, fragment m/z
  150-2000, peptide mass 500-5000, b/y ions, min ion index 2, isotope errors [0, 1], 15-150 peaks, one PSM per
  spectrum (the paper harness's closed search, `fastag_bench/sage.py`).
- Database: the SDRF organism's proteome of the prose-auto panel (`/ceph/ibmi/abi/oliver/prose-auto-20261029/panel`,
  BinAC2 `$FT/ceph/prose-auto-20261029/panel`), path and sha256 per run in `truth/item02.tsv`.
- Enzyme: Trypsin (KR, not before P); Trypsin/P where the SDRF says so (no proline rule).
- Modifications per run (static / variable, `truth/item02.tsv`): Carbamidomethyl C static when the SDRF names CAM,
  variable when it states none; Methylthio C static for PXD001540; Oxidation M variable always; SILAC runs Lys4/Lys8
  and Arg6/Arg10 variable (channels not stated); iTRAQ8plex static on K and peptide N-term for PXD001540 (the SDRF
  says iTRAQ, prose-auto decided iTRAQ8plex); PXD000806 TMTpro variable on K and N-term (prose-auto's decided label,
  absent from the SDRF). max_variable_mods 2.
- Tolerances: precursor 10 ppm (timsTOF runs 20 ppm); fragment 0.5 Da with deisotoping off on ion-trap MS2,
  otherwise 20 ppm with deisotoping on.
- FDR: target, rank 1, spectrum_q <= 0.01 (`acclib.sage_truth`).

## Correctness, denominator, cells and pooling

- Correct: the rank-1 tag of a spectrum passes the paper flank rule against its truth peptide (`score._mark`, rule
  `flank`, the `lt_score.py` rule: sequence or reverse in the peptide, I = L, one flank within 0.05 Da).
- Denominator: every truth spectrum (Sage 1% PSM) of the run, the same for both arms; a truth spectrum an arm leaves
  untagged counts as not correct.
- Charge stratum: the Sage PSM charge, 2, 3 or 4+. Charge-1 PSMs are reported apart and are in no cell.
- Cells: set x profile x length x charge = 3 x 2 x 3 x 3 = 54 cells, spectra pooled over the runs of a set.
- Statistic per cell: difference of rank-1 correct (cand - base, percentage points); peptide clusters = the I/L-folded,
  modification-free truth peptide across the set's runs; 2,000 cluster bootstrap draws (numpy `default_rng`, seed
  from the cell name) give the standard error.

## Acceptance (all must hold; a failure keeps `same_charge` the default)

1. **(i) Non-inferiority in every cell:** at least 200 clusters, point estimate > -0.5, and the Holm-adjusted lower
   bound > -1.0. The Holm step-down runs over the powered cells at one-sided alpha 0.025 on p = P(Z > (d + 1.0)/SE);
   the bound of the cell with rank r of m is d - z(1 - 0.025/(m - r + 1)) SE. An empty or underpowered cell is
   inconclusive and blocks the default; McNemar with n = 0 is never read as a pass.
2. **(ii)** Pooled gain at length 3, CLI default profile, sets astral + ion_trap, charges >= 2: point >= +0.3 points
   and the 2.5th bootstrap percentile > 0.
3. **(iii)** timsTOF 4+ in the CLI default profile, at each of the three lengths: point >= -0.5 and
   point - 1.96 SE > -1.0 (and >= 200 clusters).
4. **(iv)** Time: PXD003531 (DEV) at 1 thread, 3 interleaved repeats of each arm on one exclusive BinAC2 compute node
   (the plan named ibminode05, which these runs may not use): median cand / median base <= 1.03, passed to the scorer
   as `--timing`. Without it (iv) is NOT MEASURED and #2 cannot pass.
5. Any run with FASTAG_RC != 0 or without truth makes the verdict INCONCLUSIVE (not re-run silently: a re-run is
   recorded in the registry first).

Also reported: per-cell base and cand rates, charge-1 cells, tagged spectra per run and cell.

## Scoring command

    python3 -I scorers/score_item02.py acceptance/1.12 item02-H1 <root>/runs <root>/truth <out> --timing <timing.tsv>

(python 3.9+ with numpy and pandas; DEV tests used 3.11.18, numpy 2.4.6, pandas 3.1.0.) The output (`result.json`,
`cells_i.tsv`, `runs.tsv`) goes to `results/item02/` with a registry row.

## DEV test of the scorer (DEV outputs only)

`scorers/tests/run_dev_tests.sh` on node data: both arms on the #2 DEV runs PXD003531 (QE) and PXD001819 (LTQ Orbitrap,
ion-trap MS2) in all six cells with the RC bundle, against the paper harness's Sage truths. Result in
`scorers/tests/dev_results/item02.txt` and `dev_results/item02/cells_i.tsv`: verdict FAIL on DEV ((i): 3 qe cells
fail, e.g. L5_default z3 point -0.47 with Holm bound -1.13, and every 4+ cell is underpowered, 106 and 169 clusters;
(ii) point +0.02, FAIL; (iii) no timsTOF run, INCONCLUSIVE; (iv) NOT MEASURED). This exercises the cell, Holm and
bootstrap code paths end to end. DEV numbers, not a #2 result.


## Amendment 1 (round 3, 2026-11-08): ion-trap cells at 0.5 Da, revised sets, informativeness floor

Decisions 2 and 3 of `DECISIONS-2026-11-08.md`. This amendment replaces the provisional rules above wherever they
differ. It is committed together with the configs set to `frozen` in `frozen-configs.tsv`, before any held-out run.
Nothing has been run or scored.

**Configs.** Each arm has two frozen configs. The 20 ppm config is used on the high-resolution runs. Its 0.5 Da twin
is used on the runs of the ion_trap set. The twin has the same option string plus `-fragment_tolerance 0.5
-fragment_tolerance_unit Da`, and nothing else differs.

| Arm | high-resolution runs | ion_trap runs |
|---|---|---|
| baseline | CFG-02-base `caa9e94e553ca38298013f20049118f8ef339b130679fe28ef38531625046cb6` | CFG-02-base-it05 `78cdc4fda54712b3031a072cf62935f0afd6058196b76be5bbdf88e37b60fd46` |
| candidate | CFG-02-cand `ca907ff64dad8a861dc143c34a100b98cdf5caaad338a7dc2f8ba1840a92ad13` | CFG-02-cand-it05 `8316ac758d4156248eb4bd7972af9b15742db74b0a28a29964ca095e0212125f` |

Each of the four configs is scored exactly once, the 20 ppm ones on the high-resolution sets, the twins on the
ion_trap set. Run directories are `runs/<CFG>/...` for the high-resolution runs and `runs/<CFG>-it05/...` for the
ion_trap runs (`acclib.arm_dir`). The cell options (`-tag_length`, `-no_deisotope`) are added as before. The truth
search is unchanged: its ion-trap rows were already 0.5 Da.

**Runs.**
- H1 is `manifests/item02-H1-r2.tsv` (`efa4e16e2cae451c529f74b2cbdad3c58bbf54f17babd72d56470d86f6de8b78`, HO-02-H1-r2), with 13 runs: astral 3 (PXD066944,
  PXD070049, PXD074582), ion_trap 6 (PXD000806, PXD001473, PXD001540, PXD001739, PXD002429, PXD003397), qe 1
  (PXD069528, Q Exactive, PRIDE) and timstof 3. PXD001540 is stratum ion_trap there. `item02-H1` is not scored.
- The H2 reserve is `item02-H2` (unchanged) plus `manifests/item02-H2r.tsv` (`cf90aeeb32eb5cfcd23298854f58005b34ff0c640631a8f95f8b61dd92801338`, HO-02-H2r). The
  H2r runs are Astral PXD055983 (one run, underpowered) and timsTOF PXD070494 and PXD081146. They come from PRIDE,
  a recorded plan deviation.
- H2 is still used only to confirm a variant chosen after an H1 failure.
- Truth rows for the new runs are in `truth/item02.tsv` (manifests `item02-H1-r2`, `item02-H2r`). They follow
  PRIDE, because the new runs have no SDRF:
  - PXD069528: mouse, CAM static (2-chloroacetamide), Trypsin.
  - PXD055983: yeast, CAM static, Trypsin/P.
  - PXD070494: human, alkylation not stated, so CAM variable; Trypsin; precursor 20 ppm.
  - PXD081146: mouse, CAM static, Trypsin, precursor 20 ppm.

**Cells, denominator.**
- The cells are unchanged in form: set x profile x length x charge, now over 4 sets (astral, ion_trap, qe,
  timstof) = 72 cells.
- The qe set has a single run, so some of its cells (4+ certainly) may be underpowered. Under (i) such a cell is
  inconclusive and blocks, as before.
- The denominator is unchanged: every truth spectrum of the run, in both arms.
- (ii) pools astral + ion_trap, with ion_trap read from the twins. (iii) timsTOF is unchanged.

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

**DEV test (DEV outputs only).** `tests/dev_results_r3/item02.txt` and `dev_results_r3/item02/`, with PXD001819 at
0.5 Da and PXD003531 at 20 ppm. The verdict is FAIL. The ion-trap z2/z3 cells differ by 0.0 to +0.3 points and pass.
The ion-trap z4+ cells are `uninformative`. The FAIL comes from three qe z3 cells (L4_default, L5_default and L5_nodeiso; the 20 ppm runs of the first DEV
test). These are DEV
numbers, not a #2 result.


## Amendment 2 (round 4, 2026-11-08): timsTOF truth repair, low-resolution data removed, scorer fixes, erratum

User decisions (A) and (D) of round 4, `DECISIONS-2026-11-08.md` (round 4). This amendment replaces amendment 1
wherever they differ. It is committed and pushed before any task it governs. **State when committed: #2 is not
scored.** The 156 FASTag runs of HO-02-H1-r2-run1 (job 6472366) and the timing (job 6472367) are kept and used as
they are. No FASTag output has been compared with any truth, and the choices below were made without reading any
FASTag output.

**1. Low-resolution data removed.** The ion_trap set (PXD000806, PXD001473, PXD001540, PXD001739, PXD002429,
PXD003397) is removed from #2. Its cells are not scored, and CFG-02-base-it05 and CFG-02-cand-it05 are never scored
(their FASTag outputs stay on BinAC2, unread). PXD001473 (0 PSMs) leaves with the set, so its truth question is moot.
The scored runs are the 7 high-resolution runs of `item02-H1-r2`:
- astral: PXD066944, PXD070049, PXD074582 (CFG-02-base / CFG-02-cand, 20 ppm);
- qe: PXD069528;
- timstof: PXD033741, PXD050504, PXD076520.

The manifest file is unchanged; the subset is selected by the scorer option `--sets astral,qe,timstof` (set =
`score_item02.set_of`, i.e. ion_trap whenever ms2_analyser is ion_trap).

**2. Endpoints on the remaining sets.**
- (i) 3 sets x 2 profiles x 3 lengths x 3 charges = 54 cells; margins, Holm, floor (1.8%) unchanged.
- (ii) pools the sets astral + ion_trap that are present: **astral alone** (L3_default, charges >= 2;
  point >= +0.3 and 2.5th percentile > 0). The cell name in the output keeps the old label.
- (iii) timsTOF 4+ unchanged, now on 3 timsTOF runs.
- (iv) unchanged: the round-3 timing TSV of job 6472367 (HO-02-H1-r2-run1), measured and not yet scored.
- Rule 5 unchanged in wording; see 4b for what "without truth" means.

**3. Truth repair for PXD033741 and PXD076520 (timsTOF).** Diagnosis, from the inputs and Sage's source only:
Sage 0.14.7's mzML reader (`crates/sage-cloudpath/src/mzml.rs`) adds a precursor to a spectrum only when its
selected ion m/z (MS:1000744) is not 0.0, keeps the MS2 spectrum anyway, and `score_standard` (`scoring.rs:379`)
then panics ("missing MS1 precursor for <id>"). The OpenMS-converted timsTOF mzMLs carry MS2 spectra whose only
selected ion m/z is "0" with no isolation window (Bruker precursors without a monoisotopic m/z; the panicking IDs
`frame=2 scan=725 precursor=3` and `frame=8309 scan=839 precursor=4814` are such spectra). They have no precursor
mass, so no engine can identify them. Fix (the second option of decision A):
- A derived mzML per run, `scorers/drop_noprecursor_ms2.py <staged input> input.noprec.mzML`, drops exactly the MS2
  spectra in which no `<precursor>` has a non-zero selected ion m/z; every other line is copied byte for byte (native
  IDs unchanged; the spectrumList count and the index go stale, which Sage does not read).
- Counted before this amendment with `--count-only` (BinAC2 job 6474097, inputs only):

| Run | spectra | MS2 | MS2 dropped | dropped IDs (scorers/truth/item02-r4-dropped/) |
|---|---|---|---|---|
| PXD033741 | 221,709 | 217,868 | **3,412** (1.57%) | `PXD033741.dropped_ids.txt` 2b6f29ff... |
| PXD076520 | 126,647 | 120,136 | **3,513** (2.92%) | `PXD076520.dropped_ids.txt` 0bfd3930... |
| PXD050504 (control, searched normally in round 3) | 144,636 | 139,538 | 0 | - |

- The truth search is the round-3 Sage 0.14.7 configuration unchanged (`truth_config.py`, `truth/item02.tsv`
  `42920f3b...`, mode closed, the `item02-H1-r2` rows): the job regenerates it and checks that it equals the round-3
  `sage.json` except `mzml_paths`, which points to the derived file. The job stops before Sage if the dropped count
  or the dropped-ID sha256 differs from the table.
- Comet (the first option of decision A) is not used: it would change the engine, the FDR procedure and the PSM
  format of the truth for two runs only.
- The dropped spectra are outside the truth, hence outside the denominator, in both arms alike (the FASTag runs on
  the staged input are unchanged).
- The other five high-resolution truths are the round-3 files (job 6472365), unchanged; the scoring truth root
  `acc112-item02/truth-r4` holds the two new truths and links to those five.

**4. Scorer fixes (new sha256, below).**
- (a) **timsTOF spectrum key (audit finding of this round, from code reading).** fastag_bench's
  `parsers.spectrum_key` keys a spectrum by `scan=<n>`. In timsTOF IDs (`frame=<f> scan=<s> precursor=<p>`) `scan` is
  the TIMS scan inside a frame and repeats across frames, so truth PSMs collapsed onto a few hundred keys
  (`drop_duplicates`) and tags of different spectra were joined to one truth peptide. That would have made every
  timstof cell and (iii) meaningless. `acclib.native_key` keys IDs containing `frame=` by the full native ID (FASTag
  writes the native ID in `spectrum`, Sage in `scannr`) and leaves every other ID to `parsers.spectrum_key`;
  `score_item02.py` and `score_item06.py` call `acclib.use_native_keys()`. The bench files are unchanged.
- (b) **Truth with 0 PSMs (round-3 audit finding 1).** A run whose truth has no target rank-1 PSM at
  spectrum_q <= 0.01 is a run without truth (status `NO_TRUTH_0PSM`) under rule 5, not only a missing file.
- (c) `--sets` selects the scored sets (point 1).
- Regression on DEV outputs only (node data, `dev-r3` work dir of `tests/run_dev_tests_r3.sh`, 2026-11-08): the
  amended scorers reproduce `tests/dev_results_r3/` byte for byte (item02 `cells_i.tsv`, `cells_charge1.tsv`;
  item06 `cells_2a.tsv`, `sets_2b.tsv`, `charge_calls.tsv`; same verdicts). A synthetic Sage TSV with two IDs
  `frame=2 scan=725 ...` and `frame=9 scan=725 ...` gives one key under the old reader and two under `native_key`.

| File (scorers/) | sha256 |
|---|---|
| `acclib.py` | `fe387a3455a52678f78c20c3156b63c251e08daa5b92da2f3e205d1d9ab2b1c1` |
| `score_item02.py` | `5704b8634c5a98f8993a4dccc4c331e6d84405dbf0b5dbaa42b523d68677e395` |
| `score_item06.py` | `7020e187e07588e2de3b77c6629cb8b1148392f23c2f37e24a1be3ef3bc04713` |
| `drop_noprecursor_ms2.py` (new) | `1cfc6b664c8e9c45fc4f6494d910a455444682ef04decdef35d5aa4a1f77efc5` |
| `truth/item02-r4-dropped/PXD033741.dropped_ids.txt` | `2b6f29ff0752ea001af515928b00539fca9dde95429a1db64263b32a796d366e` |
| `truth/item02-r4-dropped/PXD076520.dropped_ids.txt` | `0bfd393060e555bc0056d712681f2167691e11efc345414f5125a5835c703cef` |
| `truth_config.py`, `truth/item02.tsv`, `strip_charge.py`, `score_item09.py` | unchanged (amendment 1 values) |

fastag_bench `score.py` (`e2b8788a...`) and `parsers.py` (`01e27548...`) are unchanged.

**5. Erratum: scoring command.** The scoring commands of this file used `python3 -I`. Under `-I` the script's
directory is not on `sys.path`, so `import acclib` fails (#9 job 6472745 failed this way, before reading any file).
The #6 and #9 scorings ran without `-I`. The corrected command is:

    <python 3.12.15, numpy 2.4.6, pandas 3.1.0> scorers/score_item02.py <acceptance dir> item02-H1-r2 <runs> <truth-r4> <out> \
        --timing <timing.tsv> --sets astral,qe,timstof

run from the acceptance directory of a git archive of the commit that carries this amendment
(`results/r4-jobs/item02-score.slurm`). The scorer code was never the problem; only the interpreter flag.

**6. Jobs.** `results/r4-jobs/` (BinAC2, `$FT/r4/jobs`): `item02-truth.slurm` (2 tasks), then `item02-score.slurm`
(the single scoring of CFG-02-base and CFG-02-cand). The run-start row is pushed after submission with the jobs
held, and the jobs are released only after it is pushed.
