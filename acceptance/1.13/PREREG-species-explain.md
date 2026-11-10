# PREREG-species-explain: the explain-away species call on held-out runs (1.13 backlog, arm species)

Status 2026-11-10: **FROZEN** in the commit that adds this file (branch `acc113r/species`, pushed before the
candidate binary reads any held-out file). The set is run once and scored once. Nothing is tuned on it, nothing is
re-scored. A FAIL is a valid result.
Background: output/backlog-1.13/species/DESIGN.md, REASSESS.md, RESULT.md (DEV), PREREG-draft.md (draft of this file).

## Question

Does `-species_call explain` (greedy explain-away of shared tags, negative-binomial null from 5 decoy replicates)
keep false `present` genus calls per run low on runs it was not developed on, without losing true genera against the
1.12 call (`-species_call decoy`)?

## Frozen software and inputs

| What | Value |
|---|---|
| Candidate | branch `feat/b113-species`, commit `cb02f878010389f24ce408ba3d5baca8ba25e8ee` |
| FASTag | `data:/scratch/kohlbach/b113/species/opt/FASTag.bin` sha256 `7628dd614c42e95c462a631191cd686e8cae116899f13272f2f6317f2be689a7` (wrapper `opt/FASTag` `b84c190a1348e2f4c8435671fc27c94e0af89691d8ca7bebeef7efcca5fdb43b`; prints 1.12.2). Verified 2026-11-10: identical to `build/FASTag`; all 951 files of the source tree it was built from (`data:/scratch/kohlbach/b113/species/src`) are byte-identical to `git archive cb02f87`; no compile input is newer than the binary. Not rebuilt. |
| CFG-explain (candidate) | `-extension 2 -species -species_call explain`, parameters from the shipped `species_call.tsv` (alpha 0.01, n_min 10, 5 decoy replicates) |
| CFG-decoy (reference, the 1.12 call) | `-extension 2 -species -species_call decoy` |
| Per-run option, both arms | `-fixed_modifications` of the run's label class (manifest column `fastag_fixed_mods`, from the SDRF label only); `-threads 16` |
| Taxonomy | `FASTAG_TAXONOMY_DIR=/scratch/kohlbach/fastag112-dev/tax`: `tax_k7.taxdb` `34427bba2c3ba3240805d4e5266443fcdc4708e0131eb96ea4dfbb4dda771a4f`, `nodes.dmp` `d20f4f5b38e195c1ad77beef1f82296b96bab18588808c9c7527730928cdcecf`, `names.dmp` `397b70d74a91a8e0b46eb68e46f8669296d90396d01a472a71f0c8585df7cb2b`, `species_call.tsv` `8aa40c29d3440d2bde29941dab85426c644c6aeac68487f1403fd653ce2723bf` (= `data/taxonomy/species_call.tsv` of cb02f87) |
| Index genera | `bench/fastag-bench/config/species_universe.txt` (50 genera) sha256 `2be27cda96d69fcbcfc20f874228c1ea3685028d4dd73ac921d2084475e0b3f9` |
| Truth search | Sage 0.14.7 `/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage` sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625`; `ref50.fasta` `/ceph/ibmi/abi/oliver/jpr-bench/species/ref50.fasta` sha256 `2bc7295c31bcb4643a59cd0dc8fdb0a28f74d8b47989902788eaa10d2d328626` |
| Scripts | `species/scripts/stage.sh`, `species/scripts/run_species.py`, `species/scorers/score_species_explain.py`, `species/scorers/test_score_species_explain.py`; sha256 in `species/scorers/SHA256SUMS` |
| Python | `/ceph/ibmi/abi/oliver/envs/prepdda/bin/python` (3.11.15); the scorer uses the standard library only |
| Node | `data`, work dir `/scratch/kohlbach/b113/species/heldout/` |

## Held-out set

`manifests/species-explain.tsv`: **62 runs from 62 PRIDE projects** (60 FTMS, 2 Astral MS2; SDRF genus among the
index genera in 49 runs, outside in 13). Source: `output/backlog-1.13/species/heldout-manifest-draft.tsv` (sha256
`8bb8e21d966567ff21680b7612f6c432821cc73ebe5da693752424e68ec965c6`; 66 runs drawn by `tools/species-b113/select_heldout.py`
of the feature branch, seed `fastag-1.13:species-explain:<PXD>`), minus the 4 runs dropped below. The mzMLs were
copied from `/ceph/ibmi/abi/oliver/prose-auto-20261029/` (read only) to `data:/scratch/kohlbach/b113/species/heldout/mzml/<PXD>/`
(`stage.sh`); `mzml_sha256` in the manifest is the hash of the staged copy.

Disjointness, `disjointness/species-explain.tsv`, checked 2026-11-10 without running FASTag on any of the files:
- the draft's four lists (species_dev_all, bench species_runs, species training_runs, 1.12 item01-heldout): no PXD and
  no file of the 62 in any;
- every file of `origin/acceptance/1.12` and `origin/acceptance/1.13` with species, item01, alldecoy, named_spec,
  raw_named, staged_1 or taxon in its path; the PXDs named in DESIGN.md, REASSESS.md, RESULT.md; the DEV tooling
  `tools/species-b113`; the PXDs reserved by the shifts and census arms: no PXD of the 62 in any;
- **dropped, 4 runs** (PXD004541 `HF1_201501212_GM_RJ1511D_TMT10_hpHRP_DMSO1_2p5ug_4uL_fr02`, PXD014764
  `20190412_KEH_HF_SA_ANW_R11_100419_CNOT_R1_f008`, PXD040407 `Hog1p_WT_Rep3_Chymo_5uL`, PXD060724
  `Chymotrypsin_EThCD_WZ20spd_161224_1`): these exact files are regression-gate inputs (`fastag-gate/inputs.tsv`,
  `tools/gate_new_cases.sh`), the candidate binary was run on them in the gate (cases tmt_fixed, nontryptic_ext,
  fasta_recon, chem_reports, census_recon, etd_auto; none with `-species`), and for the first three a species report
  made with `-species -extension 2` by FASTag 1.11.0 / 1.12 is in the repository as a GUI fixture
  (`gui/src/fixtures/cli/`). None was used to fit or tune the species call; they are dropped because their species
  output was visible during development. No replacement is drawn.
- declared reuse: 58 of the 62 projects (all 62 are in `alknodb/prereg-exclude-pxd.txt`) are DEV data of the 1.12
  chemistry reports (`acceptance/1.12/dev/chem/training_runs.tsv`: label, alkylation, enzyme) and of other
  non-species items. No species report of these runs was found in the acceptance branches, the feature branch or under
  `data:/scratch/kohlbach` (PXD and file stem searched in the paths of all 9,145 `*species*.tsv` there, 2026-11-10).

## Truth (fixed before the candidate runs)

As in the 1.12 #1 protocol (`acceptance/1.12/PREREG-species-call.md`, "Genus status per run"); the status function
of the scorer is identical to `acceptance/1.12/scorers/score_item01.py statuses()`. Evidence: the SDRF organisms of
the run (manifest `organisms`, first word = genus) and the genus-unique peptides of the truth search: Sage 0.14.7
against `ref50.fasta`, target peptides at spectrum_q and peptide_q <= 0.01, stripped length >= 5, all proteins of the
peptide in one genus (ref50 header OX= -> genus by the `nodes.dmp`/`names.dmp` above). Per run, each of the 50 index
genera is

- **positive (true):** an SDRF genus with >= 3 genus-unique peptides; Sus and Bos with >= 3 (supported contaminant);
- **excluded** (never a false call, never expected): an SDRF genus with < 3 genus-unique peptides (truth
  unconfirmed); Oryctolagus, Ovis, Equus; Homo in a run without a human SDRF organism;
- **negative:** every other index genus, whatever Sage reports for it; Sus and Bos with < 3.

Genera outside the index are not counted.

Reading of the draft, fixed here before the candidate ran: the draft's sentence "a genus is true when it is the SDRF
organism's genus, or when Sage finds at least 3 genus-unique peptides" is its summary of the 1.12 #1 rule; the rule
itself, above, is decisive. It differs from the sentence read literally in two points: an SDRF genus that Sage does
not confirm is excluded instead of true, and a genus other than the SDRF genera, Sus and Bos stays negative even with
>= 3 genus-unique peptides. The truth searches show why the second point matters: in deep runs Sage reports >= 3
genus-unique peptides for many genera that are not in the sample (PXD001587, a human lysate: 29 further genera,
e.g. Danio 74, Xenopus 59); read literally, 700 index genera would be true in the 62 runs and almost no call could
be false. The literal counting and an SDRF-only counting are reported, not decisive (below).

Truth search per run (`run_species.py truth`, = `fastag_bench.species.sage_species_config` for FTMS MS2): trypsin (KR,
not before P), 2 missed cleavages, length 7-50, peptide mass 500-5000, precursor +-10 ppm, fragment +-20 ppm, isotope
errors 0/1, deisotoping on, b/y ions, min ion index 2, fragment m/z 150-2000, 15-150 peaks, 1 PSM per spectrum,
decoys `rev_` generated by Sage, max 2 variable mods, RT prediction on. Trypsin is used for every run (manifest
`enzyme_truth`: 57 trypsin, 2 Lys-C, 1 Asp-N, 1 unspecific, 1 unknown); in a non-tryptic run the truth then rests on
the SDRF genus alone. Mods by label class (manifest columns; SDRF label and alkylation from
`acceptance/1.12/inputs/sdrf_truth_runs.tsv`, sha256 `ef3e388d3ae4df1750c43bd98b922ebb08aa9dc0ad136e69e7aa0730ee0caf94`,
classes as in `acceptance/1.12/scorers/truth/item01.tsv`):

| class | runs | SDRF label | FASTag `-fixed_modifications` | Sage static | Sage variable |
|---|---|---|---|---|---|
| LF | 42 | label-free; 'isotope (unspecified)' (2) and dimethyl (1) are treated as LF | none | C +57.021464 | M +15.994915 |
| LF_noalk | 4 | label-free, alkylation 'none' | none | none | C +57.021464, M +15.994915 |
| SILAC | 6 | SILAC | none | C +57.021464 | K +6.020129, M +15.994915 |
| TMT6 | 5 | TMT | Carbamidomethyl (C), TMT6plex (K), TMT6plex (N-term) | C +57.021464, K and N-term +229.162932 | M +15.994915 |
| TMTpro | 4 | TMTpro | Carbamidomethyl (C), TMTpro (K), TMTpro (N-term) | C +57.021464, K and N-term +304.207146 | M +15.994915 |
| iTRAQ8 | 1 | iTRAQ8 | Carbamidomethyl (C), iTRAQ8plex (K), iTRAQ8plex (N-term) | C +57.021464, K and N-term +304.20536 | M +15.994915 |

Truth files, made before the freeze from the truth searches alone (no FASTag output):
- `species/truth/truth_genera.tsv` sha256 `d2f6cedc48c577fd119eab870effa85c8f9fc6e4670ddcfffabd6a9b6a3e7fa0` (pxd, run, genus, in_index, sdrf,
  sage_genus_unique, status; one row per genus that is an SDRF genus or has >= 1 genus-unique peptide);
- `species/truth/sage_results.sha256` sha256 `ff3e3c86a2c04e0f38203d032d52609b14b313825b7fcc0589593beffb5913e2`: the sha256 of each run's `results.sage.tsv`
  (`data:/scratch/kohlbach/b113/species/heldout/truth/<PXD>/<run>/`);
- `species/truth/truth.log` sha256 `2a90e13217de55354bb7857c4b0244c344c95cb9d76ee7eccb1fef440c8e2b0a`: exit code and wall time of each truth search.

State of the truth at the freeze: 62 of 62 truth searches finished with exit 0; no run is without truth. Positive
index genera: **105** = 37 SDRF genera (37 of the 49 runs whose SDRF genus is in the index) + 68 supported Sus or Bos
(Sus in 40 runs, Bos in 28 runs; none of them an SDRF genus). Excluded: 12 SDRF genera in the index that Sage
does not confirm (Mus 3, Homo 3, Escherichia 2, Xenopus, Saccharomyces, Oryza, Bos: 1 each) and the 13 SDRF genera
outside the index. The recovery of the guard is therefore taken over 105 genera of which 68 are Sus or Bos; the
recovery of the SDRF genera alone is reported beside it.

## Commands (exact)

```
P=/ceph/ibmi/abi/oliver/envs/prepdda/bin/python; H=/scratch/kohlbach/b113/species/heldout
# before the freeze (done): staging and truth
scripts/stage.sh scripts/stage.tsv $H
$P scripts/run_species.py truth scripts/species-explain.tsv $H 6 10
$P scripts/score_species_explain.py truth scripts/species-explain.tsv $H /ceph/ibmi/abi/oliver/jpr-bench/species/ref50.fasta \
   /scratch/kohlbach/fastag112-dev/tax scripts/species_universe.txt $H/truth_genera.tsv
# after the freeze, once
$P scripts/run_species.py fastag scripts/species-explain.tsv $H 4 16
$P scripts/score_species_explain.py score scripts/species-explain.tsv $H/truth_genera.tsv $H $H/score
```
`run_species.py fastag` runs, per manifest row, CFG-explain then CFG-decoy:
`FASTag -in <mzML> -out <dir>/tags.tsv -extension 2 -species -species_out <dir>/species.tsv -threads 16
[-fixed_modifications <class mods>] -species_call explain|decoy` with `FASTAG_TAXONOMY_DIR` as above and
`TMPDIR=OPENMS_TMPDIR=/dev/shm/kohlbach-tmp`; `tags.tsv` is deleted after the run. The driver was checked before the
freeze on the DEV gate file PXD003531 only (both arms exit 0).

## Scoring and decision rule

Calls: the genus rows of `species.tsv` with `call` = `present`. A called genus of status negative is a **false
call**. A called genus of status excluded or outside the index is neither false nor recovered.

- **Primary: false `present` genus calls per run of CFG-explain**, mean over the scored runs, 95 % interval by
  bootstrap over runs (10,000 resamples, `random.Random(113)`, percentiles 2.5 and 97.5).
  **PASS when the upper end of the interval is <= 0.75**, else FAIL. (DEV: 0.39 [0.17, 0.64]; the 1.12 call 7.44
  [6.14, 9.00].)
- **Guard, required for a pass:** recovery = positive index genera called `present` / positive index genera, pooled over
  the scored runs. **PASS when recovery(CFG-explain) >= recovery(CFG-decoy) - 0.05**, else FAIL. (DEV: 0.93 against
  0.95; on DEV, Sus and Bos were excluded, not positive.)
- **Overall: PASS when primary and guard pass, else FAIL.**
- **Technical failures:** a run is scored only when its truth search finished (exit 0, `results.sage.tsv`) and both
  arms finished (exit 0, `species.tsv` with genus rows). Otherwise the run is excluded from both arms and listed.
  No rerun with other settings, no backup run.
- **INCONCLUSIVE** (primary, guard and overall) when fewer than **50** runs are scored, or when the scored runs hold
  fewer than **30** positive index genera.

Reported, not decisive: false calls per run, runs with any false call and recovery of CFG-decoy; runs with any false
call of CFG-explain; recovery of the SDRF genera alone (called SDRF index genera / SDRF index genera, confirmed or
not); runs where an SDRF index genus is not called while a genus that is not an SDRF genus is; runs without any
`present` call; and two other countings of the same calls: `sdrfonly` (every called genus that is not an SDRF genus
is false) and `literal` (true = SDRF genus or >= 3 genus-unique peptides; false = called and not true; recovery over
the true index genera).

The scorer was tested on synthetic input before the freeze (`test_score_species_explain.py`: PASS, primary FAIL,
guard FAIL and its margin, exclusions, INCONCLUSIVE, the status rule, truth derivation, report parsing, reproducible
bootstrap).

## Consequence

PASS: the mode may be proposed as the 1.13 species call, still opt-in until the user decides. FAIL or INCONCLUSIVE:
it stays experimental and the documentation says so. Results: `species/results/`, summary in
`output/backlog-1.13/species/RESULT-heldout.md`.
