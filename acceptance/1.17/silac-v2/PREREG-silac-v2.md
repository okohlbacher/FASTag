# PREREG-silac-v2: held-out test of `-label_format 2` (route-split SILAC ends, per-label calls)

**FROZEN 2026-11-26 (17:15 UTC), before any held-out data file was fetched and before any held-out FASTag run.**
Drafted 2026-11-26 earlier the same day; the owner's decisions and the freeze record (section 0) were added at
the freeze. Nothing below changes after this point; any later change is a listed deviation in the result.

## 0. Freeze record

| Item | Frozen value |
|---|---|
| Source | `feat/silac-labels` **e1557be64a4f55673d0d319170a777057314ca89** (PR #136; the development run used 858b4b3a, which differs only in two description sentences of `silac2Rows`) |
| Binary | CI run 45831304804, artifact `FASTag-linux-x64-portable`: tarball sha256 **4e6df7eecd4b6be7204421eeddafcaac61b32f7a59774fd95edab024a90cce74**, `FASTag/FASTag.bin` sha256 **fa96966c2b5e28f00fb6c10b0401ecadca2fa09ec5144fac37b5b7bd7c6e577e**; installed read-only as `/ceph/ibmi/abi/oliver/fastag-bench/fastag/silac-v2-e1557be6/` (`VERSION.txt`); `--version` "FASTag 1.16.2 (OpenMS 3.7.0-pre-HEAD-2026-11-02)" |
| Command | `FASTag -in <run> -out tags.tsv -label_out label.tsv -label_format 2 -digest_out digest.tsv -qc_out qc.tsv -threads 16 -no_progress` (harness `{threads}` = 16); everything else at the defaults of that build |
| Run list | `heldout/manifest-silac-heldout-v2.tsv` sha256 **8a0354cdc184c0dcff9d3e50372766a0e9337b4a06526d341e9819b78178082a**: 132 runs (256.7 GB) and 62 deposited search files (28.5 GB) of 22 PXDs, made by `heldout/select_runs.py` (sha256 fe2269f5469c3e25c9a645c881d86863d4e6300176a36f36abb369ac008aea99) from the PRIDE file lists (`ws/archive/v3/projects/<PXD>/files/all`, names, sizes and categories only) |
| Harness files | `heldout/make_harness.py` (sha256 b077937cd1f1d8c4874047d013d40dd26fe47b97313609adbda31c45fce18b4d) writes `datasets/<PXD>.yaml` and `benchmarks/silac-heldout-v2-<PXD>.yaml` (one arm, the command above, version `silac-v2-e1557be6`) |
| Scorer | `heldout/score_silac_v2.py` sha256 **5b0e9d474a66f91a5f6340283170fb868c54ec677c14fb01e3cddfbf72ab5266**; checked before the freeze on development data only (`heldout/dev_check/`, via `dev_truth.py`): it reproduces the PXD067551 development table (timsTOF E1 7/18, E3 v2 7/12 vs v1 0/12, 0 false-present of 78) |
| Truth | the rule of section 3.3, implemented by `heldout/truth_silac_v2.py` written after the search files are fetched and **before any held-out FASTag run**; its sha256 and the truth table's are added to the result before the run |

Owner's decisions at the freeze (2026-11-26, relayed by the lead): `not_assessable` counts as a miss in E1; the
K/R share is reported only and is not a call condition; the 50-end gate stays; the A+L alias on the Orbitrap y
route (Arg10 share 0.071 on the label-free control) is a **known limit**, code unchanged (section 7).

Amendments made at the freeze, before any data was fetched (and why):

1. Run selection (section 3.3, last paragraph) is by file name only: per PXD and class, up to 6 runs evenly
   spread over the name-sorted eligible files (indices round(i(n-1)/5), i = 0..5). The draft's round-robin by
   design needs the truth, which is not known before fetching; the freeze must fix the list first.
2. Candidates confirmed or dropped from the PRIDE file lists (section 3.2, "Frozen list" below): DIA-only or
   DIA-NN/Spectronaut-only projects (PXD070104, PXD050961 raw in 400+ GB zips with DIA-NN outputs), projects
   without a per-run search file (PXD047397: mqpar.xml only; PXD057350: no runs; PXD066866: one 108 GB .msf),
   an ion-trap instrument (PXD059885, LTQ Orbitrap Velos), a deposit FASTag cannot read as it stands (PXD046777:
   plain `.zip`, not `.d.zip`), and the PXDs found in earlier FASTag held-out or reserved sets (PXD042192 and
   PXD051488: label-discovery held-out 5; PXD082747: reserved held-out list). Added from the same PRIDE listing
   by the same rule: PXD031924 (timsTOF DDA SILAC incl. incorporation runs) and, for light-only runs, three
   label-free DDA projects per class (newest first; ≥ 6 runs, one format, ≤ 4 GB per file; title/protocol
   without any label or DIA word): timsTOF PXD079678, PXD079349, PXD079138; Orbitrap PXD087114, PXD087065,
   PXD086085.
3. T1 may count peptides instead of PSMs where the deposit has per-run peptide tables only (PXD039806); the
   tier column says which. Labels a search was not configured for are absent when the protocol names no such
   isotope (T1-design, listed).
4. Light-only runs of the six label-free projects are tier T2 (design: label-free project, no search needed).

## 1. What is tested

Branch `feat/silac-labels` (PR #136) adds `-label_format 2`, which appends to `-label_out` (doc/DESIGN-digest.md,
"Label report format 2"):

1. the y route (`cterm_mass` near the residue: the tag reaches y1) and the b route (`nterm_mass` near residue +
   H2O) of K, K+4, K+8, R, R+6, R+10 and W, reported apart;
2. dipeptide aliases (R+10 = A+L less H2O, W = G+F less H2O at 0.008 Da); an aliased label (Arg10) is counted on
   the y route only and is `not_assessable alias_AL` below 50 y-route R ends;
3. a run with no label present and fewer than 50 y-route K or R ends is `no_call no_y1_ends`, not label-free;
4. Lys4, Arg6, Lys8 and Arg10 each called on their own: share = heavy / (heavy + light) on the label's routes,
   count, Wilson 95% interval; `present` at share ≥ 0.2 with ≥ 50 ends, else `not_detected`; `not_assessable`
   below 50 ends. No two-label rule.

Questions: on public SILAC and label-free runs from Orbitrap and timsTOF instruments that FASTag has never seen,
(a) does format 2 find the labels that are there (recall-biased prefilter), (b) without calling labels that are
not there, (c) and does it call more labelled runs correctly than the 1.16 `label_call` without more false
SILAC calls on label-free runs? Every constant (0.2, 50, 0.008 Da) is the 1.16 one; none was fitted, and the
in-sample PXD067551 numbers (REPORT.md and the development table of PR #136) are not evidence here.

## 2. Frozen software and settings

| What | Value |
|---|---|
| Source | `feat/silac-labels`, the commit named in the freeze commit (C++ unchanged after the development run; any later C++ change voids this preregistration) |
| Binary | the Linux x64 portable CLI built by CI for that commit (artifact `FASTag-linux-x64-portable`), installed as `/ceph/ibmi/abi/oliver/fastag-bench/fastag/silac-v2-<sha8>/`; sha256 of `FASTag/FASTag.bin` and of the tarball recorded in its `VERSION.txt` and copied into the freeze commit |
| Data | shipped `share/FASTag/digest` of that build (no `FASTAG_DIGEST_DIR` override) |
| Command (CFG-v2) | `FASTag -in <run> -out tags.tsv -label_out label.tsv -label_format 2 -digest_out digest.tsv -qc_out qc.tsv -threads 16 -no_progress` (all other options at their defaults: `-tag_length` 3, fragment tolerance by analyzer, `-digest_window` 0.008, `-digest_silac_min` 50) |
| Baseline (CFG-v1) | the same command's format-1 rows: the rows before `route format 2` of the same `label.tsv` (they are the 1.16 report byte for byte, label_format_cli_test and the development gate); no second run |
| Runner | bench harness benchmark `silac-heldout-v2.yaml` (one arm, the command above), on IBMI nodes; `record.json` per task |
| Scorer | `score_silac_v2.py`, written and committed with its sha256 in the freeze commit, tested before the freeze on the PXD067551 development outputs only |
| Input | Thermo `.raw` through the mirror's pinned OpenMS FileConverter mzML recipe; Bruker `.d` / `.d.zip` read directly (as on PXD067551) |

Thread count does not change any report (threads_test). A task that fails or does not finish is a run with no
call (counted as wrong where an endpoint needs a call, as a non-false-positive where it needs a false call:
it is listed either way).

## 3. Held-out set

### 3.1 Strata and quotas

Instrument class (FASTag's `-digest_out` `instrument_class` is not used to assign it; the PRIDE/raw-file
instrument model is): **Orbitrap HCD** (Q Exactive family, Exploris, Orbitrap Fusion/Lumos/Eclipse/Ascend with
Orbitrap MS2) and **timsTOF** (Pro, Pro 2, HT, Ultra, SCP; ddaPASEF). Ion-trap MS2 (LTQ Orbitrap with ITMS,
Velos CID) is out: FASTag makes no label call on Da tolerances by design. DIA runs are out (FASTag refuses raw
DIA). Lys6 or Leu labels outside the four tested labels are out of the label endpoints (listed only).

Design per run (from truth, §3.3): **light-only** (no heavy label; unlabelled controls inside SILAC projects
and label-free runs), **heavy-only** (labelled to ≥ 0.8 in every label used: incorporation checks, fully
labelled references), **single-label** (exactly one of Lys4, Arg6, Lys8, Arg10 present: Lys-only or Arg-only
designs, spike-in or pulse designs with one label), **mixed** (two or more labels present, light present:
duplex Lys8/Arg10, triplex Lys4/Arg6 + Lys8/Arg10, pulse SILAC).

Target: ≥ 8 PXDs per instrument class; **at most 6 runs per PXD** (to limit clustering; chosen as below);
per instrument class at least 15 light-only runs, 10 heavy-only, 10 single-label and 15 mixed runs. A stratum
that cannot be filled is reported as short, not padded from development data.

### 3.2 Candidate data sets (draft list; the frozen list follows at the end of 3.2)

timsTOF (ddaPASEF unless the freeze check finds DIA only):

| PXD | Instrument (PRIDE) | Design from the protocol text | Stratum it is meant to fill |
|---|---|---|---|
| PXD056725 | timsTOF Pro 2 | SILAC mice, Lys8/Arg10, DDA-PASEF, MaxQuant multiplicity 2 | mixed, heavy-only |
| PXD048421 | timsTOF Pro | light vs heavy Lys8/Arg10 RPMI SILAC | mixed, light-only |
| PXD046777 | timsTOF HT (ddaPASEF) | pulse heavy for 18 h after transduction (Pierce SILAC kit) | mixed (pulse) |
| PXD070104 | timsTOF HT | 12 d heavy Arg/Lys, 9 h light chase | heavy-only / mixed |
| PXD079824 | timsTOF HT (+ Lumos) | T. brucei light/heavy Arg+Lys, label switch, DDA PASEF | mixed |
| PXD039806 | timsTOF Pro | dynamic SILAC with 13C6 Leu and 13C6 Arg (Arg6 single label for the endpoints; Leu6 listed only) | single-label (Arg6) |
| PXD057350 | timsTOF Pro | SILAC, PEAKS quantification (cell surface, hypoxia) | mixed |
| PXD050961 | timsTOF Pro 2 | SILAC dilution series (heavy/light HCT116) and heavy synthetic spike-ins | mixed (known ratios), heavy-only |
| PXD066221 | timsTOF HT part (Exploris for SILAC) | K+8/R+10; unlabelled THP-1 runs | light-only (timsTOF part), Orbitrap mixed |
| PXD065282 | timsTOF Pro (+ Fusion) | pulse Arg10/Lys8 or Arg6/Lys4 + AHA; DDA part | single/mixed incl. Lys4/Arg6 (whichever instrument holds the DDA runs) |

Orbitrap HCD:

| PXD | Instrument (PRIDE) | Design from the protocol text | Stratum |
|---|---|---|---|
| PXD046238 | (Orbitrap, check) | light / intermediate (Arg6, Lys4) / heavy (Arg10, Lys8 or Lys10, check) pulse + AHA | mixed triplex (Lys4/Arg6) |
| PXD065290 | Q Exactive HF | triplex SILAC (reproductive interactome) | mixed triplex |
| PXD054505 | Q Exactive | triplex | mixed triplex |
| PXD051488 | Q Exactive HF-X | SILAC AP-MS SRP14 (heavy-only incorporation check mentioned) | mixed, heavy-only |
| PXD042191 / PXD042192 | Q Exactive HF | SILAC AP-MS SRP72 / SRP9 (incorporation check mentioned) | mixed, heavy-only |
| PXD064721 | Orbitrap Exploris 480 | pulsed SILAC after 55LCC depletion | mixed (pulse) |
| PXD061384 / PXD061306 | Orbitrap Fusion Lumos | dynamic SILAC NIH/3T3, CGR8 mESC with CHX | mixed (pulse), heavy-only late points |
| PXD047063 | Q Exactive HF | turnover of IAV-infected HeLa (pSILAC) | mixed |
| PXD047397 | Q Exactive HF | SILAC HEK293 RPS26 silencing | mixed |
| PXD059885 | LTQ Orbitrap Velos (check MS2 analyzer) | Lys-only SILAC of plasma EVs (Lys-C) | single-label (Lys8) if HCD/FTMS MS2, else out |
| PXD082747 | Orbitrap Exploris 480 | SILAC-labelled ubiquitin analysis (incorporation check mentioned) | mixed, heavy-only |
| PXD066866 / PXD066863 | Orbitrap Exploris 480 | SILAC (ACSF3 diurnal) | mixed |

Light-only controls on the same instruments come first from the unlabelled runs inside these projects; to
reach the quota, label-free DDA projects on the same instrument families are drawn from the PRIDE listing
(not from any FASTag DEV/held-out set; the most recent first, title and instrument only).


**Frozen list** (`heldout/manifest-silac-heldout-v2.tsv`; runs chosen / eligible, GB of the chosen runs):

| Class | Group | PXD | Runs | GB | Deposited search files fetched for truth |
|---|---|---|---|---|---|
| orbitrap | silac | PXD042191 | 6 of 7 | 10.7 | search.tar |
| orbitrap | silac | PXD046238 | 6 of 16 | 19.6 | 3D_CF_lysate.zip, 3D_CF_secretome.zip, 5D_CD_lysate.zip, 5D_CF_secretome.zip |
| orbitrap | silac | PXD047063 | 6 of 165 | 11.7 | txt.zip, experimentalDesign_details.txt |
| orbitrap | silac | PXD054505 | 6 of 384 | 2.7 | MQSearch_*_Triplex_*.zip (4) |
| orbitrap | silac | PXD061306 | 6 of 14 | 15.2 | evidence.txt, mqpar.xml, parameters.txt, summary.txt |
| orbitrap | silac | PXD061384 | 6 of 16 | 16.2 | evidence.txt, mqpar.xml, parameters.txt, summary.txt |
| orbitrap | silac | PXD064721 | 6 of 48 | 12.5 | *-pSILAC.7z (4) |
| orbitrap | silac | PXD065282 | 6 of 216 | 13.4 | MaxQuant_Output_DDA_inVitro_Cells.zip |
| orbitrap | silac | PXD065290 | 6 of 14 | 6.4 | quant_/Sperm-*-evidence.txt and parameters.txt (6) |
| orbitrap | silac | PXD066221 | 6 of 8 (SILAC_ files) | 18.3 | SILAC_TP.zip, SILAC_ssABE.zip |
| orbitrap | silac | PXD066863 | 6 of 32 | 3.4 | txt.zip |
| timstof | silac | PXD031924 | 6 of 96 | 18.0 | peptides*.mzid.gz (3) |
| timstof | silac | PXD039806 | 6 of 9 | 15.6 | per-sample peptide.tsv, peptide_label_quant.tsv, FragPipe params (20) |
| timstof | silac | PXD048421 | 6 of 8 | 8.0 | MCampana_SILAC_peptides.pep.xml, file key .xlsx |
| timstof | silac | PXD056725 | 6 of 14 | 18.8 | txt_exp1306.zip, txt_exp1337.zip |
| timstof | silac | PXD079824 | 6 of 22 (DDA .d.zip) | 8.8 | FragPipe_Proteome.zip, MaxQuant_PM.zip |
| timstof | label-free | PXD079678 | 6 of 20 | 17.1 | - (T2) |
| timstof | label-free | PXD079349 | 6 of 16 | 20.6 | - (T2) |
| timstof | label-free | PXD079138 | 6 of 6 | 5.4 | - (T2) |
| orbitrap | label-free | PXD087114 | 6 of 33 | 4.1 | - (T2) |
| orbitrap | label-free | PXD087065 | 6 of 73 | 6.5 | - (T2) |
| orbitrap | label-free | PXD086085 | 6 of 12 | 3.5 | - (T2) |

Orbitrap: 11 SILAC PXDs (66 runs) + 3 label-free (18); timsTOF: 5 SILAC PXDs (30 runs, **short of the 8-PXD
target**: no further timsTOF DDA SILAC deposit with per-run searches was found in 1,200 PRIDE SILAC projects) + 3
label-free (18). Strata counts follow from the truth and are reported, not padded.

Exclusions: PXD067551, PXD045734; every PXD in the 1.12/1.13 label held-out draws (item03/item08 manifests,
registry HO-03, HO-08), in the DEV truth tables of the digest/label validation and in the bench harness
`datasets/`; projects whose MS2 are read in the ion trap; DIA-only projects; projects without a per-run truth
of tier T1 or T2 (§3.3). A candidate may be replaced only by the rule "next in the PRIDE listing with the same
instrument class and design", applied before the freeze.

### 3.3 Truth per run (established before any FASTag run, by a script committed with the freeze)

Per run r and label L (Lys4 = K+4.025107, Arg6 = R+6.020129, Lys8 = K+8.014199, Arg10 = R+10.008269):

- **Tier T1 (search-based):** from the deposited per-run search result (MaxQuant `evidence.txt`/`msms.txt` by
  `Raw file` with `Labeling state` or label modifications; FragPipe `psm.tsv`/IonQuant tables with assigned
  label masses; PEAKS or Proteome Discoverer PSM exports with label modifications). PSMs at the deposited FDR.
  h_L = PSMs carrying L; e_L = PSMs whose peptide C-terminus is the residue of L (K for Lys labels, R for Arg
  labels; the C-terminal residue whatever its label). share_L = h_L / e_L. **Present** when h_L ≥ 20 and
  share_L ≥ 0.05; **absent** when the search included L as a label and (h_L ≤ 2 or share_L ≤ 0.005), or the
  search could not see L but the protocol rules it out (no such isotope used in the project); otherwise
  **ambiguous** (excluded from the per-label endpoints, listed). For PXD067551 the K8/R10 entries of the
  FragPipe protein tables played this role; the scorer is checked on that development set only.
- **Tier T2 (design-based):** where no per-run search result exists: the SDRF `comment[label]` / `characteristics`
  of the run, or the protocol plus an unambiguous file-name map (e.g. `_H_`, `_heavy_`, `incorporation`), for
  light-only and heavy-only runs only. Mixed and single-label runs need T1 (their heavy share is not known from
  the design).
- The design stratum of a run follows from its per-label truth (§3.1). The truth table (run, tier, h_L, e_L,
  share_L, truth_L, design, instrument class, PXD) is committed before FASTag runs; its sha256 goes into the
  freeze record.

Run selection inside a PXD (≤ 6 runs; amended at the freeze, section 0): the eligible files sorted by name, the
files at indices round(i(n-1)/5), i = 0..5 (all when n ≤ 6). Eligible: RAW-category files of the class's format
(.raw; .d.zip), no DIA token in the name, PXD066221 only its `SILAC_` files, PXD079824 only its `_DDA_` .d.zip.

## 4. Endpoints

Units: **label-run pairs** (r, L) with truth present or absent, and **runs**. A pair is *assessable* when its
`silac2 <L>.call` is `present` or `not_detected`. A failed task counts as `not_assessable`.

Primary (all evaluated in each instrument class separately and pooled):

- **E1 recall (prefilter):** among truth-present pairs, the share called `present` (not-assessable counted as a
  miss). PASS: ≥ 0.80 pooled and ≥ 0.70 in each instrument class, with Wilson 95% lower bound ≥ 0.70 pooled.
  Arg10 on timsTOF is expected to be `not_assessable alias_AL`; it counts as a miss here on purpose (the
  endpoint measures what a user gets).
- **E2 false labels:** among truth-absent pairs, the share called `present`. PASS: ≤ 0.05 pooled and ≤ 0.08 in
  each class, Wilson 95% upper bound ≤ 0.10 pooled. Light-only runs contribute four pairs each.
- **E3 against the 1.16 call (runs):** run-level SILAC detection on labelled runs (any truth-present label):
  correct for v2 when `silac2 silac` names at least one truth-present label and no truth-absent label; correct
  for v1 when `label_call silac` is `weak` or `strong`. PASS: v2 correct ≥ v1 correct + 0.20 on the labelled
  runs (paired), and on light-only runs the v2 false-SILAC rate (`silac2 silac` names a label) ≤ v1's
  (`label_call` names SILAC) + 0.02.

Secondary (decide nothing alone): per-label recall and false-present rate per instrument class; share of
`not_assessable` by reason (`no_y1_ends`, `alias_AL`, `few_ends`); run-level outcome on light-only runs
(`call none`, `no_call no_y1_ends`, false label) by class; calibration of the format-2 share against share_L of
T1 runs (Spearman, and the share of runs whose truth share lies in the Wilson interval; ends-based and
PSM-based shares are not expected to agree in level); per-PXD results (cluster check: E1/E2 recomputed leaving
one PXD out, min and max reported); the y-route counts of every run (how many timsTOF runs lack y1 ends).

Descriptive statistics: Wilson 95% intervals, confusion tables per label and class, the exact two-sided sign
test for E3's paired runs.

## 5. Decision rule (fixed now)

- E1, E2 and E3 all PASS (pooled and in both instrument classes): the format-2 SILAC rules may replace the SILAC
  part of `label_call` (a default change), **proposed to the owner**, with the isobaric part unchanged. Any
  instrument class that fails E1 or E2 keeps format 1's call for that class or stays opt-in; no new threshold is
  chosen from the held-out results.
- E2 fails anywhere: format 2 stays experimental and opt-in; the false-present cases are listed.
- E1 or E3 fails with E2 passing: format 2 stays opt-in (documented as a reporting aid); no default changes.
- Fewer than 15 truth-present pairs or 15 light-only runs in a class: that class is **inconclusive** (no
  change for it, whatever the pooled result).
- A label that is never truth-present in ≥ 10 pairs of a class (likely Lys4/Arg6 on timsTOF) gets no claim in
  that class; documentation says so.

## 6. What happens at the freeze (in order, all before any held-out FASTag run)

1. Confirm each candidate from its PRIDE file list (names, sizes, instrument; DDA vs DIA) and deposited search
   files (presence only); replace by the rule in §3.2; write `manifests/silac-heldout-v2.tsv` (PXD, file,
   size, PRIDE MD5, instrument class).
2. `pxd get` the selected runs and search files; convert `.raw` with the pinned recipe.
3. Run the truth script on the deposited search files only; commit the truth table and its sha256.
4. Install the frozen binary (§2), record sha256s; commit runner benchmark, scorer and their sha256s
   ("freeze commit"). From here no criterion, threshold, run or label changes.
5. Run once; score once; write RESULT-silac-v2.md with every endpoint, PASS/FAIL, and the per-run table.

## 7. Known limits and development evidence (in-sample; does not enter the decision)

**Known limit (owner's decision at the freeze):** the A+L dipeptide alias of Arg10 also reaches the y route on
Orbitrap data (b2 of AL read as y1). On the label-free control the y-route Arg10 share is 0.071 (Wilson
0.066-0.077), below the 0.2 threshold but not zero; code and threshold stay as they are; Arg10 false-present
calls, if any, are listed by run in the result.


Branch build 858b4b3a (CI artifact, `fastag/silac-v2-858b4b3a`), harness benchmarks `silac-067551-v2` and
`silac-045734-control-v2` on ibminode05, 2026-11-26; table `data-v2/calls_v2.tsv` / `data-v2/table_v2.md`.

- PXD067551, 24 timsTOF runs: the y gate is closed on every run (0-1 y-route K/R ends). 1.16: 0/12 labelled runs
  called. Format 2: **Lys8 present on 7 runs** (all 6 Lys8+Arg10 mixes, shares 0.200-0.360 on 65-125 b-route
  ends, and T0_MYO_2, 0.623 on 61), run call `Lys8`; Arg10 `not_assessable alias_AL` on all 24 (95-99 % of
  the R+10 b-route ends are A+L); Arg10-only runs (EMSC, 3) and T0_MYO_1/3 (39 and 45 ends, below 50)
  `no_call no_y1_ends`; **12/12 unlabelled runs `no_call no_y1_ends`, no false label** (Lys8 shares ≤ 0.004).
- PXD045734 ah_4068 UIF_IC (Orbitrap, label-free): y gate open (y-route K/R share 0.953), all four labels
  `not_detected`, run call `none`. Its y-route Arg10 share is **0.071** (587 of 8226 ends, Wilson 0.066-0.077),
  every one of them A+L-explained: the alias is also on the y route of an Orbitrap run, below 0.2 here. This is
  why E2 is evaluated per instrument class and why Arg10 false-present cases are listed.
- Gate: on all 24 PXD067551 runs the format-1 rows, `tags.tsv`, `digest.tsv` and `qc.tsv` of the branch build
  equal the 1.16.2 release's byte for byte; on the control the format-1 rows equal the 1.16.2 report (version
  row aside).
