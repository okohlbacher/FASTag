// mzPeak input for FASTag, through OpenMS's MzPeakFile.
//
// MzPeakFile reads an archive front to back: transform() hands the spectra to
// a consumer in file order, decoded in parallel batches. FASTag's tagging loop
// pulls spectra by index from many threads, so MzPeakStream runs transform()
// on a thread of its own and holds a bounded window of decoded spectra that
// the tagging threads take by index.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "Acquisition.h"

#include <OpenMS/INTERFACES/IMSDataConsumer.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/ExperimentalSettings.h>

#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <exception>
#include <functional>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "Centroid.h"

namespace OpenMS
{
  class PeakPickerHiRes;
}

namespace FASTag
{
  // centroidProfileMs2 (Centroid.h): mzPeak archives converted from raw files
  // routinely carry profile MS2, and tagging profile samples instead of peaks
  // costs recall.

  /// One pass over an mzPeak archive, consumed by index from several threads.
  ///
  /// Use: construct (reading starts), size() and settings() (wait for the
  /// archive's header), start() with the spectra wanted, then take() each
  /// wanted index exactly once, from any thread, and finish(). Spectra are
  /// produced in file order; one taken out of order waits until the reader
  /// has reached it, so the takers should move forward through the run, as
  /// FASTag's monotonic chunks do. At most @p window untaken spectra are held.
  ///
  /// MS1 spectra come with their metadata and no peaks: nothing in FASTag
  /// reads an MS1's peaks. Profile MS2 are centroided by take(), on the
  /// calling thread (centroidProfileMs2()), as start()'s policy says.
  class MzPeakStream : public OpenMS::Interfaces::IMSDataConsumer
  {
  public:
    /// Starts reading @p path, decoding with @p threads OpenMP threads.
    MzPeakStream(const std::string& path, int threads, std::size_t window);
    /// Stops the reader (if it still runs) and waits for it.
    ~MzPeakStream() override;
    MzPeakStream(const MzPeakStream&) = delete;
    MzPeakStream& operator=(const MzPeakStream&) = delete;

    /// The number of spectra in the run. Waits for the archive to be opened;
    /// rethrows the reader's error (an OpenMS exception) if it failed.
    std::size_t size();
    /// The run-level settings (valid once size() has returned).
    const OpenMS::ExperimentalSettings& settings() const { return settings_; }

    /// Lets the reader go on past the header. @p mask (empty = all) says which
    /// spectra will be taken; the others are dropped as they are read.
    /// Copies of the spectra at @p keep_copy (centroided as @p picking says)
    /// are kept aside for copy(), whatever the mask says. @p picking: what
    /// take() and the copies do with profile MS2; the default, picking every
    /// PROFILE MS2, is -pick_profile legacy (FASTag 1.11).
    void start(std::vector<char> mask, std::set<std::size_t> keep_copy = {},
               Centroid::Policy picking = Centroid::Policy{true});

    /// Spectrum @p i, waiting until it is read. Each wanted index once.
    /// @p picker: the calling thread's own (PeakPickerHiRes is not
    /// thread-safe). Throws the reader's error, or after abort().
    OpenMS::MSSpectrum take(std::size_t i, OpenMS::PeakPickerHiRes& picker);

    /// A spectrum kept by start()'s @p keep_copy; an empty one if it was not
    /// read. Valid once finish() has returned.
    OpenMS::MSSpectrum copy(std::size_t i) const;

    /// Stops reading: the reader ends early, and waiting take()s throw.
    /// Thread-safe; for a failed tagging loop.
    void abort();

    /// Waits for the reader to end; rethrows its error. Throws a ParseError
    /// if the archive held fewer spectra than it announced.
    void finish();

    /// Profile MS2 centroided by take(), and those kept as profile.
    std::size_t picked() const { return picked_.load(); }
    std::size_t pickFailed() const { return pick_failed_.load(); }

    // IMSDataConsumer, called by MzPeakFile::transform() on the reader thread.
    void setExperimentalSettings(const OpenMS::ExperimentalSettings& exp) override;
    void setExpectedSize(OpenMS::Size expectedSpectra, OpenMS::Size expectedChromatograms) override;
    void consumeSpectrum(SpectrumType& s) override;
    void consumeChromatogram(ChromatogramType&) override {}

  private:
    struct Aborted {};
    void run_(int threads);

    const std::string path_;
    const std::size_t window_;
    OpenMS::ExperimentalSettings settings_;

    mutable std::mutex mutex_;
    std::condition_variable header_cv_, space_cv_;
    /// take(i) waits on data_cv_[i % kStripes]: a spectrum wakes only the
    /// takers of its stripe, not every waiting thread (at 64 threads, waking
    /// all of them per spectrum spent more time in the kernel than tagging).
    static constexpr std::size_t kStripes = 64;
    std::condition_variable data_cv_[kStripes];
    bool have_size_ = false, started_ = false, done_ = false, aborted_ = false;
    std::exception_ptr error_;
    std::size_t expected_ = 0;
    std::size_t next_ = 0;      ///< reader thread only: index of the next spectrum
    std::size_t produced_ = 0;  ///< spectra below have been read (mutex_)
    std::size_t held_ = 0;      ///< untaken spectra in slots_ (mutex_)
    std::size_t waiting_[kStripes] = {};  ///< take()s waiting, per stripe (mutex_)
    std::unordered_map<std::size_t, OpenMS::MSSpectrum> slots_;
    std::vector<char> mask_;
    std::set<std::size_t> keep_copy_;
    Centroid::Policy picking_{true};  ///< set by start(), before the first spectrum
    std::map<std::size_t, OpenMS::MSSpectrum> copies_;
    std::atomic<std::size_t> picked_{0}, pick_failed_{0};
    std::thread reader_;
  };

  /// The spectra at @p indices (ascending) of an mzPeak archive, in one pass,
  /// each handed to @p sink as read (profile MS2 centroided as @p picking
  /// says; the default is MzPeakStream's legacy one). Decodes with @p threads
  /// OpenMP threads. Throws the reader's error, or a ParseError if an index
  /// is past the run's end.
  void readMzPeakSpectra(const std::string& path, int threads, const std::vector<std::size_t>& indices,
                         const std::function<void(OpenMS::MSSpectrum&)>& sink,
                         Centroid::Policy picking = Centroid::Policy{true});

  /// The acquisition probe of an mzPeak archive (1.12 item #7): the
  /// Ms2Meta of its first MS2, in file order, within @p limits. A
  /// metadata-only read (PeakFileOptions: MS2 only, no peaks) that stops
  /// once the limits are reached. Decodes with @p threads OpenMP threads.
  /// Throws the reader's error.
  std::vector<Acquisition::Ms2Meta> probeMzPeakMetadata(const std::string& path, const Acquisition::ProbeLimits& limits,
                                                        int threads);

  /// What -probe_input reads of an mzPeak archive (1.12 G1): its run-level
  /// settings, the MS level of every spectrum, and the metadata (no peaks)
  /// of its first MS2 within @p limits, in file order. One metadata-only
  /// pass. Throws the reader's error.
  struct MzPeakRunScan
  {
    OpenMS::ExperimentalSettings settings;
    std::size_t spectra = 0, ms1 = 0, ms2 = 0;
    std::vector<OpenMS::MSSpectrum> ms2_head;  ///< the first MS2, without peaks
  };
  MzPeakRunScan scanMzPeakRun(const std::string& path, const Acquisition::ProbeLimits& limits, int threads);

  /// The spectrum of an mzPeak archive whose native ID is @p native_id,
  /// centroided as @p picking says (what MzPeakStream::take() hands the
  /// tagger), and its index (1.12 G1 -dump_spectrum). Reads in file order
  /// and stops at the first match; @p pick_result is Centroid::apply()'s.
  /// False when no spectrum has that ID. Throws the reader's error.
  bool readMzPeakSpectrumById(const std::string& path, int threads, const std::string& native_id,
                              Centroid::Policy picking, OpenMS::MSSpectrum& out, std::size_t& index,
                              int& pick_result);
}
