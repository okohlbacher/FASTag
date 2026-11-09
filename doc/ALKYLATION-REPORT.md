# The -alkylation_out report (format 1)

FASTag 1.12 (#3g). `-alkylation_out <tsv>` says which reagent alkylated the
cysteines of a run, or that they are not alkylated. The call is read off the
placements the run's own reconciler makes (src/TagRecon.h); there is no second
index. The option is opt-in, and every other output (tags, `-recon_out`
including `delta_interp`, `-delta_out`, `-massgap_out`, `-digest_out`,
`-label_out`, species) is byte-identical with and without it.

**Not validated on held-out data.** The thresholds are the plan's priors
(PLAN-organism-chemistry.md, #3g); they are frozen only after the DEV
regeneration on the release candidate and PREREG-chem.md.

This file is the contract for readers of the report (the GUI Overview
alkylation tile, GUI-DESIGN.md P2b, and prose-auto). It is versioned by the row
`alk_run format`.

## File format

The long-form report family of `-digest_out`, `-label_out` and `-massgap_out`
(`FASTag::Digest::writeReport`): UTF-8, tab-separated, one header line

```
section	key	value	n	description
```

then one row per line, always five fields, none empty. `-` stands for "no
value". Numbers are written by `FASTag::Digest::num` (shortest round-trip
decimal, `FASTAG_FULL_PRECISION=1` widens them). Windows writes CRLF.

A reader must look rows up by `(section, key)`, never by line number, and
ignore rows and sections it does not know. Each `(section, key)` appears once.

The file is written to `<path>.part` and renamed when complete, so a reader
never sees a partial report. A refused or failed run leaves no file.

## Sections, in this order

### `run` (shared run rows)

The versioned run rows every 1.12 report starts with
(`FASTag::RunReport::runRows`, `Emit::Versioned`, src/RunMeta.h): the seven
FASTag 1.11 rows (`version`, `input`, `fragment_tolerance`,
`fragment_tolerance_unit`, `tag_length`, `subsample_fraction`,
`subsample_spectra`), then `run_report_version`, then the cluster rows of that
version. Their format is owned by RunMeta and numbered by
`run_report_version`, independently of `alk_run format`.

### `alk_run` (settings and what was looked at)

| key | value | n |
|---|---|---|
| `format` | `1`, the format of the `alk_*` and `alkylation_call` sections | `-` |
| `database` | path of the FASTA the placements are on | `-` |
| `database_source` | `recon_fasta`, `fasta` (the run's placement database), `proteome` (an `-alkylation_proteome` FASTA) or `bundled:<name>` (`human`, `mouse`, `yeast`, `ecoli`) | `-` |
| `database_release` | only for `bundled:<name>` with a `proteomes.tsv` beside it (1.13): `UniProt <release> <proteome> (taxon <id>, reviewed, <n> entries, sha256 <hash>)`; absent otherwise, so a report on a FASTA path is that of 1.12 | `-` |
| `fixed_c_delta` | the run's fixed modification mass on C in Da (`0` without one); reagent mass = gap + this | `-` |
| `fixed_nterm_delta` | the run's fixed peptide N-terminal modification mass in Da (a TMT or iTRAQ label; `0` without one), taken off an N-side gap first | `-` |
| `fixed_cterm_delta` | the same for a fixed peptide C-terminal modification | `-` |
| `window` | bin window in Da (`-alkylation_window`; default 0.02 on a ppm run, 0.5 on a Da run) | `-` |
| `min_spectra` | `-alkylation_min_spectra` | `-` |
| `min_share` | `-alkylation_min_share` | `-` |
| `tags` | placed tags looked at (ungapped, E-value <= 1, as the digest report counts) | `-` |
| `spectra` | MS2 spectra that vote (have a tag with a counted placement) | `-` |

### `alk_cys` (votes and exclusions)

Each spectrum votes once, with its best tag (lowest E-value) that has a counted
placement.

| key | value | n |
|---|---|---|
| `Carbamidomethyl`, `Propionamide`, `Nethylmaleimide`, `Methylthio`, `Carboxymethyl`, `unmodified`, `Oxidation`, `Dioxidation`, `Trioxidation`, `Cysteinyl`, `Dehydroalanine` (11 rows, this order) | spectra whose counted placements all bin to this Cys form | binned spectra (sum of the `class.*` values) |
| `class.Carbamidomethyl`, `class.Propionamide`, `class.Nethylmaleimide`, `class.Methylthio`, `class.Carboxymethyl`, `class.none` (6 rows, this order) | spectra of this call class; `none` is the "not alkylated" family (unmodified, Cys oxidation, di-, trioxidation, cysteinylation, dehydroalanine) | binned spectra |
| `unexplained` | voting spectra whose reagent mass no form explains within the window | `spectra` |
| `conflict` | voting spectra whose best tag's counted placements disagree on the class | `spectra` |
| `excluded.no_cys`, `excluded.multi_cys`, `excluded.cys_in_tag`, `excluded.cys_outside_region`, `excluded.protein_nterm`, `excluded.truncation`, `excluded.met_ambiguous` (7 rows, this order) | placements (not spectra) left out by that rule | all placements evaluated |
| `excluded.non_by` (last `alk_cys` row) | tags (not placements) left out because they are not b/y tags (c/z, #15 phase B); `0` until c/z tagging exists | `alk_run tags` + this value |

A form row counts a spectrum only when all its counted placements agree on the
form; two family forms (say unmodified and Oxidation) still count for
`class.none`. So the form rows of a class can sum to less than its `class.*`
row.

Form masses come from OpenMS ModificationsDB (Unimod): `Carbamidomethyl (C)`,
`Propionamide (C)`, `Nethylmaleimide (C)`, `Methylthio (C)`,
`Carboxymethyl (C)`, `Oxidation (C)`, `Dioxidation (C)`, `Trioxidation (C)`,
`Cysteinyl (C)`, `Cys->Dha (C)`; `unmodified` is 0.

Placement rules (src/AlkylationCall.h): the peptide has exactly one C, outside
the tag; an exact placement counts with gap 0. A fixed terminal label is in the
spectrum flank but not in the database prefix (src/TagRecon.h,
`setFixedTermMods`), so a gap on the labelled side is first reduced by
`fixed_nterm_delta` (or `fixed_cterm_delta`), the rule of
`Shortlist::classifyPlacement`: a rest within the window makes the placement
label-exact (it counts like an exact one, the C on either side), otherwise the
rest is the gap and reagent = rest + `fixed_c_delta`. Otherwise a gapped placement counts only
when the C is on the gap side, the gap side is not the protein N-terminus, and
the gap is not the mass of the one or two outermost residues of the gap side
(a shorter non-specific product). With an M on the gap side, the reading with
and without Met oxidation (+15.995) must fall into one class.

### `alkylation_call` (the call; always these five rows, this order)

| key | value when called | value on no_call | n |
|---|---|---|---|
| `status` | `call` | `no_call` | binned spectra |
| `reagent` | the class: `Carbamidomethyl`, `Propionamide`, `Nethylmaleimide`, `Methylthio`, `Carboxymethyl` or `none` | `-` | spectra of the class (call) or `-` |
| `mass` | the reagent's mass on C in Da; `-` for `none` | `-` | `-` |
| `share` | class spectra / binned spectra | the leading class's share, `-` when nothing is binned | binned spectra |
| `reason` | `-` | `few_cys_spectra` or `ambiguous` | `-` |

Rule: the class with the most binned spectra is called when the binned spectra
and its own spectra are both at least `min_spectra` and its share is at least
`min_share`. Fewer binned spectra than `min_spectra` is `few_cys_spectra`; a
tie for the lead, or a leader short of `min_spectra` or `min_share`, is
`ambiguous`.

A reader that only wants the call reads `alkylation_call status`, `reagent`
and `share`, and `alk_run database_source` for the caveat.

## Stability

- Format 1 is frozen from the 1.12.0 release on (the rows `fixed_nterm_delta`,
  `fixed_cterm_delta` and `excluded.non_by` were added before it). Any change to a section name, a key, the order of rows,
  the meaning or formatting of a `value` or `n`, or a new row, bumps
  `alk_run format` (`FASTag::Alkylation::kReportFormat`) and this file.
- The `description` column is for people. Its wording may change within a
  format; no reader may parse it.
- The section names never collide with the other reports: `run` and `cys`
  belong to `-massgap_out`, `call` to `-digest_out`. gui/src/digestReport.ts
  classifies by section name, so an alkylation report is never read as a
  digest, label or mass-gap report.
- The `run` rows follow RunMeta's own versioning (`run_report_version`).

## Options

| option | default | |
|---|---|---|
| `-alkylation_out <tsv>` | off | the report; refused with `-stream`, guarded against overwriting inputs and other outputs |
| `-alkylation_proteome` | `auto` | database without `-recon_fasta`/placement readers: `auto` (= `human`), `human`, `mouse`, `yeast`, `ecoli` (shipped UniProt 2026_04 reference proteomes, reviewed entries: `<bin>/../share/FASTag/alkylation/<name>.fasta.gz` or `$FASTAG_ALKYLATION_DIR`; see Shipped proteomes), or a FASTA file (`.gz` allowed). Ignored with a warning when `-recon_fasta` is given or another placement reader runs |
| `-alkylation_min_spectra` | 10 | |
| `-alkylation_min_share` | 0.6 | |
| `-alkylation_window` | 0 (= 0.02 Da on ppm runs, 0.5 Da on Da runs) | |

`-delta_out`, `-massgap_out` and `-recon_localize` still require `-recon_out`
(or a #5 hand-off output); `-alkylation_out` alone does not satisfy them.

`auto` takes the human proteome. The plan's "top `-species` genus" needs the
species call before the tagging loop that places the tags, so it is not
implemented.

## Merge obligations (integration/1.12)

Recorded here so the integrator of D#3g finds them beside the format:

- **E#6 (precursor hypotheses, merges first).** Every aggregating consumer
  reads only the selected hypothesis (PLAN-INTEGRATION 2.3 contract 1). The
  D#3g consumer in `tag_one` is one gate and two calls: edit the gate to
  `alk_tag = alkylation_on && sel && Alkylation::countsTag(t.gapped, t.evalue)`
  (this also stops losing hypotheses being placed in alkylation-only mode);
  `Alkylation::addTag` and `Alkylation::addSpectrum` stay as they are. Add a
  digest_cli_test (or charge_cli_test) case under `-unknown_charge enumerate`
  or `-isotope_error`: `alk_run tags` equals a recount of the selected,
  ungapped, E <= 1 rows, and `-alkylation_out` is identical at defaults with
  and without E#6's options.
- **A#17 (`-search_shifts`, merges before D#3g).** `ShiftSettings::alkylation_call`
  is fed from the Call computed right after the per-thread merge (FASTag.cpp,
  "the alkylation call (#3g), once, right after the merge"), which is before
  the hand-off exports: pass the reagent name, or `none` / `no_call`, when
  `-alkylation_out` is set. `-alkylation_out` writes the same Call. Add the
  digest_cli_test case A#17 asks for: `-alkylation_out` with `-search_shifts`
  writes no `fixed` row that contradicts the call, and a no_call writes
  `deferred_alkylation_call`.
- **E#15B (c/z tags, merges last).** Contract 2: c/z tags do not vote. In
  `tag_one`, a c/z tag (`tag_cz`) that passes `countsTag` goes to
  `pt.acc.d.alk.excludeNonBy()` instead of `addTag`, and is not placed for the
  call. Add a CLI check under `-ion_series cz` (or `auto` on an electron run):
  `alk_cys excluded.non_by` equals the c/z rows the TSV writes with E <= 1,
  ungapped, and the binned counts equal a run without them.

## Shipped proteomes

Since 1.13 (backlog item 24) FASTag ships the reviewed (Swiss-Prot) entries of
four UniProt reference proteomes, release 2026_04, in `data/alkylation/`,
installed to `share/FASTag/alkylation` (flat release layout:
`share-FASTag-alkylation`, beside `share-FASTag-digest`):

| name | proteome | taxon | entries | gz size |
|---|---|---|---|---|
| `human` (`auto`) | UP000005640 | 9606 | 20,414 | 7.5 MB |
| `mouse` | UP000000589 | 10090 | 17,279 | 6.6 MB |
| `yeast` | UP000002311 | 559292 | 6,067 | 2.0 MB |
| `ecoli` | UP000000625 | 83333 | 4,403 | 1.0 MB |

`tools/fetch_proteomes.sh <dir>` downloads them from the UniProt REST API and
writes `proteomes.tsv` (name, proteome, taxon, release, release_date, entries,
sha256 of the `.gz`, sha256 of the FASTA, file). `data/alkylation/README.md`
records the release, the hashes and the CC BY 4.0 notice; BOM.md has the row.

Lookup: `$FASTAG_ALKYLATION_DIR`, else the directory `alkylation` beside the
digest data directory (`$FASTAG_DIGEST_DIR`, `<bin>/../share/FASTag/digest`,
`<bin>/share-FASTag-digest` or `<bin>/digest`). When the directory holds
`proteomes.tsv`, the name's row gives the file, and FASTag

- refuses a manifest without a valid row for the name (the nine columns, a
  positive entry count, a release, a plain file name, one row per name) with
  exit code 3 (INPUT_FILE_CORRUPT);
- refuses a file whose entry count differs from the row (a truncated or
  replaced file) with exit code 3, before any output is written;
- writes the `database_release` row.

A directory without `proteomes.tsv` (one's own `FASTAG_ALKYLATION_DIR`) is
read as in 1.12: `<name>.fasta.gz`, no `database_release` row. A missing file
still stops with exit code 6 (ILLEGAL_PARAMETERS) and the message
`no shipped <name> proteome found`; that is now only the case for a build or
copy without `share/FASTag/alkylation`.

The names apply to `-alkylation_proteome` only. `-recon_fasta` stays a FASTA
file parameter: accepting names there would change its registered type (the
TOPP existence check, the INI/CTD and the GUI file picker) and every reader of
that database (shortlist, digest background, mass gaps), which is not part of
this item. The shipped files are gzip-compressed, and the `-recon_fasta`
readers read plain FASTA only.

`proteomes_cli_test` checks the manifest against the files (hashes, entries,
every header a reviewed entry of the taxon, a known protein each), resolves
every name in the installed and the flat layout and through
`FASTAG_ALKYLATION_DIR`, and checks the refusals. CI checks the shipped Linux,
macOS and Windows bundles with `-alkylation_out` at the default `auto`.
