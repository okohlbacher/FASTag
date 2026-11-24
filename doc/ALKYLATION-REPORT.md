# The -alkylation_out report (format 4)

`-alkylation_out <tsv>` says which reagent alkylated the cysteines of a run, or
that they are not alkylated. **It needs no protein database.** The call is read
off the C residues in the run's tags: the method of `-alkylation_tags_out`
(1.13 #22, held-out test passed at the margin; section `-alkylation_tags_out`
below). With a database it also makes the 1.12 placement call (#3g): it reads
the placements the run's own reconciler makes (src/TagRecon.h) of peptides with
one C, and checks the tag call against them. The option is opt-in, and every
other output (tags, `-recon_out` including `delta_interp`, `-delta_out`,
`-massgap_out`, `-digest_out`, `-label_out`, species) is byte-identical with and
without it.

**Format 2 (feedback 202dbcf4).** Up to format 1 the call came from the
placements only, and without `-recon_fasta` the default
`-alkylation_proteome auto` placed on the shipped human proteome, which needs
tags of 8 residues. A sample that is not human, or a run with shorter tags, got
no call; a FASTag without the shipped proteome stopped with exit code 6. Now:

| given | database | call |
|---|---|---|
| nothing (`auto`, the default) | none | the tags (`alk_run method tags`, `database_source none`) |
| `-recon_fasta`, or another report that places tags | `-recon_fasta`, else `-fasta` | tags and placements |
| `-fasta` (only `-alkylation_out` places) | `-fasta` | tags and placements |
| `-alkylation_proteome human\|mouse\|yeast\|ecoli\|<fasta>` | that proteome | tags and placements |

**Format 4 (release-gate review n1).** A vote whose C edge an alias reads as
well (G + C for Carbamidomethyl, A + C for Propionamide, ...) and whose
spectrum shows no trace of the alias (both middle peaks lost, in b and y, or
removed by the peak selection) counts only when the spectrum holds the C
immonium ion of its form (133.043 for Carbamidomethyl; below, "Independent
evidence"). Without it the vote abstains: `alkt_form alias_unconfirmed` (new
row), not in the share. The two readings have one mass, so in format 3 such a
vote counted for the reagent with nothing to tell it from the unmodified
reading.

**Format 3 (review of 1.13, n1 to n3).** Three changes to the call, all in the
reported counts:
- a conflicted vote counts against the share: share = class votes /
  (binned + conflicted), the new row `voted` gives that denominator, and the
  share row's `n` is it (before, 10 CAM votes and 90 conflicts were a share of
  1.0 and a call; now 0.1, `ambiguous`);
- the twin guard of the tag call applies per vote, with the edge windows the
  tagger used at the C edge's own m/z, not once per run at 1000 m/z
  (`alkt_run resolved_below_mz`, `alkt_form unresolved`);
- each C edge of a voting tag is checked against the spectrum for the
  two-residue and 13C readings of its mass (`alkt_form alias_rejected`).

The held-out and development numbers below were measured with format 2: without
the alias check, without the per-vote twin guard, with conflicts outside the
share and without the immonium rule of format 4. They have not been measured
again; the three runs measured with format 4 are under "Independent evidence".

**What a call means.** The tag call passed a held-out test at the margin (40 of
57 runs called, 37 right); it rarely calls unalkylated samples. The placement
call is not validated on held-out data: its thresholds are the plan's priors
(PLAN-organism-chemistry.md, #3g). How the two are combined (below) is a rule
of this version, not a measured one.

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

`run`, `alk_run`, then with a database `alk_cys` and
`alkylation_placement_call`, then `alkt_run`, `alkt_form`,
`alkylation_tags_call` (the tag sections, as `-alkylation_tags_out` writes
them), then `alkylation_call`.

### `run` (shared run rows)

The versioned run rows every 1.12 report starts with
(`FASTag::RunReport::runRows`, `Emit::Versioned`, src/RunMeta.h): the seven
FASTag 1.11 rows (`version`, `input`, `fragment_tolerance`,
`fragment_tolerance_unit`, `tag_length`, `subsample_fraction`,
`subsample_spectra`), then `run_report_version`, then the cluster rows of that
version. Their format is owned by RunMeta and numbered by
`run_report_version`, independently of `alk_run format`.

### `alk_run` (settings and what was looked at)

Without a database, `alk_run` has six rows: `format`, `method` (`tags`),
`database` (`-`), `database_source` (`none`), `min_spectra`, `min_share`.
With a database it has all of these rows:

| key | value | n |
|---|---|---|
| `format` | `3`, the format of the `alk_*`, `alkylation_placement_call` and `alkylation_call` sections | `-` |
| `method` | `tags` (no database) or `tags+placement` | `-` |
| `database` | path of the FASTA the placements are on; `-` without one | `-` |
| `database_source` | `none` (no database), `recon_fasta`, `fasta` (the run's placement database, or `-fasta` with `auto`), `proteome` (an `-alkylation_proteome` FASTA) or `bundled:<name>` (`human`, `mouse`, `yeast`, `ecoli`) | `-` |
| `database_release` | only for `bundled:<name>` with a `proteomes.tsv` beside it (1.13): `UniProt <release> <proteome> (taxon <id>, reviewed, <n> entries, FASTA sha256 <hash>)`, the hash being the manifest's `fasta_sha256`, which the FASTA read was checked against before the run; absent otherwise, so a report on a FASTA path is that of 1.12 | `-` |
| `min_tag_length` | only with `database_release` (1.13): the reconciler's minimum tag length on the database (`-recon_min_length`, else derived from its size); shorter tags do not place | the run's longest tag (seed length + 2 x `-extension`) |
| `fixed_c_delta` | the run's fixed modification mass on C in Da (`0` without one); reagent mass = gap + this | `-` |
| `fixed_nterm_delta` | the run's fixed peptide N-terminal modification mass in Da (a TMT or iTRAQ label; `0` without one), taken off an N-side gap first | `-` |
| `fixed_cterm_delta` | the same for a fixed peptide C-terminal modification | `-` |
| `window` | bin window in Da (`-alkylation_window`; default 0.02 on a ppm run, 0.5 on a Da run) | `-` |
| `min_spectra` | `-alkylation_min_spectra` (both calls) | `-` |
| `min_share` | `-alkylation_min_share` (both calls), a share of the binned and conflicted spectra | `-` |
| `tags` | placed tags looked at (ungapped, E-value <= 1, as the digest report counts) | `-` |
| `spectra` | MS2 spectra that vote (have a tag with a counted placement) | `-` |

### `alk_cys` (votes and exclusions; with a database only)

Each spectrum votes once, with its best tag (lowest E-value) that has a counted
placement.

| key | value | n |
|---|---|---|
| `Carbamidomethyl`, `Propionamide`, `Nethylmaleimide`, `Methylthio`, `Carboxymethyl`, `unmodified`, `Oxidation`, `Dioxidation`, `Trioxidation`, `Cysteinyl`, `Dehydroalanine` (11 rows, this order) | spectra whose counted placements all bin to this Cys form | binned spectra (sum of the `class.*` values) |
| `class.Carbamidomethyl`, `class.Propionamide`, `class.Nethylmaleimide`, `class.Methylthio`, `class.Carboxymethyl`, `class.none` (6 rows, this order) | spectra of this call class; `none` is the "not alkylated" family (unmodified, Cys oxidation, di-, trioxidation, cysteinylation, dehydroalanine) | binned spectra |
| `unexplained` | voting spectra whose reagent mass no form explains within the window | `spectra` |
| `conflict` | voting spectra whose best tag's counted placements disagree on the class; they count against the share (format 3) | `spectra` |
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

### `alkylation_placement_call` (the placement call; with a database only; these six rows, this order)

The `alkylation_call` of format 1, renamed; format 3 adds `voted`.

| key | value when called | value on no_call | n |
|---|---|---|---|
| `status` | `call` | `no_call` | binned spectra |
| `reagent` | the class: `Carbamidomethyl`, `Propionamide`, `Nethylmaleimide`, `Methylthio`, `Carboxymethyl` or `none` | `-` | spectra of the class (call) or `-` |
| `mass` | the reagent's mass on C in Da; `-` for `none` | `-` | `-` |
| `share` | class spectra / (binned + conflicted spectra) (format 3; up to format 2 / binned spectra) | the leading class's share, `-` when nothing is voted | binned + conflicted spectra (format 3) |
| `voted` (format 3) | binned + conflicted spectra, the share's denominator | the same | binned spectra |
| `reason` | `-` | `few_cys_spectra`, `ambiguous` or (shipped proteome only, 1.13) `tags_too_short` | `-` |

Rule: the class with the most binned spectra is called when the binned spectra
and its own spectra are both at least `min_spectra` and its share of the
binned and conflicted spectra (`voted`) is at least `min_share`. Unexplained
spectra (`alk_cys unexplained`, a reagent mass no form explains) are not in
the denominator. Fewer binned spectra than `min_spectra` is `few_cys_spectra`; a
tie for the lead, or a leader short of `min_spectra` or `min_share`, is
`ambiguous`. On a shipped proteome (1.13), a no_call whose longest tag is
shorter than `alk_run min_tag_length` is `tags_too_short` instead: no tag could
place, which says nothing about the run's Cys spectra. The other database
sources keep the 1.12 reasons (and the log warns there too).

### `alkylation_call` (the call of the report; always these seven rows, this order)

| key | value |
|---|---|
| `status`, `reagent`, `mass`, `share`, `voted`, `reason` | as in `alkylation_placement_call`, of the call named in `source`; `n` counts votes (tags) or binned spectra (placements), and the share's `n` (and `voted`) adds the conflicts |
| `source` | `tags`, `placement` or `tags+placement` |

Rule (`Alkylation::combineCalls`):
- no database: the tag call (`source tags`);
- only one of the two calls: that one (`tags` or `placement`);
- both call the same class: that call, with the tag call's counts
  (`tags+placement`);
- both call, but different classes: `no_call`, reason `disagree`
  (`tags+placement`); each call is in its own section;
- neither calls: the tag call's `no_call` and reason (`tags`).

`reason` is one of `few_cys_spectra`, `ambiguous`, `unresolved_forms` (tags)
or `disagree`; `tags_too_short` is only in `alkylation_placement_call`.

The counts are in the report whether it calls or not: `alkt_run spectra`
(voting spectra), the six `alkt_form <form>` vote rows and `residues.<form>`;
with a database also `alk_cys`.

A reader that only wants the call reads `alkylation_call status`, `reagent`,
`share` and `source`, and `alk_run database_source` for the caveat.

## Stability

- Format 4 (release-gate review n1) changed from format 3: the row
  `alkt_form alias_unconfirmed` after `unresolved`; votes it counts are no
  longer in `spectra`, the form rows or the share. A format 3 reader that reads
  rows by key still reads the call.
- Format 3 (review n1 to n3) changed from format 2: `share` is class /
  (binned + conflicted) and its `n` is that denominator; the row `voted`
  after `share` in `alkylation_placement_call` and `alkylation_call` (and
  `alkylation_tags_call`); the tag sections gain `alkt_run resolved_below_mz`
  and `alkt_form alias_rejected` and `unresolved`; in ppm the tag call's twin
  guard is per vote (`unresolved_forms` only when no vote is left). A format 2
  reader that reads `status`, `reagent` and `share` by key still reads the
  call.
- Format 2 (feedback 202dbcf4) changed from format 1: the `method` row and the
  six-row `alk_run` without a database; `alk_cys` only with a database; the
  placement call moved from `alkylation_call` to `alkylation_placement_call`;
  the tag sections inside the report; `alkylation_call` is the combined call
  with the row `source`; the reasons `unresolved_forms` and `disagree`.
  A format 1 reader that reads `alkylation_call status`, `reagent` and `share`
  by key still reads the call.
- Format 1 was frozen from the 1.12.0 release on (the rows `fixed_nterm_delta`,
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
| `-alkylation_out <tsv>` | off | the report; refused with `-stream`, guarded against overwriting inputs and other outputs. Runs the shadow tagging pass (one more tagging of every MS2) |
| `-alkylation_proteome` | `auto` | database for the placement call without `-recon_fasta`/placement readers: `auto` = `-fasta` when given, else none (the tag call alone; before format 2, `auto` meant `human`); `human`, `mouse`, `yeast`, `ecoli` (shipped UniProt 2026_04 reference proteomes, reviewed entries: `<bin>/../share/FASTag/alkylation/<name>.fasta.gz` or `$FASTAG_ALKYLATION_DIR`; see Shipped proteomes), or a FASTA file (`.gz` allowed). Ignored with a warning when `-recon_fasta` is given or another placement reader runs |
| `-alkylation_min_spectra` | 10 | both calls |
| `-alkylation_min_share` | 0.6 | both calls |
| `-alkylation_window` | 0 (= 0.02 Da on ppm runs, 0.5 Da on Da runs) | placement call only; warned as ignored without a database |

`-delta_out`, `-massgap_out` and `-recon_localize` still require `-recon_out`
(or a #5 hand-off output); `-alkylation_out` alone does not satisfy them.

`auto` reads no proteome. (Format 1 took the human proteome; the plan's "top
`-species` genus" needs the species call before the tagging loop that places
the tags, so it was never implemented.)

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
- **A#17 (`-search_shifts`).** Removed in 1.14 (failed its held-out tests);
  `-alkylation_out` is the only reader of the call.
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
| `human` | UP000005640 | 9606 | 20,414 | 7.5 MB |
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
- reads the file and refuses it with exit code 3, before any output is
  written, when the sha256 of the FASTA read (the decompressed bytes) differs
  from the row's `fasta_sha256`, or its entry count from the row's `entries`
  (a truncated, edited or replaced file). The check is on the FASTA, not the
  `.gz`: a recompressed but unchanged file passes. The `.gz` sha256 (`sha256`)
  is recorded for the download and checked by `proteomes_cli_test`, not at run
  time;
- writes the `database_release` and `min_tag_length` rows.

Tag length: the reconciler derives a minimum tag length from the database
size (`Recon index: ... min tag length N (derived)` in the log): 8 on the
shipped human and mouse proteomes, 7 on yeast and E. coli. Shorter tags are not
placed, so at the default `-tag_length` a run on a shipped proteome places
nothing: the log warns at startup (`no tag will place and there will be no
call. Give -tag_length N or more`), the report's `alk_run min_tag_length` row
gives N and the run's longest tag, and the call is `no_call` with reason
`tags_too_short`. Give `-tag_length 8` (human, mouse) or `-tag_length 7` (yeast,
E. coli).
Measured on data with `-tag_length 8` (1.13 branch build): PXD014764
(`20190412_KEH_HF_SA_ANW_R11_100419_CNOT_R1_f008`) 636 spectra with a single-Cys placement (`alk_run spectra`),
call Carbamidomethyl, share 0.937; PXD003531
(`20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01`) 1,065, Carbamidomethyl,
0.667. Both reports equal those on the same FASTA given as a path, apart from
the `database*` rows. (These are placement calls, in format 2 the
`alkylation_placement_call` section.)

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
`FASTAG_ALKYLATION_DIR`, and checks the refusals (truncated, one residue
edited with the entry count kept, entry count wrong, invalid row) and that a
recompressed unchanged file is accepted, and the `tags_too_short` reason at
`-tag_length 4`, and that the default `auto` reads no proteome. CI checks the
shipped Linux and Windows bundles with `-alkylation_out` at the default `auto`
(a tag-only report: `database_source none`, `alkylation_call source tags`),
with `-alkylation_proteome human` (it must resolve the shipped human proteome
and report `tags_too_short` in `alkylation_placement_call`) and with `-alkylation_proteome ecoli
-tag_length 8` (0.5 Da) on the E. coli example, where the placements (the `n`
of the `alk_cys excluded.*` rows) must be above 0: tags place on the shipped
file. That example is too small for single-Cys votes at length 8 (115
placements, `alk_run spectra` 0; at length 7, 194 placements and 2 spectra).

## `-alkylation_tags_out` (1.13, database-free, `alkt_run format` 3)

Backlog #22, src/AlkylationTags.h. This report makes the call without a
protein database; since format 2 of `-alkylation_out` it is also that report's
default call, and its sections are inside it. It is opt-in and experimental. On development data it calls
61 of 123 runs, 51 of them as the SDRF annotation states (see "Development
result" below); unalkylated and low-resolution runs are rarely called. A
held-out test followed and passed at the margin (see "Held-out result" below);
the report's `alkt_run.status` row states it. With the option off nothing
runs and no output changes. With it on, the tag TSV and every other result file
are byte-identical, with two exceptions: the log gains one line, and an
`-out_spectra` mzML records `parameter: alkylation_tags_out`, as it records
every option that is not at its default.

**Method.** Each MS2 spectrum (its selected precursor hypothesis, b/y) is
tagged a second time. That pass writes no tags. Its settings are the run's
Param, with these changes:
- every C modification of the run (fixed or variable) is removed, so C is
  103.009;
- five variable alternatives are added: `C[Carbamidomethyl]`,
  `C[Propionamide]`, `C[Nethylmaleimide]`, `C[Methylthio]`,
  `C[Carboxymethyl]`, with masses from OpenMS ModificationsDB;
- there are no gap edges;
- every tag with E <= 1 is kept: the run's `-max_tags`, `-max_evalue` and
  `-diversity` select output rows only, and the second pass writes none.

A tag counts when it is ungapped, has E <= 1 and was read at fragment
charge 1. Fragment charge 2 is left out because C[Propionamide]/2 lies
0.009 Th from a singly charged S, so a 1+ S ladder also reads as a 2+
Propionamide ladder. A spectrum votes only when its best counted tag (lowest
E-value) holds a C, no C is the first or last residue of that tag, and the
E-value is at most 1e-4. A tag of equal E-value without a C does not stop the
vote. Short tags leave few inner positions, so `-extension` gives more votes.
The vote is:
- for the form that all of the tag's C residues share;
- as a conflict when the tag's C residues have two forms;
- as a conflict when another tag of equal E-value has another form;
- as a conflict when a C edge of the tag is explained as an alias (format 3,
  below: `alias_rejected`);
- set aside, not counted, when a C edge lies where its form has a twin in the
  edge windows (format 3, below: `unresolved`).

Conflicts count against the share (format 3; up to format 2 they were left
out of it, so 10 votes for one form and 90 conflicts were a share of 1.0).

The call is #3g's rule over six classes: the five reagents, and `none` for
unmodified C. The leading class needs `-alkylation_min_spectra` votes and a
share of `-alkylation_min_share` of the votes and conflicts. A run whose
tolerance resolves a twin at no m/z (in Da: twice the tolerance reaches the
twin's distance), or whose every vote was set aside as unresolved, gets no
call (`unresolved_forms`). Oxidised, cysteinylated and dehydroalanine Cys are
not candidates here.

**Isobaric collisions (format 2).** Each candidate C mass (unmodified C
103.00919, C[Carbamidomethyl] 160.03065, C[Propionamide] 174.04630,
C[Nethylmaleimide] 228.05686, C[Methylthio] 148.99691, C[Carboxymethyl]
161.01466) is checked against the run's own alphabet: the 18 other base
residues (I as L) with the run's fixed modifications, plus one entry per
variable modification of them (`AlkylationTags::alphabet`, as the tagger
builds it). Two kinds of collision within twice the edge tolerance:

- *Single-step twin* (`alkt_form twin.<form>`): another C form, or one residue
  step of the alphabet, has the same mass. One edge cannot tell them apart.
  This is the 1.13 rule (two C forms within twice the tolerance) extended to
  residues and modified residues. At 20 ppm there is none at 1000 m/z; at
  0.5 Da Carbamidomethyl and Carboxymethyl twin each other (0.984 Da apart); a
  variable modification that lands on a C form (say a K + 31.936 Da) would
  twin it at any tolerance. *Per vote (format 3).* The tagger looks each step
  up with the tolerance at its own target m/z (`tolAt`), so two steps d apart
  can end on one peak at m/z M when 2 x tol(M) >= d. In Da that holds at every
  m/z or at none: a twin gives `forms_resolved no` and `no_call
  unresolved_forms`, as in format 2. In ppm it holds from M = d / (2 x ppm x
  1e-6) up: `alkt_run resolved_below_mz` (CAM / Carboxymethyl: 1230 m/z at
  400 ppm, 984 at 500, 24,600 at 20). A vote whose C edge reaches its form's
  bound is set aside (`alkt_form unresolved`), the others count. Up to format
  2 one tolerance at 1000 m/z decided for the whole run: at 400 ppm the
  guard passed (0.8 < 0.984 Da) while the windows above 1230 m/z overlap, and
  at 500 ppm it made no call (1.0 >= 0.984 Da) although the windows below
  984 m/z do not. `forms_resolved` still reports the 1000 m/z reading.
- *Two-step alias* (`alkt_form alias.<form>`): two steps of the alphabet or C
  forms (an edge over a missing peak), or another C form shifted by a 13C
  peak. C[Carbamidomethyl] = G + C and C[Propionamide] = A + C exactly, so
  excluding these readings would make the two most common reagents
  uncallable. Format 3 checks them against the spectrum instead (below,
  Aliases).

On PXD000001 (20 ppm, `-tag_length 4 -extension 6`) the aliases are
`C+G:0.0000,C[Carboxymethyl]-13C:0.0193` (Carbamidomethyl),
`A+C:0.0000,S+S:0.0178` (Propionamide), `N+N:0.0290,M+P:0.0364`
(Nethylmaleimide), `C[Carbamidomethyl]+13C:0.0193` (Carboxymethyl), none for
Methylthio and unmodified C, and no twin. At 0.5 Da the same run gets the
twin rows above and `no_call unresolved_forms`.

**Background votes.** Random edges between noise peaks give weak C tags
(E 0.3 to 1) even in spectra without a C, mostly at an end of a tag. The first
version of the rule let every spectrum vote with its best C tag at E <= 1;
those chance edges then spread the votes over all six forms (3 calls on 123
development runs). The three conditions above remove most of them.

**Aliases (checked since format 3).** A single edge equals a two-residue sum
when the peak between the two residues is missing:
- C[Carbamidomethyl] = G + C exactly;
- C[Propionamide] = A + C exactly;
- C[Nethylmaleimide] is 0.029 Da from N + N and 0.036 Da from M + P.

So in an unalkylated sample, GC/CG and AC/CA with a missing peak read
Carbamidomethyl or Propionamide. At 20 ppm the list also holds S + S for
C[Propionamide] (0.018 Da); at 0.5 Da it holds many more pairs. An edge can
also start or end on the 13C peak of an ion (an isotope peak the deisotoper
keeps, every one under `-no_deisotope`): such an edge is another C form
+/- 1.00336 Da, and C[Carbamidomethyl] + 13C lies 0.0193 Da from
C[Carboxymethyl] (58.00548 - 57.02146 = 0.98402 Da). The tagger matches an
edge with the tolerance at its peak, so that twin reads at a 0.02 Da tolerance
at every m/z, and at 20 ppm only for fragments above about 965 m/z.

Up to format 2 these readings were listed and voted. Format 3 checks every C
edge of the tag a spectrum would vote with (its two path peaks, Tag::path_mz)
against the peaks the tagger read (the prepared spectrum), for each alias of
the edge's form whose mass the edge's two windows could have matched
(`AlkylationTags::aliasExplains`):
- *pair X + Y*: a peak at lo + X or lo + Y (the missing middle peak, in either
  order) or at the complementary m/z of either (precursor mass + 2 protons
  minus it, the other series), within the tagger's per-peak tolerance;
- *+13C* (the edge ends on a 13C peak): a peak 1.00336 Th below the upper
  end, at least as intense as it (the monoisotopic peak of that ion); *-13C*:
  the same below the lower end.

A true C[form] edge leaves none of these; a GC or CG that lost the middle peak
in one series usually keeps it in the other. An alias found, or one whose
positions all lie outside the spectrum (it cannot be tested), makes the vote a
conflict (`alkt_form alias_rejected`, a part of `conflict`), which counts
against the share. A pair that lost its middle peak in both series (or whose
middle peaks the peak selection dropped) leaves nothing in the ladders to tell
it apart; up to format 3 such a vote counted for the C form.

**Independent evidence (format 4).** A C immonium ion (the C residue with its
form, minus CO, protonated: 133.043 Carbamidomethyl, 147.059 Propionamide,
201.069 Nethylmaleimide, 122.009 Methylthio, 134.027 Carboxymethyl, 76.022
unmodified) does not depend on the ladder: it says a C of that form is in the
peptide. A vote with an alias the spectrum does not explain counts only when
that ion lies within the tagger's per-peak tolerance in the spectrum as read
(before the peak selection) and cannot be the immonium ion, or its 13C peak, of
a C form the alias reads instead (`AlkylationTags::immoniumConfirms`; at
0.02 Da the CAM 13C immonium, 134.046, covers the Carboxymethyl one, so a
Carboxymethyl vote against `C[Carbamidomethyl]+13C` then always abstains).
Otherwise the vote abstains (`alias_unconfirmed`). Unmodified C has no alias
and its immonium ion lies below most scan ranges; the rule never applies to it.
A run whose C forms have no alias (Methylthio at 20 ppm) is unchanged.

How often the ion is there was measured against open Sage 0.14.6 searches (C
unmodified or any of the five forms, variable; 1% spectrum q; 20 ppm), not
fitted: the CAM immonium is in 49% (PXD020401) and 61% (PXD003531) of the
spectra of CAM peptides and in 4.6% / 4.2% of those of peptides without C; the
NEM one in 46% of the NEM peptide spectra of PXD020401 (and 9% of the CAM
ones). So about half of the true CAM votes abstain, and a chance CAM reading in
a spectrum without CAM survives about one time in 20.

Three runs, `-extension 2 -fixed_modifications 'Carbamidomethyl (C)'`, all
spectra, 20 ppm (the Characterize command), format 3 -> format 4:

| run | truth (open Sage search, C residues in 1% q PSMs) | format 3 votes | format 4 votes (alias_unconfirmed) | call |
|---|---|---|---|---|
| PXD000001 (Erwinia, TMT) | MMTS (SDRF); not searched | MeS 52, CAM 5, Prop 3, NEM 4, CM 2, unmod 2, conflict 1 of 69 | MeS 52, CAM 1, Prop 0, NEM 2, CM 1, unmod 2, conflict 1 of 59 (10) | Methylthio, share 0.754 -> 0.881 |
| PXD003531 (human, TiO2 phospho-enriched: 36% phospho PSMs) | CAM 211, free 78, +58.005 48 (62% / 23% / 14%; 318 of 10,086 PSMs hold a C) | CAM 75, Prop 6, NEM 11, MeS 19, CM 21, unmod 24, conflict 8 of 164 | CAM 49, Prop 0, NEM 6, MeS 19, CM 6, unmod 24, conflict 8 of 112 (52) | no_call ambiguous, 0.457 -> 0.438 |
| PXD020401 (mouse phagosomes) | NEM 2,418, CAM 1,777, free 161, +58.005 153, Prop 52, MeS 32 (NEM blocking, then CAM) | CAM 595, NEM 549, unmod 44, conflict 38 of 1,263 | CAM 366, NEM 405, unmod 44, conflict 38 of 865 (398) | no_call ambiguous, 0.471 -> 0.468 |

On PXD003531 and PXD020401 the no call is right: neither run has one C form.
PXD003531's C peptides are mixed (a CAM share of 0.62 even in Sage's reading),
and its spectra are C-poor (3% of the PSMs hold a C, so 164 of 27,345 spectra
vote). Of its 19 Methylthio votes (no alias, so the rule leaves them), 7 are
spectra Sage identifies as peptides without C (the run's phospho residues are
not in the GUI's alphabet). PXD020401 was blocked with N-ethylmaleimide and
then carbamidomethylated: the static-CAM Sage search behind the benchmark
missed the NEM peptides, and 343 of the 549 format 3 NEM votes are spectra the
open search identifies as NEM peptides.

The unit tests (test/alkylation_tags_test.cpp) build each case and assert the
final call: unmodified GC/CG and AC/CA peptides with the middle b or y peak
dropped are called Carbamidomethyl (23 of 24 votes) and Propionamide (22 of 24)
without the check and get no call with it (23 votes rejected); undeisotoped
CAM spectra with 13C peaks and the monoisotopic peak after the C lost give 3
Carboxymethyl votes of 9 without the check and none with it; spectra of each
real C form still call that form (12 of 12 votes). Format 4: with both middle peaks
dropped the unchecked vote calls Carbamidomethyl (24 of 24) and Propionamide
(23 of 24); the checked one sets all 24 aside (`alias_unconfirmed`) and makes
no call; CAM spectra without their immonium ion abstain, with it they call CAM.
The synthetic spectra of a C form carry its immonium ion.

**Development result (descriptive, not held-out).** On the 123 evaluable
SDRF development runs of acceptance/1.12 (105 CAM, 17 none, 1 Methylthio),
split by PXD into a fitting half (59 runs) and a check half (64 runs); the
rule was chosen on the fitting half only.

| | runs | called | as annotated | not as annotated | no call |
|---|---|---|---|---|---|
| first rule, all | 123 | 3 | 2 | 1 | 120 |
| fitting half | 59 | 29 | 26 | 3 | 30 |
| check half | 64 | 32 | 25 | 7 | 32 |
| all | 123 | 61 | 51 | 10 | 62 |

Of the 10 calls that differ from the annotation, 5 are the five runs of
PXD000900 (annotated CAM, called Nethylmaleimide with 0.73 to 0.85 of the
votes), 3 are calls of none on runs annotated CAM (PXD040230, two HLA runs of
PXD006939), 1 is Propionamide (PXD041573, Propionamide 221 and CAM 133
votes), and 1 is CAM on a run annotated none (PXD062749, 23 of 24 votes). The
#3g placement call, which uses a database, calls 25 of these 61 runs and
gives the same class on all 25, among them Nethylmaleimide for a PXD000900
run and none for PXD040230: part of the annotation is wrong, and it is not
known how much.

Limits: of the 17 runs annotated none, 1 is called none and 15 get no call
(an unalkylated run reads about 0.5 unmodified and 0.2 CAM, the G + C twin).
Runs with a fragment tolerance of 0.3 Da give flat votes and no call. The 62
no-calls are 45 `ambiguous` and 17 `few_cys_spectra`.

**Held-out result.** 57 held-out runs, one from each of 57 PRIDE projects
(30 carbamidomethyl, 15 another reagent, 12 not alkylated), with
`-tag_length 4 -extension 6`, 20 ppm and the default thresholds; protocol
`acceptance/1.13/PREREG-alknodb.md`. 40 of the 57 runs are called and 37 of
the calls are right: accuracy among calls 0.925, Wilson 95 % interval 0.801 to
0.974. The preregistered criterion (at least 30 calls, lower end of the
interval at least 0.80) is met, at the margin: one more wrong call would not
have met it. Every run gave a report.

| truth | runs | called | right |
|---|---|---|---|
| Carbamidomethyl | 30 | 26 | 25 |
| other reagent | 15 | 12 | 11 |
| not alkylated | 12 | 2 | 1 |

Limits of this result:
- The truth is the text of the PRIDE project record, not the paper and not a
  measurement.
- 9 of the 12 not-alkylated truths are inferred (a complete protocol without
  an alkylation step and a search without fixed modifications), not stated.
- The method abstains on samples that are not alkylated: 2 of 12 are called,
  1 of them as `none`. It does not confirm the absence of alkylation.
- Only Thermo data-dependent runs with high-resolution MS2 (Orbitrap, Astral)
  were tested; timsTOF and other TOF data were not.

**Cost.** One more tagging of every MS2 spectrum. The alphabet has five more
residues and no gap edges.

**PXD000001 (feedback 202dbcf4, descriptive).**
`TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML`, 6,103
MS2, 20 ppm, `-alkylation_out` with no database:

| settings | voting spectra | Methylthio | CAM | Propionamide | NEM | Carboxymethyl | unmodified | call |
|---|---|---|---|---|---|---|---|---|
| defaults (`-tag_length 3`, no extension) | 8 | 6 | 2 | 0 | 0 | 0 | 0 | no_call few_cys_spectra |
| `-extension 2`, 10% of the spectra (Characterize before 1.16; from 1.16 it reads all spectra) | 8 of 611 | 7 | 0 | 1 | 0 | 0 | 0 | no_call few_cys_spectra |
| `-extension 2` | 69 | 52 | 6 | 3 | 4 | 2 | 2 | Methylthio, share 0.754 |
| `-tag_length 4 -extension 6` | 117 | 75 | 11 | 10 | 6 | 10 | 5 | Methylthio, share 0.641 |

Format 3 (alias check, per-vote twin guard, conflicts in the share), all
spectra:

| settings | voting spectra (`voted`) | Methylthio | CAM | Propionamide | NEM | Carboxymethyl | unmodified | conflict (alias_rejected) | unresolved | call |
|---|---|---|---|---|---|---|---|---|---|---|
| defaults | 8 | 6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | no_call few_cys_spectra |
| `-extension 2` | 69 | 52 | 5 | 3 | 4 | 2 | 2 | 1 (1) | 0 | Methylthio, share 0.754 (52 of 69) |
| `-tag_length 4 -extension 6` | 117 | 75 | 10 | 7 | 5 | 10 | 5 | 5 (5) | 0 | Methylthio, share 0.641 (75 of 117) |

`resolved_below_mz` is 24,600 m/z at 20 ppm, so no vote is set aside.

Format 4 (immonium rule), `-extension 2 -fixed_modifications 'Carbamidomethyl (C)'`,
all spectra (the Characterize command): 59 voting spectra, Methylthio 52, CAM 1,
Propionamide 0, NEM 2, Carboxymethyl 1, unmodified 2, conflict 1 (1),
`alias_unconfirmed` 10; Methylthio, share 0.881 (52 of 59). The other settings
were not measured again.

With `-fasta erwinia_carotovora.fasta` and the TMT labels as fixed
modifications (`-tag_length 4 -extension 6`), the placements agree but are too
few: 9 binned spectra, 8 of them Methylthio (`alkylation_placement_call`
no_call few_cys_spectra); the tag call is Methylthio (78 of 123 votes, 0.634),
so `alkylation_call` is Methylthio with `source tags`. Methylthio is the mark
of MMTS. Before format 2 the same `-alkylation_out` call stopped with exit
code 6 on a build without the human proteome, and placed nothing on it at
these tag lengths.

The report has the shared `run` rows, then these sections. Rows are looked up
by `(section, key)`. The GUI does not read this report:
gui/src/digestReport.ts names none of its sections and refuses it.

### `alkt_run`

| key | value |
|---|---|
| `format` | 4 (3: no `alias_unconfirmed` row, a vote with an untraced alias counted; 2: no `resolved_below_mz`, `alias_rejected`, `unresolved` and `voted` rows, aliases not checked, conflicts out of the share; 1 until format 2 of `-alkylation_out`: no `twin.<form>` rows, aliases over the base residues only) |
| `method` | `shadow_tags` |
| `status` | `experimental`; the description gives the held-out result (passed at the margin: 40 of 57 runs called, 37 right) |
| `forms` | the six candidate forms, comma-separated (n: 6) |
| `c_mods_removed` | the run's C modifications that the second pass leaves out, as `Name (fixed)` / `Name (variable)`, or `-` |
| `tag_lengths` | the seed lengths |
| `spectra_tagged` | MS2 spectra with peaks and a precursor that the second pass was run on (an attempt count: some give no tag) |
| `spectra_cz` | MS2 spectra read as c/z (`-ion_series`); not shadow-tagged |
| `tags` | counted shadow tags (ungapped, E <= 1, fragment charge 1) |
| `tags_multi` | ungapped E <= 1 shadow tags at fragment charge 2 or more, not counted |
| `tags_with_c` | of them, tags with a C (n: `tags`) |
| `spectra` | spectra with a vote: the best counted tag holds a C, none at an end, E <= 1e-4 (n: `spectra_tagged`) |
| `min_spectra`, `min_share` | the call thresholds |
| `edge_tolerance` | the edge tolerance in Da |
| `forms_resolved` | `yes`, or `no` when a form has a single-step twin (`twin.<form>`: another form or a residue of the run within twice the edge tolerance; in Da then no call, in ppm the reading at 1000 m/z); two-step and 13C-shifted readings are under `alias.<form>` |
| `resolved_below_mz` (format 3) | the m/z from which the two edge windows hold a twin of some C form (the smallest over the forms; ppm: twin distance / (2 x ppm x 1e-6)); `0` when no m/z resolves it (Da), `-` when every m/z does. A vote whose C edge reaches its own form's bound is set aside (`unresolved`) |

### `alkt_form`

| key | value |
|---|---|
| `<form>`, six rows in the order of `forms` | votes for the form (n: votes without conflicts) |
| `residues.<form>` | C residues of the form in all counted tags (n: all C residues) |
| `alias.<form>` | two-step sums over the run's alphabet and the C forms (`C+G:0.0000`, `A+M[Oxidation]:...`) and 13C-shifted other C forms (`C[Carbamidomethyl]+13C:0.0193`) within twice the edge tolerance of the C form, by distance, comma-separated, or `-` |
| `twin.<form>` (format 2) | single steps that read like the C form: another C form (`C[Carboxymethyl]:0.9840`, `C` for unmodified) or a residue of the run's alphabet (`K[Name]:0.0004`), by distance, or `-`; any twin makes `forms_resolved` `no` |
| `conflict` | votes whose tag holds two forms, or whose C edge an alias explains; they count against the share (n: `spectra`) |
| `alias_rejected` (format 3) | of the conflicts, votes whose C edge the spectrum explains as an alias (or cannot test) (n: `conflict`) |
| `unresolved` (format 3) | spectra that would vote with a C edge at or above its form's twin bound (`resolved_below_mz`); set aside, not in `spectra` or the share (n: `spectra` + this) |
| `alias_unconfirmed` (format 4) | spectra that would vote with a C edge an alias also reads, the spectrum shows no trace of the alias, and the C immonium ion of the form is not seen; they abstain, not in `spectra` or the share (n: `spectra` + `unresolved` + this) |

### `alkylation_tags_call`

`status` (`call` / `no_call`), `reagent`, `mass`, `share`, `voted` (format 3),
`reason` (`-`, `unresolved_forms`, `few_cys_spectra` or `ambiguous`). These are
the rows of `alkylation_call`, with the votes in place of the binned spectra:
`share` is the leading form's votes over the votes plus the conflicts, and its
`n` and `voted` are that denominator.

| option | default | |
|---|---|---|
| `-alkylation_tags_out <tsv>` | off | the report; refused with `-stream`, guarded against overwriting inputs and other outputs |
| `-alkylation_min_spectra`, `-alkylation_min_share` | 10, 0.6 | shared with `-alkylation_out` |
