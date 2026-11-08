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
Performance for the bound and the options that keep per-run state). The citation — Tabb et al.,
*J. Proteome Res.* 2008, 7:3838 — is for that original DirecTag paper; FASTag
has no separate publication of its own.

What changed in each release: [CHANGELOG.md](CHANGELOG.md).

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
[latest release](https://github.com/okohlbacher/FASTag/releases/latest):

| platform | desktop app | command line |
|---|---|---|
| macOS, Apple silicon | [.dmg](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-gui-macos-arm64.dmg) | [.dmg](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-macos-arm64.dmg) |
| Windows x64 | [installer](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-gui-windows-x64-setup.exe) | [.zip](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-windows-x64.zip) |
| Linux x64 | — | [.tar.gz](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-linux-x64.tar.gz) |
| Linux arm64 | — | [.tar.gz](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-linux-arm64.tar.gz) |

Intel Macs are not built from 1.8.0 on; [1.6.1](https://github.com/okohlbacher/FASTag/releases/tag/v1.6.1) is the last release for them.
On macOS both are also on [Homebrew](https://github.com/okohlbacher/homebrew-fastag):
`brew install --cask okohlbacher/fastag/fastag` (desktop app) or
`brew install --cask okohlbacher/fastag/fastag-cli` (command line, `FASTag` on your PATH).

A disk image or archive holds a `FASTag/` folder — run `FASTag/FASTag`
(Linux/macOS) or `FASTag/FASTag.bat` (Windows); everything else inside is a
bundled dependency the wrapper needs, not something to run directly. The
Linux/macOS wrapper sets `OPENBLAS_NUM_THREADS=1` unless you set it yourself:
OpenBLAS arrives with libOpenMS and otherwise starts one spinning thread per
core at load, which FASTag never uses. The desktop app does the same for the
CLI it launches, on every platform.

**macOS 13.4 or later.** macOS ships as a disk image only, signed with a
Developer ID certificate, notarized and **stapled**, so it opens with no network
connection — a plain tarball cannot carry a notarization ticket.

**Windows builds are not yet code-signed** — the signing path is wired up but
the SignPath project is not live — so SmartScreen will warn on first run.

Building from source needs OpenMS 3.7 (develop), a C++23 compiler and CMake ≥
3.24. Releases are built against OpenMS develop at commit
[`70cebcd144`](https://github.com/OpenMS/OpenMS/commit/70cebcd14442cecd6bcd9794fb6786d3342cacc6),
compiled from source with the libraries listed in
[`.github/env/openms.yml`](.github/env/openms.yml).

## Desktop GUI

A cross-platform desktop app ([`gui/`](gui/)) wraps the CLI: pick spectra, set
parameters from a form generated out of the tool's own `-write_ini`, watch a
progress bar, and browse the tags and the ranked species report (with a
"Relative to top taxon" column showing each taxon's evidence relative to the
top hit, and an Adjusted column after `-species_deconvolve`). The **Database
hit** filter on `fasta_hit` offers All, In database (`fwd`/`rev`), Entrapment
(`efwd`/`erev`) or Not in database; **Export shown rows…** writes the filtered rows, in
the shown columns, to a new TSV. A failed run quotes FASTag's reason and offers
its command line to copy. A **Digest** tab
shows the `-digest_out`, `-label_out` and `-massgap_out` reports: the protease
call or no-call with its reason, sequence logos P4..P1 | P1'..P4' of the
observed tag ends and of the called and runner-up models (in bits against the
background in use), the label counts, a histogram of the mass gaps and the mass-gap peaks. A
built-in **Help** (F1, or the Help button) covers every tab, setting and error
message. It is built with
[Tauri 2](https://tauri.app) — a Rust backend and the OS's native webview, not a
bundled browser. The CLI remains the source of truth; the GUI shells out to it.

```bash
cd gui && npm install && npm run tauri dev     # or: npm run tauri build
```

Installable bundles ship with every release: signed, notarized and stapled disk
images for macOS (also on Homebrew, above) and an installer for Windows, which
is not yet code-signed (see above) — see the install table at the top. Details
in [gui/README.md](gui/README.md).

## Usage

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

`-in` accepts mzML, [mzPeak](https://github.com/OpenMS/mzpeak) or MGF;
`-out` is TSV; `-out_spectra` writes mzML or mzPeak, chosen by extension. All
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
median; an uncharged PRM or inclusion list of arbitrary targets is not one). A periodic, tiling but mostly charged run
is tagged with a warning; a periodic scheme whose windows do not tile a range
is PRM or an inclusion list and passes; so do DDA with wide windows and
pseudo-DDA spectra, which DIAspeXtract (its software entry and `spx_*`
userParams) and diaTracer (its software entry) mark in the mzML. The
thresholds were frozen after a development sweep over 183 public data sets; a
release test on a fresh PRIDE sample is pending. A mixed file
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
Picking runs in the tagging threads, so it parallelises. `-pick_profile auto`
does the same for profile MS2 in mzML (see Performance); `-pick_profile off`
switches it off for mzPeak too.

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
mzML reader reads: the selected ion m/z, else the isolation window target m/z
when it is above 0, which is all diaTracer writes. An MS2 without peaks
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

## Command-line reference

| Option | Default | Meaning |
|---|---|---|
| `-in <file>` | — | Input spectra: mzML, mzpeak or MGF (uncompressed) |
| `-out <file>` | — | Tag list, tab-separated |
| `-fasta <file>` | none | Report only tags occurring in these sequences |
| `-out_spectra <file>` | none | Write spectra carrying a reported tag here, as mzML or mzpeak (by extension). Needs memory proportional to the *file*, not the thread count, unlike every other path |
| `-tag_length <n>` | 3 | Seed tag length in residues |
| `-tag_lengths <n> ...` | none | Several seed lengths in one pass over the input, replacing `-tag_length`, e.g. `-tag_lengths 3 4 5`. Each length is tagged, scored and capped by `-max_tags` exactly as on its own, and a spectrum's rows are those runs' rows in ascending length. A tag several lengths report (same tag, charge, flanking masses and gapped flag, typically after extension) is kept only from the length that scores it best (lowest E-value; ties go to the shorter length), in every output. Masses are compared at full precision, so two different readings that merely print alike are both kept. The caps apply per length before this, so a spectrum can end up with fewer rows than they allow. `-delta_out` samples the lowest-E-value placed tag across lengths, and `-species` pools a spectrum's tags across lengths. Not combined with `-entrapment_fasta` |
| `-extension <n>` | 0 | Max residues appended per terminus; 0 disables extension (max 12) |
| `-gaps <n>` | 1 | Allow a tag to cross one missing peak (0 or 1) |
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
| `-recon_missed_cleavages <n>` | 1 | Missed tryptic cleavages in reconciliation windows |
| `-recon_min_length <n>` | 0 | Shortest tag worth reconciling; 0 derives the chance-match floor from database size |
| `-recon_localize` | off | Localize each reconciliation's mass gap to one residue of its region by the b/y fragments it shifts; appends `loc_site` (residue + 1-based protein position, the first on a tie), `loc_score` (b/y ion/charge matches) and `loc_ties` (sites sharing that score; 1 = unique) to `-recon_out`. Requires `-recon_out` |
| `-recon_id_out <file>` | none | The `-recon_out` placements as identifications: idXML, mzid or mzTab by extension (see Reconciliation). NOT FDR-controlled. Requires `-recon_out` |
| `-delta_out <file>` | none | Aggregated mass-shift histogram over reconciliations (one best placement per spectrum). Region-level candidates, NOT localized identifications, NOT FDR-controlled. Requires `-recon_out` |
| `-digest_out <file>` | none | Terminal residues of the tags (ungapped, E-value ≤ 1) at P4..P1 and P1'..P4', and the protease call they support with its margin, or `no_call` with the reason (see Digest, label and mass-gap reports) |
| `-label_out <file>` | none | TMT, TMTpro and iTRAQ4 gaps at either tag end (N- and C-terminal counts pooled, each given in the description) and the heavy Lys8/Arg10 shares |
| `-massgap_out <file>` | none | The `-delta_out` gap distribution with Cys alkylation counts, gap peaks explained as combinations of up to 3 Unimod modifications, and SILAC labels among them. Requires `-recon_out` |
| `-digest_models <file>` | shipped | Protease model table for `-digest_out` (columns `model`, `class`, `end`, `residue`, `freq`); its `background` rows win over a FASTA |
| `-digest_tag_min <n>` | 100 | Advanced: tag ends a call needs; the N-terminal ends count from as many |
| `-digest_window <Da>` | 0.008 | Advanced: window around a residue or label mass at the tag ends |
| `-digest_background_share <f>` | 0.05 | Advanced: share of the background mixed into every model |
| `-digest_silac_min <n>` | 50 | Advanced: K- and R-terminal tag ends each for `-label_out`'s heavy-share gate |
| `-massgap_window <Da>` / `-massgap_window_da <Da>` | 0.02 / 0.5 | Advanced: gap window on ppm runs / on Da runs |
| `-massgap_min_spectra <n>` / `-massgap_min_share <f>` / `-massgap_min_bin <n>` | 20 / 0.005 / 2 | Advanced: spectra and share a gap peak needs; spectra a histogram row needs to take part |
| `-massgap_max_mods <n>` / `-massgap_top <n>` | 3 / 5 | Advanced: modifications per explanation; modifications listed by share |
| `-massgap_silac_share <f>` / `-massgap_silac_min <n>` | 0.08 / 500 | Advanced: share a SILAC label needs; shifted spectra a SILAC call needs |
| `-digest_models_version <shipped\|v2>` | shipped | Experimental (1.12), not validated on held-out data: `v2` reads `digest_models_v2.tsv` (rule-only LysargiNase and Asp-N_ambic rows, detection weights per instrument class, pooled specificity); the shipped v2 values are unfitted priors |
| `-digest_detection <none\|shipped>` | none | Experimental: score the tag ends with the table's detection weights of the run's instrument class (orbitrap_hcd, timstof, other) and call timsTOF runs instead of withholding them; needs a v2 table |
| `-digest_flank2 <off\|auto>` | off | Experimental: where y1 is cut off or the P1 counts are too few, score the two-residue flank sums m(P2) + m(P1) instead |
| `-digest_min_confidence <f>` / `-digest_calibration <file>` | 0 / shipped | Experimental: write the calibrated `p_correct` of a call and withhold one below the threshold (`low_confidence`); the shipped calibration is unfitted (p_correct 0.5) |
| `-alkylation_out <file>` | none | Experimental (1.12), not validated on held-out data: which reagent alkylated the cysteines, or none, from the placements of single-Cys peptides (see Digest, label and mass-gap reports; format in doc/ALKYLATION-REPORT.md) |
| `-alkylation_proteome <name\|file>` | auto | Database of `-alkylation_out` when nothing else places: a FASTA (`.gz` allowed); ignored with `-recon_fasta`. **In 1.12.0 `-alkylation_out` needs `-recon_fasta` or a FASTA path here:** the named proteomes `auto` (= human), `human`, `mouse`, `yeast`, `ecoli` (`share/FASTag/alkylation/<name>.fasta.gz`) are not shipped yet, and naming one (or leaving the default `auto`) stops with exit code 6 |
| `-alkylation_min_spectra <n>` / `-alkylation_min_share <f>` / `-alkylation_window <Da>` | 10 / 0.6 / 0 | Advanced: spectra and share the call needs; bin window (0 = 0.02 Da on ppm runs, 0.5 Da on Da runs) |
| `-shortlist_out <file>` | none | Experimental (1.12): ranked protein shortlist from the tag placements on `-recon_fasta` (or `-fasta`), one row per protein with evidence (see Protein shortlist and search hand-off). A search-space reduction, NOT FDR-controlled |
| `-fasta_out <file>` | none | Experimental: reduced FASTA of the kept proteins (never decoys), then `-shortlist_background` |
| `-shortlist_background <file>` | none | Proteins always written to `-fasta_out` (host proteome, contaminants), decoys left out; an entry identical to a database entry is written once, as that entry (kept even below the shortlist cut, reason `background`) |
| `-shortlist_max_evalue <f>` / `-shortlist_min_spectra <n>` | 0.1 / 2 | Advanced, provisional: E-value a tag needs for its placements to count; spectra a protein needs to be kept |
| `-shortlist_gapped` | off | Let placements with a mass gap count (a gap equal to a fixed terminal label always counts as exact) |
| `-shortlist_parsimony <none\|subset\|greedy>` | none | Drop proteins whose spectra a higher-ranked kept one has (`subset`), or keep a greedy set cover (`greedy`) |
| `-shortlist_top <n>` | 0 | Advanced: keep at most this many proteins, ties at the cut kept; 0 = no cap |
| `-shortlist_decoy_affix <list>` | `DECOY_ decoy_ rev_ REV_ reverse_ XXX_ shuffled_ random_ _DECOY _rev` | Advanced: accession prefixes and suffixes that mark a decoy entry |
| `-shortlist_force` | off | Advanced: write `-fasta_out` and `-search_config_out` although the tag ends call a non-tryptic protease |
| `-search_config_out <file>` | none | Experimental: a Sage configuration (JSON) or Comet parameters for `-fasta_out`, or for the input database without it |
| `-search_engine <sage\|comet>` | sage | Engine of `-search_config_out`; `comet` is unverified against the Comet binary (see doc/SHORTLIST.md) |
| `-search_config_template <file>` | none | Comet only: a `comet -p` file the managed keys are merged into; without it a fragment is written |
| `-search_precursor_tolerance <f>` / `-search_precursor_unit <ppm\|Da>` | 10 / ppm | Precursor tolerance written to the configuration |
| `-search_isotope_errors <n>` | 0 | Precursor isotope errors 0..n (at most 3) |
| `-search_decoy_prefix <s>` | `rev_` (Sage) / `DECOY_` (Comet) | Prefix of the decoys the engine generates |
| `-search_shifts <none\|variable\|offsets\|both>` | none | Experimental (1.12): add the run's mass-gap peaks (the `-massgap_out` peaks, computed without writing it) to `-search_config_out` as variable modifications or Comet mass offsets (see Mass shifts as search configuration). Candidates for an FDR-controlling engine, NOT identifications. Needs `-search_config_out` and a database; `offsets` needs `-search_engine comet` |
| `-search_shifts_out <file>` | none | With `-search_shifts`: one row per mass-gap peak with its explanation and the action taken (`variable`, `offset`, `fixed`, `skipped_isotope`, `expected_label`, `label_incomplete`, `fixed_mod_questionable`, `skipped_silac`, `deferred_alkylation_call`, `already_searched`, `dropped_cap`, `dropped_engine`, `dropped_mode`) |
| `-shift_max_variable <n>` / `-shift_max_offsets <n>` | 3 / 10 | Advanced: gap peaks exported as variable modifications / as offsets besides 0, most spectra first |
| `-shift_expand_sites` | off | Advanced, unvalidated: add the residues `-recon_localize` places a variable shift on to that modification (needs `-recon_localize`) |
| `-shift_site_min_share <f>` / `-shift_site_min_count <n>` / `-shift_site_min_ions <n>` | 0.2 / 10 / 2 | Advanced: share and count of a peak's localized samples a residue needs for `-shift_expand_sites`; b/y ions a sample needs to count |
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
| `-species_call <mode>` | none | `decoy`: call each reported taxon present, no_call or not_detected against a decoy-tag null plus homology spill; appends 7 columns (see Species detection) |
| `-species_call_params <file>` | `species_call.tsv` in the taxonomy dir | With `-species_call decoy`: the decision parameters (alpha, tau, n_min) |
| `-species_call_min_units <n>` | 200 | With `-species_call decoy`: fewer spectra with taxon evidence make the run a few_spectra no_call |
| `-species_call_decoys <n>` | 5 | With `-species_call decoy`: decoy tags per tag (1-100) |
| `-species_pi0 <f>` | 1 | With `-species_call decoy`: pi0 of the q-values; 1 = Benjamini-Hochberg, 0 = estimate (Storey) |
| `-species_orientation <mode>` | forward | `both`: also look each tag up reversed (a tag read from b ions is written reversed); one informative reading is used as it is, two are intersected, two without a common taxon skip the tag. Independent of `-orientation` (which applies to `-fasta` and `-recon_fasta`). The analytic `log_pvalue` and `qvalue` columns are NA under `both`, also with `-species_call decoy`; the calibrated value is its `decoy_qvalue` |
| `-subsample_spectra <n>` / `-subsample_fraction <f>` | 0 | Tag only a random subset (count or fraction; if both are given, the count wins); 0 = all |
| `-subsample_seed <n>` | 1 | Seed for the `-subsample_*` selection |
| `-mzpeak_read_memory <MB>` | 0 | No effect; accepted for existing command lines |
| `-acquisition_check <refuse\|warn\|off>` | refuse | Refuse raw DIA input with exit code 11, tag it anyway with a warning, or skip the check (see Raw DIA input is refused) |
| `-acquisition_probe_spectra <n>` | 4000 | MS2 spectra the acquisition check reads, metadata only, reading at most ten times as many spectra in all (advanced) |
| `-pick_profile <legacy\|auto\|off>` | legacy | Centroid profile MS2 (MS:1000128) with OpenMS `PeakPickerHiRes` before tagging: `legacy` on mzPeak input only (as 1.11), `auto` on mzML and mzPeak input (not MGF), `off` never. Centroided MS2 are never re-picked. `-out_spectra` writes the spectra as they were tagged. Not with `-stream` |
| `-pick_unknown_type` | off | With `-pick_profile auto`: also centroid MS2 that declare no spectrum type, when OpenMS's `PeakTypeEstimator` reads their data as profile (advanced) |
| `-ion_series <by\|cz\|auto>` | by | Ion series the MS2 spectra are read as: `by` (b/y ions, as 1.11), `cz` (c/z• ions of ETD/ECD, every spectrum), `auto` (c/z• for spectra whose activation is ETD or ECD, b/y for all others, hybrid EThcD/ETciD included, with a warning). Under `cz`, and under `auto` when the run has electron-activated spectra, the tag TSV gains a last `ion_series` column and the census a `best_ion_series` column (see Ion series). Not with `-stream`. Experimental: `auto` is not validated yet |
| `-unknown_charge <assume2\|enumerate\|infer>` | assume2 | How a precursor without a charge is tagged: `assume2` as 2+ (as 1.11); `enumerate` at each listed possible charge (MS:1000633, MGF `2+ and 3+`), else at every charge `-charge_min`..`-charge_max`; `infer` at the charge its complement pairs support (1+ when `-charge_min` is 1, or 1 is listed, and almost no intensity lies above the precursor; both charges of a close call, `ambiguous`; without evidence 2+, or the lowest candidate when 2 is none, `assumed`). Every charge tagged is a listed possible charge, else one of `-charge_min`..`-charge_max`. A header charge is never replaced. A spectrum tagged under H hypotheses has every E-value multiplied by H before `-max_evalue` and `-max_tags`; its rows are merged by E-value. The reports that aggregate over spectra (digest, label, massgap, delta, species, shortlist, census) read the rows of one selected hypothesis, chosen from the charge evidence, never from the E-values. Experimental, not validated; not with `-stream` |
| `-charge_min <n>` / `-charge_max <n>` | 2 / 4 | The charges `enumerate` and `infer` try (1-8); `-charge_min 1` enables infer's 1+ test |
| `-charge_infer_margin <x>` | 2 | Complement-pair excess by which an inferred charge must beat the runner-up to be tagged alone; closer, both are tagged (`ambiguous`). Any excess above 0 is a call; none is `assumed` (advanced) |
| `-isotope_error <k> ...` | 0 | Precursor isotope offsets (-1..3) to consider, for every precursor: the neutral mass is lowered by k x 1.00336 Da, and each charge is tagged at the offset its complement pairs support best. Needs a fragment tolerance below 0.05 Da (or the ppm equivalent at m/z 1000); refused otherwise (advanced) |
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
| 11 | INCOMPATIBLE_INPUT_DATA | The input is raw DIA (see Raw DIA input is refused; stderr carries a `FASTAG_REFUSED` line), or `-out_spectra` is `.mzpeak` but the MS2 spectra carry ion mobility per peak; write `.mzML` instead |
| 13 | UNEXPECTED_RESULT | See below |

The OpenMS framework returns its own codes before FASTag starts, for example 1
for an input file that does not exist. Code 13 covers two runs that fail
although files were written:

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

With a non-default `-unknown_charge` or `-isotope_error` (1.12), four columns
follow the optional ones: `prec_charge` (the precursor charge the row was
tagged at), `charge_src` (`header`, `possible`, `inferred`, `ambiguous`,
`assumed` or `enumerated`), `iso_offset` (k) and `selected` (1 when the row's
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
hydrogen-transfer forms) are dropped before tagging. `-recon_*`, `-digest_out`,
`-label_out`, `-massgap_out`, `-delta_out` and the census take the offset from
each tag; `-species` counts b/y tags only and reports how many c/z• rows it
left out. Hybrid EThcD/ETciD spectra are read as b/y under `auto` (reading
both series at once is not supported yet), and a/x ions are not read.
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
`-shortlist_out` alone withholds nothing: WARN, exit 0). Only tags at or
above the placement floor place (`-recon_min_length`, derived as 8 residues on
the human proteome), so give `-extension` (3 on the gate runs). See [doc/SHORTLIST.md](doc/SHORTLIST.md).

### Mass shifts as search configuration

Experimental in 1.12 and opt-in: `-search_shifts variable|offsets|both` adds
the run's mass-gap peaks to `-search_config_out`, closing an open-search loop
cheaply. The peaks are exactly the ones `-massgap_out` reports (same
`-massgap_*` thresholds), computed whether or not a report is written;
`-delta_out` and `-massgap_out` are byte-identical with and without it. A peak
at a precursor isotope spacing raises the engine's isotope errors instead; a
peak equal to a fixed terminal label is expected; a peak at minus a fixed
modification or label is warned about; a fixed residue modification seen
again becomes a variable modification on its other sites (overalkylation);
one modification becomes a variable modification (at most
`-shift_max_variable`); combinations, unexplained and substitution-dominated
peaks become Comet mass offsets (Sage has none; negative offsets are left
out; 0 is always first), corrected by the run's calibration bias (the
spectra-weighted median error of the single-modification peaks other than
13C isotope peaks, applied only when larger than the 0.00025 Da centroid
resolution, in the `-search_shifts_out` header; a WARN when the remaining uncertainty exceeds the
precursor tolerance). A called SILAC channel is exported as a whole (all its
labels, outside `-shift_max_variable`) or not at all, with a WARN. Without a
fixed Cys modification, a Cys alkylation on at least half the C-containing
placements is written as a fixed modification, with a WARN; with
`-alkylation_out` the run's alkylation call decides the fixed Cys modification
instead (a reagent call becomes it; `none` or `no_call` adds none). `-search_shifts_out` lists every decision. These are candidates
for an FDR-controlling engine, not identifications: whether they improve
identifications is not yet validated. Offsets need a narrow precursor
tolerance, which the configuration sets explicitly. See
[doc/SHORTLIST.md](doc/SHORTLIST.md#mass-shifts-as-engine-configuration-112-17).

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
  C-terminal K and R. Its last five rows (section `label_call`) give the label
  call prose-auto 0.1.10 makes from these counts: TMT, TMTpro, iTRAQ4, SILAC
  or label-free, or no call on a Da tolerance and below 175 C-terminal tag
  ends (doc/DESIGN-digest.md).
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

The `-digest_out` options of 1.12 (`-digest_models_version v2`,
`-digest_detection`, `-digest_flank2`, `-digest_min_confidence`) are opt-in
and not validated on held-out data; at their defaults the report is the
FASTag 1.11 one byte for byte, and with any of them on it gains `run`,
`meta instrument_class`, `count flank2_n`, `call p_correct`/`flank2_used`/
`timstof_call` and `nocall low_confidence` rows.

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
  `tolerance` and `tolerance_unit`. An unknown ID exits 6 with the ID on stderr
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
E-value threshold, not a quality call.

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

**Calibrated calls (opt-in).** `-species_call decoy` appends `call
call_reason decoy_spectra decoy_expected decoy_qvalue share lod` to every row:
`present`, `no_call` (low_resolution, few_spectra, unstable, near_neighbour) or
`not_detected` with a detection limit, never "absent". The null is decoy tags
looked up like the tags plus the spill a stronger related taxon is expected to
cause; `decoy_expected` is that null's expectation (`expected` keeps its 1.10
meaning). The shipped parameters are provisional. See
[doc/SPECIES-DETECTOR.md](doc/SPECIES-DETECTOR.md).

**Both tag orientations (opt-in).** Tags are written N->C under a y-ion
assumption, so a tag read from b ions is written reversed, and `-species`
looks up only the written reading. `-species_orientation both` looks up both
readings: one informative reading is used, two are intersected, and a tag
whose readings share no taxon is skipped (so counts can fall as well as
rise). No analytic background follows from that rule, so the analytic
`log_pvalue` and `qvalue` columns are NA under `both`, with or without
`-species_call decoy`, and a warning says so; the calibrated value is the
`decoy_qvalue` (and `call`) of `-species_call decoy`. It is
not coupled to `-orientation`, whose default (both) would otherwise change
the species report.

The longest `-tag_length` plus 2 × `-extension` must reach the index k (7).
Otherwise no tag can be long enough to look up, and FASTag refuses the run up
front rather than writing an empty report. Only tags of at least k residues
after extension are looked up (or `-species_min_len` residues, if that is
larger). Pair `-species` with `-subsample_fraction 0.1` for a fast call on a large
run.

**Get the index.** Release archives from v1.0 on carry the full k-mer index
inside (`share-FASTag-taxonomy/`), so `-species` works out of the box. For an
index-only download (older archives, source builds, upgrades), every release
also carries the platform-independent `FASTag-taxonomy-k7.tar.gz` (+`.sha256`);
extract it into the FASTag directory:

```bash
tar xzf FASTag-taxonomy-k7.tar.gz -C /path/to/FASTag/   # -> share-FASTag-taxonomy/
```

FASTag looks for the taxonomy in `FASTAG_TAXONOMY_DIR` if that is set to a
directory. Otherwise it looks beside the executable, in
`../share/FASTag/taxonomy` (an installed tree), `share-FASTag-taxonomy/` (the
release archive) or `taxonomy/`, and prefers a folder that holds the index over
one that holds only the NCBI dumps. Set `FASTAG_TAXONOMY_DIR` to use a custom or
larger reference set, or to run a binary outside its install tree; see
[data/taxonomy/README.md](data/taxonomy/README.md). `-taxdb`,
`-taxonomy_nodes` and `-taxonomy_names` override the lookup.

Index rebuilds ship as their own `taxonomy-k7-YYYYMMDD` **pre-release** — a
normal release would take GitHub's "Latest" slot and 404 every
`/releases/latest/download/` binary link above.

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

## Performance

**These figures were measured with FASTag 1.6.1** and have not been
re-measured for 1.8. The mzPeak columns used 1.6's own reader; 1.8 reads mzPeak
through OpenMS and is slower (see [mzPeak](#mzpeak)).

The table below reports wall-clock time and peak resident memory against
`-threads` for a public data set, so you can judge how a run scales on your own
machine. Every point is the faster of two runs at **default parameters**, with a
warm page cache, timed end to end including reading the input and writing the
tag file. Hardware: two AMD EPYC 9654 (192 cores / 384 hardware threads),
node-local NVMe, otherwise idle.

| data set | MS2 | mzML s / GB, 16 → 128 threads | mzPeak s / GB, 16 → 128 threads |
|---|---|---|---|
| [PXD000865](https://www.ebi.ac.uk/pride/archive/projects/PXD000865) Q Exactive TMT8 | 47,470 | 12.4 / 0.46 → 7.61 / 0.88 | 4.19 / 1.15 → 1.28 / 2.66 |

A thread ladder for the current release on larger public runs (PXD047793,
PXD054073, PXD028735, PXD076528, PXD003531), with mzML and both mzPeak layouts,
is in preparation and will replace this section.

The two containers return the same tags on centroided input. On **profile**
MS2, as in this run, they do not, and the times are not comparable either: the
mzML path tags profile samples as they are, while the archive was centroided
when written, so FASTag reads peaks and finds more tags (2,032,961 against
1,376,019). Centroid before tagging profile mzML, read the archive, or use
`-pick_profile auto` (1.12), which centroids profile mzML MS2 on read with the
same picker as the mzPeak path. Under `auto` a spectrum whose points are out
of m/z order is picked from an m/z-sorted copy (`PeakPickerHiRes` needs
sorted input): msconvert's Thermo profile mzML puts the zero-intensity point
after some peaks' last sample at a slightly lower m/z, while mzpeak-convert
stores the same non-zero points in m/z order (with zero runs shortened). With
that, the PXD000865 profile mzML under `auto` and its mzpeak-convert 0.18.0
archive give byte-identical tags (2,011,636). Its default is still `legacy`
(mzML tagged as sampled) until it is validated on held-out profile runs.

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

Against the Mascot identifications shipped with
[PXD000001](https://www.ebi.ac.uk/pride/archive/projects/PXD000001) (2,254 PSMs
at 1% FDR, LTQ Orbitrap Velos HCD, TMT6), at DirecTag's published settings
(tag length 3, 100 peaks, 50 tags, no gaps, no deisotoping), 98.62% of the
identified spectra carry a valid tag among the 50 kept, the same ceiling as
DirecTag 1.4.21142, and a valid tag ranks first on 90.91% of them (DirecTag:
88.69%). A tag is valid when its sequence occurs in the identified peptide and
one flanking mass agrees within 0.05 Da. On the same run with `-gaps 1` at tag
length 4, raising `-gap_penalty` from 1 to 100 raises rank-1 accuracy from
69.0% to 86.4%, while the share of identified spectra with any valid tag stays
at 98.05%. These numbers were measured with FASTag releases before 1.4; see
[doc/BENCHMARK-DirecTag.md](doc/BENCHMARK-DirecTag.md) for the side-by-side
comparison with the reference implementation and `tools/pxd000001_truth.py`
for the scorer.

The numbers in this section were measured before the scoring and
preprocessing fixes of November 2026 (m/z fidelity normalised per peak, no gap
edge across a present peak, scale-invariant deisotoping that merges 1+/2+
copies), which change E-values and the reported sets; they are being
re-measured with the benchmarks below.

The effect of the defaults (deisotoping and one gap) on how many identified
spectra gain a correctly placed tag is being measured for the current release
against database-search identifications on several public PXD runs.

`ctest` covers the rank-sum DP against exhaustive enumeration (small k and n),
end-to-end tag recovery from synthetic spectra, flanking-mass placement,
extension, gap ordering with a negative control, per-row mass closure,
repeat and thread-count determinism (every output, mzML and mzPeak input), the
sequence filter, that `-gap_penalty` never removes a tag at the E-value cutoff
(uncapped), and
the digest, label and mass-gap reports (`digest_test` against prose-auto
0.1.3's functions on synthetic tables, `digest_cli_test` end to end).

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
  `-ion_series cz` or `auto` (1.12, experimental, not yet validated on real
  ETD data) reads c/z• ions (see Ion series); under them one `Ion series`
  line on stderr gives the spectra per series, `auto` warns (`Hybrid
  activation:`) when more than 1% of the spectra are hybrid and were read as
  b/y, and `cz` warns (`Collisional activation:`) when more than 1% are
  collisional.
- **A tag is not an identification.** No per-tag q-value or FDR is emitted, and
  a `-fasta` match, a species call, a `delta_out` bin and a glyco flag are all
  candidates to follow up, not results to report.

## Licence and provenance

MIT — see [LICENSE](LICENSE). Dependencies and licences are in [BOM.md](BOM.md).
The shipped `-digest_out` background is the residue composition of the UniProt
human reference proteome UP000005640 (CC BY 4.0); see
[data/digest/README.md](data/digest/README.md).

The DirecTag algorithm is reimplemented from its publication. The reference
implementation (Apache-2.0) was read to resolve semantics the paper leaves
implicit; **no code was copied**.
