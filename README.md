# FASTag — a fast parallel mass spectrometry tagger and tag-based filter

Partial sequence tags from peptide MS/MS spectra, and a filter that keeps only
the spectra whose tags occur in sequences you supply. A reimplementation of the
[DirecTag](https://doi.org/10.1021/pr800154p) algorithm as an
[OpenMS](https://www.openms.de) TOPP tool. The citation — Tabb et al.,
*J. Proteome Res.* 2008, 7:3838 — is for that original DirecTag paper; FASTag
has no separate publication of its own.

Scales across threads with memory independent of file size, and returns 5-8%
more tags than the reference implementation.

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
not specificity — a tag matching a sequence is a reason to look closer, not a
identification in itself.

## How it works

Each MS2 spectrum's peaks form a graph: an edge connects two peaks whose m/z
difference matches a single amino acid residue's mass within the fragment
tolerance. A **tag** is a walk through that graph — a chain of residue-mass
edges — read as a short partial sequence.

**Seeding.** Every walk of length `-tag_length` (default 3 residues) is a
candidate seed.

**Scoring.** Each candidate is scored on three independent properties, combined
by Fisher's method into a single chi-squared-derived E-value:

- **Intensity** — how unlikely it is that peaks this strong would form a valid
  tag by chance, given the spectrum's overall intensity distribution.
- **m/z fidelity** — how closely each edge matches its residue mass.
- **Complementarity** — whether a tag's flanking masses are corroborated by a
  complementary ion elsewhere in the spectrum (b/y pairs summing to the
  precursor mass).

DirecTag computes the intensity term by enumerating every `C(n, k)` subset of
peak ranks — combinatorial in tag length, and impractical past length 4 or 5.
FASTag computes the same quantity as a restricted-partition count via dynamic
programming, `O(k·n·s_max)` — polynomial instead of combinatorial, verified
identical to exhaustive enumeration. This is most of why FASTag is faster, and
what makes tag lengths above four practical at all.

**Extension** (`-extension`). A seed is a *minimum* length: each scored seed can
be walked further along the graph at either end and rescored at its realised
length, recovering longer tags a fixed seed length alone would miss.

**Gaps** (`-gaps 1`). A tag can cross one missing peak — two peaks separated by
a two-residue combined mass bridge the hole, with every amino-acid composition
matching that sum spelled out as a candidate. On by default: measured against
Sage ground truth it lifts the number of spectra gaining a correctly placed tag
by 45.3% (see Validation). Because a gapped tag asserts an unobserved split, it
is systematically over-ranked relative to its real correctness, which
`-gap_penalty` corrects; disable gaps entirely with `-gaps 0`.

**Sequence filtering** (`-fasta`). Reported tags can be restricted to ones
occurring in proteins you supply. Matching:

- folds I/L (isobaric — an emitted `L` says nothing about which residue it
  really was),
- tries both orientations (tags are stored N→C under a y-ion assumption, so a
  b-ion-derived tag reads reversed against the protein),
- accepts isobaric residue-pair substitutions within `-isobaric_tolerance`
  (default 0.04 Da): `N`=`GG`, `Q`=`GA`/`AG`, `R`=`GV`/`VG`, `W`=`AD`/`GE`/`SV`,
  `K`=`GA` at the default tolerance.

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

Prebuilt binaries for every supported platform, from the
[latest release](https://github.com/okohlbacher/FASTag/releases/latest):

| platform | download |
|---|---|
| Linux x64 | [FASTag-linux-x64.tar.gz](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-linux-x64.tar.gz) |
| Linux arm64 | [FASTag-linux-arm64.tar.gz](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-linux-arm64.tar.gz) |
| macOS x64 | [FASTag-macos-x64.tar.gz](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-macos-x64.tar.gz) |
| macOS arm64 | [FASTag-macos-arm64.tar.gz](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-macos-arm64.tar.gz) |
| Windows x64 | [FASTag-windows-x64.zip](https://github.com/okohlbacher/FASTag/releases/latest/download/FASTag-windows-x64.zip) |

Each archive extracts to a `FASTag/` folder — run `FASTag/FASTag` (Linux/macOS)
or `FASTag/FASTag.bat` (Windows); everything else inside is a bundled
dependency the wrapper needs, not something to run directly.

Binaries are not yet code-signed, so macOS Gatekeeper and Windows SmartScreen
will warn on first run; see [doc/BACKLOG-ci.md](doc/BACKLOG-ci.md) if that
matters for your deployment.

Building from source needs OpenMS ≥ 3.5 and CMake; see
[doc/BACKLOG-ci.md](doc/BACKLOG-ci.md) for what each platform requires.

## Desktop GUI

A cross-platform desktop app ([`gui/`](gui/)) wraps the CLI: pick spectra, set
parameters from a form generated out of the tool's own `-write_ini`, watch a
progress bar, and browse the tags and the ranked species report (with a `rel.`
column showing each taxon's evidence relative to the top hit). It is built with
[Tauri 2](https://tauri.app) — a Rust backend and the OS's native webview, not a
bundled browser. The CLI remains the source of truth; the GUI shells out to it.

```bash
cd gui && npm install && npm run tauri dev     # or: npm run tauri build
```

Signed, installable bundles are still on the roadmap (see `doc/BACKLOG.md`); for
now the app is built from source. Details in [gui/README.md](gui/README.md).

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

# only tags occurring in a protein of interest, plus the spectra carrying them
FASTag -in run.mzML -out tags.tsv -fasta AGXT.fasta -out_spectra hits.mzML

# mzPeak in, mzPeak out -- any combination of mzML and mzpeak works
FASTag -in run.mzpeak -out tags.tsv
FASTag -in run.mzML   -out tags.tsv -out_spectra hits.mzpeak
```

**Set the fragment tolerance to match the analyser.** A high-resolution
tolerance on low-resolution data is silent and looks exactly like bad data — on
an ion-trap file, 20 ppm returned 3,007 tags where 0.3 Da returned 824,959.
FASTag infers resolution from peak spacing and warns when the two disagree, but
it cannot know the analyser, so the setting is yours.

### mzPeak

[mzPeak](https://github.com/OpenMS/mzpeak) is a Parquet-backed format (Parquet
tables in a ZIP container). FASTag **reads and writes** it: `-in` accepts
`.mzpeak` and `-out_spectra` writes it. Tagging is unaffected by which you use —
reading a run as mzpeak gives the same spectra as reading it as mzML, and a run
written to mzpeak and tagged again reproduces the original tag set exactly.

**All of it goes through one library, and none of it through OpenMS.** OpenMS's
own mzPeak implementation predates the format's 0.7.0 revision (split-facet
metadata, bare column names, the chunked signal layout with Numpress/delta
encodings, `data_kind: "data_arrays"`), so archives from current writers read
back as ZERO spectra through it, and its writer aborted on any spectrum that
had come through a current reader. FASTag therefore reads **and writes** mzPeak
with [mzpeak-openms](https://github.com/okohlbacher/mzpeak-openms), which
handles both layouts, is cross-validated against the Rust reference
implementation, and writes the precursor and selected-ion facets a re-tag
needs. All four in/out combinations work; `test/mzpeak_e2e.sh` tags a written
archive again and requires it to reproduce the tags it was written from.

Nothing in FASTag depends on the OpenMS feature branch that carries
`MzPeakFile` any more: a stock OpenMS >= 3.5 is enough, and `.mzpeak` is
recognised by extension rather than through OpenMS's `FileTypes`. One visible
consequence: `--help` no longer lists formats after `-in` and `-out_spectra`,
because that list is validated against `FileTypes` and would have to omit
mzpeak; the descriptions carry it instead.

**All five released binaries carry the library.** CI builds `mzpeak-openms`
from a pinned commit, runs its test suite against the same Arrow the binary
links, bundles it next to the executable, and accepts a release artifact only
after the shipped bundle has read a real archive. On Windows the library is
built with MSVC and linked statically (it carries no dllexport annotations);
Arrow, Parquet, libzip and Boost.JSON travel in the zip as DLLs. A build
configured without the library refuses `.mzpeak` on either side with a message
saying so, rather than reporting a clean run over an empty file.

To build from source with mzPeak: build `mzpeak-openms`, then configure FASTag
with `-DMZPEAK_SOURCE_DIR=<checkout> -DMZPEAK_LIB_DIR=<install prefix>`. This
release is built against `mzpeak-openms` `babe7ef`; older commits lack the
writer's precursor support, `MetadataDetail` and the MSVC build, and will not
compile. `13f5cbf` also lowered the library's Arrow floor to 21, which is what bioconda's
OpenMS pins, and builds with Apple clang 15 and GCC 13. Configure says what
you got:

```
-- FASTag: mzPeak read/write enabled (<path>/libmzpeak.dylib)
-- FASTag: mzpeak-openms NOT found -- this build reads and writes mzML only
```

Run-level metadata travels too: run id and start time, source files with
their checksums, the instrument with its source/analyser/detector components
and software, the sample, and the data-processing history, to which FASTag
appends its own filtering step. An archive that came in as mzPeak keeps its
metadata block verbatim (mzML has no field for much of it) and gets the FASTag
step appended.

**`-out_spectra` to mzPeak streams** (since v1.1.3): each kept spectrum is
re-read and handed straight to the writer, which flushes a Parquet row group
once enough points have accumulated, so the cost is one row group plus a few
hundred bytes of metadata per spectrum instead of the whole run. Converting a
1.8 GB Astral mzML to mzPeak (89,951 spectra kept) went from 11.8 GB peak RSS
to 852 MB, same wall time, byte-identical tags and an archive that reads back
identically. The mzML writer already streamed; both paths now do.

**Faster than mzML on the same acquisition, and now parallel.** Thermo LTQ
Orbitrap Velos, 7,534 spectra / 6,103 MS2, 16 logical cores, warm cache, wall
time and peak RSS as FASTag reports them (v1.2.0):

| threads | mzML (429 MB) | mzPeak, centroided (101 MB) | mzPeak, profile (126 MB) |
|---|---|---|---|
| 1 | 4.52 s / 117 MB | **0.98 s** / 170 MB | 2.91 s / 422 MB |
| 8 | 1.33 s / 144 MB | **0.43 s** / 176 MB | 1.07 s / 446 MB |
| 16 | 1.13 s / 167 MB | **0.34 s** / 182 MB | 0.81 s / 471 MB |

5.1x faster single-threaded and 3.4x at 16 threads, from a file a quarter the
size. Tag counts differ by one out of 122,098 — the archive stores m/z as
float32, which moves a single borderline match across the tolerance. The read
is parallel since v1.1.1: every thread owns a reader over a shared archive
index, the way the mzML path already gave each thread its own
`OnDiscMSExperiment`. Work is handed out on a guided schedule since v1.2.0 —
large chunks first, so a thread stays inside one row group, and small ones at
the end, so nobody waits at the barrier. Since v1.1.2 the decoded row groups
live in one cache shared by every reader, so each group is decoded once
whatever the thread count and memory no longer grows with `-threads`:
it follows the groups in flight, at most one per thread and never more than
the file has. The cache is sized to two groups per running reader, and the
reader count is capped so that fits 4 GB, which only matters for archives
with very large row groups (a chunked Astral archive has ~580 MB groups).

**Profile MS2 is centroided on read**, in the thread that reads it. mzPeak
archives converted from raw files routinely store profile MS2 with an empty
centroid facet, and tagging profile SAMPLES rather than peaks costs real
recall. Measured on one run available in both formats: 80,990 tags from the
profile archive read as-is, 122,489 with on-read centroiding
(`PeakPickerHiRes`), against 122,098 for the same run supplied as centroided
mzML. Picking runs in the worker rather than the reader, so it parallelises:
0.97 s at 16 threads on this archive. Converting that mzML to mzPeak and
tagging it reproduces the mzML result to within a single tag (122,097; 99.999%
of spectrum/tag pairs identical, flanking masses to 4 decimals).

### Reading speed

**Large mzML files read 2.6 to 3.8x faster since v1.2.0**, and in a fraction of
the memory. FASTag reads the mzML index directly and takes each spectrum's
metadata from the same XML it decodes for peaks, so there is no serial
metadata pass before tagging starts. Files without a usable index, and
`-out_spectra` runs (which need run-level metadata), load metadata up front
instead.

| input | before | after |
|---|---|---|
| 12.2 GB mzML | 36.99 s / 2.0 GB | **8.33 s** / 238 MB |
| 309 MB mzML | 1.95 s / 263 MB | **0.52 s** / 65 MB |
| 1.8 GB mzML | 9.03 s / 949 MB | **3.50 s** / 339 MB |
| 874 MB mzPeak | 5.05 s / 3.6 GB | **3.01 s** / 1.5 GB |

Tags are byte-identical to previous releases on every file tested. Smaller
files are unchanged, having had little prologue to remove.

## Command-line reference

| Option | Default | Meaning |
|---|---|---|
| `-in <file>` | — | Input spectra: mzML or mzpeak |
| `-out <file>` | — | Tag list, tab-separated |
| `-fasta <file>` | none | Report only tags occurring in these sequences |
| `-out_spectra <file>` | none | Write spectra carrying a reported tag here, as mzML or mzpeak (by extension). Needs memory proportional to the *file*, not the thread count, unlike every other path |
| `-tag_length <n>` | 3 | Seed tag length in residues |
| `-extension <n>` | 0 | Max residues appended per terminus; 0 disables extension |
| `-gaps <n>` | 1 | Allow a tag to cross one missing peak (0 or 1) |
| `-no_deisotope` | off | Do not collapse isotope clusters to their monoisotopic peak, and do not move multiply-charged fragments onto the singly-charged scale, before peak selection |
| `-fragment_tolerance <value>` | 20 | Fragment mass tolerance |
| `-fragment_tolerance_unit <ppm\|Da>` | ppm | Tolerance unit |
| `-max_peaks <n>` | 400 | Peaks retained per spectrum; 0 uses the internal ceiling of 1024, not unlimited. The ceiling for `-peaks_per_window` |
| `-peaks_per_window <n>` | 10 | Keep this many peaks per 100 Da window instead of the strongest `-max_peaks` overall; 0 disables |
| `-max_tags <n>` | 50 | Tags reported per spectrum; 0 = unlimited |
| `-max_evalue <value>` | 20 | E-value cutoff; 0 disables |
| `-gap_penalty <value>` | 100 | Rank gapped tags as if their E-value were this many times worse. Affects order only, never which tags are reported — gapped tags are otherwise heavily over-ranked (~95% of top-1 slots while ~3.6x less likely to be correct). 1 disables |
| `-isobaric_tolerance <value>` | 0.04 | Isobaric residue-pair substitution tolerance when matching `-fasta`; 0 requires exact strings |
| `-min_filter_length <n>` | 0 | Ignore tags shorter than this when matching `-fasta`; 0 derives a floor from database size |
| `-orientation <both\|forward>` | both | Also match a tag reversed (b-ion reading), or only as written |
| `-proforma` | off | Append a ProForma 2.0 column for each tag (see Output) |
| `-res_conf` | off | Append per-residue confidences 0..100, N→C, space-separated (see Assembly export) |
| `-diversity` | off | Under `-max_tags`, demote near-duplicate re-reads of an already-kept tag's peak set behind non-duplicates, then backfill. Reorders which tags occupy the capped slots; never changes output size or rank 1 (see Tag diversity) |
| `-recon_out <file>` | none | Reconcile reported tags against a protein database: one row per placement with protein, peptide, position, flank agreement, localized mass gap and its interpretation (see Reconciliation) |
| `-recon_fasta <file>` | `-fasta` | Database for `-recon_out`; independent of the membership filter, so a proteome-scale reconciliation never forces the filter's per-length index build |
| `-recon_missed_cleavages <n>` | 1 | Missed tryptic cleavages in reconciliation windows |
| `-recon_min_length <n>` | 0 | Shortest tag worth reconciling; 0 derives the chance-match floor from database size |
| `-delta_out <file>` | none | Aggregated mass-shift histogram over reconciliations (one best placement per spectrum). Region-level candidates, NOT localized identifications, NOT FDR-controlled |
| `-entrapment_fasta <file>` | none | Entrapment database (foreign species) calibrating a `q_db` column: the estimated false-match rate of the `-fasta` filter at each E-value (see q_db) |
| `-glyco` | off | Flag oxonium-bearing MS2 spectra to `<out>.glyco.tsv` (see Glyco flag) |
| `-glyco_out <file>` | `<out>.glyco.tsv` | Per-spectrum oxonium report |
| `-glyco_min_fraction <f>` | 0.10 | Summed oxonium intensity over base peak, the literature threshold |
| `-stream` | off | Resident single-spectrum mode: spectrum blocks on stdin, TSV rows + `#end` sentinels on stdout (see Streaming) |
| `-progress` | off | Emit `FASTAG_PROGRESS done=<n> total=<n>` on stderr for a progress bar |
| `-species` | off | Infer taxa from the tags (see Species detection) |
| `-taxdb / -taxonomy_nodes / -taxonomy_names <file>` | bundled | The index and NCBI dumps for `-species`; give all three or none |
| `-species_out <file>` | `<out>.species.tsv` | Ranked-taxa output |
| `-species_rank <rank>` | genus | NCBI rank to report (genus, family, …) |
| `-species_min_len <n>` | 0 | Ignore tags shorter than this for taxonomy; 0 uses the index k |
| `-subsample_spectra <n>` / `-subsample_fraction <f>` | 0 | Tag only a random subset (count or fraction); 0 = all |
| `-fixed_modifications` / `-variable_modifications <mods>` | Carbamidomethyl (C) fixed | Modifications by OpenMS/UniMod name, e.g. `'TMT6plex (K)'`, `'Phospho (S)'` |

Plus the standard OpenMS TOPP options: `-threads <n>` (parallelism — the
core performance lever), `-ini <file>` / `-write_ini <file>` (parameter files),
`-log <file>`, `-no_progress`, `--help` / `--helphelp`.

### Output

One TSV row per tag: `spectrum` (native ID), `tag` (sequence), `length`,
`charge` (fragment charge), `nterm_mass` / `cterm_mass` (flanking masses,
4-decimal precision), `extended` / `gapped` (flags), `evalue`, `min_conf` /
`mean_conf` (per-residue confidence, see below), and `fasta_hit`
(`fwd` / `rev` / `-`, present only with `-fasta`).

**Tag confidence.** The `evalue` is the primary, validated confidence — lower is
better, and on real identifications (PXD000001) it separates correct from
incorrect tags by roughly 400x in the median, with the best-E-value tag per
spectrum correct ~88% of the time. `min_conf` and `mean_conf` (both in [0,1],
higher better) score each residue's own support — m/z fit times endpoint peak
intensity — so `min_conf` localises the residue most likely wrong, which the
single E-value cannot; correct tags carry a markedly higher `min_conf` than
incorrect ones (~0.45 vs ~0.17 median). A calibrated per-tag *q-value/FDR* is
deliberately **not** emitted: a defensible null has to reproduce the chimeric
false tags real spectra generate, which a single-spectrum decoy does not — see
[doc/BACKLOG.md](doc/BACKLOG.md).

### ProForma output

`-proforma` appends a [ProForma 2.0](https://github.com/HUPO-PSI/ProForma) column
so downstream tools can consume a tag without a bespoke parser. Each tag renders
as `<[fixed-mods]>[+nterm]-RESIDUES-[+cterm]`: the flanks as terminal mass tags
(ProForma has no dedicated "mass gap of unknown sequence at a terminus"), fixed
modifications as a global prefix (`<[Carbamidomethyl]@C>`), and the I/L residue
as `J` because FASTag folds I onto L and cannot tell them apart. Off by default;
the TSV schema is unchanged unless asked for.

## Reconciliation and mass shifts

`-recon_out` places every reported tag onto tryptic windows of a protein
database by its flanking masses (TagRecon stage A+B, Dasari 2010), running on a
per-run suffix-array index over the whole proteome (~2 s and ~150 MB to build
on the human reference proteome; isobaric collapse and I/L folding applied
identically to the membership filter). Each row carries the protein, the
peptide window in its original database spelling, the position, which flank
matched, and — when exactly one flank disagrees — the localized mass gap with
a best-effort interpretation (`mod:Name@X`, `sub:X->Y`, or `?`).

`-delta_out` aggregates those gaps into a histogram, counting each spectrum
once (its best tag's smallest-|delta| placement) so fifty correlated tags
cannot flood a bin; placements whose mismatched-side flank was clamped to zero
are excluded and counted. **Read the histogram as candidates**: localization is
region-level, nothing here is FDR-controlled, and `delta_interp` names a
hypothesis, not an identification. On a human Astral run the zero bin
dominates, the +1.003 isotope-error peak and a +128.095 missed-K peak appear
where chemistry predicts them. Direct PTM-Shepherd interop is deliberately
absent — its only input is FDR-filtered Philosopher `psm.tsv`, a contract a
tag-level tool cannot honestly fill.

## q_db: entrapment-calibrated filter confidence

`-entrapment_fasta` builds a second membership filter over sequences the
sample cannot contain (use phylogenetically distant proteomes — archaea for a
mammalian sample) and appends a `q_db` column: the estimated **false-match
rate** of accepting every tag at or below that row's E-value against `-fasta`.
Entrapment-only matches are marked `efwd`/`erev` with an empty `q_db` — they
are calibration material, not discoveries — and are excluded from
`-out_spectra`. Ratios are computed per tag length in collapsed k-mer space,
orientation-closed.

**Measured calibration envelope** (doc/F4-CALIBRATION-AUDIT.md, human Astral
data, archaeal entrapment): conservative at `q_db <= 0.02`; **underestimates
the true false-match rate ~1.6x at 0.05–0.1**; sensitive to entrapment choice.
Use tight thresholds. And read the column for what it is: `q_db` says how
often a tag this good matches the database by chance — it says NOTHING about
whether the tag correctly reads its precursor (on PXD000001 ground truth,
rows at `q_db <= 0.01` were correct reads 100% of the time, but rows in the
0.05–0.2 bin only 52.9%). Cannot be combined with `-species`.

## Streaming mode

`-stream` turns FASTag into a resident process for instrument-control loops:
spectrum blocks in on stdin (`spectrum <id> <precursor_mz> <charge>`, one
`<mz> <intensity>` per line, blank line to finish), TSV rows plus a
`#end <id> <n_tags>` sentinel out on stdout, flushed per block; malformed
input yields `#error` and a resync, never an exit. All fixed costs are paid
once; measured steady state on real Astral spectra is **0.3–0.6 ms mean,
p99 <= 1.6 ms** per spectrum even with extension and gaps — two orders of
magnitude inside an instrument-control budget. Rows are byte-identical to
file mode (same formatter, verified). Core tagging only: `-fasta`, `-species`,
`-recon_out`, `-out_spectra` and `-entrapment_fasta` are refused; parameter
changes need a restart.

## Glyco flag

`-glyco` writes `<out>.glyco.tsv`: one row per processed MS2 spectrum with the
count of matched oxonium ions, their summed intensity over the base peak, a
0/1 flag (>= 2 distinct ions AND fraction >= `-glyco_min_fraction`, the
GPQuest / MSFragger-Glyco heuristics with their literature thresholds), and
the ion names. The flag means "a glycan fragmented here" — glycopeptide, free
glycan, or O-GlcNAc — never an identification. It lives in its own file
because glyco spectra are precisely the tag-poor ones a tag-TSV column would
miss; expect more rows than "MS2 tagged". Matching runs on the raw peak list
at the run's fragment tolerance. At 0.3 Da the TMT reporter 126.128 collides
with the HexNAc fragment 126.055 — use ppm tolerances on labeled data.
Measured specificity on non-enriched runs: 0.6% (Astral, ppm) flagged.

## Tag diversity

`-diversity` changes which tags occupy the `-max_tags` slots on chimeric
spectra: near-duplicate re-reads of an already-kept tag's peak set (same
charge, sharing all but at most one peak, both tags >= 4 peaks) are demoted
behind non-duplicates and backfilled in rank order. Output size, rank 1 and
determinism are unchanged — measured on the co-isolation-rich Eclipse TMT
benchmark, spectra with at least one database hit **rose** from 8,547 to
8,695 under a 10-tag cap. What it does not do: surface a co-isolated peptide
whose tags rank far below the cap — deferral reorders families near the head;
it is not per-peptide clustering. Off by default.

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
classifier, no database search. Off by default (it loads a k-mer index that
costs seconds and ~1 GB), and a complete request on its own:

```bash
FASTag -in run.mzML -out run.tags.tsv -species -tag_length 7
```

Each tag's k-mers are looked up in a reduced reference index; the taxa carrying
the whole tag vote, votes roll up the NCBI taxonomy, and each node is tested
against its background breadth. Output is a ranked TSV
(`rank taxid name observed expected enrichment log_pvalue qvalue`), one call per
taxon at `-species_rank` (genus by default).

`-tag_length` must be **at least the index k** (7) — a shorter tag cannot be
looked up, and FASTag refuses the run up front rather than writing an empty
report. Pair `-species` with `-subsample_fraction 0.1` for a fast call on a large
run.

**Get the index.** Release tarballs from v0.20 on carry the full k-mer index
inside (`share-FASTag-taxonomy/`), so `-species` works out of the box. For an
index-only download (older tarballs, source builds, upgrades), every release
also carries the platform-independent `FASTag-taxonomy-k7.tar.gz` (+`.sha256`);
extract it into the FASTag directory:

```bash
tar xzf FASTag-taxonomy-k7.tar.gz -C /path/to/FASTag/   # -> share-FASTag-taxonomy/
```

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
ranking aid, not a calibrated FDR (the chimeric-null problem again). Reagent
genera (*Bos*, *Sus*, *Oryctolagus*…) appear in almost any run — the GUI flags
them; in the TSV they are simply present.

## Demo data

FASTag was validated against public runs from
[ProteomeXchange](https://www.proteomexchange.org)/PRIDE and MassIVE, spanning
two vendors, three instruments, and both high- and low-resolution MS2:

| dataset | instrument | accession | file | convert with |
|---|---|---|---|---|
| HeLa, real ddaPASEF | Bruker timsTOF Pro | [PXD054073](https://www.ebi.ac.uk/pride/archive/projects/PXD054073) | `HeLa_T2_DDA_E_A_nLC_timspro_R02.d.7z` (3.17 GB) | `brfp convert -i <.d> -f 2 -o out.mzML` |
| Label-free DDA | Orbitrap Astral | [PXD076528](https://www.ebi.ac.uk/pride/archive/projects/PXD076528) | `7673_YD12_P116861_S00_R1.raw` (2.4 GB) | `ThermoRawFileParser -i in.raw -b out.mzML -f 2` |
| DDA-TMT | Orbitrap Eclipse (ion trap MS2) | [MSV000096674](https://massive.ucsd.edu/ProteoSAFe/dataset.jsp?accession=MSV000096674) (MassIVE, no PXD) | `ec04479_qy_4cell_SanJose_A1.mzpeak` | already mzpeak |

The Eclipse file's own metadata says `Orbitrap Eclipse` even though the deposit
is catalogued as Astral — read the instrument out of the file itself before
picking a tolerance. Run it with `-fragment_tolerance 0.3
-fragment_tolerance_unit Da`; the other two are high-resolution and want the
20 ppm default. See [doc/TEST-DATA.md](doc/TEST-DATA.md) for the full
provenance and what each dataset is useful for comparing.

## Performance

Scaling is near-linear to 16 cores and useful well beyond; output is identical
at every thread count, and memory is O(threads) rather than O(file) on the
default mzML path (`-out_spectra` is the one exception — see above). Exact
wall-clock time and peak memory depend heavily on the machine, so they aren't
quoted here — measure on your own hardware and data.

Against the reference implementation, run sequentially on the same file and
hardware, FASTag keeps scaling well past where DirecTag flattens out: DirecTag
rebuilds its ranksum table serially on every run, while FASTag's equivalent is
a one-off cost paid once regardless of thread count.

## Validation

Against the reference implementation, matched parameters, 717,924 timsTOF
pseudo-DDA spectra:

- **84.5%** of spectra identified by [Sage](https://doi.org/10.1021/acs.jproteome.3c00486)
  at 1% FDR carry a tag that reads the identified peptide (DirecTag 84.2%; the
  original paper reports > 80%)
- tag sets agree **100%** where no peak-count cap applies, ~84% on dense real
  spectra, where the two tools break intensity ties differently at the cut
- tags found by both are 2-4x more likely to be confirmed than either tool's
  unique tags

Against Sage ground truth (14,867 PSMs at 1% FDR), counting spectra that gain a
correctly placed tag:

| | spectra reached | vs baseline | correct tags |
|---|---|---|---|
| `-gaps 0 -no_deisotope` | 3,480 | — | 8,054 |
| deisotoping only | 4,142 | +19.0% | 12,683 |
| one gap only | 5,055 | +45.3% | 33,236 |
| **both — the default since v1.4.0** | **5,976** | **+71.7%** | **45,919** |

The two count columns answer different questions and move independently: a gap
multiplies how many tags a spectrum yields, so tag totals climb far faster than
the number of spectra reached. These figures are not reproducible here — the PSM
table they were measured against is no longer on any machine (see
[doc/TEST-DATA.md](doc/TEST-DATA.md)).

`ctest` covers the rank-sum DP against exhaustive enumeration, end-to-end tag
recovery from synthetic spectra, flanking-mass placement, extension, gap
ordering with a negative control, per-row mass closure, determinism, the
sequence filter, and that `-gap_penalty` reorders without ever removing a tag.

### Ranking, and the synthetic benchmark

Whether a correct tag exists is not the same question as whether it ranks
first, and PSM ground truth only answers the first one. `bench/benchmark.cpp`
generates synthetic spectra with exact per-tag truth, fitted to four real
acquisitions' peak count and ladder edge density (see
[doc/TEST-DATA.md](doc/TEST-DATA.md)), to answer the second.

It found that gapped tags took **95% of rank-1 slots while being 3.6x less
likely to be correct** — enabling gaps made the single best tag worse even as
it doubled total recall. `-gap_penalty` (default 100) fixes the ordering
without filtering anything out:

| astral profile, TL=4 | rank-1 | top-5 | total recall |
|---|---|---|---|
| `-gaps 1 -gap_penalty 1` | 17.7% | 47.7% | 71.3% |
| `-gaps 1` (default 100) | **28.6%** | **52.2%** | 71.5% |

## Known limitations

- **The defaults favour recall over speed.** Isotope collapsing and one gap are
  on, and the peak budget is `-peaks_per_window 10 -max_peaks 400`. For the
  fastest possible run, or to match a tool with no equivalent of these:
  `-no_deisotope -gaps 0 -peaks_per_window 0 -max_peaks 100`.
- **No modification support.** Residues are the unmodified 19, so labelled
  samples (TMT and similar) will not match tags spanning a modified residue.
- **mzPeak reading decodes whole row groups.** The smallest unit Parquet can hand back is a row group, tens of megabytes here, so an mzPeak run holds a few decoded groups where the mzML path holds a few spectra. Each group is decoded once and shared across threads (since v1.1.2), so this does not grow with `-threads`; it does grow with the archive's row-group size, and readers are capped so two groups per thread fit 4 GB.

## Licence and provenance

MIT — see [LICENSE](LICENSE). Dependencies and licences are in [BOM.md](BOM.md).

The DirecTag algorithm is reimplemented from its publication. The reference
implementation (Apache-2.0) was read to resolve semantics the paper leaves
implicit; **no code was copied**.
