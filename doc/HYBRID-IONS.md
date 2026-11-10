# Hybrid EThcD/ETciD spectra as b/y and c/z• ions (`-ion_series_hybrid both`)

FASTag 1.13, backlog item 10. Experimental, opt-in and **not validated**: with `-ion_series_hybrid` at its default
`by` every output is byte-identical to 1.12 (and to `-ion_series auto` before this option).

## What is read

A hybrid spectrum (EThcD: ETD with supplemental beam-type CID; ETciD: ETD with supplemental trap CID) carries b/y
and c/z• ions at once. FASTag reads a spectrum with one ion pair at a time (`src/IonSeries.h`, `IonPair`), and no
single pair gives every tag of such a spectrum the right flanks. 1.12's `-ion_series auto` reads hybrid spectra as
b/y and warns (`Hybrid activation: ...`).

A spectrum is hybrid when its first precursor lists EThcD (MS:1002631), ETciD (MS:1003182), ETD with a
supplemental term (MS:1002678 or MS:1002679, which both mzML readers map to EThcD and ETciD), or an electron and a
collisional method together; without a method, a Thermo filter string with an electron and a collisional token
(`@etd..@hcd..`, `@etd..@cid..`) or an `@ethcd`/`@etcid` token. MGF and mzPeak carry no activation and are never
read as hybrid.

## The option

`-ion_series_hybrid <by|both>` (advanced, hidden in the GUI), read only under `-ion_series auto`:

- `by` (default): `auto` as in 1.12. Hybrid spectra are read as b/y, with the `Hybrid activation:` warning.
- `both`: every hybrid mzML spectrum is tagged twice, once as b/y and once as c/z•.
- Under `-ion_series by`, `cz` or `ax` the option is ignored with a warning (`-ion_series_hybrid is only read for
  -ion_series auto; it is ignored here`); `-stream` refuses it.

## The merge rule

Per hybrid spectrum and precursor hypothesis:

1. The spectrum is tagged with the b/y tables and with the c/z• tables. Both passes use the multiplicity H x 2
   (`IonSeries::kHybridPasses`), so every E-value of the spectrum, b/y and c/z• alike, is twice what one pass
   gives: two readings were tested, the same Bonferroni-type factor the precursor hypotheses (#6) use. The factor
   is uniform, so it does not change the order within or across passes, but it can move a row over the
   `-max_evalue` cut.
2. `FASTag::mergeSeriesPasses` puts both row lists into one, stably sorted by E-value. On a tie the b/y row comes
   first, and each pass keeps its own order within it.
3. The list is cut to one cap, `-max_tags` x the number of tag lengths: the cap one pass has, not two. The cap is
   shared by the series and the lengths, so the slots of one length can be filled from either pass, and one series
   can take every slot of the spectrum.
4. Nothing is deduplicated across passes: the same peaks read as b/y and as c/z• give different flanks. They are two
   readings, and each row says which (`ion_series` = `by` or `cz`).
5. The hypothesis merge (#6) and every later step see these rows as one spectrum's rows.

## Outputs

- The tag TSV gains the last column `ion_series` when the metadata pre-scan finds a hybrid MS2 (or an electron
  one, as under `auto`); the census gains `best_ion_series`. A run without hybrid spectra writes what `auto` writes.
- The stderr INFO line gains `, N as b/y and c/z-dot ions (hybrid, two passes)`; the counts `as c/z-dot` and `as
  b/y` then leave these spectra out. The `Hybrid activation:` warning is not printed.
- The run rows of the versioned reports (for example the `-census_out` summary) gain
  `ion_series_hybrid` = spectra read in two passes, of all tagged MS2; `ion_series_by`/`ion_series_cz` do not count
  them. The row is written only under `auto` with `both`.

## Consumers

Each row keeps the series it was read as (`Tag::ion_series`), and every per-row consumer takes its offsets from
that row:

| Consumer | Rule for a hybrid spectrum's rows |
|---|---|
| tag TSV, census TagView, `best_ion_series` | the row's series |
| `-recon_out`, `-recon_id_out`, `-delta_out`, `-massgap_out`, shortlist | TagRecon with the row's ion pair (b/y or c/z•) |
| `-digest_out`, `-label_out` | the row's reversed-read offset (+18.0106 b/y, -15.0347 c/z•) |
| `-alkylation_out` | b/y rows only; c/z• rows are counted as not b/y (`excluded_non_by`) |
| `-species` | b/y rows only, through a per-row flag (`Block::row_series`); the c/z• rows of hybrid spectra are left out and counted in `Ion series: N tag rows read as c/z-dot ions were left out of -species` |
| benchmark scorer (`bench/fastag-bench`, `score.py`) | the row's `ion_series`; rank = file order = merged E-value order |

## What still reads a hybrid spectrum as b/y

Under `both` these steps read a hybrid spectrum once, as b/y (their 1.12 reading). They are not two-pass:

- the precursor hypotheses of `-unknown_charge` and `-isotope_error` (charge and isotope evidence from b/y
  complement pairs only);
- `-check_header_charge` (b/y complement pairs);
- the `-complement_tolerance_unit auto` probe (probes the spectrum with the b/y parameters);
- `-dump_spectrum` (dumps the b/y preparation of the peaks);
- the census diagnostics `n_kept`, `n_edges` and `n_compl` (from the b/y pass; the c/z• pass has none).

## Validation

None yet. The option has no DEV score and no preregistered held-out result. It must not be described as
validated.

- DEV (planned): PXD060724, 6 EThcD runs, truth MSFragger 4.4.1 with b, y, c, z ions at 1% target-decoy FDR;
  endpoint rank-1 tag correct (flank rule, per-row series offset), `auto -ion_series_hybrid both` against `auto`.
- Held-out (planned, not registered): PXD010595 (ProteomeTools ETD runs with supplemental activation on part of the
  spectra). A metadata count (cvParams only, no FASTag run) of its three staged files: ETD on 12,559, 12,893 and
  15,941 spectra, a supplemental beam-type CID (MS:1002678) or supplemental CID (MS:1002679) term 8,021, 8,383 and
  10,320 times; both readers map these terms to EThcD/ETciD, i.e. hybrid. The manifest, PREREG (endpoint, margin, CI rule, scorer sha256) and frozen config go to
  `acceptance/1.13` before any held-out run.

## Tests

- `test/hybrid_ions_test.cpp` (unit): rules (`hybridTwoPass`, `seriesColumn`), `mergeSeriesPasses` order, ties and
  cap; mixed y/z ladders (`CzSynth::Ions::SPLIT`: b/y ions for one half of the cleavage sites, c/z• for the other):
  a b/y-only reading gets none of the c/z• half right, a c/z•-only reading none of the b/y half, two passes get
  both halves in 10 of 10 spectra with the right series; E-values exactly 2x one pass; rank 1 on pure b/y, c/z• and
  b/y + c/z• ladders; TagRecon and digest offsets per row; INFO line; run row.
- `test/hybrid_cli_test.sh` (CLI): the option off equals `auto`, and `auto` equals `by` on a hybrid run; under
  `both`: the column, rows of both series sorted by E-value, the INFO line without the warning, the run row,
  `best_ion_series`, b/y rows with E x 2, exact placements from both readings in the merged rows, the digest call
  (Trypsin), the filter-token run; no change on CID, ETD and MGF input; the ignored-option warning; `-stream`
  refusal; threads 1/3/8; OnDisc reader; `-species` exclusion.
- Mutants (dev, all killed by the two tests): no c/z• pass, no E-value factor, no sort in the merge, `-species`
  with the per-spectrum flag only, no column rule.
