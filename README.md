<img src="gui/src/assets/logo.svg" alt="FASTag logo" width="80" align="right">

# FASTag — a fast parallel mass spectrometry tagger and tag-based filter

[![release](https://img.shields.io/github/v/release/okohlbacher/FASTag?label=release&color=5b5fd6)](https://github.com/okohlbacher/FASTag/releases/latest)
[![licence](https://img.shields.io/badge/licence-MIT-5b5fd6)](LICENSE)
[![platforms](https://img.shields.io/badge/platforms-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-5b5fd6)](#install)
[![project page](https://img.shields.io/badge/docs-okohlbacher.github.io%2FFASTag-5b5fd6)](https://okohlbacher.github.io/FASTag/)

Partial sequence tags from peptide MS/MS spectra, and a filter that keeps only
the spectra whose tags occur in sequences you supply.

A reimplementation of the [DirecTag](https://doi.org/10.1021/pr800154p)
algorithm as an [OpenMS](https://www.openms.de) TOPP tool, parallelised and
with memory bounded independently of file size on the default path (see
Performance for the bound and the options that keep per-run state).

What changed in each release: [CHANGELOG.md](CHANGELOG.md).

**How to cite.** Cite the FASTag release you used (GitHub shows the entry from
[CITATION.cff](CITATION.cff) under "Cite this repository"; the repository is
archived by [Software Heritage](https://archive.softwareheritage.org/browse/origin/?origin_url=https://github.com/okohlbacher/FASTag),
origin `swh:1:ori:6ec7356bbacb9bf3110bf84321f3b4b1c65394fd`, and each release
requests a new save),
together with the DirecTag algorithm (Tabb DL et al., *J. Proteome Res.* 2008,
7:3838, [doi:10.1021/pr800154p](https://doi.org/10.1021/pr800154p)) and OpenMS
(Pfeuffer J et al., *Nat. Methods* 2024,
[doi:10.1038/s41592-024-02197-7](https://doi.org/10.1038/s41592-024-02197-7)).
A FASTag article is in preparation; this section will name it once it is published.

## What it does

A *sequence tag* is a short peptide read inferred directly from a fragment-ion
ladder — no database search, no precursor digest. FASTag is a **fast, sensitive
prefilter**: it tells you what is worth looking at before you commit to a slow
method. Typical uses:

- Narrow a huge search space to the spectra that carry a tag matching your
  protein(s) of interest, via `-fasta`.
- Get a sense of what is in a run — species, contaminants, a specific protein —
  without running a full database search.
- Feed tags into a downstream tool that consumes them (open-modification search,
  spectral clustering, de novo seeding).

It is a prefilter, not a final identification method: it is tuned for recall,
not specificity — a tag matching a sequence is a reason to look closer, not an
identification in itself.

## How it works

Each MS2 spectrum's peaks form a graph: an edge connects two peaks whose m/z
difference matches a single amino acid residue's mass within the fragment
tolerance. A **tag** is a walk through that graph — a chain of residue-mass
edges — read as a short partial sequence.

**Seeding.** Every walk of length `-tag_length` (default 3 residues) is a
candidate seed.

**Scoring.** Each candidate is scored on three properties, combined by Fisher's
method as if they were independent (they are not -- all three come from the
same peaks, so the chi-squared tail is optimistic) into a single E-value, the
combined p-value times the number of candidates the spectrum produced:

- **Intensity** — how unlikely it is that peaks this strong would form a valid
  tag by chance, given the spectrum's overall intensity distribution.
- **m/z fidelity** — how closely the peaks fit ideal residue masses: the
  spread of the peaks back-projected onto one position, each deviation in
  units of the tolerance at its own peak.
- **Complementarity** — whether a tag's flanking masses are corroborated by a
  complementary ion elsewhere in the spectrum (b/y pairs summing to the
  precursor mass).

DirecTag computes the intensity term by enumerating every `C(n, k)` subset of
peak ranks — combinatorial in tag length, and impractical past length 4 or 5.
FASTag computes the same quantity as a restricted-partition count via dynamic
programming, `O(k·n·s_max)` — polynomial instead of combinatorial. The
recurrence equals the enumeration exactly; the tests check it against
exhaustive enumeration for k ≤ 5 and n ≤ 12, and the tables are computed in
double precision (exact counts while C(n,k) ≤ 2^53, rounded beyond) and stored
as float. This is what makes tag lengths above four practical at all.

The E-value ranks tags; it is not a calibrated expected count. On random
spectra (150 uniform peaks) it overstates significance about 1.5x at 0.5 Da
with gaps off and is strongly conservative at 0.02 Da, so read it as a score.

**Extension** (`-extension`). A seed is a *minimum* length: each scored seed can
be walked further along the graph at either end and rescored at its realised
length, recovering longer tags a fixed seed length alone would miss.

**Gaps** (`-gaps 1`). A tag can cross one missing peak — two peaks separated by
a two-residue combined mass, with no peak between them that an ordinary
two-step path would use, bridge the hole, with up to eight spellings (both
orders of each composition within the tolerance, in order of pair mass)
spelled out as candidates. At high-resolution tolerances a window holds at
most seven; at 0.3 Da a few windows (S+R, T+R) exceed the cap and lose their
heaviest compositions. On by default, because it lets a
tag continue past a missing fragment ion; how many more identified spectra gain a
correctly placed tag with gaps on is being measured on public data (see
Validation). Because a gapped tag asserts an unobserved split, it
is systematically over-ranked relative to its real correctness, which
`-gap_penalty` corrects; disable gaps entirely with `-gaps 0`.

**Modifications.** `-fixed_modifications` (default `Carbamidomethyl (C)`) shifts
a residue's mass; `-variable_modifications` adds a modified alternative, written
inline in the tag as `X[Name]`. Both take any OpenMS/UniMod name. Residue-specific
modifications only — a terminal modification shifts the whole precursor and is
already carried in the reported flanking masses.

**Sequence filtering** (`-fasta`). Reported tags can be restricted to ones
occurring in proteins you supply. Matching:

- folds I/L (isobaric — an emitted `L` says nothing about which residue it
  really was),
- tries both orientations (tags are stored N→C under a y-ion assumption, so a
  b-ion-derived tag reads reversed against the protein),
- accepts isobaric residue-pair substitutions within `-isobaric_tolerance`
  (default 0.04 Da), pairs in either order: `N`=`GG`, `Q`=`GA`/`AG`,
  `K`=`GA`/`AG`, `R`=`GV`/`VG`, `W`=`AD`/`DA`/`GE`/`EG`/`SV`/`VS` at the default
  tolerance (fixed modifications shift these masses before the pairs are derived).

A short tag occurs in almost any protein by chance, so a minimum tag length for
filtering is derived from database size unless you set `-min_filter_length`.
Every filtered run reports matches beside the number expected by chance, so a
count is never mistaken for signal:

```
  len         tags      matched    by chance enrichment
    4        17454          316          291       1.1x  <- at chance
    7          212          212            2      86.0x
    9          108          108            0     999.0x
```

## Install

**[okohlbacher.github.io/FASTag](https://okohlbacher.github.io/FASTag/)** offers
the right build for whatever you are reading this on. Everything is also on the
[latest release](https://github.com/okohlbacher/FASTag/releases/latest); each file name carries the release version
(`<version>` below, e.g. `1.15.0`; releases up to 1.14.0 named the files
without it):

| platform | desktop app | command line |
|---|---|---|
| macOS, Apple silicon | [`FASTag-<version>-gui-macos-arm64.dmg`](https://github.com/okohlbacher/FASTag/releases/latest) | [`FASTag-<version>-macos-arm64.dmg`](https://github.com/okohlbacher/FASTag/releases/latest) |
| macOS, Intel | [`FASTag-<version>-gui-macos-x64.dmg`](https://github.com/okohlbacher/FASTag/releases/latest) | [`FASTag-<version>-macos-x64.dmg`](https://github.com/okohlbacher/FASTag/releases/latest) |
| Windows x64 | [`FASTag-<version>-gui-windows-x64-setup.exe`](https://github.com/okohlbacher/FASTag/releases/latest) | [`FASTag-<version>-windows-x64.zip`](https://github.com/okohlbacher/FASTag/releases/latest) |
| Linux x64 | [`fastag-gui_<version>_amd64.deb`](https://github.com/okohlbacher/FASTag/releases/latest) · [`FASTag-<version>-gui-linux-x64.tar.gz`](https://github.com/okohlbacher/FASTag/releases/latest) | [`FASTag-<version>-linux-x64.tar.gz`](https://github.com/okohlbacher/FASTag/releases/latest) |
| Linux arm64 | [`fastag-gui_<version>_arm64.deb`](https://github.com/okohlbacher/FASTag/releases/latest) · [`FASTag-<version>-gui-linux-arm64.tar.gz`](https://github.com/okohlbacher/FASTag/releases/latest) | [`FASTag-<version>-linux-arm64.tar.gz`](https://github.com/okohlbacher/FASTag/releases/latest) |

Intel Macs are built again from 1.15.0 on (1.8.0 to 1.14.x were Apple silicon
only; [1.6.1](https://github.com/okohlbacher/FASTag/releases/tag/v1.6.1) is the
last earlier Intel release). They depend on GitHub's Intel macOS runners, which
GitHub retires in 2027: the last Intel build will be a release before August
2027.
On macOS both are also on [Homebrew](https://github.com/okohlbacher/homebrew-fastag):
`brew install --cask okohlbacher/fastag/fastag` (desktop app) or
`brew install --cask okohlbacher/fastag/fastag-cli` (command line, `FASTag` on your PATH).
The casks need macOS 14 (Sonoma) or later; on macOS 13.4 to 13.x install the disk images
from the release page instead.

A disk image or archive holds a `FASTag/` folder — run `FASTag/FASTag`
(Linux/macOS) or `FASTag/FASTag.bat` (Windows); everything else inside is a
bundled dependency the wrapper needs, not something to run directly. The
Linux/macOS wrapper sets `OPENBLAS_NUM_THREADS=1` unless you set it yourself:
OpenBLAS arrives with libOpenMS and otherwise starts one spinning thread per
core at load, which FASTag never uses. The desktop app does the same for the
CLI it launches, on every platform.

**Windows on ARM64** (e.g. Snapdragon laptops, Windows 11 in Parallels on an
Apple silicon Mac) runs the x64 build emulated. There the CLI must start with
`MIMALLOC_DISABLE_REDIRECT=1`: the x64 heap redirection cannot patch the ARM64
C runtime, and without it `FASTag.exe` stops at start-up with "The application
was unable to start correctly (0xc0000142)" (1.13.0–1.13.2, also in the desktop
app). From the release after 1.13.2 the desktop app and `FASTag.bat` set it themselves; only if
you start `FASTag.core.exe` (or the app's bundled `FASTag.exe`) directly, set it
once with `setx MIMALLOC_DISABLE_REDIRECT 1` and open a new prompt.

**Windows desktop app: where it installs.** Windows 10 or 11, x64 or ARM64
(emulated, see above), with the Microsoft Edge WebView2 runtime, which current
Windows 10 and 11 already have (the installer downloads it otherwise, so a
machine without it needs a network connection). Started by an administrator,
the installer asks for whom to install: all users (preselected) or only the
current user. A standard user installs for themselves, with no administrator
prompt. The installer (about 305 MB) includes the taxonomy index of the
species report (`tax_k7.taxdb`, 1.14 GB); the installed app takes about 1.5 GB.

| What | Where | Removed by uninstall? |
|---|---|---|
| App, bundled CLI (`resources\fastag\bin\FASTag.exe` and its DLLs), OpenMS data, taxonomy dumps and index (`resources\fastag\share\FASTag\taxonomy\tax_k7.taxdb`), digest models | all users: `C:\Program Files\FASTag`; per user: `%LOCALAPPDATA%\Programs\FASTag` (a per-user install of 1.13.3 or earlier stays in `%LOCALAPPDATA%\FASTag`) | yes |
| A taxonomy index you installed yourself (source build or custom install) | the folder `FASTAG_TAXONOMY_DIR` names, or a file you copied into the install | no: the uninstaller removes only what it installed |
| Settings (`settings.json`) | `%APPDATA%\de.openms.fastag` (Roaming: follows the user) | only with "Delete app data" |
| History, run markers, `last-failure.log`, `leftovers-kept.json` | `%LOCALAPPDATA%\de.openms.fastag` (moved there once from `%APPDATA%` by the first start after 1.13.3) | only with "Delete app data" |
| WebView2 profile | `%LOCALAPPDATA%\de.openms.fastag\EBWebView` | only with "Delete app data" |
| Run outputs | beside the input, or where you chose | never |

The index-only asset `FASTag-<version>-taxonomy-k7.tar.gz` is needed only for
a source build or a custom install: unpack it with Windows' own `tar`
(`tar -xzf FASTag-<version>-taxonomy-k7.tar.gz`), keep
`share-FASTag-taxonomy\tax_k7.taxdb` in a folder of your own and set
`FASTAG_TAXONOMY_DIR` to that folder (`setx FASTAG_TAXONOMY_DIR <folder>`, then
start FASTag again). The app checks for the index before a run with the species
report and says where it looks.

Silent install and uninstall, for IT deployment:
`FASTag-<version>-gui-windows-x64-setup.exe /S` installs for all users when run elevated
and for the current user otherwise; `/S /AllUsers` (elevated) and
`/S /CurrentUser` choose. The install folder follows the scope (`/D=` is not
honoured). `<install>\uninstall.exe /S` uninstalls; a silent uninstall never
deletes the app data. Installing in one scope removes an install of FASTag in
the other scope first, so an upgrade of a 1.13.x per-user install to all users
leaves one copy and one Apps entry (a standard user cannot remove an
all-users install and is told so). Uninstall also keeps the install folder's
registry entry (`Software\openms\FASTag`), which the next install reuses. For
AppLocker or WDAC rules, the all-users install is the one under `%ProgramFiles%`.

**macOS 13.4 or later.** macOS ships as a disk image only, signed with a
Developer ID certificate, notarized and **stapled**, so it opens with no network
connection — a plain tarball cannot carry a notarization ticket.

**Linux desktop app: Ubuntu 22.04 or newer, Debian 12 or newer** (glibc 2.35
and WebKitGTK 4.1). The `.deb`, `fastag-gui_<version>_amd64.deb` on the release
page (`_arm64.deb` on arm64; Debian package `fastag-gui`), pulls in `libwebkit2gtk-4.1-0` and
`libgtk-3-0` (`sudo apt install ./fastag-gui_<version>_amd64.deb`); the tarball needs them
installed and runs as `FASTag-gui/bin/fastag`. A best-effort
`FASTag-<version>-gui-linux-x64.AppImage` carries its own WebKitGTK 4.1, takes GTK 3,
EGL and GL from the desktop, and needs FUSE 2 (`libfuse2`, or `libfuse2t64`
on Ubuntu 24.04) or `APPIMAGE_EXTRACT_AND_RUN=1`. RHEL-family systems (RHEL,
Rocky, Alma) are not supported by the desktop app: RHEL 9 has glibc 2.34 and
only WebKitGTK API 4.0. Use the command line there; it keeps the older floor of
glibc 2.28, so the CLI tarball also runs on RHEL/Rocky 8 and 9 and other older
systems.

**Windows builds are not yet code-signed** — the signing path is wired up but
the SignPath project is not live — so SmartScreen will warn on first run.

**Building from source** needs OpenMS 3.7 (develop), a C++23 compiler with OpenMP and
CMake ≥ 3.28. Releases are built against OpenMS develop at commit
[`70cebcd144`](https://github.com/OpenMS/OpenMS/commit/70cebcd14442cecd6bcd9794fb6786d3342cacc6),
compiled from source with the libraries listed in
[`.github/env/openms.yml`](.github/env/openms.yml). [BUILDING.md](BUILDING.md) gives the
steps: environment, OpenMS, FASTag, tests and the desktop app.

## Desktop GUI

User manual with screenshots: [doc/MANUAL.md](doc/MANUAL.md). **File > Open Example Data** loads the example run that ships with the app.

A cross-platform desktop app ([`gui/`](gui/)) wraps the CLI: pick spectra, set
parameters from a form generated out of the tool's own `-write_ini`, watch a
progress bar with the phase of the run and the time left, and browse the tags and the ranked species report (with a
"Relative to top taxon" column showing each taxon's evidence relative to the
top hit, and an Adjusted column after `-species_deconvolve`). The **Database
hit** filter on `fasta_hit` offers All, In database (`fwd`/`rev`), Entrapment
(`efwd`/`erev`) or Not in database; **Export shown rows…** writes the filtered rows, in
the shown columns, to a new TSV, and a `-res_conf` table also exports as Stitch or ALPS
reads, byte for byte what `tools/tags_to_denovo.py` writes. The tags table can be walked
by keyboard; Cmd/Ctrl+C copies the active row and Cmd/Ctrl+Shift+C its USI, and Enter opens its
spectrum in the **Spectrum** tab: the peaks FASTag tagged (`-dump_spectrum`, under the run's own
options) as a stick plot with zoom, the tag's b or y ladder drawn on them with the error of each step,
and the spectrum's other tags. The tab needs a CLI whose `--helphelp` lists `-dump_spectrum`; with an
older one it is hidden and the row action says "Spectrum view needs FASTag 1.12 or later". A failed run quotes FASTag's reason and offers
its command line to copy. A run never outlives the app: if the app is killed,
the CLI ends within seconds (a watchdog on macOS and Linux, plus the parent-death
signal on Linux; a kill-on-close job per run on Windows, which a browser or editor the app
opens is never part of), and the files such a run, or a cancelled or failed one, left behind
are offered for removal at the next start (of an interrupted run, only what it wrote while it
was alive: a result remade later, or an older one it had not rewritten yet, is never offered). A **Digest** tab
shows the `-digest_out`, `-label_out` and `-massgap_out` reports: the protease
call or no-call with its reason, sequence logos P4..P1 | P1'..P4' of the
observed tag ends and of the called and runner-up models (in bits against the
background in use), the label counts, a histogram of the mass gaps and the mass-gap peaks. A
**Mass gaps & recon** tab draws the `-delta_out` (or `-massgap_out`) gap peaks with about 60
common Unimod deltas marked and the CLI's explained peaks labelled (hover or the arrow keys
for each value, or the same values as a table), warns when too few spectra are placed for
any conclusion, and shows the `-recon_out` placements, the gap peaks and an mzTab
`-recon_id_out` in one keyboard table with filters (kept, with their sort, across tab
switches); without a FASTA it offers to choose one and run again, and when a FASTA run
placed too few spectra with an extension below 3 it offers the run with extension 3. A
`-delta_out` opened without its run's `-massgap_out` beside it is matched with an assumed
0.5 Da window, and the chart says so. Tables up to 128 MB open in the app; larger ones
open only in a spreadsheet. A **Glyco** tab lists the `-glyco_out` spectra, flagged ones first by their
oxonium intensity. Setup starts
with **Export tags**, generating tags from **all input spectra** with
per-residue confidence. **Open results / inspect spectra** is second;
**Characterize a run** and **Batch QC vs SDRF** follow for assessment.
Choose a file, check the MS2
fragment tolerance and output path, then Run; the settings sit
in four step cards, presets store only what differs from their task, and
**Export INI…** writes the same parameters for `FASTag -ini`. The
window has four views, switched from the top bar or with Cmd/Ctrl+1..4:
**Setup**, **Results**, **Batch** and **History** (every recorded run, with
its exact command line to copy, its settings to load back into Setup, and a
Re-run of the same command line); a
progress pill in the top bar follows the run from any view (the Batch view compares a batch with its SDRF: organism by NCBI taxid, protease, label, modifications, instrument and tolerance, with a corrections TSV), and a finished
run in the background raises a system notification. Spectra, FASTA,
taxonomy, tags and report files can be dropped anywhere on the window. A
built-in **Help** side panel (F1, or the Help button), with a search, covers
every tab, setting and error message. Light, dark and system themes. It is built with
[Tauri 2](https://tauri.app) — a Rust backend and the OS's native webview, not a
bundled browser. The CLI remains the source of truth; the GUI shells out to it.

To build or run the app from source, follow [BUILDING.md](BUILDING.md#5-desktop-app-optional):
`tauri dev` and `tauri build` need a staged CLI in `gui/src-tauri/resources/fastag/`.

Installable bundles ship with every release: signed, notarized and stapled disk
images for macOS (also on Homebrew, above), an installer for Windows, which
is not yet code-signed (see above), and from 1.12.0 a `.deb` and a tarball for
Linux x64 (from 1.15.0 also Linux arm64; glibc ≥ 2.35, WebKitGTK 4.1: Ubuntu 22.04, Debian 12) — see the install table at the top. Details in [gui/README.md](gui/README.md).

For a first run, keep **Export tags**, choose spectra, confirm the
MS2 analyser's tolerance, then run and inspect **Results → Tags**. For a
separate survey, choose **Characterize a run** and read **Results → Overview**;
that task samples a tenth of the spectra and enables species, digest, label
and glyco reports. To survey the whole input, set **Subsample fraction** to `1`
and **Subsample spectra** to `0`. The
[desktop first-run guide](gui/README.md#first-run) explains the tasks,
outputs, checks and result views.

## Usage

New to FASTag? [doc/TUTORIAL.md](doc/TUTORIAL.md) is a ten-minute walkthrough on the
small *E. coli* example shipped in `examples/` (commands, expected counts and output),
followed by a PXD000001 walkthrough.

```bash
# tags for every spectrum
FASTag -in run.mzML -out tags.tsv

# high-resolution data, seed 3 extended to at most 15 residues
FASTag -in run.mzML -out tags.tsv -extension 6 -fragment_tolerance 20

# ion-trap MS2 -- set the tolerance to match the analyser
FASTag -in run.mzML -out tags.tsv -fragment_tolerance 0.3 -fragment_tolerance_unit Da

# isotope collapsing and one gap are on by default; turn both off for
# maximum speed, or to match a tool that has no equivalent
FASTag -in run.mzML -out tags.tsv -no_deisotope -gaps 0

# only tags occurring in a protein of interest, plus the spectra carrying them;
# tag_length + 2 x extension must reach the length the database needs
# (about 4 for one protein, 7 or 8 for a proteome: use -extension 3 there)
FASTag -in run.mzML -out tags.tsv -fasta in-house.fasta -extension 1 -out_spectra hits.mzML

# mzPeak in, mzPeak out -- any combination of mzML and mzpeak works
FASTag -in run.mzpeak -out tags.tsv
FASTag -in run.mzML   -out tags.tsv -out_spectra hits.mzpeak
```

**Set the fragment tolerance to match the analyser.** A high-resolution
tolerance on low-resolution data is silent and looks exactly like bad data — on
an ion-trap file, 20 ppm returned 3,007 tags where 0.3 Da returned 824,959.
FASTag infers resolution from peak spacing and warns when the two disagree, but
it cannot know the analyser, so the setting is yours.

## File formats

`-in` accepts mzML, [mzPeak](https://github.com/OpenMS/mzpeak) or MGF, and,
in a build with timsTOF support, a Bruker timsTOF run as a `.d` directory or a
zipped `.d.zip` (see [Bruker timsTOF](#bruker-timstof-d-dzip)); `-out` is TSV; `-out_spectra` writes mzML or mzPeak, chosen by extension. All
six in/out combinations work, and on centroided input the container does not
change the tags: a run read as mzPeak gives the same spectra as the same run
read as mzML, and a run written to mzPeak and tagged again reproduces the
original tag set. This is checked byte for byte in ctest on archives FASTag
writes itself, and outside ctest on public runs converted by mzpeak-convert
(both layouts). Profile MS2 differs; see Performance.

An input FASTag cannot decode at all — an mzPeak archive in an encoding
OpenMS does not support, say — ends the run with the reader's own message on
`Error:` and a non-zero exit code (see Exit codes), rather than aborting.

### Raw DIA input is refused

FASTag tags MS2 spectra of one precursor each (DDA, PRM, and the pseudo-DDA
spectra DIA tools derive). In raw DIA the "precursor" of an MS2 is an
isolation window that holds several peptides, usually without a charge, so its
tags would get wrong flanking masses and complement statistics. Since 1.12
such input is refused: the run ends with exit code 11 before any output is
opened (files from an earlier run stay as they were), an error that names the
window scheme and recommends generating pseudo-DDA spectra first, for example
`DIAspeXtract -in run.mzML -out run.pseudo.mzML` (diaTracer also works for
Bruker .d), and one machine-readable line on stderr,
`FASTAG_REFUSED reason=raw_dia windows=<n> median_width=<Th>`. FASTag then
tags the pseudo-DDA file as any DDA run.

The check reads the metadata of the first 4000 MS2 (`-acquisition_probe_spectra`)
before tagging, through the reader the run uses, and logs one
`Acquisition check:` line on stderr. Its rule follows prose-auto: raw DIA
visits the same isolation windows in the same order every cycle. A run is
refused when its selected-ion m/z repeat with a period equal to the number of
distinct values (at least 5, periodicity at least 0.2 over at least 10 repeats,
consecutive MS2 on the same window counted once, as frame-split diaPASEF writes
them; converted diaPASEF varies the order of the windows inside a frame, which
lowers the periodicity to 0.26-0.53 on public runs), the windows (read from the isolation window target) cover at least 80%
of a range of at least 100 Th, and at least half of the MS2 carry no charge; or,
without recorded windows, when at least 90% are uncharged and the repeating
m/z values form a regular grid at most 50 Th apart, as window centres do (at
least 80% of the spacings between consecutive values within 20% of their
median; an uncharged PRM or inclusion list of arbitrary targets is not one).
Since 1.13 two more window schemes are refused. First, tiling windows the run keeps
returning to without one cycle (each window at least 10 times, and at least 99% of
the MS2 in the second half of the probe on an m/z already seen in the first half), as when a
method repeats blocks of windows. Second, a periodic or returning tiling scheme whose
MS2 all carry the same charge (at least 99%): some DIA methods write a default
charge, 2+ or 3+, on every MS2. A tiling scheme with mixed charges
is still tagged with a warning; a periodic scheme whose windows do not tile a range
is PRM or an inclusion list and passes; so do DDA with wide windows and
pseudo-DDA spectra, which DIAspeXtract (its software entry and `spx_*`
userParams) and diaTracer (its software entry) mark in the mzML. The
thresholds were frozen after a development sweep over 183 public data sets. The
preregistered release test on a fresh PRIDE sample (E7-03, 213 files and 37
pseudo-DDA files) **failed**. Raw diaPASEF and Astral DIA were refused 12/12
each. Orbitrap DIA was refused only 7/12 and the SWATH stratum 10/12, against
>= 90%. 8 of 202 files that had to pass were refused (upper 95% bound 7.0%),
all drawn from Astral projects labelled DDA. All 37 pseudo-DDA files passed.
That test ran the 1.12 rule, which only warned about charged tiling DIA. Post-hoc readings (not a
re-score; only partly checked against vendor scan filters) are that the 8 refused files may be DIA
runs filed as DDA, and that 4 of the missed DIA files, which showed no repeating
window scheme, may be DDA library runs (see
[doc/ACQUISITION-RELEASE-TEST.md](doc/ACQUISITION-RELEASE-TEST.md)). The 1.13 additions were
developed on that sample, which is therefore no test of them: there they refuse 3 more
Orbitrap DIA files (2 with a default charge, 1 with repeated window blocks) and one file
drawn as Tribrid DDA that is a 150 x 4 Th scheme with charge 2+ on every MS2; no other
call changes, on that sample or on the 224 development files (3 known DIA runs with a
default charge go from warned to refused). A second preregistered test of the revised rule on 98 fresh public Thermo files (truth per file from scan filters and isolation windows, `acceptance/1.13/PREREG-acqcheck2.md`) **passed**: 0 of 58 data-dependent or targeted files were refused, and 35 of 37 DIA files (the 1.12 rule: 19 of 37); it held no Astral, timsTOF or SCIEX file. A third preregistered test, of FASTag 1.13.4 on 135 Astral, Orbitrap, timsTOF and SCIEX files (`acceptance/1.14/PREREG-acqcheck3.md`), refused 60 of 60 DIA files (Astral 21, diaPASEF 14, SWATH 11, Orbitrap window schemes 14) and 0 of 75 non-DIA files (ddaPASEF, SCIEX IDA, Astral and Orbitrap DDA, PRM); no criterion failed, but it is **inconclusive**, because it had only 3 Astral DDA files (minimum 8) and no closed-window DIA file (doc/ACQUISITION-RELEASE-TEST.md). A fourth preregistered test, of FASTag 1.14.0 on 157 Thermo files (`acc115/acqcheck4`), refused 0 of 86 non-DIA files (12 of them Astral DDA) and 70 of 71 DIA files (Astral 28 of 28); no criterion failed, but it is again **inconclusive**: only 1 closed-window DIA file was found (minimum 5). If a file
you know is DDA is refused, rerun with `-acquisition_check warn` or `off`. A mixed file
is judged on its first MS2; `-stream` is not checked.

`-acquisition_check warn` tags raw DIA anyway (experts; the tags are those
of FASTag 1.11, with a warning), and `-acquisition_check off` skips the check.

### mzML

FASTag reads the mzML index directly and takes each spectrum's metadata from the
same XML it decodes for peaks, so there is no serial metadata pass before
tagging starts and memory does not grow with the file beyond a fixed buffer
(see Performance).

**A file with no index, or a stale one** — a tool edited it without rewriting
the index — has its spectrum offsets rebuilt by a parallel scan and is then read
at full speed. FASTag warns when it did this and names the file; re-index it
(with `FileConverter`, for instance) to skip the scan on later runs. A file the
fast reader cannot understand at all still falls back to loading the whole run
into memory, with its own warning. `-out_spectra` runs need run-level metadata
and read it up front instead.

**A selected ion m/z of 0** (or below 0, or not a number) is read as no
selected ion m/z: the precursor takes the isolation window target m/z, as when
`MS:1000744` is missing. mzpeak-convert 0.18 (`--to mzml` from a Bruker `.d`)
writes 0 for every precursor Bruker stored without a monoisotopic m/z (5,952
MS2 of the PXD054073 run); read as 0, these spectra yield no tags. The run
summary warns with the number of such spectra and how many took the target.
This is the one place where FASTag reads an mzML differently from OpenMS's
`MzMLFile`, which keeps the 0. Every input path does the same: the indexed
reader, the OpenMS fallback (no usable index, `-out_spectra`, which also writes
the target as the selected ion m/z) and mzPeak archives that store a 0 next to
an isolation target. An MGF has no isolation target: a `PEPMASS` of 0 stays
unusable and is counted in its own warning.

### mzPeak

mzPeak is a Parquet-backed format (Parquet tables in a ZIP container). FASTag
reads and writes it through OpenMS's `MzPeakFile`. The archive is read once,
front to back, by OpenMS's decoding threads, while FASTag's tagging threads take
the spectra from it as they arrive; MS1 peaks are dropped on read, since
nothing uses them.

**Profile MS2 is centroided on read.** Archives converted from raw files
routinely store profile MS2 with an empty centroid facet, and tagging profile
samples rather than peaks costs real recall, so FASTag centroids them on read
(`PeakPickerHiRes`).
Picking runs in the tagging threads, so it parallelises. Profile MS2 in mzML
is tagged as read; `-pick_profile off` switches picking off for mzPeak too.

**Limitations of the mzPeak path** (in OpenMS's `MzPeakFile`, as of the OpenMS
commit above):

- Reading is slower than in FASTag 1.6 at higher thread counts (about 1.1x at
  16-64 threads, up to 1.4x on chunked archives at 64; equal or faster at 1
  thread). FASTag 1.6 read archives with random access from every thread
  through a shared decode cache. `-mzpeak_read_memory` is
  accepted for existing command lines and has no effect.
- `-subsample_spectra` and `-subsample_fraction` read the whole archive and
  drop the spectra not chosen; they cannot skip ahead.
- `-out_spectra` with an mzPeak input reads the archive a second time.
- `-out_spectra` to `.mzpeak` holds the spectra it writes in memory, and the
  archive carries peaks, MS level, retention time, polarity, native IDs,
  precursors and source files, but no activation, chromatograms, instrument
  configuration, data-processing history or run references (mzPeakValidator
  reports the missing run references as errors).
- `-out_spectra` to `.mzpeak` refuses spectra with an ion mobility per peak
  (timsTOF frames), with an error; write `.mzML` instead.

A FASTag built against an OpenMS without mzPeak support (`OPENMS_ENABLE_MZPEAK`
off) refuses `.mzpeak` on either side with a message saying so, rather than
reporting a clean run over an empty file.

### MGF

A Mascot Generic Format peak list (`-in run.mgf`) is read like an indexed mzML:
one parallel scan of the bytes finds where every `BEGIN IONS` … `END IONS`
block starts and ends (16 bytes per spectrum kept; the scan itself peaks at
about 32 bytes per block while it runs), and then each tagging thread reads
the blocks it is given, at random, with its own file handle. The reader's
memory does not grow with the file beyond those offsets (FASTag's own state
can grow with the number of tags reported, for any input format), every
thread count gives the same output, and `-out_spectra`, `-subsample_*` and
`-progress` work as on mzML. The scan also checks the file's block structure
(its markers) **before any output is opened**: a block without `END IONS`
before the next `BEGIN IONS` or the end of the file (a truncated file), or a
block larger than 256 MiB, stops the run with an error naming the lowest such
block, its byte offset and its TITLE. Text outside the blocks is ignored, as
OpenMS ignores it, but an `END IONS` line there (a block whose `BEGIN IONS`
line is lost) and text that looks like a spectrum (a peak line, `PEPMASS=`,
`TITLE=`, `RTINSECONDS=` or `SCANS=`) are counted in a warning with the byte
offset of the first, so no spectrum is dropped silently.

Each block becomes one MS2 spectrum, the way OpenMS's `MascotGenericFile`
reads it, and its spectrum ID is **`index=<k>`**, the block's 0-based position
(PSI-MS `MS:1000774`, multiple peak list nativeID format). The TITLE is kept as
metadata (written to `-out_spectra`) but never used as the ID.

| MGF | read as |
|---|---|
| `PEPMASS=mz [intensity]` | precursor m/z (and intensity). Missing or not finite: a precursor at m/z 0, counted as MS2 with no tags, and counted in a warning |
| `CHARGE=` one value | its magnitude: `2`, `2+`, `+2` are 2; `3-`, `-3` and `-3-` are 3 with negative polarity |
| `CHARGE=` several values (`2+ and 3+`, `2+,3+`), `0`, or none | no charge, tagged as 2+ like an mzML precursor without one; the values are kept as possible charges, and the no-charge warning counts them |
| `RTINSECONDS=t` | retention time in seconds; a range `a-b` gives its midpoint. `nan` or `inf`: no retention time, counted in a warning |
| `MSLEVEL=` | the MS level, a whole number ≥ 1 (default 2); MS1 blocks are skipped as in mzML |
| `TITLE=` | metadata `TITLE`, as written (control bytes and invalid UTF-8 replaced by `?`) |
| `SCANS=n` | metadata `Scan_ID` (sanitised like TITLE, counted); names the USI scan when it is one number |
| `mz intensity [charge]` | a peak, in file order; the fragment charge is ignored. A line that looks like a peak but does not start with a digit (`-100 5`, `.5 5`, `nan 5`) is an error wherever it is |
| `#`, `;`, `!`, `/` lines | comments, ignored anywhere in a block |
| a file-level `CHARGE=` before the first block | not applied (as in OpenMS), with a warning when a block has no `CHARGE` of its own |

FASTag parses the blocks itself, with the number parsers OpenMS's
`MascotGenericFile` uses, so peaks and precursors are bit-identical to what
OpenMS reads (checked block by block in ctest). It differs from OpenMS on
purpose where OpenMS fails or guesses: multi-value and negative CHARGE and
RTINSECONDS ranges (OpenMS refuses the file), `MSLEVEL=2abc` (an error, not 2),
TITLE (never parsed for a time in minutes), comment lines after the peaks
(ignored, not an error), a peak line not starting with a digit (OpenMS skips it
before the first peak and fails on it after), and a leading UTF-8 byte-order
mark (skipped).

A malformed block (a peak line that is not two numbers or does not start with
a digit, a non-numeric PEPMASS, CHARGE, RTINSECONDS or MSLEVEL, or a key after
the peaks) stops the run with an error naming it, when the thread that reads it
gets there. That can be after the reports are open; the partial `-out`,
`-recon_out` and `-glyco_out` are then removed (the other reports are written
only after the loop). With several such blocks, which one is named can depend
on the thread timing. Blocks that `-subsample_*` skips are not parsed.

**Compressed MGF is refused** (`.gz`, `.bz2`, `.zip`, by name): random access
cannot seek in a compressed stream. Decompress it first.

**An MGF carries less than an mzML.** No MS1, no instrument, no scan window, no
activation, no ion mobility (no MGF key for it is common; AlphaTims writes
it inside TITLE, which FASTag does not parse), no polarity (except a negative
CHARGE), no isolation window, and no precursor intensity unless PEPMASS has a
second value. `-digest_out` reports these as absent and judges timsTOF data
by their whole-number intensities instead (see its section), and
`-out_spectra` invents none of them: its isolation-window target is PEPMASS,
with no offsets, where an mzML run writes the instrument's target. Its source
file is the MGF, named with the MGF's SHA-1 as FileConverter writes it (one
more read of the file). With `-recon_id_out`, OpenMS's mzIdentML writer logs
"please prefer mzML files as primary MS runs" for an MGF; the file is written
all the same.

**Same tags as the mzML it came from.** `tools/mzml_to_mgf.py` (pyteomics)
writes an mzML's MS2 as MGF with every peak exact: FASTag on that MGF gives
`tags.tsv`, `-recon_out`, `-delta_out`, `-glyco` and the species report
byte-identical to FASTag on the mzML once column 1 (the spectrum ID) is
removed (the reports of `-digest_out`, `-label_out` and `-massgap_out` differ
only in the input's name and, in the digest, the metadata rows), provided no
`-subsample_*` is used (the subsample is drawn over all spectra, MS1 included,
so the two runs draw different spectra). The tolerance
probe (the warning that no two peaks are closer than 20 times the fragment
tolerance) is also placed over all spectra, so for an MGF and its mzML it can
name different numbers, or appear for only one of the two. TITLE holds the
mzML native ID of each block and is the stable key back to the mzML;
`index=<k>` is the k-th block written, which is the k-th MS2 of the mzML only
when no MS2 was left out (see below). The precursor m/z is the one FASTag's
mzML reader reads: the selected ion m/z when it is above 0, else the isolation
window target m/z when it is above 0, which is all diaTracer writes. An MS2 without peaks
(ddaPASEF conversions write some) becomes a block without peak lines, which
FASTag skips as it skips the empty spectrum in the mzML (`--skip-empty` leaves
it out instead, for readers that refuse empty blocks; the tags stay the same).
An MS2 without a precursor, which FASTag ignores in an mzML, is left out: no
precursorList, or only precursors with neither a selected ion nor an isolation
window target above 0. Both kinds of left-out MS2 shift `index=<k>` of the
blocks after them. A negative charge state is written as `CHARGE=<z>-`, which
FASTag reads as charge z in negative mode, while its mzML reader keeps the
negative value and counts it as no charge, so negative-mode spectra can tag
differently from the two inputs. The converter counts each case on
stderr. **OpenMS FileConverter's
mzML→MGF is lossy** (m/z to 15 and intensities to 6 significant digits, so peak
ranks can tie or swap), and tags from its MGFs can differ slightly. Its
MGF→mzML direction is exact.

### Bruker timsTOF (.d, .d.zip)

A timsTOF DDA-PASEF run is read directly, as a `.d` directory or as a zipped
`.d.zip` (the form PRIDE often serves), through OpenMS's `BrukerTimsFile`
(opentims, MIT licensed; Bruker's own SDK is neither needed nor used). This
needs a FASTag built against an OpenMS with `WITH_OPENTIMS=ON` (see
BUILDING.md); a build without it refuses `.d` input with a message saying so.

```bash
FASTag -in run.d     -out tags.tsv -fragment_tolerance 20 -fragment_tolerance_unit ppm
FASTag -in run.d.zip -out tags.tsv -fragment_tolerance 20 -fragment_tolerance_unit ppm
```

- **Spectra.** One MS2 spectrum per precursor: OpenMS merges the PASEF
  windows of a precursor (over all frames it was fragmented in) and centroids
  them. The MS1 frames are not decoded. Precursor m/z is the monoisotopic m/z
  from `analysis.tdf`; m/z and 1/K0 come from the run's own calibration tables
  (`MzCalibration`, `TimsCalibration`).
- **Unknown charge.** A precursor whose monoisotopic peak the acquisition
  software did not find has no charge in `analysis.tdf` (2-3 % of the
  precursors in the PXD040281 runs measured); its m/z is that of its most
  intense isotope peak. FASTag keeps the charge as unknown: `-unknown_charge`
  decides how such a spectrum is tagged (`assume2`, the default, tags it as 2+
  and records the charge source `assumed`; `infer` calls the charge from the
  fragments), and the stderr log, the run summary and the `charge_source`
  columns count them.
- **Counts without decoding.** Before anything is decoded FASTag reads the
  run's frame and precursor counts from `analysis.tdf` by SQL and logs them
  (`Bruker timsTOF input (analysis.tdf): ... frames, ... MS1, ... DDA-PASEF
  MS/MS, ... dia-PASEF MS/MS; ... precursors, ... without a charge`). For a
  `.d.zip` only `analysis.tdf` is extracted for this.
- **dia-PASEF is refused** from those same tables (a `DiaFrameMsMsWindows`
  table with rows, or dia-PASEF MS/MS frames), with exit code 11 and the
  `FASTAG_REFUSED reason=raw_dia` line, as for other raw DIA; nothing is
  unpacked or decoded first. `-acquisition_check warn` or `off` hands the run
  to the reader anyway.
- **Temporary space for `.d.zip`.** The archive is unpacked in full for the
  read, into OpenMS's temporary directory (`OPENMS_TMPDIR`, else `TMPDIR`), and
  removed afterwards: about the archive's size again (8.06 GB for a 7.73 GB
  PXD040281 run). FASTag refuses up front when that directory has less than
  1.5x the archive's size free and names it; point `OPENMS_TMPDIR` at a local
  disk or `/dev/shm`, or unzip once and give the `.d` directory.
- **Memory.** The MS2 spectra are held in memory (not the MS1 frames): 4.6-4.9
  GB peak RSS for a 120-min run of 200,000 precursors, tagging with 32 threads.
- **Native IDs and USI.** Spectra keep OpenMS's native IDs,
  `frame=<F> scan=<S> precursor=<P>`: the first PASEF window of precursor
  `P` (Bruker's `Precursors.Id`). Converters that do not merge per precursor
  (mzdata, timsrust, msconvert) write one spectrum per PASEF window instead
  (`merged=<n> frame=<F> startScan=<S> endScan=<E>`); the two meet on frame
  and scan of the first window. With `-usi_collection` the USI run is the name
  without `.d` / `.d.zip`, and the index is `index:<i>`, the spectrum's
  position among the run's MS2 spectra as FASTag reads them, since a spectrum
  merged from several windows has no PSI native ID of its own.
- **Not yet:** the desktop app's input probe and `-dump_spectrum` do not read
  `.d` (they say so); timsTOF data without ion mobility (`analysis.tsf`) and
  QTOF `.baf` data are refused.

## Command-line reference

| Option | Default | Meaning |
|---|---|---|
| `-in <file>` | — | Input spectra: mzML, mzpeak or MGF (uncompressed), or a Bruker timsTOF `.d` directory or `.d.zip` (DDA-PASEF; builds with timsTOF support, see File formats) |
| `-out <file>` | — | Tag list, tab-separated |
| `-fasta <file>` | none | Report only tags occurring in these sequences |
| `-out_spectra <file>` | none | Write spectra carrying a reported tag here, as mzML or mzpeak (by extension). Needs memory proportional to the *file*, not the thread count, unlike every other path |
| `-tag_length <n>` | 3 | Seed tag length in residues |
| `-tag_lengths <n> ...` | none | Several seed lengths in one pass over the input, replacing `-tag_length`, e.g. `-tag_lengths 3 4 5`. Each length is tagged, scored and capped by `-max_tags` exactly as on its own, and a spectrum's rows are those runs' rows in ascending length. A tag several lengths report (same tag, charge, flanking masses and gapped flag, typically after extension) is kept only from the length that scores it best (lowest E-value; ties go to the shorter length), in every output. Masses are compared at full precision, so two different readings that merely print alike are both kept. The caps apply per length before this, so a spectrum can end up with fewer rows than they allow. `-delta_out` samples the lowest-E-value placed tag across lengths, and `-species` pools a spectrum's tags across lengths. Not combined with `-entrapment_fasta` |
| `-extension <n>` | 0 | Max residues appended per terminus; 0 disables extension (max 12) |
| `-gaps <n>` | 1 | Allow a tag to cross one missing peak (0 or 1) |
| `-tmt_pseudo_filter <off\|auto\|on>` | off | Experimental (1.13.2, no held-out test): reject b/y tags whose bare G or A at a tag end is a TMT6/10 label artifact (pseudo-residue), after scoring and before the `-max_tags` cap; `auto` probes the run for TMT6/10 labelling first (not with `-stream` or mzPeak input), `on` asserts TMT6/10 and skips the probe (see Output, TMT6/10 artifact filtering) |
| `-tmt_reporter_filter` | off | Experimental (1.13.2, no held-out test): also reject b/y tags anchored on a singly charged TMT6/10 reporter ion; needs `-tmt_pseudo_filter auto` (with TMT detected) or `on` |
| `-no_deisotope` | off | Do not collapse isotope clusters to their monoisotopic peak, and do not move multiply-charged fragments onto the singly-charged scale, before peak selection |
| `-fragment_tolerance <value>` | 20 | Fragment mass tolerance |
| `-fragment_tolerance_unit <ppm\|Da>` | ppm | Tolerance unit |
| `-max_peaks <n>` | 400 | Peaks kept per spectrum, at most 1024; 0 means 1024, not unlimited. Higher values use more memory. Also caps `-peaks_per_window` |
| `-peaks_per_window <n>` | 10 | Keep this many peaks per 100 Da window instead of the strongest `-max_peaks` overall; 0 disables |
| `-max_tags <n>` | 50 | Tags reported per spectrum; 0 = unlimited |
| `-max_evalue <value>` | 20 | E-value cutoff; 0 disables |
| `-gap_penalty <value>` | 100 | Rank gapped tags as if their E-value were this many times worse. Never removes a tag at the `-max_evalue` cutoff (applied to the unpenalised value), but under `-max_tags` it decides which tags fill the capped slots, and the printed `evalue` of a gapped row includes it. 1 disables |
| `-isobaric_tolerance <value>` | 0.04 | Isobaric residue-pair substitution tolerance when matching `-fasta` and when reconciling against `-recon_fasta`; 0 requires exact strings |
| `-min_filter_length <n>` | 0 | Ignore tags shorter than this when matching `-fasta`; 0 derives a floor from database size |
| `-orientation <both\|forward>` | both | Also match a tag reversed (b-ion reading), or only as written; applies to `-fasta` matching and `-recon_fasta` reconciliation |
| `-fixed_modifications <mods>` | `Carbamidomethyl (C)` | Shift residue masses; not annotated in the tag. OpenMS/UniMod names, e.g. `'TMT6plex (K)'` |
| `-variable_modifications <mods>` | none | Add a modified alternative, written inline as `X[Name]`, e.g. `'Phospho (S)'` |
| `-proforma` | off | Append a ProForma 2.0 column for each tag (see Output) |
| `-res_conf` | off | Append per-residue confidences 0..100, N→C, space-separated (see Assembly export) |
| `-usi_collection <id>` | none | Append a `usi` column naming each tag's spectrum as a Universal Spectrum Identifier in this collection (`PXDnnnnnn`, …, or `USI000000`; see Output) |
| `-diversity` | off | Under `-max_tags`, demote near-duplicate re-reads of an already-kept tag's peak set behind non-duplicates, then backfill. Reorders which tags occupy the capped slots; never changes output size or rank 1 (see Tag diversity) |
| `-recon_out <file>` | none | Reconcile reported tags against a protein database: one row per placement with protein, peptide, position, flank agreement, localized mass gap and its interpretation (see Reconciliation). Requires `-recon_fasta` or `-fasta` |
| `-recon_fasta <file>` | `-fasta` | Database for `-recon_out`; independent of the membership filter, so a proteome-scale reconciliation never forces the filter's per-length index build |
| `-recon_missed_cleavages <n>` | 1 | Missed tryptic cleavages in reconciliation windows; 2 under `-search_engine msfragger` with `-search_config_out` and a tryptic shortlist unless given (the held-out-tested MSFragger configuration) |
| `-recon_min_length <n>` | 0 | Shortest tag worth reconciling; 0 derives the chance-match floor from database size; 6 under `-search_engine msfragger` with `-search_config_out` and a tryptic shortlist unless given |
| `-recon_sub_tolerance <tol>` | 5 | Advanced: tolerance of a `sub:X->Y` reading in `delta_interp` (and so in `-delta_out`'s `top_interps`), never looser than `-fragment_tolerance`. Residue mass differences lie a few mDa apart, so at a 20 ppm fragment tolerance most unexplained gaps fitted some substitution (+2.004 read as `sub:P->V`, 11.7 mDa off). `0` = `-fragment_tolerance` (1.15) |
| `-recon_sub_tolerance_unit <unit>` | ppm | Advanced: `ppm` (of the flank the gap is on, as the modification reading) or `Da` |
| `-recon_localize` | off | Localize each reconciliation's mass gap to one residue of its region by the b/y fragments it shifts; appends `loc_site` (residue + 1-based protein position, the first on a tie), `loc_score` (b/y ion/charge matches) and `loc_ties` (sites sharing that score; 1 = unique) to `-recon_out`. Requires `-recon_out` |
| `-recon_id_out <file>` | none | The `-recon_out` placements as identifications: idXML, mzid or mzTab by extension (see Reconciliation). NOT FDR-controlled. Requires `-recon_out` |
| `-delta_out <file>` | none | Aggregated mass-shift histogram over reconciliations (one best placement per spectrum), with the sites the spectra's fragments determine and the Unimod and PSI-MOD entries that fit them (see Mass-shift survey). Candidates, NOT identifications, NOT FDR-controlled. Requires `-recon_out` |
| `-delta_name_tolerance <tol>` | 10 | Advanced: tolerance of the `-delta_out` `unimod` and `psimod` columns (an entry names a row when its mass is within this of the row's `delta`) |
| `-delta_name_tolerance_unit <unit>` | ppm | Advanced: `ppm` (of the median peptide mass of the row's spectra: a gap carries a flank's error, which is on the peptide's mass scale) or `Da` |
| `-delta_group <Da>` | 0.004 | Advanced: group `-delta_out`'s 0.5 mDa bins into rows. The most populated bin takes every bin within this many Da, then the next most populated one not yet taken, without chaining: one shift is one row (at most 2 x this wide) and every sampled spectrum counts in exactly one row. `0` = the 1.15 rows (a bin no neighbour exceeds and its two smaller neighbours; a bin that is neither is not written) |
| `-delta_spectra_out <file>` | none | Advanced: the `-delta_out` sample of every spectrum, one line each in input order: `spectrum` (native ID), `delta` (Da, 6 decimals), `row` (the `-delta_out` row it counts in; `-` for a bin no 1.15 row took), `interp` (`delta_interp`), `peptide`, `site` (residue) and `site_pos` (1-based in `peptide`) of the best-scoring site, written also when the gap is unlocalized (`-` when exact), `localized` (the site class as in `residues`; `-` when not fragment-localized or sequence-constrained, or exact), `loc_evidence` (site-determining ions or peaks), `evalue` (the tag's); then (1.16b) the provenance: `delta_full` (unrounded), `tag`, `protein`, `pos` (1-based tag start in `peptide`), `orientation` (`forward` y-read / `reversed` b-read), `gap_side` (`N`, `C`, `-` exact), `flank` (`precursor`: the flank is the precursor less a fragment, where a precursor isotope or charge error lands; `fragment`), `region` (1-based residues the gap may sit on), `charge` and `charge_source` (`given`, `inferred`, or `assumed` 2+ when the precursor has none), `precursor_isotope` (k of the tagged hypothesis), `loc_class` (`fragment`, `sequence`, `ambiguous`, `unlocalized`, `-`), `loc_score`, `loc_ties`, `loc_excluded` (loss satellites not counted, `strict`), `null_class` / `null_evidence` (`-delta_loc_null`), `obs_class` / `obs_detail` (the observation class, see Mass-shift survey), and the selected tag's competing placements: `n_placements`, `n_exact`, `n_gapped`, `n_peptides` (distinct, I/L folded), `tag_support` (placed tags of the spectrum agreeing with the sample: same peptide, gap within 0.05 Da), `tags_placed`, `placements` (`protein\|peptide\|pos\|f/r\|delta;...`). Candidates, NOT identifications. Requires `-delta_out` |
| `-delta_select <rule>` | min_delta | Advanced: how a spectrum's `-delta_out` sample is chosen: `min_delta` (the lowest-E-value placed tag, its smallest-\|delta\| placement; 1.15) or `consensus` (the placement the most placed tags agree with: same peptide, gap within 0.05 Da; then E-value, \|delta\|). Measured on PXD045734 development runs, `consensus` agreed no better with an open search, so it is not the default (see Mass-shift survey) |
| `-delta_loc_model <model>` | strict | Advanced: how `-delta_out` localizes a sample's gap: `count` (every matched b/y ion and charge, as `-recon_localize`; 1.16a), `unique` (a site's distinct matched peaks: one peak supports one ion) or `strict` (`unique`, and a shifted ion's peak that is an H2O or NH3 loss satellite of an observed unshifted ion does not count). `-recon_out`'s `loc_*` columns always use `count` |
| `-delta_loc_min_evidence <n>` | 2 | Advanced: the lead over the best rival site (ions, or peaks under `unique`/`strict`) a gap needs to be fragment-localized; below it and above 0 it is ambiguous. `1` = 1.16a |
| `-delta_loc_null <Th>` | 0 | Advanced: `-delta_spectra_out`'s `null_class`/`null_evidence`: each gapped sample is also localized on its spectrum's peaks moved by this many Th (the same peak density, no ladder), the false-localization null. `0` = off |
| `-delta_isotope_flank <flank>` | precursor | Advanced: `isotope_error` only on rows with at least half of their gaps on the precursor-derived flank (`precursor`), or on any row (`any`, 1.16a) |
| `-delta_isobar_tolerance <Da>` | 0.001 | Advanced: `-delta_out`'s `isobars` column takes the members within this many Da of the row's best name |
| `-delta_counts_out <file>` | none | Advanced: the run's survey reconciliation as `key value` TSV: MS2 read, tagged (a selected-hypothesis tag reached placement), placed, clamped, samples (exact, gapped, terminal gap), the gaps' evidence classes, precursor-flank and charge-assumed counts, observation classes, rows and their spectra, and `check_*` rows (`ok`/`FAIL`) for the sums that must hold. Requires `-delta_out` |
| `-digest_out <file>` | none | Terminal residues of the tags (ungapped, E-value ≤ 1) at P4..P1 and P1'..P4', and the protease call they support with its margin, or `no_call` with the reason (see Digest, label and mass-gap reports) |
| `-label_out <file>` | none | TMT, TMTpro and iTRAQ4 gaps at either tag end (N- and C-terminal counts pooled, each given in the description) and the heavy Lys8/Arg10 shares |
| `-label_discovery_out <file>`, `-label_discovery_max_flank`, `-label_discovery_depth`, `-label_discovery_min_spectra`, `-label_discovery_min_share`, `-label_discovery_window_n`, `-label_discovery_window_c`, `-label_discovery_unimod_top` | none | Removed in 1.14 (failed its held-out tests, see Held-out acceptance): accepted with a warning, no effect |
| `-massgap_out <file>` | none | The `-delta_out` gap distribution with Cys alkylation counts, gap peaks explained as combinations of up to 3 Unimod modifications, and SILAC labels among them. Requires `-recon_out` |
| `-digest_models <file>` | shipped | Protease model table for `-digest_out` (columns `model`, `class`, `end`, `residue`, `freq`); its `background` rows win over a FASTA |
| `-digest_tag_min <n>` | 100 | Advanced: tag ends a call needs; the N-terminal ends count from as many |
| `-digest_window <Da>` | 0.008 | Advanced: window around a residue or label mass at the tag ends |
| `-digest_background_share <f>` | 0.05 | Advanced: share of the background mixed into every model |
| `-digest_silac_min <n>` | 50 | Advanced: K- and R-terminal tag ends each for `-label_out`'s heavy-share gate |
| `-label_call_min_tags <n>` | 175 | Removed in 1.14 (0 failed its held-out test): accepted with a warning, no effect; the minimum is 175 |
| `-massgap_window <Da>` / `-massgap_window_da <Da>` | 0.02 / 0.5 | Advanced: gap window on ppm runs / on Da runs |
| `-massgap_min_spectra <n>` / `-massgap_min_share <f>` / `-massgap_min_bin <n>` | 20 / 0.005 / 2 | Advanced: spectra and share a gap peak needs; spectra a histogram row needs to take part |
| `-massgap_max_mods <n>` / `-massgap_top <n>` | 3 / 5 | Advanced: modifications per explanation; modifications listed by share |
| `-massgap_silac_share <f>` / `-massgap_silac_min <n>` | 0.08 / 500 | Advanced: share a SILAC label needs; shifted spectra a SILAC call needs |
| `-digest_models_version <shipped\|v2>` | shipped | Experimental (1.12), not validated on held-out data: `v2` reads `digest_models_v2.tsv` (rule-only LysargiNase and Asp-N_ambic rows, detection weights per instrument class, pooled specificity); the shipped v2 values are unfitted priors |
| `-digest_detection <none\|shipped>` | none | Experimental: score the tag ends with the table's detection weights of the run's instrument class (orbitrap_hcd, timstof, other) and call timsTOF runs instead of withholding them; needs a v2 table |
| `-digest_flank2 <off\|auto>` | off | Experimental: where y1 is cut off or the P1 counts are too few, score the two-residue flank sums m(P2) + m(P1) instead |
| `-digest_min_confidence <f>` / `-digest_calibration <file>` | 0 / shipped | Experimental: write the calibrated `p_correct` of a call and withhold one below the threshold (`low_confidence`); the shipped calibration is unfitted (p_correct 0.5) |
| `-digest_quality <enzyme\|auto>` | none | Experimental (1.13): append missed-cleavage and non-specific-end measurements (section `quality`) to `-digest_out` for a model of the protease table (e.g. `Trypsin`) or for the report's own call (`auto`); see doc/DESIGN-digest.md, "Digestion quality" |
| `-alkylation_out <file>` | none | Experimental (1.12), not validated on held-out data: which reagent alkylated the cysteines, or none, from the placements of single-Cys peptides (see Digest, label and mass-gap reports; format in doc/ALKYLATION-REPORT.md) |
| `-alkylation_proteome <name\|file>` | auto | Database of `-alkylation_out` when nothing else places: `auto` (= human), `human`, `mouse`, `yeast`, `ecoli` name the shipped UniProt reference proteomes (release 2026_04, reviewed entries, `share/FASTag/alkylation/<name>.fasta.gz`, CC BY 4.0; since 1.13, in 1.12 they stopped with exit code 6), or a FASTA file (`.gz` allowed); ignored with `-recon_fasta`. **The shipped proteomes need `-tag_length 8` (human, mouse) or `-tag_length 7` (yeast, ecoli):** shorter tags do not place on them, and at the default `-tag_length 3` the call is `no_call` with reason `tags_too_short`. The report's `database_release` row names the release and the FASTA's sha256, which FASTag checks the file against (doc/ALKYLATION-REPORT.md, Shipped proteomes) |
| `-alkylation_min_spectra <n>` / `-alkylation_min_share <f>` / `-alkylation_window <Da>` | 10 / 0.6 / 0 | Advanced: spectra and share the call needs; bin window (0 = 0.02 Da on ppm runs, 0.5 Da on Da runs) |
| `-alkylation_tags_out <file>` | none | Experimental (1.13), advanced; its held-out test passed at the margin (40 of 57 runs called, 37 right; see Validation), and unalkylated runs are rarely called: the database-free alkylation call. Every MS2 spectrum is tagged a second time with unmodified C and one alternative C edge per reagent; a spectrum votes when its best such tag (E <= 1e-4) holds a C inside the tag (use with `-extension`; measured with `-tag_length 4 -extension 6`; without extension few spectra vote), and the call uses `-alkylation_min_spectra` / `-alkylation_min_share`. Every other output is unchanged (format in doc/ALKYLATION-REPORT.md, section `-alkylation_tags_out`) |
| `-shortlist_out <file>` | none | Experimental (1.12): ranked protein shortlist from the tag placements on `-recon_fasta` (or `-fasta`), one row per protein with evidence (see Protein shortlist and search hand-off). A search-space reduction, NOT FDR-controlled |
| `-fasta_out <file>` | none | Experimental: reduced FASTA of the kept proteins (never decoys), then `-shortlist_background`. When it would hold no protein, neither it nor `-search_config_out` is written and FASTag exits with code 13 (1.14; before, an empty file and exit code 0) |
| `-shortlist_background <file>` | none | Proteins always written to `-fasta_out` (host proteome, contaminants), decoys left out; an entry identical to a database entry is written once, as that entry (kept even below the shortlist cut, reason `background`) |
| `-shortlist_max_evalue <f>` / `-shortlist_min_spectra <n>` | 0.1 / 2 | Advanced, provisional: E-value a tag needs for its placements to count (10 under `-search_engine msfragger` with `-search_config_out` and a tryptic shortlist unless given); spectra a protein needs to be kept |
| `-shortlist_gapped` | off | Let placements with a mass gap count (a gap equal to a fixed terminal label always counts as exact); on under `-search_engine msfragger` with `-search_config_out` and a tryptic shortlist |
| `-shortlist_exact_only` | off | Removed in 1.14 (added in 1.13.3; failed its held-out test, see Held-out acceptance): accepted with a warning, no effect; under `-search_engine msfragger` gapped placement stays on |
| `-shortlist_parsimony <none\|subset\|greedy>` | none | Drop proteins whose spectra a higher-ranked kept one has (`subset`), or keep a greedy set cover (`greedy`) |
| `-shortlist_top <n>` | 0 | Advanced: keep at most this many proteins, ties at the cut kept; 0 = no cap |
| `-shortlist_decoy_affix <list>` | `DECOY_ decoy_ rev_ REV_ reverse_ XXX_ shuffled_ random_ _DECOY _rev` | Advanced: accession prefixes and suffixes that mark a decoy entry |
| `-shortlist_force` | off | Advanced: write `-fasta_out` and `-search_config_out` although the tag ends call a non-tryptic protease |
| `-shortlist_protease <trypsin\|auto\|unspecific\|lys-c\|arg-c\|asp-n\|glu-c\|chymotrypsin\|lys-n>` | trypsin | Experimental (1.13), advanced; `auto` **passed** its held-out test (see Held-out acceptance), a named rule and `unspecific` have none: cleavage rule of the shortlist's placements and of `-search_config_out` (Sage, Comet or MSFragger). `trypsin` is 1.12 (tryptic windows, a non-tryptic run refused); `auto` takes the protease the tag ends call (trypsin when inconclusive; after 1.13.1 Asp-N is called from 21 % D at the N-terminal tag ends and an Asp-N call is exported semi-specific unless `-shortlist_specificity` is given, **not validated**: their held-out test failed on one criterion only, an empty trypsin comparison export, see Held-out acceptance; a WARN when the call is `unspecific`, whose exported search can be slower than a full search); a name or `unspecific` takes that rule. Otherwise windows are found by flank mass, only exact placements count, and a named rule the run's call contradicts is refused unless `-shortlist_force` (see doc/SHORTLIST.md) |
| `-shortlist_specificity <full\|semi\|none>` | full | Experimental (1.13), advanced; `semi` and `none` have no held-out test (the test of `-shortlist_protease auto` ran at `full`): with a `-shortlist_protease` other than trypsin, both window ends at a cleavage site (`full`), at least one (`semi`, Sage `semi_enzymatic`, Comet `num_enzyme_termini = 1`) or none; missed cleavages up to `-recon_missed_cleavages`. Not given, an Asp-N call of `-shortlist_protease auto` uses `semi` (after 1.13.1; not validated, its held-out test failed, see Held-out acceptance; on three development Asp-N runs the shortlist keeps 0.25, 0.29, 0.64 of the full search's proteins, Sage 27, 26, 5 s and 1.7, 1.7, 0.2 GB, against 0.18, 0.19, 0.57, 13, 12, 6 s and 0.3, 0.3, 0.1 GB at `full` and 0.25, 0.34, 0.66, 162, 181, 7 s and 17.9, 20.8, 0.8 GB for the unspecific export of 1.13.1); a named `asp-n` stays `full` |
| `-search_config_out <file>` | none | Experimental: a Sage configuration (JSON), Comet parameters or a complete MSFragger `fragger.params` for `-fasta_out`, or for the input database without it |
| `-search_engine <sage\|comet\|msfragger>` | sage | Engine of `-search_config_out`; `comet` is unverified against the Comet binary; `msfragger` (experimental, 1.13; first held-out test **FAILED**, second test with the shortlist recipe of doc/SHORTLIST.md **PASSED**, third test with the same recipe on 8 new runs **FAILED**, see Held-out acceptance; that recipe is its default with the tryptic shortlist, but it is not validated (`-shortlist_protease trypsin`, the default; another protease keeps 1.13.1's values): `-shortlist_gapped` on, `-shortlist_max_evalue 10`, `-recon_min_length 6`, `-recon_missed_cleavages 2`, each unless given on the command line or in an INI; the log and the shortlist header name the values applied) is checked against MSFragger 4.4.1 and needs decoys in the database: with `-fasta_out` FASTag appends reversed `rev_` decoys, without it the input database must be a target-decoy database; its `num_threads` is `-threads` (0 = every CPU) (see doc/SHORTLIST.md) |
| `-search_config_template <file>` | none | Comet only (Sage and MSFragger files are written complete): a `comet -p` file the managed keys are merged into; without it a fragment is written |
| `-search_precursor_tolerance <f>` / `-search_precursor_unit <ppm\|Da>` | -1 / ppm | Precursor tolerance written to the configuration; -1 = by engine: 10, or 20 ppm (MSFragger's own default) for msfragger (held-out test passed together with the shortlist recipe, see Held-out acceptance) |
| `-search_missed_cleavages <n>` | -1 | Missed cleavages the engine searches; -1 = by engine: `-recon_missed_cleavages` for Sage and Comet and with `-shortlist_protease` other than trypsin, 2 (MSFragger's own default) for msfragger (held-out test passed together with the shortlist recipe, see Held-out acceptance) |
| `-search_nterm_acetyl <engine\|yes\|no>` | engine | Add `Acetyl (Protein N-term)` to the variable modifications of the configuration; `engine` = only for msfragger, as in its own defaults (held-out test passed together with the shortlist recipe, see Held-out acceptance) |
| `-search_isotope_errors <n>` | -1 | Precursor isotope errors 0..n (at most 3); 0 = none; -1 = by engine: none for Sage and Comet, 0..3 for MSFragger (held-out test passed together with the shortlist recipe, see Held-out acceptance) |
| `-search_decoy_prefix <s>` | `rev_` (Sage, MSFragger) / `DECOY_` (Comet) | Prefix of the decoys the engine generates (MSFragger: the decoys FASTag appends to `-fasta_out`, or the ones the input database holds) |
| `-search_shifts <mode>`, `-search_shifts_out <file>`, `-shift_max_variable`, `-shift_max_offsets`, `-shift_expand_sites`, `-shift_site_min_share`, `-shift_site_min_count`, `-shift_site_min_ions` | none | Removed in 1.14 (failed both held-out tests, see Mass shifts as search configuration): accepted with a warning, no effect; `-search_config_out` is unchanged |
| `-entrapment_fasta <file>` | none | Entrapment database (foreign species) calibrating a `q_db` column: the estimated false-match rate of the `-fasta` filter at each E-value (see q_db). Requires `-fasta` |
| `-glyco` | off | Flag oxonium-bearing MS2 spectra to `<out>` with its extension replaced by `.glyco.tsv` (see Glyco flag) |
| `-glyco_out <file>` | `<out>` with its extension replaced by `.glyco.tsv` | With `-glyco`: per-spectrum oxonium report |
| `-glyco_min_fraction <f>` | 0.10 | With `-glyco`: summed oxonium intensity over base peak, the literature threshold |
| `-census` | off | Per-spectrum census: one row per MS2 spectrum read, tagged or not, plus a run summary (see Census) |
| `-census_out <file>` | `<out>` with its extension replaced by `.census.tsv` | With `-census`: the per-spectrum table |
| `-census_summary_out <file>` | `<out>` with its extension replaced by `.census_summary.tsv` | With `-census`: the run summary |
| `-census_ids <file>` | none | With `-census`: identifications of `-in` (idXML or mzid with q-values); adds the columns `identified` and `triage` and a `census_ids` summary section (see Census) |
| `-census_ids_fdr <f>` | 0.01 | With `-census_ids`: the q-value a target hit needs to identify its spectrum (advanced) |
| `-census_triage_evalue <f>` | 0.01 | With `-census_ids`: the best E-value at or below which an unidentified tagged or placed spectrum is a triage candidate (advanced) |
| `-stream` | off | Resident single-spectrum mode: spectrum blocks on stdin, TSV rows + `#end` sentinels on stdout (see Streaming) |
| `-progress` | off | Emit `FASTAG_PROGRESS done=<n> total=<n>` on stderr for a progress bar |
| `-species` | off | Infer taxa from the tags (see Species detection) |
| `-taxdb / -taxonomy_nodes / -taxonomy_names <file>` | bundled | The k-mer index and NCBI dumps for `-species`; give all three or none |
| `-species_out <file>` | `<out>` with its extension replaced by `.species.tsv` | Ranked-taxa output |
| `-species_rank <rank>` | genus | NCBI rank to report (genus, family, …) |
| `-species_min_len <n>` | 0 | Ignore tags shorter than this for taxonomy; values below the index k (including 0) use k |
| `-species_max_kmer_share <f>` | 1.0 | Ignore k-mers carried by more than this fraction of the indexed taxa; 1 keeps all |
| `-species_min_margin <f>` | 0.0 | Require a tag's best taxa to carry this fraction more of its k-mers than the runner-up; 0 keeps all |
| `-species_use_gapped` | off | Let gapped tags contribute taxonomic evidence (see Species detection) |
| `-species_deconvolve` | off | Correct taxon counts for sequence shared between taxa |
| `-species_evidence <mode>` | best | Which of a spectrum's tags make it count for a taxon: `best` = the taxa of its lowest-E-value tag that maps into the index (compared as printed in the `evalue` column; ties united), `all` = the union over every reported tag (the rule up to 1.9.0) |
| `-species_call <mode>` | none | `decoy`: call each reported taxon present, no_call or not_detected against a decoy-tag null plus homology spill; appends 7 columns (see Species detection). `explain` was removed in 1.14 (failed its held-out test, see Held-out acceptance): accepted with a warning, read as `none` |
| `-species_call_params <file>` | `species_call.tsv` in the taxonomy dir | With `-species_call decoy`: the decision parameters (alpha, tau, n_min) |
| `-species_call_min_units <n>` | 200 | With `-species_call decoy`: fewer spectra with taxon evidence make the run a few_spectra no_call |
| `-species_call_decoys <n>` | 5 | With `-species_call decoy`: decoy tags per tag (1-100) |
| `-species_reagents <fasta>` | none | Removed in 1.14 (read only by `-species_call explain`, which failed its held-out test): accepted with a warning, no effect; the file is not read |
| `-species_pi0 <f>` | 1 | With `-species_call decoy`: pi0 of the q-values; 1 = Benjamini-Hochberg, 0 = estimate (Storey) |
| `-species_orientation <mode>` | forward | `both`: also look each tag up reversed (a tag read from b ions is written reversed); one informative reading is used as it is, two are intersected, two without a common taxon skip the tag. Independent of `-orientation` (which applies to `-fasta` and `-recon_fasta`). The analytic `log_pvalue` and `qvalue` columns are NA under `both`, also with `-species_call decoy`; the decoy-based value is its `decoy_qvalue` (not calibrated in 1.12.0; see `-species_call`) |
| `-subsample_spectra <n>` / `-subsample_fraction <f>` | 0 | Tag only a random subset (count or fraction; if both are given, the count wins); 0 = all |
| `-subsample_seed <n>` | 1 | Seed for the `-subsample_*` selection |
| `-mzpeak_read_memory <MB>` | 0 | No effect; accepted for existing command lines |
| `-acquisition_check <refuse\|warn\|off>` | refuse | Refuse raw DIA input with exit code 11, tag it anyway with a warning, or skip the check. The 1.12 rule failed its release test E7-03 (8 of 202 DDA-labelled files refused, all Astral DIA runs filed as DDA; Orbitrap DIA refused 7/12); the revised 1.13 rule passed a second held-out test on Thermo files: 0 of 58 non-DIA and 35 of 37 DIA files refused; a third test on Astral, timsTOF and SCIEX files refused 0 of 75 non-DIA and 60 of 60 DIA files, inconclusive with no criterion failed (only 3 Astral DDA files, no closed-window DIA file); a fourth refused 0 of 86 non-DIA (12 Astral DDA) and 70 of 71 DIA files, inconclusive with no criterion failed (1 closed-window DIA file, minimum 5; see Raw DIA input is refused) |
| `-acquisition_probe_spectra <n>` | 4000 | MS2 spectra the acquisition check reads, metadata only, reading at most ten times as many spectra in all (advanced) |
| `-pick_profile <legacy\|off>` | legacy | Centroid profile MS2 (MS:1000128) with OpenMS `PeakPickerHiRes` before tagging: `legacy` on mzPeak input only (as 1.11), `off` never. Centroided MS2 are never re-picked. `-out_spectra` writes the spectra as they were tagged. Not with `-stream`. `auto` was removed in 1.14 (failed its held-out test, see Held-out acceptance): accepted with a warning, read as `legacy` |
| `-pick_unknown_type` | off | Removed in 1.14 (read only by `-pick_profile auto`, which failed its held-out test): accepted with a warning, no effect |
| `-ion_series <by\|cz\|auto>` | by | Ion series the MS2 spectra are read as: `by` (b/y ions, as 1.11), `cz` (c/z• ions of ETD/ECD, every spectrum), `auto` (c/z• for spectra whose activation is ETD or ECD, b/y for all others, hybrid EThcD/ETciD included, with a warning). `ax` (1.13, a/x ions) was removed in 1.14 (failed its held-out test, see Held-out acceptance): accepted with a warning, read as `by`. Under `cz`, and under `auto` when the run has electron-activated spectra, the tag TSV gains a last `ion_series` column and the census a `best_ion_series` column (see Ion series). Not with `-stream`. Opt-in: on held-out Orbitrap ETD spectra `auto` gave 82.2% correct rank-1 tags against 0.9% under `by` (verdict inconclusive, see Validation) |
| `-ion_series_hybrid <by\|both>` | by | 1.13, under `-ion_series auto` only: how hybrid EThcD/ETciD spectra are read. `by` is `auto` as in 1.12 (b/y ions, with the `Hybrid activation:` warning); `both` tags each hybrid mzML spectrum twice, as b/y and as c/z• ions, multiplies every E-value by 2 and merges the two passes' rows by E-value under one `-max_tags` cap; each row keeps its `ion_series` and every per-row consumer reads its offsets from it; `-species` and `-alkylation_out` count b/y rows only. The precursor hypotheses, `-check_header_charge`, the `-complement_tolerance_unit auto` probe, `-dump_spectrum` and the census diagnostics (`n_kept`, `n_edges`, `n_compl`) still read a hybrid spectrum as b/y (doc/HYBRID-IONS.md). Ignored with a warning under other modes; not with `-stream`. Experimental; **passed** its held-out test (see Held-out acceptance) |
| `-ion_series_photo <series>` | by | Removed in 1.14 (the a/x reading failed its held-out test, see Held-out acceptance): accepted with a warning, no effect |
| `-complement_tolerance_unit <Da\|fragment\|auto>` | Da | How the complement window is set: `Da` is `-complement_tolerance` (0.02 Da, as 1.11); `fragment` is `-complement_tol_factor` x (the fragment tolerance at the peak + at its partner); `auto` measures it on the run from the complement pairs of high-confidence tags (see doc/COMPLEMENT-TOLERANCE.md) and never sets a window narrower than `-complement_tolerance`, which is also the fallback when the probe finds too few pairs. The window in force is logged and recorded in `-out_spectra` (mzML) and the `-census`/`-alkylation_out` run rows. `auto` is **validated**: its third held-out test passed (+3.31 points of correct rank-1 tags on ion trap, timsTOF not worse; see Validation); the first, with an earlier estimator, failed and the second was inconclusive. The default stays `Da`. Not with `-stream` or mzPeak input |
| `-complement_rule <same_charge\|precursor\|both>` | same_charge | Experimental (1.12; held-out test of `both` inconclusive, see Validation): which fragment pairs count as complements in the complement subscore: `same_charge` (both at the fragment charge z), `precursor` (the partner carries the precursor's remaining c - z charges) or `both` (advanced) |
| `-complement_tolerance <Da>` | 0.02 | Window for a complement partner in Da, used with `-complement_tolerance_unit Da` and as the floor and fallback of `auto` (advanced) |
| `-complement_tol_factor <k>` | 0.5 | Factor k of the complement window k x (fragment tolerance at the peak + at its partner), used with `-complement_tolerance_unit fragment` (advanced) |
| `-complement_midp` | off | Experimental (1.12, not validated): score complements of tags with 0 or 1 complemented peaks with DirecTag's hypergeometric mid-p P(X>c) + P(X=c)/2; 2 or more keep P(X>=c) (advanced) |
| `-complement_probe <n>` | 500 | With `-complement_tolerance_unit auto`: MS2 spectra the probe tags, drawn uniformly over the run with a fixed seed (advanced) |
| `-unknown_charge <assume2\|enumerate\|infer>` | assume2 | How a precursor without a charge is tagged: `assume2` as 2+ (as 1.11); `enumerate` at each listed possible charge (MS:1000633, MGF `2+ and 3+`), else at every charge `-charge_min`..`-charge_max`; `infer` at the charge its complement pairs support (1+ when `-charge_min` is 1, or 1 is listed, and almost no intensity lies above the precursor; both charges of a close call, `ambiguous`; without evidence 2+, or the lowest candidate when 2 is none, `assumed`). Every charge tagged is a listed possible charge, else one of `-charge_min`..`-charge_max`. A header charge is never replaced (`-check_header_charge both`, 1.13, can add a second charge). A spectrum tagged under H hypotheses has every E-value multiplied by H before `-max_evalue` and `-max_tags`; its rows are merged by E-value. The reports that aggregate over spectra (digest, label, massgap, delta, species, shortlist, census) read the rows of one selected hypothesis, chosen from the charge evidence, never from the E-values. Experimental: `infer` failed its held-out test (see Validation); not with `-stream` |
| `-charge_min <n>` / `-charge_max <n>` | 2 / 4 | The charges `enumerate` and `infer` try (1-8); `-charge_min 1` enables infer's 1+ test |
| `-charge_infer_margin <x>` | 2 | Complement-pair excess by which an inferred charge must beat the runner-up to be tagged alone; closer, both are tagged (`ambiguous`). Any excess above 0 is a call; none is `assumed` (advanced) |
| `-isotope_error <k> ...` | 0 | Precursor isotope offsets (-1..3) to consider, for every precursor: the neutral mass is lowered by k x 1.00336 Da, and each charge is tagged at the offset its complement pairs support best. Needs a fragment tolerance below 0.05 Da (or the ppm equivalent at m/z 1000); refused otherwise (advanced) |
| `-check_header_charge <off\|warn\|both>` | off | 1.13, experimental (held-out test passed, about one flag in three wrong; see Validation). Check every precursor charge the file gives. The evidence is the isotope spacing of the precursor in the preceding MS1 scan (mzML only) and, where that gives no charge, the complement pairs (the `-unknown_charge infer` call over `-charge_min`..`-charge_max` plus the header charge, with 1+/(z-1)+ pairs for z >= 3). `warn` counts and reports agreements and disagreements and tags as before (every other output unchanged); `both` tags a disagreeing spectrum under its header charge and under the charge the check found (TSV `charge_src` `check_call`, with the four hypothesis columns; the header charge stays the selected one, and the E-values of such a spectrum are doubled). A disagreement needs evidence against the header: the MS1 spacing gives another charge and the header's own isotope peak is missing, the call's complement-pair excess beats the header's by `-check_header_margin`, or the 1+ test. One summary line per run; the census summary gains `check_header_charge` and `header_charge_*` run rows. Not with `-stream` (see doc/HEADER-CHARGE-CHECK.md) |
| `-check_header_margin <x>` | 6 | With `-check_header_charge`: complement-pair excess by which the supported charge must beat the header charge's own to count as a disagreement (advanced) |
| `-check_header_out <file>` | (none) | With `-check_header_charge`: one row per header-charged MS2 spectrum (header charge, call, evidence, verdict, the charge tagged) |
| `-probe_input <file>` | (none) | Print the metadata of a spectra file (or a FASTA alone) as JSON lines and exit; writes no file, needs no `-in`/`-out` (advanced; see Probe and spectrum dump) |
| `-dump_spectrum <nativeId>` | (none) | Print the peaks FASTag tags of one spectrum of `-in` as JSON lines and exit; writes no file (advanced; see Probe and spectrum dump) |

The `-glyco_*` options are read only with `-glyco`, the `-census_*` options only
with `-census`, and the `-taxdb`,
`-taxonomy_*` and `-species_*` options only with `-species`; otherwise they are
ignored with a warning. Default report names replace the extension of `-out`:
`-out run.tags.tsv` gives `run.tags.species.tsv` and `run.tags.glyco.tsv` (a dot
in a directory name is not an extension; without one, the suffix is appended).

Plus the standard OpenMS TOPP options: `-threads <n>` (parallelism — the
core performance lever; **defaults to 0, which means half the logical cores**,
so a run leaves the machine usable — pass `-threads <n>` to choose), `-ini
<file>` / `-write_ini <file>` (parameter files), `-log <file>`, `-no_progress`,
`--help` / `--helphelp`. With `-ini`, the file's `threads` value applies (1 if it
has none) unless `-threads` is also given on the command line. `--help` shows
OpenMS's generic text for `-threads` ("0 = all available cores"); FASTag uses
half.

### Exit codes

| Code | Name | When FASTag returns it |
|---|---|---|
| 0 | EXECUTION_OK | Success |
| 2 | INPUT_FILE_NOT_READABLE | The input cannot be opened or read |
| 3 | INPUT_FILE_CORRUPT | The input cannot be decoded, the `-digest_models` table or a shipped digest table is invalid, or the species index or taxonomy cannot be loaded |
| 4 | INPUT_FILE_EMPTY | The `-fasta` or `-entrapment_fasta` file has no usable sequence, or an MGF input has no `BEGIN IONS` block |
| 5 | CANNOT_WRITE_OUTPUT_FILE | An output cannot be written, for example because the disk is full |
| 6 | ILLEGAL_PARAMETERS | Options conflict, a value is out of range, or the input is not mzML, mzPeak or MGF (or is a compressed mzML or MGF) |
| 11 | INCOMPATIBLE_INPUT_DATA | The input is raw DIA (see Raw DIA input is refused; stderr carries a `FASTAG_REFUSED` line); `-out_spectra` is `.mzpeak` but the MS2 spectra carry ion mobility per peak (write `.mzML` instead); or the `-census_ids` file cannot be joined to the run (see below) |
| 13 | UNEXPECTED_RESULT | See below |

The OpenMS framework returns its own codes before FASTag starts, for example 1
for an input file that does not exist.

Code 11 from `-census_ids` (see Census) has two paths. Before any output, when the
file cannot be read, when no hit in the identification file carries a q-value, when identifications with hits
have no `spectrum_reference`, or when the file names more than one run. After the
run, when more than 50 % of the file's spectrum references match no spectrum
read: every other output is complete, and neither census file is written.

Code 13 covers three runs that fail although files were written:

- `-fasta_out` when the reduced FASTA would hold no protein (no protein
  reaches `-shortlist_min_spectra` and there is no `-shortlist_background`).
  Neither it nor `-search_config_out` is written, files an earlier run left
  there are removed, and every other output is complete (1.14; before, an empty
  FASTA and exit code 0).
- `-out_spectra` when no spectrum carried a reported tag. The tag TSV and every
  report are complete; the spectra file is not written, and a stale one from an
  earlier run is removed.
- `-entrapment_fasta` whose key space lies entirely inside the target's. The
  files written while the spectra are read (the tag TSV, `-recon_out`,
  `-glyco_out`) are kept, the tag TSV without a `q_db` column; the outputs
  written after it (`-delta_out`, `-recon_id_out`, `-digest_out`, `-label_out`,
  `-massgap_out`, `-out_spectra`) are not. Choose a more distant entrapment
  proteome (see q_db).

## Output

**Experimental TMT6/10 artifact filtering.** `-tmt_pseudo_filter auto` probes up
to 1,024 MS2 spectra drawn deterministically across an mzML or MGF input. It
requires at least 100 spectra with an ungapped length-4 tag at E-value ≤ 1.
Both N-terminal TMT evidence (`n = 229.162932` or `c = 211.152367`) and
TMT-lysine evidence (`c = 357.257895` or `n = 375.268460`) must occur in at
least 20 spectra and at least 1% of eligible spectra. Counts are per spectrum,
with ±0.020 Da N-channel and ±0.006 Da C-channel windows. Conflicting 304 Da
label evidence causes abstention when both sites occur in at least 5 spectra
and at least 1% of eligible spectra. These anchors are compatible with TMTpro
and iTRAQ8; the veto does not identify either chemistry. A Da fragment
tolerance also abstains. The gate tests for TMT6/10 presence, not purity:
minority labeling chemistries below the veto threshold can remain undetected.
The automatic probe has no protein-database input. It logs its decision and
records it in versioned reports and exported mzML provenance.

When active, the filter removes b/y tags starting with bare G/A at
`n = TMT − G/A` or ending with bare G/A at `c = TMT − H2O − G/A`.
Terminal K alone never triggers rejection, including when its TMT mass is
allocated to the C flank; lysine signatures still contribute to labeling
detection. A K-ending tag can still be rejected for an independent G/A
pseudo-residue at its other end.
Residue identity and flank mass must both agree; modified G/A are not treated
as bare residues. Filtering occurs after scoring but before the tag-count cap,
so surviving tags retain their scores and can fill the vacated slots.
Ordinary TMT-plus-residue flanks and a-ion counterparts are retained.
`-tmt_reporter_filter` additionally removes tags whose singly charged low
endpoint matches a TMT6/10 reporter ion, under the same active TMT gate.
`-tmt_pseudo_filter on` asserts known TMT6/10 chemistry and skips detection;
`off` is the default. Automatic detection needs random access and refuses
`-stream` and mzPeak input; forced `on` supports them. These filters are
experimental, not modification identification or labeling-efficiency estimates.

The [G/A-only benchmark and reference audit](bench/results/tmt-ga-2026-11-11/report.html)
tests four TMT files and one label-free control. In the two independent TMT
projects (10,912 reference PSMs), automatic filtering increased rank-1 accuracy
from 82.203% to 82.716% without configured TMT masses, and from 81.562% to
82.093% with TMT masses. Recall@50 was unchanged at 95.115% and 94.630%,
respectively, with no paired losses. The benefit remains in a supplementary
subset corroborated by independent searches; the primary references were not
changed. Automatic detection activates filtering; it does not configure the
residue alphabet. The revised conflicting-label veto detects 10% TMTpro in
two artificial spectrum mixtures, but misses a tested 5% mixture. It does not
establish labeling purity. Keep the option experimental and off by default.
Full paired counts, residue-mass consistency, runtime, detector challenges,
raw-spectrum case figures, and provenance accompany the report.

The [earlier benchmark](bench/results/tmt-pseudo-2026-11-11/report.html)
documents the recall loss from the former bare-K rejection rule. Retaining
terminal K removes that loss: those tags can allocate the label mass to a
terminal gap while preserving useful sequence evidence.

One TSV row per tag: `spectrum` (native ID; `index=<k>`, the 0-based block,
for MGF), `tag` (sequence), `length`,
`charge` (fragment charge), `nterm_mass` / `cterm_mass` (flanking masses,
4-decimal precision), `extended` / `gapped` (flags), `evalue`, `min_conf` /
`mean_conf` (per-residue confidence, see below), and `fasta_hit`. The
`fasta_hit` column is always written: `-` without `-fasta`; with `-fasta`, only
matching tags are written, as `fwd` / `rev`, plus `efwd` / `erev` for
entrapment-only matches under `-entrapment_fasta`. The `evalue` of a gapped row
is the ranking value, E × `-gap_penalty`, so it can exceed `-max_evalue`; divide
by the penalty for the raw E-value.

With a non-default `-unknown_charge` or `-isotope_error` (1.12), or `-check_header_charge both` (1.13), four columns
follow the optional ones: `prec_charge` (the precursor charge the row was
tagged at), `charge_src` (`header`, `possible`, `inferred`, `ambiguous`,
`assumed`, `enumerated`, or `check_call` under `-check_header_charge both`), `iso_offset` (k) and `selected` (1 when the row's
hypothesis feeds the aggregating reports). `-recon_out` and `-recon_id_out`
keep every row at its hypothesis' charge.

**Ion series** (`-ion_series`, 1.12). Under the default `by` the flanks follow
the y-ion convention above: `nterm_mass` + tag residues + `cterm_mass` + H2O =
the precursor's neutral mass, and a tag read off the b ions appears reversed
with one water moved between its flanks. A tag read as c/z• ions (`cz`, or
`auto` on ETD/ECD spectra; `ion_series` = `cz`) uses the same residue-sum
convention for forward reads (the low peak a z• ion), and a reversed read (the
low peak a c ion) carries the offset offC - offN = (H2O - NH2) - NH3 =
-15.0347 Da instead of +H2O: N-side residues = `cterm_mass` - 15.0347, C-side
residues = `nterm_mass` + 15.0347. Under c/z• the complement partner of a peak
is the one whose neutral masses sum to M + H (under `-complement_rule
precursor` at the c - 1 charges an electron-activated precursor of charge c
leaves its fragments), and peaks at the unreacted
precursor and its charge-reduced species (with their isotope and
hydrogen-transfer forms) are dropped before tagging. Under c/z• a peak that
deisotoping moves to the 1+ scale above the precursor cut (neutral mass +
proton + 1.5 Da) is dropped as well (1.13, issue T25): it cannot be a fragment
of this precursor (doc/CZ-PRECURSOR-CUT.md). b/y tagging keeps the 1.12
behaviour. `-recon_*`, `-digest_out`,
`-label_out`, `-massgap_out`, `-delta_out` and the census take the offset from
each tag; `-species` counts b/y tags only and reports how many c/z• rows it
left out. Hybrid EThcD/ETciD spectra are read as b/y under `auto`; with
`-ion_series_hybrid both` (1.13, experimental; passed its held-out test, see Held-out acceptance) they are tagged twice, as b/y
and as c/z•, and the rows of both passes are merged by E-value, each with its
own `ion_series`; the precursor hypotheses, `-check_header_charge`, the complement-tolerance probe,
`-dump_spectrum` and the census diagnostics still read them as b/y (doc/HYBRID-IONS.md). The a/x reading
(1.13, `-ion_series ax` and `-ion_series_photo`) was removed in 1.14: it failed its held-out test (see
Held-out acceptance).
`-ion_series auto` on a run without electron activation writes exactly what
`by` writes. `auto` reads the activation of mzML input only: MGF and mzPeak
spectra are read as b/y (an electron-activated spectrum such a reader delivers
is counted in a warning), so a c/z row always comes with the `ion_series`
column. With `-unknown_charge enumerate|infer` a spectrum read as c/z• takes
its charge and isotope evidence from c/z• pairs, and its charge-reduced
precursor species do not count as fragments.

**Tag confidence.** The `evalue` is the primary, validated confidence — lower is
better, and on real identifications (PXD000001) it separates correct from
incorrect tags by roughly 400x in the median, with the best-E-value tag per
spectrum correct ~88% of the time. `min_conf` and `mean_conf` (both in [0,1],
higher better) score each residue's own support — m/z fit times endpoint peak
intensity — so `min_conf` localises the residue most likely wrong, which the
single E-value cannot; correct tags carry a markedly higher `min_conf` than
incorrect ones (~0.45 vs ~0.17 median). A calibrated per-tag *q-value/FDR* is
deliberately **not** emitted: a defensible null has to reproduce the chimeric
false tags real spectra generate, which a single-spectrum decoy does not.

**ProForma.** `-proforma` appends a
[ProForma 2.0](https://github.com/HUPO-PSI/ProForma) column so downstream tools
can consume a tag without a bespoke parser. Each tag renders as
`<[fixed-mods]>[+nterm]-RESIDUES-[+cterm]`: the flanks as terminal mass tags
(ProForma has no dedicated "mass gap of unknown sequence at a terminus"), fixed
residue modifications as a global prefix (`<[Carbamidomethyl]@C>`; a terminal
fixed modification is in the flanking masses and not in the prefix), and the I/L residue
as `J` because FASTag folds I onto L and cannot tell them apart. Off by default;
the TSV schema is unchanged unless asked for.

**USI.** `-usi_collection <id>` appends a `usi` column,
`mzspec:<id>:<run>:<indexType>:<indexNumber>`
([HUPO-PSI USI 1.0](https://github.com/HUPO-PSI/usi)), with `<run>` the input
file name without its extension, or, for MGF, **with** it (`run.mgf`: USI lets
the msRun carry the extension, and an MGF index points into the peak list, not
the raw run). `<id>` is one of the identifiers USI permits
(`PXDnnnnnn`, `MSVnnnnnnnnn`, `RPXDnnnnnn`, `RMSVnnnnnnnnn`, `PXLnnnnnn`), or
`USI000000` until the dataset has one. The spectrum is named by `scan:<n>` for
Thermo and scan-number IDs, `nativeId:<a,b,…>` for the other vendor formats,
and otherwise `index:<n>`, its 0-based position in the input. An MGF block is
`scan:<n>` when its `SCANS=` is one number, and otherwise `index:<k>`.

### Report schemas

Tab-separated, one header line. The reports not listed here document their format
where they are described (Census, Species detection, Digest, label and mass-gap
reports, doc/SHORTLIST.md, doc/ALKYLATION-REPORT.md).

**`-recon_out`** (see Reconciliation and mass shifts): one row per placement of a
reported tag on the database.

| Column | Meaning |
|---|---|
| `spectrum` | native ID, as in the tag TSV |
| `tag` | the tag, as in the tag TSV |
| `protein` | accession line of the database entry (tabs and line breaks replaced by spaces) |
| `peptide` | the tryptic window the tag lies in, in the database's spelling |
| `pos` | 0-based index in `peptide` where the tag starts |
| `reversed` | 1 when the tag matched read C to N (a b-ion reading), else 0 |
| `nterm_match` / `cterm_match` | 1 when that flanking mass agrees with the window; both 1 = exact placement |
| `delta_mass` | spectrum flank minus database flank on the side that disagrees, Da, 4 decimals; `0.0000` when exact |
| `region` | `lo-hi`, the 0-based inclusive residue range of `peptide` the gap lies in; empty when exact |
| `delta_interp` | `mod:Name@X`, `sub:X->Y` or `?`; empty when exact. A modification is judged at the fragment tolerance in ppm of the flank the gap is on, a substitution at `-recon_sub_tolerance` (5 ppm of that flank by default) |
| `loc_site`, `loc_score`, `loc_ties` | only with `-recon_localize`: best site (residue + 1-based protein position), its b/y ion matches, sites sharing that score; empty when not localized |

**`-delta_out`**: one row per mass-gap peak, in increasing `delta`.

| Column | Meaning |
|---|---|
| `delta` | the row's most populated 0.0005 Da bin, Da, 4 decimals; the row holds the bins within `-delta_group` (0.004 Da) of it not taken by a more populated row (`-delta_group 0`: a bin no neighbour exceeds and its smaller neighbours, as in 1.15) |
| `spectra` | spectra in the row (each spectrum counts once, by its best tag's smallest-\|delta\| placement; the rows sum to the sampled spectra) |
| `top_interps` | up to three `interpretation:count` pairs separated by `;`, most frequent first; `-` when none |
| `localized` | spectra whose gap the fragments place on one site class (the sum of `residues`) |
| `residues` | `site:count` pairs separated by `,`, most frequent first (ties by name), localized spectra only: a residue (`K`), or a terminal-ambiguous site (`N-term\|K`, `C-term\|R`, `Protein N-term\|M`, `Protein C-term\|L`); `-` when none |
| `unlocalized` | spectra with a gap and no site-determining evidence (no fragment tells the chosen site from another, or a tie); exact placements count in neither column |
| `unimod` | Unimod entries within `-delta_name_tolerance` of `delta` on a site of `residues`, at most 5, by the localized spectra on their sites (most first), then by mass error: `Name@Site/Site(error)`, sites most-supported first, e.g. `Oxidation@M/W(+0.4ppm)`, `Acetyl@Protein N-term/K(-1.2ppm)`, `Gln->pyro-Glu@N-term Q(…)`; `[-Fixed]` marks an entry that replaces the residue's fixed modification (below); `-` when none |
| `psimod` | the same for PSI-MOD terms, ranked the same way: `MOD:accession name@Site(error)`; generic and abstract terms left out (see Mass-shift survey) |
| `isotope_error` | `13C+1(error)` or `13C+2(error)` when `delta` is within `-delta_name_tolerance` of 1 or 2 x 1.00336 Da, at least half of the row's gaps are on the precursor-derived flank (`-delta_isotope_flank`) and no better residue-specific name fits (below); `-` otherwise |
| `fragment_localized` | (1.16b) localized spectra whose site the fragments chose with at least `-delta_loc_min_evidence` site-determining evidence |
| `sequence_constrained` | localized spectra whose gap region is one residue: the placement, not a fragment, puts the gap there (`fragment_localized` + `sequence_constrained` = `localized`) |
| `ambiguous` | unlocalized spectra with some site-determining evidence, below `-delta_loc_min_evidence` |
| `precursor_flank` | spectra whose gap is on the precursor-derived flank (where a precursor isotope or charge error lands) |
| `charge_assumed` | spectra whose precursor had no charge and was tagged as 2+; report rows with and without them |
| `class` | the observation classes of the row's gaps, `class:count`, most frequent first (three at most): `extension`, `truncation`, `adduct`, `isotope`, `loss`, `fixed_loss`, `fixed_replacement`, `terminal`, `residue`, `substitution`, `unknown` (see Mass-shift survey) |
| `isobars` | the exact isobars of the row's best name, `=`-separated (`Oxidation=Ala->Ser=Phe->Tyr`); `-` when it has none. Mass cannot choose among them |

These columns are candidates, not identifications: nothing in them is
FDR-controlled. See Mass-shift survey.

**`-glyco_out`** (see Glyco flag): one row per processed MS2 spectrum.

| Column | Meaning |
|---|---|
| `spectrum` | native ID |
| `n_oxonium` | distinct oxonium ions matched |
| `oxonium_frac` | their summed intensity over the base peak, 3 decimals |
| `glyco` | 1 when `n_oxonium` >= 2 and `oxonium_frac` >= `-glyco_min_fraction`, else 0 |
| `ions` | names of the matched ions, separated by `;` (e.g. `HexNAc;NeuAc-H2O`) |

**`-check_header_out`**: one row per MS2 spectrum with a header charge, in input
order; the 18 columns are described in
[doc/HEADER-CHARGE-CHECK.md](doc/HEADER-CHARGE-CHECK.md): `index`, `native_id`,
`precursor_mz`, `header_charge`, `call_charge`, `call_src`, `basis`, `runner_up`,
`header_excess`, `call_excess`, `header_ruled_out`, `header_peaks_above`,
`ms1_charge`, `ms1_peaks`, `flag_basis`, `flag_charge`, `verdict` (`agree`,
`disagree`, `ambiguous`, `nocall`) and `tagged_charge`.

## Reconciliation and mass shifts

`-recon_out` places every reported tag onto tryptic windows of a protein
database by its flanking masses and interprets the mass gap as a modification or
substitution (after TagRecon, Dasari 2010), running on a
per-run suffix-array index over the whole proteome (~6.5 bytes per database
residue: ~75 MB and ~1.4 s to build on one thread for the human reference
proteome, ~0.15 s on 64; isobaric collapse and I/L folding applied identically
to the membership filter). Each row carries the protein, the
peptide window in its original database spelling, the position, which flank
matched, and — when exactly one flank disagrees — the localized mass gap with
a best-effort interpretation (`mod:Name@X`, `sub:X->Y`, or `?`).

`-recon_id_out` writes the same placements through OpenMS's idXML, mzIdentML
or mzTab writer (by extension), so identification tooling can read them. A
hit is one placement: the unmodified database window (fixed residue
modifications only; a terminal one stays in the mass gap) with every protein
and position it occurs at (rows differing only in protein are one hit), the
spectrum's native ID, precursor m/z and charge, and the tag's E-value as
score (lower is better). The mass gap and the other row fields travel as
metadata, never as a localized modification. The run names FASTag as search
engine and is marked `FDR_controlled = false`. An mzid needs at least one
placement; without any, the file is written empty (0 bytes).

`-delta_out` aggregates those gaps into a histogram, counting each spectrum
once (its best tag's smallest-|delta| placement) so fifty correlated tags
cannot flood a bin; placements whose mismatched-side flank was clamped to zero
are excluded and counted. **Read the histogram as candidates**: localization is
region-level, nothing here is FDR-controlled, and `delta_interp` names a
hypothesis, not an identification. On a human Astral run the zero bin
dominates, the +1.003 isotope-error peak and a +128.095 missed-K peak appear
where chemistry predicts them.

### Mass-shift survey

`-delta_out` also says where each row's gaps sit and what they could be
(1.16). For every spectrum the placement selected for the histogram (above) is
localized on the spectrum's own peaks, as `-recon_localize` does: each residue
of the gap's region is scored by the b/y ions (at fragment charges up to the
precursor's less one) it explains carrying the gap.

- **Site-determining evidence only.** Ions that put every candidate site in the
  same state add the same to every score; what tells the chosen site from the
  others is its score less the best other site's. The `residues` column counts
  localized spectra only.
- **Evidence classes (1.16b).** A gap is **fragment-localized** when that lead
  is at least `-delta_loc_min_evidence` (2), **ambiguous** when it is 1 to
  that less one, **unlocalized** on a tie, and **sequence-constrained** when
  its region is a single residue: then the placement puts it there and no
  fragment chose it, however many ions match. Localized = fragment-localized
  + sequence-constrained (both name rows). Under the default
  `-delta_loc_model strict` a site scores its distinct matched peaks (a peak
  supports one ion of a site's hypothesis at most), and a shifted ion's peak
  that is an H2O or NH3 loss satellite of an observed unshifted ion does not
  count: in HCD those peaks sit exactly where a -18.011 or -17.027 shift puts
  every ion. On the six PXD045734 development runs, fragment-localized sites
  at evidence 2 agreed with MSFragger's localized residues for 0.88 (95% CI
  0.86-0.90) of 731 checkable spectra, against 0.73 (0.72-0.75) at 1; the same
  placements on spectra moved by 7.3 Th localized 2 of 15,405 gaps at
  evidence 2 (268 at 1). `-delta_loc_model count -delta_loc_min_evidence 1`
  is the 1.16a rule. `-recon_out`'s localization is unchanged.
- **Terminal-ambiguous sites.** No b/y ion tells the peptide's first residue
  from its N-terminus (or the last from the C-terminus), so a gap on the
  N-side placed on the first residue is `N-term|X`, on the C-side placed on the
  last residue `C-term|X`, with `Protein` in front when the peptide starts
  (position 0, or 1 after an initiator Met) or ends its protein. A one-residue
  region has no rival and is always terminal-ambiguous.
- **Names.** Unimod entries come from OpenMS's `unimod.xml` (read as
  ModificationsDB reads it, without `custom_mods.xml`'s CUSTOM entries), one
  per site specificity; PSI-MOD terms are read from `PSI-MOD.obo` itself
  with their own residue and terminus, since ModificationsDB keeps a PSI-MOD
  term that cross-references Unimod only as an alias of the Unimod entry.
  Cross-link terms (two origins), obsolete terms and terms on any residue (`X`)
  without a terminus are left out, and so are generic and abstract terms: the
  children of MOD:00008 "common" (placeholders "from UniMod representing one
  or more entries in RESID", named after a Unimod site classification:
  MOD:00565 "glycosylated asparagine" is Unimod 7 Deamidated's
  N-glycosylation site, +0.984) and residue-generic classes (an origin-`X`
  term other terms are `is_a` of, e.g. MOD:00400 "deamidated residue").
  Deamidation on N is therefore MOD:00684 "deamidated L-asparagine". A residue site takes the entries on that
  residue; a terminal-ambiguous site also takes the entries of its terminus
  (`N-term`/`C-term`, the `Protein` ones only at the protein's terminus), never
  an entry on another residue. One entry per accession with the sites it fits
  (most localized spectra first); Unimod and PSI-MOD alike sorted by those
  spectra (the entry that explains more of the row comes first), then by mass
  error, at most five per column.
  The tolerance is `-delta_name_tolerance` (default 10 ppm of the row's median
  peptide mass); the error is written in ppm of that mass (mDa with `Da`).
- **Fixed modifications.** Database residues carry the fixed modifications,
  so a gap on such a residue is measured against the modified residue, and
  Unimod masses are relative to the unmodified one. Each entry on that residue
  is tried both ways: on top of the fixed modification (gap = entry mass) and
  instead of it (gap = entry mass − fixed mass, written `[-Carbamidomethyl]`).
  Dehydroalanine from Cys (Unimod `Cys->Dha`, −33.988 Da against Cys) is
  therefore a row at −91.009 with `Cys->Dha@C[-Carbamidomethyl]` when
  Carbamidomethyl (C) is fixed, and a row at −33.988 with `Cys->Dha@C` when it
  is not. Fixed terminal labels (TMT, iTRAQ) are not undone.
- **Isotope errors.** A gap on the N-side of a forward (y-read) placement is
  the precursor mass less the top fragment, so a wrongly picked monoisotopic
  precursor peak enters it: a +1.003 row is a 13C error candidate, and a
  +0.984 row (deamidation) should be read next to it. Gaps on the other side
  come from fragments only. The `isotope_error` column marks a row within the
  name tolerance of 13C+1 (+1.00336) or 13C+2 (+2.00671) unless a
  residue-specific name explains it better: a Unimod entry that is not an
  isotopic label (`Label:15N(1)` and the like are the same mass coincidence,
  not a better reading), sits on a residue, fits with a smaller error and
  covers at least half of the row's localized spectra. A deamidation row
  (+0.984, 19 mDa below 13C+1, localized on N/Q) keeps its name and gets no
  isotope reading; the 0.5 mDa bins and ppm name errors keep the two apart.
- **Rows.** One shift spread over neighbouring bins (deamidation over
  0.981-0.997 on a Q Exactive run, the gap's error being on the peptide's
  mass scale) is one row by default: rows are grouped around the most
  populated bins within `-delta_group` (0.004 Da), without chaining, so two
  shifts more than twice that apart (0.984 and 1.003) never merge, and every
  spectrum counts once. `-delta_group 0` writes the 1.15 rows.
  `-delta_spectra_out` lists each spectrum's sample and row, for checking
  rows against a search engine spectrum by spectrum.

- **Provenance and counts (1.16b).** `-delta_spectra_out` gives each
  sample's tag, placement, orientation, gap side and whether that flank comes
  from the precursor, charge and its source, the unrounded gap and the
  selected tag's competing placements; `-delta_counts_out` reconciles the run
  from MS2 to rows with sum checks. Tagging, selection and rows are
  thread-independent.
- **Observation classes (1.16b).** Each gap is classed before any name, the
  first that fits within the name tolerance: `extension` (the 1-3 protein
  residues beyond the peptide on the gap's side: a missed cleavage, +156.101
  for Arg), `truncation` (minus the 1-3 region residues at that terminus),
  `adduct` (the nearest of Na+, Mg2+, K+, Ca2+, Fe3+, Fe2+ for protons, or
  NH3), `isotope` (1 or 2 x 13C on a precursor-derived flank, nearer 13C than
  deamidation), `loss` (H2O, NH3, CH4SO, H3PO4), `fixed_loss` (minus a fixed
  modification on a residue carrying it: -57.021 on carbamidomethyl-Cys is an
  unalkylated Cys; tried first when the gap is localized on that residue),
  `fixed_replacement` / `terminal` / `residue` (a non-label Unimod entry fits
  instead of a fixed modification, on a terminus, on a residue),
  `substitution` (the placement's `sub:X->Y`), else `unknown`. A class says
  what kind of observation the mass is, not that the chemistry is proven.
- **Exact isobars (1.16b).** Oxidation = Ala->Ser = Phe->Tyr, dioxidation =
  Pro->Glu = 2 x oxidation, acetyl = Ser->Glu, deamidation = Asn->Asp =
  Gln->Glu, carbamidomethyl = Gly->Asn, carboxymethyl = acetyl + oxidation
  share one elemental composition: the `isobars` column lists the class of
  the row's best name (catalogue names, substitutions of the row's localized
  residues, sums of two common modifications within
  `-delta_isobar_tolerance`), so a row is not read as its first name alone.
- **Charge.** A precursor without a charge is tagged and localized as 2+
  (`charge_source` `assumed`); a 3+ precursor then gives a wrong
  precursor-derived flank. `charge_assumed` counts them per row. On the
  PXD045734 development runs they were 7.6% of the samples, and 10% of their
  gaps agreed with an open search (73% of the others').

What the columns are not: a placement is a peptide window chosen by tag
E-value and the smallest gap, not a validated peptide; a localized site is the
best-supported residue of that window; a name is a catalogue entry that fits
the mass on that residue. Frequencies of modifications need validated
placements and sites; these are candidates to check.

## Protein shortlist and search hand-off

Experimental in 1.12, opt-in, and NOT FDR-controlled: `-shortlist_out`,
`-fasta_out` and `-search_config_out` turn the placements `-recon_out` would
write (whether or not it is written) into a ranked protein shortlist, a reduced
FASTA for a database search, and a configuration for Sage or Comet. This is a
search-space reduction, not an identification and not protein inference; the
search engine controls the FDR over the reduced database. Every reported tag
with E ≤ `-shortlist_max_evalue` counts each of its exact placements (both
flanks agree, or one is off by exactly a fixed terminal label); a spectrum
counts once per protein. Proteins are ranked by spectra, peptides, a
shared-spectrum weight, best E-value and accession; decoys (by accession
affix) are listed but never kept or written, and FASTag adds no decoys of its
own: the configuration lets the engine generate them. Placement windows are
tryptic, so the run's tag ends are checked first: a confidently non-tryptic
protease call (the PXD040407 chymotrypsin run calls `unspecific`) writes the
shortlist with the call in its header but no FASTA and no configuration, and
exits with `ILLEGAL_PARAMETERS` unless `-shortlist_force` (a run asking for
`-shortlist_out` alone withholds nothing: WARN, exit 0). Experimental in 1.13
(`auto` passed its held-out test, see Held-out acceptance; a named rule and
`unspecific` have none): `-shortlist_protease auto` (or a protease name, or `unspecific`) places the
shortlist's tags on windows found by flank mass and keeps those that fit the
called (or named) cleavage rule at `-shortlist_specificity`, and writes that
rule into the engine configuration, so non-tryptic runs get their FASTA and
configuration instead of being refused. After 1.13.1 an Asp-N call of `auto`
is placed and exported semi-specific unless `-shortlist_specificity` is
given (development runs only, no held-out test). Only tags at or
above the placement floor place (`-recon_min_length`, derived as 8 residues on
the human proteome), so give `-extension` (3 on the gate runs). See [doc/SHORTLIST.md](doc/SHORTLIST.md).

### Mass shifts as search configuration

`-search_shifts` (1.12, experimental) added the run's mass-gap peaks to
`-search_config_out` as variable modifications or mass offsets. It failed
both held-out tests and was removed in 1.14, with `-search_shifts_out`,
`-shift_max_variable`, `-shift_max_offsets`, `-shift_expand_sites` and
`-shift_site_min_*`: the names are accepted with a warning and have no
effect. First test (acceptance/1.13 RESULT-item17.md, four runs): more PSMs
at 1 % FDR, but an open search's top mass shifts were not recovered and
Sage's entrapment FDP exceeded 1.5 %. Second test (`acc113r/shifts`,
RESULT-item17r.md, four new runs): more PSMs on 4 of 4 runs (Comet +7.7 to
+36.8 %, Sage +6.5 to +25.2 %), but Comet's entrapment FDP rose on the TMT
run PXD037999 (0.88 -> 1.28 %, limit +0.30 points), and the option recovered
only 5 of 32 (Comet) and 3 of 11 (Sage) admissible peaks of an MSFragger
open search. See
[doc/SHORTLIST.md](doc/SHORTLIST.md#mass-shifts-as-engine-configuration-112-17-removed-in-114).

## Digest, label and mass-gap reports

`-digest_out`, `-label_out` and `-massgap_out` describe how a run was digested
and labelled, from the tags the run reports. With `-fasta` those are only the
tags written, that is the database matches (plus the `efwd`/`erev` rows under
`-entrapment_fasta`), so for an unbiased picture write these reports in a run
without `-fasta`. Each is a long-form TSV with the
columns `section`, `key`, `value`, `n` (the tags or spectra a value rests on)
and `description` (one sentence with the numbers). They report measurements;
how much to trust them is for the reader to decide. The tag TSV, `-recon_out`,
`-delta_out` and the species report are byte-identical with and without these
options; `-out_spectra` mzML records every parameter, so it lists the new
options and their values.

- **`-digest_out`** counts the residue one mass step beyond each ungapped tag
  with an E-value ≤ 1: a `cterm_mass` equal to a residue (y tags), an
  `nterm_mass` equal to a residue plus water (reversed b tags), and an
  `nterm_mass` equal to a residue (the N-terminal P1'), within 0.008 Da. Residue
  masses are fixed and ignore `-fixed_modifications`: C counts at its
  carbamidomethyl mass (160.03065 Da, as in prose-auto 0.1.3), so with another Cys
  modification (e.g. `Methylthio (C)`) tag ends at C are not counted. Labelled
  K (TMT, TMTpro, iTRAQ4, Lys8) counts as K. Each protease model, mixed with 5 %
  background, is scored by the multinomial log-likelihood of these counts; the
  call is the best model and the margin its lead per tag over the best model of
  another class. The shipped models are cleavage rules (Trypsin, Lys-C, Arg-C,
  Glu-C, Chymotrypsin, Asp-N, Lys-N) and `unspecific`, over the human
  reference proteome composition, or over the composition of `-recon_fasta` /
  `-fasta` when given. HLA or proteasome models need a `-digest_models` table.
  No call is made, and the reason is written, on Da tolerances, timsTOF input,
  a median MS2 scan window or a median first MS2 peak above y1 of K plus 0.1
  (147.21), ion-count intensities without instrument metadata, fewer than 100
  tag ends, a residue at probability 0 under the call or the runner-up, or an
  exact tie between models of different classes. The timsTOF and scan-window
  rules read instrument, native-ID and scan-window metadata; without it they
  read `unknown` and do not block the call (converted pseudo-spectra carry
  none, and neither does an MGF, whose `ion_mobility` row reads `absent`). The
  first-peak rule needs no metadata, and neither does `ion_counts`: when the
  input names no instrument and no native-ID format, and at least half of the
  MS2 peak intensities above 0 are whole numbers (ion counts, as timsTOF data
  have; Orbitrap intensities are not), no call is made. Native-ID formats that
  name no vendor (peak list MS:1000774/MS:1000775, scan number only
  MS:1000776, the generic MS:1000777 that OpenMS writes into an mzML converted
  from an MGF, and MS:1000824) count as no format. So an MGF gets no call where
  its mzML gets `no_call` for timsTOF or the scan window: on public runs the
  first-peak rule caught every narrow-scan-window run, and `ion_counts` the
  timsTOF ddaPASEF MGF it missed (PXD054073's AlphaTims MGF), while Orbitrap
  MGFs kept every call their mzML made. Other TOF instruments that write ion
  counts are withheld the same way when their metadata is missing, and so is
  an Orbitrap MGF whose writer rounds intensities to integers; a timsTOF MGF
  with scaled or averaged intensities is not caught.
- **`-label_out`** counts tag ends that are a bare TMT, TMTpro or iTRAQ4 mass,
  against the same count 0.5 Da higher, and the Lys8 and Arg10 shares of the
  C-terminal K and R. Its last five rows (section `label_call`) give a label
  call from these counts with prose-auto's thresholds: TMT, TMTpro, iTRAQ4,
  SILAC or label-free, or no call on a Da tolerance or below 175 C-terminal
  tag ends. The experimental `-label_call_min_tags 0` (1.13), which called
  every ppm run, failed its held-out test (149/172, 0.866, against the
  threshold 0.922) and was removed in 1.14 (doc/DESIGN-digest.md, "Label call
  minimum").
- **`-label_discovery_out`** (1.13) was removed in 1.14: it failed its
  held-out tests (see Held-out acceptance).
- **`-massgap_out`** reads the `-delta_out` histogram (built even when
  `-delta_out` is not written; run it without fixed modifications to see the
  Cys alkylation): spectra near each Cys alkylation mass, and gap peaks
  explained as the smallest combination of up to three of 38 Unimod
  modifications.
- **`-alkylation_out`** (1.12, experimental, not validated on held-out data)
  calls the Cys alkylation reagent (Carbamidomethyl, Propionamide,
  Nethylmaleimide, Methylthio, Carboxymethyl) or `none` (unmodified, oxidised,
  cysteinylated or dehydroalanine Cys) from the placements of the run's own
  reconciler: each MS2 spectrum votes once with its best tag placed on a
  peptide with exactly one C on the gap side, and the reagent mass is the gap
  plus the fixed C modification. On a labelled run (a fixed N- or C-terminal
  TMT or iTRAQ modification) the label is first taken off a gap on its side,
  as the reconciler's flanks carry it. Without `-recon_out` the placements are made
  on `-recon_fasta` or `-alkylation_proteome` and not written; every other
  output is the same with and without it. Sections `alk_run`, `alk_cys` and
  `alkylation_call`; the format is documented and versioned in
  doc/ALKYLATION-REPORT.md.
- **`-alkylation_tags_out`** (1.13, experimental; held-out test passed at the
  margin) makes the same call without a database. A second tagging pass, whose
  tags are not written, drops the run's C modifications. It spells C as
  unmodified or as `C[<reagent>]` for the five reagents. Each MS2 spectrum
  votes once with its best ungapped 1+ tag (E <= 1) that holds a C; tied
  tags of two forms are a conflict. A tolerance that cannot separate
  Carbamidomethyl from Carboxymethyl (0.984 Da apart, so 0.5 Da) gives no
  call (`unresolved_forms`). There are known confounds:
  C[Carbamidomethyl] = G + C and C[Propionamide] = A + C when the peak
  between them is missing. The report lists the twins within the run's
  tolerance. The pass costs about one more tagging run. On 57 held-out runs
  from 57 PRIDE projects it called 40, 37 of them right (0.925, Wilson 95%
  interval 0.801-0.974). It abstains on samples that are not alkylated (2 of
  12 called) and does not confirm the absence of alkylation
  (doc/ALKYLATION-REPORT.md).
  Sections `alkt_run`, `alkt_form` and `alkylation_tags_call`.

The `-digest_out` options of 1.12 (`-digest_models_version v2`,
`-digest_detection`, `-digest_flank2`, `-digest_min_confidence`) are opt-in
and not validated on held-out data; at their defaults the report is the
FASTag 1.11 one byte for byte, and with any of them on it gains `run`,
`meta instrument_class`, `count flank2_n`, `call p_correct`/`flank2_used`/
`timstof_call` and `nocall low_confidence` rows.

`-digest_quality <enzyme|auto>` (1.13, experimental, off by default) appends a
`quality` section after every other `-digest_out` row, so the report without
it is unchanged. For each cleaving end of the enzyme's model it gives the
share of tag ends outside the cleaving residues (`nonspecific_share`), the
background share that fits the P1 counts best (`nonspecific_mle`), and a
missed-cleavage odds ratio: how often the cleaving residues occur at P2..P4
of the tags with a specific end, against the background (`mc_retention`; 0 =
every site cut, 1 = as often as in the proteome). An end is measured with at
least `-digest_tag_min` tag ends, and its missed-cleavage ratios need that
many specific ends as well (else `mc_measured no`, `mc_reason
mc_few_specific`, ratios `-`). On a Da fragment tolerance nothing is measured
(`status not_measured`, `reason low_resolution`), as for the protease call.
Measured from the tags alone; doc/DESIGN-digest.md has the definitions and a
descriptive comparison with Sage.

`-digest_out` also writes the background in use and each model's residue
distribution before mixing, from which the Desktop GUI draws its logos. The
counting reproduces prose-auto 0.1.3's detectors. `FASTAG_FULL_PRECISION=1`
in the environment writes the tag TSV's masses and E-values in full precision,
for comparing against a reader of that file. The shipped tables are read from
`share/FASTag/digest` next to the binary; a binary run outside its install
tree needs `FASTAG_DIGEST_DIR` set to that directory.

## q_db: entrapment-calibrated filter confidence

`-entrapment_fasta` builds a second membership filter over sequences the
sample cannot contain (use phylogenetically distant proteomes — archaea for a
mammalian sample) and appends a `q_db` column: the estimated **false-match
rate** of accepting every tag at or below that row's E-value against `-fasta`.
Entrapment-only matches are marked `efwd`/`erev` with an empty `q_db` — they
are calibration material, not discoveries — and are excluded from
`-out_spectra`. Ratios are computed per tag length in collapsed k-mer space,
orientation-closed. Requires `-fasta`; cannot be combined with `-species`.

**Use tight thresholds.** Measured on human Astral data with archaeal
entrapment, `q_db` is conservative at `<= 0.02` but **underestimates the true
false-match rate ~1.6x at 0.05–0.1**, and is sensitive to the entrapment
database chosen. Read the column for what it is: `q_db` says how often a tag
this good matches the database by chance — it says NOTHING about whether the
tag correctly reads its precursor (on PXD000001 ground truth, rows at
`q_db <= 0.01` were correct reads 100% of the time, rows in the 0.05–0.2 bin
only 52.9%).

## Streaming mode

`-stream` turns FASTag into a resident process for instrument-control loops:
spectrum blocks in on stdin (`spectrum <id> <precursor_mz> <charge>`, one
`<mz> <intensity>` per line, blank line to finish), TSV rows plus a
`#end <id> <n_tags>` sentinel out on stdout, flushed per block; malformed
input yields `#error` and a resync, never an exit. All fixed costs are paid
once; measured steady state on real Astral spectra is **0.3–0.6 ms mean,
p99 <= 1.6 ms** per spectrum even with extension and gaps. Rows are
byte-identical to file mode. `<id>` is one token without spaces (it is echoed
in the rows and in `#end`); a header with a space in the ID or a missing field
gets `#error <id> bad header`. A `<charge>` of 0 or less is tagged as 2+, like
an mzML precursor without a charge (a negative charge does not mean negative
polarity here, unlike MGF). Core tagging only: the flags `-species` and `-glyco`
and the options `-fasta`, `-entrapment_fasta`, `-taxdb`, `-usi_collection`,
`-out_spectra`, `-recon_out`, `-recon_id_out`, `-delta_out`, `-species_out`,
`-digest_out`, `-label_out` and `-massgap_out` are refused; parameter changes
need a restart.

## Probe and spectrum dump

Two machine interfaces, used by the desktop GUI (1.12). Both print JSON lines
to stdout only, write no file, exit without tagging, and are refused with
`-stream`. Every line is an object with a `record` key; the first is the
format record (`"format":1`), the last is `{"record":"end"}`, so a cut stream
is detectable. Readers ignore records and fields they do not know. Both are
listed in `--helphelp`, which is how the GUI detects them.

- `-probe_input <file>` reads metadata only (mzML, mzPeak or MGF) and prints the
  records `probe` (format, version, input, file_format), `instrument` (name,
  model, ms2_analyzer, ion_mobility), `spectra` (MS1 and MS2 counts, the
  centroid/profile verdict of the probed MS2 and `will_pick`, whether
  `-pick_profile` as given would centroid them), `activation` (collisional,
  electron, hybrid, unknown), `index` (ok, stale, absent, not_applicable) and
  `acquisition` (the raw-DIA check's call and whether `-acquisition_check` as
  given would refuse the run). With `-fasta` it adds a `fasta` record (proteins,
  decoys by `-shortlist_decoy_affix`). A FASTA file (`.fasta`, `.fa`, `.faa`,
  `.fas`) given alone prints only `probe`, `fasta` and `end`. The exit code is 0
  whenever the file could be read, also for raw DIA.
- `-dump_spectrum <nativeId>` prints one `spectrum` record for the spectrum of
  `-in` with that native ID (MGF: `index=<i>`): `mz` and `int`, the peaks
  after the reader's centroiding (`-pick_profile`), the precursor cut, the m/z
  collapse, deisotoping and the peak budget, exactly as the tagger prepares
  them under the options given; plus `precursor`, `charge` (as tagged; an
  uncharged precursor is tagged as 2+), `charge_given`, `native_id`, `index`,
  `tolerance` and `tolerance_unit`. Under `-ion_series cz`, or `auto` on an
  electron-activated mzML spectrum, the peaks are prepared as c/z-dot ions,
  as the tagger reads that spectrum (the ETD precursor-window cut included).
  An unknown ID exits 6 with the ID on stderr
  and nothing on stdout. The dump prepares the given precursor at its charge
  (or 2+) only; with `-unknown_charge` or `-isotope_error` away from their
  defaults it exits 6 rather than print peaks that were not tagged.

## Glyco flag

`-glyco` writes `<out>` with its extension replaced by `.glyco.tsv`
(`-out run.tags.tsv` gives `run.tags.glyco.tsv`): one row per processed MS2 spectrum with the
count of matched oxonium ions, their summed intensity over the base peak, a
0/1 flag (>= 2 distinct ions AND fraction >= `-glyco_min_fraction`, the
GPQuest / MSFragger-Glyco heuristics with their literature thresholds), and
the ion names. The flag means "a glycan fragmented here" — glycopeptide, free
glycan, or O-GlcNAc — never an identification. It lives in its own file
because glyco spectra are precisely the tag-poor ones a tag-TSV column would
miss; expect more rows than "MS2 tagged". Matching runs on the raw peak list
at the run's fragment tolerance. At 0.3 Da the TMT reporter 126.128 collides
with the HexNAc fragment 126.055, so glyco flags on labeled ion-trap data are
unreliable; on high-resolution MS2 use a ppm tolerance.
Measured specificity on non-enriched runs: 0.6% (Astral, ppm) flagged.

## Census

`-census` writes `<out>` with its extension replaced by `.census.tsv`: one row
per MS2 spectrum read (the sampled ones with `-subsample_*`), including the
spectra that give no tag, in input order. Every other output is the same with
or without it. Columns: `index` (input position), `spectrum`, `rt`,
`precursor_mz`, `charge_given` (0 = none), `charge_used` (2 when none was
given), `n_peaks` (positive, finite), `n_peaks_kept` (after the precursor cut,
m/z collapse, deisotoping and the peak budget), `n_edges` (residue edges over
all fragment charges), `n_compl` (kept peaks with a 1+ complement), `int_gini`
(Gini coefficient of the intensities, zero peaks included), `status`,
`n_found` (tags before `-fasta`), `n_reported` (rows in the tag TSV), and from
the reported tag with the lowest E-value (not necessarily the first row with
`-tag_lengths`): `best_evalue`, `best_len`, `best_min_conf`,
`best_mean_conf`, `best_tic` (summed intensity of its peaks), plus
`tag_cover` (m/z covered by the union of the reported tags). Fields that were
not computed for a spectrum are empty.

`status` is the first that applies: `empty` (no peaks), `no_precursor`,
`no_signal` (no positive intensity), `bad_precursor` (m/z not finite or <= 0),
`too_few_peaks`, `no_tags`, `filtered` (every tag rejected by `-fasta`),
`placed` (a `-recon_out` placement; only with `-recon_out`), `tagged`. The
first two are not tagged and not in the log's "N MS2 spectra"; all others are.
A status is not a quality call: `tagged` says a tag passed `-max_evalue`, not
that it is right, and acquisition (DIA or DDA) is never a census status.

The summary (`.census_summary.tsv`, the long form of the digest reports)
starts with the `run` rows and adds section `census`: `census_version`,
`input_spectra` (all MS levels), `ms2_seen`, `ms2_processed`, `ms2_total`
(empty when subsampling, because masked spectra are never read),
`subsampled`, `subsample_basis`, `count_` and `share_` per status,
`no_charge`, and p10/p50/p90 of the best E-value (tagged and placed spectra),
of `n_peaks_kept` and of `int_gini`. Subsampling draws from the input spectra
of all MS levels, so `-subsample_spectra 1000` on a run with MS1 scans reads
fewer than 1000 MS2 spectra. Both files are written as `.part` files and
renamed when the run finishes; `-census` cannot be combined with `-stream`.

`-census_ids <idXML|mzid>` joins the identifications of the same run to the
census. The table gains two columns: `identified` (1, 0, or empty when the
spectrum cannot be matched unambiguously) and `triage` (1 for spectra with
`identified` 0, status `tagged` or `placed` and `best_evalue` at or below
`-census_triage_evalue`, as written in the row; empty when `identified` is
empty). Without `-census_ids` the census is unchanged. A spectrum is
identified when one of its identifications holds a target hit whose q-value
is at most `-census_ids_fdr`: the hit's score when the score type is a
q-value (lower is better), otherwise its `q-value` or `MS:1002354` meta
value. Decoy hits are ignored (target+decoy counts as a target), an empty hit
list is not an identification, and a spectrum no identification names is 0.
A file in which no hit carries a q-value is refused: filter it with
FalseDiscoveryRate and IDFilter first. So is a file with identifications
(with hits) that carry no `spectrum_reference`, as pepXML converted without
`-mz_file` and older idXML may: add the references with IDFileConverter
`-mz_file`. References are matched to native ids
exactly; a scan number is used only when it is unique among the references
and the spectra read. A file naming another run warns, one naming several
runs is refused, and when more than 1% of the references match no spectrum
FASTag warns, above 50% it writes no census (exit code
INCOMPATIBLE_INPUT_DATA; the other outputs are complete). Under subsampling
that count is not known and is left empty. The summary adds section
`census_ids`: the file name, the thresholds, `run_check`, `id_no_ref`, the reference
counts (`refs`, `refs_exact`, `refs_scan`, `refs_ambiguous`,
`refs_unmatched`), `identified_1/0/unknown`, the cross-tab
`<status>_identified_<1|0|unknown>` and `triage_candidates`. Triage is an
E-value threshold, not a quality call. Whether the candidates are the
unidentified spectra a second (semi-specific or open) search identifies was
tested on held-out runs (second test PASS for a semi-enzymatic search; not shown for an open search): [doc/CENSUS-TRIAGE-EVAL.md](doc/CENSUS-TRIAGE-EVAL.md),
which also describes `tools/census_triage_eval.py`, the scorer.

For front ends that list a run's outputs by option name (the GUI's resolved
outputs): the census files are `census_out` and `census_summary_out`. With
`-census` and no path of their own they are `<out>` with its extension
replaced by `.census.tsv` and `.census_summary.tsv` (the rule of
`-glyco_out` and `-species_out`); without `-census` neither is written, and a
`-census_ids` run refused for foreign references writes neither. The log
names both paths (`Census: ... -> <census_out>, summary ->
<census_summary_out>`).

## Tag diversity

`-diversity` changes which tags occupy the `-max_tags` slots on chimeric
spectra: near-duplicate re-reads of an already-kept tag's peak set (same
charge, sharing all but at most one peak, both tags >= 4 peaks) are demoted
behind non-duplicates and backfilled in rank order. Output size, rank 1 and
determinism are unchanged — measured on a co-isolation-rich Eclipse TMT run,
spectra with at least one database hit **rose** from 8,547 to 8,695 under a
10-tag cap. What it does not do: surface a co-isolated peptide whose tags rank
far below the cap — deferral reorders families near the head; it is not
per-peptide clustering. Off by default.

## Assembly export

`-res_conf` appends per-residue confidences (0–100, N→C, one per residue; a
gap's two residues share their single pair score — the mass evidence supports
the pair, not either identity). `tools/tags_to_denovo.py` converts a
`-res_conf` TSV into the read formats antibody-assembly tools consume (Stitch
PEAKS-style CSV, ALPS), thinning to the best tag per spectrum by default —
FASTag's per-spectrum tags are correlated re-reads of one ladder, and
exporting all of them would inflate assembly consensus ~50-fold. I and L are
reported as L throughout; contigs will show L where I may be correct,
including in CDRs.

## Species detection

`-species` infers which taxa a run's tags come from — a native tag→taxon
classifier, no database search. Off by default (it maps a ~1 GB k-mer index),
and a complete request on its own:

```bash
FASTag -in run.mzML -out run.tags.tsv -species -tag_length 7
```

Each tag's k-mers are looked up in a reduced reference index; the taxa carrying
the whole tag vote, votes roll up the NCBI taxonomy, and each node is tested
against its background breadth. Output is a ranked TSV
(`rank taxid name observed adjusted expected log_pvalue qvalue`), one call per
taxon at `-species_rank` (genus by default), ordered by `adjusted` and showing
at most 50 rows. A taxon needs at least 5 supporting spectra to be tested; taxa
with fewer are not listed. `adjusted` is the observed spectrum count, or with
`-species_deconvolve` the deconvolved estimate; it does not use `expected`, so
on a small or low-resolution run a large proteome that collects chance 7-mer
hits can outrank the true genus (q stays the better guide there).

**Only ungapped tags vote.** A gap spells two residues from one summed mass, and
an exact k-mer lookup cannot tell an inferred residue from an observed one — on
PXD000001, admitting gapped tags drops the true genus from rank 1 to rank 20.
`-species_use_gapped` admits them anyway.

**A spectrum counts for the taxa of its best tag.** A spectrum is one peptide,
but up to `-max_tags` tags are reported for it, most of them wrong readings.
Up to 1.9.0 a spectrum counted for every taxon that ANY of its tags supported,
so each wrong tag added the taxa its 7-mer hit by chance, and a taxon's count
grew with the number of tags reported per spectrum. Large and widely shared
proteomes collected most of those chance hits, and changes that only reorder or
admit lower-ranked tags moved the ranking. Now a spectrum counts for the taxa of
its lowest-E-value tag that maps into the index, judged by the `evalue` column
as written in the tag TSV (6 significant digits, so E-values that print alike
tie; ties are united; with `-species_use_gapped` a gapped row competes with its
`-gap_penalty`-inflated value); `-species_evidence all` restores the union.

**With `-fasta`, only the written rows vote.** A tag that does not occur in the
FASTA is not written and does not count, so the report then ranks only the taxa
of the database matches. Run `-species` without `-fasta` to see what the sample
contains.

`-species_deconvolve` subtracts the evidence a taxon earns only by resembling a
stronger one, which is what makes near neighbours rank. It is opt-in: it turns
the PXD000001 tail from Oryza/Zea into Pectobacterium's real relatives
Dickeya/Yersinia, but it also suppresses genuine low-abundance taxa, and on a
human run it disperses the mammalian block without improving the margin. See
[doc/SPECIES-DETECTOR.md](doc/SPECIES-DETECTOR.md) for the numbers.

**Decoy-based calls (opt-in, experimental).** `-species_call decoy` appends `call
call_reason decoy_spectra decoy_expected decoy_qvalue share lod` to every row:
`present`, `no_call` (low_resolution, few_spectra, unstable, near_neighbour) or
`not_detected` with a detection limit, never "absent". The null is decoy tags
looked up like the tags plus the spill a stronger related taxon is expected to
cause; `decoy_expected` is that null's expectation (`expected` keeps its 1.10
meaning). The shipped parameters are provisional (not fitted), and in 1.12.0
the decoy null failed its development check on real runs, so `call` and
`decoy_qvalue` are not calibrated. See
[doc/SPECIES-DETECTOR.md](doc/SPECIES-DETECTOR.md).

**Explain-away calls (removed in 1.14).** `-species_call explain` (1.13)
called the taxa one at a time, strongest first, each on its distinct tags in
spectra no taxon called before it explained. Its held-out test FAILED (62
public runs, `acc113r/species`): 0.50 false genus calls per run against 5.98
for the decoy call (primary, passes), but recovery 38/105 against 77/105
(guard, fails). It was removed in 1.14 with `-species_reagents`, which only it
read: `-species_call explain` is accepted with a warning and read as `none`,
`-species_reagents` is accepted with a warning and has no effect. The default
(`none`) and the decoy call are unchanged.

**Both tag orientations (opt-in).** Tags are written N->C under a y-ion
assumption, so a tag read from b ions is written reversed, and `-species`
looks up only the written reading. `-species_orientation both` looks up both
readings: one informative reading is used, two are intersected, and a tag
whose readings share no taxon is skipped (so counts can fall as well as
rise). No analytic background follows from that rule, so the analytic
`log_pvalue` and `qvalue` columns are NA under `both`, with or without
`-species_call decoy`, and a warning says so; the decoy-based value is the
`decoy_qvalue` (and `call`) of `-species_call decoy`. It is
not coupled to `-orientation`, whose default (both) would otherwise change
the species report.

The longest `-tag_length` plus 2 × `-extension` must reach the index k (7).
Otherwise no tag can be long enough to look up, and FASTag refuses the run up
front rather than writing an empty report. Only tags of at least k residues
after extension are looked up (or `-species_min_len` residues, if that is
larger). Pair `-species` with `-subsample_fraction 0.1` for a fast call on a large
run.

**Get the index.** Every release bundle carries the full k-mer index, so
`-species` works out of the box; only a source build needs the download:

| bundle | NCBI dumps (`nodes.dmp`, `names.dmp`) | k-mer index `tax_k7.taxdb` (~1.06 GB) | `MANIFEST.json` |
|---|---|---|---|
| CLI: Linux x64/arm64 `.tar.gz`, macOS arm64/x64 `.dmg`, Windows x64 `.zip` (`share-FASTag-taxonomy/`) | yes | **yes** | yes |
| Desktop app: macOS `.dmg`, Linux `.deb`, `.tar.gz` and `.AppImage` (x64, arm64), Windows installer (`resources/fastag/share/FASTag/taxonomy/`) | yes | **yes** | yes |
| Homebrew casks `fastag`, `fastag-cli` (the two macOS `.dmg`) | yes | **yes** | yes |
| Index-only asset `FASTag-<version>-taxonomy-k7.tar.gz` / `.tar.xz` (+ `.sha256`) on every release | yes | **yes** | yes |
| Source tree / source archive (`data/taxonomy/`) | yes | no: download the index-only asset | `manifests/<data tag>.json` |
| CI artifacts of pull requests and pushes to main | yes | no | no |

For a source build, an upgrade of an older install or a
`FASTAG_TAXONOMY_DIR` setup, extract the index-only asset
(`FASTag-taxonomy-k7.tar.gz` up to 1.14.0) into the FASTag directory:

```bash
tar xzf FASTag-<version>-taxonomy-k7.tar.gz -C /path/to/FASTag/   # -> share-FASTag-taxonomy/
```

`MANIFEST.json` names what the index was built from: the UniProt reference
proteomes, the NCBI taxdump, the build commands and the sha256 of every file.
For the index shipped since 2026-09-01 it was reconstructed afterwards and
lacks the UniProt release and the proteome checksums; see
[data/taxonomy/README.md](data/taxonomy/README.md). The index is derived from
UniProt (CC BY 4.0) and the dumps from NCBI Taxonomy (public domain); see
"Licence and provenance".

FASTag looks for the taxonomy in `FASTAG_TAXONOMY_DIR` if that is set to a
directory. Otherwise it looks beside the executable, in
`../share/FASTag/taxonomy` (an installed tree), `share-FASTag-taxonomy/` (the
release archive) or `taxonomy/`, and prefers a folder that holds the index over
one that holds only the NCBI dumps. Set `FASTAG_TAXONOMY_DIR` to use a custom or
larger reference set, or to run a binary outside its install tree; see
[data/taxonomy/README.md](data/taxonomy/README.md). `-taxdb`,
`-taxonomy_nodes` and `-taxonomy_names` override the lookup.

Index rebuilds ship as their own `taxonomy-k7-YYYYMMDD` **pre-release** — a
normal release would take GitHub's "Latest" slot, and every `releases/latest`
link above would show the index instead of the binaries.

The index is a bit-packed, memory-mapped format (`FTX2`): a 50-taxon index is
~1 GB on disk and **under 1 GB resident**, and loads instantly. Rebuild it from
`data/taxonomy/reference-set.tsv` with `tools/fetch_reference_set.py` +
`buildtaxdb` (deterministic, so a checksum verifies a download).

**Read it as genus/family, not species.** The reference set is ~50
representative proteomes (model organisms, MS contaminants, common pathogens, gut
microbiome, archaea), one per genus. Short peptide 7-mers cannot separate close
relatives: on a human sample *Homo* ranks first but *Macaca*, *Bos*, *Sus* follow
within a few percent, because mammalian proteomes share most 7-mers. `q` is a
ranking aid, not a calibrated FDR: its background is a stand-in, and no
simple null model reproduces mixed (chimeric) spectra. Reagent
genera (*Bos*, *Sus*, *Oryctolagus*…) appear in almost any run — the GUI flags
them; in the TSV they are simply present.

## Demo data

Public runs from [ProteomeXchange](https://www.proteomexchange.org)/PRIDE,
spanning two vendors and three instruments:

| dataset | instrument | accession | file | convert with |
|---|---|---|---|---|
| HeLa, real ddaPASEF | Bruker timsTOF Pro | [PXD054073](https://www.ebi.ac.uk/pride/archive/projects/PXD054073) | `HeLa_T2_DDA_E_A_nLC_timspro_R02.d.7z` (3.17 GB) | `brfp convert -i <.d> -f 2 -o out.mzML` |
| Label-free DDA | Orbitrap Astral | [PXD076528](https://www.ebi.ac.uk/pride/archive/projects/PXD076528) | `7673_YD12_P116861_S00_R1.raw` (2.4 GB) | `ThermoRawFileParser -i in.raw -b out.mzML -f 2` |
| *Erwinia carotovora*, TMT6 | LTQ Orbitrap Velos (HCD) | [PXD000001](https://www.ebi.ac.uk/pride/archive/projects/PXD000001) | `TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML` (450 MB), with its Mascot search `F063721.dat` | already mzML |

The PXD054073 deposit also holds an AlphaTims MGF of the same run
(`HeLa_T2_DDA_E_A_nLC_timspro_R02.filtered.mgf`), which FASTag reads as is.

All three are high-resolution MS2 and want the 20 ppm default. Run PXD000001
with `-fixed_modifications "Methylthio (C)" "TMT6plex (K)" "TMT6plex (N-term)"`.
For ion-trap MS2 set `-fragment_tolerance 0.3 -fragment_tolerance_unit Da`, and
read the instrument out of the file itself before picking a tolerance: a
repository catalogue can label a deposit by its main instrument while single
files come from another. See [doc/TEST-DATA.md](doc/TEST-DATA.md) for the
provenance and what each dataset is useful for comparing.

A small example that runs in a second, `examples/Ecoli_MS2_small.mzML` (139 ion-trap MS2
spectra) with `examples/Ecoli_MS2_small.fasta` (three proteins), ships in the release
bundles and is in the source tree under `test/fixtures/`; [doc/TUTORIAL.md](doc/TUTORIAL.md)
walks through it and through PXD000001 with the expected results.

## Performance

**FASTag 1.15.0 against DirecTag 1.4.21142**, measured on 2026-11-18 on one
AMD EPYC 7763 (128 hardware threads, node-local NVMe, load per core below
0.25 before every run), 128 threads, DirecTag's settings (tag length 3, 50
tags, 100 peaks, no gaps, no deisotoping, 0.02 Da), warm page cache, one
uncounted warm-up, median of 3 runs, wall time and peak RSS from
`/usr/bin/time -v`, end to end including reading the input and writing the
tags:

| data set | FASTag 1.15.0 | DirecTag 1.4.21142 |
|---|---|---|
| [PXD047793](https://www.ebi.ac.uk/pride/archive/projects/PXD047793) timsTOF, diaTracer pseudo-DDA mzML, 24.7 GB | **7.13 s, 544 MB**, 62,347,705 tags | 732.69 s, 70.3 GB |
| [PXD028735](https://www.ebi.ac.uk/pride/archive/projects/PXD028735) raw diaPASEF mzML, 32.3 GB (`-acquisition_check warn`) | **7.70 s, 1.3 GB**, 864,815 tags | 479.90 s, reads 0 spectra |

That is 103 times faster with 129 times less memory on PXD047793. DirecTag's
numbers come from the 1.14.0 run of 2026-11-15 on the same node, inputs and
settings; FASTag 1.15.0 writes byte-identical tags to 1.14.0 on both files.
Harnesses, per-run rows, input sha256 and the release digest:
[bench/results/site-why-1.15.0](bench/results/site-why-1.15.0/RESULT.md) and
[bench/results/site-why-1.14.0](bench/results/site-why-1.14.0/RESULT.md).
Accuracy at these settings and at the defaults: see [Validation](#validation).

History: thread scaling at default parameters was last measured with FASTag
1.6.1 (2026-09-30, two AMD EPYC 9654) on
[PXD000865](https://www.ebi.ac.uk/pride/archive/projects/PXD000865) (Q
Exactive TMT8, 47,470 profile MS2): mzML 12.4 s / 0.46 GB at 16 threads and
7.61 s / 0.88 GB at 128; mzPeak 4.19 s / 1.15 GB and 1.28 s / 2.66 GB with
1.6's own mzPeak reader (since 1.8 mzPeak is read through OpenMS and is
slower, see [mzPeak](#mzpeak)). Not re-measured since.

The two containers return the same tags on centroided input. On **profile**
MS2, as in that PXD000865 run, they do not, and the times are not comparable either: the
mzML path tags profile samples as they are, while the archive was centroided
when written, so FASTag reads peaks and finds more tags (2,032,961 against
1,376,019). Centroid before tagging profile mzML, or read the archive.
FASTag does not centroid profile mzML MS2 (its 1.12 `-pick_profile auto`
failed its held-out test, see below, and was removed in 1.14).

**`-pick_profile auto` failed its held-out test and was removed in 1.14**
(it is read as `legacy`; `-pick_unknown_type`, which only it read, went with
it). The 1.12 test (#9, item09-H1, scored once against Sage 1% FDR truths) failed both non-inferiority (B1) and "no fewer
tagged spectra" (B2). Measured on the ion-trap run (PXD009049): two charge-3
cells failed non-inferiority (+0.49 points, lower bound below -1.0), the
charge-4+ cells were underpowered, and `auto` tagged fewer spectra at tag
length 4 and 5. Measured on two Orbitrap runs (PXD016519, Q Exactive Plus;
PXD018024, Q Exactive HF): rank-1 correct tags rose by +10.5 to +32.0 points
in all 9 cells (tag length 3-5, charge 2, 3, 4+), but on PXD016519 `auto`
tagged 567 fewer spectra at tag length 3 (15,987 against 16,554). No Astral
or TOF run was scored.

**Peak memory on spectra with many peaks (Linux).** Each thread keeps buffers
sized by the largest spectra it has read, so on large un-centroided MS2 peak memory
grows with the thread count. Measured at the default settings with a build of commit
7c08642 (released in 1.13.2) on BinAC2 (AMD EPYC 7543): on PXD028735 (diaPASEF frames,
median 24,000 peaks per MS2) about 13 MB per thread, 2.1 GB at 128 threads; on
centroided data with at most a few hundred peaks per spectrum (PXD047793) about 1 MB
per thread. About a third of the growth is glibc allocator overhead. (The 1.3 GB in the
table above is FASTag 1.15.0 at DirecTag-matched settings, 100 peaks per spectrum, on
another node.) Where memory is the limit, these glibc settings return freed memory
sooner and lowered PXD028735 peak memory by 18 / 14 / 9 % at 128 / 64 / 16 threads, at
10 / 7 / 6 % more run time (same build and node; no change on PXD047793; tags
identical). Record:
[bench/results/rss-pxd028735-1.13](bench/results/rss-pxd028735-1.13/RESULT-perthread.md)
(the per-run rows stayed on the cluster):

```bash
MALLOC_MMAP_THRESHOLD_=33554432 MALLOC_TRIM_THRESHOLD_=131072 MALLOC_TOP_PAD_=0 FASTag -in run.mzML -out tags.tsv -threads 64
```

Measured on these two data sets only; macOS and Windows use other allocators.

Output is identical at every thread count (`threads_test` checks every output
on the fixture). Row memory on the mzML path is bounded by a ring of three
blocks of 65,536 spectra, so it grows with the file up to ~196,000 MS2 spectra
and stays flat beyond; it does not depend on the thread count. Some options
keep per-run state that grows with the run: `-out_spectra` (one slot per input
spectrum), `-species` (every reported ungapped tag per spectrum, until the
end), `-recon_id_out` (every identification) and `-entrapment_fasta` (an
E-value and a flag per row).

**The defaults favour recall over speed.** For the fastest possible run, or to
match a tool with no equivalent of these, turn them off:
`-no_deisotope -gaps 0 -peaks_per_window 0 -max_peaks 100`.

## Validation

**Tag accuracy of FASTag 1.15.0** (2026-11-18), at DirecTag's published
settings (`matched`: tag length 3, 100 peaks, 50 tags, no gaps, no
deisotoping, 0.02 Da) and at FASTag's defaults (`default`: no options; tag
length 3, one gap with `-gap_penalty 100`, deisotoping, 400 peaks with 10 per
100 Da, 20 ppm). A tag is valid when its sequence (or its reverse) occurs in
the identified peptide (I = L) and a flanking mass agrees within 0.05 Da.
Rank-1 / top 5 / top 50: share of the identified spectra with tags whose first
/ first five / all tags include a valid one; any valid tag: share of all
identified spectra.

| data set (truth) | setting | rank-1 | top 5 | top 50 | any valid tag |
|---|---|---|---|---|---|
| [PXD000001](https://www.ebi.ac.uk/pride/archive/projects/PXD000001) LTQ Orbitrap Velos HCD, TMT6 (deposited Mascot search, 2,254 PSMs at 1% FDR) | matched | 90.91% | 97.91% | 98.62% | 98.62% |
| | default | **93.12%** | 97.96% | 98.71% | 98.71% |
| [PXD054073](https://www.ebi.ac.uk/pride/archive/projects/PXD054073) timsTOF Pro ddaPASEF, HeLa (Sage 0.14.7, 72,067 PSMs at 1% FDR) | matched | 64.70% | 80.68% | 85.89% | 84.95% |
| | default | **67.34%** | 83.07% | 90.13% | 90.09% |
| [PXD076528](https://www.ebi.ac.uk/pride/archive/projects/PXD076528) Orbitrap Astral DDA, human (Sage 0.14.7, 44,015 PSMs at 1% FDR) | matched | 47.97% | 60.87% | 67.09% | 66.50% |
| | default | **53.84%** | 67.39% | 79.65% | 79.63% |

The defaults rank a valid tag first more often on all three runs (+2.2, +2.6
and +5.9 points) and give more identified spectra a valid tag (+0.1, +5.1 and
+13.1 points). At the matched settings PXD000001 reaches the same 98.62%
ceiling as DirecTag 1.4.21142, with a valid tag first on 90.91% against
DirecTag's 88.69% ([doc/BENCHMARK-DirecTag.md](doc/BENCHMARK-DirecTag.md)).
PXD000001 is scored with `tools/pxd000001_truth.py`, the two Sage runs with
the `bench/fastag-bench` accuracy harness, whose flank rule is slightly more
lenient (either flank, modifications decoded). Commands, truth settings,
input sha256 and the full tables:
[bench/results/accuracy-1.15.0](bench/results/accuracy-1.15.0/RESULT.md).

Measured with FASTag releases before 1.4 (not re-measured): on PXD000001 with
`-gaps 1` at tag length 4, raising `-gap_penalty` from 1 to 100 raises rank-1
accuracy from 69.0% to 86.4%, while the share of identified spectra with any
valid tag stays at 98.05%.

The preregistrations, freezes, results and verdict files of the held-out tests
below are archived in [acceptance/archive](acceptance/archive/): one folder per test
branch, named as in the table (for example `acceptance/archive/acc113r/species/`),
and `MANIFEST.tsv` maps every file to its branch and commit.

`ctest` covers the rank-sum DP against exhaustive enumeration (small k and n),
end-to-end tag recovery from synthetic spectra, flanking-mass placement,
extension, gap ordering with a negative control, per-row mass closure,
repeat and thread-count determinism (every output, mzML and mzPeak input), the
sequence filter, that `-gap_penalty` never removes a tag at the E-value cutoff
(uncapped), and
the digest, label and mass-gap reports (`digest_test` against prose-auto
0.1.3's functions on synthetic tables, `digest_cli_test` end to end).

### Held-out acceptance of the 1.12 options

Each item below was preregistered and run on held-out public data
([acceptance/archive/acceptance/1.12](acceptance/archive/acceptance/1.12/)), scored against Sage 0.14.7 truths at 1% FDR (for
#4, the pool's peptide labels). #2, #4 and #9 were scored once. #6 was scored
twice: once on item06-H1-r2 (INCONCLUSIVE, PXD001473 without truth), then, by
a user decision recorded before the run, once on the unused high-resolution
reserve sets item06-H2/H2r (FAIL). No configuration was tuned on held-out
data.

| Item | Verdict | What it means |
|---|---|---|
| #4 tags on unidentified spectra (default tagger) | **PASS** | On 9 ProteomeTools synthetic-peptide pools, spectra the database search does not identify still get a correct rank-1 tag 27.0 points above decoy chance (95% CI 23.7-30.7; margin 5 points; tag length 5: 23.7). That tags carry the *precision* measured on identified spectra over to unidentified ones is **not** shown (precision at E <= 0.01: 0.28 unidentified, 0.55 identified), and `-diversity` showed no benefit on chimeras |
| #9 `-pick_profile auto` | **FAIL** | Ion trap (PXD009049): two charge-3 cells fail non-inferiority, 4+ underpowered, fewer tagged spectra at tag length 4 and 5. Orbitrap (PXD016519, PXD018024; no Astral or TOF run): all 9 cells +10.5 to +32.0 points, but 567 fewer tagged spectra on PXD016519 at tag length 3. Default stays `legacy`. Removed in 1.14 (with `-pick_unknown_type`); `auto` is read as `legacy` (see Performance) |
| #6 `-unknown_charge infer` | **INCONCLUSIVE** (item06-H1-r2), then **FAIL** (item06-H2/H2r, high resolution) | Charge-call accuracy 0.751 (H1-r2, descriptive) and 0.745 (H2/H2r) against a 0.90 target; on the high-resolution sets, gains on 3+ and losses on 2+ (on ion trap in H1-r2, losses at every charge). Default stays `assume2` |
| #14 `-check_header_charge` (1.13, `acceptance/1.13`) | **PASS** (item14r, revised rule); first rule **INCONCLUSIVE** (item14-hdrcharge: two Astral runs without enough truth) | First rule: On the three Q Exactive runs `warn` flags 0.31% of right header charges, and on a copy with every fifth charge changed it finds 28% of the wrong ones at precision 0.95. Overriding real header charges breaks more than it fixes: -2.2 per 1000 identified spectra, lower bound -2.9 (criterion -1.0). Q Exactive only: on Astral (PXD070049) all 9 flags as given and all 8 on the perturbed copy were false (false alarm 0.026), with no changed header found. That rule (range evidence, `override`) was replaced. The revised rule (MS1 isotope spacing, charge-aware pairs, `both`) passed its held-out test (item14r, five new runs, `warn`): it finds 26.9% of the wrong headers at precision 0.679 (95% lower bound 0.647) and flags 0.35% of the right ones (doc/HEADER-CHARGE-CHECK.md). Experimental |
| 1.13 `-species_call explain` (`acc113r/species`) | **FAIL** | On 62 public runs (PREREG-species-explain.md) against the `decoy` call: 0.50 false genus calls per run (95% interval 0.29-0.73; 31 calls) against 5.98 (371 calls), so the primary endpoint passes (upper bound <= 0.75); the guard fails, recovery of the truth genera 38/105 against 77/105 (Sus or Bos 3/68 against 41/68). The mode selects the sample organism among the 50 indexed genera (42 of 49 runs) and does not report a second organism or contaminant; for organisms outside the index the closest indexed genus is called in 6 of 13 runs (assigned post hoc, not a test result), in the others another genus or none. Removed in 1.14 (with `-species_reagents`); `explain` is read as `none` (doc/SPECIES-DETECTOR.md) |
| #17 `-search_shifts` (1.13, `acceptance/1.13`, `acc113r/shifts`) | **FAIL** (item17), **FAIL** (item17r, second test on four new runs) | Closed search against the same search plus the option, Comet 2026.03.0 and Sage 0.14.7, 1% FDR, shuffled entrapment. Second test: more PSMs on 4 of 4 runs (Comet +7.7 to +36.8%, Sage +6.5 to +25.2%), but Comet's entrapment FDP rises on the TMT run PXD037999 (0.88% -> 1.28%, limit +0.30 points; Sage passes), and the option recovers only 5 of 32 (Comet) and 3 of 11 (Sage) admissible peaks of an MSFragger open search. Part of the gain is the isotope error setting (base 0, option 0..1 on three runs); the gain over a base with the same setting was not measured. The option does not replace an open search. Removed in 1.14 |
| 1.13 `-search_engine msfragger` (#18, `acceptance/1.13`, `acc113r/msfragger`; second test `post1131/msfragger-heldout2`) | **FAIL** (first test); **PASS** (second test, with the shortlist recipe); **FAIL** (third test, same recipe, secondary arm) | 7 runs from 7 PRIDE projects (PREREG-msfragger.md, scored once on 2026-11-10; FASTag 1.12.2 at 9365ff1): MSFragger 4.4.1 on the exported shortlist FASTA and `fragger.params` against MSFragger's closed-search defaults on the full human proteome, 1% FDR on the hyperscore. C1 PASS: MSFragger ran on the unedited export in 7 of 7 runs. C2 FAIL: the shortlist search kept 48.6 to 73.2% of the spectra the full search identified (median 61.3%, pooled 60.9%; criterion at least 80% in every run, reached in none). G1 PASS: 2.03 to 3.91 times as fast (median 3.38). G2 FAIL: entrapment FDP 1.27% pooled (limit 1.5%), but 2.09% in one run (limit 2.0%). Most of the loss came from the exported parameters, not from the shortlist: the exported parameters on the full proteome kept 46 to 82%, the shortlist alone 81 to 95%. Since this test the export writes MSFragger's own `isotope_error 0/1/2/3` unless `-search_isotope_errors` is given: on the two development runs the kept share rose from 47.5 to 72.2% (PXD003531) and from 47.3 to 56.3% (PXD014764) at unchanged speed, entrapment FDP under 1%. After 1.13.1 the export also writes MSFragger's 2 missed cleavages, 20 ppm precursor window and variable protein N-terminal acetylation; on nine development runs (the two above and the seven of this test, now spent) the kept share is 0.678 to 0.915 with them (mean 0.831), and 0.888 or more in every run (mean 0.935) with `-shortlist_gapped -recon_min_length 6 -shortlist_max_evalue 10 -recon_missed_cleavages 2` added, entrapment FDP at most 1.43% per run. Second held-out test (10 runs from 10 new PRIDE projects, PREREG-msfragger2.md on `post1131/msfragger-heldout2`, scored once on 2026-11-11; criteria of the first test), export defaults with that recipe, unedited: **PASS**. MSFragger ran in 10 of 10 runs; in the 9 evaluable runs the kept share is 83.3 to 97.6% (median 93.4%), the search 1.64 to 4.72 times as fast (median 2.05), entrapment FDP 1.07% pooled and at most 1.88% per run (limit 2.0%; one more entrapment hit in that run would exceed it). One run had 10 identifications in the full search and is not evaluable. The test covers the recipe and the export defaults together; with the default shortlist (informational) the kept share is 52.6 to 94.6%, below 80% in 5 of 9 runs, so the recipe is needed; since then it is the default under `-search_engine msfragger` with the tryptic shortlist (each value unless given). Third held-out test (8 runs from 8 new PRIDE projects, PREREG-exactonly.md on `acc114/exactonly`, scored once on 2026-11-13; FASTag 1.13.4, 12 threads; same criteria), this default as the secondary arm: **FAIL**. Kept share 0.530 to 0.972 (median 0.937), below 0.80 in PXD003252 (0.530); 2.12 to 3.21 times as fast (median 2.57); entrapment FDP 1.02% pooled, but 2.12% in PXD045654 (17 entrapment hits among 1,603 PSMs; limit 2.0%). The default stays, but it is not validated: it passed one held-out test and failed the next. Experimental (doc/SHORTLIST.md) |
| 1.13.3 `-shortlist_exact_only` (`acc114/exactonly`) | **FAIL** | Primary arm of the third MSFragger test above: the msfragger default with gapped placement off. Kept share 0.503 to 0.963 (median 0.916), below 0.80 in PXD003252 (0.503) and PXD014823 (0.732); 2.17 to 3.47 times as fast (median 3.06); entrapment FDP 1.04% pooled, at most 1.13% per run. Removed in 1.14 |
| 1.15 candidate: `calibrate_mass 2` in the MSFragger export (`acc115/msfcalib`) | **FAIL** (one criterion: P3) | 10 runs, 9 evaluable, against the 1.14.0 export (`calibrate_mass 0`). Only P3 failed: the calibrated shortlist search was not faster than the full search in 2 of 9 runs (speed-up 0.947 and 0.974; median 1.108), because calibration about doubles MSFragger's time on the shortlist. The kept share was higher in 9 of 9 runs (median +0.025, lowest 0.919); entrapment FDP 1.10% pooled, at most 1.28%. The export keeps `calibrate_mass 0` |
| #2 `-complement_rule both` | **INCONCLUSIVE** | By rule 5: the truth of one Astral run (PXD074582) has 0 PSMs at 1% FDR. On the other runs endpoints (i)-(iii) fail descriptively. Default stays `same_charge` |
| 1.13 `-complement_tolerance_unit auto` | **FAIL** (first estimator); second test, revised estimator: **INCONCLUSIVE**; third test: **PASS** (validated) | First test: on the #2 design (`acceptance/1.13`, PREREG-compltol.md; 11 runs): ion trap at 0.5 Da +2.1 to +5.1 points rank-1 correct in every powered 2+/3+ cell, pooled L3 gain +3.05 points (ii PASS), timsTOF 4+ and time (ratio 1.027) PASS; but three Astral cells fail non-inferiority (L5 2+ -0.50 points; two 4+ cells by their bound). Measured with the first estimator (c5f96b5), whose window varied with the cell; the second test used the current cell-independent median/MAD estimator with `-complement_tolerance` as its lower bound. Second test (`acc113r/compltol`, PREREG-compltol-heldout2.md; 8 new runs: Astral 2, ion trap 3, Q Exactive 3): no criterion failed. Non-inferiority: 44 of 54 cells pass, 0 fail, 10 are uninformative (all ion trap; four of them 3+ cells, which block a PASS). Ion-trap gain at L3 +1.07 points rank-1 correct (95% interval 0.87-1.27; PASS); timsTOF not tested; run time ratio 1.010 (PASS). On all five high-resolution files the window in force was 0.02 Da, so `auto` equals the default there. Limits: one Astral project, three ion-trap files, all at 0.5 Da. Third test (`acc114/compltol3`, PREREG-compltol-heldout3.md; FASTag 1.13.4; 7 new runs: ion trap 3, older Orbitrap 1, timsTOF 3): **PASS**. Non-inferiority: 50 of 54 cells pass, 0 fail, 4 uninformative (all ion trap 4+; every 2+ and 3+ cell passes). Ion-trap gain at L3 +3.31 points rank-1 correct (95% interval 2.98-3.65); timsTOF 18 of 18 cells pass; run time ratio 1.028 (limit 1.03); one window per file, never below 0.02 Da; the one high-resolution file whose window widened (timsTOF, 0.0563 Da) passes 18 of 18 cells. The ion-trap gain comes from two files (doc/COMPLEMENT-TOLERANCE.md). Validated; the default stays `Da` |
| #7 raw-DIA check (`-acquisition_check`), release test E7-03 (`acceptance/1.13`) | **FAIL** | 8 of 202 files that had to pass were refused (upper 95% bound 7.0%), all from Astral projects labelled DDA. Raw diaPASEF and Astral DIA were refused 12/12 each, Orbitrap DIA 7/12 and SWATH 10/12 (criterion >= 90%); pseudo-DDA passed 37/37. Default stays `refuse`; override a wrong refusal with `warn` or `off` (see Raw DIA input is refused) |
| #7 raw-DIA check, revised rule (closed window set, default charge), held-out test acqcheck2 (`acc113r/acqcheck`) | **PASS** | 98 fresh public Thermo files, truth per file from scan filters and isolation windows. Refused: 0 of 58 non-DIA files (criterion 0), 35 of 37 DIA files (criterion >= 90%; the 1.12 rule 19 of 37). Misses: one DIA run with mixed charges (warned) and one non-dependent run with 5384 windows of 2 Th. No Astral, timsTOF or SCIEX file in the sample |
| #7 raw-DIA check, third held-out test acqcheck3 (`acc114/acqcheck3`) | **INCONCLUSIVE** (no criterion failed) | FASTag 1.13.4 at its defaults on 135 public files (Thermo Astral and Orbitrap, Bruker timsTOF, SCIEX), truth audited per file. Refused: 0 of 75 non-DIA files (upper 95% bound 3.9%; timsTOF 0/19, SCIEX 0/21, recurring-window or targeted 0/57) and 60 of 60 DIA files (Astral 21/21, diaPASEF 14/14, SWATH 11/11, Orbitrap window schemes 14/14), 7 of them Astral DIA runs listed as DDA. Inconclusive: Astral non-DIA has 3 files (minimum 8; 0 refused) and no closed-window DIA file was drawn (doc/ACQUISITION-RELEASE-TEST.md) |
| #7 raw-DIA check, fourth held-out test acqcheck4 (`acc115/acqcheck4`) | **INCONCLUSIVE** (no criterion failed) | FASTag 1.14.0 at its defaults on 157 public Thermo files, truth audited per file. K1: 0 of 86 non-DIA files refused (upper 95% bound 3.4%). K2: 70 of 71 DIA files refused (Astral 28/28); the miss, an Orbitrap Eclipse run with mixed precursor charges, was warned and tagged. K3: 0 of 12 Astral DDA files (5 projects) refused, which closes the Astral DDA gap of acqcheck3. K4: only 1 closed-window DIA file (an MSX run, refused; minimum 5) |
| 1.13 `-label_call_min_tags 0` | **FAIL** | 149/172 runs right (0.866) against the threshold 0.922; always label-free gives 0.872 and the 1.12 rule 83/172. Removed in 1.14; the minimum stays 175 |
| 1.13 `-label_discovery_out` | **FAIL** | `acceptance/1.13`, PREREG-labeldisc.md; 190 runs, scored once on 2026-11-10. P1 FAIL: 6 of 150 label-free runs got a label call (4.0 %; criterion 0). P2 FAIL: 96/190 runs right against 150/190 for "always label-free" (65 label-free runs got no call). P3 PASS: 96 against 91 for `label_call` (sign test p = 0.33). Removed in 1.14 |
| 1.13 `-label_discovery_out`, report formats 2 to 4, third held-out test (`acc113r/labeldisc3`) | **FAIL** | PREREG-labeldisc3.md; 163 runs from 163 new PRIDE projects (Thermo Orbitrap-family instruments only), scored once on 2026-11-10 against the stated label, with Param-Medic 0.2 as comparison. Three of nine criteria fail. PASS: no label call on 64 label-free runs; recall TMT 18/18, iTRAQ 19/19, SILAC 18/22, dimethyl 13/22; 1 of 99 labelled runs called label-free. FAIL: weighted accuracy 0.572 (criterion above 0.80); 119 runs right by label family against 149 for Param-Medic; TMTpro recall 11/18 (criterion 0.8). Both causes are ion-trap MS2: the rule makes no call there (all 31 label-free ion-trap runs, 8 dimethyl, 4 SILAC), and the 7 TMTpro runs acquired as SPS-MS3 are called TMT, because the call does not use the TMTpro-only reporter ions. With Orbitrap MS2, 95 of 96 runs are right. Removed in 1.14 |
| 1.13 `-ion_series ax` | **FAIL** | On the UVPD spectra of PXD018176 replicate 2, rank-1 tags are correct for 0.04% under `ax` against 30.87% under `by`: -30.83 points (95% interval -31.63 to -30.02; criterion +5). Tested as an a/x-only reading with even-electron flanks; an a+1/x+1 reading and a mixed b/y + a/x reading are untested. Removed in 1.14 (with `-ion_series_photo`); `ax` is read as `by` |
| 1.13 census triage (`-census_ids`) | **PASS** (second test); first test **FAIL** | Second test, 8 runs, 7 evaluable: the triage candidates are identified by a semi-enzymatic second search 5.32 times as often as the other unidentified spectra (95% CI 2.59-8.25), 0.023 above a peak-count baseline. Against an open search they are enriched but not better than that baseline (doc/CENSUS-TRIAGE-EVAL.md) |
| 1.13 `-alkylation_tags_out` | **PASS**, at the margin | 57 runs from 57 PRIDE projects: 40 called, 37 right (0.925, Wilson 95% interval 0.801-0.974; criterion: at least 30 calls and a lower end of at least 0.80). It abstains on samples that are not alkylated (2 of 12 called; doc/ALKYLATION-REPORT.md). Experimental |
| 1.13 `-ion_series_hybrid both` | **PASS** | 9 EThcD/ETciD runs from 5 PRIDE projects (Sage 0.14.7 truth with b, y, c and z ions at 1% FDR; 29,031 truth spectra): truth spectra with at least one correct tag rise by 43.2 points over `-ion_series auto` alone (macro mean over projects, 95% interval 41.3-45.1; per project +28.2 to +56.4), the precision of the reported tags rises by 14.3 points, CPU time is 1.60 times as high. 294 spectra (1.0%) lose their only correct tag, 11,895 gain one. Three of the five projects are ADP-ribosylation samples from one laboratory (the two others: +38.0 and +28.2 points); the truth search favours spectra with c/z ions (doc/HYBRID-IONS.md). Experimental, default stays `by` |
| 1.13 `-shortlist_protease auto` | **PASS** | 9 runs from 6 PRIDE projects, 5 proteases (Arg-C 1, Asp-N 1, Glu-C 3, Lys-C 3, chymotrypsin 1; `acc113r/nontryptic`, PREREG-nontryptic.md, scored once). Share of the proteins a Sage search of the full proteome with the true protease identifies that the shortlist keeps: median 0.25 (criterion 0.20); +0.116 over the trypsin shortlist (95% CI +0.035 to +0.190); protease called right in 7 of 9 runs; no aborts. The gain comes from Asp-N, Glu-C and chymotrypsin, where the trypsin shortlist keeps almost nothing; on Arg-C and Lys-C the two shortlists are about equal. Recall is 0.06-0.10 on three runs. One Asp-N run was called `unspecific`; there the export makes Sage four times slower than the full search. Tested with Sage at `-shortlist_specificity full` (doc/SHORTLIST.md). Experimental |
| Asp-N call of `-shortlist_protease auto` and its semi-specific export (after 1.13.1; `acc114/aspn`) | **FAIL** (one criterion: G1) | PREREG-aspn.md; FASTag 1.13.4, Sage; 12 Asp-N runs from 4 PRIDE projects and 9 control runs from 8. The only failure: in one run (PXD050612) the trypsin comparison arm (`-shortlist_force`) kept 0 proteins and wrote an empty reduced FASTA with exit code 0, which the frozen scorer counts as an abort (1.14 no longer writes an empty FASTA; it exits with code 13). Every other criterion passed: Asp-N called in 11 of 12 Asp-N runs and 0 of 9 controls; shortlist recall +0.369 over the trypsin shortlist (95% CI +0.318 to +0.445) and +0.047 over the full-specificity Asp-N export (+0.023 to +0.083); median Sage time 0.98 of the full search (limit 1.25); every Asp-N call exported semi-specific. Not validated; the behaviour is kept (doc/SHORTLIST.md). No retest: PRIDE had no unused eligible Asp-N project (2026-11-15); a 1.14.0 rerun of the spent set ends the empty trypsin comparison with exit 13 |
| #15 `-ion_series auto` | **INCONCLUSIVE** | On the ETD spectra of 6 Orbitrap runs (PXD024621, PXD009208; MSFragger 4.4.1 c/z• truth at 1% FDR) correct rank-1 tags rise from 0.9% under `by` to 82.2% (+81.4 points, 95% interval 79.5-83.2; 5,313 peptide clusters): the electron endpoint passes. Collisional spectra are byte-identical, but the non-inferiority cells for 3+ and 4+ collisional spectra are empty (every HCD spectrum of PXD024621 is 2+), so the verdict is inconclusive. Default stays `by`; use `auto` (or `cz`) on ETD/ECD data |

Every other 1.12 option (#1/#10 species call, #3 chemistry v2 and
alkylation, #5 shortlist and search hand-off, #7 raw-DIA check, whose
release test E7-03 failed (see Raw DIA input is refused), #11 census, except the triage candidates of `-census_ids` in the table) is experimental and not
validated on held-out data. No 1.12 option is validated on low-resolution
(ion-trap) MS2: the only ion-trap held-out results (#9 PXD009049; the
ion_trap set of #6 item06-H1-r2) are a failure and a descriptive result.
Of the 1.13 options, `-shortlist_protease` with a named rule or
`unspecific` and `-shortlist_specificity semi` and `none` (checked on
development runs only) are experimental and have no held-out test. The Asp-N
call of `auto` from 21 % D and its semi-specific export, both added after
1.13.1, failed their held-out test on one criterion (see the table) and are
not validated (no retest: no unused Asp-N project in PRIDE); the PASS of `auto` describes the 1.13.1 rule at `full`.

### Ranking, and the synthetic benchmark

Whether a correct tag exists is not the same question as whether it ranks
first, and PSM ground truth only answers the first one. `bench/benchmark.cpp`
generates synthetic spectra with exact per-tag truth, fitted to three real
acquisitions' peak count and ladder edge density (see
[doc/TEST-DATA.md](doc/TEST-DATA.md)), to answer the second.

It shows that gapped tags take **95% of rank-1 slots while being 3.6x less
likely to be correct** — enabling gaps makes the single best tag worse even as
it doubles total recall. `-gap_penalty` (default 100) fixes the ordering; it
filters nothing at the E-value cutoff, and under `-max_tags` it changes which
tags fill the slots (hence the small change in total recall):

| astral profile, TL=4 | rank-1 | top-5 | total recall |
|---|---|---|---|
| `-gaps 1 -gap_penalty 1` | 17.7% | 47.7% | 71.3% |
| `-gaps 1` (default 100) | **28.6%** | **52.2%** | 71.5% |

## Known limitations

- **I and L are not distinguished.** They are isobaric; FASTag folds I onto L
  and reports L throughout, including in `-fasta` matches and assembly exports.
- **Terminal modifications are not annotated.** A modification at either
  terminus shifts the whole precursor and is absorbed into the reported flanking
  masses; only residue-specific modifications appear in the tag.
- **MGF limits.** Compressed MGF is refused. No ion mobility, instrument,
  scan-window or activation metadata is read, because MGF has none (or no
  common key for it); `-digest_out` withholds its call on ion-count
  intensities instead (`ion_counts`). Every run starts with one read of the whole file to find
  the blocks (an MGF has no index), and tagging starts when it ends. From RAM
  it reads about 3 GB/s per thread, up to 16 threads (27 GB: 8.6 s at 1 thread,
  0.64 s at 16, on tmpfs); on a cold, network or ZFS file system it is bound by
  the file system's read bandwidth (27 GB on ZFS: 82 s at 1 thread, 5.4 s at
  16; shared node, indicative figures). `-subsample_*` draws over blocks, so it
  picks different spectra than the mzML the MGF came from. A malformed block
  that `-subsample_*` skips goes unnoticed.
- **b/y ions by default.** Under the default `-ion_series by`, tags and flanks
  are read as b/y ions, and ETD/ECD spectra (c/z ions) and hybrid EThcD/ETciD
  spectra are tagged the same way, so their tags are unreliable. FASTag reads
  each MS2 spectrum's activation from the mzML `<activation>` terms, or from
  the Thermo filter string when there are none. When more than 1% of the MS2
  spectra are electron or hybrid activated, it writes one `Electron
  activation:` warning to stderr with the count per class (collisional,
  electron, hybrid, unknown). MGF and mzPeak input carry no activation, so
  their spectra count as unknown, and `-ion_series auto` reads them as b/y.
  `-ion_series cz` or `auto` (1.12, opt-in; on held-out Orbitrap ETD spectra
  `auto` raised correct rank-1 tags from 0.9% to 82.2%, see Validation) reads c/z• ions (see Ion series); under them one `Ion series`
  line on stderr gives the spectra per series, `auto` warns (`Hybrid
  activation:`) when more than 1% of the spectra are hybrid and were read as
  b/y (not under `-ion_series_hybrid both`, which reads them as both series),
  and `cz` warns (`Collisional activation:`) when more than 1% are
  collisional.
- **Low-resolution (ion-trap) MS2 is not validated.** The validation numbers
  and the passing 1.12 held-out result (#4) are for high-resolution MS2. On ion-trap
  data `-pick_profile auto` failed (removed in 1.14), `-unknown_charge infer` scored worse
  (in the INCONCLUSIVE item06-H1-r2 scoring), and the other 1.12 options
  were not scored there.
- **A tag is not an identification.** No per-tag q-value or FDR is emitted, and
  a `-fasta` match, a species call, a `delta_out` bin and a glyco flag are all
  candidates to follow up, not results to report.

## Support and contributing

- **Questions and bug reports:** [GitHub issues](https://github.com/okohlbacher/FASTag/issues/new/choose).
  For a bug, give the FASTag version (`FASTag --help | grep Version`), the platform,
  the command line, the input format and the log; the issue form asks for them.
- **Security problems:** do not open a public issue; see [SECURITY.md](SECURITY.md).
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) (setup, tests, pull requests,
  the held-out-test rule for behaviour changes); building from source:
  [BUILDING.md](BUILDING.md).
- **Conduct:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1).

## Licence and provenance

MIT — see [LICENSE](LICENSE). Dependencies and licences are in [BOM.md](BOM.md).
The shipped `-digest_out` background is the residue composition of the UniProt
human reference proteome UP000005640 (CC BY 4.0); see
[data/digest/README.md](data/digest/README.md).

The species index (`tax_k7.taxdb`) is derived from the UniProt reference
proteomes in `data/taxonomy/reference-set.tsv` and the `-alkylation_proteome`
FASTA files are UniProt reference proteomes; UniProt data are licensed under
CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>; The UniProt
Consortium, *Nucleic Acids Res.* 2025, 53(D1):D609-D617). The taxonomy dumps
are cut from NCBI Taxonomy (public domain). Sources, changes and checksums:
[data/taxonomy/README.md](data/taxonomy/README.md),
[data/alkylation/README.md](data/alkylation/README.md). None of these data
files is covered by FASTag's MIT licence.

Every binary bundle carries `LICENSE` and `THIRD-PARTY-NOTICES.txt` (the
command-line program's libraries, with their licence texts); every desktop app
also carries `GUI-THIRD-PARTY-NOTICES.txt` (the Rust crates and npm packages
built into the app, its fonts, and in the AppImage the system libraries it
bundles, with links to the Ubuntu source packages of the (L)GPL ones), next to the other two in
the app's `resources/fastag/`. The example data in `examples/` (in every
bundle) are OpenMS example files, BSD-3-Clause.

The DirecTag algorithm is reimplemented from its publication. The reference
implementation (Apache-2.0) was read to resolve semantics the paper leaves
implicit; **no code was copied**.
