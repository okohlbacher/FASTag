# PREREG: label discovery, held-out test 5 (single-spacing SILAC pairs with a site check)

Status: FROZEN. Date: 2026-11-12. Written before any file of this test was staged and before any FASTag binary read a
file of this test. Freeze 1 = the commit that adds this file. Freeze 2 = the commit that adds
`labeldisc5/manifests/audited.tsv` (staging and truth audit), pushed before the first FASTag run. Run once, scored once.

## What is tested

The call of `-label_discovery_out`, report format 5, with the single-spacing SILAC rule and its site check of
`post1131/labeldisc-silac-it` (`ld_pair silac_single`: one SILAC spacing, Lys8, Arg10, +6.0201 Lys6/Arg6 or +3.989
medium to heavy, with >= 30 pairs and a ratio >= 20 to the controls, no dimethyl signal, not in `silac_site_veto`;
applied to a no call or a `label-free` call. `silac_site_veto`: a spacing is removed when pair share x tag spectra of
the unlabelled K/R site rows >= 60 and the site scan has no K/R candidate within 10 mDa of the heavy label).

| arm | branch | commit | binary sha256 (`FASTag.bin`, node `data`) |
|---|---|---|---|
| candidate (t2) | `post1131/labeldisc-silac-it` | 5ee39a5 (rule a2d0719 + site check 5ee39a5; docs aeb0417 after, no code) | 4f9db2a7e3651e1216a64bf7887bc967e157417d5c6f3f75d12c5753baf4a61c |
| baseline (t0), judged for P-S1 and E1 | `post1131/labeldisc-silac-it` merge of main (= report format 5 on main) | 2cf037b | 9e32b73ff63f1c93ae84a658d44039488a8f23db7165a5a5d06084740f3aea9c |

Builds: `/scratch/kohlbach/post1131/labeldisc/opt-t2/` and `opt-t0/` on `data` (sources `src-t2`, `src-t0`;
`src/LabelDiscovery.{cpp,h}` checked equal to the commits at freeze). FASTag 1.13.1 (`main` d16328b) is not run in this
test (it was a not-judged reference in the draft; left out to keep the compute to two arms). Param-Medic is not run (no
criterion uses it).

The rule, its threshold (ratio 20) and the site check (60 spectra, 10 mDa) were set on development sets only: DEV (84),
test 1 audited (172), test 3 (163), no-call test (70), test 4 (144, spent). None of the projects selected below was read
by any FASTag build.

## Data

Public PRIDE projects only, Thermo `.raw`, one run per project, converted with ThermoRawFileParser 2.0.0 as in test 4.

Pools: the PRIDE project table of tests 3, 4 and the no-call test (`pool.json`, 14,247 projects, PRIDE state
2026-11-09), the dimethyl keyword pool of test 4 (`pool_dimethyl_kw.json`), and a new keyword pool of the PRIDE project
search for isotope-coded probes (`scripts/fetch_kw_pool.py`, keywords: isoTOP-ABPP, isoTOP, isoDTB, pChem, isotopically
labeled probe, isotopically labelled probe, light and heavy probe, isotope-coded, chemoproteomics, activity-based protein
profiling; `pool_probe_kw.json`). The keyword pool only widens the search; class membership is decided by the text rules below.

Disjointness: `manifests/excluded_pxd.txt` = the test-4 list (14,784 PXDs) plus every PXD of the test-4 selected,
staged, audited and backup manifests, plus every PXD named (file content or path) under the FASTag work, output and data
folders on the Mac and under `/scratch/kohlbach/post1131` (all tracks, incl. the SILAC diagnostics `labeldisc/silacit`),
`/scratch/kohlbach/b113`, `/scratch/kohlbach/post0131` and `/scratch/kohlbach/fastag*` on `data`, collected at freeze by
`scripts/collect_pxd.py` (text files up to 64 MiB; never a file without read permission). Catalogue rule as test 4: a
file naming more than 2,000 PXDs is a PRIDE pool table and skipped. New (catalogues that test 4 did not meet): a directory
whose file or subdirectory names name more than 2,000 PXDs (a copy of the bigbio SDRF catalogue, a per-project PRIDE
metadata cache), a directory whose files together name more than 2,000 PXDs (cached pages of the PRIDE search), and any
page or pool of the PRIDE project search (JSON list or map of project records) are skipped too (list:
`manifests/excl_catalogues.txt`). Project file lists of earlier selections (`files/<PXD>.json`), selection logs,
manifests and results are not catalogues: their projects stay excluded, also those an earlier selection only looked at.
Count and checks: see the freeze-1 addendum below.

Selection: `scripts/select_heldout5.py` (all rules are in the script): the test-4 selection script with the seed
`fastag-1.13.1:labeldisc5:`, the targets below, the probe class and the SILAC sub-labels. Truth class from the PRIDE
quantification field and free text as in test 4; projects with an SDRF that disagrees are dropped; labels outside the
vocabulary, DIA, targeted, cross-linking and top-down projects are dropped. One `.raw` of 30 MB to 2 GiB per project,
drawn by the seed; ranks 1 and 2 are backups. Instrument cells: HYB (LTQ Orbitrap, Velos, Elite, XL), TRI (Fusion,
Lumos, Eclipse, Ascend), QE (Q Exactive, Exploris).

| class | HYB | TRI | QE | projects |
|---|---|---|---|---|
| label-free | 30 | 10 | 10 | 50 |
| chemoproteomics isotope-coded probe (`probe = yes`; truth label-free for the label call) | 4 | 4 | 6 | 14 |
| SILAC | 30 | 6 | 8 | 44 |
| dimethyl | 12 | 4 | 4 | 20 |
| TMT 2/4/3, TMTpro -/5/3, iTRAQ4 2/-/-, iTRAQ8 2/1/2 | 6 | 10 | 8 | 24 |
| all | | | | 152 |

SILAC sub-label from the PRIDE text (`silac_sub`: light/heavy Lys8/Arg10; light/medium Lys6/Arg6 (or Arg6 only);
triple; Arg10 only or Arg-C; Lys only; unknown), recorded, never used to include or exclude. Sub-targets, filled first
in one seeded order over the SILAC projects of the named cells (only the order of the draw depends on them): >= 15
light/medium Lys6/Arg6 (any cell), >= 5 Arg10 only or Arg-C (TRI and QE, i.e. high-resolution MS2 likely); >= 20 SILAC
runs with ion-trap MS2 is expected from the 30 HYB projects (not selectable from metadata; measured by the audit).
A sub-target or cell that the pool cannot fill is recorded in the freeze-1 addendum; the run counts as drawn.

Isotope-probe negatives: projects whose PRIDE text names an isotope-coded chemical probe or tag (regex `R_PROBE`:
isoTOP, isoDTB, pChem, isotopically label(l)ed probe, light and heavy / heavy and light / light/heavy probe,
isotope-coded); excluded when the text also states SILAC, dimethyl, or a K/N-terminal or isobaric label (ICPL, mTRAQ,
18O, 15N, NeuCode, DiLeu, reductive, formaldehyde, acetyl, propionyl, TMT, iTRAQ, isobaric). A project with a probe
keyword never enters another class. Truth for this test: label-free (no K/R label); a SILAC call on one is wrong.

Text check before freeze 1 as in test 4 (`scripts/papercheck.py`: label sentences of the PRIDE record and of the paper,
read for every probe, SILAC and dimethyl project and for the lines of other classes that name another label; a truth
class is never changed; a contradiction drops the project, recorded in `manifests/manual_exclusions.tsv`).

## Truth audit (after staging, before any FASTag run) = freeze 2

Unchanged from test 4 (`scripts/audit_scan.py`, `scripts/audit_heldout5.py` = `audit_heldout4.py` plus the columns
`probe` and `silac_sub`; reporter scan; thresholds of PREREG-labeldisc4.md; probe runs are audited as label-free).
The MS2 analyzer stratum (FT / IT / mixed) is measured by the scan. Ion-trap MS2 in the criteria = stratum IT or
mixed. SILAC and dimethyl truth is not checked against MS1 pairs. No run is replaced after the audit.

## Commands (run once)

On `data`, `H=/scratch/kohlbach/post1131/labeldisc/heldout5`: `scripts/run_all.sh` = per arm X in t2, t0

    python3 -I scripts/run_heldout5.py manifests/audited.tsv ../opt-X/FASTag ../opt-X/FASTag.bin <sha256> \
        /scratch/kohlbach/fastag-labeldisc/src/data/digest runs-X 5
    # per run: FASTag -in <mzML> -out <tmp> -tag_length 4 -threads 8 -subsample_fraction 0.25 -fragment_tolerance 20.0
    #   -fragment_tolerance_unit ppm -digest_out digest.tsv -label_out label.tsv -label_discovery_out ld.tsv
    #   env FASTAG_FULL_PRECISION=1 FASTAG_DIGEST_DIR=<digest dir>
    python3 -I scorers/score_labeldisc3.py manifests/audited.tsv runs-X - score-X
    python3 -I scorers/verdict_labeldisc5.py manifests/audited.tsv score-t2 score-t0 runs-t2 verdict.md

Five FASTag jobs of 8 threads (40 threads). The runner checks the binary sha256 and every input sha256 before the run.
sha256 of the frozen files: see the freeze-1 addendum.

## Criteria (fixed now)

Outcome per run as in tests 3 and 4: correct, no call, wrong (another class, two classes, `ambiguous:` or `unknown:`).
A SILAC call is correct at class level whatever SILAC labels it names. A "SILAC call" on a probe run = any SILAC token
(Lys<n>, Arg<n>, Label:13C/2H/15N) in `ld_call labels`.

| id | criterion | threshold | minimum number for PASS |
|---|---|---|---|
| S1 (primary, safety) | wrong calls on audited label-free runs (probe = no), candidate | 0 | >= 40 label-free runs, >= 20 with ion-trap MS2 |
| S2 (safety) | SILAC calls on isotope-probe runs, candidate | 0 | >= 8 probe runs with a SILAC spacing (lys8, arg10, lys6arg6 or medium_heavy pairs) >= 30 pairs and pairs / (control_pairs + 5) >= 20 in the candidate report |
| P-S1 (safety) | runs wrong with the candidate and not wrong with the baseline (all included runs) | 0 | - |
| E1 (efficacy) | SILAC runs with ion-trap MS2: correct with the candidate minus correct with the baseline | >= 3 | >= 15 such runs |
| R-SILAC | strict SILAC recall, candidate, no call = miss | >= 0.70 | >= 30 SILAC runs |
| F | labelled runs called label-free / labelled runs, candidate (probe runs are not labelled) | <= 0.05 | >= 60 labelled runs |
| I1 (reported, does not decide) | class changes baseline -> candidate on runs with candidate `ld_pair silac_single = no` | 0 | - |
| D1 (reported) | per SILAC sub-label: correct / no call / wrong, both arms | - | - |
| V1 (reported) | runs with `silac_site_veto` not `-`, by class, and the SILAC runs among them with their outcome | - | - |

Verdict per criterion: FAIL if the threshold is missed; else INCONCLUSIVE if a minimum number is not reached; else PASS.
Rule supported (candidate PASS) only if S1, S2, P-S1, E1, R-SILAC and F are PASS; FAIL if any is FAIL; else
INCONCLUSIVE. Nothing is merged, tagged or closed by this test. Also reported without threshold: the scorer tables of
both arms (per family, strata, Clopper-Pearson bounds), the arm-paired table per family, and one line of cause per wrong
call of the candidate (looked up after scoring; changes no score).

## Technical failures (bounded backup rule; test 4 retried one download 583 times)

`scripts/stage_heldout5.sh`: for rank r = 0, 1, 2 in turn, the rank-r file of every project without a staged file is
staged by `stage_pride.sh` (each download up to 4 curl attempts with `--retry 3`, PRIDE SHA-1 or size plus a second
identical download). A row whose download failed or whose two downloads differ is rerun at most 2 times, 10 minutes
apart; a conversion failure is not rerun. A project still without a staged file moves to rank r+1; after rank 2 it is
dropped and not replaced. All before the audit. A failed FASTag run counts as no call; a harness failure (node, disk,
runner script) is fixed, rerun once and recorded. No tuning, no second scoring, no change of a criterion after freeze 1.

## Deviations known at freeze

- Draft changes before this freeze: reference arm 1.13.1 and Param-Medic left out; "ion-trap MS2" defined as stratum IT
  or mixed; S2 minimum computed from the candidate report; the TMT/TMTpro/iTRAQ split of the 24 isobaric projects; the
  catalogue rules above (without them the collected list named 26,009 PXDs, among them the whole bigbio SDRF catalogue
  copy (14,676), the 12,288 per-project caches of `b113/alknodb` and the PRIDE search caches of tests 3 and 4, and
  excluded every remaining dimethyl project of the pool although no file of those projects was read).
- Exclusion and selection were iterated before this freeze on metadata only (PRIDE records and file lists; no data file
  downloaded, no FASTag run): the probe regex first matched "isotop(e)" case-insensitively (fixed: names case-sensitive),
  and the catalogue rules above were added after the dry runs showed empty cells. No selection was redrawn after a
  look at any outcome; the seed was set before the first draw.
- PXD027764 (selected probe project) is a sibling project of PXD027767 (pChem benchmarking series of the same lab),
  the development run on which the site check was found. Disjoint by PXD; kept (the rule is PXD-disjointness).

## Addendum: freeze 1 (selection; nothing staged, no FASTag run)

Exclusion list `manifests/excluded_pxd.txt`: 15,397 PXDs (test-4 list 14,784; test-4 selected/staged/audited/backup
manifests 160; data folders 3,582 and Mac folders 3,223 by `collect_pxd.py`; union). Catalogues skipped:
`manifests/excl_catalogues.txt`. Pool after exclusion: 14,247 + 957 dimethyl-keyword + probe-keyword projects
(`manifests/pool.tsv`). Checks: selected projects (rank 0, 147) in the exclusion list 0; in the audited/selected
manifests of DEV (`dev-audited.tsv`, 98 PXDs), test 1 (`ho-audited.tsv`, 165), test 3 (`ho3-audited.tsv`, 185), no-call
(`nc-audited.tsv`, `nc-selected-pxd.txt`, 79), test 4 (`ho4-audited.tsv`, 160) 0; in the SILAC diagnostics
(`labeldisc/silacit`, 650 PXDs) 0.

Selection (`manifests/sel.log`, `selection_log.tsv`): 147 projects at rank 0.

| class | HYB | TRI | QE | drawn / target |
|---|---|---|---|---|
| label-free | 30 | 10 | 10 | 50 / 50 |
| probe | 3 (of 5 eligible) | 4 | 5 (of 5 eligible) | 12 / 14 |
| SILAC | 30 | 6 | 8 | 44 / 44 |
| dimethyl | 12 | 2 (of 7) | 3 (of 5) | 17 / 20 |
| TMT, TMTpro, iTRAQ4, iTRAQ8 | 2+0+2+2 | 4+5+0+1 | 3+3+0+2 | 24 / 24 |

Shortfalls (the pool cannot fill them; the run counts as drawn): probe 12 of 14; dimethyl 17 of 20; SILAC sub-target
"Arg10 only or Arg-C" 0 of 5 (no eligible project in TRI or QE; the Arg10-only check of the site veto is therefore not
covered by this test). Sub-target light/medium Lys6/Arg6: 15 of 15 (16 SILAC projects carry the sub-label in all).
SILAC sub-labels at rank 0: light/medium Lys6/Arg6 16, triple 15, unknown 11, light/heavy Lys8/Arg10 2 (a coarse text
regex; `triple` also catches texts that name medium and heavy media in any sense; reported in D1 as drawn).

Text check (`scripts/papercheck.py`, `manifests/textcheck.tsv`; paper: Europe PMC full text 79, abstract 35, PMID not
found 22, none listed 11): read every line of the 12 probe and 17 dimethyl projects and, for the other classes, the
lines that name another label. Probe projects: OxICAT/ICAT (3), d0/d5-NEM (1), isoTOP-ABPP / heavy-light biotin-TEV or
biotin-azide (4), pChem light/heavy Azido-UV-biotin (4, two of them negative-control series): all non-K/R; kept. Dropped
(`manifests/manual_exclusions.tsv`, not replaced): PXD006996 (SILAC; the paper also reports a label-free analysis, the
drawn file is not identifiable as a SILAC run), PXD075416 (dimethyl; N-terminomics with one protein-level label, outside
the vocabulary). No truth class was changed. Included before the audit: 145 projects.

Frozen files (sha256): `scorers/score_labeldisc3.py` 134e7c8785223f7ad044b167689ba6504763ab01fd477fd191b4dbfbd1edb1e6
(test 3/4 scorer, unchanged); `scorers/verdict_labeldisc5.py` 380df3280abf1d986125a20334ea9be27f40b9c75fc84095acaf2028ea9f322e
(`--selftest`: ok); `scripts/run_heldout5.py` a0a07084743d5ebc13398299ed142d5b5e56e1ac8badbbc4ddc8f238c19b9d3f;
`scripts/run_all.sh` b0a0ea5ad3cb44e292150cc3cfd3613a54fb50d3b032be02b07a33b599d679cb; `scripts/audit_heldout5.py`
6dfeebc6d7396713ce203595c155e78f5cb3d612bd1304169c9622e236a89100; `scripts/audit_scan.py`
09646d4dee9d6f2b94ff81ecdcb92da0081cb0f7bcddde0ffa4bd6dfa4342603 (test 4, unchanged); `scripts/audit_all.sh`
b2f3fb4dfc5aed6ceb6d1785083dba34455cb06e33e45e4e4559ecca0c281d3c; `scripts/stage_heldout5.sh`
1a1748b2f9822e89b7f87b9576f810cc9e2fcbda807b9a0475f6f6602a2b9290; `scripts/stage_pride.sh`
42681547468833a0c67cf8cb1e425e6971e794ef760afbb4deed9531c65c2f65; `scripts/select_heldout5.py`
00c3f8ab8adf6c40cc291b49c7ab4743f1673bca65a6d7bfa6d46130b1d47897; `manifests/selected.tsv`
7b1b2d886f97494b5baeae0956a22edf6bb426cc85314fe4afb567ad12d72476; `manifests/excluded_pxd.txt`
bc5949743a9c6f1e1b28f64462fae8bde2ddd90c7e7d71e4623909db613017c8; `manifests/manual_exclusions.tsv`
97e859fdeb789bbc20b86d83ab1f0d83504aa89b494b55b254ebfcdaf6905bf1.

Expected numbers against the minimum numbers (decided only by the audit): label-free 50 (>= 40; ion-trap MS2 from 30
HYB, >= 20 likely), probe 12 (S2 needs >= 8 with a SILAC spacing signal, unknown before the run), SILAC 43 (>= 30;
ion-trap MS2 >= 15 likely from 30 HYB), labelled 83 (>= 60).
