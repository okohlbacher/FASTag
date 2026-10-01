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
