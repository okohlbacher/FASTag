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
| (above cards) | Leftovers warning; **Last run** block (status, duration, changed params, Reveal, Open folder) | shown after a run |
| 1 Input | One file / Batch switch; file chip with Choose file… / Change…; inspector (PreStartPanel: detected instrument, DIA check, Run anyway); head: **Open earlier results…**, (?) | Batch mode: Add files…, Add folder…, **Output folder** + Change…/Beside inputs, **SDRF file (optional)** Choose…/Replace…/Remove |
| 2 Workflow | 7 radio tiles (label + "→ product"); blurb line; head: **Preset** select (Choose…, Save as preset…, Load ›, Load FASTag defaults, Delete preset), origin name "(modified)", Reset, Apply last-used (n), Undo, Learn more | Save as preset opens an inline name field + Save/Cancel |
| 3 Settings | head: Search settings… ⌘K; the task's required inputs (Protein database + Browse… for Mass-shift, Database reduction); **Instrument** select (+ Custom tolerance); **Fixed modifications**; the task's basic fields; settings note (Database reduction) | Species: Report rank, Spectra to read. Export tags: Seed length, Extension, E-value cutoff, Tags per spectrum, Per-residue confidence. Mass-shift: Extension, Missed cleavages |
| 4 Outputs | Output folder + Change…, Run name; "Some of these need the protein database" hint; products checklist (file names, "needed by", Change… per file, USI accession field, Set Extension to n) | Mass-shift lists 7 products; batch: one line instead of folder/name |
| 5 Advanced (n changed) | the task's own groups (open), "For every workflow" groups, **Other analyses** (closed; "add a report to this run"), each group: products, fields, "n more settings need X" + Turn on X | ~25 disclosures on Export tags |
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
   screen; optional ones are one click away with the reason they exist; inputs
   a task never uses are not shown (still reachable through Advanced or the
   parameter search, see 6).
3. **One source of truth.** The wizard is a view of `useSession` (values,
   origin, input, mode) and `useRun` (jobs, out dir). The step is the only new
   state. "Needed inputs" is derived from `tasks.ts` and the manifest, never
   stored.
4. **Nothing is lost.** Every control of section 0 has a place in section 7.
   Every CLI option stays reachable from every step. CLI defaults do not change.
5. **Fast path stays fast.** Cold start to Results: tile, Choose file…, Run
   (3 actions; today 2, because the task is preselected). Run is never more
   than one click away once the run is valid (run bar on steps 2 to 4).

## 2. Layout

```
[Top bar: Setup | Results | Batch | History              Theme Feedback Help]
[Stepper: (1) Task: Mass-shift survey ✎ ─ (2) Inputs ✓ ─ (3) Settings ─ (4) Outputs & run     Search settings… ⌘K]
[Leftovers warning, when there is one]
┌ step body (one step at a time, max 960 px wide) ───────────────────────────┐
│ ...                                                                       │
└───────────────────────────────────────────────────────────────────────────┘
[Footer: ‹ Back                                   Next: Settings ›]
[Run bar (steps 2-4): plan line · Copy command line · Export INI… · Run]
```

### 2.1 Stepper header

- Four steps, by name: **Task**, **Inputs**, **Settings**, **Outputs & run**.
  An ordered list of buttons (`<nav aria-label="Setup steps"><ol>`), the
  current one `aria-current="step"`.
- Each step shows its state: current, done (✓), blocked (! with the reason as
  its accessible description, e.g. "Protein database missing"), or not
  reachable yet (disabled).
- **Reachability** (derived, section 5.3): Task always; Inputs once a task is
  chosen; Settings and Outputs & run once the required inputs are set (in
  Batch mode: at least one queued file). A step that is reachable but has an
  error shows "!" and stays clickable, so the user can go and fix it.
- Step 1's button reads **Task: <label>** once a task is chosen, with a
  pencil: **the task can be changed from any step** (section 4).
- **Search settings… ⌘K** (and `/`) moves from the Settings card head to the
  stepper: it searches every option from every step (section 6).

### 2.2 Footer

- **‹ Back** and **Next: <step name> ›**. Next is disabled with an inline
  reason when the next step is not reachable ("Choose the spectra first").
- Keyboard: Back/Next are ordinary buttons; Alt+← / Alt+→ go to the
  previous/next reachable step (not while typing in a field). ⌘1-4 stay the
  view shortcuts (shortcuts.ts VIEWS); ⌘↩ stays Run from any step.
- Focus: on a step change, focus goes to the step's heading (`h2`,
  `tabIndex=-1`) and a polite live region says "Step 2 of 4: Inputs".

### 2.3 Run bar

The run bar (RunBar + PlanFooter) is unchanged in content and stays at the
bottom on steps 2, 3 and 4 (not on step 1, where no task is confirmed yet).
Run is enabled when the run is valid, as today (`canRun`, `session.blocked`,
inspector held). This keeps the fast path and lets an expert skip Settings
and Outputs. Its refusals and fixes are unchanged; a refusal that names an
input adds a link "Go to Inputs" (a refusal naming a setting: "Go to Settings").

## 3. The steps

### Step 1: What do you want to do?

Heading: **What do you want to do?** Under it, one line: "Pick a task. It
decides which files FASTag needs and what it writes. You can change it later."

Row above the tiles (the "start from" row):

- **Continue last run** (when the last session recorded settings, D6): a
  compact tile "Continue: <workflow of the last run> with your last settings
  (n changed)". Click = `applyLastUsed()` (its origin is the last run's
  workflow) and go to step 2. Hidden when `lastUsedDiff` is empty.
- **Presets ▾**: Load <name>…, Load FASTag defaults, Delete preset <name>.
  Loading a preset = `applyPreset(name)`; its task is `taskOf(origin)`; go to
  step 2. A preset saved over Batch QC switches to Batch mode as today.
- **Open earlier results…** (link, right): `openResults()`, goes to Results.
  It is navigation, not a task (GUI-WORKFLOWS Decision).

Tiles, in three groups (a group heading `h3` each, a `radiogroup` per page so
arrow keys move across all seven, as today):

| Group | Tiles |
|---|---|
| **Look at the tags** | Export tags |
| **Identify and characterise the sample** | Characterize a run · Species · Mass-shift survey · Database reduction |
| **Check run quality** | Run QC · Identifiability triage |

Each tile (a card ~ 290 x 150 px, 3 per row at 1280 px, 1 per row under
640 px):

```
[icon] Mass-shift survey                                   [needs FASTA]
Which modifications does my sample carry, without guessing them first?
You get: a mass-shift table with sites and UniMod names
You need: spectra + a protein FASTA
Use when: you suspect unexpected or unknown modifications.
Not for: confirmed identifications (shifts are candidates, not FDR-controlled).
Run time: longer — places every tag on the FASTA                 Learn more
```

Tile content (new fields in `tasks.ts`, section 5.1; the blurb stays for the
plan line, History and the Overview):

| Task | Icon | Question (`question`) | You get (`gets`) | You need (derived, 5.2) | Use when / Not for (`use`, `notFor`) | Run time (`time`) |
|---|---|---|---|---|---|---|
| Export tags | tag | Which sequence tags do my spectra carry? | a tags table with per-residue confidence; optional ProForma and USI columns, spectra with tags (mzML) | spectra | de novo assembly, export of tags to other tools / identifying peptides: FASTag is not a search engine | short: tagging only |
| Characterize a run | magnifier | What was done to this sample before it was measured? | protease, labels (isobaric, SILAC), glycopeptides and species, from 10% of the spectra; alkylation on request | spectra | an unknown or legacy data set, before choosing search settings / a final species or protease call on a few spectra: read "Too little evidence" | short: 10% of the spectra |
| Species | leaf | Which organisms does my sample contain? | a species report, ranked at the rank you choose | spectra (bundled taxonomy index, no FASTA) | contamination checks, mixed or unknown samples / ion-trap data at Da tolerances (calls unreliable) | short; 10% of the spectra is usually enough |
| Mass-shift survey | Δ | Which modifications does my sample carry, without guessing them first? | a mass-shift table with sites and UniMod names; tag placements; optional mass-gap report and placements as idXML | spectra + a protein FASTA | unexpected or unknown modifications / confirmed identifications (placements are candidates, not FDR-controlled) | longer: places every tag on the FASTA |
| Database reduction | funnel | Can my search use a smaller database? | a protein shortlist, a reduced FASTA, a Sage, Comet or MSFragger configuration | spectra + a protein FASTA | large or multi-species databases before a search / a validated recipe: the default recipe failed its third held-out test | longer: places every tag on the FASTA |
| Run QC | gauge | Is this run usable, and how was it measured? | a QC report: MS/MS counts and resolution by analyzer, charges, isobaric kit, tag yield, instrument | spectra | checking a run before analysis, comparing runs in a batch / sample content: use Characterize a run | short: tagging only |
| Identifiability triage | ranked bars | Which spectra could be identified but were not? | an identifiability table and summary, spectra ranked by an experimental score | spectra; your search's idXML or mzIdentML optional | finding missed identifications after a search / Batch mode with identifications (one ID file cannot belong to every input) | short: tagging plus one row per spectrum |

Rules for the tile text:

- Every line is plain language; no CLI flag. The texts above derive from
  tasks.ts blurbs, products.ts `what`, README and the help pages; the
  "Not for" lines repeat caveats the GUI already states elsewhere (settings
  note of Database reduction, Overview cutoffs, the batch block of
  census_ids, the instrument popover). No new claims.
- **Run time:** only a class, never a number, and only "short" or "longer".
  Tagging speed is measured (README Performance; doc/BENCHMARK-DirecTag.md);
  placement on a FASTA is not measured per workflow, so the "longer" class
  is a qualitative statement ("places every tag on the FASTA"). Before any
  number is shown, time one PXD run per workflow on the same machine and put
  the measurement in the help page; until then, no numbers.
- The badge **needs FASTA** (or "IDs optional" for triage) comes from the
  derived inputs (5.2), not from text.
- The icons are new inline SVGs in `icons.tsx` (16 px, `currentColor`,
  `aria-hidden`), one per task; no icon library.
- **Learn more** opens the task's help section (`docs.to`) without choosing
  the tile (its own button, outside the radio).

Behaviour:

- Choosing a tile (click, Space, or Enter on the focused tile) chooses the
  task and **advances to step 2**. Arrow keys only move focus and do not
  choose (today they choose: replacing the form per arrow press is what the
  Undo snapshot logic works around). Implementation: tiles are
  `role="radio"` buttons with roving tabindex, not native radios, so arrows
  do not change the selection.
- Choosing the task that is already current and unmodified: no form
  replacement, just advance. Choosing it while modified: advance, keep the
  edits (Reset to <task> stays available in step 3).
- On the first launch the current task is Export tags (LANDING, values
  unchanged), but no tile is "confirmed": the app opens on step 1 with Export
  tags highlighted and its tile focused. Enter = Export tags, step 2.
- History "Settings into form", the Overview's "Add … and run again", a
  dropped spectra file, and the parameter search set the task (or keep it)
  and **open the step where the user has to look next**: a taken run opens
  step 4; a dropped file opens step 2 (task kept, or step 1 when none was
  confirmed yet); a search hit opens its step (section 6).

### Step 2: Inputs

Heading: **Inputs for <task>**. Line under it: "<task> needs <you need>."

Order:

1. **Spectra** (always first). One file | Batch switch, then:
   - One file: the file chip (Choose file… / Change…, drop target), then the
     input checks (PreStartPanel) under it, as today.
   - Batch: Add files…, Add folder…, the queue count and "Open the batch".
     The batch **output folder moves to step 4** (one place for outputs in
     both modes).
2. **Required inputs of the task**, each a file field with Browse…, the
   task's help line, and the "required" chip: Protein database for
   Mass-shift survey and Database reduction. Not shown for any other task.
   When the Filter database (`fasta`) is set, the Protein database is
   satisfied by it (the existing rule: "Uses the Filter database unless you
   choose a separate one here").
3. **Optional inputs already set** (a value from a preset, last-used,
   History or a search hit): shown, with the reason line and a Remove link.
4. **Add optional input ▾** (a menu button, only when the task has unset
   optional inputs): each entry is the input's name and its reason line.
   Choosing one shows its field (focused) under the required ones.

Optional inputs per task (`optionalInputs` in tasks.ts, 5.1; the reason lines
from the manifest and the current help):

| Task | Optional input | Reason line |
|---|---|---|
| Export tags | Filter database (`fasta`) | Write only tags that occur in these proteins. |
| Export tags | Entrapment database (`entrapment_fasta`), offered once a Filter database is set | Foreign proteins the sample cannot contain; adds a false-match rate (q_db) column. |
| Mass-shift survey | Entrapment database (`entrapment_fasta`), offered with a Filter database | as above |
| Species | Your species index (`taxdb`) | Your own tag→taxon index (built with buildtaxdb) instead of the bundled one. |
| Species | Your taxonomy (`taxonomy_nodes` + `taxonomy_names`, one entry, two fields) | NCBI nodes.dmp and names.dmp instead of the bundled ones. |
| Characterize a run | Same as Species (`taxdb`, taxonomy) | as above |
| Characterize a run | Protein database (`recon_fasta`) | Only for the Alkylation report: places its tags on your proteins instead of a shipped proteome. |
| Database reduction | Background proteins (`shortlist_background`) | Host and contaminant proteins, always kept in the reduced FASTA. |
| Identifiability triage | Identifications (`census_ids`) | This run's idXML or mzIdentML with q-values; marks the spectra your search identified. Not in Batch mode. |
| any, Batch mode | SDRF file | Sample metadata the Batch view compares each file's results with. |
| Run QC | none | |

An input whose relevance depends on a **setting** stays beside that setting
in step 3, not here: the Comet template (`search_config_template`) appears
under Search engine when it is Comet (today's `waitsOnShownFile` rule). The
settings that depend on an optional input (Triage's ID q-value and Triage
E-value) appear in step 3 once the input is set, as today.

**Validation, inline under each field** (`aria-invalid`, `aria-describedby`):

- Missing required input: "Required for <task>: choose a protein FASTA."
  Shown once the user has tried Next or Run, or left the field, never on an
  untouched new step.
- Wrong extension, from the manifest's `formats` (pure, `inputs.ts`):
  "<name> is not a FASTA file (.fasta, .fa, .faa; .gz allowed where the CLI
  takes it)." For spectra, the existing input rules (notSpectraZip, the
  picker's types). This is a warning, not a block, where the CLI itself would
  accept the file (the CLI decides; the GUI must not refuse what the CLI
  runs).
- File not found (a path typed, or from a preset, History or last-used):
  needs a new backend call `pathStatus(paths) -> {path, exists, kind}` (Rust,
  with a cargo test; the web harness mock answers from its fixture list).
  "Not found: <path>". It blocks Next and Run like a missing input.
- Errors are also summarised on the step's stepper badge and in the run bar
  (existing `refused` list), so a user on step 4 sees why Run is disabled.

Next is enabled when spectra are set (one file chosen, or at least one
queued file) and every required input is satisfied.

### Step 3: Settings

Heading: **Settings for <task>**. Head row: preset origin and actions (moved
from the Workflow card): "<origin> (modified)", **Reset**, **Undo**,
**Save as preset…** (inline name field as today), Learn more.

Body, top to bottom (today's Settings card minus the inputs):

1. Instrument (with "(detected)" from the input checks; Custom shows the
   tolerance), Fixed modifications: the common block.
2. The task's basic fields (`basic` without inputs), with their help lines;
   settings that wait on an optional input or on another basic field appear
   when it is set (unchanged rules).
3. The task's settings note (Database reduction).
4. **Advanced (n changed)**, collapsed: exactly today's Advanced (own groups
   first, "For every workflow", "Other analyses" with the Turn on buttons),
   minus the inputs step 2 shows for this task (5.4), so no option has two
   controls.

Next is always enabled (no step-3 field is required; invalid values are shown
inline and block Run as today).

### Step 4: Outputs & run

Heading: **Outputs and run**.

1. **Where**: one file: Output folder (Change…) and Run name; Batch: Output
   folder for all files (Change…, Beside inputs), moved here from the Input
   card, with "Each file's outputs are named after it".
2. **Products** checklist of the task (`outputs`), unchanged: file names,
   wiring (needed by, locked), experimental badges, Change… per file, USI
   accession, the alkylation Extension notes and button. The "needs the
   protein database" hint becomes a link to step 2.
3. **Command preview**: the full command line as text (read-only, monospace,
   wraps; `window.fastag.commandLine(run.paramsFor())`, refreshed on change,
   debounced), with Copy command line and Export INI…. In Batch mode the
   first queued file's command, labelled "first file of n". The plan line in
   the run bar is unchanged.
4. **Run** (the run bar's) and **Add to batch**: in one-file mode, Add to
   batch queues the current file (`run.addBatchPaths([input])`), switches to
   Batch mode with the same settings, and leaves the user on step 2 to add
   more files. In Batch mode the run bar's "Run n files" is the action.
5. The **Last run** block (today above the cards) shows here after a run,
   and on step 1.

## 4. Changing the task from any step

- Click "Task: <label> ✎" or step 1 in the stepper: step 1 opens with the
  current task highlighted.
- Choosing another task calls `chooseTask(id)`, extended to **keep compatible
  inputs**: the spectra (input, mode, batch queue, output) are kept as today
  (they are not values). Of the input-file values (`inputParams`, 5.2), those
  the new task needs or offers (required or optional) are carried over; the
  others are dropped.
- What is dropped is said, in a status line on step 2 (role="status"):
  "Kept: Protein database. Dropped for Species: Background proteins. Undo."
  Undo is the existing snapshot (it restores values and origin). Settings
  that differ from the old task's values are replaced by the new task's, as
  today; the status says "Your n changed settings were replaced (Undo)" when
  there were any.
- After choosing, the wizard goes to step 2 (the inputs are what changed).

## 5. Data flow

### 5.1 One table: tasks.ts

New fields on `Task`, the only new data:

```ts
/// Step 1's tile (section 3, step 1).
question: string
gets: string            // one line, "You get"
use: string             // "Use when"
notFor: string          // "Not for"
time: 'short' | 'longer'
timeNote: string        // "tagging only", "places every tag on the FASTA"
group: 'tags' | 'sample' | 'quality'
icon: TaskIcon
/// Inputs the task can use but does not need, with their reason line, in
/// the order of the Add optional input menu. `after` offers it only once
/// another input is set (entrapment_fasta after fasta).
optionalInputs?: { name: string; why: string; after?: string; also?: string[] }[]
```

`required` stays as it is (`recon_fasta` for Mass-shift and Database
reduction). Input-file fields leave `basic` (`basic` becomes settings only;
`recon_fasta`, `shortlist_background`, `census_ids` move to
`required`/`optionalInputs`), so no list names an input twice. The Comet
template stays in `basic` (a settings-dependent input, step 3).

### 5.2 Derived: the needed inputs (new `setup/inputs.ts`, pure)

```ts
/// The inputs step 2 shows for @p task, from tasks.ts and the manifest.
export function taskInputs(task: Task, values: V, mode: 'one' | 'batch'): {
  required: string[]        // task.required
  shown: string[]           // optional inputs with a value (any source)
  addable: { name: string; why: string }[] // optional, unset, `after` satisfied, not blocked in batch
}
export function inputParams(task: Task): Set<string> // required + optional (+ also)
export function missingInputs(task: Task, values: V, input: string, jobs: number, mode): string[]
export function extensionWarning(name: string, path: string): string | null // spec.formats
export function stepState(...): Record<Step, 'done' | 'current' | 'blocked' | 'locked'>
```

`missingInputs` reuses the existing rules rather than restating them:
`isActive('recon_fasta') || isActive('fasta')` (the conflict rule of
paramLayout), `batchBlocked` for census_ids in Batch mode. The badge "needs
FASTA" on a tile is `task.required` mapped through the manifest's formats.

### 5.3 State

| State | Lives in | New? |
|---|---|---|
| task (origin), values, input, out, mode, presets, last-used, Undo | `useSession` | no |
| batch queue, output folder of a batch, run state | `useRun` | no |
| current step | `useSession` (`step`, `setStep`), beside `advancedOpen` | **yes**, the only new state |
| task confirmed on this launch | `useSession` (`taskConfirmed`), false at start; true after a tile, preset, last-used, History, drop | **yes** |
| optional inputs revealed but still empty | `useSession` (`revealedInputs: Set<string>`), cleared by `replaceForm` | **yes** (UI only) |
| reachability, step badges, needed inputs | derived each render (`inputs.ts`) | no state |
| file existence | `pathStatus` result cache keyed by path in `inputs.ts` hook | cache, not truth |

Nothing is persisted that is not persisted today (presets, last-used incl.
`workflow`, History). The step is not persisted; a new launch opens step 1.

### 5.4 Advanced without duplicates

`advancedParams(task)` additionally excludes `inputParams(task)` (step 2
shows them) so each option has exactly one control for the task. For another
task the same option is under Advanced as today (e.g. `fasta` under "Keep
only tags found in a database" for Species). `unplacedParams()` stays the
safety net: an option in no step and no group is reported on screen.

## 6. Parameter search (⌘K) and reachability of every option

The search is in the stepper and works from every step. A hit opens the step
that owns the option, then focuses it as today:

| Option | Step |
|---|---|
| `in`, an input in `inputParams(task)` | 2 (an unset optional one is revealed) |
| Instrument (fragment tolerance, unit, ion series), fixed modifications, `basic` | 3 |
| a product of `task.outputs`, its file (`ownerOf`) | 4 |
| anything else | 3, Advanced opened at its group (unchanged `chooseParam` logic) |

So every CLI option stays reachable from every step: through its step, or
through Advanced in step 3, or through the search.

## 7. What is removed or moved

Nothing is dropped. Every control of the audit (section 0):

| Control (today) | Today | Wizard |
|---|---|---|
| Task radios (7, one line each) | 2 Workflow | Step 1 tiles, grouped, expressive; arrows move focus only |
| Blurb line under the grid | 2 Workflow | removed from Setup; its content is the tile's question + gets (blurb kept in tasks.ts for plan line, History, Overview) |
| Preset select: Load, Load FASTag defaults, Delete | 2 Workflow head | Step 1 "Presets ▾" |
| Preset select: Save as preset… (+ name, Save, Cancel) | 2 Workflow head | Step 3 head (where the values are set) |
| Origin "(modified)", Reset, Undo | 2 Workflow head | Step 3 head; Undo also in the task-change status (4) |
| Apply last-used (n) | 2 Workflow head | Step 1 "Continue last run" tile |
| Learn more (task) | 2 Workflow head | on each tile; Step 3 head |
| Open earlier results… | 1 Input head | Step 1, right of the start row |
| One file / Batch switch, file chip, Choose/Change, Add files…, Add folder… | 1 Input | Step 2, Spectra |
| Input checks (PreStartPanel) | 1 Input | Step 2, under the file |
| Batch output folder (Change…, Beside inputs) | 1 Input | Step 4 |
| SDRF file (optional) | 1 Input (Batch) | Step 2, Add optional input (Batch mode) |
| Help on input files (?) | 1 Input head | Step 2 head |
| Search settings… ⌘K | 3 Settings head | Stepper (all steps) |
| Protein database (required) | 3 Settings | Step 2, required, only for Mass-shift and Database reduction |
| Background proteins, Identifications | 3 Settings | Step 2, Add optional input |
| Comet template | 3 Settings | Step 3, under Search engine (unchanged rule) |
| Instrument, Fixed modifications, basic fields, settings note | 3 Settings | Step 3 |
| Output folder, Run name, products checklist, Help on output files | 4 Outputs | Step 4 |
| "Some of these need the protein database" | 4 Outputs | Step 4, as a link to step 2 |
| Advanced (n changed), all groups, Turn on buttons | 5 Advanced | Step 3, collapsed; minus the task's inputs (5.4) |
| Taxonomy group (taxdb, taxonomy_*) for Species / Characterize | Advanced | Step 2 optional inputs for those tasks; Advanced for others |
| Filter / entrapment database for Export tags, Mass-shift | Advanced | Step 2 optional inputs for those tasks; Advanced for others |
| Last run block | above the cards | Steps 1 and 4 |
| Leftovers warning | above the cards | under the stepper, every step |
| Locked summary while running | replaces the form | unchanged, replaces the step body; stepper disabled |
| Unplaced/unknown parameter warning | under the cards | under the step body, every step |
| Run bar: plan line, Copy command line, Export INI…, Run, refusals, fixes | sticky | sticky on steps 2-4; plus links to the step that fixes a refusal |
| — | — | New: stepper, Back/Next, command text preview (step 4), Add to batch (step 4), Add optional input menu, file-not-found check |

Removed outright: only the card numbers 1-5 (the stepper numbers replace
them) and the duplicate "needs the protein database" texts (one inline error
at the field, one refusal in the run bar).

## 8. Implementation order (small local commits on feat/setup-wizard)

1. `tasks.ts`: new tile fields, `optionalInputs`, inputs out of `basic`;
   `inputs.ts` with unit tests. No UI change; existing tests green.
2. `pathStatus` backend command (Rust + cargo test), api.ts, the web mock.
3. `useSession`: `step`, `taskConfirmed`, `revealedInputs`; `chooseTask`
   keeps compatible inputs and returns what it dropped; tests.
4. `Wizard.tsx` (stepper, footer, focus, live region) and `steps/`
   (`TaskStep`, `InputsStep`, `SettingsStep`, `OutputsStep`) cut out of
   SetupForm (fields, productRow, renderGroup move, not rewritten).
5. Tiles: icons, groups, keyboard (roving tabindex), Learn more.
6. Command preview in step 4; Add to batch.
7. Search routing to steps; History, drop, Overview "run again" routing.
8. Port tests (section 9), help pages (`help/content.tsx` Setup section,
   `help/workflows.tsx` Batch steps), doc/GUI-WORKFLOWS.md section 3 pointing
   here, screenshots.

## 9. Test plan

Unit (vitest):

- `inputs.ts`: for each of the 7 tasks, `required`/`addable` match the
  table of step 2; `fasta` satisfies `recon_fasta`; `entrapment_fasta` offered
  only with `fasta`; `census_ids` not addable in Batch mode; SDRF only in
  Batch mode; `extensionWarning` for .fasta/.fa/.faa/.gz vs .txt; no input
  appears in both `inputParams(task)` and `advancedParams(task)`; the union
  of all steps and Advanced still covers every manifest option
  (`unplacedParams()` empty).
- `tasks.ts`: every task has question, gets, use, notFor, time, group, icon;
  no input-file param in `basic` except settings-dependent ones.
- `useSession`: `chooseTask` keeps `recon_fasta` from Mass-shift to Database
  reduction, drops it to Species and reports it; Undo restores it; choosing
  the current unmodified task does not replace the form; `taskConfirmed`
  false at launch, true after tile/preset/last-used/takeRun.
- `stepState`: locked/blocked/done per step for no task, no file, missing
  FASTA, batch with 0 and 1 files.

Component (`*.app.test.tsx`, existing harness): port setup.app,
setupScreen.app, round2.app, review/round11-12, overview.app, inspector.app,
batch.app to step navigation (helper `goToStep(name)`); new wizard.app test:
arrow keys move focus without choosing; Enter chooses and advances; focus on
the step heading; live region text; Next disabled with reason; ⌘↩ runs from
step 2; Alt+→ does not fire inside a text field.

Playwright web (`npm run e2e`): port every spec that uses the card regions
("1 Input", "Choose file…", `.step-card`, `.tasks .task-label`): setup,
smoke, shell, layout, themes, screens, workflow-tabs, workflow-counts, p0b,
p1a, p4c, safety, inspector, history, overview, perf-log, help-navigation.
New wizard.spec: the three audit tasks end to end (Export tags: no FASTA
field anywhere in step 2; Mass-shift: FASTA required, Next blocked, wrong
extension warning, not-found error from the mock; Species: no FASTA, Add
optional input offers taxonomy only); cold start in 3 actions to Tags
results (replaces the "two actions" assertion of setup.spec, a deliberate
design change); change task from step 4 keeps/drops inputs with the status
line; Add to batch; command preview text equals the copied line; screenshots
of all 4 steps x 3 tasks at 1280x800 and 1024x700, light and dark
(`after-*.png` next to the `before-*.png`). Axe check on each step (no new
violations).

Installed-app suites (`gui/e2e-tauri/app.test.mjs`, `windows.test.mjs`): port
every label change (Choose file… now in step 2 after a tile; "Run" unchanged;
Search settings moved), and run them on macOS and Windows before merge.

Rust: `cargo test` in gui/src-tauri for `pathStatus`.

Manual acceptance (screenshots): at 1280x800, each step of each task fits
without scrolling except step 3 with Advanced open and step 4 of Mass-shift
(7 products + preview); no field of an input the task does not use is
visible; every row of section 7 can be found; dark mode contrast unchanged.
