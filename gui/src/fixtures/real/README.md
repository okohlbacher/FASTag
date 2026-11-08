# Real FASTag CLI outputs

Unedited outputs of FASTag 1.9.0, committed so the tests in
`src/adversarial/` that need real CLI output run in every checkout
(GUI-DESIGN.md section 9, P1). Before P1 they were read only from the
directory named by `FASTAG_GUI_TEST_OUTPUTS`; that variable still overrides
this directory (see `src/adversarial/external.ts`).

Public inputs only:

- `test/fixtures/Ecoli_MS2_small.mzML` (with `Ecoli_MS2_small.fasta`), the
  E. coli fixture of this repository: `parsers/b.*` (a Da run with
  `-species`), `parsers/c.*` (a ppm run that finds no tags), `map/run.*`
  (a run with every report) and `docs/short.*` (the `-species` refusal at
  `-tag_length 3`).
- PXD063917 (PRIDE), with the UniProt human reference proteome
  UP000005640 as the digest background: `parsers/r.*` and `parsers/q.*`.

The one change: the `run background` row named the FASTA by the absolute
path it had on the machine that made the run; it is cut to the file name.
