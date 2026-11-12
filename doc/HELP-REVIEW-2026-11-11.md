# Help review — 11 November 2026

The Help was broad, but not complete enough for a new user to follow all of the GUI's workflows. Its parameter reference covered all 164 CLI parameters, yet coverage of Overview, batch comparison, SDRF, History and reconciliation was much thinner than coverage of tags and scores. Several statements had drifted from the implementation. This review corrected those gaps in the local branch.

## Assessment and changes

| Area | Finding | Change |
| --- | --- | --- |
| Workflow coverage | No practical guide to several major views; batch output location described as always beside the input | Added **Results and workflows**, covering Overview evidence, batch outputs and majority flags, SDRF states and exports, History actions, and reconciliation controls and limits |
| Beginner readability | Long pages lacked a contents list; acronyms and search distinctions were not consistently explained | Added **On this page**, a navigation/shortcut guide, examples and glossary definitions; linked the relevant Help from Overview, History, SDRF, Glyco and reconciliation |
| Settings reference | A search could land on a hidden CLI option without explaining its availability; declared ranges and choices were absent | Show the same ranges, choices and file formats used by the form, including exclusive bounds, plus the reason an option is outside the settings form |
| Search and keyboard access | Page titles/leads and expanded CLI descriptions were not indexed; Escape did not close Help from an empty search field; Enter could immediately collapse the entry it opened | Index those texts and parameter metadata, separate block text correctly, announce search results, keep Enter-opened entries expanded, and make Escape clear the query then close Help with focus restored |
| Scientific accuracy | Confidence described as independent per residue; complement scoring overstated; an experimental species description claimed calibration | Explain observed-edge confidence and shared scores across gaps, conditional complementary-ion scoring, and experimental species calls; align CLI description/warnings, GUI tooltip and manifest |
| Troubleshooting | Missing Run-disabled cases, stale instrument advice, conflicting species setup advice and an unlimited-log claim | Match the actual run checks, instrument suggestions, Characterize preset, 500-line log display and 5,000-line retention |

## Coverage checked against the implementation

- Setup and first run: tasks, 10% sampling, full-input settings, input checks, tolerance presets, output paths, parameter search, presets, INI export and cancellation.
- Results: Tags columns, filtering/export and spectrum inspection; Overview count provenance, the 1,000-tagged-spectrum census cutoff, and suggested-settings provenance; Species ranking versus optional calls; Digest and label gates; Glyco filters, report-wide ion frequencies and the base-peak denominator; reconciliation placements, filters, assumed mass window, 100-spectrum warning and report size limit.
- Batch and SDRF: pending versus completed output paths, retries and cancellation, majority calculation, comparison states, settings versus measurements, exported proposals and unchanged source metadata.
- History: reopening outputs, copying commands, loading settings with Undo, rerunning recorded settings, deleting records without deleting files, and incomplete outputs.
- Reference: all CLI parameter entries and internal link targets, defaults/restrictions from the manifest, and 33 glossary entries. Experimental command-line features remain reference material; documenting one does not make it available in Setup.

Sources were the implementation in `gui/src`, the CLI registration and scoring/report code in `src`, `README.md`, `doc/DESIGN-digest.md`, `doc/SPECIES-DETECTOR.md`, and the repository's existing fixtures/tests. Key scientific statements have cross-document regression checks in `gui/src/help/help-docs.test.tsx`.

## Validation and limits

- Unit suite: 79 files passed; 933 tests passed and 16 skipped.
- Browser suite: all 184 tests passed across Chromium and WebKit, including Help search, Enter/Escape behavior, focus restoration and both window sizes/themes.
- Production build and `check:dist`: passed; no mock or fixture strings in the release bundle.
- Related CLI shell tests: syntax checks passed. Their runtime assertions require a rebuilt CLI. The changed CLI option description matches the generated manifest exactly.

Browser checks use the existing fixture bridge, not a packaged desktop binary. Visual inspection covers the Help panel in light/dark themes and its narrow layout. No analysis algorithm or default was changed.

The revised Help covers the main implemented GUI workflows and the full parameter inventory. This is a code/documentation audit and visual usability review, not evidence from a study with first-time users. Native packaging and the changed CLI warning strings still require a CLI rebuild; the related shell test expectations were updated and syntax-checked.
