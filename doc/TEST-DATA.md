# Test data

Two tiers. `ctest` needs none of the second — it runs on synthetic spectra built
in-process, so the suite is self-contained and offline.

## Tier 1 — ctest fixtures (in-repo, synthetic)

Built by `synth()` in `test/fastag_test.cpp` from a known peptide via
`AASequence`, so residue masses come from the same OpenMS the tool uses. If the
two ever disagreed the tests would catch it.

| what | why |
|---|---|
| ideal b/y ladders, 5 peptides | top-ranked tag must read the peptide |
| + 60 noise peaks | precision must stay above 50% |
| y-only, one interior ion deleted | gap must span the hole, in the right order |
| repeated identical runs | determinism |
| empty / 2-peak / no-precursor / charge 0 | must not crash or fabricate |

**A committed mzML fixture must carry a real index.** The local file used during
development (`local_indexed.mzML`) carries an `indexedmzML` wrapper *without* an
`<indexList>`, so `openFile` returns false and the run silently takes the
full-load path. A fixture like that makes a streaming test pass while never
exercising streaming — it happened here. `test/fixtures/Ecoli_MS2_small.mzML`
contains a real `<indexList>`; any further mzML fixture must be verified the
same way, and written with `FileConverter -write_scan_index true` if needed.

### MGF

`test/fixtures/Ecoli_MS2_small.mgf` is the fixture mzML's 139 MS2 written by
`tools/mzml_to_mgf.py` (pyteomics 5.0.2; provenance and sha256 in
`test/fixtures/README.md`). Peaks are exact and the RT is converted by its unit
(the fixture's is in seconds), so:

- `mgf_reader_test` compares every block with OpenMS's
  `MascotGenericFile::load`, bit for bit on peaks, precursor, charge, RT, MS
  level, native ID and TITLE, and covers the block scan at piece sizes from
  1 KiB to 4 MiB, the fields where FASTag differs from OpenMS on purpose, the
  errors, and reading from 8 threads. Given MGF paths as arguments it runs the
  OpenMS comparison on them instead (not part of ctest).
- `mgf_cli_test` runs the binary on the mzML and the MGF and requires every TSV
  to be identical once column 1 is cut, column 1 to be `index=<k>` for the
  k-th MS2, 1/3/8 threads to agree, `-out_spectra` to round-trip, and checks
  USI, `-recon_id_out`, `-digest_out`, charge-less input, subsampling and the
  error exits.

Outside ctest (data node, 2026-11-04, FASTag on this branch at 32 threads):

| public input | MGF from | compared | result |
|---|---|---|---|
| PXD003531 `20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01` (27,345 MS2) | `tools/mzml_to_mgf.py` | gate `dda_default` and `species` arguments; `-tag_lengths 3 4 -glyco` | tags, glyco and species TSVs identical (column 1 cut) |
| PXD014764 `20190412_KEH_HF_SA_ANW_R11_100419_CNOT_R1_f008` (30,280 MS2) | `tools/mzml_to_mgf.py` | gate `fasta_recon`; all reports and `-recon_id_out` | tags, recon and glyco identical (column 1 cut), delta identical; label, massgap and digest identical except the `run input` row (the file name) and, in digest, the metadata rows (instrument, native-ID format, ion mobility; timsTOF and scan-window rules `unknown`), with the same Trypsin call and margin; the mzid RTs of all 4,815 results identical |
| PXD040407 `Hog1p_WT_Rep3_Chymo_5uL` (11,351 MS2) | `tools/mzml_to_mgf.py` | gate `nontryptic_ext` | tags identical (column 1 cut) |
| PXD004541 `HF1_..._TMT10_hpHRP_DMSO1_2p5ug_4uL_fr02` (40,111 MS2) | `tools/mzml_to_mgf.py` | gate `tmt_fixed` | tags identical (column 1 cut) |
| PXD054073 `HeLa_T2_DDA_E_A_nLC_timspro_R02` | AlphaTims MGF; its FileConverter MGF→mzML is the control | default arguments | whole tags.tsv identical, column 1 included (130,611 MS2, 4,708,932 rows) |
| PXD003531, the JPR harness MGF (written by `fastag_bench`, whose RT ×60 is right here because the source RT is in minutes) | harness | the gate's 1.9.0 `dda_default` reference | its 27,345 TITLEs are the mzML's MS2 native IDs in order; tags identical to the reference (column 1 cut) |

`mgf_reader_test <files>` found no difference from `MascotGenericFile` on
the 130,611 blocks of the PXD054073 AlphaTims MGF and the 27,345 and 6,103
blocks of the harness's PXD003531 and PXD000001 MGFs.

## Tier 2 — benchmark corpus (external, not in-repo)

Three public acquisitions: two from PRIDE, and one ion-trap run from MassIVE
that anchors the `iontrap` synthetic profile. **One run per instrument**, so this is coverage of
the input space, not a sampled benchmark. Every instrument below was read out of
the file's own metadata, not from a catalogue — see the Eclipse entry for why.

| # | file | instrument | analyser | acquisition | spectra | peaks/MS2 (p25/med/p75) | tolerance |
|---|---|---|---|---|---|---|---|
| 1 | HeLa ddaPASEF | Bruker timsTOF Pro | TOF | real ddaPASEF | 371,187 | 95/163/273 | 20 ppm |
| 2 | Astral label-free | Orbitrap Astral | FTMS | real DDA | 102,236 | 956/1435/1682 | 20 ppm |
| 3 | Eclipse DDA-TMT | Orbitrap **Eclipse** | **ion trap** | real DDA, TMT | 41,407 | 183/273/371 | **0.3 Da** |

### Provenance

1. **HeLa ddaPASEF** — PRIDE `PXD054073`,
   `HeLa_T2_DDA_E_A_nLC_timspro_R02.d.7z` (3.17 GB). Confirmed by its own
   metadata: `MethodName: DDA PASEF-standard_1.1sec_cycletime.m`. Convert with
   `brfp convert -i <.d> -f 2 -o out.mzML` (writes indexed mzML directly).
2. **Astral label-free** — PRIDE `PXD076528`,
   `7673_YD12_P116861_S00_R1.raw` (2.4 GB). Human, DDA, label-free, tryptic.
   Convert with `ThermoRawFileParser -i in.raw -b out.mzML -f 2`.
3. **Eclipse DDA-TMT** — MassIVE `MSV000096674` (public, no PXD accession),
   `ec04479_qy_4cell_SanJose_A1.mzpeak`. Used only to fit the `iontrap`
   synthetic profile below; it is not a demo data set.
   **The mzPeak catalogue labels this "Orbitrap Astral". The file says
   `MS:1003029 name="Orbitrap Eclipse"`.** The deposit contains Astral, Eclipse
   and Ascend data and the index labels by deposit. Trusting it, and then running
   ion-trap MS2 at 20 ppm, produced 3,007 tags where 0.3 Da produces 824,959 — a
   factor of 274 that looked exactly like bad data. Read the instrument out of
   the file.

### What each one is for

- **1 vs 2** separates *vendor and analyser* at similar acquisition. Also the
  only pair whose peak density genuinely varies, so the only one that can test
  whether a peak budget generalises.
- **3** is the low-resolution cornerstone. Every other file is high-res; without
  one ion-trap acquisition the tolerance-mismatch failure mode is invisible. It
  earned its place immediately: the `iontrap` profile derived from it exposed an
  uncaught exception in `-deisotope` at 0.3 Da.

### Database-search ground truth

The ground truth in this repository is the Mascot search shipped with
PXD000001 (`F063721.dat`, 2,254 PSMs at 1% FDR), scored by
`tools/pxd000001_truth.py`; see [BENCHMARK-DirecTag.md](BENCHMARK-DirecTag.md).
Ground truth from Sage identifications on further public PXD runs is being
prepared for the benchmark supplement.

## Tier 3 — synthetic benchmark (in-repo, exact truth)

`bench/benchmark.cpp`. The answer to tier 2's fragility: a seed and a profile,
no external data, exact **per-tag** truth.

```bash
benchmark stats  <file.mzML> [tol] [ppm|da]   # measure a real acquisition
benchmark synthstats <profile>                # same statistics, generated
benchmark synth  <profile> [n] [TL] [gaps] [ext] [peaks] [gap_penalty]
```

Three profiles, one per cornerstone. Each is **fitted** so `synthstats` lands on
what `stats` measures on the real file — peak count and ladder edge density, the
one structural property tagging consumes that needs no identifications:

| profile | peaks/MS2 real → synth | ladder real → synth |
|---|---|---|
| astral | 1337 → 1395 | 69.4% → 75.2% |
| ddapasef | 140 → 147 | 38.5% → 35.7% |
| iontrap | 267 → 215 | 79.2% → 78.8% |

**What it is for**: ranking. PSM truth is per *spectrum*, so it can say a correct
tag was found but never whether it was found *first*. Per-tag truth can, and
rank-1 accuracy is where the gapped-tag defect lived — invisible for months
because nothing measured it.

**What it is not**: real data. It cannot discover a failure mode the generator
does not model, and its profiles are fitted to two summary statistics, which is
not the same as reproducing a spectrum. `-gap_penalty`'s default of 100 is
calibrated on it and is the weakest-supported number in the tool. Real-data
validation is still required for anything that matters; what the benchmark buys
is that a regression in ranking now fails in seconds instead of never.

### Reproducing a measurement

```bash
FASTag -in <file> -out tags.tsv -tag_length 6 -threads N \
       -fragment_tolerance <see table> -fragment_tolerance_unit <ppm|Da>
```

Ground-truth recall counts spectra gaining a correctly placed tag: a tag is
correct if its sequence occurs in the identified peptide at a position whose
prefix mass matches `nterm_mass` (y-derived), or whose reverse matches with
`cterm_mass + H2O` (b-derived), within 0.05 Da.

### Known gaps

- `-out_spectra` is covered end to end only through mzPeak: `mzpeak_roundtrip`
  and `mzpeak_e2e` write archives with it and re-tag them. There is no unit test
  of the writer itself.
- Tier 3 runs in `ctest` (`bench_<profile>`, one short run per profile) as a
  smoke test only: it fails when a profile produces no tags at all, not when
  ranking accuracy drops.
- There is no profile for diaTracer pseudo-spectra. One fitted to a public
  diaTracer run (for example from PXD047793) would close the gap.
