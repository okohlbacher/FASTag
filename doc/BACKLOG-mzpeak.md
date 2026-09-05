# mzPeak: what works, what does not, what is next

Reading **and writing** `.mzpeak` work. Reading goes through an external
library, not OpenMS, and is both faster and lighter than the mzML path on the
same acquisition.

## What shipped

**Reading: `mzpeak-openms`, not OpenMS.** OpenMS's own `MzPeakFile` implements
the pre-0.7.0 layout (packed nested metadata, point-only signal, `data_kind:
"data arrays"`). The format moved to split-facet metadata with bare column
names, a chunked signal layout with delta/Numpress encodings, and
`data_kind: "data_arrays"` — so every archive from a current writer reads back
as ZERO spectra through OpenMS. Measured on a run that exists in both formats:
the mzML gave 6,103 MS2 and 122,098 tags, the mzPeak twin gave 0 and 0.

FASTag therefore reads with
[mzpeak-openms](https://github.com/okohlbacher/mzpeak-openms), which handles
both layouts and is cross-validated against the Rust reference implementation.
It is optional at configure time:

```
-- FASTag: external mzPeak reader enabled (<path>/libmzpeak.dylib)
-- FASTag: external mzPeak reader NOT found -- mzPeak input falls back to
   OpenMS's reader, which cannot read current-format archives
```

Without it the fallback path still builds, and a current-format archive exits
`INPUT_FILE_CORRUPT` with the rebuild instruction rather than reporting a clean
run over an empty file.

**The released binaries do NOT carry the external reader yet** — CI builds the
patched OpenMS but not `mzpeak-openms`, so a release binary reads only archives
OpenMS itself wrote. That is the top open item below.

**Writing is still `MzPeakFile`**: `-out_spectra hits.mzpeak` goes through
OpenMS, which writes the layout it understands.

Three of the four in/out combinations work. The earlier blanket refusal of
`-out_spectra` with mzPeak input is gone -- that path only ever needed the
run-level `ExperimentalSettings` wired in from the streaming consumer, which
the mzML paths get from `getMetaData()` or the loaded map.

**BROKEN: mzPeak in -> mzPeak out.** `MzPeakFile::store()` aborts with
`Parquet cannot store strings with size 2GB or more, got: 3616728266405065018`
when the spectra came from the external reader. That "length" is
`0x323133323030313a`, which is the ASCII `:1002312` -- the tail of
`MS:1002312`, the MS-Numpress linear accession, a string the WRITER never
mentions and the READER's array index does. So it is a dangling read into freed
library memory being taken as a string offset, not a real size.

What is known, from bisecting it:

| | |
|---|---|
| mzML -> mzpeak, same run, same spectrum count | works |
| mzpeak -> mzML -> mzpeak | works |
| mzpeak -> mzpeak, `small.mzpeak` (26 spectra) | works |
| mzpeak -> mzpeak, either Erwinia archive | **fails** |
| `-threads` 1, 4, 8 | fails identically |
| run-level `ExperimentalSettings` | not the cause (proved by suppressing the assignment) |

So it is data-dependent, deterministic, and specific to spectra produced by the
external reader. It fails with exit code 8 AFTER the tag TSV is written, so no
result is silently wrong. Fixing it means debugging `MzPeakFile::store()`'s
Arrow builders in okohlbacher/OpenMS-mzPeakRW; until then, write mzML.

Writing does NOT go through `FileHandler::storeExperiment()`: it has no mzPeak
branch, so asking it for one silently writes a different format. `MzPeakFile`
is called directly.

### How

Both readers are push-based (one `consumeSpectrum()` per spectrum); FASTag's
loop wants a batch to parallelise over. `ChunkingConsumer` buffers into chunks
and hands each to the same per-spectrum work the mzML path uses — one shared
`tag_one`, so the readers cannot drift. `src/MzPeakReader.cpp` drives the
external library into that same consumer, so swapping readers changed no
tagging code at all.

Three decisions worth keeping:

- **The chunk is bounded by peaks, not spectra.** Spectra in this corpus run from
  ~100 peaks to over 130,000, so "2048 spectra" is anywhere between 200 K and
  270 M peaks. A peak budget is flat whatever the data looks like.
- **MS1 and precursor-less spectra are dropped in the consumer**, not in the
  tagging callback, so they never occupy the buffer. On DDA that is most of the
  input.
- **MS1 peaks are never DECODED.** `mz()`/`intensity()` are what trigger the
  library's lazy Parquet decode, so the reader consults `ms_level()` — metadata
  only — and offers non-MS2 spectra without touching their arrays. The consumer
  still sees them, so the progress denominator matches the mzML path. On the
  Erwinia run that is 23.2 M points not decoded out of 24.2 M, and it is why
  the centroided archive reads in 0.52 s rather than 1.25 s.

### Verified

Current read path (`mzpeak-openms`), Erwinia LTQ Velos:

| | |
|---|---|
| mzpeak -> tags | 6,103 MS2 / 122,097 tags -- same MS2 count as its mzML twin |
| vs the mzML twin | 122,098 tags, differing by ONE (`QAF` scan 6501; float32 m/z) |
| determinism | byte-identical at 1, 8 and 16 threads |
| MS1-skip and Lean metadata | tag output byte-identical to the versions before each |
| no external reader | builds; a current-format archive exits `INPUT_FILE_CORRUPT` with the rebuild instruction |

Write path (`MzPeakFile`), measured when it shipped and unchanged since:

| | |
|---|---|
| output vs mzML | **byte-identical**, 847,528 tags on the Eclipse DDA file |
| mzML -> mzpeak -> tags | **exact round-trip**: 127,035 tags, identical to tagging the source mzML |
| mzpeak -> mzpeak -> tags | 883,939 tags, unchanged through the write and re-read |

### Timing and memory: mzPeak vs mzML, same acquisition

Thermo LTQ Orbitrap Velos, TMT/Erwinia, 7,534 spectra / 6,103 MS2, available in
three forms: the source mzML (429 MB), that mzML converted to mzPeak (101 MB,
centroided), and the raw file converted straight to mzPeak (126 MB, profile
MS2). Apple M-series, 16 logical cores, 128 GB; page cache warmed; best of two
after a discarded warm-up. Five-run spread is +-0.02 s and +-1 MB.

| threads | mzML | mzPeak centroided | mzPeak profile (picked on read) |
|---|---|---|---|
| 1 | 4.42 s / 116 MB | **0.91 s** / 199 MB | 2.35 s / 355 MB |
| 8 | 1.37 s / 144 MB | **0.53 s** / 201 MB | 1.96 s / 356 MB |
| 16 | 1.19 s / 161 MB | **0.52 s** / 202 MB | 1.95 s / 356 MB |

**The centroided archive reads 2.3x faster than its mzML twin at 16 threads and
4.9x faster single-threaded, from a file a quarter the size**, at 1.25x the
memory. The old `MzPeakFile` path bought 2.3x wall time for 4x memory; this one
is faster and no longer memory-hungry.

Tag counts: mzML 122,098, mzPeak centroided 122,097. The single difference is
`QAF` on scan 6501 — the archive stores m/z as float32 and that moves one
borderline match across the 20 ppm line. The profile archive is a separate
conversion (native profile MS2, centroided by FASTag on read) and gives
122,489, which is not a like-for-like number.

**mzPeak does not scale with `-threads`; mzML does.** The read is one serial
pull loop, so mzPeak is flat from 1 to 16 threads while mzML gains 3.7x. They
would cross somewhere past 16 cores. Single-threaded mzPeak is the interesting
number, and it is 4.9x ahead.

### Why profile costs 3.7x what centroided does

Not the format — the point count. Same 6,103 MS2 spectra:

| | MS1 | MS2 |
|---|---|---|
| centroided archive | 1,431 spectra, 23.2 M pts | 6,103 spectra, **1.00 M pts** (164/spec) |
| profile archive | 1,431 spectra, 23.3 M pts | 6,103 spectra, **8.20 M pts** (1,343/spec) |

Since MS1 is never decoded, FASTag reads 1.00 M points from one archive and
8.20 M from the other. The reader alone, no picking and no tagging:

| | decode | RSS | Arrow transient peak |
|---|---|---|---|
| centroided | 0.18 s | 105 MB | 72 MB |
| profile | 0.70 s | 276 MB | 141 MB |

That accounts for essentially the whole 154 MB memory gap before FASTag does
anything, and for 0.52 s of the 1.43 s time gap. The profile archive also
stores its points in 4x as many chunks per spectrum (24 vs 6), so each
spectrum's decode does more slicing.

The rest is centroiding. `PeakPickerHiRes` fits cubic splines over all 8.20 M
points **serially, in the reader thread**; a `sample` of the 16-thread run
shows `__workq_kernreturn` at the top (workers idle) with
`CubicSpline2d::derivatives` and `PeakPickerHiRes::pick_` underneath. Picking
is per-spectrum and embarrassingly parallel and sits on the serial path only
because that is where it was put — see "Next".

### Metadata: shared, and Lean

The library caches the whole descriptive metadata table before the first peak
is read. Two changes to `mzpeak-openms` (branch
`perf/lean-and-shared-metadata`) make that affordable:

- **Shared per archive.** `Manager` caches the map, so a second `Spectra` over
  one `Index` costs +0.5 MB and 1 ms instead of +26.9 MB and 60 ms. Since the
  only thread-safe way to read one archive from N threads is one `Spectra` per
  thread, this is the difference between one copy and N.
- **`MetadataDetail::Lean`** omits the CV-parameter lists, scan windows and
  auxiliary arrays — none of which FASTag reads — and omits them at the Parquet
  level, so the columns are never decoded either. Six more scan columns that
  no reader ever extracts (`filter_string` and friends) are skipped in both
  modes.

| 7,534 spectra | before | Full | Lean |
|---|---|---|---|
| metadata high-water | 25.9 MB | 25.3 MB | **17.2 MB** |
| live map | 10.2 MB | 9.7 MB | **6.5 MB** |

FASTag asks for `Lean`. Tag output is byte-identical either way, and every
field `Lean` contracts to preserve is identical to `Full` across all 7,534
spectra of both archives.

### Two upstream bugs found while wiring this up

Both silent, both fixed in [OpenMS-mzPeakRW PR #1](https://github.com/okohlbacher/OpenMS-mzPeakRW/pull/1),
and either one alone makes mzPeak unusable from an *installed* OpenMS.

1. **Every `dynamic_pointer_cast<arrow::*Array>` returns null** when Arrow is
   built with hidden symbol visibility -- the conda-forge default. `libOpenMS`
   and `libarrow` hold distinct typeinfo, the cross-DSO `dynamic_cast` cannot
   match, and the reader silently drops precursors, CV params and the profile
   `mz_delta_model`. Measured: **0 of 42,092** precursors survived a load, while
   the Parquet held all 42,092. FASTag needs a precursor to tag, so every
   spectrum was rejected and the run reported a confident zero.

   Diagnosed by replicating `readPrecursors_`'s exact logic in a standalone
   Arrow program linked against the *same* libarrow, where it found all 42,092
   rows -- so the difference is purely the shared-library boundary, not the data.

2. **`MzPeakFile.h` was in no CMake list**, so it never installed. Invisible
   when building against an OpenMS *build tree* (which exposes source includes
   directly), fatal for a consumer of an install: `FileTypes.h` ships with
   `MZPEAK` but the class is absent, so FASTag's header-based feature detection
   silently produced a build with no mzPeak support.

Worth remembering as a class: both failures were *green builds that shipped
without the feature*, which is why CI now asserts `MzPeakFile.h` is present in
the installed OpenMS rather than trusting the build to have noticed.

## History: `MzPeakFile::transform()` and its memory (write path only now)

**Resolved 2026-07-24.** `MzPeakFile::transform()` reads row group by row group
and emits as it goes (`PointBatchStream_`), holding back only the trailing rows
of a spectrum that straddles a row-group boundary so consumers still see whole
spectra. Both point tables (profile + centroid) are merged in lockstep by
`spectrum_index`, reproducing the RT order the materialising path produced.
Filters (MS level, RT, m/z) run through one shared `dispatch` lambda used by both
paths so they cannot drift. Measured after the fix: a 42,092-MS2 `.mzpeak` peaks
at **581 MB**. The numbers below are the BEFORE state, kept for the record.


| input | size | peak RSS |
|---|---|---|
| Eclipse DDA, mzpeak | 93 MB | 945 MB |
| **HeLa diaPASEF, mzpeak** | **2.11 GB** | **23,735 MB** |
| same data, mzML | — | 169 MB |

**~11x the file size**, against an mzML path that holds O(threads).

The buffer is not the cause. Varying the chunk budget over a 16x range moved peak
memory under 10%:

| budget | peak RSS |
|---|---|
| 4 M peaks | 1027 MB |
| 1 M peaks | 945 MB |
| 250 K peaks | 986 MB |

If the buffer dominated, memory would track it. It does not, so the term that
matters is inside `MzPeakFile::transform()`, which materialises the run despite
the consumer interface existing precisely to avoid that.

**Guidance: mzPeak is fine for files small relative to RAM. Use mzML for large
runs.**

## Next

1. **Ship the external reader in the release binaries.** CI builds the patched
   OpenMS but not `mzpeak-openms`, so a released FASTag reads only archives
   OpenMS itself wrote and refuses everything a current writer produces. The
   feature is documented, tested and fast locally, and absent from the thing
   users download. Needs meson + Arrow/Parquet + libzip in the CI image on
   four platforms, Windows included.
2. **Land the metadata branch upstream.** `perf/lean-and-shared-metadata` in
   okohlbacher/mzpeak-openms carries the shared metadata cache and
   `MetadataDetail::Lean`; FASTag's Lean call needs it. Until it is on the
   default branch, `MZPEAK_REF`-style pinning has nothing to pin to.
3. **Pick in the worker, not in the reader.** `PeakPickerHiRes` runs serially
   inside `streamMzPeak` while every tagging thread waits. Moving it into the
   parallel callback should take the profile archive from 1.95 s toward its
   0.70 s decode floor; the centroided path does not pick at all and is
   unaffected.
4. **Parallelise the read itself.** Blocked upstream, and the measurements say
   it is not worth much yet: one shared `Index` with a contiguous block per
   thread scales 0.87 s -> 0.30 s at 8 threads but costs ~T x the memory,
   because each thread keeps its own row-group cache and Arrow transients.
   Bounding that cache by BYTES rather than by a count of two is the
   prerequisite (a group is 22-35 MB here and ~580 MB on a chunked Astral
   archive).
5. **`OnDiscMzPeakExperiment`** -- random access over Parquet row groups,
   matching `OnDiscMSExperiment`. Would let the mzPeak path use the *same*
   pull-based loop as mzML instead of a separate chunked one, deleting the
   consumer entirely. The right long-term shape, and an OpenMS contribution
   rather than a FASTag change.
6. **Writer-side: intensity as float32.** The mzML->mzpeak converter writes
   `intensity` as `large_list<double>`; the raw converter writes
   `large_list<float>`. Same nominal format, twice the decoded bytes -- 29.3 MB
   of a 35.1 MB row group in the centroided archive exists only because of
   that.

## Caveat

mzPeak is pre-1.0: *"no stability is guaranteed at this point"*. The API surface
used here is deliberately tiny — `open()`, `spectra()`, and per-spectrum
accessors on the read side, one `store()` on the write side — so churn lands in
`src/MzPeakReader.cpp` and one dispatch site.
