# PREREG-item04: #4 tag accuracy on unidentified spectra (CFG-04, test split)

Status 2026-11-08 (round 3): **protocol fixed. CFG-04 is `frozen` in the commit that adds this file. Not run, not
scored.** The user signed off F4-10, F4-11 and F4-12 as recorded, together with the proposed margin
(DECISIONS-2026-11-08.md, decision 6; registry DEC-1112-r3-06). The test split is opened once, scored once and never
re-scored. Nothing is tuned on it.
Sources: PLAN-qc.md item #4, registry F4-01..F4-07 (endpoints, controls, splits), F4-10/F4-11/F4-12/F4-13
(amendments), F4-08/F4-09/F4-14 (DEV debug runs only), HO-04-test (manifest).

## Frozen software and config

| What | Value |
|---|---|
| FASTag | the RC bundle a117801, FASTag.bin `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`, bundle SHA256SUMS `93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051`, started as `rc-a117801/opt/FASTag` on node data. The DEV runs used the 1.11.0 release. At defaults the RC tags equal 1.11.0 (BASELINE IDENTITY PASS), and the matched profiles below change no 1.12 option. |
| CFG-04 | param_hash `fbb47bdb3a03eb59d11d0401d167ff469e80090374432230cc056fc578ad4013` (option string unchanged) |
| Harness | `bench/fastag-bench` at `feat/f4-tag-accuracy-harness` **7ef0f33**, `fastag-bench unidentified` |
| Frozen config | `scorers/item04/unidentified-test.yaml` sha256 `ab7e64450bcb7f063f41d50a26a5b0dbe6667d1c60e5b23f89eb44442dfb2b2d`. It is the 7ef0f33 `config/unidentified-data.yaml` (`2cfc20d71215365b84f6eea9211d2fd6d0f18c6ba8371225892dc0423733fc5b`) with two changes: `tools.fastag` points to the RC, and `unidentified.margin_frozen: 0.05` is set. |
| Truth engine | Sage v0.14.7 (`/ceph/ibmi/abi/oliver/jpr-bench/envs/sage-0.14.7/...`, the binary prints 0.14.6), 1% FDR |
| Human DB | UP000005640 (`/ceph/ibmi/abi/oliver/jpr-bench/data/PXD054073/UP000005640_9606.fasta`) |

Scorer files at 7ef0f33 (sha256 of the git blob):

| File | sha256 |
|---|---|
| `bench/fastag-bench/scripts/stats_unidentified.py` | `4418f9e924a7d6fb2ebced095f6b2752a689a000b17d9e56f3a96df9e442cee7` |
| `bench/fastag-bench/scripts/stats_paired.py` | `e02cc411ba2554c01f86331ac0254c609ceb14fadd313a6336d0367e40722caf` |
| `bench/fastag-bench/src/fastag_bench/unidentified.py` | `6cd77a959fb8d37c04995c23701c6b301a9b43232c6f17bbfecc7ed0503873c1` |
| `bench/fastag-bench/src/fastag_bench/pooltruth.py` | `1d62d9577b42cb4e60760fc4cda864475a9a483f66e6f1a0c235bc912cf3d49f` |
| `bench/fastag-bench/src/fastag_bench/strata.py` | `1f616d5a2d44845ad7ff6851ed33b1b3f02d65559ed2b6d34e862b045b4c728a` |
| `bench/fastag-bench/src/fastag_bench/chimera.py` | `ac0320cab5c26572a0035d0aa13587b096af80e490690f106324dddc4c7350de` |
| `bench/fastag-bench/src/fastag_bench/proteometools.py` | `395332a294a6185f1094abc1e7662daf7b5a197eb33515bc0b45e06b34d1eecc` |
| `bench/fastag-bench/src/fastag_bench/score.py` | `09db516ee739da13c701f17d7375ee8312774379699959dac580b5345b912dd4` |
| `bench/fastag-bench/src/fastag_bench/parsers.py` | `8238f08f6850181214295971790b5e32829b5aa826cd8759cc5c5c54de58659b` |
| `bench/fastag-bench/src/fastag_bench/sage.py` | `892bc3c173a58e725db68362dde7904b21f6d8e9b7d664c084d7b7150be879c1` |
| `bench/fastag-bench/src/fastag_bench/tsv.py` | `84b2889f202ebbcfa81432e2ec6e58cc436cb77712399797801465f06f667450` |
| `bench/fastag-bench/config/proteometools_splits.tsv` | `90bdb67756be94b844a62a87e5889f683d77ca8ca6d8ef16a569701c3af991f8` |
| `bench/fastag-bench/config/proteometools_shared_identities.tsv` (F4-12) | `7cebe2e592e6e674ba9cb0a70edaf500037732b05db96bf1724d6953368c0123` |
| `bench/fastag-bench/config/proteometools_pool_lists.tsv` (F4-12) | `2125fb0c0c121285750339e1768e70baa07829771329ce5bfc4bfabf2c36e418` |

The scoring run checks out 7ef0f33 and confirms these hashes before `run`. If any hash differs, the run stops.

## Runs

`manifests/item04-test.tsv` (sha256 `4c7948e04ab2fb12b8e77621b9fafba7bb1938ca18136f7fef895dcde065b213`, HO-04-test):
the 10 test pools of F4-06 (seed 2). Thermo_SRM_Pool_92 has no tryptic search and is not eligible, so 9 pools are
scored (F4-08 (c)). The test pools are disjoint from the DEV pools at pool level. The identities they share with
other splits are excluded by F4-12. One known overlap is recorded and not corrected: TUM_second_pool_5 shares LC-MS
batch 01709a with the DEV pool TUM_first_pool_108.

## Truth (per spectrum)

- S0: the closed full-database Sage search (UP000005640, 10 ppm precursor, fixed CAM, variable Met oxidation, 1%
  spectrum FDR) identifies the spectrum.
- S3-PT: a pool spectrum that the closed search does not identify. Its candidates are the pool peptides with
  |M_obs - k*1.003355 - M_pep| <= 10 ppm, k in {0, 1}, at the given charge (2-4 when none is given), with the pool's
  modifications (`pooltruth.py`). A pool's list is the union of the MaxQuant-identified peptides over its tryptic
  searches. Size 0 is `no_pool_candidate` (reported, not scored), size 1 is the label, and size > 1 is
  `pool_consistent` (reported separately). Identities in `shared_identity` are not scored.
- Correctness: the paper flank rule against a candidate (`score.tag_correct_flank`). Rank 1 is the spectrum's
  first tag row.

## Arms, cells, denominator

- Profiles (frozen in `unidentified.py` at 7ef0f33):
  - `matched` is the **primary** profile: `-tag_length 3 -max_tags 50 -max_peaks 100 -peaks_per_window 0 -gaps 0
    -no_deisotope -fragment_tolerance 0.02 -fragment_tolerance_unit Da`, plus `-fixed_modifications
    "Carbamidomethyl (C)"`.
  - `matched_tl5` is the **secondary** profile: the same at `-tag_length 5`. This is the F4-10 (3) deviation from
    the plan's single `-tag_lengths 3,5` run, now accepted.
  - `default` is descriptive only.
- Chance arm (F4-10 (1)): the label's own same-mass shuffled decoy (`pooltruth.decoy_map`), paired per spectrum,
  under the same flank rule. The pool-swap chance is reported with its coverage only.
- Scope and label rule (F4-11):
  - The primary scope is `pools_not_excluded`. A pool with pool agreement below 95% leaves every endpoint.
    Pools flagged uncertain by entrapment are kept in the primary scope and dropped in the sensitivity scope
    `pools_certain`.
  - The primary label rule is `no_byproduct_candidate`. The sensitivity rules `all`,
    `rank1_not_byproduct_explained` and `pool_search_agrees` are reported beside it.
- Denominator of F4-01: tagged S3-PT size-1 spectra of the scope and rule, excluding `shared_identity` and
  `no_pool_candidate`. Untagged scored spectra count in the recall column only.

## Endpoints

1. **F4-01, primary.** Rank-1 accuracy minus the decoy chance, per spectrum, over clusters of I/L-normalized
   peptides: 2,000 bootstrap draws, seed 20261104.
   - Margin **0.05 (5 percentage points), frozen here.** It is F4-01's default, the "proposed margin" the user
     accepted. F4-10 notes that the DEV decoy chance is 0.000, so the margin could not be derived from it. It is
     set on these grounds instead, before the test split is opened, and is never changed afterwards.
   - The statement "tags are informative on unidentified spectra" holds when the Holm-adjusted one-sided
     bootstrap p of H0 (difference <= 0.05) is below 0.025. The p-values are (1 + #draws <= margin)/(n + 1), and
     Holm runs over {matched, matched_tl5}.
   - The verdict comes from the primary profile in the primary scope and under the primary rule. Failing that
     verdict is a FAIL of #4.
2. **F4-02.** Precision transfer at E <= 0.01 (S0 vs S3-PT size-1): "transfer shown" if the 95% CI of the
   difference lies within +-0.10. Reported, not gating for the release statement.
3. **F4-03.** Selection bias (S0 minus S3-PT rank-1), reported with its CI. No pass criterion.
4. **F4-04/F4-13.** Synthetic chimeras, `-diversity` on vs off, at 1:1 and 1:10. At most one chimera per identity.
   The Holm sign-flip permutation family is as registered, and `diversity_verdict` gives the verdict. A benefit is
   claimed only as registered, and any default change is deferred to #16.
5. **F4-05.** Validity controls per pool (agreement, entrapment, byproducts, pool swap, carryover). Their
   consequences are as listed under scope and label rule.

Any FASTag run that fails, or any pool whose list digest differs from `proteometools_pool_lists.tsv` (the harness
refuses it), makes the verdict INCONCLUSIVE. A re-run is recorded in the registry first and is never silent.

## Scoring command (node data, once)

    git -C <repo> checkout 7ef0f33 -- bench/fastag-bench        # in a scratch clone, hashes above verified
    for s in pool-truth sage-modes run chimera-build score collect; do
      fastag-bench unidentified $s -c acceptance/1.12/scorers/item04/unidentified-test.yaml --split test
    done

The outputs (`endpoints.tsv`, `controls.tsv`, `label_conflict.tsv`, `chimera_endpoints.tsv`, `summary.tsv`) go to
`results/item04/` with a registry row that records the host and the verdict as written by `endpoints.tsv`.

## DEV evidence (in-sample, not a #4 result)

F4-14 (1.11.0, 3 DEV pools): primary 0.232 minus 0.000 = 0.232, CI 0.156-0.308, 245 clusters. TL5 0.254, CI
0.177-0.327. At the frozen margin both would hold on DEV. That is in-sample and says nothing about the test split.
