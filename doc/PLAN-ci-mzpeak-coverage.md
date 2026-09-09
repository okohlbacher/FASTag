# CI coverage for the mzPeak read and write paths

Status: reviewed (see Review revisions at the end); implemented on this branch. Branch `ci/mzpeak-coverage`, base `main` (5afa252).
Revisions after the adversarial review are recorded at the end.

## What CI covers today, and the gap

Both workflows build `okohlbacher/mzpeak-openms` from the pinned
`MZPEAK_LIB_REF`, run the library's own meson tests, assert
`FASTag: mzPeak read/write enabled` in `configure.log`, read the library's
`small.mzpeak` fixture through `build/FASTag` (34 MS2) and again through the
shipped bundle. That is all. Nothing in CI:

- compares the tags FASTag produces from an mzPeak archive with the tags it
  produces from the same centroids in mzML;
- checks that any archive FASTag *writes* is a valid mzPeak archive, or that
  it can be read back at all;
- runs `test/mzpeak_e2e.sh` -- it needs `FASTAG_E2E_MZML`/`FASTAG_E2E_MZPEAK`
  pointing at a matched real-data pair, so it SKIPs (77) on every CI run.

The failure class that motivates this: a reader that returns zero peaks (or
zero precursors) with exit 0 is indistinguishable from a file with no MS2.
It has happened three times in this project's history (`doc/BACKLOG-mzpeak.md`:
OpenMS's `MzPeakFile` reading every current archive as 0 spectra; hidden
symbol visibility dropping 0 of 42,092 precursors; a green build with no mzPeak
support at all). Every one presented as a green CI.

## Facts the design rests on (measured on `main`, `build-rel/FASTag`, 2026-09-09)

Fixture: `test/fixtures/Ecoli_MS2_small.mzML` (already vendored, sha256
`30717211...`, 139 MS2, ion-trap, centroided). All runs below on that file.

| run | result |
|---|---|
| mzML, plain (fast `IndexedMzMLReader`), 20 ppm, 4 threads | 139 MS2, 1825 tags, 129 distinct spectra tagged |
| mzML, `-out_spectra rt.mzpeak` (OnDisc reader), 4 threads | 139 MS2, 1825 tags; **wrote 129 spectra** |
| `rt.mzpeak`, 4 threads | **129 MS2**, 1825 tags |
| `rt.mzpeak`, 1 thread | 129 MS2, 1825 tags |
| `rt.mzpeak` with `-out_spectra rt2.mzpeak`; then `rt2.mzpeak` | 129 / 1825 both |
| all six TSVs pairwise | **byte-identical** (`cmp`) |
| same at 0.3 Da (ion-trap tolerance) | 6046 tags, all 139 spectra tagged, byte-identical |

So on this fixture the invariant is exact equality, not the 99.9 % agreement
`mzpeak_e2e.sh` allows for archives converted by other tools (those store m/z
as float32; FASTag's writer stores m/z as float64 and intensity as float32,
which is what OpenMS's `Peak1D` holds anyway). The archive contains exactly the
set of spectra that carried a reported tag (129 of 139), with native IDs
preserved (`controllerType=0 controllerNumber=1 scan=11461` ...).

**mzPeakValidator** (`okohlbacher/mzPeakValidator`, pin `78c5b38` = v0.9.20,
catalog 1.13; `pip install git+...@78c5b38`; deps pyarrow>=17, numpy,
jsonschema; console script `mzpeak-validate`; exit 0 = no errors, 1 = at least
one error-level finding, 2 = engine failure; `--json` writes the full report;
`--quick` skips the DATA_SCAN rules; full mode takes 0.26 s on the 436 KB
archive above).

Full-mode verdict on the archive FASTag wrote from the fixture: **FAIL, 2
errors, 6 warnings.** Both errors are in FASTag's own run-metadata mapping
(`src/OnDiscMzPeakExperiment.cpp`, `toRunMetadata()`), and both are confirmed
against the upstream HUPO-PSI schema (`schema/instrument_configuration.json`,
`schema/ms_run.json` on `HUPO-PSI/mzPeak-specification` main):

1. `instrument_configuration_list/0/components/0/component_type: 'source' is
   not one of ['ionsource', 'analyzer', 'detector']` -- line 556 writes
   `"source"`; line 425 reads `"source"` back.
2. `metadata/run: 'id' is a required property` -- line 499 writes `run.id` only
   when `ExperimentalSettings::getIdentifier()` is non-empty, and OpenMS's mzML
   handler never sets it from `<run id=...>` (only from a top-level `<mzML id>`
   accession), so it is empty for essentially every mzML input.

The library's own `small.mzpeak` fixture passes the same validator (0 errors,
5 warnings), so the validator is not simply rejecting this library's writer.

The 6 warnings are CvMapping MUST terms (instrument model, analyzer type,
detector type, software, data transformation) that FASTag's mapping emits as
plain `name`/`value` params without accessions. Warnings do not fail the
validator and are out of scope here (recorded below).

## Decisions

**D1. The fixture is produced by FASTag itself, in the test.** `-out_spectra
x.mzpeak` from the vendored Ecoli mzML. No converter, no download, no new
test data. The archive is a *subset* (tagged spectra only), so the equivalence
check is: tags(archive) == tags(mzML) byte-for-byte (same spectra, same rows,
same order), AND the archive's MS2 count == the number of distinct spectra in
the mzML tag list, AND that count > 0. A writer that dropped spectra or
precursors, or a reader that returned zero peaks, changes at least one of
those. A reader that silently returned *fewer* peaks per spectrum changes the
tag rows.

**D2. Tolerance: the tool's default (20 ppm).** At 0.3 Da every spectrum is
tagged and the subset equals the whole file, which would leave the
subset-count assertion vacuous. At 20 ppm 129 of 139 spectra are written,
so the "exactly the tagged spectra" property is actually exercised.

**D3. The mzML reference is the production path (no `-out_spectra`).** With
`-out_spectra` set the fast reader is bypassed for `OnDiscMSExperiment`
(`src/FASTag.cpp` ~1077). Comparing the plain run against the writing run
against the archive run is a three-way check that also pins the two mzML
readers to each other, at no extra cost.

**D4. The validator is a hard gate on every run, not only tags.** The pin is a
commit SHA and the fixture is fixed, so the verdict can only change when
FASTag's writer changes (or a maintainer moves the pin, which is a deliberate
act). The repository's own doctrine, stated in a dozen places in `ci.yml`, is
that a property should fail a cheap main push rather than a release; a
warning on main that becomes an error on a tag is exactly the pattern that
put the v1.4.1 taxonomy index bug in front of users. The cost of a false
positive is one red push and a pin bump; the cost of a false negative is an
archive other readers reject. Full mode, not `--quick`: 0.26 s.

**D5. Therefore the two writer defects are fixed in this branch.** They are
FASTag's code, tiny, and spec-backed; leaving the gate soft to accommodate
known-invalid output would make the gate worthless. Fix: write `"ionsource"`
and accept both spellings on read (archives already written with `"source"`
keep loading); always emit `run.id` (the identifier when present, else
`run_0`, the same default OpenMS's own mzML writer uses). Separate commit,
clearly labelled, so it can be reverted independently of the tests.

**D6. Validator install: `actions/setup-python@v5` (3.12) + pip from a
requirements file** (`test/mzpeak-validator-requirements.txt`, one line, the
git URL with the SHA). Isolated from the conda/OpenMS environment on purpose --
bioconda's `openms` pins libarrow 21.\*, and pulling a Python `pyarrow` into
that solve couples an unrelated tool to the build environment. The
requirements file is the single pin location for all three workflows/uses
(ci.yml, windows.yml, a developer's venv) and doubles as setup-python's
`cache-dependency-path`, so the ~40 MB pyarrow wheel is fetched once per
pin/platform, not once per run. `pip install -r` of a `git+...@sha` URL needs
`git`, present on every GitHub runner.

**D7. A test hook for multi-row-group archives.** The reader defect class that
matters most ("large point-layout archive returns zero peaks") is triggered by
row-group boundaries, and a 36,050-point archive has one row group. The
writer takes `points_per_row_group` (`mzpeak/writer.h`, default 2^20);
FASTag's `MzPeakSpectrumWriter` will read `FASTAG_MZPEAK_POINTS_PER_ROW_GROUP`
(documented as a test knob, ignored when unset/invalid) and pass it through.
The test writes a 4096-point-per-group archive (~9 row groups), re-tags it,
asserts the tags are byte-identical to the mzML run, and asserts the reader's
own log line `mzPeak: decoded N row groups once for T reader threads` reports
N > 1 -- proving the multi-group path was the one exercised, with no Python
dependency. The archive is also handed to the validator, which checks
row-group/footer consistency rules (`spectra_*_footer_implies_rows`,
`*_points_in_file`) that a single-group archive cannot trip.

**D8. Where things run.** ctest for everything that needs only the binary and
the fixture (so a developer gets it from `ctest` with no setup), the validator
also under ctest when `mzpeak-validate` is resolvable (SKIP 77 otherwise, like
`stream_test`), and CI steps for what needs the bundle or the runner.

## Test matrix

| # | test | proves | inputs | runs where | platforms | runtime | failure it would have caught |
|---|---|---|---|---|---|---|---|
| T1 | `mzpeak_roundtrip` (ctest; `test/mzpeak_roundtrip.sh <bin> <fixture.mzML> <outdir>`) step A: mzML plain, 4 threads | the reference run produces tags (count > 0) | Ecoli fixture | ctest | 5 | ~1 s | fixture broken; OpenMS data path missing (SKIP, as `stream_test`) |
| T1-B | mzML with `-out_spectra rt.mzpeak` | archive written, non-empty; TSV byte-identical to A (OnDisc reader == fast reader; writing does not perturb tagging); `Wrote N spectra` == distinct spectra in A's TSV | same | ctest | 5 | ~1 s | writer dropping kept spectra; reader divergence between the two mzML paths |
| T1-C | read `rt.mzpeak`, 4 threads | TSV byte-identical to A; reported `N MS2 spectra` == distinct tagged spectra of A, and > 0 | rt.mzpeak | ctest | 5 | ~1 s | **the zero-peaks / zero-precursors class** (0 MS2, 0 tags, exit 0); any peak, m/z, intensity or precursor loss on the write or read side |
| T1-D | read `rt.mzpeak`, 1 thread | byte-identical to C | rt.mzpeak | ctest | 5 | ~1 s | thread-count-dependent reader (shared row-group cache races, block partition bugs) |
| T1-E | read `rt.mzpeak` with `-out_spectra rt2.mzpeak`, then read `rt2.mzpeak` | both TSVs byte-identical to A | rt.mzpeak | ctest | 5 | ~2 s | archive->archive write path (raw metadata passthrough, precursor facets from an mzPeak-sourced spectrum) |
| T1-F | mzML with `-out_spectra rt_rg.mzpeak` under `FASTAG_MZPEAK_POINTS_PER_ROW_GROUP=4096`, then read it (4 threads) | TSV byte-identical to A; reader log reports `decoded N row groups` with N > 1 | fixture | ctest | 5 | ~2 s | the multi-row-group read path returning zero/partial peaks; spectra straddling a group boundary |
| T1-skip | -- | SKIP 77 when the binary refuses `.mzpeak` ("This build has no mzPeak support") or cannot initialise | -- | ctest | -- | -- | a library-less local build is not a failure |
| T2 | `mzpeak_validate` (ctest, DEPENDS on T1; `test/mzpeak_validate.sh <report-dir> <archive>...`) | every archive T1 wrote (rt, rt2, rt_rg) passes mzPeakValidator in **full** mode: exit 0, no error-level finding, no engine failure; JSON + log report per archive kept in `<report-dir>` | T1's outdir | ctest (SKIP 77 when `mzpeak-validate` is not on PATH / `$MZPEAK_VALIDATE` unset) + CI | 5 | ~1 s + one-time ~30 s install | spec-invalid metadata (the two errors found today), footer/row-group count mismatches, schema drift when the library pin moves |
| T2-ctl | control: the library's `small.mzpeak` validated in the same step | distinguishes "FASTag wrote a bad archive" from "the validator/pin is broken" | `mzpeak-src/test/files/v2/small.mzpeak` | CI step only (the path exists only in CI) | 5 | ~0.5 s | a validator regression misattributed to FASTag |
| T3 | bundle read AND write | the SHIPPED bundle, run with a scrubbed environment (`env -i` on Linux/macOS; the scrubbed-PATH pattern on Windows), tags the bundled Ecoli mzML, writes `bundle.mzpeak`, reads it back, TSVs byte-identical, count > 0; `bundle.mzpeak` then goes through T2 | bundled `share-OpenMS/examples/ID/Ecoli_MS2_small.mzML` | CI step (extends "Verify the bundle is portable") | 5 | ~3 s | libmzpeak/Arrow/Parquet/libzip/Boost.JSON travelling for read but not write (the writer pulls Parquet's *writer* symbols and libzip's deflate, which reading a small archive never touches) |
| T4 | validator report artifact | every validator JSON/log from T2 and T3 uploaded as `mzpeak-validator-<platform>` | -- | CI | 5 | ~2 s | -- (diagnosability, not a gate) |
| T5 | Windows parity | T1 (ctest, bash from Git for Windows, as `stream_test` already does), T2 (setup-python + pip, pyarrow has win_amd64 wheels), T3 (scrubbed PATH), T4 | same | windows.yml | 1 | same, +~30 s install | Windows-only regressions in the statically linked library (the dllexport-less static build is a different link than the other four) |

Existing coverage that stays: the configure-log assertions, the library's
meson tests, the 34-MS2 smoke on `small.mzpeak` (build and bundle),
`test/mzpeak_e2e.sh` for real matched pairs (local, opt-in; unchanged).

Expected added wall time per platform: ~10 s of FASTag runs, ~30-40 s for
setup-python + pip on a cold pip cache (a few seconds warm), ~3 s validator.
Roughly one minute on a cold cache; well under the noise of the ~4-minute
Linux job and irrelevant next to Windows's OpenMS build.

## Failure surfacing

- T1, T2 (ctest): ordinary ctest failures; `--output-on-failure` prints the
  script's `FAIL <check>: got/want` lines.
- T2, T3 (CI): `::error::` annotations naming the archive and the first
  error-level findings; the full report is in the artifact.
- Hard fail everywhere (D4). No `continue-on-error`, no warning-only mode.

## Deliberately not covered, and why

- **Profile-mode archives / vendor-centroided twins.** An archive converted
  from profile data is centroided by FASTag's own picker on read; comparing it
  with a vendor-centroided mzML compares two pickers, not the reader
  (`mzpeak_e2e.sh` header). Stays opt-in and local.
- **Archives written by other converters** (`mzpeak-convert`, the Rust
  reference). Not installable in CI without a Rust toolchain and a network
  fetch on every run; the library's own tests cross-validate against the
  reference implementation already, and `small.mzpeak` (written by the
  reference converter) stays in the smoke test.
- **Large archives / memory behaviour.** The zero-peaks class is triggered
  here by row-group boundaries (T1-F), not by size. Nothing in CI reads a
  multi-GB archive; that remains the benchmark corpus's job.
- **The 6 CvMapping warnings** (missing MS:1000031 instrument model,
  MS:1000443, MS:1000026, MS:1000531, MS:1000452 accessions in FASTag's
  metadata mapping). Real, but not errors, and fixing them means threading
  OpenMS's CV accessions through `toRunMetadata()`; a separate change. The
  test records warning counts in the report but does not gate on them.
- **`default_instrument_id` / `default_source_file_id` when the input mzML
  has no instrument or sourceFile block.** The schema requires both; FASTag
  emits them only when OpenMS holds the data. The fixture has both. Inputs
  without them would fail T2 -- correctly, since the archive is invalid -- but
  CI cannot see that case. Recorded as a follow-up for the writer, not for CI.
- **Chromatograms, ion mobility, wavelength spectra.** FASTag neither reads
  nor writes them.
- **The GUI's use of the CLI on mzPeak input.** Different workstream.

## Files

- `test/mzpeak_roundtrip.sh` (new), `test/mzpeak_validate.sh` (new),
  `test/mzpeak-validator-requirements.txt` (new, the pin)
- `CMakeLists.txt`: two `add_test` blocks next to `mzpeak_e2e`
- `src/OnDiscMzPeakExperiment.cpp`: D5 (two lines + read-side tolerance) and
  D7 (the env knob in `MzPeakSpectrumWriter::Impl`)
- `.github/workflows/ci.yml`: validator install step before Test; Test step
  exports `MZPEAK_VALIDATE`; bundle write round trip inside "Verify the bundle
  is portable"; a "Validate every mzPeak archive this job wrote" step +
  artifact upload. All inside the existing test/bundle region of the `build`
  job, nothing appended at the end of the file.
- `.github/workflows/windows.yml`: the same four, adapted to the `fastag/`
  checkout prefix and the `.bat` wrapper.

## Review revisions

Adversarial review by Codex (gpt-6-astra), brief `/tmp/brief-ci-mzpeak.md`,
output `/tmp/review-ci-mzpeak.md`, 2026-09-09. Every finding was checked
against the code before a verdict.

| # | finding (severity as given) | verdict | evidence | action |
|---|---|---|---|---|
| Q1 | Tag equality does not prove lossless peaks: halving every intensity, or dropping peaks the precursor gate / peak quota discard, leaves the tags unchanged (major) | **CONFIRMED** | `src/FASTagger.cpp:330-412` uses intensity only to order peaks and rank them; the fixture's 36,050 intensities halve exactly in float32 | New C++ test `mzpeak_adapter_test` (below): a value oracle over the adapter -- exact m/z (double), intensity (float), peak counts, native ID, MS level, RT, polarity, every precursor's m/z, charge, isolation offsets and intensity, compared per spectrum against the OpenMS-loaded mzML. D1/T1-C claims of "any intensity loss" retracted. |
| Q1 | The reported `N MS2 spectra` counts only non-empty MS2 with a precursor, so an extra MS1 or precursor-less spectrum in the archive passes (minor) | CONFIRMED | `src/FASTag.cpp:1377` | The adapter test asserts `getNrSpectra()` == spectra written and the ID list is exactly the set written; T1 keeps the reader-count check as the whole-tool observable and adds the writer's `Wrote N spectra` == distinct tagged spectra. |
| Q2 | Validator falls back to the latest bundled profile on an unknown/missing version with only a warning, so exit 0 does not prove the declared version was validated (major) | CONFIRMED | `core.py:769-789`; the fallback is surfaced as a warning finding with id `profile_resolution` (`core.py:2018`) | `test/mzpeak_validate.sh` fails on any `profile_resolution` finding and requires verdict `PASS` with 0 errors. Both FASTag's archive and the control declare `metadata.version = "0.9.0"`, which resolves to the bundled `mzpeak-0.9` profile deterministically. |
| Q2 | The git SHA pins the validator but not its engine (`pyarrow>=17`, unbounded numpy, `jsonschema>=3`) (major) | CONFIRMED | `pyproject.toml:21` | `test/mzpeak-validator-requirements.txt` pins every package to the versions tested here (pyarrow 25.0.1, numpy 2.5.3, jsonschema 4.26.0 and their transitive set); CI installs with `--only-binary=:all:` (verified to accept the VCS requirement), wheels verified to exist for cp312 on linux x86_64/aarch64, macOS x86_64/arm64, win_amd64; the file is setup-python's `cache-dependency-path`; pip is retried 3x. |
| Q2 | "Fetched once per pin/platform" overstates pip caching (minor) | CONFIRMED | -- | Wording corrected: a warm cache avoids the download; a cold one costs ~40 MB. |
| Q3 | D5 fixes only metadata reconstructed from OpenMS; an mzPeak input's raw metadata bypasses it (`:483`), so a legacy FASTag archive (`"source"`, no `run.id`) re-written by FASTag keeps both defects (major) | CONFIRMED | `src/OnDiscMzPeakExperiment.cpp:475-486` | The raw path normalises both known defects before writing. Covered by the adapter test: an `ExperimentalSettings` carrying legacy raw JSON goes through `toRunMetadata()` and comes out spelled `ionsource` with a `run.id`. |
| Q3 | Sparse inputs: the instrument schema also requires `software_reference`, emitted only when the instrument software has a name (`:565`); `default_source_file_id` / `default_instrument_id` likewise conditional (major) | CONFIRMED | `schema/json/instrument_configuration.json:16` | Out of scope for CI; recorded as a writer follow-up. D5's guarantee is scoped to inputs carrying instrument + software + sourceFile metadata (every vendor-converted mzML; the fixture). |
| Q3 | `ru_0`, not `run_0`, is OpenMS's default (nit) | CONFIRMED | OpenMS `MzMLHandler.cpp:5028` | Fallback id is `ru_0`. |
| Q4 | `points_per_row_group=4096` cannot produce a spectrum straddling two groups: the pinned writer appends the whole spectrum, then flushes (major) | CONFIRMED | `mzpeak-openms/src/writer.cpp:1002-1009` ("Whole spectra per group") | Straddling claim withdrawn. T1-F stays as a multi-group *integration* check; the split-spectrum read path is recorded as uncovered (no writer in reach produces one; the library's own tests use 8/40/64-point groups but never split a spectrum either). |
| Q4 | `rowGroupsDecoded()` counts cache decode operations, not physical groups (minor) | CONFIRMED | `src/OnDiscMzPeakExperiment.cpp:330` | New accessor `rowGroupCount()` reads the Parquet footer's `num_row_groups()`; the adapter test asserts it is > 1 under the knob. T1-F's log assertion is kept as coarse evidence only. Env value parsed strictly (digits only, > 0, no overflow). |
| Q5 | The two mzML readers can differ on inputs outside this fixture (single-quoted attributes); D3 stays strict here (minor) | OPEN, not acted | `src/IndexedMzMLReader.cpp` attribute parser | Noted in the report; an mzML-reader matter, out of scope. |
| Q5 | D3 does not prove the fast reader ran (minor) | CONFIRMED, not acted | `test/indexed_mzml_test.cpp:79` already covers acceptance | No new log assertion. |
| Q6 | Selected-ion intensity is written (`:698`) but never restored on read (`:111`) -- real current loss (major) | CONFIRMED | reader sets m/z, charge, offsets only | Reader fixed (`prec.setIntensity`). The adapter test injects a precursor intensity and a second precursor on some spectra so the fixture's absence of both does not hide the path. |
| Q6 | RT / polarity / second precursor regressions invisible to tag equality (minor) | CONFIRMED | -- | All compared exactly by the adapter test. |
| Q6 | A tagging-loop regression dropping the last spectrum shrinks A and B identically (minor) | CONFIRMED | -- | T1 asserts the mzML run reports exactly `139 MS2 spectra` (a fixture constant, like the existing 34-MS2 smoke) and `0 < tagged spectra < 139`; tolerance passed explicitly (20 ppm) rather than relying on defaults. |
| Q6 | `block_base` boundary past 65,535 spectra not reachable with this fixture (minor) | CONFIRMED, not coverable here | `src/FASTag.cpp:1319,1613` | Recorded as uncovered. |
| Q7 | CTest `DEPENDS` orders only; a failed producer does not stop the consumer (major) | CONFIRMED | verified with a throwaway project: a *failed* setup marks the consumer `Not Run`; a *skipped* setup lets it run | `FIXTURES_SETUP`/`FIXTURES_REQUIRED`; `mzpeak_validate.sh` SKIPs 77 when the outdir holds no archive (the skipped-producer case) and FAILS when `MZPEAK_VALIDATE` is set but not executable. |
| Q7 | Bare `python`/`pip` in a conda-activated login shell defeats the isolation (minor) | CONFIRMED | `ci.yml` uses `bash -el {0}`; windows has conda python 3.11 | Install with setup-python's `python-path` output, in a plain `bash` step; export the absolute validator path. |
| Q7 | "Cannot initialise" is too broad a skip (minor) | CONFIRMED | -- | T1 skips only on the exact no-mzPeak-support message or an OpenMS data-path failure; CI additionally fails if `mzpeak_roundtrip`, `mzpeak_validate` or `mzpeak_adapter_test` show as Skipped in the ctest output. |
| Q7 | 4 threads on 2 cores exercise few chunks; T1-D is a smoke, not a race proof (minor) | CONFIRMED | `schedule(guided)` with a 64-spectrum minimum chunk | Described as a thread-count determinism smoke. |
| Q7 | Reports must upload after a failure (minor) | CONFIRMED | -- | `if: always()` on the artifact step. |
| Q7 | Quoting, `LC_ALL=C`, tab-delimited IDs, keep outputs (nits) | CONFIRMED | -- | Done in the scripts. |
| Q8 | T3 does not exercise libzip deflate: the writer stores entries (`ZIP_CM_STORE`), Parquet compresses with ZSTD (minor) | CONFIRMED | `writer.cpp:627`, `util/parquet_writer.cpp:209` | Wording corrected; T3 kept for the Parquet-writer / zip-finalisation / temp-staging symbols. |
| Q8 | `env -i` does not prove no build-prefix leakage (patchelf failures are ignored) (minor) | CONFIRMED, not acted | `ci.yml` bundle step `patchelf ... \|\| true` | Out of scope; T3 claims only "runs and writes with a scrubbed environment". |
| Q9 | ctest and the CI step both validate the round-trip archives (nit) | CONFIRMED | -- | The CI step validates only the bundle archive and the control; ctest's reports are collected into the same artifact. |

### Revised matrix (delta)

- **New T0 `mzpeak_adapter_test`** (C++, ctest, all 5 platforms, ~2 s): loads
  the fixture with OpenMS `MzMLFile`; on a few spectra sets a selected-ion
  intensity and adds a second precursor; writes with `MzPeakSpectrumWriter`
  (once with the default row-group size, once with
  `FASTAG_MZPEAK_POINTS_PER_ROW_GROUP=4096`); reads back with
  `OnDiscMzPeakExperiment`; compares every field listed under Q1 exactly;
  asserts `getNrSpectra()` == written and `rowGroupCount()` > 1 for the small
  groups; feeds a legacy raw-metadata `ExperimentalSettings` through
  `toRunMetadata()` and checks the normalisation. Builds only when the
  library is configured, SKIPs 77 without the fixture. Needs
  `src/OnDiscMzPeakExperiment.cpp` factored into a static library target
  (`fastag_mzpeak`) that both `FASTag` and the test link; FASTag's own link
  set is unchanged in effect.
- T1: explicit 20 ppm; asserts `139 MS2 spectra` on the mzML run, `Wrote N
  spectra` == distinct tagged spectra, `0 < N < 139`; F asserts `decoded N
  row groups` with N >= 2 as coarse evidence only.
- T2: rejects `profile_resolution`; pinned engine; fixture-gated ordering.
- Source changes (one commit, separate from the tests): `ionsource` spelling
  (write) + both spellings (read); `run.id` always (`ru_0` fallback); the same
  two normalisations on the raw-metadata path; selected-ion intensity restored
  on read; `FASTAG_MZPEAK_POINTS_PER_ROW_GROUP` (strictly parsed);
  `rowGroupCount()`; `kRawMetaKey` exposed for the test.

### Still uncovered after the revision

- A spectrum split across two row groups (archives from other writers).
- Sparse-metadata inputs (no sourceFile / no instrument software): the
  archive is schema-invalid today; writer follow-up.
- `block_base` past 65,535 spectra; loader-path leakage in the bundle; the
  mzML fast reader's attribute parser on single-quoted attributes.
