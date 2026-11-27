Mass-shift tables (-delta_out) of four runs of the public PRIDE data set
PXD045734 (human eye lens, ageing; Thermo Orbitrap), written by the released
FASTag 1.16.2 CLI (FASTag-1.16.2-linux-x64.tar.gz, sha256 1b67b967...d5223492,
OpenMS 3.7.0-pre-HEAD-2026-11-02) through the FASTag benchmark harness
(benchmarks survey-045734 and blindmod-045734, parameter set dev2), on the
mirror's OpenMS FileConverter mzML. Copied unchanged (each file is the task's
delta.tsv, renamed after its input). Never hand-edited.

  FASTag -in <run>.mzML -out tags.tsv -fragment_tolerance 20 -fragment_tolerance_unit ppm \
    -extension 3 -variable_modifications 'Oxidation (M)' 'Deamidated (N)' 'Deamidated (Q)' \
    -recon_fasta uniprot-human-22.fasta -recon_localize -recon_out recon.tsv \
    -delta_out delta.tsv -delta_spectra_out spectra.tsv -threads 16 -no_progress

| file | task | input md5 | rows | spectra | localized | unlocalized | rows / spectra with abs(delta) < 0.5 Da |
|---|---|---|---|---|---|---|---|
| ah_4068_ZW_032115_UIF_N_57yo.delta.tsv | 2a16f75353013ddcf8c8 | ed7a3d58348bb7d6930b644260ec389f | 719 | 4257 | 398 | 2064 | 10 / 1783 |
| ah_4068_ZW_032115_UIF_IC_57yo.delta.tsv | b51315602065baaff7a8 | 3a0d59b94d1a393655f294b6dbfcfac6 | 695 | 4865 | 370 | 2027 | 11 / 2456 |
| sh_4096_ZW_041615_UIF_N_22yo.delta.tsv | 1ec656507313558d4972 | 01f0005ba83c77a0e9c46bcb3fb55b4b | 315 | 2279 | 175 | 607 | 9 / 1463 |
| sh_4096_ZW_041615_UIF_IC_22yo.delta.tsv | d76b7bc313ce77072f6e | 1bd10a6bcb157464c3e0d1d7b7dc81d6 | 348 | 2769 | 187 | 729 | 12 / 1820 |

Two donors (4068, 57 years; 4096, 22 years), the urea-insoluble fraction
(UIF) of the lens nucleus (N) and inner cortex (IC). The 0.0000 row of each
holds most unshifted placements, its localized sites all sequence-constrained
C-term|K / C-term|R (2a16f...: 1769 spectra, C-term|K:8,C-term|R:4,Protein
C-term|K:1, sequence_constrained 13, fragment_localized 0): the residues the
placement ends on, not modification sites. Task folders:
data:/ceph/ibmi/abi/oliver/fastag-bench/tasks/<task>/ (record.json has the
full command line, host and timing). Recorded 2026-11-26 (2a16f..., b5131...)
and 2026-11-27 (1ec65..., d76b7...).
