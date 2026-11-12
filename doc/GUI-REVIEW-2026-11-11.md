# GUI correctness and beginner usability review

Started from `main` at `4fba712` on branch
`codex/gui-usability-review`, then merged upstream through `bc99966` for the
final implementation and validation. The supplied FASTag handoffs and earlier GUI
review provided context; the current CLI, parameter manifest, frontend and
tests determined present behavior.

## Design scope

The target scenario is a first-time user choosing spectra, understanding
what will run, resolving input checks and interpreting the results. Preserve
the existing four-view layout, task presets, OpenMS logo, system typography,
blue accent, light/dark tokens and native form controls. No dependency,
algorithm, CLI-default or report-format changes are needed. The GUI now
starts with tag generation, followed by reopening results and the two QC
tasks, as requested in the final priority review.

## Findings and changes

| Finding | Change |
| --- | --- |
| Getting started and the task order did not clearly prioritize tag generation. | Put Export tags first and make it the GUI default, followed by Open results, Characterize and Batch QC. Align first-run Help with all-spectrum tagging and the Tags view; explain 10% sampling and Overview in the optional QC workflows. |
| Task descriptions led with implementation details; the next action was unclear. | Used plain descriptions, emphasized Choose file, added a direct first-run Help link and strengthened step-heading hierarchy. |
| The final plan omitted sampling. Small nonzero fractions could display as 0%. | The plan and Spectra card show all spectra, percentage or absolute sample count; count precedence matches the CLI. |
| An absent FASTA looked like a missing requirement. | Marked it optional and explained that the bundled species index needs no FASTA. |
| The tolerance selector implied no setting was active. | Renamed it Fragment tolerance preset and displayed the current tolerance when no preset is selected. |
| Clearing Output disabled Run without a reason. | Added an associated field error and a reason next to Run. |
| Copied feedback persisted after the command changed. | Reset command/export feedback when input, output or parameters change. |
| Parameter search allowed focus into the background and could hide the active match. | Used a native modal dialog, Close button and nearest-match scrolling; close search on native menu/view changes. |
| Very large numeric exponents passed GUI validation as Infinity. | Refuse non-finite numbers before starting the CLI. |
| The Species headline called the raw leader a species call. | Label it Top-ranked taxon, distinguish ties, and show existing optional CLI call statuses in their own column. |
| Overview rendered an inconclusive species result as none present. | Separate no presence call from none detected, with an explicit absence caveat. |
| Help said the CLI had no alkylation call, and Glyco had no GUI tab. | Describe the actual Glyco view and distinguish GUI mass-gap counts from the separate CLI-only alkylation report. |
| Acquisition and label-discovery help still described superseded failed validation rounds. | Synchronize CLI help, manifest descriptions and GUI help with the current documented validation, including its limits. |
| Export tags starts with 3-residue tags, but Stitch/ALPS export defaults to at least 8 residues. | Explain the mismatch and how tag length, extension and export cutoff interact, without changing the preset. |
| Exit-13 troubleshooting promised outputs the desktop backend removes. | Document the desktop cleanup behavior and recovery action. |

## Adversarial review and iteration

An independent code review traced input/output resolution, INI export,
numeric and sampling bounds, batch names, hidden options, Help routing,
species/label/glyco interpretation, History, SDRF and reconciliation. A second
pass checked the resulting fixes and the new CI dependencies. Browser testing
then exercised every Help page at the minimum window size in both themes.

| Finding | Fix and regression coverage |
| --- | --- |
| Export INI could overwrite the run's spectra, FASTA or report. | Reject resolved inputs and outputs before starting the CLI, including derived species/glyco reports and existing symlink/hardlink aliases; verify original bytes remain intact. |
| A late command-line response could overwrite a newer clipboard copy. | Reject stale responses before writing the clipboard; test the old request completing after the newer copy. |
| Pending copy/export feedback could describe settings or results no longer shown. | Invalidate feedback across setup/result changes; retain the clicked INI settings snapshot and catch save-dialog rejection. |
| Closing Help after changing views could restore focus to a hidden opener. | Fall back to the top-bar Help button; cover hidden, disabled and removed openers. |
| An exact CLI name such as `-species_call` could rank related options first. | Rank the exact parameter first; check every parameter with plain, dashed and uppercase queries. |
| The optional-reports table overflowed the narrow Help panel in WebKit. | Allow long table-cell text to wrap; check every Help page and contents link in both browser engines. |
| A long unmatched search query expanded the window horizontally. | Show bounded recovery guidance rather than echoing the query; check long paths and expanded CLI descriptions at 960×600. |

Automated coverage now includes keyboard navigation through all 20 displayed
search hits, FAQ/glossary round trips, a blocked input, focus after a view
switch, and native WebDriver Enter/Escape behavior. The existing real-CLI
consistency job now runs on pull requests with the pinned taxonomy and fails
if any of its 20 cases is skipped. Browser fixtures, native-backend tests and
real-CLI checks remain distinct layers of evidence.

## Final local validation

| Layer | Result |
| --- | --- |
| Frontend and real-CLI integration | 959 passed across 79 files with the freshly built CLI and Rust argv/order helpers; no skipped or failed cases. Includes 20 real-CLI consistency tests covering both the Export tags startup and the optional Characterize task. |
| Browser GUI | 196 passed in Chromium and WebKit, including all Help pages, contextual navigation, keyboard search, minimum-window fit, both themes, Setup, results, batch, exports and History. |
| Rust backend | 231 passed, zero failed, two intentionally ignored helper-process entry points. Includes real-CLI INI round trip, protected file aliases, crash recovery and cancellation of a 400,000-row export. |
| C++ and CLI | 81 passed; five optional external-tool/data checks skipped. Two sandbox-restricted filesystem checks passed on rerun with the required access. Both changed species integration checks passed. |
| Parameter contract | Fresh CLI-generated manifest matches `gui/src/params.generated.json` byte-for-byte. |
| Build and hygiene | Production and e2e builds, TypeScript, production fixture-exclusion check, workflow syntax validation and `git diff --check` passed. |
| Native macOS GUI | Built an isolated, ad hoc signed debug app with the production frontend, updated bundled CLI and reference data. Verified native file selection, input checks, tolerance warning acknowledgement, exact Help search, contextual Help, Escape, run, Overview, Tags, spectrum inspection, History and view shortcuts. |

The native run used a copy of the public `Ecoli_MS2_small.mzML` fixture.
With the Characterize task and Ion trap CID 0.3 Da preset it processed 14 of
139 spectra and displayed the 598 tags written by the CLI, including 62
ungapped tags with E-value ≤1 and four glyco-flagged spectra. The interface
correctly retained the Da-tolerance limitations and no-call explanations.
This fixture verifies execution and result plumbing, not scientific accuracy
on a representative study. The native app used a separate application ID so
its test history did not modify the installed application's history.

Browser tests use the explicit fixture bridge; they do not substitute for
native validation. On macOS, Playwright WebKit uses Option+Tab to include
buttons under the system's default keyboard-navigation preference. Linux
WebKit uses Tab. The new WebDriver Help test runs on Linux CI with actual
Enter/Escape events, not synthetic DOM key events.

## Scope limits

- The macOS validation build is a debug native executable with a production
  frontend, not a signed/notarized release installer. Linux and Windows
  platform checks are recorded by the pull request's CI jobs.
- Experimental CLI-only reports remain outside the setup form. The GUI's
  alkylation summary still uses mass-gap counts, not the separate reagent call.
- Existing Vite bundle-size warnings remain. No dependencies were added or
  upgraded.
- No release, tag or merge is part of this review.
