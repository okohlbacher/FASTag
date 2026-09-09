// mzPeak in and out for FASTag, through the external mzpeak-openms library
// (github.com/okohlbacher/mzpeak-openms): random access over an archive, the
// way OnDiscMSExperiment gives it over an indexed mzML, and writing an
// MSExperiment back as an archive.
//
// WHY THIS EXISTS: OpenMS's own MzPeakFile implements the pre-0.7.0 mzPeak
// layout -- packed nested metadata, point-only signal, `data_kind: "data
// arrays"`. The format moved (spec rev e7f3447, reference impl 474a7c2,
// converter 0.7.0) to split-facet metadata with bare column names, a chunked
// signal layout with delta/Numpress encodings, and `data_kind: "data_arrays"`.
// Every archive written by the current converter therefore read back as ZERO
// spectra through OpenMS -- silently, exit code 0. Measured on a run that
// exists in both formats: the mzML gave 6,103 MS2 and 122,098 tags, the
// mzPeak twin gave 0 and 0.
//
// The external library reads BOTH layouts and is validated against the Rust
// reference implementation in both directions, so it replaces the reader
// rather than sitting beside it.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#ifdef FASTAG_HAVE_MZPEAK_LIB

#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/METADATA/ExperimentalSettings.h>

#include <cstddef>
#include <memory>
#include <string>

// No library header here: this header is included by FASTag.cpp, which is
// compiled as C++17, and the library's headers need C++23. Everything mzPeak
// lives behind the pimpl in the .cpp, which is the one C++23 translation unit.
namespace MzPeak
{
  class RunMetadata;
}

namespace FASTag
{
  /// Random access over an mzPeak archive, shaped like OpenMS's
  /// OnDiscMSExperiment so the tagging loop treats both formats alike: open
  /// once, copy-construct one reader per thread, pull spectra by index.
  ///
  /// Not thread-safe, for the same reason as its mzML counterpart: each reader
  /// owns a decoder over its own file handle. Copies share the archive index,
  /// its descriptive-metadata map (read once, ~7 MB on a typical run) and the
  /// archive-wide cache of DECODED row groups, so a group is decoded once
  /// however many threads read from it, while different groups decode in
  /// parallel. Give every thread a CONTIGUOUS range of indices anyway: it
  /// keeps the number of groups in flight -- what the memory now follows --
  /// at about one per thread.
  ///
  /// PROFILE MS2 is centroided on the way out, on the calling thread. mzPeak
  /// archives converted from raw files routinely carry profile MS2 with an
  /// empty centroid entry, and tagging profile SAMPLES rather than peaks costs
  /// real recall: measured on one run, 80,990 tags read as-is against 122,489
  /// centroided on read and 122,098 for the same run supplied as centroided
  /// mzML.
  ///
  /// @throws OpenMS::Exception::ParseError with the library's message when the
  ///   archive cannot be read. A silent empty result is never acceptable here:
  ///   that is the exact failure this reader replaces.
  class OnDiscMzPeakExperiment
  {
  public:
    /// @param cache_budget  bytes of decoded row groups the archive-wide cache
    ///   may hold before evicting; size it to the readers you run (see
    ///   maxRowGroupBytes()).
    explicit OnDiscMzPeakExperiment(const std::string& path,
                                    std::size_t cache_budget = std::size_t(4) << 30);
    /// A per-thread reader over the same archive. Safe to call concurrently.
    OnDiscMzPeakExperiment(const OnDiscMzPeakExperiment& other);
    OnDiscMzPeakExperiment& operator=(const OnDiscMzPeakExperiment&) = delete;
    ~OnDiscMzPeakExperiment();

    OpenMS::Size getNrSpectra() const;

    /// The spectrum at @p i with its peaks. MS1 peaks are NOT decoded --
    /// mz()/intensity() are what trigger the library's lazy Parquet decode,
    /// nothing in FASTag reads an MS1's peaks, and decoding is most of its
    /// cost -- so an MS1 comes back with its metadata and no peaks.
    OpenMS::MSSpectrum getSpectrum(OpenMS::Size i);

    /// Run-level metadata, mapped from the archive's mzpeak_index.json.
    const OpenMS::ExperimentalSettings& getMetaData() const;

    /// Row groups across the archive's spectrum signal tables, from the
    /// Parquet footers -- the physical layout, unlike rowGroupsDecoded().
    std::size_t rowGroupCount() const;
    /// Largest signal row group in the archive, in uncompressed bytes. Memory
    /// follows the groups in flight, about one per reader plus a boundary, so
    /// this is what a caller sizing the number of concurrent readers needs.
    std::size_t maxRowGroupBytes() const;
    /// The cache budget this reader was opened with.
    std::size_t cacheBudget() const;
    /// Shrink or grow the archive-wide cache budget for every reader at once.
    /// Two groups per running reader is the sweet spot: a single reader then
    /// keeps what a forward pass needs and no more, and sixteen readers can
    /// never hold more than the file has.
    void setCacheBudget(std::size_t bytes);
    /// Row groups decoded so far across every reader of this archive: with
    /// the shared cache that is each group once, whatever the thread count.
    std::size_t rowGroupsDecoded() const;
    /// Calls that REACHED the archive-wide cache (decodes + hits + waits).
    /// Diagnostic: with a per-reader memo in front of it this should be far
    /// below one per spectrum, and if it is not, the memo is not working.
    std::size_t cacheCalls() const;
    /// Row groups examined while planning, record batches walked, and slices
    /// made -- the per-spectrum read work the group cache does not remove.
    void readCounters(long& plan_group_evals, long& batches, long& slices) const;
    /// How the planner decided each row group, and how wide the ranges it
    /// produced were: pruned by statistics, narrowed by the page index, or
    /// fallen back to a whole-group scan.
    void planCounters(long& pruned, long& full_scan, long& page_index, long& pi_null,
                      long& ranges, long& range_rows) const;
    /// Nanoseconds summed across all reader threads for each stage of a
    /// per-spectrum read. Thread-seconds, not wall: divide by the thread count
    /// to compare against the phase timings.
    void nsCounters(long& plan, long& exec, long& rowgroup, long& project) const;

    /// Profile MS2 centroided so far, across every copy of this reader.
    std::size_t nPicked() const;
    /// Profile MS2 whose picking yielded nothing (profile points kept).
    std::size_t nPickFailed() const;

  private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
  };

  /// Write spectra to an mzPeak archive as they arrive, so a run never sits
  /// in memory: each spectrum is converted and appended, and the library
  /// flushes a Parquet row group whenever enough points have accumulated.
  /// Memory is one row group of points, plus a few hundred bytes of metadata
  /// per spectrum for the tables that can only be written at the end.
  ///
  /// finish() seals the archive; a writer destroyed without it leaves no
  /// archive and no working files.
  class MzPeakSpectrumWriter
  {
  public:
    /// @param settings  run-level metadata for the archive (see
    ///   toRunMetadata()); @p exp adds its data-processing history.
    MzPeakSpectrumWriter(const std::string& path,
                         const OpenMS::ExperimentalSettings& settings,
                         const OpenMS::MSExperiment* exp = nullptr);
    ~MzPeakSpectrumWriter();
    MzPeakSpectrumWriter(const MzPeakSpectrumWriter&) = delete;
    MzPeakSpectrumWriter& operator=(const MzPeakSpectrumWriter&) = delete;

    void add(const OpenMS::MSSpectrum& spectrum);
    std::size_t size() const;
    void finish();

  private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
  };

  /// Write @p exp to @p path as an mzPeak archive.
  ///
  /// Carries what the reader above hands back: peaks, representation, MS
  /// level, retention time, polarity, native id, every precursor's isolation
  /// window and selected ion (m/z, charge, intensity), and the run-level
  /// metadata toRunMetadata() maps from the experiment's settings.
  ///
  /// This replaces OpenMS's MzPeakFile::store(), which aborted on any
  /// experiment whose spectra had come through the library reader.
  ///
  /// @throws OpenMS::Exception::UnableToCreateFile with the library's message.
  void writeMzPeak(const std::string& path, const OpenMS::MSExperiment& exp);

  /// OpenMS run-level settings -> mzPeak run metadata: run id and start time,
  /// source files, the instrument with its components and software, the
  /// sample, and -- when @p exp is given -- its first spectrum's
  /// data-processing history. Settings that came out of fromRunMetadata()
  /// carry the archive's raw JSON as a meta value; that is used as the base
  /// then, so an mzpeak -> mzpeak run loses nothing OpenMS has no field for.
  MzPeak::RunMetadata toRunMetadata(const OpenMS::ExperimentalSettings& es,
                                    const OpenMS::MSExperiment* exp = nullptr);

  /// The reverse mapping.
  OpenMS::ExperimentalSettings fromRunMetadata(const MzPeak::RunMetadata& md);

  /// Meta-value key under which fromRunMetadata() keeps the archive's raw
  /// mzpeak_index.json metadata block, and from which toRunMetadata() starts
  /// when it is present. Exposed for the adapter test.
  extern const char* const kRawMetaKey;
}

#endif  // FASTAG_HAVE_MZPEAK_LIB
