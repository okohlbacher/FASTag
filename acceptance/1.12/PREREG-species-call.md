# PREREG-species-call: #1 calibrated species call and #10 both orientations (SKELETON)

Status 2026-11-08: **skeleton, not frozen.** The DEV regeneration, the grid fit and the leave-one-PXD-out CV have
not been run. No held-out run may start until the sections marked TO FILL are filled, this file is committed with
the fitted table's sha256 and the final parameter hash, and the registry rows HO-01-* and HO-10-* name that commit.
Each config below is scored exactly once on the held-out set; nothing is tuned on held-out data.

## Frozen software

| What | Value |
|---|---|
| Release candidate | origin/integration/1.12 at a117801 |
| FASTag.bin sha256 | c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3 |
| buildtaxdb sha256 | 47289931e0c3a8476aad6f40f13e6723b8209aa3623eed7a23a536e0a1485bf0 |
| Bundle | data:/scratch/kohlbach/fastag-heldout-1.12/rc-a117801 (opt/ and data/ of a117801), SHA256SUMS sha256 93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051 |
| OpenMS / env | /ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144, env /ceph/ibmi/abi/oliver/envs/fastag-omsdev |
| nodes.dmp / names.dmp | d20f4f5b...cdcecf / 397b70d7...cb2b (data/taxonomy at a117801) |
| species_call.tsv at a117801 | 8aa40c29d3440d2bde29941dab85426c644c6aeac68487f1403fd653ce2723bf, **PROVISIONAL** (training_sha256 none) |
| taxdb | TO FILL (the index the DEV runs are regenerated with; path and sha256) |
| Truth search | Sage v0.14.7 (data, /ceph/ibmi/abi/oliver/opt/sage-0.14.7), ref50.fasta sha256 2bc7295c... (full value TO FILL) |
| Scoring script | TO FILL (path in fastag-bench, commit, sha256) |

Defaults in force: those of the RC (1.11 defaults plus #7 refuse). Decision 2 of PLAN-INTEGRATION section 8: the
fit runs on this RC with these defaults; a later default flip of #2/#6/#9 triggers a recorded refit on DEV before
any #1/#3 default flip (not before their held-out evaluation).

## DEV (in-sample; TO FILL after the regeneration)

- Runs: the 48 runs of bench/fastag-bench/config/species_runs.tsv (37 PXDs), regenerated with the RC binary.
  Training run list sha256: TO FILL.
- Go/no-go: d_g and spill_g distributions; all-decoy KS p > 0.01. Result: TO FILL.
- Grid (pre-registered): alpha {0.01, 0.05} x tau {0, 0.002, 0.005, 0.01} x n_min {5, 10, 20} x deconvolve {off, on}.
- Selection rule: minimise the run-level false-present rate subject to sensitivity >= 0.85; leave-one-PXD-out CV
  reported. Chosen point: TO FILL. LOPO-CV table: TO FILL.
- Fitted species_call.tsv: path and sha256 TO FILL (replaces the provisional 8aa40c29...).

## Configurations (acceptance/1.12/frozen-configs.tsv)

| Config | Options | Parameter hash |
|---|---|---|
| CFG-01-base | `-species` (1.10.0 q-rule, RC defaults) | a59d5314...32b9 (pre-fit; final TO FILL) |
| CFG-01-cand | `-species -species_call decoy -species_call_params <fitted table>` | 2ef1e705...50e3 (pre-fit hash with the provisional table; final TO FILL) |
| CFG-10-cand | CFG-01-cand + `-species_orientation both` | 032af978...cd37 (pre-fit; final TO FILL) |

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
