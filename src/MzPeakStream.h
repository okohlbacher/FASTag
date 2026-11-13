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

  /**
    @brief One pass over an mzPeak archive, consumed by index from several threads.

    Use: construct (reading starts), size() and settings() (wait for the
    archive's header), start() with the spectra wanted, then take() each
    wanted index exactly once, from any thread, and finish(). Spectra are
    produced in file order; one taken out of order waits until the reader
    has reached it, so the takers should move forward through the run, as
    FASTag's monotonic chunks do. At most @p window untaken spectra are held.

    MS1 spectra come with their metadata and no peaks: nothing in FASTag
    reads an MS1's peaks. Profile MS2 are centroided by take(), on the
    calling thread (centroidProfileMs2()), as start()'s policy says.
  */
  class MzPeakStream : public OpenMS::Interfaces::IMSDataConsumer
  {
  public:
    /**
      @brief Starts reading @p path, decoding with @p threads OpenMP threads.
      @param[in] path the mzPeak archive
      @param[in] threads OpenMP threads for decoding
      @param[in] window the most untaken spectra held at once (at least 1)
    */
    MzPeakStream(const std::string& path, int threads, std::size_t window);
    /// @brief Stops the reader (if it still runs) and waits for it.
    ~MzPeakStream() override;
    MzPeakStream(const MzPeakStream&) = delete;
    MzPeakStream& operator=(const MzPeakStream&) = delete;

    /**
      @brief The number of spectra in the run.

      Waits for the archive to be opened.

      @return the number of spectra the archive announces
      @throw OpenMS::Exception::BaseException the reader's error (non-OpenMS errors as ParseError), if it failed
    */
    std::size_t size();
    /// @brief The run-level settings (valid once size() has returned).
    /// @return the settings
    const OpenMS::ExperimentalSettings& settings() const { return settings_; }

    /**
      @brief Lets the reader go on past the header.

      Spectra not in @p mask are dropped as they are read. Copies of the
      spectra at @p keep_copy are kept aside for copy(), whatever the mask
      says. The default policy, picking every PROFILE MS2, is -pick_profile
      legacy (FASTag 1.11).

      @param[in] mask per index, whether the spectrum will be taken (empty = all)
      @param[in] keep_copy indices of spectra to keep a copy of (centroided as @p picking says)
      @param[in] picking what take() and the copies do with profile MS2
    */
    void start(std::vector<char> mask, std::set<std::size_t> keep_copy = {},
               Centroid::Policy picking = Centroid::Policy{true});

    /**
      @brief Spectrum @p i, waiting until it is read. Each wanted index once.
      @param[in] i the spectrum index
      @param[in,out] picker the calling thread's own peak picker (PeakPickerHiRes is not thread-safe)
      @return the spectrum, centroided as start()'s policy says
      @throw OpenMS::Exception::BaseException the reader's error
      @throw OpenMS::Exception::Precondition after abort(), or when @p i was not read or already taken
    */
    OpenMS::MSSpectrum take(std::size_t i, OpenMS::PeakPickerHiRes& picker);

    /**
      @brief A spectrum kept by start()'s @p keep_copy.

      Valid once finish() has returned.

      @param[in] i the spectrum index
      @return the copy; an empty spectrum if it was not read
    */
    OpenMS::MSSpectrum copy(std::size_t i) const;

    /**
      @brief Stops reading: the reader ends early, and waiting take()s throw.

      Thread-safe; for a failed tagging loop.
    */
    void abort();

    /**
      @brief Waits for the reader to end; rethrows its error.
      @throw OpenMS::Exception::BaseException the reader's error
      @throw OpenMS::Exception::ParseError if the archive held fewer spectra than it announced
    */
    void finish();

    /// @brief The number of profile MS2 centroided by take().
    /// @return the count
    std::size_t picked() const { return picked_.load(); }
    /// @brief The number of profile MS2 take() kept as profile (picking failed).
    /// @return the count
    std::size_t pickFailed() const { return pick_failed_.load(); }

    // IMSDataConsumer, called by MzPeakFile::transform() on the reader thread.
    /**
      @brief Stores the run-level settings (IMSDataConsumer; reader thread).
      @param[in] exp the settings
    */
    void setExperimentalSettings(const OpenMS::ExperimentalSettings& exp) override;
    /**
      @brief Records the announced number of spectra and waits for start() (IMSDataConsumer; reader thread).
      @param[in] expectedSpectra the announced number of spectra
      @param[in] expectedChromatograms the announced number of chromatograms (ignored)
    */
    void setExpectedSize(OpenMS::Size expectedSpectra, OpenMS::Size expectedChromatograms) override;
    /**
      @brief Takes over the next spectrum in file order (IMSDataConsumer; reader thread).

      MS1 peaks are cleared; a wanted spectrum is moved into the window,
      waiting while the window is full.

      @param[in,out] s the spectrum; moved from when wanted
    */
    void consumeSpectrum(SpectrumType& s) override;
    /// @brief Ignores chromatograms (IMSDataConsumer).
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

  /**
    @brief Reads the spectra at @p indices of an mzPeak archive in one pass.

    Each is handed to @p sink as read (profile MS2 centroided as @p picking
    says; the default is MzPeakStream's legacy one).

    @param[in] path the mzPeak archive
    @param[in] threads OpenMP threads for decoding
    @param[in] indices the spectrum indices, ascending
    @param[in] sink called with each spectrum read
    @param[in] picking what to do with profile MS2
    @throw OpenMS::Exception::BaseException the reader's error
    @throw OpenMS::Exception::ParseError if an index is past the run's end
  */
  void readMzPeakSpectra(const std::string& path, int threads, const std::vector<std::size_t>& indices,
                         const std::function<void(OpenMS::MSSpectrum&)>& sink,
                         Centroid::Policy picking = Centroid::Policy{true});

  /**
    @brief The acquisition probe of an mzPeak archive (1.12 item #7).

    A metadata-only read (PeakFileOptions: MS2 only, no peaks) that stops
    once the limits are reached.

    @param[in] path the mzPeak archive
    @param[in] limits how many spectra and MS2 to read at most
    @param[in] threads OpenMP threads for decoding
    @return the Ms2Meta of its first MS2, in file order
    @throw OpenMS::Exception::BaseException the reader's error
  */
  std::vector<Acquisition::Ms2Meta> probeMzPeakMetadata(const std::string& path, const Acquisition::ProbeLimits& limits,
                                                        int threads);

  /**
    @brief What -probe_input reads of an mzPeak archive (1.12 G1).

    Its run-level settings, the MS level counts of its spectra, and the
    metadata (no peaks) of its first MS2, in file order.
  */
  struct MzPeakRunScan
  {
    OpenMS::ExperimentalSettings settings;  ///< the run-level settings
    std::size_t spectra = 0, ms1 = 0, ms2 = 0;  ///< spectra in all, MS1 and MS2
    std::vector<OpenMS::MSSpectrum> ms2_head;  ///< the first MS2, without peaks
  };
  /**
    @brief Scans an mzPeak archive for -probe_input in one metadata-only pass.
    @param[in] path the mzPeak archive
    @param[in] limits how many MS2 to keep metadata of
    @param[in] threads OpenMP threads for decoding
    @return the run scan
    @throw OpenMS::Exception::BaseException the reader's error
  */
  MzPeakRunScan scanMzPeakRun(const std::string& path, const Acquisition::ProbeLimits& limits, int threads);

  /**
    @brief The spectrum of an mzPeak archive whose native ID is @p native_id, and its index (1.12 G1 -dump_spectrum).

    Centroided as @p picking says (what MzPeakStream::take() hands the
    tagger). Reads in file order and stops at the first match.

    @param[in] path the mzPeak archive
    @param[in] threads OpenMP threads for decoding
    @param[in] native_id the native ID searched for
    @param[in] picking what to do with profile MS2
    @param[out] out the spectrum
    @param[out] index its index in the run
    @param[out] pick_result Centroid::apply()'s result for it
    @return false when no spectrum has that ID
    @throw OpenMS::Exception::BaseException the reader's error
  */
  bool readMzPeakSpectrumById(const std::string& path, int threads, const std::string& native_id,
                              Centroid::Policy picking, OpenMS::MSSpectrum& out, std::size_t& index,
                              int& pick_result);
}
