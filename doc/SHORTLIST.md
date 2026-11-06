# Protein shortlist, reduced FASTA and search hand-off (FASTag 1.12, #5)

Status: **experimental**. The outputs are opt-in and change nothing else: with
none of `-shortlist_out`, `-fasta_out` or `-search_config_out` no new code path
runs, and with them every other output is byte-identical (checked against the
1.11.0 binary by `shortlist_cli_test`). They may be called "recommended" only
after the held-out acceptance in PLAN-handoff.md (three arms x two engines x
seven runs) has passed; until then they are a search-space reduction for
experiments, **not an identification, not protein inference and not
FDR-controlled**. The search engine controls the FDR over the reduced database.

## What counts as evidence

Placement is the `-recon_out` reconciliation (TagReconciler over the tryptic
ProteomeIndex), run whether or not `-recon_out` is written. A reported,
non-entrapment tag with E <= `-shortlist_max_evalue` (provisional 0.1)
contributes each placement that is

- **exact**: both flanks agree; or
- **label-exact**: one flank is off by exactly a fixed terminal modification
  (for example `TMT6plex (N-term)`) within the flank tolerance. The spectrum
  flank carries the label, the database prefix does not, so a correctly
  labelled peptide's N-side gap is the label. It counts as exact. The
  `-recon_out` columns are unchanged.

With `-shortlist_gapped` the remaining one-flank-mismatch placements count as
well (column `gapped_spectra`). A spectrum counts at most once per protein.

## Ranking and selection

Per protein: `spectra`, `peptides` (distinct tryptic windows), `exact_spectra`,
`gapped_spectra`, `weighted` (sum over its spectra of 1 / the number of target
proteins the spectrum hits), `nsaf` (weighted / length) and `best_evalue`.
Sort: spectra, peptides, weighted (descending), best E-value, accession,
database order (ascending). The result does not depend on thread count or
evidence order.

Selection, in order: (1) `spectra >= -shortlist_min_spectra` (provisional 2);
(2) `-shortlist_parsimony`: `none`, `subset` (a protein whose spectra a
higher-ranked kept protein has is `subset_of:<accession>`, after DBReducer's
grouping) or `greedy` (a greedy set cover of the spectra, after MetaNovo;
others `not_in_cover`); (3) `-shortlist_top` with ties at the cut kept
(`beyond_top`); (4) `-shortlist_background` is always kept (`background`):
its entries are appended, except one identical to a database entry, which is
kept as that database entry (written once, in database order) whether or not
the selection kept it. Such an entry's row gets `kept 1`, reason `background`
(a row without rank and evidence when it had none), and the header counts it
("N database entries kept as background").

## Decoys and duplicates

An entry is a decoy when its accession starts with an affix of
`-shortlist_decoy_affix` that ends in `_`, or ends with one that starts with
`_`, case-insensitive (default: OpenMS DecoyHelper's spellings `DECOY_ decoy_
rev_ REV_ reverse_ XXX_ shuffled_ random_` and `_DECOY _rev`). Decoys with
evidence are listed (`decoy`, never kept), take no share of a spectrum's
weight and are never written. DecoyHelper's whole-database heuristic only
reports a target-decoy database, and warns when its affix is missing from the
list. FASTag adds no decoys: the configuration lets the engine generate them
(Sage `generate_decoys`, Comet `decoy_search = 1`).

Identical duplicates (identifier and sequence) count as their first entry; a
conflicting duplicate, in the database or between database and background,
is refused (`INPUT_FILE_CORRUPT`).

## Protease check

Placement windows are tryptic, so the run's tag ends (ungapped, E <= 1, the
`-digest_out` counting) are scored against the shipped protease models (or
`-digest_out`'s table when that report is on) before anything is handed off:

- Trypsin, Lys-C or Arg-C called: proceed;
- inconclusive (Da fragment tolerance, too few tag ends, fewer than 100
  spectra with counted tag ends, a tie, a non-finite score, or another protease
  ahead by less than 0.05 log-likelihood per tag end): WARN, proceed;
- another protease ahead by at least 0.05 per tag end: ERROR; the shortlist is
  written with the call in its header, `-fasta_out` and `-search_config_out`
  are not, and the run exits `ILLEGAL_PARAMETERS`, unless `-shortlist_force`
  (then WARN). The ERROR names only the outputs that were asked for. A run that
  asks for `-shortlist_out` alone withholds nothing: it gets a WARN, the call
  in the shortlist header, and exits 0.

Measured on the public gate inputs (2026-11-07, data): PXD003531, PXD014764
and PXD004541 call Trypsin; PXD040407 (chymotrypsin) calls `unspecific`, 1.44
per tag end ahead, and is refused; PXD010783 (ion trap, Da) is inconclusive.
The 0.05 margin is provisional and is fixed on the dev split with the other
thresholds.

## Reduced FASTA

The database is streamed again and the kept entries are written in database
order as `>identifier description`, the sequence wrapped at 80 columns, then
the background. Identifier, description and sequence round-trip through
`FASTAFile::load`; the original line wrapping is not kept. The file is written
to `<path>.part` and renamed when every write succeeded; on a failure nothing
is left under the name, and no configuration is written.

## Engine configuration

- **Sage** (pinned 0.14.7 for acceptance): a complete JSON configuration:
  trypsin (`KR`, not before `P`), FASTag's `-recon_missed_cleavages`, the
  run's fixed and variable modifications with SageAdapter's term symbols
  (`^` peptide N-term, `$` peptide C-term, `[` protein N-term, `]` protein
  C-term), `-fragment_tolerance`, `-search_precursor_tolerance`,
  `isotope_errors [0, n]`, `decoy_tag` and the run as `mzml_paths`.
- **Comet** (pinned 2026.03.0): the keys FASTag manages, as complete families
  so a template's chemistry cannot survive: every `variable_mod01..15` (unused
  slots `0.0 X 0 3 -1 0 0 0.0`), every `add_*` residue and terminus mass (0.0
  unless set, so Comet's implicit Carbamidomethyl is off unless asked for),
  the fragment bins after CometAdapter (ppm or <= 0.1 Da: bin 2 x tolerance at
  m/z 1000, floored at 0.01, offset 0.0, `theoretical_fragment_ions 0`; else
  1.0005 / 0.4 / 1), precursor tolerance and units, `isotope_error`, trypsin
  and missed cleavages (at most 5), decoys. With `-search_config_template` (a
  `comet -p` file) the keys are merged in: managed lines replaced (inline
  comments kept), missing keys inserted before `[COMET_ENZYME_INFO]`, comments,
  the version header and other keys kept, and the template's enzyme number set
  to its trypsin entry (WARN when it differed; no trypsin entry is refused).
  Without a template a fragment is written whose header says to merge it.
- The database in the configuration is `-fasta_out`, else the input database
  (WARN when that holds decoys, since the engine adds its own).
- MSFragger: backlog.

Engine acceptance (`test/search_engine_smoke_test.sh` with `FASTAG_SAGE_BIN`
and `FASTAG_COMET_BIN`, mandatory with `FASTAG_ENGINES_REQUIRED=1`) runs on
node data before the outputs may be documented as recommended. Until then the
Comet syntax (15 variable slots, the 8-field slot format) follows CometAdapter
and Comet's documentation and is unverified against the pinned binary; the
test template `test/fixtures/comet_template.params` is written in CometAdapter's
layout, not by `comet -p`.

**`-search_engine comet` is unverified.** This is a recorded deviation from
the plan (validation registry A5-01): the plan asks for a real `comet -p`
template from Comet 2026.03.0 as the test fixture, and no pinned Comet binary
is available on the build node yet. The key names in `search_config_test` are
checked against lists taken from OpenMS's SageAdapter and CometAdapter
sources, which is our own reading, not an independent reference (the adapter
test `.ini` files list TOPP parameter names, not engine keys). Not verified
against the binary: the `isotope_error` value for 0..3 (copied from
`-search_isotope_errors`), the 15 `variable_mod` slots and their 8-field
format, an empty or 0-first `mass_offsets`, and how Comet treats negative
offsets. Check a Comet configuration by hand before relying on it.

## Known limits

- Counts under `-subsample_*` are subsample counts; with `-fasta` the tags are
  filtered before placement. The TSV header says so.
- Placement is tryptic. Non-tryptic shortlists wait for #8/#19.
- Evidence costs about 20 bytes per qualifying placement (E-filtered).
