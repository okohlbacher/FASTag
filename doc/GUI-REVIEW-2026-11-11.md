# GUI correctness and beginner usability review

Reviewed the current `main` at `4fba712` on branch
`codex/gui-usability-review`. The supplied FASTag handoffs and earlier GUI
review provided context; the current CLI, parameter manifest, frontend and
tests determined present behavior.

## Design scope

The target scenario is a first-time user choosing spectra, understanding
what will run, resolving input checks and interpreting the results. Preserve
the existing four-view layout, task presets, OpenMS logo, system typography,
blue accent, light/dark tokens and native form controls. No dependency,
algorithm, parameter-default or report-format changes are needed.

## Findings and changes

| Finding | Change |
| --- | --- |
| Getting started described CLI defaults and a Tags landing page, but the app starts with Characterize and opens Overview. | Rewrote the first-run guide and Help around the actual task, 10% sample, input checks, output location and Overview. |
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

## Validation

`npm test`: 78 files passed, 921 tests passed, 16 skipped (the existing
external CLI/scratch-dependent cases). `npm run build`, `npm run build:e2e`
and `npm run check:dist` passed, including TypeScript checking and the check
that production assets contain no mock bridge or test fixtures.

`E2E_PORT=4187 npm run e2e -- --workers=4`: **182 tests passed** in
Chromium and WebKit. `git diff --check` also passed.

The browser suite uses the repository's explicit test bridge and committed CLI-output fixtures.
It covers setup, reports, batch handling, export, input checks and history in
Chromium and WebKit. Native-menu events are exercised through that bridge.

Visual review covers Setup in both themes at 960×600 and 1440×900. Run and the
plan remain visible and the page does not overflow. The
search test checks background inertness, keyboard scrolling, Escape, focus
return and view changes.

The manifest's names, defaults, types, restrictions and version were compared
with the base commit and are unchanged. Only two descriptions changed.

## Scope limits

- No packaged Tauri app or C++ binary was rebuilt in this review. The C++
  changes are help text only; native process execution and platform-specific
  file dialogs were not newly tested.
- Experimental CLI-only reports remain outside the setup form. The GUI's
  alkylation summary still uses mass-gap counts, not the separate reagent call.
- Existing Vite bundle-size warnings remain. No dependencies were added or
  upgraded.
- Changes are local; no release, merge or push was performed.
