# PREREG-aspn: held-out test of the Asp-N call and semi-specific export of `-shortlist_protease auto` (FASTag 1.13.4)

Status 2026-11-13: **FROZEN (freeze 1) in the commit that adds this file. Not run, not scored.** At this freeze no data
file of the test had been downloaded; selection used PRIDE, SDRF and Europe PMC metadata only (records, protocols,
file names and sizes). The test is staged once, run once and scored once. Nothing is tuned, nothing is rerun with
other settings, nothing is re-scored, the code is not changed. A FAIL is a valid result; a FAIL makes the set a
development set.

Authorization: user interview 2026-11-13 ("Asp-N semi export" among the held-out tests to run next; fresh draw).

## Candidate and tools

| item | value |
|---|---|
| candidate | FASTag 1.13.4, tag v1.13.4 = main 0ddff9b72ad5f92d82ab3f52f8329fc61d084d9c; Asp-N call rule 826bf6c, semi export of an Asp-N call c56f2b3 (post-1.13.1 development work, development runs only) |
| binary | `/scratch/kohlbach/acc114/aspn/build/FASTag` on node `data`, built with `/scratch/kohlbach/post1131/aspn/build.sh` (cmake Release, fastag-omsdev env, OpenMS develop 70cebcd144) from `git archive` of 0ddff9b (archive sha256 87c6b5b600109b68ec0f87509f5f0c70dae32beb456dc97a2cd572a5e9d00cc4); binary sha256 `c0ea115df2b2d2037fed508811fb557e34860ea003e37ab4cf1134911cd91b7c` |
| Sage | 0.14.7, sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625` |
| converter | ThermoRawFileParser 2.0.0 `-f 2`, sha256 `7303900464d2b0219b78c90566ec8fe3954194cd2245a1faec111be06439ccb2` |
| human database | `Homo_sapiens.fasta` of the 1.13 nontryptic test, 20,416 entries, sha256 `dffdff3807ec6eb7e752035b5475aaefa26d1b36e513e3344198d521a2169c42` |
| other databases | all UniProtKB entries of the reference proteome, downloaded once at staging by `scripts/get_db.sh`: *Mycobacterium marinum* UP000001190, *Trypanosoma brucei* UP000008524; sha256 and entry counts recorded in freeze 2 before any FASTag run |
| scorers | `aspn/scorers/SHA256SUMS`: score.py `00de1dc9b34bef1720a5bfcb2713ff1ad9446b908462774a4b213a07999ecf60`, verdict.py `1636d0fd948d10c656e1869b906cf144b024af7465e84d6453aa6b94aa3095c4`, score_once.sh `233b1af4b63d05357db75ac9b0515689c04c1a8792c3236c9e32ad5e147763b4` |
| run scripts and inputs | `aspn/SHA256SUMS` (every script and input file of this commit) |

## Question

On Asp-N digests FASTag has never seen, does `-shortlist_protease auto` call Asp-N, does it avoid calling Asp-N on other
digests, and does its semi-specific export of an Asp-N call keep more of the proteins a full search finds than the
trypsin shortlist and than an Asp-N export at full specificity, at about the Sage time of the full search?

## Data

Public PRIDE data only. Files under `aspn/inputs/`.

### Exclusion (`excl_pxd.txt`, 3,247 PXDs; `scripts/build_excl.py`)

Every PXD that occurs in a file (i) of any branch of okohlbacher/FASTag (all acceptance and development branches),
(ii) under `New Tools/FASTag/output/`, or (iii) under the node-data work folders `/scratch/kohlbach/{post1131,post1133,
b113,b113-binac,b114,post0131}`, unless that file is a PRIDE-wide catalogue or candidate pool (more than 5,000 PXDs, or a
pool, candidate, search, draw-order, prescreen, eligibility, selection-log or machine-wide mention scan file). Sources:
`excl_sources_{git,output,data}.tsv.gz` (path, PXD). The list contains all 1,625 PXDs of `alknodb/prereg-exclude-pxd.txt`,
the 152 development projects of the aspn track (incl. Asp-N development projects PXD000900, PXD010154, PXD010783,
PXD033378, PXD051338, PXD064794, PXD068586), the 1.13 nontryptic set (incl. PXD040583), the species, shifts and census
reserves and the item03 held-out set. Projects of the same lab as a development project are excluded by reading
(PXD068589, PXD068593).
Parallel 1.14 tests (acc114/acqcheck3, compltol3, exactonly): none of the 9 projects below is in their manifests
(checked 2026-11-13 on the pushed branches; the PXDs occur there only in exclusion lists and candidate pools).

### Asp-N pool and eligibility

Pool (`aspn_pool_raw.tsv`, 391 PXDs not excluded): PRIDE v3 keyword search for Asp-N, AspN, "Asp N", "endoproteinase
Asp-N", "endoproteinase AspN", "Asp-N digestion", "AspN digestion", "Asp-N protease" (203 projects, `scripts/fetch_search.py`);
the PXDs text-mined by Europe PMC from 212 articles that mention Asp-N/AspN (`aspn_epmc_articles.tsv`, `scripts/epmc.py`);
the Asp-N rows of the bigbio SDRF catalogue. Metadata filter (`aspn_pool_filtered.tsv`, 68 projects, `scripts/pool_aspn.py`):
an organism of the 12-organism panel, an Orbitrap instrument capable of HCD, not only cross-linking/top-down, Asp-N in the
PRIDE protocol, description or title. In addition every project of the pool with an organism/instrument match was
checked for raw files named with an Asp-N token, and the projects with Asp-N-named files outside the panel were read.

Eligibility, read by hand from the PRIDE record (`aspn_eligibility.tsv`, all 68 filtered projects and 18 more):
E1 complex protein mixture of one organism (lysate, tissue, biofluid, secretome, subcellular or biochemical fraction; not a
purified protein, immunoprecipitate, gel band of one protein, antibody, synthetic peptides or a microbial community);
E2 no peptide/PTM enrichment, no isotope label, no cross-linking, DDA; E3 Asp-N alone for that digest, files of that
digest identifiable by name; E4 Thermo .raw with Orbitrap HCD MS2 (checked at staging); a UniProt reference proteome for
the organism.

Result: only two eligible projects with a panel organism (PXD001111, PXD027242). To reach three projects the panel was
widened, before any data file was read, to organisms with a UniProt reference proteome; this adds PXD050612 and
PXD059041. Eligible Asp-N projects (all four enter the test):

| pick | PXD | sample | instrument | database |
|---|---|---|---|---|
| A1 | PXD001111 | Jurkat/HeLa lysate (FASP), Asp-N, SCX fractions (`*_SCX_AspN_R_F*.raw`) | Q Exactive | Homo_sapiens |
| A2 | PXD027242 | human cell lysate, Asp-N, DDA HCD (`*AspN*HCD*.raw`; CID and digest mixtures excluded) | Fusion Lumos | Homo_sapiens |
| A3 | PXD050612 | *M. marinum* culture filtrate, Asp-N (`AspN_CF_*.raw`; GST and EspG5 purified-protein files excluded) | Fusion Lumos | Mycobacterium_marinum (UP000001190) |
| A4 | PXD059041 | *T. brucei* purified flagella, Asp-N aliquot (`*_AspN_R*.raw`) | Q Exactive Plus | Trypanosoma_brucei (UP000008524) |

Three slots per Asp-N project (12 Asp-N slots).

### Controls (the call must not be Asp-N)

- In-project controls, one slot each: K1 PXD027242 Glu-C (HCD), K2 PXD027242 trypsin (`_Tr_HCD`), K3 PXD050612 trypsin
  (`Typsin_CF*`), K4 PXD059041 chymotrypsin (`Chemotrypsine`).
- Independent trypsin controls, one slot each: bigbio SDRF files (commit a3931ff6, `scripts/pool_sdrf_tryp.py`: trypsin
  alone, human, label-free, Orbitrap/Q Exactive/Exploris, HCD, not DIA/targeted, no enrichment or label modification;
  2,578 projects not excluded), order = seeded shuffle `"aspn-heldout-1.14:control:Trypsin"` (`control_trypsin_order.tsv`),
  first five projects eligible by E1/E2 (`control_trypsin_eligibility.tsv`): K5 PXD067401, K6 PXD022469, K7 PXD044780,
  K8 PXD049174, K9 PXD017391.

Truth (`picks.tsv`): the protease of the PRIDE protocol for that digest and the file-name token; for K5-K9 the SDRF
cleavage agent of the file. Audited again before freeze 2 from the PRIDE records and the paper text.

### Files

`stage.tsv` (`scripts/draw.py files`): per pick, Thermo .raw files of 50 MB to 4 GB whose name carries the protease token
(or, K5-K9, an SDRF trypsin file) and no exclusion token (blank, wash, negative, QC, ETD/EThcD, CID, DIA, IP, mix), sorted
and shuffled with the seed `"aspn-heldout-1.14:<group>:<protease>:<PXD>"`; slot s of a pick with n slots takes the files at
positions s, s+n, s+2n, … of that order, at most `files_per_slot` (A1 3, A2-A4 2, controls 3).

## Staging and technical failures (rule fixed here)

`scripts/stage.sh` on node `data`, one download at a time: per slot its files in order until one passes: download over
https from the PRIDE archive (up to 8 resumed tries; PRIDE SHA-1 checked; without one, size plus a second download with
the same sha256), conversion, check that every MS2 is FTMS HCD and at least 2,000 MS2 carry a charge state. A slot whose
files all fail is excluded without replacement (`scripts/make_manifest.py`). Staging does not involve the candidate.
Databases by `scripts/get_db.sh`. Freeze 2 = staged manifest with sha256 of every raw, mzML and database, the truth audit
and the mzML header check, committed and pushed before the first FASTag run.
If after staging fewer than 6 Asp-N slots from 3 projects or fewer than 6 control slots from 3 projects remain, the test
is not run: INCONCLUSIVE (insufficient data).
A failed reference search (Sage rc != 0 on its first repeat) makes a run non-evaluable; it is not rerun.
A failure of the candidate is not a technical failure; it counts under G1.

## Runs (exact commands)

Node `data`, `H=/scratch/kohlbach/acc114/aspn/heldout`, `$H/frozen/aspn` = copy of `acceptance/1.14/aspn` at the freeze-2
commit; 12 threads; runs one after the other (`scripts/run_all.sh $H/manifest.tsv`); score with
`bash $H/frozen/aspn/scorers/score_once.sh $H/manifest.tsv $H/out $H/results`.

Per run (`scripts/run.sh`): FASTag `-in <mzML> -recon_fasta <db> -extension 3 -recon_missed_cleavages 2
-fixed_modifications 'Carbamidomethyl (C)' -variable_modifications 'Oxidation (M)' -search_isotope_errors 1 -threads 12
-out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out sage.json` with
- `auto`: `-shortlist_protease auto` (the candidate behaviour: an Asp-N call is placed and exported semi-specific),
- `autofull` (Asp-N runs only): `-shortlist_protease auto -shortlist_specificity full` (the Asp-N export at full specificity),
- `tryp`: `-shortlist_force` (the default trypsin shortlist).
Sage on each export as written (FASTA and mzML paths set by `sagecfg.py`), and the reference = Sage on the full database
with the true protease at full specificity (`sagecfg.py --enzyme`, other settings from the auto export). Timing: full and
auto searches interleaved three times (full, auto, full, auto, full, auto); autofull and tryp once.

## Metrics (`scorers/score.py`)

- Reference proteins: accessions with at least 2 target PSMs at spectrum q <= 0.01 in the first full search.
- Recall of an arm: share of the reference proteins the arm's shortlist keeps (`kept` in sl.tsv; metric of the 1.13
  nontryptic test). Reported without threshold: recall by Sage on the export, PSMs, shortlist sizes.
- Time ratio: median Sage wall time of the three auto-export searches / median of the three full searches.
- Evaluable Asp-N run: reference search rc 0, >= 50 reference proteins, recall of all three arms defined.
- Call: rule in the `# placement:` line of the auto shortlist; specificity from the same line and `semi_enzymatic` in sage.json.

score.py reproduces the development numbers on the development outputs of PXD064794 (recall auto 0.2480, Asp-N full
0.1807, trypsin shortlist 0.0079, 891 reference proteins).

## Criteria (thresholds from the development runs in post-1.13.1/aspn/RESULT.md)

Development basis: Asp-N called on 4 of 7 Asp-N development runs (0.57), never on 169 other runs; semi minus full export
recall +0.07, +0.10, +0.075 (and +0.18 named); auto time / full time 1.09, 1.02, 0.77.

| id | criterion | PASS | otherwise |
|---|---|---|---|
| E0 | evidence | >= 6 evaluable Asp-N runs from >= 3 projects and >= 6 control runs (auto rc 0) from >= 3 projects | INCONCLUSIVE overall |
| C1 | Asp-N call | auto placement Asp-N in >= 0.50 of the Asp-N runs in the test | FAIL |
| C2 | no false Asp-N call | auto placement Asp-N in 0 control runs | FAIL |
| R1 | semi export vs trypsin shortlist | over evaluable Asp-N runs called Asp-N: mean recall(auto) - recall(tryp) > 0 and lower 95 % bound > 0 | mean <= 0 FAIL; else INCONCLUSIVE |
| R2 | semi export vs Asp-N full export | same, recall(auto) - recall(autofull) | mean <= 0 FAIL; else INCONCLUSIVE |
| T1 | run time | median time ratio over evaluable Asp-N runs called Asp-N <= 1.25 | FAIL (a missing time counts as FAIL) |
| G1 | no abort | every run: auto and tryp rc 0 with sl.tsv, red.fasta, sage.json written, Sage on the auto export rc 0 (all repeats); Asp-N runs also autofull rc 0, exports written, Sage rc 0 | FAIL |
| S1 | semi export | every auto Asp-N call placed and exported semi-specific; every autofull Asp-N call full | FAIL |

R1, R2 and T1 need >= 3 evaluable Asp-N runs called Asp-N from >= 2 projects, else INCONCLUSIVE. Confidence intervals:
percentile bootstrap over projects, 10,000 resamples, seed 20261113. Overall: PASS only if E0 and all of C1, C2, R1, R2,
T1, G1, S1 pass; FAIL if any fails; otherwise INCONCLUSIVE. `verdict.py --selftest` passes (all-pass, C1, C2, R1, R2, T1
and missing-time failures, R2 interval over 0, too few runs or projects, aborts, failed Sage repeat, wrong specificity,
failed reference search, too few Asp-N calls).

## Deviations from the common rules, stated before the data

1. Organism panel widened to UniProt reference proteomes (two projects), because only two eligible Asp-N projects exist
   with a panel organism.
2. Timing on node `data` (shared): full and auto searches interleaved three times within each run, median ratio; no
   idle allocation.
3. MS2 count minimum 2,000 (not 5,000): A1 files are SCX fractions of 70-115 MB.
4. Controls partly from the Asp-N projects (other digests of the same samples), partly independent trypsin projects.
