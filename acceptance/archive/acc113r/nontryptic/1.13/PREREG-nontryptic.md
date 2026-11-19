# PREREG-nontryptic: held-out test of the protease-aware shortlist (1.13 backlog item 20)

Status 2026-11-10: **FROZEN in the commit that adds this file. Not run, not scored.** At the freeze no held-out data
file had been downloaded; selection used PRIDE and SDRF metadata only (titles, protocols, file names, sizes).
The held-out runs are run once and scored once. Nothing is tuned, nothing is rerun with other settings, nothing is
re-scored. The code is not changed. A FAIL is a valid result.

## Candidate and tools

| item | value |
|---|---|
| candidate | `origin/integration/1.13` at 9365ff15429a78b96d3d2b9da2bc3386fcd8d991 |
| binary | `/scratch/kohlbach/b113/nontryptic/heldout/build/FASTag` on node `data`, built with `nontryptic/scripts/build.sh` from a `git archive` of that commit; sha256 `a18b32be6913036f4c4051adb3ffd587c7d354883d42adadf66a9dc118ac9463` |
| Sage | 0.14.7, sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625` |
| converter | ThermoRawFileParser 2.0.0 `-f 2`, sha256 `7303900464d2b0219b78c90566ec8fe3954194cd2245a1faec111be06439ccb2` |
| database | human reference proteome of the DEV check, `Homo_sapiens.fasta`, 20,416 entries, sha256 `dffdff3807ec6eb7e752035b5475aaefa26d1b36e513e3344198d521a2169c42` |
| scorers | `nontryptic/scorers/SHA256SUMS`: score.py `aab604a277c2c971068764e17fbf1a5c88e61dd412a7deace52a8305eafb173f`, verdict.py `2e787aa109a7f8d1e80063e3bda4003c3eed82d02bd76e03cb8be2092816adb6`, score_once.sh `a96bba3fcd6b7bd09043eed1020ed64cb8bc07397e41aaed1488d1502dc87052` |
| run scripts | run.sh `b0d21c01d920bd36cc0af4eb6f644b229daf225be52f5da461c3d48526bcafd5`, stage.sh `92bd790720bfd106490d237b350d8d3a426ef856410720ebc29f06c6af0adcb6`, sagecfg.py `2187381e2b68165fac7bfb1c37d0040138b136d1a4319f08eea2d74b138cc3cb`, make_manifest.py `f03d39067f5b9ead7bcfb88e13b6554cb0b113f90a4ba97ef1186d35efb96fea` |

## Question

On runs digested with a protease other than trypsin, does the shortlist that FASTag builds with
`-shortlist_protease auto` keep more of the proteins a full-database search identifies than the default (trypsin)
shortlist, and does it keep the share the DEV check showed?

## Data

Public PRIDE data only. All files are under `nontryptic/inputs/`.

Pool (metadata only), two sources:
1. `pool_sdrf.ok.tsv`: files of the bigbio SDRF catalogue whose SDRF row names exactly one of Lys-C, Glu-C, Asp-N,
   chymotrypsin, Arg-C, Lys-N as cleavage agent (rules in `scripts/pool_sdrf.py`; only rows that pass are stored).
2. `pool_search.tsv`: PRIDE projects found by keyword search (`scripts/fetch_search.py`, `scripts/pool_search.py`):
   organism Homo sapiens only, Orbitrap instruments only, no cross-linking, DIA, top-down or targeted experiment
   type, protocol names the protease, at least one .raw file name carries the protease token.

Excluded before the draw (`excl_pxd.txt`, 2,420 PXDs): every PXD of an acceptance arm or DEV set on
`origin/acc113r/*`, `origin/acceptance/1.13`, `origin/acceptance/1.12`, `alknodb/prereg-exclude-pxd.txt`,
`acceptance/1.13/item20/dev-exclusion.tsv`, the reserved lists of HELDOUT-COMMON.md (shifts, census, species),
the 1.12 set `item03`, and the DEV runs of this item.

Order: `draw_order.tsv`, per protease a shuffle of the sorted accessions with the seed
`"nontryptic-heldout-1.13:" + protease` (`scripts/draw_order.py`).

Eligibility, read by hand from the PRIDE record in that order (`eligibility.tsv`, one row per record read):
- E1 complex human protein mixture: cell or tissue lysate, biofluid, or a subcellular or biochemical fraction of one.
  Not a purified or recombinant protein, an immunoprecipitate, an in-vitro assay, or an excised gel band of one protein.
- E2 no peptide or PTM enrichment, no isotope label (SILAC, TMT), no cross-linking; DDA, positive mode.
- E3 the protocol states digestion with that protease alone (no mixture and no consecutive digestion with another
  protease, no protease pre-treatment), and file names identify the files of that digest.
- E4 Thermo .raw with Orbitrap HCD MS2 (checked at staging, below).

Per protease the first three eligible projects in the order enter as primary runs, one run per (project, protease);
the next eligible project is the reserve where one exists. Lys-N has no record in the pools. Result (`picks.tsv`):
10 primary runs from 7 projects and 5 proteases (Arg-C 1, Asp-N 2, Glu-C 3, Lys-C 3, chymotrypsin 1), 2 reserve runs.

Files (`stage.tsv`, `scripts/draw_files.py`): candidates are the .raw files of the project with 0.2 to 4 GB whose name
carries the protease token and no exclusion token (blank, wash, negative, TMA, RecTEX, QC, tryp, EThcD, ETD, CID, DIA);
shuffle of the sorted names with the seed `"nontryptic-heldout-1.13:" + protease + ":" + accession`; first = chosen,
second = backup.

Truth for the protease, per file: the PRIDE sample processing protocol of the project names the protease as the only
one for that digest, and the file name carries its token (`picks.tsv`, `stage.tsv`).

Disjointness: `disjointness/nontryptic-heldout.tsv` (no PXD and no file of this set appears in a manifest, result or
exclusion list of another arm or in a DEV set). Manifest of drawn files: `manifests/nontryptic-heldout.tsv`; the
staged files with sha256 are added in `nontryptic/results/staged.tsv` and `manifests/nontryptic-heldout-staged.tsv`,
committed before the candidate runs.

## Technical failures (fixed before the run)

Staging (`scripts/stage.sh`): download from the PRIDE archive, PRIDE SHA-1 check (without a SHA-1: size plus a
second download with the same sha256), conversion, and the check that every MS2 spectrum is FTMS HCD and at least
5,000 MS2 spectra carry a charge state. If the chosen file fails a step, the backup file is used. If both fail, the
run is excluded before any candidate run, and the first unused reserve run of the same protease that passes staging
enters in its place (`scripts/make_manifest.py`). Staging does not involve the candidate.
If fewer than 8 runs from 6 projects or fewer than 3 proteases remain after staging, the test is not run and the
result is INCONCLUSIVE.
A failure of the full-database reference search (Sage exit code not 0) makes the run non-evaluable; it is not rerun.
A failure of the candidate is not a technical failure; it counts under G2.

## Runs (exact commands)

Node `data`, `H=/scratch/kohlbach/b113/nontryptic/heldout`, `$H/frozen/nontryptic` = copy of `acceptance/1.13/nontryptic`
at the freeze commit, 8 threads per run, 5 runs in parallel.

```
bash $H/frozen/nontryptic/scripts/stage.sh $H/frozen/nontryptic/inputs/stage.tsv $H/staged.tsv
python make_manifest.py $H/frozen/nontryptic/inputs/picks.tsv $H/staged.tsv > $H/manifest.tsv
awk -F'\t' '$11 ~ /^in_test/ {print $1}' $H/manifest.tsv | xargs -P 5 -I{} bash $H/frozen/nontryptic/scripts/run.sh $H/manifest.tsv {}
bash $H/frozen/nontryptic/scorers/score_once.sh $H/manifest.tsv $H/out $H/results
```

Per run (`scripts/run.sh`, the calls of the DEV check `dev/run.sh`): FASTag with
`-in <mzML> -recon_fasta Homo_sapiens.fasta -extension 3 -recon_missed_cleavages 2 -fixed_modifications 'Carbamidomethyl (C)' -variable_modifications 'Oxidation (M)' -search_isotope_errors 1 -threads 8 -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out sage.json`
in three arms: `default` (no further option; recorded for its exit code only, since the default refuses the export
on a non-tryptic call), `forced` (`-shortlist_force`: the default trypsin shortlist, arm b), `auto`
(`-shortlist_protease auto`, arm a). Sage at 1 % FDR on each exported FASTA with the exported configuration, and on the
full FASTA with the true protease (arm c: the configuration exported by the auto arm with the FASTA and the cleavage
rule replaced, `scripts/sagecfg.py`).

## Metrics (definitions of the DEV check, `dev/score.py`)

- Reference proteins of a run: accessions with at least 2 target PSMs at spectrum q <= 0.01 in the full search (c);
  each protein of a shared PSM counts.
- Recall of an arm: share of the reference proteins that the arm's shortlist keeps (`kept` in `sl.tsv`). This is the
  recall metric of the DEV table in RESULTS.md and the primary metric here.
- Reported without a verdict: recall of the reference proteins by the Sage search of the exported FASTA (at least 2
  target PSMs at 1 % FDR), PSM counts, size of the exported FASTA, and the speed-up = Sage wall time of the full
  search / Sage wall time of the search of the auto export. The DEV check has no speed-up number, so no threshold
  is set for it.
- Evaluable run: reference search finished and at least 50 reference proteins (below that a recall has a resolution
  worse than 2 %; the DEV runs with 0 to 16 reference proteins are the reason for this limit).

## Criteria (thresholds from the DEV numbers in RESULTS.md, fixed here)

DEV basis, non-tryptic runs with at least 50 reference proteins: recall auto 0.260, 0.074, 0.209, 0.369, 0.336, 0.183
(median 0.235); differences auto minus trypsin shortlist +0.246, +0.074, +0.209, 0.000, +0.003, -0.034; the rule
used by `auto` equalled the true protease in 5 of 8 single-protease non-tryptic DEV runs (0.625).

| id | criterion | PASS | otherwise |
|---|---|---|---|
| E0 | enough evidence | at least 6 evaluable runs from at least 5 projects and 3 proteases | INCONCLUSIVE for P1 and P2 |
| P1 | recall level | median over evaluable runs of recall(auto) >= 0.20 | FAIL |
| P2 | better than the trypsin shortlist | mean over evaluable runs of recall(auto) - recall(forced) > 0 and the lower bound of its 95 % confidence interval > 0 | mean <= 0: FAIL; mean > 0 and lower bound <= 0: INCONCLUSIVE |
| G1 | protease used by auto | the rule in the `# placement:` line of the auto shortlist equals the true protease in at least 60 % of the runs in the test | FAIL |
| G2 | no abort | in every run in the test: auto and forced exit 0, default exits 0 or 6, the auto arm writes sl.tsv, red.fasta and sage.json, and Sage on the auto export exits 0 | FAIL |

P1 and P2 together are the primary criterion; G1 and G2 are guards. The confidence interval of P2 is a percentile
bootstrap over projects (runs of a project stay together), 10,000 resamples, seed 20261110 (`scorers/verdict.py`).

Overall verdict: PASS only if P1, P2, G1 and G2 pass; FAIL if any of them fails; INCONCLUSIVE otherwise (E0 not met,
or P2 with a positive mean and an interval that includes 0, and no criterion failed).

The verdict script was tested on synthetic input before the freeze (`python verdict.py --selftest`: pass, low recall,
no gain, mixed gain, too few evaluable runs, wrong protease, abort, failed reference search), and score.py reproduced
the DEV numbers on the DEV outputs (Asp-N 0.260 / 0.014, Glu-C 0.074 / 0.000, Arg-C 0.369 / 0.369).

## Deviations from HELDOUT-COMMON.md, stated before the run

1. The common candidate pool `acceptance/1.12/inputs/h2r_pride_candidates.tsv` holds trypsin projects only; the pool
   above replaces it.
2. Speed-up has no DEV number; it is reported without a threshold.
3. Chymotrypsin token: the file-name pattern of the search pool was widened from `chymo` to `chym` before the draw
   order was fixed (PXD064794 names its files `Chymo`, its protocol `Chym`); no data file had been opened.
4. Three of the picked PXDs (PXD015759, PXD008333, PXD006465) are listed, unread and unused, in candidate pools of
   other arms (`h2r_pride_candidates.tsv`, alknodb `draw_order.tsv`); no arm staged or ran them.
