# Building FASTag from source

Most users do not need this: signed builds for macOS, Windows and Linux are on the
[release page](https://github.com/okohlbacher/FASTag/releases/latest) (see README, Install).

FASTag links OpenMS 3.7 (develop), which has no package yet. A source build therefore has
three parts: a conda environment with the libraries, OpenMS built from source at the pinned
commit, then FASTag. The commands below are the ones CI runs (`.github/workflows/ci.yml` for
Linux and macOS, `.github/workflows/windows.yml` for Windows); what was checked where is listed
at the end.

## Requirements

| What | Version |
|---|---|
| CMake | 3.28 or newer (`cmake_minimum_required` in `CMakeLists.txt`; `.github/env/openms.yml` asks for the same) |
| Ninja | any recent; CI uses Ninja on every platform |
| C++ compiler | C++23 with OpenMP: GCC 13 or 14, conda-forge clang 19 with `llvm-openmp` on macOS (Apple's clang has no OpenMP), MSVC 2022 on Windows |
| Libraries | exactly those in [`.github/env/openms.yml`](.github/env/openms.yml) (Arrow/Parquet 24, Boost 1.92, libxml2, Eigen, ...) |
| OpenMS | develop at commit [`70cebcd144`](https://github.com/OpenMS/OpenMS/commit/70cebcd14442cecd6bcd9794fb6786d3342cacc6) |
| Disk / time | OpenMS: about 1 h on 4 cores, a few GB; FASTag: about 1 min on 32 cores |

## 1. Conda environment

Create the environment from the repository's file, with the compilers of your platform
(the `compilers` entries of the build matrix in `ci.yml`). micromamba, mamba and conda take the
same arguments:

```bash
git clone https://github.com/okohlbacher/FASTag.git && cd FASTag

# Linux x64 (CI also adds patchelf, used only for packaging)
micromamba create -n fastag -f .github/env/openms.yml 'gxx_linux-64=14.*' 'sysroot_linux-64=2.28.*'
# Linux arm64
micromamba create -n fastag -f .github/env/openms.yml 'gxx_linux-aarch64=14.*' 'sysroot_linux-aarch64=2.28.*'
# macOS, Apple silicon (Intel: clangxx_osx-64)
micromamba create -n fastag -f .github/env/openms.yml 'clangxx_osx-arm64=19.*' 'llvm-openmp=19.*'

micromamba activate fastag
```

The glibc 2.28 sysroot is what makes the released Linux CLI run on RHEL 8; a local build can
use the system GCC 13 or 14 instead. On Windows, create the environment without compilers and
build from a Visual Studio 2022 developer prompt (see `windows.yml`).

## 2. OpenMS at the pinned commit

```bash
git init openms-src && cd openms-src
git remote add origin https://github.com/OpenMS/OpenMS.git
git fetch --depth 1 origin 70cebcd14442cecd6bcd9794fb6786d3342cacc6
git checkout FETCH_HEAD
cd ..

cmake -S openms-src -B openms-build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PWD/openms-install" \
  -DCMAKE_PREFIX_PATH="$CONDA_PREFIX" \
  -DOPENMS_USE_VCPKG=OFF \
  -DOPENMS_ENABLE_MZPEAK=ON \
  -DARROW_USE_STATIC=OFF \
  -DWITH_GUI=OFF -DPYOPENMS=OFF -DENABLE_DOCS=OFF -DHAS_XSERVER=OFF \
  -DWITH_OPENTIMS=OFF -DWITH_THERMO_RAW=OFF \
  -DMT_ENABLE_OPENMP=ON -DMT_REQUIRE_OPENMP=ON \
  -DBUILD_TOPP_TOOLS=OFF \
  -DINSTALL_OPENMS_EXAMPLES=OFF \
  -DBUILD_TESTING=OFF
cmake --build openms-build --parallel
cmake --install openms-build
```

FASTag needs only `libOpenMS` and `OpenMS_CLI`, so the TOPP tools, GUI, pyOpenMS, docs and tests
stay off. mzPeak support (`OPENMS_ENABLE_MZPEAK=ON`) is required for mzPeak input and output.

**Bruker timsTOF input (`.d`, `.d.zip`)** needs OpenMS's opentims reader: configure OpenMS with
`-DWITH_OPENTIMS=ON` instead of `OFF` (keep `WITH_THERMO_RAW=OFF`). Nothing else changes, and
FASTag needs no option of its own: it reads the setting from the OpenMS it is built against
(OpenMS exports `WITH_OPENTIMS` as a compile definition) and refuses `.d` input with a message
when it is off. With no opentims installed, OpenMS's configure step fetches opentims `v1.2.0b4`
from GitHub (MIT; its SQLite and zstd come from OpenMS and the environment), so that step needs
network access; the Bruker SDK is not used. The cluster build used for the 1.15.2 timsTOF work:

```bash
cmake -S openms-src -B openms-build-tims -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PWD/openms-install-tims" \
  -DCMAKE_PREFIX_PATH="$CONDA_PREFIX" -DOPENMS_ENABLE_MZPEAK=ON -DARROW_USE_STATIC=OFF \
  -DWITH_GUI=OFF -DPYOPENMS=OFF -DENABLE_DOCS=OFF -DHAS_XSERVER=OFF \
  -DWITH_OPENTIMS=ON -DWITH_THERMO_RAW=OFF \
  -DMT_ENABLE_OPENMP=ON -DMT_REQUIRE_OPENMP=ON -DINSTALL_OPENMS_EXAMPLES=OFF -DBUILD_TESTING=OFF
```

`ctest`'s `bruker_cli_test` runs the timsTOF checks on a trimmed real run
(`test/fixtures/bruker/`) when the build reads `.d`, and checks the refusal otherwise. The release
bundles are still built with `WITH_OPENTIMS=OFF`.

### Thermo .raw input (optional, `WITH_THERMO_RAW=ON`)

FASTag reads `.raw` when the OpenMS it builds against has `WITH_THERMO_RAW=ON`; nothing changes
in FASTag's own configure step (it follows OpenMS's `config.h`). That OpenMS build needs:

- a **.NET 8 SDK** at build time (the bridge's managed half, `ThermoWrapperManaged.dll`, is
  built with `dotnet publish`), and a **.NET 8 runtime** wherever FASTag later reads a `.raw`.
  Without root, install both user-level with Microsoft's script and point `DOTNET_ROOT` at it:

  ```bash
  curl -sSL -o dotnet-install.sh https://dot.net/v1/dotnet-install.sh
  bash dotnet-install.sh --channel 8.0 --install-dir "$HOME/opt/dotnet-8"
  export DOTNET_ROOT="$HOME/opt/dotnet-8" PATH="$HOME/opt/dotnet-8:$PATH"
  ```

- **network access** at configure and build time: OpenMS fetches openms-thermo-bridge v1.0.0
  (commit `75849ecf6f600a3e52479823043842e571a774ae`), the bridge downloads Thermo's
  RawFileReader NuGet packages (`ThermoFisher.CommonCore.*` 8.0.37 from
  `thermofisherlsms/RawFileReader` at commit `80963674b5c10e58236da63023ad6fa0264bbb00`), and
  OpenMS downloads that commit's licence into `share/OpenMS/LICENSES/ThermoRawFileReader-License.doc`.

Then, in the configure step above, replace `-DWITH_THERMO_RAW=OFF` by
`-DWITH_THERMO_RAW=ON -DDOTNET_EXECUTABLE="$DOTNET_ROOT/dotnet"`. Thermo's licence (not MIT) and
what shipping it would require are in BOM.md, "Thermo RawFileReader". Verified on Linux x64
(GCC 14, .NET SDK 8.0.428, runtime 8.0.34), also together with `WITH_OPENTIMS=ON`; macOS and Windows builds with it are not yet checked.

- **macOS:** CI builds OpenMS and FASTag for macOS 13.4: `export MACOSX_DEPLOYMENT_TARGET=13.4`
  and add `-DCMAKE_OSX_DEPLOYMENT_TARGET=13.4` to both configure steps. Below 13.4 the build
  fails (`'to_chars' is unavailable`). A build for your own Mac can leave both out.
- **Windows:** add `-DCMAKE_C_COMPILER=cl -DCMAKE_CXX_COMPILER=cl`, use
  `%CONDA_PREFIX%\Library` (forward slashes) as `CMAKE_PREFIX_PATH`, name libxml2 directly
  (`-DLIBXML2_INCLUDE_DIR=<Library>/include/libxml2 -DLIBXML2_LIBRARY=<Library>/lib/libxml2.lib`),
  and turn OpenMS's warnings C4100 and C4189 back into warnings
  (`sed -i -e 's#"/we4100"#"/w14100"#' -e 's#"/we4189"#"/w14189"#' src/openms/CMakeLists.txt`),
  exactly as `windows.yml` does.

## 3. FASTag

```bash
cmake -S . -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PWD/install" \
  -DCMAKE_INSTALL_RPATH_USE_LINK_PATH=ON \
  -DCMAKE_PREFIX_PATH="$PWD/openms-install;$CONDA_PREFIX"
cmake --build build --parallel
cmake --install build
```

- The configure log must contain `FASTag: OpenMP ...`. Without OpenMP the build succeeds but
  is serial and ignores `-threads`; CI fails the build in that case.
- `CMAKE_PREFIX_PATH` separates entries with `;` (quote it).
- `CMAKE_INSTALL_RPATH_USE_LINK_PATH=ON` keeps the paths to `libOpenMS` and the conda libraries
  in the installed binary. Without it, `install/bin/FASTag` stops with
  `libOpenMS_CLI.so: cannot open shared object file` unless `LD_LIBRARY_PATH` (macOS:
  `DYLD_LIBRARY_PATH`) names `openms-install/lib`. `build/FASTag` always runs in place.
- Options: `-DFASTAG_BUILD_TESTS=OFF` and `-DFASTAG_BUILD_BENCH=OFF` skip the tests and the
  synthetic benchmark. On Windows `FASTAG_MIMALLOC` (on by default with MSVC) downloads mimalloc
  2.2.4 at configure time.
- The install puts `bin/FASTag`, `bin/buildtaxdb` and `share/FASTag/` (digest tables, shipped
  proteomes, taxonomy dumps) under the prefix. The taxonomy k-mer index for `-species`
  (`tax_k7.taxdb`) is not built here; it is a separate release asset (see README, Species
  detection).

Running the binary needs the OpenMS data directory:

```bash
export OPENMS_DATA_PATH="$PWD/openms-install/share/OpenMS"
install/bin/FASTag --help | grep Version          # Version: 1.15.0 (OpenMS 3.7.0-...)
```

`build/FASTag`, run from the build tree, does not find the digest tables, which several
reports and the shortlist's protease check need ("No shipped protease models found"): set
`FASTAG_DIGEST_DIR="$PWD/data/digest"` or use the installed binary.

## 4. Tests

```bash
export OPENMS_DATA_PATH="$PWD/openms-install/share/OpenMS"
ctest --test-dir build --output-on-failure        # add -j 16 to run in parallel
```

No test downloads anything. Tests whose tools or data are absent skip themselves (exit code
77, shown as `Skipped`) instead of failing:

| Test | Skips unless |
|---|---|
| `baseline_identity_test` | `FASTAG_BASELINE_BIN` names a FASTag 1.11.0 binary (byte-identity of the legacy outputs) |
| `search_engine_smoke_test` | `FASTAG_SAGE_BIN`, `FASTAG_COMET_BIN` or `FASTAG_MSFRAGGER_JAR` names a search engine |
| `mzpeak_e2e` | `FASTAG_E2E_MZML` and `FASTAG_E2E_MZPEAK` name an mzML and its mzPeak twin |
| `mzpeak_validate` | `mzpeak-validate` is on `PATH` or in `MZPEAK_VALIDATE` (install with `pip install -r test/mzpeak-validator-requirements.txt`, which needs the network) |
| `mzml_to_mgf_test` | the Python in `FASTAG_PYTHON` (default `python3`) has pyteomics |
| Python tests (`readme_options_test`, `census_triage_eval_*`) | `python3` (or `FASTAG_PYTHON`) exists |
| mzPeak tests (`mzpeak_roundtrip`, `mzpeak_stream_test`) | OpenMS was built with mzPeak |
| CLI tests | the binary starts (`OPENMS_DATA_PATH` set) |

CI requires `mzpeak_roundtrip`, `mzpeak_validate` and `mzpeak_stream_test` to pass, not skip.
`readme_options_test` checks that every option `src/FASTagOptions.cpp` registers has a row in
README's command-line table: a new option needs one.

## 5. Desktop app (optional)

Needs Node.js 24 and npm, a stable Rust toolchain (`rustup`), and on Linux the WebKitGTK
development packages (`sudo apt-get install libwebkit2gtk-4.1-dev librsvg2-dev libgtk-3-dev`
on Ubuntu 22.04 or newer).

The app bundles a CLI under `gui/src-tauri/resources/fastag/`, and Tauri refuses to build when
that directory is missing (`resource path 'resources/fastag' doesn't exist`). It is gitignored.

**Development** (`tauri dev`, unbundled): an empty directory is enough, with the app pointed at
your CLI.

```bash
mkdir -p gui/src-tauri/resources/fastag
cd gui && npm ci
FASTAG_BIN="$PWD/../install/bin/FASTag" npm run tauri dev
cd src-tauri && cargo test --lib                  # backend tests; frontend: npm test
```

**Bundled build** (`tauri build`): stage a complete CLI in the layout `resolve_binary()`
(`gui/src-tauri/src/fastag.rs`) expects. The simplest source is the CLI archive of the same
release (`FASTag-<version>-macos-arm64.dmg`, `FASTag-<version>-linux-x64.tar.gz`, ...), whose
`FASTag/` folder CI stages like this:

```bash
D=/path/to/FASTag          # the unpacked CLI folder: FASTag.bin, lib/, share-*/
R=gui/src-tauri/resources/fastag
rm -rf "$R"; mkdir -p "$R/bin" "$R/share/FASTag"
cp "$D/FASTag.bin" "$R/bin/FASTag"
cp -RL "$D/lib" "$R/bin/lib"                       # lib/ beside the binary, not in ../lib
cp -RL "$D/share-OpenMS" "$R/share/OpenMS"
cp -RL "$D/share-FASTag-taxonomy" "$R/share/FASTag/taxonomy"
cp -RL "$D/share-FASTag-digest" "$R/share/FASTag/digest"
cp -RL "$D/share-FASTag-alkylation" "$R/share/FASTag/alkylation"
cp "$D/LICENSE" "$D/THIRD-PARTY-NOTICES.txt" "$R/"
cp -RL "$D/examples" "$R/examples"                 # File > Open Example Data
env -i HOME="$HOME" "$R/bin/FASTag" --help | grep Version   # must print FASTag's version

cd gui && npm ci
# the desktop app's own notices (Rust crates, npm packages, fonts); --platform linux or macos
python3 ../tools/gui_third_party_notices.py --gui . --target "$(rustc -vV | sed -n 's/^host: //p')" \
  --platform linux --out src-tauri/resources/fastag/GUI-THIRD-PARTY-NOTICES.txt
bash ../tools/check_bundle_notices.sh src-tauri/resources/fastag   # notices and example data
npm run tauri build -- --debug        # unsigned; drop --debug for a release build
```

Copy with `-L`: Tauri's resource bundler skips symlinked directories without an error. The
taxonomy index `tax_k7.taxdb` goes into `share/FASTag/taxonomy/` only if the app should run
`-species` without a separate download. Signing and notarization are described in
[doc/SIGNING-macos-gui.md](doc/SIGNING-macos-gui.md); the Windows installer is built only in
`windows.yml`.

## What was verified where

| Step | Where | Result |
|---|---|---|
| 1, 2 (environment, OpenMS) | IBMI node `data` (Ubuntu 24.04, x86-64) | Not re-run for this document: the existing environment from `.github/env/openms.yml` (CMake 4.4.5, Ninja 1.13.2, system GCC 13.3) and an OpenMS 70cebcd144 install built with the flags above were used. CI runs both steps on every cold cache. |
| 3 (configure, build, install) | `data`, 2026-11-18, FASTag 1.15.0 sources | Configure and build pass (build 64 s at 32 jobs); the installed binary runs only with `CMAKE_INSTALL_RPATH_USE_LINK_PATH=ON`, as described. Raising `cmake_minimum_required` from 3.24 to 3.28 leaves `build/FASTag` byte-identical when built at the same path. |
| 4 (ctest) | `data`, 2026-11-18 | 87 tests, 100 % passed, 5 skipped (`baseline_identity_test`, `search_engine_smoke_test`, `mzpeak_e2e`, `mzpeak_validate`, `mzml_to_mgf_test`), 155 s at `-j 16` |
| 5 (desktop app, bundled) | MacBook, Apple silicon, Node 26, Rust 1.96, 2026-11-18 | Staging from the Homebrew `fastag-cli` 1.15.0 folder and `npx tauri build --debug --no-bundle` pass |
| Windows | CI only (`windows.yml`) | not checked by hand |
