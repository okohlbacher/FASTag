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
