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
#pragma once

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

namespace OpenMS
{
  class PeakPickerHiRes;
}

namespace FASTag
{
  /// Centroids @p s in place if it is a non-empty PROFILE MS2, with @p picker.
  ///
  /// mzPeak archives converted from raw files routinely carry profile MS2,
  /// and tagging profile samples instead of peaks costs recall. A picker that
  /// yields nothing (data too sparse for peak shapes) leaves the profile
  /// points. Returns +1 when picked, -1 when picking yielded nothing, 0 when
  /// the spectrum needed no picking.
  int centroidProfileMs2(OpenMS::MSSpectrum& s, OpenMS::PeakPickerHiRes& picker);

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
  /// calling thread (centroidProfileMs2()).
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
    /// Copies of the spectra at @p keep_copy (profile MS2 centroided) are
    /// kept aside for copy(), whatever the mask says.
    void start(std::vector<char> mask, std::set<std::size_t> keep_copy = {});

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
    std::condition_variable header_cv_, data_cv_, space_cv_;
    bool have_size_ = false, started_ = false, done_ = false, aborted_ = false;
    std::exception_ptr error_;
    std::size_t expected_ = 0;
    std::size_t next_ = 0;      ///< reader thread only: index of the next spectrum
    std::size_t produced_ = 0;  ///< spectra below have been read (mutex_)
    std::size_t held_ = 0;      ///< untaken spectra in slots_ (mutex_)
    std::size_t waiting_ = 0;   ///< take()s waiting for data (mutex_)
    std::unordered_map<std::size_t, OpenMS::MSSpectrum> slots_;
    std::vector<char> mask_;
    std::set<std::size_t> keep_copy_;
    std::map<std::size_t, OpenMS::MSSpectrum> copies_;
    std::atomic<std::size_t> picked_{0}, pick_failed_{0};
    std::thread reader_;
  };

  /// The spectra at @p indices (ascending) of an mzPeak archive, in one pass,
  /// each handed to @p sink as read (profile MS2 centroided, as by
  /// MzPeakStream). Decodes with @p threads OpenMP threads. Throws the
  /// reader's error, or a ParseError if an index is past the run's end.
  void readMzPeakSpectra(const std::string& path, int threads, const std::vector<std::size_t>& indices,
                         const std::function<void(OpenMS::MSSpectrum&)>& sink);
}
