# Test fixtures

`Ecoli_MS2_small.mzML` — OpenMS's own example file
(`share/OpenMS/examples/ID/Ecoli_MS2_small.mzML` at OpenMS `release/3.5.0`,
sha256 `30717211f2a832e281604a4cdc12d13d74f484d9fb51a5d94a62f80713c16f6e`),
vendored because bioconda's `openms` package ships `share/OpenMS` without its
`examples/` tree. CI copies it into every release bundle at
`share-OpenMS/examples/ID/` and runs the tag-time taxonomy smoke on it. OpenMS
is BSD-3-Clause; see `BOM.md`.

`Ecoli_MS2_small.fasta` — three proteins (prsA, metK, rplF) that tags from
`Ecoli_MS2_small.mzML` place in, copied verbatim from OpenMS's
`share/OpenMS/examples/TOPPAS/data/Identification/target_decoy_Ecoli_K12_TaxID_83333.proteomes.fasta`
at `release/3.5.0` (that file's sha256
`51970c68c90e23b65b947f3448c88b36b5faa9ec4740cca563eb98b507475d29`). Also
BSD-3-Clause.

`Ecoli_MS2_small.mgf` — `Ecoli_MS2_small.mzML` written as MGF by
`tools/mzml_to_mgf.py` (pyteomics 5.0.2, psims 1.4.0, numpy 1.26.4, Python
3.11), sha256
`08090b35962547c1c29163419b9a082bd4e97c8be8686f6834a7a75538c72e54`. All 139
spectra are MS2 with a charge; m/z is 64-bit and intensity 32-bit in the
source, and both are written as the shortest text that parses back to the same
value, so the MGF holds exactly the mzML's peaks. The source's `scan start
time` is in **seconds** and is written unchanged as RTINSECONDS (the converter
converts by the cvParam's unit; the JPR harness writer it is derived from
multiplies by 60 whatever the unit). TITLE is the mzML native ID and SCANS its
scan number. Vendored so ctest needs no Python. Derived from an OpenMS example,
so BSD-3-Clause as well.

`diatracer_like.mzML` and `ddapasef_empty.mzML` — the input of
`mzml_to_mgf_test` (the converter `tools/mzml_to_mgf.py` and FASTag on its
MGF). Written by `make_converter_fixtures.py` (pyteomics 5.0.2, numpy 1.26.4;
`ddapasef_empty.mzML` rewritten with pyteomics 5.0.1, numpy 2.4.6, which
reproduces `diatracer_like.mzML` byte for byte)
from `Ecoli_MS2_small.mzML`: the peaks are spectra 0-59 and 60-119 of that file,
so BSD-3-Clause as well, and only the mzML around them is reshaped after real
timsTOF files. Both are indexedmzML with an exact index.

- `diatracer_like.mzML` (60 MS2) follows diaTracer 2.2.1 output (PXD047793):
  native IDs `frame=<n>` under a source file that claims the Thermo nativeID
  format, detector cvParams with `accession="UNKNOWN"`, the precursor m/z only
  as `isolation window target m/z` (the selectedIon holds charge and intensity,
  no m/z), an empty `<activation/>`, `spectrum title`, scan start time in
  minutes, ion mobility on the scan, 64-bit zlib m/z and intensity.
- `ddapasef_empty.mzML` (10 MS1, 60 MS2) follows msconvert-style ddaPASEF
  output: native IDs `merged=<k> frame=<f> scanStart=.. scanEnd=..`, selected
  ion m/z with charge and ion mobility, an isolation window target rounded to
  0.1, 64-bit m/z and 32-bit intensity. Four MS2 have no peaks: two as zlib
  arrays of length 0, one as uncompressed arrays of length 0, one with no
  binary arrays at all (the form the converter failed on before). One MS2 has a
  precursor without any m/z and one has no precursorList. Three have
  precursors FASTag's mzML reader does not count as one: a `<precursor>` with
  only isolation window offsets and an empty `<activation/>` (no
  selectedIonList), one whose only m/z is a target of 0, and one such before a
  second, normal `<precursor>` (FASTag takes the second).

sha256: `diatracer_like.mzML` `fbff96360f591209a7f1ac9f38899a6724c6ffaebdcbb6df3c883b421b4fce0d`,
`ddapasef_empty.mzML` `37d838f8cef462c81755144b8dd76b6787b590a360947ae4e5a60069fc9f596d`.

Acquisition-check fixtures (1.12 item #7), written by
`make_acquisition_fixtures.py` (pyteomics 5.0.1, numpy 2.4.6, Python 3.11; it
reuses the helpers of `make_converter_fixtures.py` and is deterministic) from
`Ecoli_MS2_small.mzML`: the peaks are the 25 most intense of that file's
spectra, cycled, so BSD-3-Clause as well; only the acquisition layout around
them is synthetic. All mzMLs are indexedmzML with an exact index. Read by
`acquisition_test` and `acquisition_cli_test`.

- `dia_like.mzML`: raw Orbitrap DIA, msconvert-style (PXD006096-like): 20
  windows of 25 Th over 400-900, selected ion at the window target, no charge,
  6 cycles with one MS1 each. Refused.
- `astral_dia_like.mzML`: Astral narrow-window DIA, 300 windows of 2 Th over
  380-980, one cycle and the first 30 windows of the next. Refused.
- `diapasef_split_like.mzML`: diaPASEF converted frame by frame, 10 windows of
  25 Th over 400-650, 4 consecutive MS2 per window with a 1/K0 on the scan, 4
  cycles. Refused as diaPASEF.
- `dia_shifted_target.mzML`: raw DIA whose selected ion is 8 Th above the
  window target in every other window, offsets -3/+13: the windows tile
  400-720 only when read from the target. Refused.
- `dia_pseudo_like.mzML`: DIAspeXtract 1.7.0 output (as its PXD006096
  pseudo.mzML): its software entry, `spx:` run userParams, `spx_*` spectrum
  userParams, a charged mono m/z inside its DIA window. Passes.
- `dia_pseudo_repeat_like.mzML`: the same provenance on uncharged spectra whose
  m/z repeats with the DIA cycle (raw DIA but for the provenance). Passes.
- `prm_like.mzML`: PRM, 8 scattered charged targets of 2 Th, 15 cycles. Passes.
- `wwa_dda_like.mzML`: wide-window DDA, 12 Th windows centred near a charged
  mono m/z, an MS1 every 10 MS2. Passes.
- `dia_nowin_like.mgf`: raw DIA as MGF, PEPMASS cycling through 20 window
  centres, no CHARGE. Refused.
- `prm_noz_like.mgf`: an uncharged PRM / inclusion list as MGF, 40 random
  targets over 400-1000 (seed 17) every cycle, 12 cycles, no CHARGE: periodic
  and uncharged without windows, but not a window grid. Passes.

sha256: `dia_like.mzML` `85708ffbfecb481fe65fc4fac8fa1f4663077df4398deb930a2bd68185a875f5`, `astral_dia_like.mzML` `f61384d896ed1e7441629aff878d709e18d851c530ae2dff5ef26a3e6901a3bc`,
`diapasef_split_like.mzML` `32b88e6d7df7f37c6772d4558a6d742171643e1b84cfa13e3f3e5f894dab3515`, `dia_shifted_target.mzML` `4fb2541dbb6782cc5ade93bda0f4f280a6206b2a7279d4cf826a0e8af724d08a`,
`dia_pseudo_like.mzML` `15827a97f0f39c45812593175f8dff906320c764779c0a3b4f8cabafc680c96a`, `dia_pseudo_repeat_like.mzML` `846f6d12fa6ac7be27b3d8fecbf8b804fa672caf42d7ffa315f9e3d9faa53f1b`,
`prm_like.mzML` `f10e516500089eb86fae255c48849b8772a975bda101fe885809b4f04290194d`, `wwa_dda_like.mzML` `ab13880d8223152904ee9f5d2538b2167b1e892abbd91d515633999542209ec3`, `dia_nowin_like.mgf` `c7cb54169823a0bf6fd53973864f0c5f561b269afab8a5dd1c9172af5eb5e122`, `prm_noz_like.mgf` `9d666015736332de22efbd662f297e82beae0324dd24fa8cc9298716007af012`.

`profile_ms2_small.mzML`, `profile_ms2_untyped.mzML`,
`profile_ms2_paramgroup.mzML` and `profile_ms2_lowres.mzML` — the profile-MS2
fixtures of `profile_cli_test` and `indexed_mzml_test` (FASTag 1.12 #9,
`-pick_profile`). Written by `make_profile_fixtures.py` (Python 3.15.0, zlib
1.2.12, standard library only) from `Ecoli_MS2_small.mzML`: each centroid of
the source spectra becomes a sampled Gaussian with its intensity as apex, so
BSD-3-Clause as well. Native IDs, retention times, precursors and scan windows
are the source's; 64-bit m/z, 32-bit intensity, zlib; indexedmzML with an exact
index and SHA-1 checksum.

- `profile_ms2_small.mzML`: source spectra 0-9, resolving power 60,000 (FWHM =
  m/z / 60000), 6 samples per FWHM, MS:1000128 in each spectrum's cvParams,
  orbitrap analyser.
- `profile_ms2_untyped.mzML`: spectra 0-3 as above with no MS:1000127/128.
- `profile_ms2_paramgroup.mzML`: spectra 0-3 as above, the type only in a
  `referenceableParamGroup` (the MS level stays an own cvParam).
- `profile_ms2_lowres.mzML`: spectra 10-13, FWHM 0.3 Th sampled every 0.05 Th,
  linear ion trap analyser.

sha256: `profile_ms2_small.mzML` `d2b63aab24eaf2fc3d30e4576efcf379269b91e0102657c1aa1d6a5de59a8344`,
`profile_ms2_untyped.mzML` `be6b92b3c7aacb3db1324e486170346a13714f39594f88f15488cefbbac9aceb`,
`profile_ms2_paramgroup.mzML` `745df24ee8f5a923003c2308427ff295271d8926eefb678799382ea266de9147`,
`profile_ms2_lowres.mzML` `30d1f9d64f016e5824493da0a0ae18cb9cb6846e50c523d533c410225e523338`.

`census_edge.mzML` (12 spectra: 1 MS1, 11 MS2) — the input of
`census_cli_test`, written by `make_converter_fixtures.py` (pyteomics 5.0.1,
numpy 2.4.6, Python 3.11; the same run reproduces `diatracer_like.mzML` and
`ddapasef_empty.mzML` byte for byte) from spectra 0-11 of
`Ecoli_MS2_small.mzML`, so BSD-3-Clause as well. One case per census status:
index 0 an MS1, 1 an MS2 without peaks, 2 an MS2 without precursorList, 3 an
MS2 whose selected ion m/z is `nan`, 4 an MS2 with 2 peaks, 5 an MS2 whose
intensities are all 0, 6 one whose intensities are all NaN, 7-11 five MS2 as
in the source, index 9 without a charge state. 64-bit m/z, 32-bit intensity,
indexedmzML with an exact index. sha256
`673eff96641ceb6a56b419385f73b6065cd75df25c729032a7cb18b9e62ca0db`.

`label_1.11.0_Ecoli_MS2_small_Da.tsv` — the `-label_out` report of the FASTag
1.11.0 release binary (78390cd, node data
`/ceph/ibmi/abi/oliver/opt/fastag-1.11.0/FASTag/FASTag`) on
`Ecoli_MS2_small.mzML` with `-tag_length 4 -fragment_tolerance 0.5
-fragment_tolerance_unit Da -threads 2`. `test/digest_cli_test.sh` checks that
the rows before the 1.12 `label_call` rows are these, the `run version` row
aside. sha256
`7be84af167c367b58732a9503f89328a2a790185dc4d1c660363bfb66525dff6`. Derived from
the OpenMS example, so BSD-3-Clause as well.

`digest_1.11.0_Ecoli_MS2_small_Da.tsv` — the `-digest_out` report of the same
FASTag 1.11.0 run (same binary, input and options, written together with the
label report above, whose sha256 it reproduced). `test/digest_cli_test.sh`
checks that `-digest_out` at the 1.12 defaults, the chemistry v2 options
(#3c-#3f) included, writes these rows, the `run version` row aside. sha256
`f9e49767ca4a51f1369ea2c3ad6d9c7f45d5baca9c69f7527fd08715972a7eb7`. Derived from
the OpenMS example, so BSD-3-Clause as well.

`Ecoli_shortlist.fasta`, `chymo_insilico.mgf` — the #5 shortlist fixtures
(FASTag 1.12), written by `make_shortlist_fixtures.py` (standard library,
Python 3) from OpenMS `release/3.5.0`
`share/OpenMS/examples/TOPPAS/data/Identification/crap.fasta` (sha256
`2f346d83abc0f4d742a93d07e4a6ccb879c030932b8fffc5a93734b67e6eefc5`) and
`target_decoy_Ecoli_K12_TaxID_83333.proteomes.fasta` (sha256 above), so
BSD-3-Clause as well.

- `Ecoli_shortlist.fasta` (37 entries): prsA, metK and rplF verbatim (as in
  `Ecoli_MS2_small.fasta`), the first 30 crap.fasta entries as foreign
  proteins, the reversed prsA/metK/rplF of the target-decoy FASTA renamed from
  `rev_` to `DECOY_`, and `rev_VIMSS15051` verbatim.
- `chymo_insilico.mgf` (300 MS2): in-silico spectra of chymotryptic peptides
  (after F, W, Y, L, not before P; 7-20 residues, no C) of the first 400 target
  proteins, charge 2, singly charged b2..b(n-1) and y1..y(n-1) at exact
  monoisotopic masses, fixed seed. The protease check's non-tryptic negative
  without shipping a real chymotrypsin run.

`comet_template.params` — a Comet parameter file in the key layout OpenMS's
CometAdapter writes (createParamFile_, OpenMS develop), with Comet's comments,
as the stand-in for a `comet -p` file until the engine acceptance run records
the real one. Required keys are left out, TMT and Carbamidomethyl are set and
the enzyme is Lys_C on purpose (see its header).

sha256: `Ecoli_shortlist.fasta` `842262adfd982bcee9e0f135ba4b6214ea21282c06bf8b9d4982d32d5ae87ed4`,
`chymo_insilico.mgf` `d5bbde1229e2862f7f308626f735455b4328689f60dc0d0b777799c7ebaa6582`,
`comet_template.params` `75966c005779290916dfc104024f439924d91cf6010d6ea1d6ff3bd7658983c9`.

**Ion series (1.12 #15 phase B).** No fixture file is committed. The tests
derive what they need at run time:
- `ion_series_cli_test.sh` edits `Ecoli_MS2_small.mzML` into `etd_all`,
  `etd_1`/`etd_2`, `ethcd_all` and `filter_etd` (activation terms or the filter
  string only, at equal byte length where the index must stay exact; peaks
  untouched), as in phase A;
- `ion_series_test --write-mzml <fasta> <out.mzML> cz|by [n]` writes the
  synthetic runs `ion_series_cli_test.sh` and `threads_test.sh` use: 40
  tryptic peptides of `Ecoli_MS2_small.fasta` (up to one missed cleavage,
  8-18 residues, no C), precursor charge 2 and 3 alternately, c and z-dot ions
  (activation ETD, plus the unreacted precursor and its charge-reduced
  species) or b and y ions (activation CID) from OpenMS
  TheoreticalSpectrumGenerator at fragment charges 1 .. z-1, 15 noise peaks,
  fixed seed;
- `indexed_mzml_test` writes `etd_like` (every CID term of the indexed gate
  fixture replaced by ETD) and `etd_paramgroup` (ETD, EThcD and CID in param
  groups and own terms, one filter-string-only spectrum).

## #17 mass-shift fixture (1.12)

`shifts_insilico.mgf` (124 MS2), written by `make_shift_fixture.py
Ecoli_MS2_small.fasta .` (standard-library Python 3, fixed seed 20261107)
from the tryptic peptides (after K/R, not before P; 8-20 residues, no C) of
`Ecoli_MS2_small.fasta`: charge 2, singly charged b2..b(n-1) and y1..y(n-1) at
exact monoisotopic masses. Each spectrum carries one N-terminal mass shift on
the precursor and every b ion (y ions unshifted): 0 (40 spectra), +15.994915
Oxidation (30), +42.010565 Acetyl (20), +1.003355 13C (12), +123.4567
unexplained (12), -77.7777 unexplained (10). With `-extension 3` and
`-massgap_min_spectra 2` the run gives five gap peaks, one per rule
`digest_cli_test` checks (variable, variable, skipped_isotope, offset,
dropped_engine). Derived from the vendored FASTA only, so the same licence.

sha256: `shifts_insilico.mgf` `bb609510728087057effddcf1fec8b0a52cec4907e2e954cdd287d27cee4d257`.

## Label-discovery fixtures (independent suite)

`label_discovery/` holds the input of `test/label_discovery_indep_test.sh`, the
independent test suite of `-label_discovery_out` written from
`doc/DESIGN-label-discovery.md` alone. Written by
`make_label_discovery_fixtures.py label_discovery` (standard-library Python;
3.12 and 3.15 write the same bytes; fixed seeds 101-110, no other input): random tryptic-like peptides
(internal residues GASPVTLNDQEMHFYW, no C and no internal K/R; last residue K
or R), precursor charge 2, singly charged fragments at monoisotopic masses
with a seeded 0.2 mDa jitter, 1 ppm precursor jitter and five noise peaks per
spectrum. Every set has 240 spectra unless stated:

- `ld_tmt`, `ld_tmtpro`, `ld_itraq4`, `ld_dimethyl`: the label at the N
  terminus and on a C-terminal K, with b0 (label + H+; not for dimethyl, whose
  b0 is below any scan range), b1..b(n-1), y1..y(n-1), the precursor that lost
  the N-terminal label (image N0f) and, for K peptides, L_K + H2O + H+ (image
  K0f);
- `ld_unknown`: +123.4567 at the N terminus only;
- `ld_tmt_bonly`: TMT at N and K, b0..b(n-1) only, so every tag is a reversed
  (b-ladder) reading;
- `ld_labelfree`: no label; half the peptides start with AL and 40 % end
  with LK (strong A, A+L, K, R and L+K flanks); `ld_labelfree_iso`: the same
  peptides with 20 % of the precursors one and 5 % two 13C high;
- `ld_noise` (60 spectra): random peaks only, no tag;
- `ld_largeflank`: 30-36-residue peptides with fragments only inside
  [760, M - 760] Da, so every flank is above the default max_flank of 700;
- `ld_peptides.fasta`: the peptides of the sets as proteins, for the
  -recon_out/-delta_out/-massgap_out identity checks.

Checked with FASTag 1.12.1 (no label discovery) on node data: every tag set
carries its images in the tag TSV (TMT: 256 N0r, 265 N0f, 120 K0f, 122 K1f,
128 K1r filtered tags over 240 spectra), `ld_noise` gives no tag and every
`ld_largeflank` flank is above 700 Da. `-label_out` calls the dimethyl,
unknown and b-only sets label-free, which is the gap the new report closes.

sha256:
`ld_dimethyl.mgf` `da3a25f4bc4ddb6e4c0ee89f8bc90554529023f4567007e222af7817c5b0b45d`,
`ld_itraq4.mgf` `12c6cf92b9b187793ba30ca4e07b5e49cb398588fe747f33db191c93b3a785aa`,
`ld_labelfree.mgf` `3c38deaa60e9c718827ff85d5493112127a0cb4a860eab915547b51ae39d0ab6`,
`ld_labelfree_iso.mgf` `31eba37a438b8fd7e39f032007d7102a2185b90a5e90a7a7d7b53135ac7a9cce`,
`ld_largeflank.mgf` `b7c93418674c0311647e9d5a029655b63300ea4c2ab38a28b5e665bbfbea95ca`,
`ld_noise.mgf` `b98c1be26103980534df7e0416581c428df393e814f6279ae8e2d96f006a6890`,
`ld_peptides.fasta` `5b98bee9aea7311152612f9fd2df50736db75a1aae36480ca103a02ef99f8023`,
`ld_tmt.mgf` `a6d65859c5c1015e186d9086bb83bcc8658c6e3520293100065a016040595ee3`,
`ld_tmt_bonly.mgf` `8b12fc559a1a7cad58dd7ae3ae103466d1cd6e6ebbd170d8d8b18fd1c5b045ea`,
`ld_tmtpro.mgf` `9ea36a0ad1eac100ac765cb1acbdfbca37fceb94a6fcc9e76981e1ee71755167`,
`ld_unknown.mgf` `7506903414db2ffe52388f58d59030d11920df129c544f7f8576a1787d271ff2`.
