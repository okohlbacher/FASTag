# a/x ions (`-ion_series ax`, `-ion_series_photo ax`)

FASTag 1.13, backlog item 11. Experimental and opt-in; the a/x reading **failed** its held-out test (see
Validation). With both options at their defaults (`-ion_series by`, `-ion_series_photo by`) every output is
byte-identical to 1.12.

## What is read

Ultraviolet photodissociation (UVPD, 193 or 213 nm) cleaves the Calpha-C bond of the backbone and yields a, a+1,
x and x+1 ions next to b, y and y-1 ions (a+1 and x+1: the even-electron ion plus one hydrogen atom). FASTag reads a spectrum as one ion pair at a time (`src/IonSeries.h`,
`IonPair`):

| Series | N-terminal ion | C-terminal ion | Complement pair sum | Reversed offset (offC - offN) | Charge loss |
|---|---|---|---|---|---|
| b/y (`by`) | residues | residues + H2O | M | +18.0106 | 0 |
| c/z• (`cz`) | residues + NH3 | residues + O - N + H | M + H | -15.0347 | 1 |
| a/x (`ax`) | residues - CO | residues + CO2 | M - H or M | +71.9847 | 0 |

The offsets come from OpenMS (`Residue::getInternalToAIon`, `getInternalToXIon`). Tags are spelled from residue
differences and do not depend on the series. The flanks use the even-electron a and x offsets above; a tag spelled
from an a+1 or x+1 ladder gets flanks 1.0078 Da off, which the flank rule (0.05 Da) scores as wrong. What does
depend on the series:

- the flanks: a forward read (the low peak an x ion) has `cterm_mass` = low neutral mass - CO2 and keeps the
  residue-sum convention `nterm_mass + tag + cterm_mass + H2O = M`; a reversed read (the low peak an a ion) carries
  +71.9847 Da: N-side residues = `cterm_mass` + 71.9847, C-side residues = `nterm_mass` - 71.9847;
- the complement test: a peak's partner is one whose neutral mass completes it to M - H or to M, at the
  precursor's charges (`-complement_rule precursor` shares all c charges, as for b/y). One Calpha-C cleavage
  conserves mass: its fragments sum to M (the radical pair a+1/x+1) or, after one hydrogen moves off, to M - H
  (a+1/x or a/x+1). The even-electron a and x sum to M - 2H, which no single cleavage yields, so that sum is not
  tested. `-unknown_charge`/`-isotope_error` sum the pair excess over both sums. (Before the adversarial review the
  rule was M - 2H only; the validation below was run with that rule.)
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

Some UVPD sources record their spectra as HCD (a laser coupled into the HCD cell of a Q Exactive, as in
PXD003109): ThermoRawFileParser then writes beam-type CID, `auto -ion_series_photo ax` reads them as b/y, and
`-ion_series ax` reads them as a/x with the `Activation:` warning.

PSI-MS has a child term for UVPD (MS:1003246); neither OpenMS's mzML reader nor FASTag's fast reader maps it, so a
file that carries only that term is read through its filter string, or not at all. Use `-ion_series ax` there.

## Validation

Opt-in and experimental. Protocol and results: `acceptance/1.13/PREREG-item11.md` (branch acceptance/1.13).
Rank-1 tag correct (flank rule) on UVPD spectra, truth from each precursor's HCD partner spectrum (MSFragger b/y,
1% FDR):

| Set | UVPD spectra | by | ax |
|---|---|---|---|
| DEV PXD018176 replicate 1 (213 nm, 5-100 ms) | 77,594 | 31.65% | 0.05% |
| held-out PXD018176 replicate 2 (scored once) | 77,643 | 30.87% | 0.04% |

The held-out endpoint (ax - by >= +5 points) fails: -30.83 [-31.63, -30.02]. As measured: `-ion_series ax`
(even-electron a/x flanks, the M - 2H complement rule, every spectrum read as a/x only) loses to b/y by 30.8 points
on held-out PXD018176. On a 193-nm run (PXD003109, DEV, truth MSFragger a,b,x,y) by 63.1%, ax 0.3%. MSFragger with
a,x ions only identifies 0-214 spectra per 213-nm run and 541 on the 193-nm run, against thousands with a,b,x,y.

What was not tested: an a+1/x+1 reading (a+1 and x+1 are the more frequent photo ions in the DEV census:
a+1 5.01% vs a 3.59%, x+1 1.83% vs x 1.01% at 100 ms), a mixed b/y + a/x reading of one spectrum, and the
complement rule M - H / M that replaced M - 2H after the review (DEV-only change; the held-out set PXD018176
replicate 2 has been scored once and is not reused). The result does not show that these spectra lack a/x
information; it shows that this even-electron, a/x-only reading does not recover it. An a+1/x+1 or hybrid
reading would be a new backlog item with its own DEV work and a new held-out set. `-ion_series ax` stays
experimental; it is not a default candidate.

## Tests

`test/ax_ions_test.cpp` (ion pair against OpenMS and hand values, modes, photo detection, a/x ladders from
OpenMS's TheoreticalSpectrumGenerator, TagRecon and Digest offsets, INFO/WARN lines, run rows) and
`test/ax_cli_test.sh` (option off = 1.12 on photo and CID runs; a/x rows, placements and the digest call on a
synthetic UVPD run; `@uvpd` filter token; MGF; warnings; `-stream`; threads; `-species`).
