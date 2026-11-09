# PREREG-item17: #17 -search_shifts held-out test (CFG-17-cand-113 against CFG-17-base-113)

Status 2026-11-09: **protocol fixed; CFG-17-base-113 and CFG-17-cand-113 `frozen` in the commit that adds this
file. Not run on held-out data, not scored.** Each config is scored exactly once on the four runs of manifest
`item17-heldout`, on node data; nothing is tuned on held-out data; no criterion below is relaxed afterwards.
Source: BACKLOG.md item 6; PLAN-handoff.md #17 (held-out validation, acceptance); acceptance/1.12
`dev/engines/FREEZE-05-17.md` (DEV freeze), registry HO-17-heldout, HO-17-heldout-r2 (`pending_prereg`).

## Question and endpoint

Does a search with the shifts `-search_shifts` exports (variable modifications, Comet mass offsets, precursor isotope
range) identify more PSMs at 1 % FDR than the same closed search without them, with FDR still controlled?
Primary endpoint: target PSMs at 1 % PSM FDR, cand vs base, per run and engine. Secondary (reported, no criterion):
distinct peptides, share of base-identified scans not identified by cand.

## Frozen software

| What | Value |
|---|---|
| FASTag | RC a117801 (src/ identical to v1.12.1), `FASTag.bin` `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`, bundle SHA256SUMS `93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051`, `data:/scratch/kohlbach/fastag-heldout-1.12/rc-a117801`; massgap_mods.tsv `c1ec6f57...` (the DEV-freeze binary) |
| Sage | 0.14.7, binary `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625` |
| Comet | 2026.03.0, binary `ad93b4cf60c2ed7afc2f41b8a3a05567c3938d999f17deb7b3676bc1fa91e7ed`; template = its own `comet -p` (`comet.params.new` `0b6abd4c7415a9289d858d3c8fc84031c31d62acf10f174a8123070ebd8fb8fc`) |
| MSFragger (reference) | 4.4.1 jar `/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar` `56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112` (pinned for #15B); Java OpenJDK 21.0.12.1 `/usr/bin/java` on data |
| Scripts | `item17/scripts/`: `run_item17.sh` `d097ee3fbded8e3b568c2a532cc88031da9b4b26e6499ce85777d9b2b83d9b07`, `entrap.py` `035c728f8fceb386db2995e92d7cce282f3cd712dd8d52e7db9da9992a9ebeb9` (= acceptance/1.12 DEV), `revdecoy.py` `fed0b54b26908173f537d3bc90df3cfc13779f196126159865a1ff9a784e1d24`, `mkfragger.py` `d7b6800f91cfd705a257aaff69e73d125746b17753531fcbcec605f0b2dd4e3b` |
| Scorer | `item17/scripts/score_item17.py` `8ecd686cfb06f9e487eb39b3bc3ccd64a107fdd736079b2f120acbe76347fe27` (`--selftest` passes) |
| Chemistry table | `item17/chem17.tsv` `5f3018ffd35e3ca4cd063e9510b0f10431e05148621284cf0d74ea65aeeb4689` |

`run_item17.sh` checks the FASTag, MSFragger and template sha256, the database sha256 and (held-out) the mzML
sha256 against the manifest before it runs anything.

## Configs

| Config | Options | param_hash |
|---|---|---|
| CFG-17-base-113 | `-tag_length 4 -extension 6 -fixed_modifications <chem17 fixed> -variable_modifications <chem17 variable> -search_config_out` (`-search_engine comet -search_config_template comet.params.new` for Comet); no `-search_shifts` | `aa03e76c2a17b12daf74159273062c0eadceeda33f8d8f521451fd482aa29e7d` |
| CFG-17-cand-113 | CFG-17-base-113 + `-search_shifts variable` (Sage) / `both` (Comet), defaults `-shift_max_variable 3 -shift_max_offsets 10`, no site expansion | `d8c7cff5fd7e59977429ea6860c784b483afe21ffbe3e4fda556d98ee4466f1b` |

Engine settings are the configuration FASTag writes (precursor 10 ppm, fragment 20 ppm, 1 missed cleavage, isotope
errors 0 unless the cand export raises them); the run script changes only the database path (target + entrapment),
the spectra path, threads and Comet's text output.

**Change from the 1.12 configs (decided before any held-out run, from metadata only).** CFG-17-base/cand (1.12)
named only `Carbamidomethyl (C)` fixed. Three of the four held-out runs have other declared chemistry (TMT, MMTS,
acrylamide, SILAC), and the plan's label rules act only with a declared fixed label ("PXD004541 ... exercises the
label rules"). The 1.13 configs therefore take the chemistry the PRIDE project protocol declares (`chem17.tsv`, read
2026-11-09 from the PRIDE v3 project records; no data file was read). On the DEV run the rule gives exactly the
frozen DEV configuration: the DEV dry run below wrote `cfg_sage.json` and the cand `cfg_comet.params` byte-identical
to the 1.12 DEV freeze, so the DEV freeze (RC defaults 3 / 10) carries over unchanged. Declaring the known chemistry
makes the test stricter: a forgotten label can no longer produce the gain.

## Runs and databases

`manifests/item17-heldout.tsv` (copy of acceptance/1.12, sha256 `ae031e483c9974f2a792754d5e1f8f49b15c04b22425f298fa9de8ca047bc2c2`,
unchanged): files drawn, staged and hashed on 2026-11-08 under `data:/scratch/kohlbach/fastag-heldout-1.12/item17/heldout/`;
disjoint from DEV (`disjointness/item17-heldout.tsv`: no PXD and no file in the #17 DEV set). No FASTag or engine
run has read them (registry HO-17-heldout-r2: not run).

| PXD | Run | Declared chemistry (fixed; variable) | Database |
|---|---|---|---|
| PXD014764 | 20190412_KEH_HF_SA_ANW_R11_100419_CNOT_F1_f007 | Carbamidomethyl (C); Oxidation (M), Label:13C(6)15N(2) (K), Label:13C(6) (R), Label:2H(4) (K), Label:13C(6)15N(4) (R) | Homo_sapiens.fasta `dffdff38...` (20416, the DEV database) |
| PXD004541 | HF1_201501216_GM_RJ1511D_TMT10_hpHRP_Drug2_2p5ug_4uL_fr09 | Carbamidomethyl (C), TMT6plex (K), TMT6plex (N-term); Oxidation (M) | Homo_sapiens.fasta |
| PXD000001 | TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01 | Methylthio (C), TMT6plex (K), TMT6plex (N-term); Oxidation (M) | `PXD000001_erwinia_spikes.fasta` `dd216a60a50bd95496c4ce5bdf1994dc4987a8c4319c7589b3a9085307c160fb`: UniProt UP000007966 (Pectobacterium atrosepticum SCRI1043 reference proteome, 4459 entries, `3d8614d4...`, REST stream 2026-11-09) + P02769, P00924, P62894, P00489 (`3f13fea7...`); at `data:/scratch/kohlbach/b113/shifts/db/` |
| PXD063151 | Control_2 | Propionamide (C); Oxidation (M) | Homo_sapiens.fasta |

Known caveat, fixed now: PXD000001 has a single eligible file and it was used elsewhere in FASTag development
(manifest selection note "ONLY development-used files exist"; never in #17 development or the DEV freeze). It counts in
the primary verdict as the plan names it; the scorer output is also reported without it (three-run view, no
criterion).

## Searches per run (`run_item17.sh heldout <PXD> <workdir> 16`)

FASTag places against the target database; every Sage and Comet search runs on target + a shuffled entrapment copy
(`entrap.py`, r = 1, `ENTRAP_` accessions); Sage adds `rev_` decoys, Comet `DECOY_` decoys. Arms: base and cand, both
engines (4 searches). Reference: one MSFragger open search (`mkfragger.py`: -150..+500 Da, base chemistry copied from
the base Comet configuration, settings in the script header) on target + reversed `rev_` decoys (`revdecoy.py`).

## Scoring (`score_item17.py <out> searches.tsv x 4`, run once)

PSMs, FDR, FDP exactly as the DEV scorer (`acceptance/1.12/dev/engines/scripts/score.py`): rank-1 PSMs at 1 % PSM
FDR (Sage `spectrum_q`; Comet target-decoy q over e-values), target = not all proteins `ENTRAP_`, FDP = 2E/(T+E).
Open-search peaks and "recovered" as in the scorer header (0.002 Da bins, smoothing +-5 bins, apex over +-10 bins,
members +-0.02 Da, unshifted |centroid| < 0.05 dropped, 0.04 Da suppression, top 10 with >= 5 PSMs; a peak is
recovered when a NEW mass of the cand configuration — variable mod, static change, Comet offset, isotope error k x
1.0033548 — lies within 0.02 Da; single masses only).

Criteria per engine (PLAN-handoff #17 acceptance, unchanged):

| | Criterion |
|---|---|
| P1 | target PSMs(cand) >= 1.02 x PSMs(base) on >= 3 of 4 runs |
| P2 | entrapment FDP(cand) <= 1.5 % on every run |
| P3 | no run loses > 1 % of the base PSMs: PSMs(cand) >= 0.99 x PSMs(base) on every run (count, as in the DEV freeze rule) |
| P4 | >= ceil(0.6 n) of the n (<= 10) open-search top peaks recovered on >= 3 of 4 runs; n < 5 = run not evaluable; < 3 evaluable runs = P4 INCONCLUSIVE |

Engine verdict: FAIL if any criterion fails; INCONCLUSIVE if P1-P3 pass and P4 is INCONCLUSIVE; else PASS. Item
verdict: PASS only if both engines PASS (then the docs may call the export recommended for both engines); an engine
that passes alone is reported as such, the item stays experimental. A FAIL is a valid result and is documented.

The plan's PTM-Shepherd is not installed on data or BinAC2; the fixed histogram rule above replaces it (written
before any held-out run and before the DEV dry run). The plan's site-expansion check is not part of this test
(`-shift_expand_sites` stays undocumented).

## DEV dry run (in-sample, PXD003531, 2026-11-09, node data)

Full pipeline on the DEV run (`item17/dev/`). Comet reproduced the DEV freeze exactly (3730 -> 10360 PSMs); Sage gave
3937 -> 9956 (DEV freeze 3930 -> 9964 with byte-identical configurations and database: Sage 0.14.7 varies by about
0.2 % between runs, which is noted for P1/P3 and not corrected for). FDP(cand) 1.34 % (Comet) / 1.28 % (Sage).
Open search: 10 peaks; recovered 7/10 Comet (pass), 5/10 Sage (P4 would fail in-sample; Sage has no offsets, so the
combination peaks +80.98 and +18.04 cannot be recovered). MSFragger's massdiff centroids sit about +0.01 Da above
the Unimod masses on this run (FASTag's own calibration header reports a +0.0075 Da bias), inside the 0.02 Da
tolerance. These numbers did not change any setting.
