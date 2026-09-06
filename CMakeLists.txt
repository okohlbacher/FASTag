cmake_minimum_required(VERSION 3.21 FATAL_ERROR)
project(FASTag VERSION 1.2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
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
# OpenMS ships a SameMinorVersion config-version file, so find_package(OpenMS 3.5)
# rejects 3.6 outright -- a MINIMUM version cannot be expressed through
# find_package at all. Ask for any OpenMS and enforce the floor ourselves.
find_package(OpenMS REQUIRED)
if(OpenMS_VERSION VERSION_LESS 3.5)
  message(FATAL_ERROR "FASTag needs OpenMS >= 3.5 (found ${OpenMS_VERSION}).")
endif()
message(STATUS "FASTag: using OpenMS ${OpenMS_VERSION} (${OpenMS_DIR})")

# Report at configure time which reader path this OpenMS will allow.
#
# Stock OpenMS parses every spectrum's metadata serially in openFile() before
# tagging starts -- ~55 s of a 60 s run on a 5 GB file, and the reason wall time
# stops improving past 16 threads. FASTag skips that pass when the OpenMS it
# links can report MS level and precursor from the spectrum block itself, which
# needs a patch to MzMLSpectrumDecoder (see doc/OPENMS-FAST-READER.md).
#
# FASTag detects this at RUNTIME too and falls back with a warning, so an
# unpatched OpenMS is correct, merely slow. This check exists so that is known
# when the build is configured rather than discovered from a log much later.
set(_fastag_fast_reader OFF)
get_target_property(_openms_inc OpenMS INTERFACE_INCLUDE_DIRECTORIES)
if(_openms_inc)
  foreach(_d IN LISTS _openms_inc)
    string(GENEX_STRIP "${_d}" _d)
    if(_d AND EXISTS "${_d}/OpenMS/FORMAT/HANDLERS/MzMLSpectrumDecoder.h")
      file(READ "${_d}/OpenMS/FORMAT/HANDLERS/MzMLSpectrumDecoder.h" _hdr)
      string(FIND "${_hdr}" "handleSpectrumMetadata_" _found)
      if(NOT _found EQUAL -1)
        set(_fastag_fast_reader ON)
      endif()
      break()
    endif()
  endforeach()
endif()

if(_fastag_fast_reader)
  message(STATUS "FASTag: fast reader available -- this OpenMS reports "
                 "per-spectrum metadata")
else()
  message(STATUS "FASTag: fast reader NOT available -- this OpenMS parses all "
                 "metadata up front. Correct, but expect roughly a minute of "
                 "extra single-threaded startup per large file, and no scaling "
                 "past ~16 threads. See doc/OPENMS-FAST-READER.md.")
endif()

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

add_library(fastag_core STATIC src/FASTagger.cpp src/FastaFilter.cpp src/ProteomeIndex.cpp src/TagRecon.cpp src/TaxIndex.cpp src/TaxStats.cpp)
target_include_directories(fastag_core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>)
target_link_libraries(fastag_core PUBLIC OpenMS)

# mzPeak, in and out, through the external library
# (github.com/okohlbacher/mzpeak-openms).
#
# This is the WHOLE of FASTag's mzPeak support: -in reads through it and
# -out_spectra writes through it. OpenMS's own MzPeakFile is not used -- it
# implements the pre-0.7.0 layout and read every current archive as zero
# spectra, and its store() aborted on spectra that had come through this
# reader -- so nothing here depends on the OpenMS feature branch that carries
# it, and a stock OpenMS >= 3.5 is enough. Optional: without the library the
# tool builds and refuses .mzpeak with a message saying so. Point
# MZPEAK_LIB_DIR at a `meson install` prefix.
set(MZPEAK_LIB_DIR "" CACHE PATH "Prefix of an installed mzpeak-openms library")
# Headers come from the SOURCE tree, not from `meson install`: the library's
# install_headers() list flattens the nested paths (mzpeak/data/array_index.h
# lands as mzpeak/array_index.h) while the headers still include the nested
# spelling, so an installed-only header set does not compile. Reported
# upstream; until it is fixed, point MZPEAK_SOURCE_DIR at a checkout.
set(MZPEAK_SOURCE_DIR "" CACHE PATH "Checkout of mzpeak-openms (for headers)")
find_path(MZPEAK_INCLUDE_DIR mzpeak.h HINTS ${MZPEAK_SOURCE_DIR}/include)
# The literal names are for MSVC, where meson emits libmzpeak.a (the library
# is static-only on Windows: it carries no dllexport annotations) and CMake
# would otherwise look for mzpeak.lib alone.
find_library(MZPEAK_LIBRARY NAMES mzpeak libmzpeak.a HINTS ${MZPEAK_LIB_DIR}/lib)
find_library(MZPEAK_NUMPRESS_LIBRARY NAMES numpress libnumpress.a HINTS ${MZPEAK_LIB_DIR}/lib)

add_executable(FASTag src/FASTag.cpp src/IndexedMzMLReader.cpp)
target_link_libraries(FASTag PRIVATE fastag_core)
if(MZPEAK_INCLUDE_DIR AND MZPEAK_LIBRARY)
  # C++23: the library's headers use std::expected and deducing this.
  target_sources(FASTag PRIVATE src/OnDiscMzPeakExperiment.cpp)
  target_include_directories(FASTag PRIVATE ${MZPEAK_INCLUDE_DIR})
  target_link_libraries(FASTag PRIVATE ${MZPEAK_LIBRARY})
  if(MZPEAK_NUMPRESS_LIBRARY)
    target_link_libraries(FASTag PRIVATE ${MZPEAK_NUMPRESS_LIBRARY})
  endif()
  # Two of the library's dependencies are called directly from
  # OnDiscMzPeakExperiment.cpp and so are linked here on every platform:
  # Boost.JSON (compiled, not header-only) builds the run-level metadata
  # block, and Parquet's metadata API reports row-group sizes. Both come from
  # the same conda env that supplies the library's Arrow.
  find_package(Boost CONFIG REQUIRED COMPONENTS json)
  find_package(Arrow CONFIG REQUIRED)
  find_package(Parquet CONFIG REQUIRED)
  target_link_libraries(FASTag PRIVATE Boost::json Parquet::parquet_shared)
  if(WIN32)
    # A static library brings no dependency list of its own, so the rest of
    # what the shared libmzpeak carries as DT_NEEDED elsewhere is linked here
    # too: Arrow and libzip.
    find_package(libzip CONFIG REQUIRED)
    target_link_libraries(FASTag PRIVATE Arrow::arrow_shared libzip::zip)
  endif()
  # CXX_STANDARD is a TARGET property; per-source it is silently ignored and
  # the file would compile at the target's C++17 (std::unreachable missing).
  # The flag is spelled per compiler: MSVC has no c++23, only c++latest; clang
  # accepted `c++23` only from 17, and Apple clang 15 (GitHub's macos-14
  # runners) knows just `c++2b`. Ask.
  if(MSVC)
    set(_fastag_cxx23_flag "/std:c++latest")
  else()
    include(CheckCXXCompilerFlag)
    check_cxx_compiler_flag("-std=c++23" _fastag_has_std_cxx23)
    if(_fastag_has_std_cxx23)
      set(_fastag_cxx23_flag "-std=c++23")
    else()
      set(_fastag_cxx23_flag "-std=c++2b")
    endif()
  endif()
  set_source_files_properties(src/OnDiscMzPeakExperiment.cpp PROPERTIES COMPILE_OPTIONS "${_fastag_cxx23_flag}")
  target_compile_definitions(FASTag PRIVATE FASTAG_HAVE_MZPEAK_LIB)
  message(STATUS "FASTag: mzPeak read/write enabled (${MZPEAK_LIBRARY})")
else()
  message(STATUS "FASTag: mzpeak-openms NOT found -- this build reads and writes mzML only")
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
install(TARGETS buildtaxdb RUNTIME DESTINATION bin)

add_executable(tagfeatures src/tagfeatures.cpp)
install(TARGETS tagfeatures RUNTIME DESTINATION bin)

option(FASTAG_BUILD_BENCH "Build the synthetic benchmark" ON)
if(FASTAG_BUILD_BENCH)
  add_executable(benchmark bench/benchmark.cpp)
  target_link_libraries(benchmark PRIVATE fastag_core)
endif()

option(FASTAG_BUILD_TESTS "Build tests" ON)
if(FASTAG_BUILD_TESTS)
  enable_testing()
  foreach(t ranksum_test fastag_test fasta_filter_test tagrecon_test tagfdr_test proteome_index_test glyco_test taxindex_test taxstats_test sampler_test proforma_test)
    add_executable(${t} test/${t}.cpp)
    target_link_libraries(${t} PRIVATE fastag_core)
    add_test(NAME ${t} COMMAND ${t})
  endforeach()

  # Integration: the -stream protocol against the real binary (skips itself
  # when the OpenMS share data is unreachable).
  add_test(NAME stream_test
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/stream_test.sh $<TARGET_FILE:FASTag>)
  set_tests_properties(stream_test PROPERTIES SKIP_RETURN_CODE 77)

  # mzPeak reader vs its own mzML twin. Needs a matched pair of real files, so
  # it SKIPs unless FASTAG_E2E_MZML and FASTAG_E2E_MZPEAK point at one.
  add_test(NAME mzpeak_e2e
           COMMAND bash ${CMAKE_CURRENT_SOURCE_DIR}/test/mzpeak_e2e.sh $<TARGET_FILE:FASTag>)
  set_tests_properties(mzpeak_e2e PROPERTIES SKIP_RETURN_CODE 77)

  # The mzML fast path against OpenMS itself: the tag TSV carries neither RT
  # nor precursor charge, so only a direct field-by-field comparison proves
  # the reader's scrape right.
  add_executable(indexed_mzml_test test/indexed_mzml_test.cpp src/IndexedMzMLReader.cpp)
  target_link_libraries(indexed_mzml_test PRIVATE fastag_core)
  target_include_directories(indexed_mzml_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
  target_compile_definitions(indexed_mzml_test PRIVATE
                             FASTAG_TEST_DATA="${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures")
  add_test(NAME indexed_mzml_test COMMAND indexed_mzml_test)
  set_tests_properties(indexed_mzml_test PROPERTIES SKIP_RETURN_CODE 77)

  add_executable(tagfeatures_test test/tagfeatures_test.cpp src/tagfeatures.cpp)
  target_include_directories(tagfeatures_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
  target_compile_definitions(tagfeatures_test PRIVATE TAGFEATURES_NO_MAIN)
  add_test(NAME tagfeatures_test COMMAND tagfeatures_test)

  # One short run per acquisition class, gaps and deisotoping ON.
  #
  # These are smoke tests, not quality gates -- the benchmark exits non-zero only
  # if a profile produces no tags at all. That is deliberately weak, and it is
  # still the check that would have caught `-deisotope` throwing an uncaught
  # exception at the 0.3 Da tolerance the iontrap profile uses. Every profile
  # other than iontrap passed that day.
  if(FASTAG_BUILD_BENCH)
    foreach(prof astral ddapasef diatracer iontrap)
      add_test(NAME bench_${prof}
               COMMAND benchmark synth ${prof} 150 4 1 2 100)
    endforeach()
  endif()
endif()
