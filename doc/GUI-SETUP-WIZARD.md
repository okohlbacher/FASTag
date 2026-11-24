# FASTag GUI: task-first Setup wizard (spec)

Status: design spec for branch `feat/setup-wizard` (from main 9e458de2,
FASTag 1.15.7), 2026-11-23. GUI only: no change to the CLI, its defaults or
`gui/src/params.generated.json`. It replaces the layout of
doc/GUI-WORKFLOWS.md section 3 (five stacked cards) and keeps its workflows
(section 1), their values, the product wiring (2.3) and Advanced (2.4).

The user's request: start by defining what we want to do (the task) in a
wizard-like setup; the task determines which inputs are needed (a FASTA on
top of the spectra for some tasks), so input fields appear only once they
are needed; the task tiles should be more expressive and explanatory. The
current screen was called "very, very convoluted".

Kept, unchanged in function: every CLI option stays reachable (Advanced and
the parameter search), presets, last-used, Undo, batch runs, open earlier
results, keyboard access, light and dark mode, the command preview (plan
line, Copy command line, Export INI…), the run bar's refusals and fixes,
the input checks (inspector), the History "Settings into form" path.

## 1a. Screen regions (UI refresh, feat/ui-refresh, 2026-11-24)

Every view (Setup, Results, Batch, History) is built from the same four
regions, so the title, the page actions, the primary action, status and
help are in the same place everywhere. This section overrides the layout
sketches below where they differ.

1. **App bar** (48 px, `shell/TopBar.tsx`). Left: logo, "FASTag", the views
   Setup / Results / Batch / History as underline tabs. Right, in this
   order: the run-status pill ("Idle", or the job's file, phase, % and
   ETA with an outlined **Cancel**, the run's one Cancel on every view;
   Esc or ⌘. cancel too), a quiet
   "FASTag ready" (a red chip only when FASTag cannot start), **Search
   settings… ⌘K** (works from every view and switches to Setup), **Help**
   (icon, F1), **Feedback** (icon, ⌘⇧F) and the **Theme** (icon, "Theme:
   System"). The version and "Built on OpenMS" are in About.
2. **Page header** (`shell/PageHeader.tsx`): the title (20 px), at most one
   line of context, the page actions at the right (secondary only), and
   under it the local navigation: the four Setup steps, or the result tabs.
   Setup: Presets and Open earlier results… on every step (Continue last
   run on step 1). Results: the run or file shown as the title, the
   workflow as context, Open tags… and Open report…. History: Open
   results….
3. **Content**: one column, at most 1200 px wide with a 24 px gutter
   (`.page-col`), the same left edge in every view.
4. **Action bar** (sticky bottom; Setup and Batch): at the left what is
   missing ("Still missing: …", shown once) and the plan line with Copy
   command line and Export INI…; at the right ‹ Back, Run and the step's
   Next. One button per screen is filled: Continue on step 1, Next on steps
   2 and 3, Run on step 4 and in Batch. A plain `<button>` is secondary;
   only `.primary` fills. While a run goes the bar shows its progress and
   an inert Running…, but no Cancel: that is the run-status pill's (1), as
   is the Results running state's (progress and Show log only).

Section labels use one style (12 px, semibold, muted, sentence case); empty
states use one component (`shell/EmptyState.tsx`). The app bar's Help opens
the Help page of the screen shown (the step, the result tab, Batch,
History); the per-field (?) popovers stay, page-level "Learn more" and
"How to read…" links are gone, and keyboard hints are tooltips or in Help.

## 0. Audit of the current Setup (main 9e458de2)

Screenshots at 1280x800, chromium, web harness (`gui/e2e-web`, mocked
backend), taken by the local, uncommitted `e2e-web/specs/zz-wizard-audit.spec.ts`:

- `before-export-tags*.png`, `before-mass-shift*.png`, `before-species*.png`
  in the scratch dir `wizard/` (suffixes: `-nofile` before Choose file…,
  none = full page with a file, `-fold` = first screen only, `-advanced` =
  Advanced open). Control inventories: `inventory-<task>.tsv`, page text:
  `text-<task>.txt`, same folder.

What the screen is today: one column of five numbered cards plus a sticky
run bar, all visible at once, whatever the task:

| Where | Control | Notes |
|---|---|---|
| Top bar | Setup / Results / Batch / History, Theme, Feedback, Help, status pill | not part of Setup; unchanged |
| (above cards) | Leftovers warning | shown after a run |
| 1 Input | One file / Batch switch; file chip with Choose file… / Change…; inspector (PreStartPanel: detected instrument, DIA check, Run anyway); head: **Open earlier results…**, (?) | Batch mode: Add files…, Add folder…, **Output folder** + Change…/Beside inputs, **SDRF file (optional)** Choose…/Replace…/Remove |
| 2 Workflow | 7 radio tiles (label + "→ product"); blurb line; head: **Preset** select (Choose…, Save as preset…, Load ›, Load FASTag defaults, Delete preset), origin name "(modified)", Reset, Apply last-used (n), Undo, Learn more | Save as preset opens an inline name field + Save/Cancel |
| 3 Settings | head: Search settings… ⌘K; the task's required inputs (Protein database + Browse… for Mass-shift, Database reduction); **Instrument** select (+ Custom tolerance); **Fixed modifications**; the task's basic fields; settings note (Database reduction) | Species: Report rank, Spectra to read. Generate tags: Seed length, Extension, E-value cutoff, Tags per spectrum, Per-residue confidence. Mass-shift: Extension, Missed cleavages |
| 4 Outputs | Output folder + Change…, Run name; "Some of these need the protein database" hint; products checklist (file names, "needed by", Change… per file, USI accession field, Set Extension to n) | Mass-shift lists 7 products; batch: one line instead of folder/name |
| 5 Advanced (n changed) | the task's own groups (open), "For every workflow" groups, **Other analyses** (closed; "add a report to this run"), each group: products, fields, "n more settings need X" + Turn on X | ~25 disclosures on Generate tags |
| Run bar | plan line ("Mass-shift survey on run01.mzML · 4 reports · all spectra"), Copy command line, Export INI…, Run; refusals with Fix buttons | |

What makes it convoluted (from the screenshots):

1. The task is the second card, but it decides what cards 3 to 5 hold; a
   new user reads Input first and does not know yet whether a FASTA is needed.
2. A required input (Protein database) sits in **Settings**, between
   Instrument and Fixed modifications, not with the spectra. The Outputs card
   and the run bar both repeat "needs the protein database" while the field
   is one card up.
3. Seven tiles are one line each ("Mass-shift survey → shift table"); the
   explanation is a single grey line that changes under the grid. Nothing says
   what a task needs or when not to use it.
4. All five cards plus the run bar are on one page: on Mass-shift survey the
   first screen ends in the middle of the product list (`-fold.png`); Advanced
   adds about 25 disclosures.
5. The Preset select, origin label, Reset, last-used, Undo and Learn more all
   share the Workflow card's head with the tile grid.
6. Batch mode puts the output folder in the Input card, one-file mode in the
   Outputs card.

## 1. Principles

1. **Task first.** Step 1 is the only question on screen until it is answered.
   The task decides which inputs, settings and products follow.
2. **Show an input only when the task needs it.** Required inputs are on
   screen; optional ones are one click away with the effect they have; inputs
   a task never uses are not shown (still reachable through Advanced or the
   parameter search, see 6). An input that is set but not part of the task is
   never hidden: step 2 lists it under "Also set" (5.2 `extraneous`).
3. **One source of truth.** The wizard is a view of `useSession` (values,
   origin, input, mode) and `useRun` (jobs, out dir). The step, the
   confirmation and the revealed inputs are the only new state. "Needed
   inputs" is derived from `tasks.ts`, `setup/inputs.ts` and the manifest,
   never stored.
4. **Nothing is lost.** Every control of section 0 has a place in section 7.
   Every CLI option stays reachable from every step. CLI defaults do not change.
5. **Fast path stays fast.** Cold start to Results: Continue, Choose file…,
   Run (3 actions; today 2), or a dropped file and Run (2). Run is never more
   than one click away once the run is valid (run bar on steps 2 to 4).
6. **Browsing is free.** Looking at tiles, steps or the detail panel never
   replaces the form; only Continue, a preset, last-used, History or a drop
   does.

## 2. Layout

```
[App bar: FASTag  Setup Results Batch History        Idle · FASTag ready · Search settings ⌘K · Help · Feedback · Theme]
[Page header: Inputs for Mass-shift survey                      Presets [Choose… ▾]  Open earlier results…]
[             Needs spectra + a protein FASTA.                                                           ]
[Steps:  ✓ Task Mass-shift survey   (2) Inputs run01.mzML   (3) Settings   (4) Outputs & run              ]
[Leftovers warning, when there is one]
┌ step body (one step visible, the 1200 px content column) ─────────────────┐
│ ...                                                                       │
└───────────────────────────────────────────────────────────────────────────┘
[Action bar: Still missing: … · plan line · Copy command line · Export INI…      ‹ Back  Run  Next: Settings ›]
```

**Mounting:** all four step bodies are rendered; the inactive ones carry
`hidden`. The parameter IDs (`p-<name>`, `out-<name>`), the ⌘K focus targets
and each ParamField's state survive a step change; the stepper only switches
which body is visible. Controls that must exist once (the Presets menu) are
rendered only in the visible step.

### 2.1 Stepper header

- Four steps, by name: **Task**, **Inputs**, **Settings**, **Outputs & run**.
  An ordered list of buttons (`<nav aria-label="Setup steps"><ol>`), the
  current one `aria-current="step"`.
- Each step shows its state: current, done (✓), blocked (! with the reason as
  its accessible description, e.g. "Protein database missing"), or locked.
- **Reachability** (derived, `stepState`, 5.2): only "no task confirmed"
  locks steps 2-4. Locked steps keep focus (`aria-disabled="true"` plus
  `aria-describedby` "Choose a task first"), never `disabled`. Once a task is
  confirmed all four steps are navigable; a step with an error shows "!".
- The steps are underline tabs under the page title, with a numbered
  circle (done: a green check). Step 1's button names the task once one is
  confirmed, in muted text after the label (accessible name **Task: <label>**):
  **the task can be changed from any step** (section 4). With the defaults
  origin it reads **Task: FASTag defaults (no workflow)** (5.5).
- Step 2's button names the current spectra ("Inputs run01.mzML", "Inputs 3
  files"). The file is changed with **Change…** on its card in step 2, with
  **Change spectra…** at the right of the steps (one file, once a task is
  chosen, on every step but Inputs), or ⌘O from any step.
- **Search settings… ⌘K** (and `/`) is in the app bar: it searches every
  option from every view and switches to Setup (section 6).

### 2.2 Action bar

- **‹ Back** and **Next: <step name> ›** sit at the right of the sticky
  action bar, so they never move. Next is always enabled once a task is
  confirmed; when something is missing the bar says so once, at its left
  ("Still missing: Protein database"), and Next lands on the next step
  anyway. Only Run is blocked, as today (`canRun`). On steps 2 and 3 Next is
  the filled button and Run is secondary; on step 4 Run is the filled one.
- Keyboard: Back/Next are ordinary buttons; Alt+← / Alt+→ go to the
  previous/next step (not while typing in a field). ⌘1-4 stay the view
  shortcuts (shortcuts.ts VIEWS).
- ⌘↩: on steps 2-4 it is Run, as today. On step 1 it confirms the selected
  tile; with the inputs set it then runs, otherwise it opens step 2 with the
  missing input shown.
- Focus: on a step change, focus goes to the step's heading (`h2`,
  `tabIndex=-1`) and a polite live region says "Step 2 of 4: Inputs".

### 2.3 Run bar and batch

The run bar (RunBar + PlanFooter) is the action bar of steps 2, 3 and 4 in
one-file mode (step 1 has its own bar with Continue and no Plan, as no task is
confirmed yet). Run is enabled when the run is valid, as today (`canRun`,
`session.blocked`, inspector held). Its refusals and fixes are unchanged; a
refusal whose first parameter is a step-2 input adds **Go to Inputs**, one
naming a step-3 setting **Go to Settings**. The plan line also names the
assumptions about the sample (instrument preset, fixed modifications), so
they are visible from every step.

**Batch mode (option b).** With a queue the run bar and the log drawer stay
in the Batch view (`runBarView`, unchanged). Setup's action bar (NavBar) keeps
Back and Next and puts **Run n files** in Run's slot on steps 2-4: secondary
beside Next on steps 2 and 3, the filled button on step 4, so the run control
never sits in the content. Once every file has run and some failed, the slot
holds **Retry failed** instead; the Batch view's bar does the same (Retry
failed filled, no disabled "Run 0 remaining files"; with nothing failed, a
disabled "All files run"). The step-2 queue block holds **Open the batch**,
and the batch output folder (Change…, Beside inputs) stays next to the queue
in step 2, where it is today. Step 4 shows the batch output folder as a
read-only line with a link to step 2, so it has one control. Many files:
tile, Continue, Add folder…, Run n files (in the bar).

## 3. The steps

### Step 1: What do you want to do?

Heading: **What do you want to do?** Under it, one line of context
(`#not-search-engine`): "FASTag reads sequence tags from MS/MS spectra. It is
not a search engine." The recommendation is the "Start here" chip (its tooltip: "Recommended to start")
of Characterize a run; no paragraph above the tiles.

The "start from" row (`StartRow`), the page actions of step 1:

- **Continue last run** (when the last session recorded settings, D6):
  "Continue: <workflow of the last run> with your last settings (n)". Click =
  `applyLastUsed()`; goes to step 2 only if an input of the task is missing,
  else stays.
- **Presets ▾** (`PresetMenu`): Load <name>, Load FASTag defaults, Delete
  preset <name>. The same component is in the page header of every step
  (with Save as preset… on step 3). Loading from step 1 goes to step 2 only
  if an input of the new task is missing; on the other steps it stays.
- **Open earlier results…** (secondary button): `openResults()`, goes to
  Results.

Tiles, in three groups, each a `<ul>` under an `h3`:

| Group | Tiles |
|---|---|
| **Look at the tags** | Generate tags |
| **Learn about the sample** | Characterize a run (Start here) · Species · Mass-shift survey · Database reduction |
| **Check run quality** | Run QC · Identifiability triage |

**Two levels.** A tile (about 70 px high, 3-4 per row at 1280 px, 1 per row
under 640 px) shows the icon, the label, the plain question and one badge
("needs FASTA", "IDs optional"), plus "Current" on the current task and
"Start here" on Characterize. The selected tile fills one shared
**detail card** beside the grid (300 px; under it below 820 px): the task's
name, then You get, You need and Run time, and **More about this task**, which
opens Help at the task (Getting started › The seven tasks: Use when, Not
for). Tiles sit three to a row (two below 1100 px). Step 1 fits at 1280x800
without vertical scrolling.

Detail texts (new fields in `tasks.ts`, 5.1; written as consequences, without
format names; the blurb stays for the plan line, History and the Overview):

| Task | Question | You get | Use when | Not for | Run time |
|---|---|---|---|---|---|
| Generate tags | Which sequence tags do my spectra carry? | a table of tags per spectrum with a confidence per residue, for assembly or other tools | de novo assembly, export of tags to other tools | identifying peptides: these are tags, not identifications | short: tagging only |
| Characterize a run | What was done to this sample before it was measured? | the protease, labels, glycopeptides and species, from 10% of the spectra | an unknown or legacy data set, before choosing search settings | a final call on very few spectra: the calls then say "too little evidence" | short: 10% of the spectra |
| Species | Which organisms does my sample contain? | only the species, ranked at a rank you choose (Characterize a run includes this) | contamination checks, mixed or unknown samples | ion-trap data: the calls are unreliable at the wide tolerances it needs | short; 10% of the spectra is usually enough |
| Mass-shift survey | Which modifications does my sample carry, without guessing them first? | the mass shifts between tags and your proteins, with sites and modification names | unexpected or unknown modifications | confirmed identifications: shifts and placements are candidates without FDR control | longer: places every tag on the FASTA |
| Database reduction | Can my search use a smaller database? | files to run your own Sage, Comet or MSFragger search with: a protein shortlist, a reduced FASTA and its settings | large or multi-species databases before a search | a final result: it may drop proteins your full search would find; compare with a full search before relying on it | longer: places every tag on the FASTA |
| Run QC | Is this run usable, and how was it measured? | a QC report: spectra counts and resolution per analyzer, charges, labels, tag yield, instrument | checking a run before analysis, comparing runs in a batch | sample content: use Characterize a run | short: tagging only |
| Identifiability triage | Which spectra could be identified but were not? | every spectrum ranked by how identifiable it is, and marked when your search found it | finding missed identifications after a search | Batch mode with identifications: one ID file cannot belong to every input | short: tagging plus one row per spectrum |

Rules for the tile text: plain language, no CLI flag; the texts derive from
tasks.ts blurbs, products.ts `what`, the README and the help pages, and the
"Not for" lines repeat caveats the GUI already states (no new claims). Run
time: only a class, never a number (only tagging speed is measured: README
Performance, doc/BENCHMARK-DirecTag.md). The badges come from the derived
inputs (5.2). The icons are new inline SVGs in `icons.tsx` (16 px,
`currentColor`, `aria-hidden`), no icon library.

**Selection and Continue.** Each tile is a `<button data-task=id>` named by
its label, `aria-describedby` its question and You need line, the current
task `aria-current="true"` with the visible text "Current". Click, Space or
Tab focus selects the tile and fills the detail panel; nothing is replaced.
Arrow keys move focus within the grid (a plain focus group, no radio
semantics). **Continue with <task> ›** at the right of the action bar (and
Enter on a tile) confirms it: `chooseTask` runs only then, so browsing never
takes Undo snapshots or shows drop messages. More about this task is a
sibling button in the detail card, never inside a tile.

- On a fresh launch the current task is Generate tags (LANDING, values
  unchanged) and it is the selected tile; nothing is confirmed. Continuing
  with the current, unmodified task does not replace the form.
- After Continue the wizard opens step 2 when an input of the task is missing
  (spectra, a required FASTA), else the step the user came from (step 2 on
  the first confirmation).

**Other entry paths:**

- ⌘O (`open-spectra`) and a dropped spectra file replace the file and keep the
  current step when a task is confirmed. On an unconfirmed launch they confirm
  the selected tile and open step 2, with Run enabled.
- History "Settings into form" (`takeRun`) confirms the run's task and opens
  step 2 when an input is missing or not found, else step 4.
- The Overview's "Add … and run again" (`rerunWith`, `overviewAction`) keep
  their behaviour: apply the fix, then run when `canRun`. Only when the run is
  held open Setup at the step that holds it (Inputs for the input checks,
  Settings otherwise).
- A ⌘K hit opens the step that owns the option (section 6).
- The wizard keeps its current step across view switches and runs. It never
  resets within a session; a new launch opens step 1.

### Step 2: Inputs

Heading: **Inputs for <task>**. Line under it: "<task> needs <you need>."

Order:

1. **Spectra** (always first). One file | Batch switch, then:
   - One file: the file chip (Choose file… / Change…, drop target), then the
     input checks (PreStartPanel) under it, as today.
   - Batch: Add files…, Add folder…, the queue count, **Open the batch**
     (**Run n files** is in the action bar, 2.3), the batch output folder (Change…, Beside inputs) and the SDRF
     file (mode-level input, Batch only; in One file mode a set SDRF shows as
     "used only in Batch mode").
2. **Required inputs**, each a file field with Browse…, a help line ("A
   protein FASTA of your organism, e.g. its UniProt reference proteome") and
   the "required" chip: Protein database for Mass-shift survey and Database
   reduction only. When the Filter database (`fasta`) stands in for it (the
   CLI rule "give -recon_fasta (or -fasta)"), the field reads "Using your
   Filter database: x.fasta" with **Choose another**, never "not set".
   What is required follows the products that are on, not only the task: a
   report that needs the protein database (Tag placements, the shortlist, the
   reduced FASTA, the search-engine configuration, turned on under Advanced in
   any other task) makes Protein database a required input here, the line
   under the heading says "Also required for Tag placements: a protein FASTA",
   and the field leaves Advanced while it is required. The step-4 hint and the
   run bar's "Go to Inputs" lead to it.
3. **Optional inputs already set**, then those revealed, each with its effect
   line and **Remove** (Remove clears the whole set: taxonomy = three files).
4. **Add optional input ▾** (only when the task has unset optional inputs):
   each entry is the input's name and its effect line. Choosing one shows its
   field, focused.
5. **Also set**: inputs that hold a value but have no control for this task
   (from last-used or History), or are invalid in the current mode, each with
   its effect and **Remove**; the step badge shows "!" while one is present.
   An input whose field is under Advanced for the task (Run QC's Filter
   database, Characterize's Protein database) is no entry: it is the user's
   setting, sent and shown where it was set.
6. **About these spectra**: Instrument (preset; "(detected)" from the input
   checks, or "not detected: choose"), Fixed modifications ("Was the sample
   alkylated? Carbamidomethyl (C) is for alkylated samples; remove it if
   not."). For Database reduction also Search engine (and the Comet template
   when it is Comet) and Protease. When the detected or chosen instrument is
   an ion trap and the task is Species or Characterize, an inline warning.

Optional inputs per task (`optionalInputs` in tasks.ts, names only; the effect
lines live once, in `setup/inputs.ts` `INPUTS`, taken from the existing hints
and SECTIONS blurbs):

| Task | Required | Optional |
|---|---|---|
| Generate tags | | Filter database (`fasta`); Entrapment database (`entrapment_fasta`), offered once a Filter database is set |
| Mass-shift survey | Protein database (`recon_fasta`, or `fasta`) | Filter database (`fasta`; its menu entry says it also stands in for the Protein database); Entrapment database, offered once a Filter database is set |
| Species | | Your taxonomy (`taxdb` + `taxonomy_nodes` + `taxonomy_names`, one entry) |
| Characterize a run | | Your taxonomy (one entry, as above) |
| Database reduction | Protein database (`recon_fasta`, or `fasta`) | Filter database (`fasta`, as for Mass-shift survey); Entrapment database after it; Background proteins (`shortlist_background`) |
| Identifiability triage | | Identifications (`census_ids`), One file mode only |
| Run QC | | none |
| FASTag defaults (5.5) | | every step-2 input |

Effect lines start with the effect on results: Filter database "Removes tags
not found in these proteins."; Entrapment "Adds a false-match rate from
proteins the sample cannot contain."; Background "Always kept in the reduced
FASTA: host and contaminant proteins."; Identifications "Marks the spectra your
search identified; needs q-values."; Taxonomy "Your own species index and
taxonomy instead of the bundled ones. Leave all three empty to use the bundled
ones."

Settings of Advanced that depend only on a step-2 input of the task (Shortest
tag matched under the Filter database) render under that input once it is set
and leave Advanced (5.4). The Triage settings that wait on Identifications
(ID q-value, Triage E-value) stay in step 3 and appear once it is set.

**Validation, inline under each field** (`aria-invalid`, `aria-describedby`):

- Missing required input: "Required for <task>: choose a protein FASTA."
  Shown once the user has tried Next or Run, or left the field.
- Wrong extension, from the manifest's `formats` (pure, `inputs.ts`
  `extensionWarning`): "x.txt is not a FASTA file (.fasta, .fa, .faa)." A
  warning, not a block: the CLI decides.
- File not found: `pathStatus(paths)` (5.6). "Not found: <path>". It blocks
  Run like a missing input. Sources: a path from last-used or History (presets
  hold no paths).

### Step 3: Settings

Heading: **Settings for <task>**. Origin row: the origin, "(modified)",
**Reset**, **Undo**, and the inline name field of **Save as preset…** (chosen
from Presets in the page header).

Body: the task's basic fields (`basic`, settings only), with a brief only
where it states a default or a rule ("0 keeps all"; the rest is in each
field's (?) popover);
the task's settings note (Database reduction); **Advanced (n changed)**,
collapsed: today's Advanced minus the step-2 controls of this task (5.4). An
empty group is not rendered. A "Turn on X" whose master is a step-2 input
reads "Set X in Inputs" and opens step 2 with X revealed and focused.

### Step 4: Outputs & run

Heading: **Outputs and run**.

1. **Where**: one file: Output folder (Change…) and Run name. Batch: the batch
   output folder as a read-only line with "Change in Inputs".
2. **Products** checklist of the task (`outputs`), unchanged. The "needs the
   protein database" hint becomes a link to step 2.
3. **Command preview**: behind a **Command line** disclosure, the full command
   line as text (read-only, monospace, wraps;
   `window.fastag.commandLine(run.paramsFor())`, refreshed on change,
   debounced). Copy command line and Export INI… are in the action bar.
4. **Add to batch** (one-file mode, with a file): queues the file, switches to
   Batch mode with the same settings; the Batch view opens as it does for the
   first queued file. Disabled while Identifications are set ("Not used in
   Batch mode: one ID file cannot belong to every input").
5. There is no Last run block: a finished run opens in Results, and History lists every run with its status.

## 4. Changing the task from any step

- Click "Task: <label> ✎" or step 1 in the stepper: step 1 opens with the
  current task selected. Browsing changes nothing.
- **Continue** with another task calls `chooseTask(id)`. Every form
  replacement (`chooseTask`, `applyPreset`, `chooseDefaults`, `applyLastUsed`,
  `resetToOrigin`) goes through `replaceForm`, which calls the pure
  `carryInputs(prev, next, task)`:
  - Input files the new task needs or offers (`inputParams`) keep their value
    when the new values hold none; the others are dropped.
  - The common block (fragment tolerance, its unit, ion series, hybrid ion
    series, fixed modifications) keeps the user's values when they differ
    from the previous origin's; the instrument choice stays.
  - The task's own `basic` and product values are replaced.
  - `takeRun` is the exception: it brings its own paths.
- One status line (role="status") under the stepper says what happened, with
  Undo: "Kept: instrument, Protein database. Dropped for Species: Background
  proteins. Replaced: 3 settings of Generate tags. Undo".
- After choosing, the wizard goes to step 2 only if an input of the new task
  is missing; otherwise it returns to the step the user came from.

## 5. Data flow

### 5.1 One table: tasks.ts

New fields on `Task`, the only new data:

```ts
question: string; gets: string; use: string; notFor: string
time: 'short' | 'longer'; timeNote: string
group: 'tags' | 'sample' | 'quality'
recommended?: true          // Characterize a run
/// Inputs the task can use but does not need, by name, in menu order.
optionalInputs?: string[]
/// Settings shown in step 2 "About these spectra" (Database reduction:
/// search_engine, search_config_template, shortlist_protease).
about?: string[]
```

`required` stays (`recon_fasta` for Mass-shift and Database reduction).
Input-file fields leave `basic` (`basic` becomes settings only; the about
fields leave it too), so no list names a control twice.

### 5.2 Derived: setup/inputs.ts (pure)

```ts
export const INPUTS: Record<string, InputInfo>   // every manifest input-file param: where it lives and its effect
export function inputParams(task: Task | null): Set<string>
export function taskInputs(task: Task | null, values, mode): {
  required: string[]; shown: string[]; addable: string[]; extraneous: { name: string; why: string }[]
}
export function missingInputs(task: Task | null, values, ctx): string[]
export function extensionWarning(name: string, path: string): string | null
export function stepState(ctx): Record<1 | 2 | 3 | 4, 'done' | 'current' | 'blocked' | 'locked'>
export function carryInputs(prev, next, task, prevOrigin): { values; kept; dropped; replaced }
export function stepTwoDependents(task: Task | null): Map<string, string[]>
```

`INPUTS` classifies every input-file param once: `step2` (may be a step-2
input), `setting` (lives beside a setting: the Comet template), `advanced`
(model and parameter tables), `hidden` (spectra, probe_input, the removed
species_reagents). A unit test checks every manifest input-file param has a
class, that every `also` set matches a `conflicts()` set rule, and that no
effect line is defined twice. "fasta stands in for recon_fasta" is stated
once, from the CLI rule (`STANDS_IN`).

### 5.3 State

| State | Lives in | New? |
|---|---|---|
| task (origin), values, input, out, mode, presets, last-used, Undo | `useSession` | no |
| batch queue, output folder of a batch, run state | `useRun` | no |
| current step | `useSession` (`step`, `setStep`) | **yes** |
| task confirmed on this launch | `useSession` (`taskConfirmed`); false on a plain launch, true after Continue, preset, last-used, History, drop, or a launch that names its origin (test harnesses, e2e `?start=`) | **yes** |
| selected tile | `useSession` (`tile`) | **yes** (UI) |
| optional inputs revealed but still empty | `useSession` (`revealed`) | **yes** (UI) |
| the last carry-over (kept, dropped, replaced) | `useSession` (`carried`) | **yes** (UI) |
| reachability, step badges, needed inputs | derived each render (`inputs.ts`) | no |
| file existence | `usePathStatus` cache keyed by path | cache |

Nothing new is persisted. The step is not persisted.

### 5.4 Advanced without duplicates

`advancedParams(task)` additionally excludes `inputParams(task)`, the about
fields and `stepTwoDependents(task)`, so each option has exactly one control
for the task. For another task the same option is under Advanced as today.
`unplacedParams()` stays the safety net.

### 5.5 No workflow: the FASTag defaults origin

`taskOf(DEFAULTS)` is undefined; the wizard treats it as the pseudo-task
"defaults" (`task = null` in inputs.ts). Paths there: Load FASTag defaults, a
preset saved over the defaults, History "Settings into form" of a record
without a workflow, `?start=defaults` (e2e fixtures) and `fromDefaults()` in
app.test.mjs. Stepper label "Task: FASTag defaults (no workflow)"; no
required inputs; step 2 `shown` = every step-2 input with a value, `addable`
= every other step-2 input; steps 3 and 4 show the layout of Generate tags (the
landing task) as today, with all of Advanced. `taskInputs`, `inputParams` and
`stepState` take `Task | null`.

### 5.6 pathStatus

New backend command `path_status(paths) -> [{path, exists, kind}]` (Rust,
cargo test; the web mock answers from its fixture list; missing paths are
those named `*missing*`). The GUI checks only the input-file values step 2
shows, debounced.

## 6. Parameter search (⌘K) and reachability of every option

The search is in the app bar and works from every view (it switches to
Setup). A hit opens the
step whose body holds the control (`data-step` of the element found), first
revealing an unset optional input of step 2, then focuses it as today:

| Option | Step |
|---|---|
| `in`, an input in `inputParams(task)`, an about field | 2 |
| `basic`, anything under Advanced | 3 |
| a product of `task.outputs`, its file (`ownerOf`) | 4 |

## 7. What is removed or moved

Nothing is dropped. Every control of the audit (section 0):

| Control (today) | Today | Wizard |
|---|---|---|
| Task radios (7, one line each) | 2 Workflow | Step 1 tiles, grouped, with the detail panel; Continue |
| Blurb line under the grid | 2 Workflow | the detail panel (blurb kept in tasks.ts for plan line, History, Overview) |
| Preset select: Load, Load FASTag defaults, Delete | 2 Workflow head | Presets ▾ in the page header of every step (one component) |
| Preset select: Save as preset… (+ name, Save, Cancel) | 2 Workflow head | Presets ▾ on step 3; the name field in step 3's origin row |
| Origin "(modified)", Reset, Undo | 2 Workflow head | Step 3 head; Undo also in the carry-over status line |
| Apply last-used (n) | 2 Workflow head | Step 1 "Continue last run" |
| Learn more (task) | 2 Workflow head | More about this task (detail card); the app bar's Help on step 3 |
| Open earlier results… | 1 Input head | Page header, right, every step |
| One file / Batch switch, file chip, Choose/Change, Add files…, Add folder… | 1 Input | Step 2, Spectra |
| Input checks (PreStartPanel) | 1 Input | Step 2, under the file |
| Batch output folder (Change…, Beside inputs) | 1 Input | Step 2, next to the queue; step 4 read-only |
| SDRF file (optional) | 1 Input (Batch) | Step 2, Batch mode |
| Help on input files (?) | 1 Input head | The app bar's Help on step 2 |
| Search settings… ⌘K | 3 Settings head | App bar (every view) |
| Protein database (required) | 3 Settings | Step 2, required, Mass-shift and Database reduction only |
| Background proteins, Identifications | 3 Settings | Step 2, Add optional input |
| Instrument, Fixed modifications | 3 Settings | Step 2, About these spectra |
| Search engine, Comet template, Protease (Database reduction) | 3 Settings | Step 2, About these spectra |
| Basic fields, settings note | 3 Settings | Step 3 |
| Output folder, Run name, products checklist, Help on output files | 4 Outputs | Step 4 |
| "Some of these need the protein database" | 4 Outputs | Step 4, as a link to step 2 |
| Advanced (n changed), all groups, Turn on buttons | 5 Advanced | Step 3, collapsed; minus the task's step-2 controls (5.4) |
| Taxonomy group for Species / Characterize | Advanced | Step 2 optional input (one entry); Advanced for others |
| Filter / entrapment database, Shortest tag matched for Generate tags | Advanced | Step 2; Advanced for others |
| Protein database of Characterize (alkylation) | Advanced | Advanced, unchanged (review decision 5) |
| Last run block | above the cards | removed (Results and History) |
| Leftovers warning | above the cards | under the stepper, every step |
| Locked summary while running | replaces the form | unchanged, replaces the step bodies; stepper hidden |
| Unplaced/unknown parameter warning | under the cards | under the step body, every step |
| Run bar | sticky | sticky on steps 2-4 (one file); refusals link to their step |
| — | — | New: stepper, Back/Next, Continue, detail card, command preview, Add to batch, Add optional input, Also set, file-not-found check |

## 8. Implementation order (local commits on feat/setup-wizard)

1. This spec revision.
2. `tasks.ts` tile fields and `optionalInputs`/`about`, inputs out of
   `basic`; `setup/inputs.ts` with unit tests.
3. `pathStatus` backend command (Rust + cargo test), api.ts, the mocks.
4. `useSession`: `step`, `taskConfirmed`, `tile`, `revealed`, `carried`;
   `replaceForm` carries inputs and the common block; tests.
5. The wizard: `Stepper`, `TaskStep` (tiles, detail panel, PresetMenu),
   SetupForm cut into step bodies; App routing (drop, ⌘O, ⌘↩, rerunWith,
   search, History).
6. Help and UI text: help/content.tsx (lines 108, 150, 157, 170, 238-252, 571,
   1213), help/workflows.tsx (49, 147), results/GlycoTable.tsx:39,
   DigestPanel.tsx:636, the conflict notes ("choose one in Inputs"); banned
   terms 'Input card', 'Outputs card', 'Workflow card', 'Settings card',
   'Apply last-used', 'Preset select' in help-docs.test.tsx plus a grep over
   src/**/*.tsx. doc/GUI-WORKFLOWS.md section 3 points here. CHANGELOG.
7. Port tests (section 9), screenshots.

## 9. Test plan

Unit (vitest):

- `inputs.ts`: per task, `required`/`addable` match the step-2 table; `fasta`
  stands in for `recon_fasta`; `entrapment_fasta` offered only with `fasta`;
  `census_ids` not addable in Batch mode and listed as extraneous there; a set
  input with no control for the task is extraneous, one set under Advanced is
  not; `extensionWarning`; no input in both
  `inputParams(task)` and `advancedParams(task)`; every manifest input-file
  param classified; every `also` set is a `conflicts()` set; task null.
- `tasks.ts`: every task has question, gets, use, notFor, time, group; no
  input-file param in `basic`.
- `useSession`: a protein FASTA survives Mass-shift → Database reduction,
  Reset, and Load preset; dropped to Species and reported; Undo restores it;
  the common block is kept across a task change; choosing the current
  unmodified task does not replace the form; `taskConfirmed` false at launch,
  true after Continue/preset/last-used/takeRun.
- `stepState`: locked only with no task confirmed; blocked for a missing FASTA
  or file; Settings reachable with Inputs blocked.

Component (`*.app.test.tsx`): port the setup, setupScreen, round2, review
rounds, overview, inspector, batch tests to step navigation (`showStep`);
new wizard.app test: selecting a tile does not choose; Continue chooses;
focus on the step heading; live region text; ⌘↩ on step 1; Alt+→ does not
fire inside a text field; "run, back to Setup, Change…, Run" in 2 actions.

Playwright web (`npm run e2e`): port every spec that uses the card regions
(setup, smoke, shell, layout, themes, screens, workflow-tabs,
workflow-counts, p0b, p1a, p4c, safety, inspector, history, overview,
perf-log, help-navigation, batch, batch-summary, sdrf, parameter-search);
fixtures.ts `start=defaults` opens confirmed. New wizard.spec: the
not-a-search-engine line on step 1; step 1 without vertical scroll at
1280x800; Generate tags has no FASTA field in step 2; Mass-shift: FASTA
required, wrong-extension warning, not-found error from the mock; Species:
Add optional input offers taxonomy only; Mass-shift with no file → step 3 →
Save as preset; batch: Add folder then Run in at most 2 actions after the
tile; screenshots of all steps for Generate tags, Mass-shift survey and Species
at 1280x800, light, and one in dark (`after-*.png`).

Installed-app suites (`gui/e2e-tauri/app.test.mjs`, `windows.test.mjs`):
`task(s,label)` selects `[data-task=id]` and clicks Continue; `chooseInput`
chooses a task first; `runOn` reads the run name after `toStep('Outputs &
run')`; `fromDefaults` goes through Presets › Load FASTag defaults;
`setThreads` goes to Settings first; the help test reads the value after
`toStep('Settings')`; a cold-start test (Continue, Choose file…, Run).

Rust: `cargo test` in gui/src-tauri for `path_status`.

## 10. Review decisions

The design review of the first draft (23 issues). Each adopted or rejected:

1. Step 1 suggests FASTag identifies proteins — **adopted**: group "Learn
   about the sample", the fixed not-a-search-engine line, Database reduction's
   "files to run your own search with"; wizard.spec checks the line.
2. Tiles as a wall of jargon — **adopted**: two-level tiles with one shared
   detail panel, consequence language without format names, a no-scroll test.
3. No recommended start — **adopted in part**: "Not sure? Start with
   Characterize a run" and a Recommended badge; Species says Characterize
   includes it. The selected tile at launch stays the current task (Export
   tags), because a drop or ⌘O on a fresh launch confirms the selected tile and
   must keep running the landing task's values.
4. Sample facts hidden in step 3 — **adopted**: "About these spectra" in step
   2 (instrument, fixed modifications; Database reduction: engine, template,
   protease), the plan line names instrument and fixed modifications, ion-trap
   warning for Species and Characterize. The fixed modifications control stays
   the list field (with the alkylation question as its help line): a yes/no
   would hide other fixed modifications.
5. Five FASTA fields, cross-step dependencies — **adopted in part**:
   (Mass-shift first dropped the entrapment entry; the walkthrough review of
   2026-11-23 restored it, with the Filter database as a menu entry, because
   a stand-in removed from Advanced had no control left.) The stand-in reads "Using your
   Filter database"; effect-first reason lines; the help line on the required
   field; a test that every `after` names an input of the same step.
   Characterize's `recon_fasta` is **not** moved into step 4's alkylation row:
   it stays one control in Advanced (Placement on the database), where it is
   today, and the alkylation note already names it; a second control would
   break "one control per option".
6. Auto-advance on tile click — **adopted**: select, then Continue.
7. Settings and Outputs locked — **adopted**: steps reachable once a task is
   confirmed; Next always enabled; a wizard.spec preset case without a file.
8. Batch run bar — **adopted, option (b)**: Run n files in the action bar's
   Run slot (filled on step 4), Retry failed in that slot after a failed
   batch, batch output folder stays in step 2, step 4 read-only.
9. Re-running with a changed input — **adopted**: the step is kept, Change
   spectra… in the stepper row, ⌘O/drop rules, a 2-action test.
10. Presets only on step 1, loading wipes inputs — **adopted**: PresetMenu
    on steps 1 and 3; every replacement carries inputs; "preset" removed as a
    file-not-found source.
11. Task change replaces tuned settings — **adopted**: return to the previous
    step unless an input is missing; the common block is kept; one status
    line.
12. Overview "run again" and ⌘↩ on step 1 — **adopted** (2.2, step 1 entry
    paths).
13. FASTag defaults origin — **adopted** (5.5).
14. Taxonomy split — **adopted**: one entry with `also`, tested against
    `conflicts()`.
15. Hidden extraneous inputs — **adopted**: `extraneous` / "Also set";
    presets carry no paths.
16. Carry-over only for chooseTask — **adopted**: `carryInputs` inside
    `replaceForm`.
17. "One table" not one table — **adopted in part**: `INPUTS` classifies
    every input-file param once with its effect line; `optionalInputs` is
    names only; SDRF is mode-level. The alternative "fasta for recon_fasta"
    stays out of tasks.ts (`required` keeps its shape): it is a CLI rule, not
    a per-task choice, so it lives once in inputs.ts beside the paramLayout
    conflict it mirrors. The classification lives in inputs.ts, not PARAM_UI,
    so paramUi.ts (the manifest's UI table) is not widened by a GUI-layout
    concern; the coverage test gives the same guarantee.
18. Orphaned dependent settings — **adopted**: empty groups not rendered;
    dependents of a step-2 input render under it; "Set X in Inputs".
19. Step locking contradicts routes — **adopted** (2.1).
20. Mounting undecided — **adopted**: all four bodies mounted, `hidden`;
    helper rewrites listed in section 9.
21. Invalid tile ARIA — **adopted**: buttons in lists, `aria-current`, Learn
    more outside the tile.
22. Help migration under-scoped — **adopted** (section 8, item 6).
23. Batch with census_ids, Add to batch — **adopted**: extraneous with the
    Batch reason; Add to batch disabled while set; SDRF shown as "used only
    in Batch mode" in One file mode.
