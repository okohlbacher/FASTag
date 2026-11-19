# PREREG-item17r: #17 -search_shifts, second held-out test (CFG-17r-cand-113 against CFG-17r-base-113)

Status 2026-11-10: **FROZEN in the commit that adds this file (branch `acc113r/shifts`, pushed before the candidate
binary reads any held-out file). Not run, not scored.** Both configs are run once on the four runs of manifest
`item17r-heldout` on node data and scored once with `score_item17r.py`. Nothing is tuned on held-out data; no
setting is changed and nothing is re-scored afterwards; a technical failure is handled only by the rule below.
Source: `output/backlog-1.13/shifts/PREREG-draft.md`, `REASSESS.md`, `RESULT.md` (DEV work after the first test);
first test: PREREG-item17.md, RESULT-item17.md (item FAIL, configs CFG-17-*-113 spent).

Decisions on the draft's open points (taken by the project lead before the freeze): P4 stays a pass criterion
exactly as drafted; there is no `-shift_max_variable 5` arm.

## Question and endpoint

Does a search with the shifts `-search_shifts` exports (variable modifications, Comet mass offsets, precursor isotope
range) identify more PSMs at 1 % FDR than the same closed search without them, with the error still controlled, on
runs the feature has never seen? Primary endpoint: target PSMs at 1 % PSM FDR, cand vs base, per run and engine.

## Frozen software

| What | Value |
|---|---|
| FASTag (both arms) | branch `feat/b113-shifts` at 28cc8ce (v1.12.2 + label-frame isotope rule), built on data from `git archive 28cc8ce` (`fastag-28cc8ce.tar.gz` `e1bf6393d93aa6f7d38329f227d311b4809c799086682b7c7c6fd21d3ec0c56d`) under `data:/scratch/kohlbach/b113/shifts/heldout/cand`; `opt/FASTag.bin` `ff09dea181334569ea1498db0b7c39adae131bea8ebfdd7afaf7997468a33d13`; `src/data/digest/massgap_mods.tsv` `c1ec6f57718c4f9ea84a975d9ef35a34ca542fcfcc7026aa21ff50f109caa106`; OpenMS share `/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/share/OpenMS` |
| Sage | 0.14.7, binary `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625` |
| Comet | 2026.03.0, binary `ad93b4cf60c2ed7afc2f41b8a3a05567c3938d999f17deb7b3676bc1fa91e7ed`; template `comet.params.new` `0b6abd4c7415a9289d858d3c8fc84031c31d62acf10f174a8123070ebd8fb8fc` |
| MSFragger (reference) | 4.4.1 jar `56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112`; Java OpenJDK 21.0.13 on data |
| Conversion | ThermoRawFileParser 2.0.0 `-f 2`, binary `7303900464d2b0219b78c90566ec8fe3954194cd2245a1faec111be06439ccb2` |
| Scripts, scorer, tables | `item17r/SHA256SUMS` (all files of `item17r/scripts/`, `chem17r.tsv`, `sage_expressible.tsv`, `heldout/driver.sh`); values below |

| File | sha256 |
|---|---|
| `item17r/chem17r.tsv` | `eb619dec589c9af8a399119d0623bbe949c2323bfc860b617f15e19eea9185a3` |
| `item17r/heldout/driver.sh` | `39b522d7892e0a92c6855950666c3ee3866f48d22ca14c4cdea91a08d0344f55` |
| `item17r/sage_expressible.tsv` | `75b3a6ae3cb4a20f49f0736ef46f3290c0c7e45b6fdd32bc5563106664dd4ace` |
| `item17r/scripts/entrap.py` | `035c728f8fceb386db2995e92d7cce282f3cd712dd8d52e7db9da9992a9ebeb9` |
| `item17r/scripts/mkfragger.py` | `d7b6800f91cfd705a257aaff69e73d125746b17753531fcbcec605f0b2dd4e3b` |
| `item17r/scripts/revdecoy.py` | `fed0b54b26908173f537d3bc90df3cfc13779f196126159865a1ff9a784e1d24` |
| `item17r/scripts/run_item17r.sh` | `ae431423d067879d3f4bcb6d5c24e63650309bab5ecd462807925dec66306acf` |
| `item17r/scripts/score_item17.py` | `8ecd686cfb06f9e487eb39b3bc3ccd64a107fdd736079b2f120acbe76347fe27` |
| `item17r/scripts/score_item17r.py` | `f6bbfe0bdbd049564a2061f80731289beb01e3cbde17dac7eaab40f6640a0da0` |
| `manifests/item17r-heldout.tsv` | `c7286a4fd97e5937915f03ba8479bbf1e019583ea0f5e465f049acc483314421` |

`entrap.py`, `mkfragger.py`, `revdecoy.py`, `score_item17.py` are byte copies of `item17/scripts/` (first test).
`run_item17r.sh` checks the sha256 of FASTag.bin, massgap_mods.tsv, Sage, Comet, MSFragger, the Comet template,
the database and the mzML (manifest) before it runs anything. `score_item17r.py --selftest` passes (synthetic
verdict cases: PASS, FAIL per criterion, INCONCLUSIVE for n < 3 admissible peaks and for N < 3 runs).

## Configs

| Config | Options | param_hash |
|---|---|---|
| CFG-17r-base-113 | `FASTag 28cc8ce: -tag_length 4 -extension 6 -fixed_modifications <chem17r.tsv fixed> -variable_modifications <chem17r.tsv variable> -search_config_out, -search_engine sage|comet (-search_config_template comet.params.new for comet), no -search_shifts` | `c1a282f2de713c6f777d6a484a5a408bb59e03cdd0f6061e7ad0b160a1438645` |
| CFG-17r-cand-113 | `CFG-17r-base-113 + -search_shifts variable (sage) | both (comet), -search_shifts_out, defaults -shift_max_variable 3 -shift_max_offsets 10, no site expansion` | `3eec7a7df45cb79b34276420656b801b75abe452ecb03706343da84f0410ae31` |

param_hash = sha256 of the options text as printed. Baseline as the draft defines it: closed search with the run's
declared chemistry (`chem17r.tsv`), Oxidation (M) variable, isotope errors 0. Both arms use the same FASTag binary
(28cc8ce); they differ only in `-search_shifts`. Engine settings are what FASTag writes (precursor 10 ppm, fragment
20 ppm, 1 missed cleavage); the run script changes only the database path (target + entrapment), the spectra path,
threads and Comet's text output. `-shift_expand_sites` is not used.

## Runs

Projects and backups from the draft. File draw per project: sorted list of the project's `.raw` files (PRIDE v3
files API), `random.Random('fastag-1.13:#17r:heldout:<PXD>').choice`. All four primary draws were confirmed; no
backup was needed.

| # | Chemistry | PXD | Drawn file (of n raw) | Declared chemistry: fixed; variable | mzML check |
|---|---|---|---|---|---|
| 1 | label-free | PXD049248 | 2ng_2x_02.raw (15) | Carbamidomethyl (C); Oxidation (M) | instrument in the file: Orbitrap Eclipse (PRIDE: Exploris 480); 46316 MS2, all `FTMS + c NSI d Full ms2 @hcd30.00`, isolation 1.6 m/z |
| 2 | SILAC Lys6 | PXD065251 | X2409FD.raw (20) | none; Oxidation (M), Label:13C(6) (K) | 70580 MS2, all `FTMS + c NSI d Full ms2 @hcd30.00`, isolation 1.6 m/z |
| 3 | TMT10 | PXD037999 | 220819_UM171_RCOR1_NB4_TMT10_F13_of_F13_R2.raw (52) | Carbamidomethyl (C), TMT6plex (K), TMT6plex (N-term); Oxidation (M) | 31975 MS2, all `FTMS + c NSI cv=-45/-60/-80 d Full ms2 @hcd35.00` (FAIMS), isolation 0.7 m/z |
| 4 | TMTpro | PXD073763 | JS-CS-E482_250910_AmendS_ML_TMT2_F3_3ug_45pct.raw (90) | Carbamidomethyl (C), TMTpro (K), TMTpro (N-term); Oxidation (M) | 66315 MS2, all `FTMS + c NSI d Full ms2 @hcd36.00`, isolation 0.7 m/z |

Confirmation before the freeze, from PRIDE metadata only (project records and file lists read 2026-11-10 through
the PRIDE v3 API, community SDRF files, the submitter's design file of PXD065251): DDA, Orbitrap Exploris 480,
HCD with Orbitrap MS2, label as listed; sources per run in `chem17r.tsv`. The "mzML check" column is read from the
converted file with `grep` (`stage/hdr.sh` on data; no FASTag, no search engine): MS2 analyzer `FTMS`, `d`
(data-dependent), `hcd`. PXD065251: the project record and the design file (X2409FD = TTLL3 IP, biological
replicate 3, SILAC 2plex mix Lys6/Lys0) say SILAC; the community SDRF label column says "label free sample". The
record and the design file are followed; the contradiction is recorded here. The record describes no
reduction/alkylation and the submitter searched without a fixed modification, so no fixed modification is declared.

PXD049248: the PRIDE record and SDRF name the Orbitrap Exploris 480; the converted file names the Orbitrap Eclipse.
The admission conditions (DDA, HCD, MS2 in the Orbitrap, label-free) hold in both readings and in the file, so the
run stays; the difference is recorded here. The draft's sentence "all are Exploris 480 projects" is a description,
not a condition.

Database: `Homo_sapiens.fasta` `dffdff3807ec6eb7e752035b5475aaefa26d1b36e513e3344198d521a2169c42` (20416 entries,
the database of the first test) for all four runs.

Staging (download and conversion only, 2026-11-10, `data:/scratch/kohlbach/b113/shifts/heldout/stage/`): manifest
`manifests/item17r-heldout.tsv` (sizes, PRIDE SHA-1 where PRIDE gives one, else PRIDE size and a second download
with the same sha256; raw and mzML sha256). The PRIDE https transfers of PXD037999 and PXD049248 broke off; they
were completed with a resuming download (`curl -C -`) and pass the same checks. Scripts, list and result: `item17r/stage/`.

Disjointness (`disjointness/item17r-heldout.tsv`, checked 2026-11-10): the four accessions, the raw file names, the
PRIDE SHA-1 and the raw and mzML sha256 have no exact match in `origin/acceptance/1.13`, `origin/acceptance/1.12`,
`origin/main`, the candidate tree 28cc8ce, the local acceptance branches, the development lists on data
(`/scratch/kohlbach/fastag112-dev/lists/chem_dev_check.tsv`, `/scratch/kohlbach/gate-in`) or the files of the other
1.13 arms (`output/backlog-1.13`, including the reserved lists of census, species and alknodb); the only mentions
are the lists that reserve them for this test. The spent #17 runs (PXD014764, PXD004541, PXD000001, PXD063151) and
the DEV runs (PXD003531, PXD004541, PXD010744) are not used.

Backups (in this order, used only under the technical-failure rule): label-free PXD058584
`20220909_Exploris1_JD_CDC2_ctrl3.raw`; SILAC PXD082747 `XD01023SPUb_PTM1975_1.raw`, then PXD074990
`XD01023SPUbR1_PTMH1299.raw`; TMT10 PXD045115 `tk200812_786_LB_TMT_45K_02.raw`, then PXD055818
`20220818_C29220_009_S408184_TMT9plex_pool_f8_A.raw`; TMTpro none. Same seeded draw.

## Commands (node data, `/scratch/kohlbach/b113/shifts/heldout/`, 4 runs x 16 threads)

`acc/` = copy of `acceptance/1.13/item17r` and `manifests/item17r-heldout.tsv` at the freeze commit, verified with
`sha256sum -c item17r/SHA256SUMS`.

```
nohup bash acc/item17r/heldout/driver.sh > ho.nohup 2>&1 &
  per run:  bash acc/item17r/scripts/run_item17r.sh <PXD> $PWD/ho 16
  scoring:  python3 -I acc/item17r/scripts/score_item17r.py ho/score acc/item17r/sage_expressible.tsv \
            ho/PXD049248/searches.tsv ho/PXD065251/searches.tsv ho/PXD037999/searches.tsv ho/PXD073763/searches.tsv
```

Per run (`run_item17r.sh`, the commands of the first test): FASTag places against the target database and writes the
engine configuration, four times (base and cand, Sage and Comet); every Sage and Comet search runs on target + a
shuffled entrapment copy (`entrap.py`, r = 1, `ENTRAP_`); Sage adds `rev_` decoys, Comet `DECOY_`. Reference: one
MSFragger open search (-150..+500 Da, `mkfragger.py`, base chemistry) on target + reversed decoys.

## Scoring (once)

PSMs, FDR and FDP as in the first test (`score_item17.py`): rank-1 target PSMs at 1 % PSM FDR (Sage `spectrum_q`;
Comet target-decoy q over e-values), FDP = 2E/(T+E). Open-search peaks as in the first test (top 10 with >= 5 PSMs);
a peak is recovered when a new mass of the cand configuration (variable modification, static change, Comet offset,
isotope error k x 1.0033548) lies within 0.02 Da.

Criteria per engine (draft, unchanged):

| | Criterion |
|---|---|
| P1 gain | PSMs(cand) >= 1.02 x PSMs(base) on >= 3 of the 4 runs |
| P2 error | on every run: FDP(cand) <= FDP(base) + 0.003 and FDP(cand) <= 0.020 |
| P3 no loss | on every run: PSMs(cand) >= 0.99 x PSMs(base) |
| P4 recovery | on >= 3 runs: recovered >= ceil(0.6 n) of the n admissible open-search peaks; a run with n < 3 is not evaluable |

Operational definitions (fixed here, before the run; the draft left them to the scorer):

- Admissible peak: one of the top-10 open-search peaks whose centroid c is not within 0.02 Da of k x 1.0033548,
  k = -1..3 (k = 0 is the unshifted peak). For Sage in addition c > 0 and c within 0.02 Da of the Unimod
  monoisotopic mass of one modification of the candidate's `massgap_mods.tsv` (`sage_expressible.tsv`, 38 rows);
  these are the masses FASTag can export to Sage.
- A peak the base configuration already searches (e.g. Oxidation) stays admissible and counts as not recovered
  unless a new cand mass matches it; the draft lists no such exclusion.
- Reported without threshold: detected (FASTag's `-search_shifts_out` lists a gap peak within 0.02 Da) and exported
  (that row has action `variable` or `offset`), over the admissible peaks.
- The criteria are applied to the numbers as computed. Sage counts differ by about 5 PSMs between identical runs;
  where a P1 or P3 call depends on a difference below 0.1 % of the base count, the result text says so; the verdict
  is not changed by it.

Verdict rule (`score_item17r.py`, `verdict.tsv`):

- P1 PASS if >= 3 runs pass, else FAIL. P2, P3 PASS if every run passes, else FAIL.
- P4 PASS if >= 3 runs pass; else INCONCLUSIVE if fewer than 3 runs are evaluable; else FAIL.
- Fewer than 3 runs scored (technical losses): P1-P4 INCONCLUSIVE.
- Engine: FAIL if any criterion is FAIL; else INCONCLUSIVE if any is INCONCLUSIVE; else PASS.
- Item: PASS only if both engines PASS; FAIL if any engine FAILs; else INCONCLUSIVE. An engine that passes alone is
  reported as such; the item is then not accepted. A FAIL is a valid result.

## Technical failure after the freeze

- Technical failure = a run ends with a non-zero exit or a missing output for a reason outside the tested feature:
  node, file system, memory, a checksum pre-check, or a tool crash that also occurs in the base arm or in the
  open-search reference.
- Such a run is restarted once, unchanged (same script, same commands, same thread count), in a fresh directory
  `ho/<PXD>.retry1`; the failed directory is kept. Scoring waits until every run has ended; a restart is not a second
  scoring.
- If the restart fails too, the run is replaced by the next backup of its chemistry (list above). The backup's
  chemistry row, manifest row and mzML checks are committed and pushed before the candidate binary reads the file.
  No backup left: the run is dropped; with N = 3 the criteria read "on >= 3 runs" / "on every run" over the 3 runs;
  with N < 3 everything is INCONCLUSIVE.
- Not technical: FASTag with `-search_shifts`, or an engine on the cand configuration, fails while the same step of
  the base arm works. That run then counts as failed for P1-P4 of the affected engine and is not replaced; the
  scorer runs over the other runs and the failed run is added to each criterion's count as a fail (stated in the
  result).
- No other change is allowed: no setting, no criterion, no file swap for a non-technical reason.

## DEV checks before the freeze (in-sample only)

- Candidate binary 28cc8ce on DEV runs PXD003531 and PXD004541 fr02 (`heldout/smoke/` on data): all steps exit 0;
  an empty `-fixed_modifications` gives no static modification; the TMTpro names are accepted.
- `score_item17r.py` on the existing DEV outputs of the 28cc8ce build (`/scratch/kohlbach/b113/shifts/re/dev/`,
  2 runs, hence INCONCLUSIVE by the N < 3 rule): PXD003531 P4 pass for both engines (Comet 5 of 8, Sage 3 of 5),
  PXD004541 fr02 P4 fail for both (Comet 1 of 7, Sage 1 of 5); P2 fails for Comet on PXD003531 (FDP 0.91 % -> 1.34 %).
  These numbers changed no setting and no criterion.
