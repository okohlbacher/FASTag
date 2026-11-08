# PREREG-species-call: #1 calibrated species call and #10 both orientations

Status 2026-11-08: **DEV done; NO-GO. No held-out run.** The DEV regeneration on the RC, the grid fit and the
leave-one-PXD-out CV are done and recorded below. The configs are frozen with their final hashes, but the
pre-registered DEV go/no-go failed (the all-decoy KS check, which must pass "before any held-out run", gives
p = 6.7e-41, and the best grid point has a false present in 35 of 36 FTMS runs). CFG-01-cand and CFG-10-cand are
therefore `blocked_dev_nogo`: HO-01-heldout and HO-10-heldout must not be scored until the user decides. Nothing
was relaxed. Each config is still scored at most once on the held-out set; nothing is tuned on held-out data.

**Deviation from the plan's go/no-go test (recorded 2026-11-08, after the audit; user decision open).** See
section "Deviation: all-decoy check" below. The NO-GO rests on a stand-in for the plan's KS criterion, not on the
plan's own test. Statuses are unchanged until the user decides.

## Frozen software

| What | Value |
|---|---|
| Release candidate | origin/integration/1.12 at a117801 |
| FASTag.bin sha256 | c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3 (unchanged; no rebuild) |
| buildtaxdb sha256 | 47289931e0c3a8476aad6f40f13e6723b8209aa3623eed7a23a536e0a1485bf0 |
| Bundle | data:/scratch/kohlbach/fastag-heldout-1.12/rc-a117801 (opt/ and data/ of a117801), SHA256SUMS sha256 93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051 |
| OpenMS / env | /ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144, env /ceph/ibmi/abi/oliver/envs/fastag-omsdev |
| nodes.dmp / names.dmp | d20f4f5b...cdcecf / 397b70d7...cb2b (data/taxonomy at a117801) |
| species_call.tsv at a117801 | 8aa40c29d3440d2bde29941dab85426c644c6aeac68487f1403fd653ce2723bf, PROVISIONAL (training_sha256 none); **kept as shipped** (see "Fitted table") |
| taxdb | tax_k7.taxdb sha256 34427bba2c3ba3240805d4e5266443fcdc4708e0131eb96ea4dfbb4dda771a4f (the 1.10/1.11 index, the refs-1.10.0 gate input), with the RC nodes.dmp/names.dmp, via FASTAG_TAXONOMY_DIR=data:/scratch/kohlbach/fastag112-dev/tax |
| Truth search | Sage v0.14.7 (data, /ceph/ibmi/abi/oliver/opt/sage-0.14.7), /ceph/ibmi/abi/oliver/jpr-bench/species/ref50.fasta sha256 2bc7295c31bcb4643a59cd0dc8fdb0a28f74d8b47989902788eaa10d2d328626 |
| DEV scoring script | acceptance/1.12/dev/scripts/fit_species.py (b293735), sha256 4e3c85cf77695dc257a144fec51cb14167b30c6d52703c931721077bc4a894bb |
| Held-out scoring script | not written (no held-out run while the item is NO-GO); until it is committed with its sha256, CFG-01-base is `pending_prereg` (README scoring-protocol gate) |

Defaults in force: those of the RC (1.11 defaults plus #7 refuse). Decision 2 of PLAN-INTEGRATION section 8: the
fit runs on this RC with these defaults; a later default flip of #2/#6/#9 triggers a recorded refit on DEV before
any #1/#3 default flip (not before their held-out evaluation).

## Deviation: all-decoy check (user decision open)

The plan (PLAN-organism-chemistry #1, "Pre-freeze go/no-go on DEV") requires: "an all-decoy run (decoys treated
as targets) must give empirical p roughly uniform (KS test, p > 0.01) before any held-out run". That is a test of
the call's own reported p-values (spill term included) on a run where every hit is a decoy.

`dev/scripts/fit_species.py` (committed in b293735 before any DEV run, sha256 4e3c85cf...) tests something
narrower: decoy replicate 6 alone (o' = decoy_spectra(ks6) - decoy_spectra of the 5-decoy arm) against a Poisson
with lambda = (d_g + 0.5)/5, by a randomised PIT (random.Random(112)), KS against U(0,1). That checks whether the
Poisson model of the random-hit part fits the decoy replicates; it does not check whether the reported p/q values
are calibrated. The test was fixed before the results, so it was not chosen from them, but calling its result
"the pre-registered DEV go/no-go" overstates it.

Result of the stand-in (re-run from the raw species.tsv outputs in the audit; fit.json, grid.tsv, lopo_cv.tsv and
training_runs.tsv byte-identical): n = 1760 genus rows of 36 FTMS runs, D = 0.1622, p = 6.7e-41: FAIL. Reported
next to it either way: at the chosen point g_0.01_0.01_5_on, 35 of 36 FTMS DEV runs (0.972) have a false present
(7.69 per run), against the held-out target of at most 10% of runs.

Options for the user:
1. accept the Poisson-replicate test as the #1 go/no-go (the NO-GO stands as recorded); or
2. run the plan's all-decoy run on DEV with the RC (decoys treated as targets, KS on its reported p-values) before
   #1 is closed, and decide on that result.

Until the user decides, CFG-01-cand and CFG-10-cand stay `blocked_dev_nogo` and HO-01-heldout / HO-10-heldout stay
unscored. The DEV false-present rate already misses the held-out target by a wide margin under either test.

### Plan's all-decoy run on DEV (option 2; protocol fixed 2026-11-08 before the run)

Run as option 2 above, without changing the decision rule (GO iff KS p > 0.01; a GO changes nothing else and
CFG-01-cand may then move only as far as the README scoring-protocol gate allows, i.e. `pending_prereg` until the
held-out scorer is committed). DEV data only, frozen RC binary, no held-out run.

- Script dev/scripts/species_alldecoy.py sha256 5b959b9655cc48148aa068dd8dbdf642abc85a1a8b13bf969bffe5c90d7f0ea2 (decoy index and runs; header fixes the
  protocol); statistic dev/scripts/fit_alldecoy.py sha256 46388e8d9544bd25b0cf579c03ac48039fd41889446b8564e4fef78848f73749 (header fixes it).
- "Decoys treated as targets": the RC binary has no switch that scores its own decoy tags as targets, so the
  targets are made decoys on the index side. Decoy index = the 50 reference proteomes of tax_k7.taxdb
  (jpr-bench/species/proteomes.sha256), every protein's residues shuffled (seeded per taxid and protein ordinal),
  built with the RC buildtaxdb, k = 7; same nodes.dmp/names.dmp/species_call.tsv. Every genus of every run is then
  false; the call's own null (5 decoy tags per tag, spill, BH) runs unchanged. Provenance check: the same
  buildtaxdb on the unshuffled proteomes must reproduce tax_k7.taxdb 34427bba...
- Runs: the 47 DEV runs with species_dev.py's command lines; primary arm the go/no-go point g_0.01_0_10_off,
  secondary arm the CFG-01-cand options (false presents only).
- Statistic: all genus rows of the 36 FTMS runs; the call's p = P(X >= o), X ~ Poisson(decoy_expected); KS of its
  randomised, truncation-corrected form u = [P(X > o) + V P(X = o)] / P(X >= 1) (only o >= 1 rows are reported)
  against U(0,1). Also reported: false presents per run in both arms (the plan's negative test: none).

**Result (2026-11-08, data, 94 arms exit 0; dev/species/alldecoy/, alldecoy.json sha256 dfa52147...): NO-GO.**
KS of u over 1732 genus rows of the 36 FTMS runs: D = 0.192, p = 2.0e-56 (needs > 0.01). The null is
anti-conservative: 7.2% of rows have u <= 0.01 and 13.3% u <= 0.05. Raw p (non-randomised): D = 0.201, p = 1.6e-61.
The plan's negative test ("an all-decoy run must give no present genus") fails. Every present is false here:
- go/no-go point g_0.01_0_10_off: false present in 21 of 36 FTMS runs (0.583), 53 in all, 1.47 per run;
- CFG-01-cand options (fitted table, deconvolve): 20 of 36 runs (0.556), 45 in all, 1.25 per run;
- the 11 ion-trap runs are low_resolution no_calls (0 present). Per-run counts and genera: alldecoy_runs.tsv.
Provenance: the RC buildtaxdb on the 50 current proteome files (589010 proteins, the ref50 set) does **not**
reproduce tax_k7.taxdb byte for byte (8f2b4743... vs 34427bba..., 1137808145 vs 1138145846 bytes): the shipped
index (from the 1.8.0 bundle) was built from slightly different proteome versions. On PXD003531_QE_NO_03 the
rebuilt index gives genus counts within 0.2% of the shipped one (Homo 12006 = 12006, Bos 8842 vs 8829) and the
same calls on the top rows. The decoy index (d9cc661d..., 171399728 distinct 7-mers) is shuffled from those
current files. Both the stand-in and the plan's own test fail, so the NO-GO stands. No status changed:
CFG-01-cand and CFG-10-cand stay `blocked_dev_nogo`.

## DEV (in-sample)

- Runs: the 48 runs of bench/fastag-bench/config/species_runs.tsv minus PXD000001_Erwinia_TMT6 (the #17 held-out
  file, flagged by scripts/check_dev_inputs.py): **47 runs**, 36 FTMS (26 PXDs) and 11 ion-trap (run-level
  low_resolution no_call, reported apart). Training run list dev/species/training_runs.tsv, sha256
  **7bc1905c63e74fda88a2c34509553513da9eec866dec0f5241caa97f6ed5f499**.
- Regeneration: dev/scripts/species_dev.py commands, 50 arms per run (base, 48 grid points, ks6) plus the #10
  pass. 3 runs (150 arms) and 59 arms of 3 more ran on data; the other 2141 arms and the 47 `both_` arms ran on BinAC2
  with the same binary and command lines (dev/binac2/README.md; equivalence check PXD028735_Ecoli_01 50/50
  species.tsv byte-identical to data). Every arm exit 0. Reports: data:/scratch/kohlbach/fastag112-dev/
  species_dev_reports.tgz (sha256 ae769959...2cba).
- **Go/no-go at the provisional point g_0.01_0_10_off: FAIL.** 1760 genus rows (FTMS runs): d_g median 2687,
  no row with d_g = 0, every genus has median d_g > 0 (lowest Helicobacter 587); spill_g median 332.4, positive in
  97.95% of rows. **All-decoy KS: n = 1760 PIT values, D = 0.162, p = 6.7e-41 (needs p > 0.01): FAIL.** The decoy
  replicate counts are not Poisson around (d_g + 0.5)/5, so the decoy null is not calibrated on real runs.
- Grid (pre-registered): alpha {0.01, 0.05} x tau {0, 0.002, 0.005, 0.01} x n_min {5, 10, 20} x deconvolve {off, on};
  dev/species/grid.tsv.
- Selection rule: minimise the run-level false-present rate subject to sensitivity >= 0.85. **Chosen point
  g_0.01_0.01_5_on** (alpha 0.01, tau 0.01, n_min 5, deconvolve on), constraint met: sensitivity 0.945 (52/55),
  false present in 35/36 runs (0.972), 7.69 false presents per run, observed-universe specificity 0.816 (Wilson LB
  0.796, n 1508), 1 run fully no_call. Every grid point has a run-level false-present rate of 0.97 or more.
- LOPO-CV (dev/species/lopo_cv.tsv, 26 folds): every fold picks the same point; pooled false-present rate 0.972,
  7.69 per run, sensitivity 0.945. Against the held-out targets (specificity >= 0.95 with LB >= 0.90, <= 10% runs
  with a false present) the DEV numbers already miss by a wide margin.
- #10 pass (both_g_0.01_0.01_5_on, 47 runs): regenerated, not tuned (no free parameter). Descriptive only:
  genus `present` rows over all runs 416 forward, 313 both.
- dev/species/fit.json holds every number above.

### Fitted table

dev/species/fitted/species_call.tsv, sha256 **c556d587297fddc20fe0128cb181d742c776936c0fa015b867a527d526bc305f**
(version 1.12.0-dev-fit, training_sha256 7bc1905c..., alpha 0.01, tau 0.01, n_min 5, decoys 5). The RC loads it
and reproduces the g_0.01_0.01_5_on report of PXD028735_Ecoli_01 byte for byte. **It does not replace
data/taxonomy/species_call.tsv**, and the species_call gate case (tools/gate_new_cases.sh pin 8aa40c29...) and
the provisional refs-1.12.0/species_call digest are unchanged: shipping a table whose null failed its own
pre-registered check would present an uncalibrated call as fitted. The table is read at run time (not compiled
in); replacing the shipped file would change the bundle and the species_call gate case, not FASTag.bin. That
replacement, with the gate pin and the refs-1.12.0 case renewed together, waits for the user's decision on #1.

## Configurations (acceptance/1.12/frozen-configs.tsv, scripts/make_configs.py)

| Config | Options | Parameter hash | Status |
|---|---|---|---|
| CFG-01-base | `-extension 2 -species` (1.10.0 q-rule; species_dev.py arm base: label fixed mods, 0.3 Da on ion-trap MS2) with tax_k7.taxdb, nodes.dmp, names.dmp | d1e405fd6c1ac7f2561e2909dfc9d79667f192fa2720f9c76657efc0086db490 | pending_prereg (options frozen; held-out scorer missing) |
| CFG-01-cand | CFG-01-base + `-species_call decoy -species_call_params <fitted table c556d587...> -species_deconvolve` | e939170ee78fbdc27df2461a895923f87f0fcad7f73c39871c0d5ed3e8f4aa5c | blocked_dev_nogo |
| CFG-10-cand | CFG-01-cand + `-species_orientation both` | 93e97f05f5b0bf1648f2127425d6cacb28822e7ba5be600aedd334148b1feaca | blocked_dev_nogo |

The pre-fit hashes (a59d5314..., 2ef1e705..., 032af978...) are superseded; they were never scored.

Baselines under the same denominators: 1.10.0 q-rule, the 1% deconvolved-share rule, Unipept 4.2.2 1% rule.

## Held-out set (registry HO-01-heldout; manifest acceptance/1.12/manifests/item01-heldout.tsv)

Drawn by acceptance/1.12/scripts/select_species.py, select_named.py and select_chem.py (rules in their headers),
committed before any run:
- pool runs of results/sdrf_truth_runs.tsv outside the 37 DEV PXDs, high-resolution MS2 only;
- single-organism: one run per PXD, random.Random('fastag-1.12:#1:single');
- multi-organism: PXD001819 (UPS1/yeast), PXD006118 (Kleiner mocks), PXD023217 (CAMPI SIHUMIx), 3 runs each,
  plus 5 two-organism PXDs from bigbio 4525967 (one run each); every one checked for high-resolution MS2 after
  conversion (a run with ion-trap MS2 leaves the set, recorded in the manifest);
- pseudo-DDA (DIAspeXtract) runs: separate stratum, reported, excluded from the primary metrics.
Requirements: >= 40 runs, >= 25 PXDs, <= 3 per PXD, >= 10 multi-organism. Every run passes the #7 check first.
Disjointness from DEV: acceptance/1.12/disjointness/item01-heldout.tsv.

## Truth and denominators (from PLAN-organism-chemistry #1)

Truth: SDRF organism mapped to genus; Sage against ref50.fasta with >= 3 genus-unique peptides at 1% FDR; Sus and
Bos count as present only when Sage supports them; genera outside the index are excluded.
(a) observed-universe specificity: non-truth genera with o_g >= n_min; (b) hard-negative specificity: non-truth
genera in the same family or order as a truth genus, or with pairwise overlap above TO FILL; (c) run level: the
fraction of runs with any false present, and false presents per run.

## Acceptance (#1; all must pass)

1. specificity (a) >= 0.95 with Wilson lower bound >= 0.90;
2. runs with any false present <= 10%;
3. hard-negative false-present rate <= alpha plus its CI half-width;
4. sensitivity >= 0.80 for majority or >= 5% w/w genera;
5. at most 20% of runs fully no_call;
6. no true genus not_detected with an LOD below its share.
Failure keeps `-species_call` opt-in and the paper says so.

## Acceptance (#10, second config, same denominators)

(i) paired median true-genus count gain >= +10%; (ii) McNemar top-1, at most 1 run lost; (iii) run-level
false-present rate no more than 2 points above forward, with #1's acceptance still met; (iv) the ratio of non-truth
count inflation to true gain and the ambiguity-loss count are reported. No DEV tuning (no free parameter).
