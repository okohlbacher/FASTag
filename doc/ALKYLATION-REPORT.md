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
| `-alkylation_proteome` | `auto` | database without `-recon_fasta`/placement readers: `auto` (= `human`), `human`, `mouse`, `yeast`, `ecoli` (shipped, `<bin>/../share/FASTag/alkylation/<name>.fasta.gz` or `$FASTAG_ALKYLATION_DIR`), or a FASTA file (`.gz` allowed). Ignored with a warning when `-recon_fasta` is given or another placement reader runs |
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

PLAN-organism-chemistry #3g decides that the human, mouse, yeast and E. coli
UniProt reference proteomes (UP000005640, UP000000589, UP000002311,
UP000000625, CC BY 4.0, about 15 MB) ship in `data/alkylation/` with a README
(release, sha256, licence notice) and a BOM.md row. They are not in the
repository yet: fetching them from UniProt needs the user's approval. Until
they are added, `-alkylation_proteome auto` and the named values refuse with a
clear message; `-recon_fasta` or a FASTA path works. CMake installs them only
together with `data/alkylation/README.md` (a drop without it is a configure
error). digest_cli_test checks the installed-path lookup with a gzip it makes
itself.

## `-alkylation_tags_out` (1.13, database-free, format 1)

Backlog #22, src/AlkylationTags.h. This report tries the same call without a
protein database. It is opt-in and experimental. On development data it calls
61 of 123 runs, 51 of them as the SDRF annotation states (see "Development
result" below); unalkylated and low-resolution runs are rarely called, and
there is no held-out test yet. The report says so in `alkt_run.status` and in
the `alkylation_tags_call.status` description. With the option off nothing
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
- as a conflict when another tag of equal E-value has another form.

Conflicts are not in the share.

The call is #3g's rule over six classes: the five reagents, and `none` for
unmodified C. The leading class needs `-alkylation_min_spectra` votes and a
share of `-alkylation_min_share` of the votes. One more rule comes first:
when two candidate C masses lie within twice the edge tolerance of each
other, there is no call (`unresolved_forms`). The edge tolerance is the
fragment tolerance in Da, or the ppm tolerance at 1000 m/z.
Carbamidomethyl and Carboxymethyl are 0.984 Da apart, so a 0.5 Da run
cannot tell them apart; a 0.3 Da or ppm run can. Oxidised, cysteinylated
and dehydroalanine Cys are not candidates here.

**Background votes.** Random edges between noise peaks give weak C tags
(E 0.3 to 1) even in spectra without a C, mostly at an end of a tag. The first
version of the rule let every spectrum vote with its best C tag at E <= 1;
those chance edges then spread the votes over all six forms (3 calls on 123
development runs). The three conditions above remove most of them.

**Confounds (not corrected).** A single edge equals a two-residue sum when the
peak between the two residues is missing:
- C[Carbamidomethyl] = G + C exactly;
- C[Propionamide] = A + C exactly;
- C[Nethylmaleimide] is 0.029 Da from N + N and 0.036 Da from M + P.

So in an unalkylated sample, GC/CG and AC/CA with a missing peak vote
Carbamidomethyl or Propionamide. The report lists every such twin within
twice the run's edge tolerance (`alias.<form>`). At 20 ppm the list also
holds S + S for C[Propionamide] (0.018 Da). At 0.5 Da it holds many more
pairs.

An edge can also start or end on the 13C peak of an ion: an isotope peak the
deisotoper keeps, and every one under `-no_deisotope`. Such an edge is another
C form +/- 1.00336 Da. C[Carbamidomethyl] + 13C lies 0.0193 Da from
C[Carboxymethyl] (58.00548 - 57.02146 = 0.98402 Da), so in CAM runs those
edges vote Carboxymethyl whenever such a reading is a spectrum's best tag, and
in Carboxymethyl runs C[Carboxymethyl] - 13C can vote CAM. The tagger matches an edge with the tolerance at its peak, so the
twin reads at a 0.02 Da tolerance at every m/z, and at 20 ppm only for
fragments above about 965 m/z. It is within twice the report's edge tolerance
(the ppm tolerance at 1000 m/z) from 10 ppm up. The report lists it as `C[Carbamidomethyl]+13C` under
`alias.Carboxymethyl` and `C[Carboxymethyl]-13C` under
`alias.Carbamidomethyl`. It is not corrected and does not set
`forms_resolved` to `no`: that row compares the forms' own masses, the
quantity a coarse tolerance cannot resolve, while the isotope twin, like
G + C, is a second peak path to the same edge mass. The unit test builds an
undeisotoped CAM ladder with 13C peaks (0.02 Da tolerance) and checks that the
C[Carboxymethyl] reading exists: 25 such readings in 12 spectra, none of them
a spectrum's best tag there.

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

**Cost.** One more tagging of every MS2 spectrum. The alphabet has five more
residues and no gap edges.

The report has the shared `run` rows, then these sections. Rows are looked up
by `(section, key)`. The GUI does not read this report:
gui/src/digestReport.ts names none of its sections and refuses it.

### `alkt_run`

| key | value |
|---|---|
| `format` | 1 |
| `method` | `shadow_tags` |
| `status` | `experimental`: development result only, no held-out test |
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
| `forms_resolved` | `yes`, or `no` when two forms' own masses lie within twice the edge tolerance (then no call); 13C-shifted readings are under `alias.<form>` |

### `alkt_form`

| key | value |
|---|---|
| `<form>`, six rows in the order of `forms` | votes for the form (n: votes without conflicts) |
| `residues.<form>` | C residues of the form in all counted tags (n: all C residues) |
| `alias.<form>` | two-residue sums (`C+G:0.0000`) and 13C-shifted other C forms (`C[Carbamidomethyl]+13C:0.0193`) within twice the edge tolerance of the C form, by distance, comma-separated, or `-` |
| `conflict` | votes whose tag holds two forms (n: `spectra`) |

### `alkylation_tags_call`

`status` (`call` / `no_call`), `reagent`, `mass`, `share`, `reason`
(`-`, `unresolved_forms`, `few_cys_spectra` or `ambiguous`). These are the rows of `alkylation_call`,
with the votes in place of the binned spectra.

| option | default | |
|---|---|---|
| `-alkylation_tags_out <tsv>` | off | the report; refused with `-stream`, guarded against overwriting inputs and other outputs |
| `-alkylation_min_spectra`, `-alkylation_min_share` | 10, 0.6 | shared with `-alkylation_out` |
