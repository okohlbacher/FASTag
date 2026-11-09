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

## Protease-aware placement (1.13, item 20, experimental)

`-shortlist_protease` (default `trypsin`, the 1.12 behaviour above, byte for
byte) chooses the cleavage rule of the shortlist's placements and of
`-search_config_out`:

- `auto`: the model the protease check calls, when the call is confident
  (Compatible or NonTryptic above); an inconclusive check is Trypsin, as 1.12
  assumes. A call of the `unspecific` model is the unspecific rule.
- `chymotrypsin`, `lys-c`, `arg-c`, `asp-n`, `glu-c`, `lys-n`: that rule.
  When the check calls another protease confidently (a non-trypsin-compatible
  model other than the rule, or a trypsin-compatible model for a rule that is
  not), the hand-off outputs are withheld as in 1.12 (ERROR, exit
  `ILLEGAL_PARAMETERS`) unless `-shortlist_force`; `-shortlist_specificity
  none` is never withheld.
- `unspecific`: every window, never withheld.

With any value but `trypsin` the shortlist's tags are not placed on tryptic
windows. For each occurrence of a tag in the database, the windows are those
whose database flanks match the spectrum's flanks by mass (each also less a
fixed terminal label on its side), inside one ambiguity-free segment
(`ProteomeIndex::windowsByMass`); each goes through the same flank test as a
tryptic placement (`TagReconciler::reconcileByMass`). Only exact and
label-exact placements count, so `-shortlist_gapped` is ignored with a WARN.
After the run the rule is chosen and each placement is kept when OpenMS
`ProteaseDigestion::isValidProduct` accepts its window for the rule's
ProteaseDB enzyme at `-shortlist_specificity` (`full`: both ends at a site or
a protein terminus, an initiator Met may be cleaved; `semi`: one end; `none`:
any) and at most `-recon_missed_cleavages` internal sites. `-recon_out` and
every other placement reader keep their tryptic placements.

| Rule | ProteaseDB enzyme | Sage `cleave_at` / `restrict` / `c_terminal` | Comet (`comet -p` 2026.03.0) |
|---|---|---|---|
| Trypsin | Trypsin | KR / P / true | 1 |
| Lys-C | Lys-C | K / P / true | 3 |
| Arg-C | Arg-C | R / P / true | 5 |
| Asp-N | Asp-N/B | D / null / false | none (its 6 cuts before D and N): needs `-search_config_template` with a `0 D -` entry |
| Glu-C | glutamyl endopeptidase | DE / null / true | 8 (Asp-N_ambic, after D/E) |
| Chymotrypsin | Chymotrypsin | FWYL / P / true | 10 |
| Lys-N | Lys-N | K / null / false | 4 |
| unspecific | (all windows) | "" / null / true | 0 (Cut_everywhere) |

The rules' residues are checked against their ProteaseDB enzymes over all
residue pairs in `cleavage_test`. Glu-C: FASTag's model cuts after E only;
ProteaseDB has no E-only enzyme, so the window test and the engines cut
after D and E (a superset: no window is lost). With a template Comet's enzyme
is looked up in its `[COMET_ENZYME_INFO]` table by rule (sense, cut residues,
no-cut residue), as trypsin is in 1.12; `semi` writes Sage
`"semi_enzymatic": true` and Comet `num_enzyme_termini = 1`. Sage 0.14.7's
behaviour was checked on node data: `cleave_at ""` digests non-specifically
(66,127 peptides on the fixture database against 271 tryptic), `"restrict":
null` lifts the proline rule, `semi_enzymatic` gives 5,045.

The shortlist TSV gets one header line after `# protease:` (only with this
option):
`# placement: <rule>, <specificity> specificity, missed cleavages <= <n>,
windows by flank mass (<why>)`, ending in `; -fasta_out and
-search_config_out withheld` when they were. The log says how many of the
placements by flank mass fit the rule.

Cost: a placement by mass walks at most the flank masses from each
occurrence (a few dozen residues), for the shortlist's tags only (E <=
`-shortlist_max_evalue`); the evidence is filtered once after the run.

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

## Mass shifts as engine configuration (1.12, #17)

`-search_shifts variable|offsets|both` (needs `-search_config_out` and a
database; refused with `-stream`) adds the run's mass-gap peaks to the
configuration above. The peaks are one `FD::gapResult` over the delta
histogram, the same result `-massgap_out` prints (same `-massgap_window`,
`-massgap_min_spectra`, `-massgap_min_share`, `-massgap_min_bin`,
`-massgap_max_mods`), so the export and the report never disagree, and the
histogram runs without `-delta_out`/`-massgap_out` (report-free run). Each
peak's evidence is the sum over the histogram rows it claimed
(`GapPeak::members`): substitution interpretations, localized samples and,
for site expansion, unique localized sites.

Deltas are relative to the peptide with the fixed modifications applied, and
on the labelled side contain a fixed terminal label. Per peak, most spectra
first (ties: smaller |delta|):

0. within `-massgap_window` of n x 1.00335 (n = 1..3) and closer to it than to
   any single modification: `skipped_isotope`; the largest n raises the
   configuration's isotope errors (Sage `isotope_errors`, Comet
   `isotope_error`). Deamidated is exported only when the centroid is closer to
   0.98402 than to 1.00335.
1. a fixed terminal label L: a peak at L is `expected_label`, at -L
   `label_incomplete` (WARN); a peak explained as L + X goes on as X.
2. a fixed residue modification F: a peak at +F becomes the same Unimod name
   on K, H and the peptide N-term where ModificationsDB knows it (the fixed
   residue left out); a peak at -F is `fixed_mod_questionable` (WARN). Without
   a fixed Cys modification, a Cys alkylation peak whose C-containing samples
   are at least half the run's C-containing samples is written as a FIXED
   modification (`fixed`, WARN). Only C-containing samples count, so +57 on
   K, the N-term or a Gly-isobaric truncation does not.
   With `-alkylation_out` (#3g) the run's alkylation call decides instead
   (`ShiftSettings::alkylation_call`): a reagent call becomes the fixed Cys
   modification when the configuration has none, the not-alkylated family
   (`none`) and `no_call` add none, and a peak that would have been `fixed`
   is `deferred_alkylation_call` (WARN). The `-search_shifts_out` header then
   names the call.
3. one modification: a variable modification under its `massgap_mods.tsv`
   id, mass from ModificationsDB (`already_searched` when the configuration
   has it; a SILAC label only when the SILAC call is not `none`, else
   `skipped_silac`). A called SILAC channel is one unit: all its labels (Lys4
   and Arg6, Lys8 and Arg10, or all four for triplex) are variable
   modifications outside `-shift_max_variable`, or, when Comet's 15 slots
   cannot hold them, none is (`dropped_cap`, WARN). A partial channel would
   search one channel's R-peptides but not its K-peptides.
4. a combination, no explanation, or a substitution share above 0.5: a Comet
   mass offset at the 4-decimal centroid minus the run's calibration bias.
   Sage and negative offsets are `dropped_engine`; 0 is always written first
   and not counted. A combination made only of exported SILAC labels is
   `already_searched` (Comet's variable labels cover it, up to 3 per peptide).
   Calibration: a centroid carries the run's precursor mass bias (PXD003531:
   about +0.007 Da on every explained peak), a modification mass does not. The
   bias is the spectra-weighted median of centroid - mass over the peaks one
   modification explains, other than a rule-0 isotope peak (its
   Deamidated reading is the one rule 0 rejects). A bias within the centroid
   resolution (0.00025 Da, half the 0.0005 Da histogram bin) is the binning,
   not the run: it is reported but not applied, so an exact (in-silico)
   offset is exported at its centroid; the `-search_shifts_out` header gives it, the number
   of peaks and the residual (90th percentile of their remaining error), and
   each offset row its centroid. When the residual (or, with no such peak,
   the gap window) exceeds the precursor tolerance at 1000 Da, a WARN says
   Comet can miss the shifted peptides.
5. caps: `-shift_max_variable` (3) peaks as variable modifications,
   `-shift_max_offsets` (10) offsets, at most 15 Comet variable slots with the
   run's own: the rest `dropped_cap`. Under `variable` or `offsets` alone, what
   the mode does not export is `dropped_mode` (under `offsets` rules 2 and 3
   export the gap as an offset).

`-shift_expand_sites` (off; needs `-recon_localize`; unvalidated, so not
recommended) adds a residue to a rule-3 modification when it has at least
`-shift_site_min_count` (10) samples and `-shift_site_min_share` (0.2) of the
peak's counted samples, counting only samples with a unique site
(`loc_ties` 1), at least `-shift_site_min_ions` (2) explaining ions and a
region longer than one residue, and only residues ModificationsDB knows the
name on.

`-search_shifts_out` has `#` header lines (input, database, engine, mode,
settings, counts) and one row per gap peak: `peak`, `delta`, `spectra`,
`explanation`, `action`, `mod_id`, `sites`, `exported` (mass written, `-` for
none), `substitution_share`, `localized`, `reason`.

Limits: an undeclared label shows as a single-modification peak and becomes a
variable modification; more variable modifications can lower sensitivity
(cap 3); Comet's handling of negative offsets and of the offset list is
unverified against the pinned 2026.03.0 binary (as A5-01). Engine acceptance
(Comet and Sage with a shift-carrying configuration) and the held-out protocol
(PSMs, entrapment FDP, recall of an open search's top peaks) run on node data
before this is documented as improving identifications.

## Known limits

- Counts under `-subsample_*` are subsample counts; with `-fasta` the tags are
  filtered before placement. The TSV header says so.
- Placement is tryptic unless `-shortlist_protease` (1.13, experimental) is
  given; see Protease-aware placement.
- Evidence costs about 20 bytes per qualifying placement (E-filtered).
