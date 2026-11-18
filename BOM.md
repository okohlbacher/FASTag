# Bill of Materials

FASTag · MIT · <https://github.com/okohlbacher/FASTag>

Input is mzML, mzPeak (read and written through OpenMS's `MzPeakFile`) or MGF (read by FASTag's own `MgfReader`, see below);
output is TSV plus optional mzML or mzPeak.
The desktop GUI's own dependencies are pinned in `gui/package-lock.json`
(frontend) and `gui/src-tauri/Cargo.lock` (Tauri backend); what the desktop
bundles redistribute is under "Desktop app bundles" below.

## Direct dependencies

| Component | Version | Licence | Why | Linkage |
|---|---|---|---|---|
| [OpenMS](https://www.openms.de) | ≥ 3.7 (develop `70cebcd144`) | BSD-3-Clause | mzML, mzPeak and FASTA I/O, residue chemistry, physical constants, spectrum data structures, TOPP application framework (`OpenMS_CLI`) | dynamic |
| [Boost.Math](https://www.boost.org) | ≥ 1.81 | BSL-1.0 | chi-squared and hypergeometric distributions | header-only |
| [zlib](https://zlib.net) | the one OpenMS links (1.3.2 in CI) | Zlib | inflating zlib-compressed mzML peak arrays in the direct decoder | dynamic |
| [mimalloc](https://github.com/microsoft/mimalloc) | 2.2.4 (source tarball pinned by SHA-256 in `CMakeLists.txt`) | MIT | Windows only (`FASTAG_MIMALLOC`, on by default with MSVC): replaces the Windows process heap for the whole process through `mimalloc-redirect.dll`, because the many small per-spectrum allocations of the mzML read scale poorly on it | dynamic (`mimalloc.dll` + `mimalloc-redirect.dll` beside the executable) |

Boost and zlib arrive transitively with OpenMS; apart from mimalloc on Windows,
FASTag adds no dependency OpenMS does not already require. The only third-party source in this repository is one
function ported from OpenMS (BSD-3-Clause, notice kept in the file): the
averagine deisotoper in `src/AveragineDeisotoper.cpp`.

## Redistributed runtime libraries (binary bundles)

The source depends only on the two components above, but the release bundles
(Linux tarballs, the macOS app and tarball, the Windows zip and installer)
redistribute the shared libraries the binary loads: libOpenMS and its whole
runtime closure from conda-forge -- about 185 files on Linux, among them
Apache Arrow/Parquet and the cloud filesystem SDKs it links (AWS, Azure,
Google Cloud), abseil, protobuf, OpenSSL, ICU, libxml2, curl, zstd, Kerberos,
libstdc++ and libgomp. Their licences are BSD, MIT, Apache-2.0, BSL-1.0, ICU,
zlib and GPL-3.0 with the GCC runtime library exception.

Every bundle carries `LICENSE` (FASTag's MIT notice) and
`THIRD-PARTY-NOTICES.txt`, written at bundle time by
`tools/third_party_notices.py`: each bundled library mapped to the conda
package that installed it, with that package's version, licence and licence
texts. The texts come from the package archive (`info/licenses/`, fetched from
the package URL and checked against its conda-meta checksum when the CI
environment came from a cache), from licence files the package installs, or
from `tools/licenses/conda/<package>.txt` for the few packages that carry
none; a package without a text fails the build. Up to 1.15.0 the file listed
the licences without their texts. OpenMS's own licence and notices are in
`share-OpenMS/`.

The Windows zip and the Windows installer's bundled CLI also carry
`mimalloc.dll` and `mimalloc-redirect.dll` (mimalloc 2.2.4, MIT, Microsoft
Corporation and Daan Leijen), built from source by FASTag's CMake rather than
installed by conda; `.github/workflows/windows.yml` appends mimalloc's licence
text to `THIRD-PARTY-NOTICES.txt`. `mimalloc-redirect.dll` is the prebuilt
binary the mimalloc source ships. Building with `-DFASTAG_MIMALLOC=OFF` drops
both; `MIMALLOC_DISABLE_REDIRECT=1` switches the redirection off at run time.

## Shipped data

| Data | Source | Licence | Used by |
|---|---|---|---|
| Residue composition of the human reference proteome (`share/FASTag/digest/digest_models.tsv`, `background` rows) | UniProt UP000005640 (The UniProt Consortium, *Nucleic Acids Res.* 2025), written by `tools/digest_models.py` | CC BY 4.0 | `-digest_out` |
| Reference proteomes for `-alkylation_proteome` (`share/FASTag/alkylation/{human,mouse,yeast,ecoli}.fasta.gz`, about 17 MB; release, sha256 and notice in `data/alkylation/README.md` and `proteomes.tsv`) | UniProt release 2026_04, reviewed entries of UP000005640, UP000000589, UP000002311, UP000000625 (The UniProt Consortium, *Nucleic Acids Res.* 2025), fetched by `tools/fetch_proteomes.sh` | CC BY 4.0 | `-alkylation_out` |
| Species k-mer index (`share-FASTag-taxonomy/tax_k7.taxdb`, ~1.06 GB, in every release bundle and the index-only release asset; provenance in its `MANIFEST.json`, `data/taxonomy/README.md`) | Built by `buildtaxdb` from the UniProt reference proteomes of the 50 taxa in `data/taxonomy/reference-set.tsv` (The UniProt Consortium, *Nucleic Acids Res.* 2025), fetched by `tools/fetch_reference_set.py`; the pinned index `taxonomy-k7-20260901` from a fetch of 2026-07-24..2026-09-01 whose UniProt release was not recorded | CC BY 4.0 | `-species` |
| Pruned NCBI taxonomy (`share-FASTag-taxonomy/nodes.dmp`, `names.dmp`, 406 taxa; `data/taxonomy/`) | NCBI Taxonomy `taxdmp.zip` of 2026-07-24 (sha256 `984e3da736d09d3d803ee225adcdad355febc6f387b2589f43818ff9c45fb21d`), pruned by `tools/prune_taxdump.py` | public domain (US government work) | `-species` |
| Example data (`examples/Ecoli_MS2_small.mzML`, `Ecoli_MS2_small.fasta`; next to the executable in the CLI archives, `resources/fastag/examples/` in the desktop app) | OpenMS `release/3.5.0` example files (`share/OpenMS/examples/ID/`, three entries of `target_decoy_Ecoli_K12_TaxID_83333.proteomes.fasta`); sha256 in `examples/README.md` | BSD-3-Clause | the tutorial, the app's File > Open Example Data |
| Mass-gap modification list and priors (`share/FASTag/digest/massgap_mods.tsv`) | prose-auto 0.1.3 `delta_combos.MODS`; masses from OpenMS's Unimod | BSD-3-Clause (prose-auto ships in the OpenMS tree); Unimod as distributed with OpenMS | `-massgap_out` |

## Bundled assets (desktop GUI)

| Asset | Source | Licence | Used by |
|---|---|---|---|
| IBM Plex Sans and IBM Plex Mono, latin and latin-ext subsets, WOFF2 (`gui/src/assets/fonts/*.woff2`) | IBM Corp., [IBM Plex](https://github.com/IBM/plex) | SIL Open Font License 1.1; texts in `gui/src/assets/fonts/OFL-IBMPlexSans.txt` and `OFL-IBMPlexMono.txt` | the GUI's typeface, built into the frontend bundle (no font is fetched at run time) |
| OpenMS logo (`gui/src/assets/openms-logo.png`) | The OpenMS project ([openms.de](https://www.openms.de)) | The OpenMS project's logo, shown only to credit OpenMS; not covered by FASTag's MIT licence | the app bar's "Built on OpenMS" credit |
| FASTag logo (`gui/src/assets/logo.svg`) | FASTag | MIT, as the rest of FASTag | the app bar |

## Desktop app bundles

Each desktop bundle (macOS `.dmg`; Linux `.deb`, `.tar.gz` and `.AppImage`,
x64 and arm64; the Windows installer) carries in `resources/fastag/` the
command-line closure above with its `LICENSE` and `THIRD-PARTY-NOTICES.txt`,
plus `GUI-THIRD-PARTY-NOTICES.txt`, written at bundle time by
`tools/gui_third_party_notices.py` for the bundle's target. It covers:

| Component | What is redistributed | Licences (main ones) |
|---|---|---|
| Rust crates | the normal-dependency closure of `gui/src-tauri` for the bundle's target, from `Cargo.lock` (`cargo metadata --filter-platform`): 257 crates on macOS, 269 on Windows, 331 on Linux (1.15.0 lock) (Tauri 2, wry, tao, serde, the Tauri plugins dialog, opener, notification, store and single-instance, and their dependencies); build-only and dev-only crates are not linked and not listed | MIT, Apache-2.0, BSD, Zlib, Unicode, MPL-2.0 (`selectors`, `cssparser`), ISC, BSL-1.0 |
| npm packages | the production dependencies of `gui/package-lock.json` built into the frontend: react, react-dom, scheduler, @tauri-apps/api, @tauri-apps/plugin-dialog, @tauri-apps/plugin-opener | MIT, Apache-2.0 |
| Fonts and images | see "Bundled assets" above | OFL-1.1 |
| AppImage only: system libraries | what linuxdeploy copies from the build machine (Ubuntu 22.04): WebKitGTK 4.1, JavaScriptCore, GTK 3, GLib, GStreamer and its plugins, Cairo, Pango, HarfBuzz, libsoup, ICU and their dependencies; each mapped to its Ubuntu package with the package's copyright file and the licence texts it refers to, and for the (L)GPL ones the source package, version and its Ubuntu (Launchpad) source link | LGPL-2.0/2.1+, GPL with exceptions, MIT, BSD, MPL |
| Windows installer | the NSIS installer stub (zlib/libpng licence; its bzip2 module under the bzip2 licence); WebView2 is part of Windows and not bundled (the installer downloads Microsoft's bootstrapper only where it is missing) | Zlib; bzip2 licence |

macOS uses the system WebKit, and the `.deb` and the Linux tarball depend on
the distribution's WebKitGTK and GTK instead of bundling them. A crate or npm
package that ships no licence file gets the canonical SPDX text of its licence
(`tools/licenses/spdx/`) with its authors as copyright holders; a component
without any licence text, or an AppImage library that no Ubuntu package owns,
fails the build. CI checks the file in every bundle.

## What OpenMS provides, so FASTag does not implement it

| Facility | OpenMS API |
|---|---|
| Residue masses (19, I folded to L) | `ResidueDB::getResidues("Natural19WithoutI")`, `Residue::getMonoWeight(Residue::Internal)` |
| Proton mass | `Constants::PROTON_MASS_U` |
| Water mass | `EmpiricalFormula("H2O").getMonoWeight()` |
| Nearest peak within a tolerance | `MSSpectrum::findNearest(mz, tol)` |
| mzML read and write | `FileHandler::loadExperiment` / `storeExperiment` |
| mzPeak read and write | `MzPeakFile::transform` (streamed, file order) / `MzPeakFile::store` |
| Profile MS2 centroiding on mzPeak input | `PeakPickerHiRes` |
| FASTA parsing | `FASTAFile::load` |
| Spectra, peaks, precursors | `MSExperiment`, `MSSpectrum`, `Peak1D`, `Precursor` |
| Streaming mzML reads, bounded memory | `MzMLSpectrumDecoder::domParseSpectrum` (peaks of every spectrum FASTag's direct decoder declines, via `IndexedMzMLReader`); `OnDiscMSExperiment` as the fallback and `-out_spectra` reader (one reader per thread; the class is not thread-safe) |
| CLI, INI files, logging, citations | `TOPPBase` |
| MGF numbers (peaks, PEPMASS, CHARGE, RTINSECONDS, MSLEVEL) | `StringUtilsHelper::extractDouble` / `extractInt`, the parsers behind `StringUtils::toDouble`, which `MascotGenericFile` uses |
| MGF and compression by file name | `FileHandler::getTypeByFileName`, `FileNameUtils::hasCompressionSuffix` / `compressionType` |
| χ² survival function | `boost::math::chi_squared` |
| Hypergeometric tail | `boost::math::hypergeometric_distribution` |

## What FASTag implements, and why it is not borrowed

| Component | Why not from a library |
|---|---|
| χ² and hypergeometric tails | Kept as **boost**, not moved to OpenMS: OpenMS has no chi-square survival function, no incomplete gamma and no hypergeometric anywhere (searched; its only `chi_squared` hits are regression residuals). Boost computes the *upper* tail directly rather than as `1 − cdf`, which is what matters when tags live at p ~ 1e-10. |
| Tolerance half-width (`tolAt`) | Not `Math::getTolWindow`: that returns asymmetric absolute bounds, deliberately widened so the relation between two *measured* values is symmetric. FASTag compares a *computed* target against a measured peak — a different relation, for which the symmetric half-width is correct. |
| Monte-Carlo RNG | Not `Math::RandomShuffler`: it is a shuffler over `boost::mt19937_64` with no variate generation, and exists only because `std::random_shuffle` was not portable. A seeded `std::mt19937` already gives the reproducibility that matters. |
| Rank-sum null (`ranksum.h`) | Neither OpenMS nor Boost has the exact null of a sum of *distinct* ranks. Boost offers the normal approximation to Mann-Whitney, unusable here because the informative tags sit in the far tail. |
| Isotope-cluster collapse (on by default; `-no_deisotope`) | Ported from OpenMS `Deisotoper::deisotopeWithAveragineModel` (release 3.5.0) for the one parameter set FASTag passes, and bit-identical to it (`test/deisotoper_test.cpp`). The library call was a quarter of worker CPU at benchmark settings: a binary search per isotope position, vectors allocated per candidate, and a parameter object built per call. OpenMS remains the reference. |
| Top-N peak selection | `NLargest` uses `sortByIntensity()`, an unstable sort with no secondary key. Peaks carry integer counts, so ties at the cut are common — 23% of real spectra have one — and which peak survives would depend on the standard library's sort. Peak selection provably drives tag output, so FASTag uses a total order (intensity desc, m/z desc). |
| Spectrum graph, tag enumeration, scoring, extension | The algorithm itself. `OpenMS::Tagger` enumerates tags but returns bare strings with no scoring and no flanking masses, and expands I/L during recursion, which costs 2^k tags. |
| Isobaric collapse rules | Derived at runtime from `ResidueDB` masses at the configured tolerance. `MassDecompositionAlgorithm` decomposes a mass into compositions, but returns unordered compositions rather than the ordered residue pairs the rules need. |
| mzML reader (`IndexedMzMLReader`) | `OnDiscMSExperiment`'s per-spectrum decoder drops MS level, retention time and precursors, so getting them means a serial parse of the whole file before tagging. FASTag's reader reads them from each spectrum's own XML, rebuilds a missing or stale index with a parallel scan, and decodes the peaks itself (`MzMLDirectDecoder`). |
| mzML peak decoder (`MzMLDirectDecoder`) | `domParseSpectrum` builds a libxml2 document per spectrum and a new inflate state per array; that was most of the read cost. FASTag's decoder scans the `<binaryDataArrayList>` directly, with per-thread buffers, for one m/z and one intensity array (32/64-bit float, uncompressed or zlib) and hands everything else (numpress, zstd, extra arrays, unknown terms, malformed input) to `domParseSpectrum`. Spectrum by spectrum identical to it on the fixture, its re-encodings and the public gate inputs (`test/indexed_mzml_test.cpp`); `FASTAG_OPENMS_DECODER=1` turns it off. |
| mzPeak streaming (`MzPeakStream`) | Streams an mzPeak archive in file order through `MzPeakFile::transform`, so spectra are tagged in parallel without loading the run. |
| MGF reader (`MgfReader`) | `MascotGenericFile` only loads a whole file into memory, serially; its per-block parser is protected and bound to `std::ifstream`, and it refuses the CHARGE forms msconvert (`2+ and 3+`) and its own writer (`-3-`) emit. FASTag indexes the blocks in parallel and parses each with OpenMS's number parsers, bit-identical to `MascotGenericFile` on every field both read (`test/mgf_reader_test.cpp`). |
| k-mer index for the FASTA filter | Application-specific; nothing equivalent in OpenMS. |
| Taxonomy k-mer index and species calls (`TaxIndex`, `TaxStats`, `buildtaxdb`) | Application-specific; scans tags against per-taxon k-mer sets and scores enrichment with the same Boost tails already listed. |

## Test data

`test/fixtures/Ecoli_MS2_small.mgf` is `Ecoli_MS2_small.mzML` (OpenMS example,
BSD-3-Clause) written as MGF by `tools/mzml_to_mgf.py` with pyteomics 5.0.2
(Apache-2.0; used to write the fixture, not shipped or linked).
`test/fixtures/diatracer_like.mzML` and `ddapasef_empty.mzML` carry peaks of the
same example in timsTOF-shaped mzML written by
`test/fixtures/make_converter_fixtures.py`, so BSD-3-Clause as well.
`test/fixtures/Ecoli_shortlist.fasta` and `chymo_insilico.mgf` (#5) are written
by `test/fixtures/make_shortlist_fixtures.py` (standard library) from OpenMS
example FASTAs (crap.fasta and the target-decoy E. coli FASTA, BSD-3-Clause);
`comet_template.params` follows the layout of OpenMS's CometAdapter. Provenance
and sha256 in `test/fixtures/README.md`.

## Provenance

The DirecTag algorithm (Tabb et al., *J. Proteome Res.* 2008, 7:3838,
doi:10.1021/pr800154p) is reimplemented from its publication. The reference
implementation (`freicore`/DirecTag, Vanderbilt University, Apache-2.0) was read
to resolve semantics the paper leaves implicit — the y-ion flanking-mass
convention, the fitted rather than observed peak positions, and
`numFragmentChargeStates = max(1, charge − 1)`. **No code was copied**, and
FASTag is not a derivative work of it: the scoring nulls, the tag enumerator and
the data structures are independently written, and several deliberately differ
(exact hypergeometric instead of a tabulated MVH; Fisher DOF from the number of
active subscores rather than from a sum of weights).

## Optional, not linked

Benchmark data preparation used ThermoRawFileParser (Apache-2.0) and BRFP for
vendor-format conversion. Neither is linked, called, or required to build or run
FASTag; both produce the mzML that FASTag consumes.

## Build-time only

CMake ≥ 3.28, a C++23 compiler (OpenMS 3.7 requires it). `cmake/eigen3-range-shim/` contains two CMake
files that work around Eigen 3.4's config-version file rejecting the version
range `OpenMSConfig.cmake` requests; they contain no Eigen code.
