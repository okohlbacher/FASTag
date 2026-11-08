# P5 smaller taxonomy: benchmark against the paper's species calls

2026-11-08. Track p5b, branch `gui/p5b-taxonomy`. Decision rule (GUI-DESIGN.md sections 8 and 10, P5): the bundled
`tax_k7.taxdb` is replaced only if every species call a user would see is unchanged **and** the macOS dmg is
≤ 110 MB. If any visible call changes, the index is not swapped, and a swap would have to ship as 2.0.0.

## Result: no swap

- **No candidate passes either condition.** The two panel indexes (B, 35 taxa; Bnw, 34 taxa) change the headline
  species call the GUI shows in 56 and 23 of 192 run/setting reports. The rebuilt one-proteome-per-genus index (S50)
  keeps every headline call but changes the visible taxa table (counts, order of lower rows) in every report, and it
  is not smaller.
- **No index of this format can reach 110 MB.** The k = 7 index is a dense table of about 1.13 GB whatever the taxa
  (B with fewer taxa is *larger* than SHIP). The GUI dmg without any taxonomy index is already 51.1 MB, so ≤ 110 MB
  would need an index that compresses to about 59 MB, a quarter of the smallest candidate (Bnw, 236-239 MB in the
  dmg).
- **Decision: the bundled SHIP index (sha256 34427bba…1a4f) stays.** Swapping in B or Bnw would change visible calls,
  so it would require 2.0.0; per the rule, the swap work (asset build, CI taxonomy-asset job, GUI loading) was not
  started. This PR carries only this report and the benchmark tooling.
- Reproduction is exact: the current CLI with the bundled index gives species reports byte-identical to the earlier
  1.11.0 rerun (144/144), and its `-species_evidence all` setting gives the paper's 1.9.0 default reports
  byte-identically (48/48). The candidate sweeps are byte-identical to the 2026-11-06 sweeps (192/192 each for SHIP
  and B), so the result does not depend on node load.

## Setup and provenance

- **CLI.** FASTag 1.11.0 release bundle, `/ceph/ibmi/abi/oliver/opt/fastag-1.11.0/FASTag/FASTag`. This is the CLI on
  `main` (13c7423): the only change to `src/`, `include/` or `CMakeLists.txt` since v1.11.0 is the 1.11.1 version bump.
  The index was swapped in with `FASTAG_TAXONOMY_DIR` (SHIP = the bundle's own `share-FASTag-taxonomy`).
- **Runs.** The paper's species benchmark: 48 runs from 37 public PXDs (fastag-bench `config/species_runs.tsv`; D10
  data only, no AGXT/Sxx), four settings each: `default` (the GUI default), `deconv` (`-species_deconvolve`),
  `gapped` (`-species_use_gapped`) and `all` (`-species_evidence all`, the paper's 1.9.0 counting rule). The command
  is the paper harness's `fastag_cmd`: `-extension 2 -species`, label modifications, 0.3 Da on ion-trap runs,
  `-threads 48`.
- **Node.** `data` (224 CPUs, 1-minute load 70-120 during the sweep), `--jobs 2`, sequential per index,
  2026-11-08 01:21-01:48. All 768 FASTag jobs returned rc 0. `tools/taxonomy_bench/run_indexes.sh`.
- **Paper calls.** FASTag 1.9.0, `def_v190`/`dec_v190`/`gap_v190` in
  `/ceph/ibmi/abi/oliver/fastag-species111/per_run_top1.tsv` (draft-v9 Figure 6, reproduced byte-for-byte in
  SPECIES-BENCH-1.11.md).
- **Comparison.** `tools/taxonomy_bench/compare_indexes.py`. "Headline call" is what the GUI's Species tab puts on
  its card (SpeciesPanel.tsx): the first row with observed > 0, or "tie:a,b" when the top rows tie on adjusted and
  observed. "Visible table" is every row the tab lists (observed > 0: name, observed, adjusted, q). "Top-1" is the
  harness's first genus row.
- **Outputs.** `/ceph/ibmi/abi/oliver/fastag-p5b-taxbench/` (species.tsv, command.txt, time.json per report, logs,
  `cmp/`), `data:/scratch/kohlbach/fastag-p5b/`. The per-run tables are also in
  `tools/taxonomy_bench/results/` on the branch.

## Indexes

| Index | What it is | Taxa | tax_k7.taxdb raw | xz -6 | sha256 (taxdb) |
|---|---|---|---|---|---|
| SHIP | bundled (taxonomy-k7-20260901) | 50 genera, one reference proteome each | 1,138,145,846 B | 245.0 MB | 34427bba…1a4f |
| S50 | design candidate 1, "one proteome per genus": SHIP's 50 genera rebuilt from current UniProt | 50 | 1,137,688,537 B | 244.9 MB | 8d9a85f8…9ad2 |
| B | design candidate 2, "30-40 taxa": 28 common genera, cRAP sources (Hevea, Lysobacter, Grifola), PRIDE species (Canis, Glycine, Solanum, Triticum) | 35 | 1,214,445,857 B | 253.1 MB | 14d04ff7…fa6c |
| Bnw | B without Triticum (the only candidate smaller than SHIP) | 34 | 1,131,931,273 B | 235.8 MB (tar.xz with dumps) | 20088e20…2119 |

The indexes were built on 2026-11-06 (TAXDB-REDUCED.md); this round benchmarks them, Bnw for the first time.

## dmg size with each index (macOS arm64, measured)

Method: the v1.11.1 release dmg (`FASTag-gui-macos-arm64.dmg`, ULMO) was mounted and copied; its
`share/FASTag/taxonomy` directory (taxdb and both dumps) was replaced by each candidate's, and the image was rebuilt
locally with `hdiutil create -format ULMO` (unsigned). The SHIP rebuild calibrates the method against the CI-built
release image.

| Index | Local ULMO rebuild | Estimated CI dmg (release − 5.5 MB offset) | ≤ 110 MB? |
|---|---|---|---|
| SHIP | 300.2 MB | 294.7 MB (the v1.11.1 release asset, measured) | no |
| S50 | not rebuilt (xz 0.1 MB smaller than SHIP) | ≈ 294.6 MB | no |
| B | 307.8 MB | ≈ 302.3 MB | no |
| Bnw | 290.0 MB | ≈ 284.5 MB | no |
| no taxonomy index (floor) | 51.1 MB | ≈ 45.6 MB | — |

The CLI-only macOS dmg (FASTag-macos-arm64.dmg, UDZO, 532.3 MB in v1.11.1) moves by the gzip deltas instead
(B +23.7 MB, S50 −0.2 MB, TAXDB-REDUCED.md).

## Species calls

### Summary (192 reports per index: 48 runs × 4 settings)

| Index | Headline calls changed vs SHIP | Visible tables changed | Correct top-1 lost | Correct top-1 gained | Top-1 is a truth genus |
|---|---|---|---|---|---|
| SHIP | — | — | — | — | 142/192 |
| S50 | **0** | 192 (counts differ; same row order in 69) | 0 | 0 | 142/192 |
| B | **56** | 192 | 21 | 3 | 124/192 |
| Bnw | **23** | 192 | 7 | 3 | 138/192 |

"Correct lost/gained" counts reports, over all 192, where SHIP's top-1 genus is a truth genus and the candidate's is not
(or the reverse); these are the `correct_lost` and `correct_gained` columns of `results/summary.tsv`. Its
`lost_vs_paper_correct` column is the subset of the losses where the paper's 1.9.0 call was also correct (the paper has
calls only for default, deconv and gapped): 2 for B and 2 for Bnw.
Against the paper's own calls (`all` setting = the paper's 1.9.0 rule, byte-identical to the paper's default reports):
B changes 17 of 48 and Bnw 7 of 48; S50 none.

What goes wrong in the panel indexes: a large plant proteome with no counterpart in SHIP takes the top call wherever
the true genus is missing or the evidence is mostly shared vertebrate sequence. Triticum becomes the headline call in
51 of B's 56 changed reports, Glycine in 18 of Bnw's 23 (Glycine also once in B). Both lose the paper's validated SIHUMIx call in PXD017035
(Bacteroides, not in the panel). The three gains are all in-sample deconv/gapped calls in PXD073843 (Macaca → Homo)
and PXD035449 (Gallus → Mus) and do not offset the losses.

S50 shows that even a same-content rebuild is not invisible: the UniProt proteome versions moved, so observed and
adjusted counts and q-values change in every report and the order of lower-ranked rows changes in 123 of 192. The
headline call and the top-1 genus stay the same in all 192.

### Every difference (headline call or top-1 changed vs SHIP)

Correct = the call is one of the run's truth genera.

| Index | Run | Setting | Paper (1.9.0) | SHIP | Candidate | SHIP correct | Candidate correct |
|---|---|---|---|---|---|---|---|
| B | PXD017035_d12_12_hTT_I | default | Bacteroides | Bacteroides | Triticum | yes | no |
| Bnw | PXD017035_d12_12_hTT_I | default | Bacteroides | Bacteroides | Glycine | yes | no |
| B | PXD017035_d12_12_hTT_I | deconv | Bacteroides | Bacteroides | Escherichia | yes | yes |
| Bnw | PXD017035_d12_12_hTT_I | deconv | Bacteroides | Bacteroides | Escherichia | yes | yes |
| B | PXD017035_d12_12_hTT_I | gapped | Bacteroides | Bacteroides | Triticum | yes | no |
| Bnw | PXD017035_d12_12_hTT_I | gapped | Bacteroides | Bacteroides | Glycine | yes | no |
| B | PXD017035_d12_12_hTT_I | all | - | Bacteroides | Triticum | yes | no |
| Bnw | PXD017035_d12_12_hTT_I | all | - | Bacteroides | Glycine | yes | no |
| B | PXD000279_HeLa60_Ecoli10 | default | Danio | Homo | Triticum | yes | no |
| B | PXD000279_HeLa60_Ecoli10 | deconv | Chlamydomonas | Chlamydomonas | Triticum | no | no |
| B | PXD000279_HeLa60_Ecoli10 | gapped | Danio | Danio | Triticum | no | no |
| B | PXD000279_HeLa60_Ecoli10 | all | - | tie:Danio,Homo | Triticum | no | no |
| Bnw | PXD000279_HeLa60_Ecoli10 | all | - | tie:Danio,Homo | Glycine | no | no |
| B | PXD046460_T1P99_01 | gapped | Chlamydomonas | Homo | Triticum | no | no |
| B | PXD046460_T1P99_01 | all | - | Bos | Triticum | no | no |
| B | PXD046460_T5P95_01 | gapped | Chlamydomonas | Homo | Triticum | no | no |
| B | PXD046460_T10P90_01 | all | - | Homo | Triticum | no | no |
| B | PXD046460_PC | gapped | Chlamydomonas | Pseudomonas | Triticum | yes | no |
| B | PXD046460_PC | all | - | Pseudomonas | Triticum | yes | no |
| B | PXD007885_Saureus_phagosome | default | Danio | Homo | Triticum | yes | no |
| B | PXD007885_Saureus_phagosome | deconv | Caenorhabditis | Chlamydomonas | Triticum | no | no |
| B | PXD007885_Saureus_phagosome | gapped | Danio | Homo | Triticum | yes | no |
| B | PXD007885_Saureus_phagosome | all | - | Danio | Triticum | no | no |
| Bnw | PXD007885_Saureus_phagosome | all | - | Danio | Glycine | no | no |
| B | PXD081656_br25 | default | Danio | Homo | Triticum | yes | no |
| Bnw | PXD081656_br25 | default | Danio | Homo | Glycine | yes | no |
| B | PXD081656_br25 | gapped | Danio | Homo | Triticum | yes | no |
| Bnw | PXD081656_br25 | gapped | Danio | Homo | Glycine | yes | no |
| B | PXD081656_br25 | all | - | Danio | Triticum | no | no |
| Bnw | PXD081656_br25 | all | - | Danio | Glycine | no | no |
| B | PXD073843_Pf_RBC | deconv | Macaca | Macaca | Homo | no | yes |
| Bnw | PXD073843_Pf_RBC | deconv | Macaca | Macaca | Homo | no | yes |
| B | PXD073843_Pf_RBC | gapped | Macaca | tie:Macaca,Homo | Homo | no | yes |
| Bnw | PXD073843_Pf_RBC | gapped | Macaca | tie:Macaca,Homo | Homo | no | yes |
| B | PXD036799_mouse_yeast_TMT | default | Danio | Mus | Triticum | yes | no |
| Bnw | PXD036799_mouse_yeast_TMT | default | Danio | Mus | Glycine | yes | no |
| B | PXD036799_mouse_yeast_TMT | deconv | Chlamydomonas | Chlamydomonas | Triticum | no | no |
| B | PXD036799_mouse_yeast_TMT | gapped | Danio | Danio | Triticum | no | no |
| Bnw | PXD036799_mouse_yeast_TMT | gapped | Danio | Danio | Glycine | no | no |
| B | PXD036799_mouse_yeast_TMT | all | - | Danio | Triticum | no | no |
| Bnw | PXD036799_mouse_yeast_TMT | all | - | Danio | Glycine | no | no |
| B | PXD035857_PDX | default | Danio | Homo | Triticum | yes | no |
| B | PXD035857_PDX | deconv | Chlamydomonas | Chlamydomonas | Triticum | no | no |
| B | PXD035857_PDX | gapped | Danio | Homo | Triticum | yes | no |
| B | PXD035857_PDX | all | - | Danio | Triticum | no | no |
| B | PXD016579_PDX_TMT | default | Danio | Danio | Triticum | no | no |
| Bnw | PXD016579_PDX_TMT | default | Danio | Danio | Glycine | no | no |
| B | PXD016579_PDX_TMT | deconv | Chlamydomonas | Chlamydomonas | Triticum | no | no |
| B | PXD016579_PDX_TMT | gapped | Danio | Danio | Triticum | no | no |
| Bnw | PXD016579_PDX_TMT | gapped | Danio | Danio | Glycine | no | no |
| B | PXD016579_PDX_TMT | all | - | Danio | Triticum | no | no |
| Bnw | PXD016579_PDX_TMT | all | - | Danio | Glycine | no | no |
| B | PXD000044_SILAC_xenograft | default | Rattus | Homo | Triticum | yes | no |
| B | PXD000044_SILAC_xenograft | deconv | Arabidopsis | Xenopus | Glycine | no | no |
| Bnw | PXD000044_SILAC_xenograft | deconv | Arabidopsis | Xenopus | Glycine | no | no |
| B | PXD000044_SILAC_xenograft | gapped | Danio | Ovis | Triticum | no | no |
| Bnw | PXD000044_SILAC_xenograft | gapped | Danio | Ovis | Glycine | no | no |
| B | PXD000044_SILAC_xenograft | all | - | Rattus | Triticum | no | no |
| Bnw | PXD000044_SILAC_xenograft | all | - | Rattus | Glycine | no | no |
| B | PXD035449_coculture | deconv | Gallus | Gallus | Mus | no | yes |
| Bnw | PXD035449_coculture | deconv | Gallus | Gallus | Mus | no | yes |
| B | PXD081656_br1 | deconv | Caenorhabditis | Homo | Triticum | yes | no |
| B | PXD081656_br1 | all | - | Danio | Triticum | no | no |
| B | PXD078382_Biotin2 | gapped | Chlamydomonas | Homo | Triticum | yes | no |
| B | PXD078382_Biotin2 | all | - | Homo | Triticum | yes | no |
| B | PXD065430_fat | default | Chlamydomonas | Homo | Triticum | yes | no |
| Bnw | PXD065430_fat | default | Chlamydomonas | Homo | Chlamydomonas | yes | no |
| B | PXD065430_fat | gapped | Chlamydomonas | Chlamydomonas | Triticum | no | no |
| B | PXD065430_fat | all | - | Chlamydomonas | Triticum | no | no |
| B | PXD007040_CFP | default | Zea | Danio | Triticum | no | no |
| B | PXD007040_CFP | deconv | Zea | Chlamydomonas | Triticum | no | no |
| B | PXD007040_CFP | gapped | Danio | Danio | Triticum | no | no |
| Bnw | PXD007040_CFP | gapped | Danio | Danio | Glycine | no | no |
| B | PXD007040_CFP | all | - | Zea | Triticum | no | no |
| B | PXD041711_KO | all | - | Mus | Triticum | yes | no |
| B | PXD006349_rat | default | Danio | Rattus | Triticum | yes | no |
| B | PXD006349_rat | deconv | Caenorhabditis | Danio | Triticum | no | no |
| B | PXD006349_rat | gapped | Danio | Rattus | Triticum | yes | no |
| B | PXD006349_rat | all | - | Danio | Triticum | no | no |

### Per-run calls, all settings

Headline call per index (what the Species tab's card shows). **Bold** = differs from SHIP; ✗ = the top-1 genus is
not a truth genus. The paper column is FASTag 1.9.0 (the paper reports default, deconv and gapped; `all` is the
paper's rule run by 1.11.0, so its SHIP column *is* the paper's default call).

#### Setting `default`

| Run | Truth | Paper (1.9.0) | SHIP | B | Bnw | S50 |
|---|---|---|---|---|---|---|
| PXD028735_Human_01 | Homo=1 | Homo | Homo | Homo | Homo | Homo |
| PXD028735_Yeast_01 | Saccharomyces=1 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD028735_Ecoli_01 | Escherichia=1 | Escherichia | Escherichia | Escherichia | Escherichia | Escherichia |
| PXD028735_A_Alpha_01 | Homo=0.65, Saccharomyces=0.30, Escherichia=0.05 | Homo | Homo | Homo | Homo | Homo |
| PXD028735_QC_01 | Homo=0.65, Saccharomyces=0.225, Escherichia=0.125 | Homo | Homo | Homo | Homo | Homo |
| PXD028735_B_Beta_02 | Homo=0.65, Saccharomyces=0.15, Escherichia=0.20 | Homo | Homo | Homo | Homo | Homo |
| PXD017035_d12_12_hTT_I | Anaerostipes, Bacteroides, Bifidobacterium, Blautia, Clostridium, Thomasclavelia, Escherichia, Lactiplantibacillus | Bacteroides | Bacteroides | **Triticum ✗** | **Glycine ✗** | Bacteroides |
| PXD039576_HYE_8to1to1 | Homo=0.8, Saccharomyces=0.1, Escherichia=0.1 | Homo | Homo | Homo | Homo | Homo |
| PXD016470_Ecoli1x | Homo, Escherichia | Homo | Homo | Homo | Homo | Homo |
| PXD016470_Ecoli2x | Homo, Escherichia | Homo | Homo | Homo | Homo | Homo |
| PXD020815_HYpro16 | Homo=0.75, Saccharomyces=0.25 | Homo | Homo | Homo | Homo | Homo |
| PXD045500_200H_0Y | Homo=1 | Homo | Homo | Homo | Homo | Homo |
| PXD045500_100H_100Y | Homo=0.5, Saccharomyces=0.5 | Homo | Homo | Homo | Homo | Homo |
| PXD000279_HeLa60_Ecoli10 | Homo=0.857, Escherichia=0.143 | Danio | Homo | **Triticum ✗** | Homo | Homo |
| PXD046460_T1P99_01 | Thauera=0.01, Pseudomonas=0.99 | Bos | Homo ✗ | Homo ✗ | Homo ✗ | Homo ✗ |
| PXD046460_T5P95_01 | Thauera=0.05, Pseudomonas=0.95 | Homo | Homo ✗ | Homo ✗ | Homo ✗ | Homo ✗ |
| PXD046460_T10P90_01 | Thauera=0.10, Pseudomonas=0.90 | Homo | Homo ✗ | Homo ✗ | Homo ✗ | Homo ✗ |
| PXD046460_PC | Pseudomonas=1 | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas |
| PXD007885_Saureus_phagosome | Homo, Staphylococcus | Danio | Homo | **Triticum ✗** | Homo | Homo |
| PXD081656_br25 | Homo, Pseudomonas | Danio | Homo | **Triticum ✗** | **Glycine ✗** | Homo |
| PXD073843_Pf_RBC | Homo, Plasmodium | Macaca | Homo | Homo | Homo | Homo |
| PXD036799_mouse_yeast_TMT | Mus, Saccharomyces | Danio | Mus | **Triticum ✗** | **Glycine ✗** | Mus |
| PXD008611_SET60 | Homo=0.6, Mus=0.4 | Homo | Homo | Homo | Homo | Homo |
| PXD012772_VM56C | Homo, Mus | Homo | Homo | Homo | Homo | Homo |
| PXD042267_PDX | Homo, Mus | Homo | Homo | Homo | Homo | Homo |
| PXD035857_PDX | Homo, Mus | Danio | Homo | **Triticum ✗** | Homo | Homo |
| PXD016579_PDX_TMT | Homo, Mus | Danio | Danio ✗ | **Triticum ✗** | **Glycine ✗** | Danio ✗ |
| PXD000044_SILAC_xenograft | Homo, Mus | Rattus | Homo | **Triticum ✗** | Homo | Homo |
| PXD035449_coculture | Homo, Mus | Mus | Homo | Homo | Homo | Homo |
| PXD000001_Erwinia_TMT6 | Pectobacterium | Pectobacterium | Pectobacterium | Pectobacterium | Pectobacterium | Pectobacterium |
| PXD003531_QE_NO_03 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD076528_Astral_7673 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD081656_br1 | Homo | Danio | Homo | Homo | Homo | Homo |
| PXD027945_F8 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD033381_FLI06630 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD078382_Biotin2 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD016055_RPL3 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD065430_fat | Homo | Chlamydomonas | Homo | **Triticum ✗** | **Chlamydomonas ✗** | Homo |
| PXD020401_phag | Mus | Mus | Mus | Mus | Mus | Mus |
| PXD007040_CFP | Mus | Zea | Danio ✗ | **Triticum ✗** | Danio ✗ | Danio ✗ |
| PXD041711_KO | Mus | Mus | Mus | Mus | Mus | Mus |
| PXD033852_MSB43757A | Mus | Chlamydomonas | Chlamydomonas ✗ | Chlamydomonas ✗ | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD010700_Q22734 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD041573_Obp3 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD006679_Qex01777 | Escherichia | Escherichia | Escherichia | Escherichia | Escherichia | Escherichia |
| PXD044300_Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis |
| PXD006349_rat | Rattus | Danio | Rattus | **Triticum ✗** | Rattus | Rattus |
| PXD058521_fly | Drosophila | Oryctolagus | Oryctolagus ✗ | Oryctolagus ✗ | Oryctolagus ✗ | Oryctolagus ✗ |

#### Setting `deconv`

| Run | Truth | Paper (1.9.0) | SHIP | B | Bnw | S50 |
|---|---|---|---|---|---|---|
| PXD028735_Human_01 | Homo=1 | Homo | Homo | Homo | Homo | Homo |
| PXD028735_Yeast_01 | Saccharomyces=1 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD028735_Ecoli_01 | Escherichia=1 | Escherichia | Escherichia | Escherichia | Escherichia | Escherichia |
| PXD028735_A_Alpha_01 | Homo=0.65, Saccharomyces=0.30, Escherichia=0.05 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD028735_QC_01 | Homo=0.65, Saccharomyces=0.225, Escherichia=0.125 | Saccharomyces | Homo | Homo | Homo | Homo |
| PXD028735_B_Beta_02 | Homo=0.65, Saccharomyces=0.15, Escherichia=0.20 | Saccharomyces | Homo | Homo | Homo | Homo |
| PXD017035_d12_12_hTT_I | Anaerostipes, Bacteroides, Bifidobacterium, Blautia, Clostridium, Thomasclavelia, Escherichia, Lactiplantibacillus | Bacteroides | Bacteroides | **Escherichia** | **Escherichia** | Bacteroides |
| PXD039576_HYE_8to1to1 | Homo=0.8, Saccharomyces=0.1, Escherichia=0.1 | Homo | Homo | Homo | Homo | Homo |
| PXD016470_Ecoli1x | Homo, Escherichia | Homo | Homo | Homo | Homo | Homo |
| PXD016470_Ecoli2x | Homo, Escherichia | Homo | Homo | Homo | Homo | Homo |
| PXD020815_HYpro16 | Homo=0.75, Saccharomyces=0.25 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD045500_200H_0Y | Homo=1 | Homo | Homo | Homo | Homo | Homo |
| PXD045500_100H_100Y | Homo=0.5, Saccharomyces=0.5 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD000279_HeLa60_Ecoli10 | Homo=0.857, Escherichia=0.143 | Chlamydomonas | Chlamydomonas ✗ | **Triticum ✗** | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD046460_T1P99_01 | Thauera=0.01, Pseudomonas=0.99 | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas |
| PXD046460_T5P95_01 | Thauera=0.05, Pseudomonas=0.95 | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas |
| PXD046460_T10P90_01 | Thauera=0.10, Pseudomonas=0.90 | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas |
| PXD046460_PC | Pseudomonas=1 | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas |
| PXD007885_Saureus_phagosome | Homo, Staphylococcus | Caenorhabditis | Chlamydomonas ✗ | **Triticum ✗** | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD081656_br25 | Homo, Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas | Pseudomonas |
| PXD073843_Pf_RBC | Homo, Plasmodium | Macaca | Macaca ✗ | **Homo** | **Homo** | Macaca ✗ |
| PXD036799_mouse_yeast_TMT | Mus, Saccharomyces | Chlamydomonas | Chlamydomonas ✗ | **Triticum ✗** | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD008611_SET60 | Homo=0.6, Mus=0.4 | Homo | Homo | Homo | Homo | Homo |
| PXD012772_VM56C | Homo, Mus | Mus | Mus | Mus | Mus | Mus |
| PXD042267_PDX | Homo, Mus | Mus | Mus | Mus | Mus | Mus |
| PXD035857_PDX | Homo, Mus | Chlamydomonas | Chlamydomonas ✗ | **Triticum ✗** | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD016579_PDX_TMT | Homo, Mus | Chlamydomonas | Chlamydomonas ✗ | **Triticum ✗** | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD000044_SILAC_xenograft | Homo, Mus | Arabidopsis | Xenopus ✗ | **Glycine ✗** | **Glycine ✗** | Xenopus ✗ |
| PXD035449_coculture | Homo, Mus | Gallus | Gallus ✗ | **Mus** | **Mus** | Gallus ✗ |
| PXD000001_Erwinia_TMT6 | Pectobacterium | Pectobacterium | Pectobacterium | Pectobacterium | Pectobacterium | Pectobacterium |
| PXD003531_QE_NO_03 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD076528_Astral_7673 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD081656_br1 | Homo | Caenorhabditis | Homo | **Triticum ✗** | Homo | Homo |
| PXD027945_F8 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD033381_FLI06630 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD078382_Biotin2 | Homo | Pseudomonas | Pseudomonas ✗ | Pseudomonas ✗ | Pseudomonas ✗ | Pseudomonas ✗ |
| PXD016055_RPL3 | Homo | Drosophila | Homo | Homo | Homo | Homo |
| PXD065430_fat | Homo | Chlamydomonas | Chlamydomonas ✗ | Chlamydomonas ✗ | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD020401_phag | Mus | Mus | Mus | Mus | Mus | Mus |
| PXD007040_CFP | Mus | Zea | Chlamydomonas ✗ | **Triticum ✗** | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD041711_KO | Mus | Mus | Mus | Mus | Mus | Mus |
| PXD033852_MSB43757A | Mus | Chlamydomonas | Chlamydomonas ✗ | Chlamydomonas ✗ | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD010700_Q22734 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD041573_Obp3 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD006679_Qex01777 | Escherichia | Escherichia | Escherichia | Escherichia | Escherichia | Escherichia |
| PXD044300_Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis |
| PXD006349_rat | Rattus | Caenorhabditis | Danio ✗ | **Triticum ✗** | Danio ✗ | Danio ✗ |
| PXD058521_fly | Drosophila | Drosophila | Oryctolagus ✗ | Oryctolagus ✗ | Oryctolagus ✗ | Oryctolagus ✗ |

#### Setting `gapped`

| Run | Truth | Paper (1.9.0) | SHIP | B | Bnw | S50 |
|---|---|---|---|---|---|---|
| PXD028735_Human_01 | Homo=1 | Homo | Homo | Homo | Homo | Homo |
| PXD028735_Yeast_01 | Saccharomyces=1 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD028735_Ecoli_01 | Escherichia=1 | Escherichia | Escherichia | Escherichia | Escherichia | Escherichia |
| PXD028735_A_Alpha_01 | Homo=0.65, Saccharomyces=0.30, Escherichia=0.05 | Homo | Homo | Homo | Homo | Homo |
| PXD028735_QC_01 | Homo=0.65, Saccharomyces=0.225, Escherichia=0.125 | Homo | Homo | Homo | Homo | Homo |
| PXD028735_B_Beta_02 | Homo=0.65, Saccharomyces=0.15, Escherichia=0.20 | Homo | Homo | Homo | Homo | Homo |
| PXD017035_d12_12_hTT_I | Anaerostipes, Bacteroides, Bifidobacterium, Blautia, Clostridium, Thomasclavelia, Escherichia, Lactiplantibacillus | Bacteroides | Bacteroides | **Triticum ✗** | **Glycine ✗** | Bacteroides |
| PXD039576_HYE_8to1to1 | Homo=0.8, Saccharomyces=0.1, Escherichia=0.1 | Homo | Homo | Homo | Homo | Homo |
| PXD016470_Ecoli1x | Homo, Escherichia | Homo | Homo | Homo | Homo | Homo |
| PXD016470_Ecoli2x | Homo, Escherichia | Homo | Homo | Homo | Homo | Homo |
| PXD020815_HYpro16 | Homo=0.75, Saccharomyces=0.25 | Homo | Homo | Homo | Homo | Homo |
| PXD045500_200H_0Y | Homo=1 | Homo | Homo | Homo | Homo | Homo |
| PXD045500_100H_100Y | Homo=0.5, Saccharomyces=0.5 | Homo | Homo | Homo | Homo | Homo |
| PXD000279_HeLa60_Ecoli10 | Homo=0.857, Escherichia=0.143 | Danio | Danio ✗ | **Triticum ✗** | Danio ✗ | Danio ✗ |
| PXD046460_T1P99_01 | Thauera=0.01, Pseudomonas=0.99 | Chlamydomonas | Homo ✗ | **Triticum ✗** | Homo ✗ | Homo ✗ |
| PXD046460_T5P95_01 | Thauera=0.05, Pseudomonas=0.95 | Chlamydomonas | Homo ✗ | **Triticum ✗** | Homo ✗ | Homo ✗ |
| PXD046460_T10P90_01 | Thauera=0.10, Pseudomonas=0.90 | Chlamydomonas | Homo ✗ | Homo ✗ | Homo ✗ | Homo ✗ |
| PXD046460_PC | Pseudomonas=1 | Chlamydomonas | Pseudomonas | **Triticum ✗** | Pseudomonas | Pseudomonas |
| PXD007885_Saureus_phagosome | Homo, Staphylococcus | Danio | Homo | **Triticum ✗** | Homo | Homo |
| PXD081656_br25 | Homo, Pseudomonas | Danio | Homo | **Triticum ✗** | **Glycine ✗** | Homo |
| PXD073843_Pf_RBC | Homo, Plasmodium | Macaca | tie:Macaca,Homo ✗ | **Homo** | **Homo** | tie:Macaca,Homo ✗ |
| PXD036799_mouse_yeast_TMT | Mus, Saccharomyces | Danio | Danio ✗ | **Triticum ✗** | **Glycine ✗** | Danio ✗ |
| PXD008611_SET60 | Homo=0.6, Mus=0.4 | Homo | Homo | Homo | Homo | Homo |
| PXD012772_VM56C | Homo, Mus | Mus | Mus | Mus | Mus | Mus |
| PXD042267_PDX | Homo, Mus | Homo | Homo | Homo | Homo | Homo |
| PXD035857_PDX | Homo, Mus | Danio | Homo | **Triticum ✗** | Homo | Homo |
| PXD016579_PDX_TMT | Homo, Mus | Danio | Danio ✗ | **Triticum ✗** | **Glycine ✗** | Danio ✗ |
| PXD000044_SILAC_xenograft | Homo, Mus | Danio | Ovis ✗ | **Triticum ✗** | **Glycine ✗** | Ovis ✗ |
| PXD035449_coculture | Homo, Mus | Mus | Homo | Homo | Homo | Homo |
| PXD000001_Erwinia_TMT6 | Pectobacterium | Oryza | Pectobacterium | Pectobacterium | Pectobacterium | Pectobacterium |
| PXD003531_QE_NO_03 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD076528_Astral_7673 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD081656_br1 | Homo | Danio | Homo | Homo | Homo | Homo |
| PXD027945_F8 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD033381_FLI06630 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD078382_Biotin2 | Homo | Chlamydomonas | Homo | **Triticum ✗** | Homo | Homo |
| PXD016055_RPL3 | Homo | Homo | Homo | Homo | Homo | Homo |
| PXD065430_fat | Homo | Chlamydomonas | Chlamydomonas ✗ | **Triticum ✗** | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD020401_phag | Mus | Mus | Mus | Mus | Mus | Mus |
| PXD007040_CFP | Mus | Danio | Danio ✗ | **Triticum ✗** | **Glycine ✗** | Danio ✗ |
| PXD041711_KO | Mus | Mus | Mus | Mus | Mus | Mus |
| PXD033852_MSB43757A | Mus | Chlamydomonas | Chlamydomonas ✗ | Chlamydomonas ✗ | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD010700_Q22734 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD041573_Obp3 | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD006679_Qex01777 | Escherichia | Escherichia | Escherichia | Escherichia | Escherichia | Escherichia |
| PXD044300_Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis |
| PXD006349_rat | Rattus | Danio | Rattus | **Triticum ✗** | Rattus | Rattus |
| PXD058521_fly | Drosophila | Oryctolagus | Oryctolagus ✗ | Oryctolagus ✗ | Oryctolagus ✗ | Oryctolagus ✗ |

#### Setting `all`

| Run | Truth | Paper (1.9.0) | SHIP | B | Bnw | S50 |
|---|---|---|---|---|---|---|
| PXD028735_Human_01 | Homo=1 | - | Homo | Homo | Homo | Homo |
| PXD028735_Yeast_01 | Saccharomyces=1 | - | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD028735_Ecoli_01 | Escherichia=1 | - | Escherichia | Escherichia | Escherichia | Escherichia |
| PXD028735_A_Alpha_01 | Homo=0.65, Saccharomyces=0.30, Escherichia=0.05 | - | Homo | Homo | Homo | Homo |
| PXD028735_QC_01 | Homo=0.65, Saccharomyces=0.225, Escherichia=0.125 | - | Homo | Homo | Homo | Homo |
| PXD028735_B_Beta_02 | Homo=0.65, Saccharomyces=0.15, Escherichia=0.20 | - | Homo | Homo | Homo | Homo |
| PXD017035_d12_12_hTT_I | Anaerostipes, Bacteroides, Bifidobacterium, Blautia, Clostridium, Thomasclavelia, Escherichia, Lactiplantibacillus | - | Bacteroides | **Triticum ✗** | **Glycine ✗** | Bacteroides |
| PXD039576_HYE_8to1to1 | Homo=0.8, Saccharomyces=0.1, Escherichia=0.1 | - | Homo | Homo | Homo | Homo |
| PXD016470_Ecoli1x | Homo, Escherichia | - | Homo | Homo | Homo | Homo |
| PXD016470_Ecoli2x | Homo, Escherichia | - | Homo | Homo | Homo | Homo |
| PXD020815_HYpro16 | Homo=0.75, Saccharomyces=0.25 | - | Homo | Homo | Homo | Homo |
| PXD045500_200H_0Y | Homo=1 | - | Homo | Homo | Homo | Homo |
| PXD045500_100H_100Y | Homo=0.5, Saccharomyces=0.5 | - | Homo | Homo | Homo | Homo |
| PXD000279_HeLa60_Ecoli10 | Homo=0.857, Escherichia=0.143 | - | tie:Danio,Homo ✗ | **Triticum ✗** | **Glycine ✗** | tie:Danio,Homo ✗ |
| PXD046460_T1P99_01 | Thauera=0.01, Pseudomonas=0.99 | - | Bos ✗ | **Triticum ✗** | Bos ✗ | Bos ✗ |
| PXD046460_T5P95_01 | Thauera=0.05, Pseudomonas=0.95 | - | Homo ✗ | Homo ✗ | Homo ✗ | Homo ✗ |
| PXD046460_T10P90_01 | Thauera=0.10, Pseudomonas=0.90 | - | Homo ✗ | **Triticum ✗** | Homo ✗ | Homo ✗ |
| PXD046460_PC | Pseudomonas=1 | - | Pseudomonas | **Triticum ✗** | Pseudomonas | Pseudomonas |
| PXD007885_Saureus_phagosome | Homo, Staphylococcus | - | Danio ✗ | **Triticum ✗** | **Glycine ✗** | Danio ✗ |
| PXD081656_br25 | Homo, Pseudomonas | - | Danio ✗ | **Triticum ✗** | **Glycine ✗** | Danio ✗ |
| PXD073843_Pf_RBC | Homo, Plasmodium | - | Macaca ✗ | Macaca ✗ | Macaca ✗ | Macaca ✗ |
| PXD036799_mouse_yeast_TMT | Mus, Saccharomyces | - | Danio ✗ | **Triticum ✗** | **Glycine ✗** | Danio ✗ |
| PXD008611_SET60 | Homo=0.6, Mus=0.4 | - | Homo | Homo | Homo | Homo |
| PXD012772_VM56C | Homo, Mus | - | Homo | Homo | Homo | Homo |
| PXD042267_PDX | Homo, Mus | - | Homo | Homo | Homo | Homo |
| PXD035857_PDX | Homo, Mus | - | Danio ✗ | **Triticum ✗** | Danio ✗ | Danio ✗ |
| PXD016579_PDX_TMT | Homo, Mus | - | Danio ✗ | **Triticum ✗** | **Glycine ✗** | Danio ✗ |
| PXD000044_SILAC_xenograft | Homo, Mus | - | Rattus ✗ | **Triticum ✗** | **Glycine ✗** | Rattus ✗ |
| PXD035449_coculture | Homo, Mus | - | Mus | Mus | Mus | Mus |
| PXD000001_Erwinia_TMT6 | Pectobacterium | - | Pectobacterium | Pectobacterium | Pectobacterium | Pectobacterium |
| PXD003531_QE_NO_03 | Homo | - | Homo | Homo | Homo | Homo |
| PXD076528_Astral_7673 | Homo | - | Homo | Homo | Homo | Homo |
| PXD081656_br1 | Homo | - | Danio ✗ | **Triticum ✗** | Danio ✗ | Danio ✗ |
| PXD027945_F8 | Homo | - | Homo | Homo | Homo | Homo |
| PXD033381_FLI06630 | Homo | - | Homo | Homo | Homo | Homo |
| PXD078382_Biotin2 | Homo | - | Homo | **Triticum ✗** | Homo | Homo |
| PXD016055_RPL3 | Homo | - | Homo | Homo | Homo | Homo |
| PXD065430_fat | Homo | - | Chlamydomonas ✗ | **Triticum ✗** | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD020401_phag | Mus | - | Mus | Mus | Mus | Mus |
| PXD007040_CFP | Mus | - | Zea ✗ | **Triticum ✗** | Zea ✗ | Zea ✗ |
| PXD041711_KO | Mus | - | Mus | **Triticum ✗** | Mus | Mus |
| PXD033852_MSB43757A | Mus | - | Chlamydomonas ✗ | Chlamydomonas ✗ | Chlamydomonas ✗ | Chlamydomonas ✗ |
| PXD010700_Q22734 | Saccharomyces | - | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD041573_Obp3 | Saccharomyces | - | Saccharomyces | Saccharomyces | Saccharomyces | Saccharomyces |
| PXD006679_Qex01777 | Escherichia | - | Escherichia | Escherichia | Escherichia | Escherichia |
| PXD044300_Arabidopsis | Arabidopsis | - | Arabidopsis | Arabidopsis | Arabidopsis | Arabidopsis |
| PXD006349_rat | Rattus | - | Danio ✗ | **Triticum ✗** | Danio ✗ | Danio ✗ |
| PXD058521_fly | Drosophila | - | Oryctolagus ✗ | Oryctolagus ✗ | Oryctolagus ✗ | Oryctolagus ✗ |


## What would be needed for a smaller dmg

Taxon selection is not a size lever for this index (also TAXDB-REDUCED.md). Reaching ≤ 110 MB needs a different index
format (smaller k, sparse or succinct storage of the k-mer table) or download on first use; either changes the
species evidence, so it needs a new benchmark round and, if any visible call changes, a 2.0.0 release. The measured
size wins already shipped in 1.11.1 (ULMO dmg 516.8 → 294.7 MB; taxonomy asset as .tar.xz, 449.5 → 244.6 MB).

## Reproduce

```sh
# on data
sh tools/taxonomy_bench/run_indexes.sh            # 4 indexes x 48 runs x 4 settings, ~27 min
python -I tools/taxonomy_bench/compare_indexes.py \
  --manifest fastag-bench/config/species_runs.tsv \
  --paper /ceph/ibmi/abi/oliver/fastag-species111/per_run_top1.tsv \
  --ref SHIP=runs_SHIP --cand B=runs_B --cand Bnw=runs_Bnw --cand S50=runs_S50 \
  --repro /ceph/ibmi/abi/oliver/fastag-species111/runs_v1110 --out cmp
python3 tools/taxonomy_bench/report_tables.py cmp/per_run_calls.tsv
```
