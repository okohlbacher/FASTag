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
