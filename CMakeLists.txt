cmake_minimum_required(VERSION 3.24 FATAL_ERROR)
project(FASTag VERSION 1.11.0 LANGUAGES CXX)
# The GUI carries that version in four more files; a bump that misses one
# fails here rather than shipping (cmake/version-guard.cmake says why).
include(cmake/version-guard.cmake)

# OpenMS 3.7 requires C++23 of every target that links it.
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(APPLE AND NOT DEFINED CURL_LIBRARY)
  # Resolve curl to the macOS SDK, as OpenMS itself does.
  #
  # OpenMSConfig.cmake pulls in CURL transitively, and CMake searches frameworks
  # first on macOS, so a third-party /Library/Frameworks/libcurl.framework
  # shadows the SDK libcurl that libOpenMS.dylib actually links. The result is a
  # binary carrying an @rpath reference to a framework on no rpath, which dies at
  # startup. Note the SDK ships a .tbd stub, not a .dylib; pointing at
  # /usr/lib/libcurl.4.dylib instead leaves CURL::libcurl undefined.
  execute_process(COMMAND xcrun --show-sdk-path
                  OUTPUT_VARIABLE _sdk OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
  if(_sdk AND EXISTS "${_sdk}/usr/lib/libcurl.tbd")
    set(CURL_LIBRARY "${_sdk}/usr/lib/libcurl.tbd" CACHE FILEPATH "curl (macOS SDK)")
    set(CURL_INCLUDE_DIR "${_sdk}/usr/include" CACHE PATH "curl headers (macOS SDK)")
  endif()
endif()

# Version is checked after the fact, not in find_package.
#
# OpenMS ships a SameMinorVersion config-version file, so find_package(OpenMS 3.7)
# would reject 3.8 outright -- a MINIMUM version cannot be expressed through
# find_package at all. Ask for any OpenMS and enforce the floor ourselves.
# 3.7 (develop) is the first with MzPeakFile and the OpenMS_CLI library.
find_package(OpenMS REQUIRED)
if(OpenMS_VERSION VERSION_LESS 3.7 OR NOT TARGET OpenMS_CLI)
  message(FATAL_ERROR "FASTag needs OpenMS >= 3.7 with OpenMS_CLI (found ${OpenMS_VERSION}).")
endif()
message(STATUS "FASTag: using OpenMS ${OpenMS_VERSION} (${OpenMS_DIR})")

# OpenMP, declared rather than inherited.
#
# The parallel loop is the tool's central performance claim, and it was working
# only because OpenMS happened to propagate the flags transitively. A clean build
# against an OpenMS that did not would compile silently -- the #pragmas become
# no-ops and the omp_* fallback stubs in FASTag.cpp return 1 -- producing a
# correct but SERIAL binary that still claims to scale. Ask explicitly, and say
# so when it is missing.
find_package(OpenMP)
if(OpenMP_CXX_FOUND)
  message(STATUS "FASTag: OpenMP ${OpenMP_CXX_VERSION} -- parallel over spectra")
else()
  message(WARNING "FASTag: no OpenMP. The build is correct but SERIAL; -threads "
                  "will have no effect and README.md's performance figures do "
                  "not apply.")
endif()

# No fused multiply-add contraction in any FASTag target, so every platform
# evaluates what the source says and all produce the same tags. Clang contracts
# a * b + c by default and GCC does whenever the target has FMA (arm64 always,
# x86-64 with -march=haswell or later); MSVC x64 does not. One rounding step is
# enough to flip a tolerance test: on PXD063151 scan=1201892,
# `precursor_mz * charge - charge * PROTON` came out 1 ulp lower on Apple
# silicon, a complement pair exactly 0.02 Da apart then passed the complement
# test, and every E-value of that spectrum moved 5-9x. It also keeps the
# deisotoper port bit-identical to OpenMS (deisotoper_test) and the digest
# reports equal to prose-auto's Python arithmetic. Before any target, so all
# of them get it.
if(NOT MSVC)
  add_compile_options(-ffp-contract=off)
endif()

# fastag_core sources. 1.12 clusters add their sources only to their own
# anchored list, in the fixed order E, A, D, F (E data types and acquisition,
# A identification and search hand-off, D organism and run chemistry, F quality
# control).
set(FASTAG_CORE_SOURCES src/FASTagger.cpp src/AveragineDeisotoper.cpp src/Digest.cpp src/DigestReport.cpp src/FastaFilter.cpp src/ProteomeIndex.cpp src/ReconIds.cpp src/TagRecon.cpp src/TaxDeconv.cpp src/TaxIndex.cpp src/TaxStats.cpp)
# ---- 1.12 E: core sources ----
set(FASTAG_CORE_SOURCES_E src/Acquisition.cpp)
# ---- 1.12 A: core sources ----
set(FASTAG_CORE_SOURCES_A)
# ---- 1.12 D: core sources ----
set(FASTAG_CORE_SOURCES_D src/SpeciesLookup.cpp)
# ---- 1.12 F: core sources ----
set(FASTAG_CORE_SOURCES_F src/OutputGuard.cpp)
add_library(fastag_core STATIC ${FASTAG_CORE_SOURCES}
            ${FASTAG_CORE_SOURCES_E} ${FASTAG_CORE_SOURCES_A} ${FASTAG_CORE_SOURCES_D} ${FASTAG_CORE_SOURCES_F})
target_include_directories(fastag_core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>)
target_link_libraries(fastag_core PUBLIC OpenMS)
# Boost.Math (header-only) for the scoring tails. Named here rather than
# taken through OpenMS's target, which carries no Boost include path on
# Windows.
find_package(Boost 1.81 CONFIG REQUIRED)
target_link_libraries(fastag_core PRIVATE Boost::headers)
if(OpenMP_CXX_FOUND)
  # ProteomeIndex sorts its suffix-array buckets in parallel.
  target_link_libraries(fastag_core PRIVATE OpenMP::OpenMP_CXX)
endif()


# mzPeak in and out goes through OpenMS's MzPeakFile; an OpenMS built without
# it (OPENMS_ENABLE_MZPEAK=OFF) gives a FASTag that refuses .mzpeak.
# zlib for the direct mzML peak decoder (src/MzMLDirectDecoder.cpp); OpenMS
# links the same library.
find_package(ZLIB REQUIRED)

add_executable(FASTag src/FASTag.cpp src/IndexedMzMLReader.cpp src/MzMLDirectDecoder.cpp src/MgfReader.cpp src/MzPeakStream.cpp
               src/AcquisitionProbe.cpp)

# mimalloc on Windows, with redirection of the C runtime heap.
#
# The mzML read decodes each spectrum through OpenMS's MzMLSpectrumDecoder,
# which builds and frees a libxml2 document tree: about 610 small heap
# allocations per spectrum, all through UCRT malloc into the one Windows
# process heap. That heap's cost grows when several cores allocate at once
# (read time x1.12 from 1 to 2 cores on a GitHub runner, x2.0 from 1 to 12
# threads on a 12-core Ryzen); with mimalloc the growth is gone (x1.01) and a
# single thread reads 23-25% faster. The segment heap was slower. Linux and
# macOS allocators do not show the effect, so this is MSVC only. (These
# numbers predate the direct peak decoder of 1.11, which skips the libxml2
# tree for the common array layouts; spectra it declines still take the
# OpenMS path, and tagging allocates per spectrum too.)
#
# It has to be the REDIRECT variant: most of those allocations are made in
# libxml2.dll and OpenMS.dll, not in FASTag.exe, so linking mimalloc's
# malloc into the executable alone changes nothing (measured: the mimalloc
# binary with redirection switched off behaves like the plain heap).
# mimalloc.dll, loaded with the executable, has mimalloc-redirect.dll patch
# ucrtbase's malloc/free for every module of the process. Requirements
# (mimalloc's bin/readme.md): the dynamic CRT (/MD, CMake's default), the
# import of mimalloc.dll early in the executable's import table (it is the
# first library linked, and /INCLUDE:mi_version keeps the import), and both
# DLLs next to the executable -- copied there after every build, shipped
# there by .github/workflows/windows.yml. test/mimalloc_redirect_test.sh
# asserts the redirection in the build tree, the workflow in the bundle.
#
# Pinned source tarball and hash; mimalloc-redirect.dll is the prebuilt
# binary mimalloc ships in bin/ (MIT, as the rest of mimalloc). Allocation
# order does not change any result: every output is byte-identical with and
# without it (the ctest checks one run each way, threads_test and the rest
# run the redirected binary). Off: -DFASTAG_MIMALLOC=OFF at configure time,
# or MIMALLOC_DISABLE_REDIRECT=1 in the environment of a shipped binary.
include(CMakeDependentOption)
cmake_dependent_option(FASTAG_MIMALLOC
  "Windows: link mimalloc and redirect the C runtime heap of all modules to it" ON "MSVC" OFF)
if(FASTAG_MIMALLOC)
  include(FetchContent)
  set(MI_BUILD_SHARED ON)
  set(MI_BUILD_STATIC OFF)
  set(MI_BUILD_OBJECT OFF)
  set(MI_BUILD_TESTS OFF)
  set(MI_OVERRIDE ON)
  set(MI_WIN_REDIRECT ON)
  set(_fastag_mi_extra)
  if(CMAKE_VERSION VERSION_GREATER_EQUAL 3.28)
    # Keeps mimalloc's headers, static targets and CMake package out of
    # `cmake --install`; the two DLLs FASTag needs are installed below.
    list(APPEND _fastag_mi_extra EXCLUDE_FROM_ALL)
  endif()
  FetchContent_Declare(mimalloc
    URL https://github.com/microsoft/mimalloc/archive/refs/tags/v2.2.4.tar.gz
    URL_HASH SHA256=754a98de5e2912fddbeaf24830f982b4540992f1bab4a0a8796ee118e0752bda
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    ${_fastag_mi_extra})
  FetchContent_MakeAvailable(mimalloc)
  if(CMAKE_CXX_COMPILER_ARCHITECTURE_ID MATCHES "ARM64")
    set(_fastag_mi_redirect "${mimalloc_SOURCE_DIR}/bin/mimalloc-redirect-arm64.dll")
  elseif(CMAKE_SIZEOF_VOID_P EQUAL 4)
    set(_fastag_mi_redirect "${mimalloc_SOURCE_DIR}/bin/mimalloc-redirect32.dll")
  else()
    set(_fastag_mi_redirect "${mimalloc_SOURCE_DIR}/bin/mimalloc-redirect.dll")
  endif()
  if(NOT EXISTS "${_fastag_mi_redirect}")
    message(FATAL_ERROR "FASTag: ${_fastag_mi_redirect} missing from the mimalloc source")
  endif()
  # First in the link line, so first among the imported DLLs.
  target_link_libraries(FASTag PRIVATE mimalloc)
  target_link_options(FASTag PRIVATE "/INCLUDE:mi_version")
  # FASTAG_TIMING reports mi_version() and mi_is_redirected() (src/FASTag.cpp).
  target_compile_definitions(FASTag PRIVATE FASTAG_MIMALLOC=1)
  add_custom_command(TARGET FASTag POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "$<TARGET_FILE:mimalloc>" "${_fastag_mi_redirect}" "$<TARGET_FILE_DIR:FASTag>"
    COMMENT "Copy mimalloc.dll and its redirect DLL next to FASTag.exe")
  install(FILES "$<TARGET_FILE:mimalloc>" "${_fastag_mi_redirect}" DESTINATION bin)
  # The licence text the Windows bundle's THIRD-PARTY-NOTICES.txt carries.
  configure_file("${mimalloc_SOURCE_DIR}/LICENSE" "${CMAKE_CURRENT_BINARY_DIR}/mimalloc-LICENSE.txt" COPYONLY)
  message(STATUS "FASTag: mimalloc 2.2.4 with CRT redirection (FASTAG_MIMALLOC=ON)")
endif()

target_link_libraries(FASTag PRIVATE fastag_core OpenMS_CLI ZLIB::ZLIB)
# So --help reports FASTag's version instead of the OpenMS it was built against.
target_compile_definitions(FASTag PRIVATE FASTAG_VERSION="${PROJECT_VERSION}")
if(WIN32)
  # The version resource SignPath checks before it signs (src/FASTag.rc.in).
  configure_file(src/FASTag.rc.in FASTag.rc @ONLY)
  target_sources(FASTag PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/FASTag.rc")
  # UTF-8 as the process code page: the MSVC CRT otherwise hands main() an
  # ANSI-code-page argv, so the GUI's UTF-16 paths lost every character
  # outside cp1252 ('?') and the rest became bytes OpenMS reads as UTF-8.
  if(MSVC)
    target_sources(FASTag PRIVATE src/FASTag.manifest)
  endif()
endif()
if(OpenMP_CXX_FOUND)
  target_link_libraries(FASTag PRIVATE OpenMP::OpenMP_CXX)
endif()
install(TARGETS FASTag RUNTIME DESTINATION bin)

# The taxonomy -species resolves by default, at <bin>/../share/FASTag/taxonomy.
#
# Only the pruned NCBI dumps (~30 KB) are installed here -- correct for a
# SOURCE build, where downloading 430 MB behind cmake --install would be rude.
# Release tarballs are different: CI embeds the full pinned index into every
# one at tag time (see the "Embed taxonomy index" steps in the workflows), and
# the same tarball ships standalone as FASTag-taxonomy-k7.tar.gz for source
# builders. FASTag names the directory it searched when the
# index is absent, so that is a clear error, never a silent empty report.
# reference-set.tsv is the manifest; it is installed too so a user can rebuild.
install(FILES "${CMAKE_CURRENT_SOURCE_DIR}/data/taxonomy/nodes.dmp"
              "${CMAKE_CURRENT_SOURCE_DIR}/data/taxonomy/names.dmp"
              "${CMAKE_CURRENT_SOURCE_DIR}/data/taxonomy/README.md"
              "${CMAKE_CURRENT_SOURCE_DIR}/data/taxonomy/reference-set.tsv"
        DESTINATION share/FASTag/taxonomy)

add_executable(buildtaxdb src/buildtaxdb.cpp)
target_link_libraries(buildtaxdb PRIVATE fastag_core)
# The -digest_out protease models (cleavage rules over the human reference
# proteome composition) and the -massgap_out modification list, found at
# <bin>/../share/FASTag/digest (flat release layout: share-FASTag-digest).
install(FILES "${CMAKE_CURRENT_SOURCE_DIR}/data/digest/digest_models.tsv"
              "${CMAKE_CURRENT_SOURCE_DIR}/data/digest/massgap_mods.tsv"
              "${CMAKE_CURRENT_SOURCE_DIR}/data/digest/README.md"
        DESTINATION share/FASTag/digest)

install(TARGETS buildtaxdb RUNTIME DESTINATION bin)

option(FASTAG_BUILD_BENCH "Build the synthetic benchmark" ON)
if(FASTAG_BUILD_BENCH)
  add_executable(benchmark bench/benchmark.cpp)
  target_link_libraries(benchmark PRIVATE fastag_core)
endif()

option(FASTAG_BUILD_TESTS "Build tests" ON)
if(FASTAG_BUILD_TESTS)
  enable_testing()
  # Unit tests: test/<name>.cpp linked against fastag_core. 1.12 clusters add
  # their tests only to their own anchored list.
  set(FASTAG_UNIT_TESTS ranksum_test fastag_test fasta_filter_test tagrecon_test tagfdr_test proteome_index_test glyco_test taxindex_test taxstats_test taxdeconv_test species_evidence_test sampler_test proforma_test numformat_test peakgrid_test formats_test digest_test)
  # ---- 1.12 E: unit tests ----
  set(FASTAG_UNIT_TESTS_E cli_param_test)
  # ---- 1.12 A: unit tests ----
  set(FASTAG_UNIT_TESTS_A)
  # ---- 1.12 D: unit tests ----
  set(FASTAG_UNIT_TESTS_D)
  # ---- 1.12 F: unit tests ----
  set(FASTAG_UNIT_TESTS_F output_guard_test)
  foreach(t ${FASTAG_UNIT_TESTS} ${FASTAG_UNIT_TESTS_E} ${FASTAG_UNIT_TESTS_A} ${FASTAG_UNIT_TESTS_D} ${FASTAG_UNIT_TESTS_F})
    add_executable(${t} test/${t}.cpp)
    target_link_libraries(${t} PRIVATE fastag_core)
    add_test(NAME ${t} COMMAND ${t})
  endforeach()

  # 1.12 P4: the shared run report section (src/RunMeta.h) is frozen here.
  add_executable(runmeta_test test/runmeta_test.cpp)
  target_link_libraries(runmeta_test PRIVATE fastag_core)
  add_test(NAME runmeta_test COMMAND runmeta_test WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

  # Integration: tool description export against the real binary. Compares the
  # CTD's parameter set against the tool's own -write_ini output, and guards
  # --help and -write_ini against the ToolHandler registration leaking into
  # them. Skips (77) without python3 or when the binary cannot start.
  add_test(NAME write_ctd_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/write_ctd_test.sh $<TARGET_FILE:FASTag>)
  set_tests_properties(write_ctd_test PROPERTIES SKIP_RETURN_CODE 77)

  # Integration: the -stream protocol against the real binary (skips itself
  # when the OpenMS share data is unreachable).
  add_test(NAME stream_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/stream_test.sh $<TARGET_FILE:FASTag>)
  set_tests_properties(stream_test PROPERTIES SKIP_RETURN_CODE 77)

  # Integration: -tag_lengths equals the single-length runs' rows per spectrum
  # with a tag several lengths report kept from one length only, in file mode
  # on the vendored fixture (also with -fasta and -recon_out) and in -stream.
  add_test(NAME multilength_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/multilength_test.sh $<TARGET_FILE:FASTag>
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.fasta)
  set_tests_properties(multilength_test PROPERTIES SKIP_RETURN_CODE 77)
  # The same check with mawk as `awk` (Debian/Ubuntu's default awk where gawk
  # is not installed), whose evaluation order differs from gawk's and BSD awk's
  # where POSIX leaves it open; the test's awk once read every recon row as
  # mixed under mawk only.
  find_program(FASTAG_MAWK mawk)
  if(FASTAG_MAWK AND NOT WIN32)
    set(_mawk_dir ${CMAKE_CURRENT_BINARY_DIR}/test-mawk-bin)
    file(MAKE_DIRECTORY ${_mawk_dir})
    file(CREATE_LINK ${FASTAG_MAWK} ${_mawk_dir}/awk SYMBOLIC)
    add_test(NAME multilength_test_mawk
             COMMAND ${CMAKE_COMMAND} -E env "PATH=${_mawk_dir}:$ENV{PATH}"
                     bash ${CMAKE_CURRENT_SOURCE_DIR}/test/multilength_test.sh $<TARGET_FILE:FASTag>
                     ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML
                     ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.fasta)
    set_tests_properties(multilength_test_mawk PROPERTIES SKIP_RETURN_CODE 77)
  endif()

  # Integration: refused parameters and output-path collisions, NaN precursors
  # in -stream, entrapment inside the target, native IDs carrying a tab.
  add_test(NAME cli_guards_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/cli_guards_test.sh $<TARGET_FILE:FASTag>
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.fasta)
  set_tests_properties(cli_guards_test PROPERTIES SKIP_RETURN_CODE 77)

  # Integration: every output (tags, recon, delta, digest, label, massgap,
  # glyco, idXML) byte-identical at 1, 3 and 8 threads on the mzML path.
  add_test(NAME threads_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/threads_test.sh $<TARGET_FILE:FASTag>
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.fasta
                   ${CMAKE_CURRENT_SOURCE_DIR}/data/digest)
  set_tests_properties(threads_test PROPERTIES SKIP_RETURN_CODE 77)

  # Windows with FASTAG_MIMALLOC: the redirection is active for the whole
  # process, MIMALLOC_DISABLE_REDIRECT=1 switches it off, and the tags are
  # the same either way.
  if(FASTAG_MIMALLOC)
    add_test(NAME mimalloc_redirect_test
             COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/mimalloc_redirect_test.sh $<TARGET_FILE:FASTag>
                     ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML)
  endif()

  # The shipped digest data, for digest_test and digest_cli_test.
  target_compile_definitions(digest_test PRIVATE
                             FASTAG_DIGEST_DATA="${CMAKE_CURRENT_SOURCE_DIR}/data/digest")

  # Integration: -digest_out, -label_out and -massgap_out on the vendored
  # fixture: the existing outputs unchanged, the reports' structure, a
  # synthetic -digest_models table, FASTAG_FULL_PRECISION and the refusals.
  add_test(NAME digest_cli_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/digest_cli_test.sh $<TARGET_FILE:FASTag>
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.fasta
                   ${CMAKE_CURRENT_SOURCE_DIR}/data/digest)
  set_tests_properties(digest_cli_test PROPERTIES SKIP_RETURN_CODE 77)

  # Integration: -recon_id_out in mzid, idXML and mzTab holds what -recon_out
  # holds; .mzid is empty (0 bytes) without placements; with
  # FASTAG_BASELINE_BIN all of it equals the 1.11.0 binary's.
  add_test(NAME recon_ids_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/recon_ids_test.sh $<TARGET_FILE:FASTag>
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.fasta)
  set_tests_properties(recon_ids_test PROPERTIES SKIP_RETURN_CODE 77)

  # Baseline identity: every legacy output of this build equals the 1.11.0
  # binary's (78390cd) on the fixtures, after date/version masking. Needs
  # FASTAG_BASELINE_BIN (on node data: the 1.11.0 install); SKIPs without it.
  # buildtaxdb is compared too when FASTAG_BASELINE_BUILDTAXDB is set. With
  # FASTAG_BASELINE_REQUIRED=1 nothing may skip. Byte-identical branches are
  # gated by tools/gate_job.sh (gate.sh, tools/baseline_identity_gate.sh on the
  # PXD inputs and, with GATE_JOB_BUILD, this test with the baseline required).
  add_test(NAME baseline_identity_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/baseline_identity_test.sh $<TARGET_FILE:FASTag>
                   $<TARGET_FILE:buildtaxdb>
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.fasta
                   ${CMAKE_CURRENT_SOURCE_DIR}/data/digest
                   ${CMAKE_CURRENT_SOURCE_DIR}/data/taxonomy)
  set_tests_properties(baseline_identity_test PROPERTIES SKIP_RETURN_CODE 77)
  # The harness's interface rule: new options may add whole option blocks to
  # --help, --helphelp, the CTD and the INI; nothing existing may change.
  add_test(NAME baseline_iface_added_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/baseline_iface_added_test.sh
                   ${CMAKE_CURRENT_SOURCE_DIR}/tools/baseline_iface_added.py)
  set_tests_properties(baseline_iface_added_test PROPERTIES SKIP_RETURN_CODE 77)

  # 1.12 CLI tests against the real binary, one anchored block per cluster in
  # the order E, A, D, F. A cluster adds its add_test calls only inside its
  # own block.
  # ---- 1.12 E: CLI tests ----
  # P3: the -out_spectra compatibility shim keeps the 1.11 parameter list.
  add_test(NAME out_spectra_params_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/out_spectra_params_test.sh $<TARGET_FILE:FASTag>
                   $<TARGET_FILE:cli_param_test>
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML)
  set_tests_properties(out_spectra_params_test PROPERTIES SKIP_RETURN_CODE 77)
  # #7: the raw-DIA classifier on the 21 synthetic cases of the plan, the
  # probe helpers, both mzML readers on the fixtures, the mzPeak probe and
  # the messages. Built with the readers it probes through.
  add_executable(acquisition_test test/acquisition_test.cpp src/AcquisitionProbe.cpp src/IndexedMzMLReader.cpp
                 src/MzMLDirectDecoder.cpp src/MgfReader.cpp src/MzPeakStream.cpp)
  target_link_libraries(acquisition_test PRIVATE fastag_core ZLIB::ZLIB)
  if(OpenMP_CXX_FOUND)
    target_link_libraries(acquisition_test PRIVATE OpenMP::OpenMP_CXX)
  endif()
  target_compile_definitions(acquisition_test PRIVATE
                             FASTAG_TEST_DATA="${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures")
  add_test(NAME acquisition_test COMMAND acquisition_test ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures)
  # #7: raw DIA refused (exit 11, outputs untouched) on every reader, warn
  # equal to 1.11.0, pseudo-DDA and DDA-like inputs equal to off.
  add_test(NAME acquisition_cli_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/acquisition_cli_test.sh $<TARGET_FILE:FASTag>
                   $<TARGET_FILE:acquisition_test>
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.fasta
                   ${CMAKE_CURRENT_SOURCE_DIR}/data/digest)
  set_tests_properties(acquisition_cli_test PROPERTIES SKIP_RETURN_CODE 77)
  # ---- 1.12 A: CLI tests ----
  # ---- 1.12 D: CLI tests ----
  # ---- 1.12 F: CLI tests ----

  # mzPeak reader vs its own mzML twin. Needs a matched pair of real files, so
  # it SKIPs unless FASTAG_E2E_MZML and FASTAG_E2E_MZPEAK point at one.
  add_test(NAME mzpeak_e2e
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/mzpeak_e2e.sh $<TARGET_FILE:FASTag>)
  set_tests_properties(mzpeak_e2e PROPERTIES SKIP_RETURN_CODE 77)

  # mzPeak in and out on the vendored fixture, no external data: the tool
  # writes an archive from the mzML, and the tags from that archive must be
  # BYTE-IDENTICAL to the tags from the mzML, at 1 and 4 threads, across an
  # archive -> archive re-write and with subsampling. The archives are kept
  # under mzpeak-roundtrip/ for the validator below. SKIPs only when the
  # build has no mzPeak support.
  add_test(NAME mzpeak_roundtrip
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/mzpeak_roundtrip.sh $<TARGET_FILE:FASTag>
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML
                   ${CMAKE_CURRENT_BINARY_DIR}/mzpeak-roundtrip)
  set_tests_properties(mzpeak_roundtrip PROPERTIES SKIP_RETURN_CODE 77
                       FIXTURES_SETUP mzpeak_roundtrip_archives)

  # Every archive the round trip wrote, through mzPeakValidator in full mode.
  # A FIXTURE, not DEPENDS: DEPENDS only orders, and a failed producer would
  # still let this run on absent or stale archives. SKIPs when the validator
  # is not resolvable (MZPEAK_VALIDATE, or mzpeak-validate on PATH; see
  # test/mzpeak-validator-requirements.txt) or when the round trip skipped.
  add_test(NAME mzpeak_validate
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/mzpeak_validate.sh
                   ${CMAKE_CURRENT_BINARY_DIR}/mzpeak-roundtrip/validator
                   ${CMAKE_CURRENT_BINARY_DIR}/mzpeak-roundtrip)
  set_tests_properties(mzpeak_validate PROPERTIES SKIP_RETURN_CODE 77
                       FIXTURES_REQUIRED mzpeak_roundtrip_archives)

  # The mzPeak reader, spectrum by spectrum: what MzPeakStream hands out
  # (with a mask, from several threads, centroiding profile MS2) against
  # MzPeakFile::load() of the same archive, written from the fixture.
  add_executable(mzpeak_stream_test test/mzpeak_stream_test.cpp src/MzPeakStream.cpp)
  target_link_libraries(mzpeak_stream_test PRIVATE fastag_core)
  if(OpenMP_CXX_FOUND)
    target_link_libraries(mzpeak_stream_test PRIVATE OpenMP::OpenMP_CXX)
  endif()
  target_compile_definitions(mzpeak_stream_test PRIVATE
                             FASTAG_TEST_DATA="${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures")
  add_test(NAME mzpeak_stream_test COMMAND mzpeak_stream_test)
  set_tests_properties(mzpeak_stream_test PROPERTIES SKIP_RETURN_CODE 77)

  # The mzML fast path against OpenMS itself: the tag TSV carries neither RT
  # nor precursor charge, so only a direct field-by-field comparison proves
  # the reader's scrape right.
  add_executable(indexed_mzml_test test/indexed_mzml_test.cpp src/IndexedMzMLReader.cpp src/MzMLDirectDecoder.cpp)
  target_link_libraries(indexed_mzml_test PRIVATE fastag_core ZLIB::ZLIB)
  target_include_directories(indexed_mzml_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
  target_compile_definitions(indexed_mzml_test PRIVATE
                             FASTAG_TEST_DATA="${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures")
  # The offset scan is parallel in the tool; test it the same way.
  if(OpenMP_CXX_FOUND)
    target_link_libraries(indexed_mzml_test PRIVATE OpenMP::OpenMP_CXX)
  endif()
  # The fixture first, then every vendored mzML that OpenMS did not write
  # (diaTracer and ddaPASEF layouts, where present), compared spectrum by
  # spectrum between the direct decoder and OpenMS's.
  set(_fastag_direct_fixtures ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML)
  foreach(_f diatracer_like.mzML ddapasef_empty.mzML)
    if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/${_f})
      list(APPEND _fastag_direct_fixtures ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/${_f})
    endif()
  endforeach()
  add_test(NAME indexed_mzml_test COMMAND indexed_mzml_test ${_fastag_direct_fixtures})
  set_tests_properties(indexed_mzml_test PROPERTIES SKIP_RETURN_CODE 77)

  # The MGF reader against OpenMS's MascotGenericFile, block by block and bit
  # for bit on the fixture, plus the block scan at every piece size, the field
  # cases where FASTag differs from OpenMS on purpose, the errors, and reading
  # from several threads.
  add_executable(mgf_reader_test test/mgf_reader_test.cpp src/MgfReader.cpp)
  target_link_libraries(mgf_reader_test PRIVATE fastag_core)
  target_include_directories(mgf_reader_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
  target_compile_definitions(mgf_reader_test PRIVATE
                             FASTAG_TEST_DATA="${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures")
  if(OpenMP_CXX_FOUND)
    target_link_libraries(mgf_reader_test PRIVATE OpenMP::OpenMP_CXX)
  endif()
  add_test(NAME mgf_reader_test COMMAND mgf_reader_test)

  # Integration: MGF input against the real binary. The fixture MGF (written
  # from the fixture mzML by tools/mzml_to_mgf.py) gives the mzML's TSVs once
  # the spectrum id is cut, at any thread count; -out_spectra, -usi_collection,
  # -recon_id_out, -digest_out, charge-less input, subsampling and the errors.
  add_test(NAME mgf_cli_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/mgf_cli_test.sh $<TARGET_FILE:FASTag>
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mzML
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.mgf
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/Ecoli_MS2_small.fasta
                   ${CMAKE_CURRENT_SOURCE_DIR}/data/digest)
  set_tests_properties(mgf_cli_test PROPERTIES SKIP_RETURN_CODE 77)

  # tools/mzml_to_mgf.py on the fixture mzML and on diaTracer- and
  # ddaPASEF-shaped fixtures (empty MS2), and FASTag on what it writes: the
  # mzML's tags. Skips (77) without a Python that has pyteomics
  # (FASTAG_PYTHON names one).
  add_test(NAME mzml_to_mgf_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/mzml_to_mgf_test.sh $<TARGET_FILE:FASTag>
                   ${CMAKE_CURRENT_SOURCE_DIR}/tools/mzml_to_mgf.py
                   ${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures)
  set_tests_properties(mzml_to_mgf_test PROPERTIES SKIP_RETURN_CODE 77)

  # The ported deisotoper against OpenMS's own, peak for peak and bit for bit,
  # on synthetic edge cases. Given an mzPeak archive as its argument it also
  # compares every spectrum of that run (not part of ctest: needs real data).
  add_executable(deisotoper_test test/deisotoper_test.cpp src/MzPeakStream.cpp)
  target_link_libraries(deisotoper_test PRIVATE fastag_core)
  if(OpenMP_CXX_FOUND)
    target_link_libraries(deisotoper_test PRIVATE OpenMP::OpenMP_CXX)
  endif()
  target_compile_definitions(deisotoper_test PRIVATE
                             FASTAG_TEST_DATA="${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures")
  add_test(NAME deisotoper_test COMMAND deisotoper_test)

  # One short run per acquisition class, gaps and deisotoping ON.
  #
  # These are smoke tests, not quality gates -- the benchmark exits non-zero only
  # if a profile produces no tags at all. That is deliberately weak, and it is
  # still the check that would have caught `-deisotope` throwing an uncaught
  # exception at the 0.3 Da tolerance the iontrap profile uses. Every profile
  # other than iontrap passed that day.
  if(FASTAG_BUILD_BENCH)
    foreach(prof astral ddapasef iontrap)
      add_test(NAME bench_${prof}
               COMMAND benchmark synth ${prof} 150 4 1 2 100)
    endforeach()
  endif()
endif()
