# a/x ions (`-ion_series ax`, `-ion_series_photo ax`)

FASTag 1.13, backlog item 11. Experimental and opt-in: with both options at their defaults
(`-ion_series by`, `-ion_series_photo by`) every output is byte-identical to 1.12.

## What is read

Ultraviolet photodissociation (UVPD, 193 or 213 nm) cleaves the Calpha-C bond of the backbone and yields a and x
ions next to a+1, b, y and y-1 ions. FASTag reads a spectrum as one ion pair at a time (`src/IonSeries.h`,
`IonPair`):

| Series | N-terminal ion | C-terminal ion | Pair sum | Reversed offset (offC - offN) | Charge loss |
|---|---|---|---|---|---|
| b/y (`by`) | residues | residues + H2O | M | +18.0106 | 0 |
| c/z• (`cz`) | residues + NH3 | residues + O - N + H | M + H | -15.0347 | 1 |
| a/x (`ax`) | residues - CO | residues + CO2 | M - 2H | +71.9847 | 0 |

The offsets come from OpenMS (`Residue::getInternalToAIon`, `getInternalToXIon`). Tags are spelled from residue
differences and do not depend on the series. What does depend on it:

- the flanks: a forward read (the low peak an x ion) has `cterm_mass` = low neutral mass - CO2 and keeps the
  residue-sum convention `nterm_mass + tag + cterm_mass + H2O = M`; a reversed read (the low peak an a ion) carries
  +71.9847 Da: N-side residues = `cterm_mass` + 71.9847, C-side residues = `nterm_mass` - 71.9847;
- the complement test: a peak's partner is the one whose neutral masses sum to M - 2H (2.01565 Da below the b/y
  partner), at the precursor's charges (`-complement_rule precursor` shares all c charges, as for b/y);
- no precursor window is cut (that is the c/z• ETD filter only).

Every consumer takes the offset from the tag's series: `-recon_out`/`-recon_id_out`/`-delta_out`/`-massgap_out`
(TagRecon placement and localisation ladders), `-digest_out` and `-label_out` (TerminusCounter), the census
(`best_ion_series` = `ax`), `-unknown_charge`/`-isotope_error` (charge and isotope evidence from a/x pairs) and
`-dump_spectrum`. `-species` and `-alkylation_out` read b/y tags only; they leave a/x rows out and count them
(`Ion series: N tag rows read as a/x ions were left out of -species`). The benchmark scorer
(`bench/fastag-bench`, `score.py` `REVERSED_OFFSET["ax"]`) reads the `ion_series` column per row.

## Modes

- `-ion_series ax`: every MS2 spectrum is read as a/x. The tag TSV gains the last column `ion_series` (`ax`), the
  census `best_ion_series`. One `Ion series (-ion_series ax): ...` line on stderr gives the spectra per series and
  the photo-activated count; when more than 1% of the MS2 spectra have a collisional, electron or hybrid activation
  an `Activation:` warning says so. MGF and mzPeak input carry no activation, so they never warn.
- `-ion_series auto -ion_series_photo ax`: as `auto` (ETD/ECD as c/z•, everything else as b/y), except that a
  photo-activated mzML spectrum is read as a/x. Photo-activated means: the spectrum's activation class is
  `unknown` (no collisional, electron or hybrid method or filter token) and its first precursor lists
  photodissociation (MS:1000435, which both mzML readers map to OpenMS `PHD`), or its Thermo filter string has an
  `@uvpd` token. A UVPD spectrum with supplemental HCD (`@hcd..@uvpd..`, or HCD listed with PHD) stays collisional
  and is read as b/y. The `ion_series` column is written when some MS2 is electron or photo activated (a metadata
  scan before any output opens), so a run without them writes what `auto` writes. MGF and mzPeak are read as b/y
  (no activation). The run rows of the versioned reports gain `ion_series_ax` and `ion_series_photo`.
- `-ion_series_photo ax` under `by`, `cz` or `ax` is ignored with a warning; `-stream` refuses it.

PSI-MS has a child term for UVPD (MS:1003246); neither OpenMS's mzML reader nor FASTag's fast reader maps it, so a
file that carries only that term is read through its filter string, or not at all. Use `-ion_series ax` there.

## Validation

Opt-in and experimental. The protocol (DEV on public UVPD data, truth search, held-out only on a disjoint public
set) is in the 1.13 acceptance branch (`acceptance/1.13/PREREG-item11.md`); results are reported there. Not a default
candidate before that.

## Tests

`test/ax_ions_test.cpp` (ion pair against OpenMS and hand values, modes, photo detection, a/x ladders from
OpenMS's TheoreticalSpectrumGenerator, TagRecon and Digest offsets, INFO/WARN lines, run rows) and
`test/ax_cli_test.sh` (option off = 1.12 on photo and CID runs; a/x rows, placements and the digest call on a
synthetic UVPD run; `@uvpd` filter token; MGF; warnings; `-stream`; threads; `-species`).
