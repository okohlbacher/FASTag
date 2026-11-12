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

Experimental. `-shortlist_protease auto` **passed** its held-out test (see Held-out result at the end of this
section); a named rule, `unspecific` and `-shortlist_specificity semi` or `none` are checked on development runs
only.

`-shortlist_protease` (default `trypsin`, the 1.12 behaviour above, byte for
byte) chooses the cleavage rule of the shortlist's placements and of
`-search_config_out`:

- `auto`: the model the protease check calls, when the call is confident
  (Compatible or NonTryptic above); an inconclusive check is Trypsin, as 1.12
  assumes. A call of the `unspecific` model is the unspecific rule.
  With any value but `trypsin` the check's Asp-N model expects aspartate at
  half of the N-terminal tag ends instead of all (the rest follows the
  background), so Asp-N beats `unspecific` from about 21 % D instead of 50 %
  (post-1.13.1, development runs only, no held-out test yet: 33 to 78 % D in
  four Asp-N digests that are now called, 15 % in a fifth that still calls
  `unspecific`, at most 10 % in 124 runs of other digests with 100 or more
  N-terminal tag ends). `-digest_out` and the default `trypsin` check are
  unchanged.
  An Asp-N call is placed and exported at `semi` specificity unless
  `-shortlist_specificity` is given on the command line (or is `semi` or
  `none` in an INI; an INI's `full` is the default and does not count); the
  placement line says "semi-specific unless -shortlist_specificity is
  given". Every other call keeps `-shortlist_specificity` (default `full`).
  Post-1.13.1, development runs only, no held-out test (numbers under
  Held-out result).
- `chymotrypsin`, `lys-c`, `arg-c`, `asp-n`, `glu-c`, `lys-n`: that rule.
  When the check confidently calls another protease whose cleavage sites do
  not nest with the rule's (one site set within the other, same side, same
  no-cut residue), the hand-off outputs are withheld as in 1.12 (ERROR, exit
  `ILLEGAL_PARAMETERS`) unless `-shortlist_force`. Lys-C (after K) and Arg-C
  (after R) are disjoint, so a Lys-C call withholds `arg-c` and an Arg-C call
  withholds `lys-c`, although both are trypsin-compatible; Trypsin contains
  both, so a Trypsin call with `lys-c` or `arg-c` (or the reverse) is kept
  with a WARN that the engine searches the named rule, not the call.
  `-shortlist_specificity none` is never withheld, and a call of the
  `unspecific` model (no protease fits better than the background;
  PXD040407's chymotrypsin run calls it) names no other protease and does not
  withhold a named rule.
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
no-cut residue), as trypsin is in 1.12. A named rule without an entry (in
the template, or in Comet's own table for Asp-N) is refused before tagging.
With `auto` the rule is known only after the run: a WARN before the run names
the rules without an entry, and if the run calls one of them the tool stops
with ERROR and exit `ILLEGAL_PARAMETERS` and writes neither `-fasta_out` nor
`-search_config_out` (the configuration is made before the FASTA is written,
so the two are written together or not at all). `semi` writes Sage
`"semi_enzymatic": true` and Comet `num_enzyme_termini = 1`. Sage 0.14.7's
behaviour was checked on node data: `cleave_at ""` digests non-specifically
(66,127 peptides on the fixture database against 271 tryptic), `"restrict":
null` lifts the proline rule, `semi_enzymatic` gives 5,045.

The shortlist TSV gets one header line after `# protease:` (only with this
option):
`# placement: <rule>, <specificity> specificity, missed cleavages <= <n>,
windows by flank mass (<why>)`, ending in `; <outputs> withheld` (the
withheld ones of `-fasta_out` and `-search_config_out`) when they were. The log says how many of the
placements by flank mass fit the rule.

Cost: a placement by mass walks at most the flank masses from each
occurrence (a few dozen residues), for the shortlist's tags only (E <=
`-shortlist_max_evalue`); the evidence is filtered once after the run.

### Held-out result (`-shortlist_protease auto`)

**PASS** (`acceptance/1.13/PREREG-nontryptic.md`, branch `acc113r/nontryptic`: freeze 07bd705, results 5dd9d9c;
integration/1.13 at 9365ff1; scored once). 9 runs from 6 PRIDE projects with 5 proteases (Arg-C 1, Asp-N 1, Glu-C 3,
Lys-C 3, chymotrypsin 1); human, FTMS HCD DDA; `-extension 3`, `-shortlist_specificity full`, Sage 0.14.7 on the
exported FASTA and configuration. Reference: Sage on the full human proteome with the true protease, proteins with
at least 2 target PSMs at 1% FDR. Recall is the share of the reference proteins the shortlist keeps.

| criterion | result |
|---|---|
| recall of the `auto` shortlist: median >= 0.20 | median 0.25, mean 0.30 |
| recall, `auto` minus the trypsin shortlist: mean and lower 95% bound > 0 | +0.116 (CI +0.035 to +0.190) |
| `auto` rule equals the true protease in >= 60% of runs | 7 of 9 |
| no aborts | 0 of 9 |

| protease | project | rule under `auto` | recall `auto` | recall trypsin shortlist | Sage speed-up, `auto` export |
|---|---|---|---|---|---|
| Arg-C | PXD059514 | Arg-C | 0.622 | 0.562 | 2.7 |
| Asp-N | PXD064794 | unspecific | 0.253 | 0.008 | 0.25 |
| Glu-C | PXD015759 | Glu-C | 0.072 | 0.001 | 4.8 |
| Glu-C | PXD008333 | Glu-C | 0.057 | 0.000 | 4.4 |
| Glu-C | PXD048926 | Glu-C | 0.506 | 0.004 | 3.9 |
| Lys-C | PXD015759 | Lys-C | 0.246 | 0.234 | 2.4 |
| Lys-C | PXD006465 | Lys-C | 0.341 | 0.343 | 2.1 |
| Lys-C | PXD048926 | Trypsin | 0.463 | 0.463 | 2.3 |
| Chymotrypsin | PXD064794 | Chymotrypsin | 0.101 | 0.000 | 3.9 |

Limits: the gain comes from the Asp-N, Glu-C and chymotrypsin runs, where the trypsin shortlist keeps almost nothing;
on Arg-C and Lys-C the two shortlists are about equal (-0.002 to +0.061). Recall is 0.06 to 0.10 on three runs, and
the median passes its threshold by 0.05. Two calls differ from the truth (Asp-N called unspecific, one Lys-C run
called trypsin); on the run called unspecific the export makes Sage four times slower than the full search (speed-up
had no threshold). Asp-N is represented by one run. A named rule, `unspecific` given by the user and
`-shortlist_specificity semi` or `none` were not tested. The option stays experimental.

After 1.13.1 (development runs only, no held-out test): with the Asp-N call from 21 % D, three Asp-N runs
(PXD064794, PXD068586, PXD051338) are called Asp-N instead of `unspecific`; one (PXD010154, 15 % D) stays
`unspecific`. The Asp-N export makes Sage about twice as fast as the full search on the two larger runs
(13 s against 31 s, 12 s against 30 s; the unspecific export took 162 s and 181 s), and the shortlist keeps fewer
of the full search's proteins: 0.18, 0.19 and 0.57 against 0.25, 0.34 and 0.66. With `-shortlist_specificity semi`
it keeps 0.25, 0.29 and 0.64 at about the time of the full search. When `auto` calls `unspecific`, a WARN says that
the exported search is unspecific and can be slower than a full search; capping the peptide length of that search
(50 to 30, 25, 20 or 16 residues) did not reach the time of the full search without losing identifications, so
there is no cap.

For that reason `auto` exports an Asp-N call semi-specific (`-shortlist_specificity` not given; a named `asp-n`
stays `full`). Development runs only, no held-out test. The three development runs called Asp-N, Sage 0.14.7 with
8 threads on a loaded node (compare within a run); kept = share of the proteins of the full search (Asp-N, at least
2 PSMs at q <= 0.01) in the reduced FASTA:

| run | export | proteins | kept | Sage s | RSS GB |
|---|---|---|---|---|---|
| PXD064794 | unspecific (1.13.1 `auto`) | 309 | 0.25 | 162 | 17.9 |
| | Asp-N, full | 165 | 0.18 | 13 | 0.3 |
| | Asp-N, semi (`auto` now) | 290 | 0.25 | 27 | 1.7 |
| | full search, no shortlist | proteome | 1 | 25 | 2.0 |
| PXD068586 | unspecific (1.13.1 `auto`) | 564 | 0.34 | 181 | 20.8 |
| | Asp-N, full | 136 | 0.19 | 12 | 0.3 |
| | Asp-N, semi (`auto` now) | 395 | 0.29 | 26 | 1.7 |
| | full search, no shortlist | proteome | 1 | 25 | 1.8 |
| PXD051338 | unspecific (1.13.1 `auto`) | 48 | 0.66 | 7.0 | 0.8 |
| | Asp-N, full | 40 | 0.57 | 5.6 | 0.1 |
| | Asp-N, semi (`auto` now) | 46 | 0.64 | 4.6 | 0.2 |
| | full search, no shortlist | proteome | 1 | 6.0 | 0.4 |

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
- **MSFragger** (`-search_engine msfragger`, experimental since 1.13, first held-out
  test FAILED, second test with the shortlist recipe PASSED and that recipe the
  default since, pinned 4.4.1): see "MSFragger configuration" below.

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
format, and an empty or 0-first `mass_offsets`. Comet's handling of negative
offsets has since been checked on the binary (acceptance/1.12
FREEZE-05-17.md, A5-01): Comet 2026.03.0 ignores them. Check a Comet
configuration by hand before relying on it.

## MSFragger configuration (1.13, backlog #18)

**Held-out test: FAIL** (7 runs from 7 PRIDE projects, PREREG-msfragger.md,
scored once on 2026-11-10; FASTag 1.12.2 at 9365ff1, MSFragger 4.4.1). The
search on the exported shortlist FASTA and `fragger.params` was compared with
MSFragger's closed-search defaults on the full human proteome at 1% FDR.
C1 PASS: MSFragger ran on the unedited export in 7 of 7 runs. C2 FAIL: the
shortlist search kept 48.6 to 73.2% of the spectra the full search identified
(median 61.3%; criterion at least 80% in every run). G1 PASS: 2.03 to 3.91
times as fast (median 3.38). G2 FAIL: entrapment FDP 1.27% pooled (limit
1.5%), 2.09% in one run (limit 2.0%). The exported parameters on the full
proteome kept 46 to 82%, the shortlist alone 81 to 95%.

The export of that test wrote `isotope_error 0`. On two development runs
(PXD003531, PXD014764) this was the largest single cause: with MSFragger's
`0/1/2/3` the kept share rose from 47.5 to 72.2% and from 47.3 to 56.3%, at
unchanged speed and an entrapment FDP under 1%. `0/1/2/3` is therefore the
default for MSFragger since then (`-search_isotope_errors -1`; Sage and Comet
keep none). The held-out numbers above describe the export before it; the second
held-out test below covers it.
After 1.13.1 three more values follow MSFragger's own closed defaults when
the engine is msfragger: 2 missed cleavages (`-search_missed_cleavages -1`;
with `-shortlist_protease` other than trypsin the value stays
`-recon_missed_cleavages`), a 20 ppm precursor window
(`-search_precursor_tolerance -1`) and variable protein N-terminal acetylation
(`-search_nterm_acetyl engine`). Measured on nine development runs (the two
above and the seven runs of the held-out test, which is spent), MSFragger
4.4.1, kept share of the full search's identified spectra (mean; lowest run)
and largest per-run entrapment FDP:

| Shortlist options | 1.13.1 export | with the three values |
|---|---|---|
| as in the held-out test | 0.723; 0.563; 2.39% | 0.831; 0.678; 1.63% |
| + `-shortlist_gapped` | 0.766; 0.669; 2.19% | 0.888; 0.846; 1.62% |
| + `-shortlist_gapped -recon_min_length 7` | 0.786; 0.702; 2.48% | 0.911; 0.878; 1.46% |
| + `-shortlist_gapped -recon_min_length 6` | 0.801; 0.710; 2.51% | 0.928; 0.886; 1.57% |
| + `-shortlist_gapped -recon_min_length 6 -shortlist_max_evalue 10 -recon_missed_cleavages 2` (recipe) | not searched | 0.935; 0.888; 1.43% |

Each of the three values raised the kept share on every shortlist. The
shortlist of the held-out configuration reaches 68 to 93% of the full
search's identified spectra (mean 85%); most of the rest has no tag of the
default minimum length 8 on the right protein, or a tag with one flank off by
an isotope or modification mass. `-shortlist_gapped` and a lower
`-recon_min_length` admit these: 95 to 98% (mean 97%) with the recipe of the
last row, at 2.7 times as many proteins (3,594 of 20,414 on average) and a
search time 9% longer. After the second held-out test (below) they are the
defaults under `-search_engine msfragger` with `-search_config_out` and the
tryptic shortlist
(`-recon_min_length` and `-recon_missed_cleavages` then also change
`-recon_out`); Sage and Comet keep 1.13.1's values. MSFragger's mass calibration (`calibrate_mass 2`) and `stricttrypsin`
added nothing on the two first runs and are not exported. All of this was
set on development runs; the entrapment
differences between the rows are within the noise of 8 to 290 entrapment hits
per run.

**Second held-out test: PASS** (10 runs from 10 new PRIDE projects,
PREREG-msfragger2.md on `post1131/msfragger-heldout2`, scored once on
2026-11-11; criteria of the first test). Tested: the export defaults with the
recipe `-shortlist_gapped -recon_min_length 6 -shortlist_max_evalue 10
-recon_missed_cleavages 2`, used unedited. MSFragger ran in 10 of 10 runs
(C1). In the 9 evaluable runs the kept share is 0.833 to 0.976, median 0.934
(C2, at least 0.80 in every run); the search is 1.64 to 4.72 times as fast,
median 2.05 (G1); entrapment FDP 1.07% pooled and at most 1.88% per run (G2,
limits 1.5% and 2.0%; the highest run has 11 entrapment hits, a 12th would
exceed the limit). One run had 10 identifications in the full search and is
not evaluable. The test covers the recipe and the export defaults together,
not each alone. With the default shortlist (informational, no criterion) the
kept share is 0.526 to 0.946, below 0.80 in 5 of 9 runs: the recipe is needed
for this result. The first held-out test (FAIL, above) stays as it was: it
tested the 1.13 export with the default shortlist.

**MSFragger shortlist defaults.** Since this test, `-search_engine msfragger`
with `-search_config_out` and `-shortlist_protease trypsin` (the default)
runs the tested configuration: `-shortlist_gapped` on (a flag: it cannot be
switched off there), `-shortlist_max_evalue 10`, `-recon_min_length 6`,
`-recon_missed_cleavages 2`. Each applies unless the option is given on the
command line, or set in an INI to a value other than its 1.13.1 default (an
INI value equal to that default cannot be told from it, as for
`-shortlist_specificity`). The log line `MSFragger defaults (...)` and the
shortlist header line `# msfragger defaults (...)` name the values applied;
the reconciler's line says `min tag length 6 (msfragger default)`. On the
development run PXD003531 the export without these options is
byte-identical to the one with them. Sage, Comet, a run without
`-search_config_out` and a `-shortlist_protease` other than trypsin (not
tested held-out with these values) keep 1.13.1's values.

`-search_engine msfragger` writes a complete `fragger.params` for MSFragger
4.4.1 (`java -jar MSFragger-4.4.1.jar fragger.params <spectra>`), keys in the
order of the engine's own `--config closed` file
(`test/fixtures/msfragger_4.4.1_closed.params`), one `key = value` per line
and no inline comments: MSFragger 4.4.1 reads a comment that follows the value
after spaces as part of the value, so its own `--config` file stops with
"labile ion type must be one of ..." on `labile_fragment_ion_series`. FASTag's
values:

- precursor: `precursor_mass_lower = -tol`, `precursor_mass_upper = +tol`,
  `precursor_mass_units` (0 Da, 1 ppm) from `-search_precursor_tolerance`
  (20 ppm by default for this engine);
  `precursor_true_tolerance`/`precursor_true_units` are separate keys and are
  set to the same window: MSFragger assigns a PSM's delta to its offset or
  isotope window with them, and with the 20 ppm default and mass offsets
  4.4.1 exits 1 ("Could not find <delta> in the list");
- fragment: `fragment_mass_tolerance`/`fragment_mass_units`; `calibrate_mass 0`
  so the exported tolerances are the ones searched (set 2 for MSFragger's own
  calibration);
- `isotope_error` `0/1/2/3` (MSFragger's own default; FASTag's default since the
  held-out test, see below), or `0/1/../n` for `-search_isotope_errors n`
  (`0` for 0);
- `mass_offsets`: 0 always first, then the `-search_shifts` offsets at 4
  decimals, `/`-separated; negative offsets are kept (Comet's are dropped);
  `localize_delta_mass 1` when offsets are exported, as the file recommends.
  With a Da precursor window FASTag exports no offset: MSFragger 4.4.1 exited
  1 on such a file in FASTag's test even with the true tolerance at the window
  ("Could not find <delta> in the list"). `-search_shifts both` then marks each
  offset `dropped_engine` (the variable modifications are still exported),
  `-search_shifts offsets` is refused; use `-search_precursor_unit ppm`;
- trypsin (`search_enzyme_name_1 trypsin`, cut `KR`, nocut `P`, sense `C`),
  `allowed_missed_cleavage_1` from `-search_missed_cleavages` (2 by default
  with trypsin, else `-recon_missed_cleavages`; at most 5),
  `num_enzyme_termini 2`; with a `-shortlist_protease` other than trypsin
  (item 20) its rule instead: the rule's name in lower case, its cut and
  no-cut residues, sense `C` or `N`, `num_enzyme_termini` 2 (`full`) or 1
  (`semi`); `unspecific` (or `-shortlist_specificity none`) writes
  `search_enzyme_name_1 nonspecific`, cut `@`, empty no-cut, and
  `num_enzyme_termini 0` (with an empty cut MSFragger 4.4.1 ignores the
  whole `_1` enzyme block: it echoed `stricttrypsin` and 2 missed
  cleavages). Checked on node data with MSFragger 4.4.1 on the in-silico
  chymotryptic MGF: it echoes the exported chymotrypsin rule (474 peptides
  from the reduced FASTA) and `nonspecific` (87,087 peptides);
- variable modifications in `variable_mod_01..16` (only the used slots; the
  default file's entries are not kept; protein N-term Acetyl is added unless
  `-search_nterm_acetyl no`):
  `<mass> <site> <max>`, site the residue, `n^`/`c^` a peptide terminus,
  `[^`/`]^` a protein terminus, `nQ`/`[M` a terminus on one residue; max 3
  on residues, 1 on termini. More than 16 is refused; `-search_shifts` caps at 16;
- fixed modifications as `add_*` (every key written, 0.0 unless set, so the
  default file's `add_C_cysteine 57.02146` is off without a fixed CAM). A fixed
  terminal modification on one residue, and fixed modifications on MSFragger's
  user amino acids (B, J, O, U, X, Z), are refused;
- `decoy_prefix` `rev_` (Philosopher/FragPipe), or `-search_decoy_prefix`;
  `num_threads` from `-threads` (an explicit `-threads n` writes n; FASTag's
  default `-threads 0` writes 0, which MSFragger reads as every CPU, so give
  `-threads` on a large shared node); every other key keeps the
  `--config closed` default.

**Decoys.** MSFragger generates none (`decoy_prefix` is "used for parameter
optimization only"); its FDR tools need them in the database. With
`-fasta_out` and `-search_engine msfragger`, FASTag appends one decoy per
written entry (database entries and background), after all of them:
identifier `<prefix><identifier>`, the same description, the sequence
reversed whole (DecoyDatabase `-method reverse`, Philosopher). The log says
"N entries and N reversed decoys". Sage and Comet `-fasta_out` are unchanged
(no decoys). Without `-fasta_out` the input database is named, and it must be
a target-decoy database: at least 40 % of its entries start with the prefix
(DecoyHelper's rule, case-sensitive as in MSFragger); otherwise refused.

**Verification.** `msfragger_config_test` compares the file with MSFragger
4.4.1's own `--config closed` key set and with the parameters MSFragger
printed ("Parameters:") and wrote into its pepXML (`<aminoacid_modification>`,
`<terminal_modification>`) when it ran a golden plan with seven variable
modifications of every site kind, two fixed ones, a positive and a negative
offset and isotope errors 0..2
(`test/fixtures/msfragger_4.4.1_echo.txt`, recorded on node data
2026-11-09): every managed value must equal what MSFragger read, and every
modification must be modelled on the site OpenMS gives it. With
`FASTAG_MSFRAGGER_JAR`, `search_engine_smoke_test` runs MSFragger on the
fixture (20 target PSMs in the first run, prsA/metK/rplF found) and checks
the echoed parameters again. `msfragger_cli_test` covers the decoys, the
refusals and `-search_shifts` with MSFragger.

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
   The same test applies in the frame of a fixed terminal label L (TMT): a
   peak at L + n x 1.00335 is `skipped_isotope` and raises the isotope errors
   (up to the 1.13 held-out test it became a Comet offset near n x 1.0034
   and Sage did not search it).
1. a fixed terminal label L: a peak at L is `expected_label`, at -L
   `label_incomplete` (WARN); a peak explained as L + X goes on as X (to
   rules 2 to 4; rule 0 is not applied to X, see above).
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
(cap 3). Comet 2026.03.0 ignores negative mass offsets (checked on the DEV
run, acceptance/1.12 FREEZE-05-17.md), so dropping them loses nothing Comet
could search; negative shifts reach Comet only as variable modifications.

First held-out test (1.13, acceptance/1.13 `PREREG-item17.md`, `RESULT-item17.md`,
scored once). Closed search with the run's declared chemistry vs the same
search plus `-search_shifts` (defaults), Sage 0.14.7 and Comet 2026.03.0,
shuffled entrapment at r = 1, 1 % PSM FDR, on PXD014764 (SILAC), PXD004541
(TMT10), PXD000001 (TMT6) and PXD063151 (label-free):

| Run | Comet PSMs | Sage PSMs |
|---|---|---|
| PXD014764 | 4224 -> 5979 (+41.6 %) | 4738 -> 6196 (+30.8 %) |
| PXD004541 | 10079 -> 15053 (+49.4 %) | 11186 -> 11518 (+3.0 %) |
| PXD000001 | 1116 -> 1133 (+1.5 %) | 1258 -> 1258 (0) |
| PXD063151 | 34941 -> 43101 (+23.4 %) | 46530 -> 55805 (+20.0 %) |

The identification gain (>= 2 % on 3 of 4 runs) and the no-loss criterion
pass for both engines. The no-loss criterion (P3) is a net count,
PSMs(cand) >= 0.99 x PSMs(base); it does not see base identifications that
the candidate search loses while it adds others. As a secondary measure (no
criterion), the candidate search lost up to 10.1 % of the base-identified
scans with Comet (PXD063151; 3.8 % on PXD014764, 2.1 % on PXD004541) and up
to 1.3 % with Sage (PXD063151). The test FAILED: an MSFragger open search's
top mass shifts were recovered on only 1 of 4 runs (Comet) and 0 of 4 (Sage);
Comet's one pass (PXD063151, 7 of 10 peaks) rests on three matches between
near-zero or near-isotope open-search peaks (0.062, 0.948, 1.064) and offsets
consistent with a precursor calibration error, without which it is 4 of 10
(post-hoc note in RESULT-item17.md; the verdict is FAIL either way), and
Sage's entrapment FDP exceeded 1.5 % on three runs (its closed search already
did on PXD000001). Known causes: on labelled runs the isotope rule was not
applied to the label-frame remainder (L + 1.003 became a Comet offset, and
Sage searched no isotope errors; fixed after the test, see rule 0, checked on
development data only); near-zero offsets on a run with a precursor
calibration error widen the search instead; most of the open search's top
shifts are not among the run's mass-gap peaks at all. The option stays
experimental.

Second held-out test (1.13, branch `acc113r/shifts`: `PREREG-item17r.md`,
`RESULT-item17r.md`, scored once; four new public runs, build with the rule 0
fix). Same design with relaxed criteria (entrapment FDP at most base + 0.3
points and at most 2.0 %; at least 60 % of the admissible open-search peaks
recovered on at least 3 runs). **FAIL**: Comet on P2 and P4, Sage on P4.
Target PSMs at 1 % FDR base -> candidate, entrapment FDP base -> candidate,
peaks recovered / admissible:

| Run | Comet PSMs | Comet FDP % | Comet peaks | Sage PSMs | Sage FDP % | Sage peaks |
|---|---|---|---|---|---|---|
| PXD049248 label-free | 11979 -> 13081 (+9.2 %) | 0.90 -> 0.96 | 1 / 10 | 15754 -> 17423 (+10.6 %) | 0.96 -> 0.96 | 1 / 3 |
| PXD065251 SILAC | 27494 -> 29607 (+7.7 %) | 1.14 -> 0.95 | 2 / 7 | 29384 -> 31280 (+6.5 %) | 1.12 -> 1.13 | 0 / 1 (not evaluable) |
| PXD037999 TMT10 | 7469 -> 10215 (+36.8 %) | 0.88 -> 1.28 | 1 / 8 | 8451 -> 10582 (+25.2 %) | 1.04 -> 0.98 | 1 / 3 |
| PXD073763 TMTpro | 13321 -> 14747 (+10.7 %) | 1.31 -> 1.16 | 1 / 7 | 14195 -> 16074 (+13.2 %) | 1.18 -> 1.08 | 1 / 4 |

- P1 (gain of at least 2 % on at least 3 runs) and P3 (net PSM count) pass on
  4 of 4 runs for both engines. The candidate search lost 0.8 to 3.7 % of the
  base-identified scans with Comet and 0.3 to 2.6 % with Sage (no criterion).
- P2 fails for Comet on the TMT run PXD037999: entrapment FDP 0.88 -> 1.28 %
  (+0.40 points; limit +0.30). Entrapment hits rose from 33 to 66 while
  targets rose from 7469 to 10215. The shifts exported on this run are
  variable TMT6plex on H and on the peptide N-terminus. The development run
  PXD003531 showed the same rise (0.91 -> 1.34 %). Sage shows none. The cause
  is not diagnosed.
- Part of the gain is the isotope error setting: the base search uses isotope
  error 0 and the option sets 0..1 on three of the four runs, which a
  standard engine setting also gives. On Sage PXD065251 the only new masses
  are Met-loss+Acetyl and the 13C error (+1896 PSMs). The gain over a base
  search with the same isotope errors was not measured.
- P4 fails on every evaluable run. Of the admissible open-search peaks the
  option recovered 5 of 32 with Comet (9 are among the run's mass-gap peaks,
  6 were exported) and 3 of 11 with Sage (5 among the mass-gap peaks). The
  peaks that are not mass-gap peaks include catalogued modifications
  (Acetyl, ammonia and water loss, Na, K).

The test compared the option on against off; it did not measure the rule 0
fix. `-search_shifts` does not replace an open search. With Comet on
labelled data, check the error rate of the additional PSMs. The option stays
experimental.

## Known limits

- Counts under `-subsample_*` are subsample counts; with `-fasta` the tags are
  filtered before placement. The TSV header says so.
- Placement is tryptic unless `-shortlist_protease` (1.13, experimental) is
  given; see Protease-aware placement.
- Evidence costs about 20 bytes per qualifying placement (E-filtered).
