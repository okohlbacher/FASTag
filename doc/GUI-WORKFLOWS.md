# FASTag GUI: workflow-based Setup (spec)

Status: design spec for branch `feat/gui-workflows`, 2026-11-19. GUI-only:
no change to C++ sources or `gui/src/params.generated.json` (185 params,
manifest of FASTag 1.15.3; the branch is merged with 1.15.5, see doc/GUI-REVIEW-2026-11-20.md). It merges three proposals (workflows, peer tools,
adversarial critique). Decisions on conflicts are marked **Decision**.

## 0. Principles

1. Setup reads top to bottom: **Input -> Workflow -> Settings -> Outputs ->
   Run**, then **Results**. This matches SearchGUI, PEAKS, FragPipe and
   MaxQuant: the files come first, because defaults can depend on the data.
2. A workflow is a named preset. Its values are a diff over the CLI defaults.
   It shows only the fields that a typical user changes for that question
   (2 to 5). Everything else is under one collapsed **Advanced** disclosure.
3. Products are checkboxes with derived file names. There is no free path
   field per output.
4. Dependencies are wiring, not choices. Example: checking "Mass-shift
   table" also checks the placements file (greyed, with the reason). No
   field exists only to enable another field.
5. Every parameter can be reached from every run workflow, through Advanced
   or the parameter search (Cmd+K). Hiding is only for boilerplate, options
   the GUI manages itself, and options removed from the CLI.

## 1. Workflows (task chooser)

The chooser shows seven run workflows in this order. "Open results" leaves the
grid; see the Decision at the end of this section.

| # | Workflow (label) | Purpose (blurb, shown under the chooser) | Required inputs | Outputs, on by default (off) | Results tabs opened |
|---|---|---|---|---|---|
| W1 | **Generate tags** (landing) | Sequence tags from every spectrum, with per-residue confidence, for de novo assembly and export. | spectra | tags.tsv (spectra with tags .mzML) | Overview, Tags, Spectrum |
| W2 | **Run QC** | QC of one run: MS/MS counts and resolution by analyzer, charges, isobaric kit (one call, with the count of each reporter channel), tag yield, instrument, serial and start time. | spectra | qc.tsv; tags.tsv (always) | Overview, QC, Tags, Spectrum |
| W3 | **Mass-shift survey** (blind modification search) | Mass shifts between tags and the database: a frequency table, sites and UniMod names. | spectra; protein FASTA or shipped proteome (without one: tags only, the shift reports off) | recon.tsv, delta.tsv, delta_spectra.tsv, delta_counts.tsv (massgap.tsv, recon_id.mzTab) | Overview, Mass shifts, Tags, Spectrum |
| W4 | **Species** | Which taxa the sample contains, from the bundled taxonomy index. No FASTA needed. | spectra | species.tsv | Overview, Species, Tags, Spectrum |
| W5 | **Database reduction** | A protein shortlist, a reduced FASTA and a Sage, Comet or MSFragger configuration for your search. | spectra, protein FASTA | shortlist.tsv, reduced.fasta, engine config | Overview, Shortlist, Tags, Spectrum |
| W6 | **Identifiability triage** | Rank MS/MS spectra by how identifiable they are, and mark those your search identified. | spectra (IDs optional) | census.tsv, census_summary.tsv, census_sorted.tsv | Overview, Triage, Tags, Spectrum |
| W7 | **Characterize a run** | Protease, isobaric and SILAC labels, alkylation, glycopeptides and species, from 10% of the spectra. | spectra | digest.tsv, label.tsv, alkylation.tsv, glyco.tsv, species.tsv | Overview, Digest, Species, Glyco, Tags, Spectrum |

- **Tabs.** Every run writes its tags table, so Tags and Spectrum follow
  the workflow's own tabs in every workflow (results/ResultTabs.tsx
  WORKFLOW_TABS). A tab is shown only when its file exists, and Spectrum
  only with a CLI that has -dump_spectrum, beside the Tags table or the
  Triage ranking.
- **Batch.** Batch is an input mode of every run workflow, not a separate
  workflow: the Input card has a **One file | Batch** switch. Batch mode
  shows "Add files… / Add folder…", an output folder, and an **SDRF file
  (optional)** field. Results open on the Batch view: one row per file, the
  workflow's key columns, and the SDRF check. The top-level Batch tab stays
  as the queue and summary view.
  **Decision:** batch is an input mode, as in FragPipe and MaxQuant. A
  separate W8 duplicated W2 and W7 and gave a single-file `-out` in a batch.
- **Open results.** Open earlier results from the header (Results > Open…,
  File > Open) and from "Open earlier results…" in the page header of every
  Setup step. It is not a card.
  **Decision:** it is navigation, not a run.
- **Task IDs.** New IDs: `run-qc`, `mass-shift`, `species`, `db-reduction`,
  `triage`. The IDs `export-tags` and `characterize` stay. Saved presets
  with `batch-qc` load as `characterize` in Batch mode; presets with
  `open-results` load as `export-tags`.
- **Species and Database reduction stay separate.** Species needs no FASTA
  and answers "what is in it". Database reduction needs a FASTA and hands
  off to a search engine. Merging them would make the database "optional
  but required for half the outputs".
- **No "Custom" workflow.** Any workflow plus Advanced reaches every option.
  Editing a value marks the workflow "(modified)", and "Save as preset…"
  keeps it.

### Values each workflow sets (diff over CLI defaults)

| Workflow | Values |
|---|---|
| all run workflows | `threads 0` (half the logical cores, FASTag's effective default: it puts 0 on argv; the manifest lists 1, inherited), `progress true` |
| W1 | `res_conf true` |
| W2 | `qc_out` |
| W3 | `recon_out`, `delta_out`, `delta_spectra_out`, `delta_counts_out`, `extension 3` |
| W4 | `species true`, `species_out`, `extension 2` (validated in the paper: seed 3 + 2 x 2 = k 7) |
| W5 | `shortlist_out`, `fasta_out`, `search_config_out`, `extension 3`, plus the shortlist recipe `shortlist_gapped true`, `recon_min_length 6`, `shortlist_max_evalue 10`, `recon_missed_cleavages 2` (doc/SHORTLIST.md). The recipe is **not validated**: with MSFragger and the tryptic shortlist it passed its second held-out test and failed the third. From 1.15.4 the CLI applies it by default only under `-search_engine msfragger` with `-shortlist_protease trypsin`; the GUI sets it for every engine and protease as its default recipe, and the workflow help says so. |
| W6 | `census true`, `census_score true`, `census_sorted_out` |
| W7 | `digest_out`, `label_out`, `glyco true`, `species true`, `extension 2`, `subsample_fraction 0.1`. `alkylation_out` is offered unchecked: it needs no database (its call is read off the tags), but on 10% of the spectra at extension 2 few spectra vote (PXD000001: 8 votes, no call). Before, it placed on the shipped human proteome, which needs tags of 8+ residues. |

## 2. Parameters per workflow

### 2.1 Common block (top of Settings, the same in every run workflow)

| Field | Params | One-line help |
|---|---|---|
| Instrument | `fragment_tolerance`, `fragment_tolerance_unit`, `ion_series`, `ion_series_hybrid` | Sets the fragment tolerance for your analyzer. Presets: Orbitrap or TOF HCD 20 ppm; Orbitrap ETD 20 ppm with c/z ions (`ion_series auto`, unvalidated); Orbitrap EThcD, the same plus `ion_series_hybrid both` (unvalidated); ion trap CID 0.3 Da; Custom. |
| Fixed modifications | `fixed_modifications` | Modifications on every such residue. Remove Carbamidomethyl (C) if cysteines were not alkylated; add TMT for labelled runs. |

- The Instrument preset is matched by value: 20 ppm with b/y ions shows
  "Orbitrap/TOF HCD", not "custom".
- Custom shows the value and unit fields inline.
- The tolerance preset is removed from the Run bar.

### 2.2 Settings shown by default per workflow

Inputs other than spectra appear at the top of Settings, marked "required"
where needed.

| W | Field (param) | One-line help |
|---|---|---|
| W1 | Seed length (`tag_length`) | Residues in a seed tag. 3 suits most runs. |
| W1 | Extension (`extension`) | Residues added per end. Set 3 or more to export long tags (8+ residues) for Stitch or ALPS. |
| W1 | E-value cutoff (`max_evalue`) | Keep tags at or below this E-value. 0 keeps all. |
| W1 | Tags per spectrum (`max_tags`) | At most this many tags per spectrum. 0 = no limit. |
| W1 | Per-residue confidence (`res_conf`) | Adds a 0 to 100 confidence per residue, used by assembly export. |
| W2 | Spectra to read (`subsample_fraction`) | A select: All spectra, 10%, 25%, Custom. Counts cover only the spectra read. (`acquisition_check`, a safety switch, is under Advanced: round 2.) |
| W3 | Protein database (`recon_fasta`), required | FASTA the tags are placed on. Mass shifts are measured against it. |
| W3 | Extension (`extension`) | Residues added per tag end. Longer tags place more uniquely. |
| W3 | Missed cleavages (`recon_missed_cleavages`) | Missed tryptic cleavages allowed in a placement window (0 to 10). |
| W4 | Report rank (`species_rank`) | Taxonomic level of the report: genus, family, … |
| W4 | Presence call (`species_call`) | Experimental: under Advanced (round 2). Decoy calls each taxon present, no call or not detected. |
| W4 | Spectra to read (`subsample_fraction`) | Fraction of spectra to read, 0 = all. 0.1 is usually enough. |
| W5 | Protein database (`recon_fasta`), required | FASTA to shortlist from. |
| W5 | Background proteins (`shortlist_background`) | Host proteome and contaminants, always added to the reduced FASTA. |
| W5 | Search engine (`search_engine`) | Engine to write a configuration for: Sage, Comet or MSFragger (experimental). |
| W5 | Protease (`shortlist_protease`) | Experimental: under Advanced (round 2). Trypsin refuses clearly non-tryptic runs; Auto uses the protease FASTag detects. |
| W5 | Variable modifications (`variable_modifications`) | Written into the engine configuration, for example Oxidation (M). |
| W6 | Identifications (`census_ids`), optional | idXML or mzIdentML of this run. Marks which spectra your search identified. |
| W6 | ID q-value (`census_ids_fdr`) | q-value a target hit needs to count as identified. |
| W6 | Triage E-value (`census_triage_evalue`) | An unidentified spectrum with a tag at or below this E-value is a triage candidate. |
| W7 | Spectra to read (`subsample_fraction`) | Fraction of spectra to read. 0.1 gives stable calls in a tenth of the time. |

### 2.3 Outputs card (per workflow)

The card has two fields:

- **Output folder.** Defaults to the input's folder.
- **Run name.** The stem; defaults to the input name.

Below them is a checklist of products. Each row is "Label -> stem.suffix" in
grey monospace, with "Change…" behind a small link. The list holds the
workflow's products from section 1, followed by its tags-table columns:

- W1: ProForma column (`proforma`), USI column (`usi_collection`, which asks
  for the PRIDE accession), spectra with tags (`out_spectra`).
- The tags table (`out`) is always written because the CLI needs it. Outside
  W1 it shows as a checked, greyed row: "Tags table (always written)".

Wiring rules (the checkbox drives the boolean; there is no separate field):

| Checked output | Also set or required |
|---|---|
| species.tsv | `species true` |
| glyco.tsv | `glyco true` |
| any census_* | `census true` |
| census_sorted.tsv | `census_score true` |
| delta.tsv, massgap.tsv, recon_id.mzTab | recon.tsv checked and greyed ("needed by …") |
| delta_spectra.tsv, delta_counts.tsv | delta.tsv |
| shortlist, reduced FASTA, engine config | Protein database required |
| check_header.tsv | `check_header_charge` set |

### 2.4 Advanced (one disclosure, collapsed; header "Advanced (n changed)")

Order inside Advanced:

1. **This workflow's groups** (section 4), open.
2. **Global** (the same in every workflow): Performance, Peaks, Charge and
   ions, Complement pairs, Isobaric reporters (experimental).
3. **Other analyses** (collapsed): the remaining workflow groups, with their
   outputs as checkboxes. A tagging run can still add a species report.

- Experimental options carry an "experimental" badge, taken from the README
  wording.
- A dependent field whose prerequisite is off stays visible but disabled,
  with its reason ("needs Mass-shift table").
- Parameter search (Cmd+K) covers all reachable params. A hit inside
  Advanced expands the disclosure and its group and focuses the field.

### 2.5 Global settings, one place

These are always the **Global** group of Advanced:

- `threads`: the GUI sends 0, meaning half the logical cores (`-threads 0: using 8 of 16 logical cores`); 0 is FASTag's effective default, although the manifest lists 1.
- Peaks, charge, ion series details and complement tolerances.

The Instrument control (2.1) is the only basic global setting. Preferences
does not duplicate any of these.

## 3. Screen flow, layout, help

> **Superseded by the Setup wizard (2026-11-23):** the five stacked cards
> described here are now four steps (Task, Inputs, Settings, Outputs & run);
> see doc/GUI-SETUP-WIZARD.md for the layout, the inputs each task asks for
> and where every control of this section went (its section 7). The
> workflows, their values, the product wiring and Advanced below are
> unchanged.
>
> **UI refresh (2026-11-24):** every view shares one frame: the app bar
> (views, run status, Search settings ⌘K, Help, Feedback, Theme), a page
> header (title, one context line, page actions, then the steps or the
> result tabs), the 1200 px content column and, in Setup and Batch, a sticky
> action bar with one filled button. Help is the app bar's Help button (F1),
> which opens the page of the screen shown; the per-field (?) popovers stay,
> the page-level "Learn more" and "How to read…" links of the layers below
> are gone. See doc/GUI-SETUP-WIZARD.md section 1a.

```
[Header: Setup | Run | Results | Batch | History      Open… | ? Help]
1 Input        file chip + probe line (instrument, MS2 count, DIA check)  [One file | Batch]
2 Workflow     7 cards in a 4+3 grid, each: label, one-line blurb, "-> products"
               row: "Generate tags (modified)"  Reset | Presets ▾ (Save as…, Load, Delete)
3 Settings     required inputs of the workflow, then Common (Instrument, Fixed mods),
               then the 2 to 5 workflow fields
4 Outputs      folder, run name, product checklist
5 Advanced (n changed) ▸
[Run bar:  "Run QC on run01.mzML · 2 reports"   Copy command line   Export INI…   [Run]]
```

Rules:

- One column, at most 960 px wide, cards numbered 1 to 5. At the default
  window size (1280x800), cards 1 to 4 fit without scrolling for every
  workflow except W5.
- Removed: the "Starting from" select, the "Same as …" line, the plan footer
  that repeats the cards, the tolerance preset in the Run bar, "Checks before
  the run" as a separate section (probe results go into the Input card),
  and the "Or choose one file…" link in Batch.
- **Help, three layers:**
  - Layer 1: one gray line under each basic field (section 2.2), and the
    workflow blurb under the chooser.
  - Layer 2: a (?) popover per field, opened by click or keyboard. It shows
    the full CLI description, the default, and the flag (`-delta_out`) in
    monospace.
  - Layer 3: a "Learn more" link on each card to its README or doc section:
    | Workflow | Link target |
    |---|---|
    | W1 | Assembly export |
    | W2 | Run QC report |
    | W3 | Reconciliation and mass shifts |
    | W4 | Species detection |
    | W5 | doc/SHORTLIST.md |
    | W6 | Census |
    | W7 | Digest, label and mass-gap reports |
  - Advanced fields show the description inline under the label, one line,
    truncated, with the full text in (?).
- **Results tabs:**
  - Show only tabs whose report exists, in the order of section 1.
  - Rename "Mass gaps & recon" to **Mass shifts**.
  - New tabs: **QC** (qc.tsv as a short page: tiles for MS2 spectra, tag
    yield, instrument with serial and start time, isobaric kit and
    redundancy; small charts, each with a Table view, for spectra per MS
    level by analyzer, precursor charge, resolution by m/z band, reporter
    assessability and reporter channels; every other row under a closed
    **All values** with a filter; older `qc_version` reports get the same
    page, the kit from their compatible kits and the channels from
    `reporter_observed_*`), **Triage**
    (census_sorted with an identified/unidentified filter), and **Shortlist**
    (ranked proteins, "Reveal reduced FASTA / engine config").
  - Triage opens with an **Overview** of every row (collapsible; the filter
    does not change it): tiles for MS2 spectra, processed, the strong-tag
    share (best E-value at or below the Triage E-value; the headline),
    tagged (a tag passed -max_evalue; not a quality call) and identified
    (only with -census_ids). Three charts: the peptide length the precursor
    implies (averagine, 111.1254 Da per residue, by charge) with the tag
    lengths on top; tags reported per spectrum by peaks (median, middle
    half, the -max_tags cap); and the share of the peptide the tags cover by
    estimated length (res_cover and max_len of census 2 and 3, else
    best_len and the tag_cover m/z span, marked approximate; a census 3
    res_cover with res_cover_exact 0 is marked approximate: orientation
    unresolved, folded, lower bound; a census 2 res_cover as placed by y
    reads only). The -max_tags cap is per seed length; the number of
    lengths is read from the summary's run/tag_length first.
  - Until a view exists, the file opens in the generic table.
  - The Overview names the workflow, shows the evidence-cutoff caveat once
    at the top, and replaces CLI flags with "Run again with …" buttons.
  - A missing report gives a styled empty state with an action, never a bare
    flag.
- **Harness first:** the e2e bridge must report the manifest version (1.15.3)
  and list every manifest option. The baseline screenshots show 1.11.0 gating
  ("needs FASTag 1.12", "With tags: not counted"), so a review of them
  judges a stale UI.

## 4. Parameter-to-workflow mapping (all 185)

Basic = shown by default in that workflow (section 2). Output = a checkbox in
Outputs. Wired = set by the GUI from a checkbox or the workflow. Every other
param sits in the named Advanced group. That group is open in its home
workflow and under "Other analyses" in all others. A workflow that writes
another home's report by default leads with that home's groups too
(`Task.leadGroups` in `tasks.ts`): W7 writes the species report, so
Species, Species, advanced and Taxonomy follow Digest and labels,
Alkylation and Glycopeptides in W7, open, and are not under "Other
analyses" there.

| Group (home) | Params | Tier |
|---|---|---|
| Input / output (all) | `in`, `out` | Input card; Outputs run name |
| Common (all) | `fragment_tolerance`, `fragment_tolerance_unit`, `fixed_modifications` | Basic, all |
| Tagging (W1) | `tag_length`, `extension`, `max_evalue`, `max_tags`, `res_conf` | Basic W1; `extension` basic in W3 |
| Tag columns (W1) | `proforma`, `usi_collection`, `out_spectra` | Output W1 |
| Tagging, advanced (W1) | `tag_lengths`, `gaps`, `gap_penalty`, `diversity`, `orientation`, `isobaric_tolerance` | Advanced |
| Tag filter by database (W1) ("Keep only tags found in…") | `fasta`, `min_filter_length`, `entrapment_fasta` | Advanced |
| Run QC (W2) | `qc_out` | Output W2 |
| Run QC (W2) | `subsample_fraction`, `acquisition_check` | Basic W2; `subsample_fraction` basic in W4, W7 |
| Sampling and checks (W2) | `subsample_spectra`, `subsample_seed`, `acquisition_probe_spectra`, `check_header_charge`, `check_header_margin` | Advanced |
| Sampling and checks (W2) | `check_header_out` | Output (Advanced, wires `check_header_charge`) |
| Placement (W3) | `recon_fasta`, `recon_missed_cleavages` | Basic W3; `recon_fasta` basic in W5 |
| Placement (W3) | `recon_out`, `recon_id_out` | Output W3 |
| Placement, advanced (W3) | `recon_localize`, `recon_min_length`, `recon_sub_tolerance`, `recon_sub_tolerance_unit` | Advanced |
| Mass-shift survey (W3) | `delta_out`, `delta_spectra_out`, `delta_counts_out`, `massgap_out` | Output W3 |
| Mass-shift survey, advanced (W3) | `delta_select`, `delta_group`, `delta_isobar_tolerance`, `delta_isotope_flank`, `delta_loc_model`, `delta_loc_min_evidence`, `delta_loc_null`, `delta_name_tolerance`, `delta_name_tolerance_unit` | Advanced (experimental) |
| Mass-gap report (W3) | `massgap_max_mods`, `massgap_min_bin`, `massgap_min_share`, `massgap_min_spectra`, `massgap_silac_min`, `massgap_silac_share`, `massgap_top`, `massgap_window`, `massgap_window_da` | Advanced, enabled with massgap.tsv |
| Species (W4) | `species` | Wired by species.tsv |
| Species (W4) | `species_out` | Output W4, W7 |
| Species (W4) | `species_rank`, `species_call` | Basic W4 |
| Species, advanced (W4) | `species_evidence`, `species_min_len`, `species_use_gapped`, `species_deconvolve`, `species_max_kmer_share`, `species_min_margin`, `species_orientation`, `species_call_decoys`, `species_call_min_units`, `species_call_params`, `species_pi0` | Advanced |
| Taxonomy (W4) | `taxdb`, `taxonomy_nodes`, `taxonomy_names` | Advanced ("bundled index" when empty); the species groups also lead in W7 |
| Shortlist (W5) | `shortlist_out`, `fasta_out`, `search_config_out` | Output W5 |
| Shortlist (W5) | `shortlist_background`, `shortlist_protease`, `search_engine`, `variable_modifications` | Basic W5; `variable_modifications` is Global > Chemistry elsewhere |
| Shortlist, advanced (W5) | `shortlist_min_spectra`, `shortlist_top`, `shortlist_parsimony`, `shortlist_specificity`, `shortlist_gapped`, `shortlist_max_evalue`, `shortlist_force`, `shortlist_decoy_affix` | Advanced |
| Search configuration (W5) | `search_config_template`, `search_decoy_prefix`, `search_isotope_errors`, `search_missed_cleavages`, `search_nterm_acetyl`, `search_precursor_tolerance`, `search_precursor_unit` | Advanced |
| Census (W6) | `census`, `census_score` | Wired by census outputs |
| Census (W6) | `census_out`, `census_summary_out`, `census_sorted_out` | Output W6 |
| Census (W6) | `census_ids`, `census_ids_fdr`, `census_triage_evalue` | Basic W6 |
| Census, advanced (W6) | `census_ids_accept`, `census_ids_exact` | Advanced |
| Characterize (W7) | `digest_out`, `label_out`, `alkylation_out`, `glyco_out` | Output W7 |
| Characterize (W7) | `glyco` | Wired by glyco.tsv |
| Digest and labels (W7) | `digest_models`, `digest_models_version`, `digest_calibration`, `digest_detection`, `digest_flank2`, `digest_min_confidence`, `digest_tag_min`, `digest_window`, `digest_background_share`, `digest_silac_min`, `digest_quality` | Advanced (`digest_quality` experimental) |
| Alkylation (W7) | `alkylation_proteome`, `alkylation_min_share`, `alkylation_min_spectra`, `alkylation_window`, `alkylation_tags_out` | Advanced (`alkylation_tags_out` experimental, Output) |
| Glyco (W7) | `glyco_min_fraction` | Advanced |
| Global > Performance | `threads` | Advanced (GUI default 0) |
| Global > Peaks | `no_deisotope`, `max_peaks`, `peaks_per_window`, `pick_profile` | Advanced |
| Global > Charge and ions | `ion_series`, `ion_series_hybrid`, `unknown_charge`, `charge_min`, `charge_max`, `charge_infer_margin`, `isotope_error` | Advanced (`ion_series` is also set by the Instrument preset) |
| Global > Complement pairs | `complement_rule`, `complement_tolerance`, `complement_tolerance_unit`, `complement_tol_factor`, `complement_probe`, `complement_midp` | Advanced |
| Global > Isobaric reporters | `tmt_pseudo_filter`, `tmt_reporter_filter` | Advanced (experimental) |
| Hidden, managed by the GUI | `progress`, `dump_spectrum`, `probe_input`, `data_paths` | Hidden (progress bar, Spectrum tab, Input probe) |
| Hidden, boilerplate or no effect | `no_progress`, `version`, `log`, `debug`, `force`, `test`, `stream`, `mzpeak_read_memory` | Hidden |
| Hidden, removed in 1.14 | `ion_series_photo`, `label_call_min_tags`, `label_discovery_depth`, `label_discovery_max_flank`, `label_discovery_min_share`, `label_discovery_min_spectra`, `label_discovery_out`, `label_discovery_unimod_top`, `label_discovery_window_c`, `label_discovery_window_n`, `pick_unknown_type`, `search_shifts`, `search_shifts_out`, `shift_expand_sites`, `shift_max_offsets`, `shift_max_variable`, `shift_site_min_count`, `shift_site_min_ions`, `shift_site_min_share`, `shortlist_exact_only`, `species_reagents` | Hidden; listed under Help > "Options not in the GUI" |

Implementation notes:

- Encode this table in `paramUi.ts` as
  `{ group, tier: 'basic'|'advanced'|'output'|'wired'|'hidden', basicIn?: TaskId[] }`.
- `paramUi.test.ts` asserts that every manifest name has exactly one entry,
  and that nothing hidden is basic or output in a workflow.
- Help texts in `paramUi.ts` that name 1.16 (`census_score`,
  `census_ids_accept`, `census_ids_exact`) must name a released version or
  none. The manifest is 1.15.3.
- Alkylation: the Overview must not say "needs a FASTA".
  `alkylation_proteome auto` reads no proteome: the call is read off the tags
  (the run's Protein or Filter database, when given, adds a check).

## 5. Acceptance criteria (checkable on screenshots)

Screenshots per workflow: empty, with a file, Advanced open, Batch mode, and
every results tab.

1. The chooser shows exactly 7 workflow cards in the order of section 1, each
   with a blurb of at most 1 line and its products. "Open results" is not a
   card; Open… is in the header.
2. Setup shows the numbered cards in this order: Input, Workflow, Settings,
   Outputs, Advanced. The Run bar holds only the plan line, Copy command
   line, Export INI… and Run.
3. Per workflow, Settings shows the Common block plus exactly the fields of
   section 2.2 (at most 6 incl. inputs) and nothing else. Generate tags shows
   no Species, Glyco, Digest or Reconciliation field.
4. Every basic field has a one-line help under it and a (?) control. The
   (?) popover shows the CLI flag and default.
5. Advanced is collapsed on load and reads "Advanced (0 changed)". After one
   edit inside it, the header reads "Advanced (1 changed)" when collapsed.
6. The fragment tolerance appears once (Instrument), and with 20 ppm the
   preset reads "Orbitrap/TOF HCD".
7. Outputs shows a folder, a run name and checkboxes with derived file
   names. There is no per-output path field. In W3, unchecking recon.tsv is
   impossible while delta.tsv is checked, and the row says why.
8. W3 and W5 mark "Protein database" as required. Run is disabled with the
   reason until it is set.
9. Batch mode shows Add files/folder, Output folder and SDRF (optional).
   There is no single-file Output stem or "Or choose one file…".
10. No screen text names a CLI option as an instruction ("-census", "FASTag
    1.12") outside the (?) popovers and the command line preview. No screen
    shows "needs FASTag 1.12 or later" with the 1.15.3 bridge.
11. Results show only tabs for reports that exist. Mass shifts, QC, Triage
    and Shortlist appear after W3, W2, W6 and W5 runs. Missing reports show
    a padded empty state with an action button.
12. All UI text is English, sentence case, and uses no abbreviations a
    first-time user cannot resolve (unexplained "recon" or "census" as a
    heading counts as a failure).

## 6. Implementation order (small commits on feat/gui-workflows)

1. e2e bridge: version and options from the manifest; screens.spec.ts shots
   per workflow (section 5).
2. `paramUi.ts`: tiers and groups for all 185 params, plus the test.
3. `tasks.ts`: 7 workflows with `values`, `basic`, `outputs`, `inputs` and
   `docs`; preset ID migration.
4. `SetupForm.tsx` / `plan.ts`: five numbered cards, Common block with the
   Instrument preset; remove duplicate controls.
5. Outputs checklist and wiring rules.
6. Batch as an input mode with SDRF.
7. Results: tab gating, rename Mass shifts, generic table for QC, Triage and
   Shortlist, then dedicated views; empty states.
8. Help text pass, cross-model screenshot review, then iterate.

## 7. Round 2 (review of 2026-11-20)

Changes after the second review, beyond the table edits above:

- **What a run sends.** Options of the 1.15.3 GUI set (`ALWAYS_SENT`) go
  at their value; every other option only when it differs from the CLI
  default, and a unit only with its value. The CLI reads some options by
  whether they were given (`-shortlist_specificity` under
  `-shortlist_protease auto`, the MSFragger defaults of `-search_engine`).
- **Outputs.** The backend's output list is the manifest's output-file
  options, plus the census table and summary the CLI derives from `-out`:
  every workflow report is confirmed before an overwrite, removed after a
  failed or cancelled run, recorded and revealable.
- **Batch.** Run needs queued files in Batch mode; the output folder is in
  the Input card; `census_ids` is disabled (one file of identifications
  cannot belong to every input). The summary has each workflow's key
  columns (Run QC: MS/MS count, tag yield, charges, analyzer, instrument,
  isobaric kit, read from each job's QC report).
- **Results.** A tab only for a report that exists, the workflow's tabs
  first in the order of section 1; a requested report that was not written
  is named in the Overview. The Overview names the workflow and shows only
  the tiles of the reports the run asked for, plus MS2 spectra and tags;
  actions name the report they add. Opened files are told by their content
  (QC, shortlist, identifiability, survey tables) and open in their view;
  another run's tags close the reports of the run shown. The alkylation
  report is read (Digest and the Overview tile).
- **Setup.** Cards 1 to 4 fit 1280 x 800 for every workflow but Database
  reduction (three-column Settings, two-column products, one-row run bar,
  the workflow row in the Workflow card's head). A group waiting for a
  report says so once with Turn on. Choice values are shown in words.
