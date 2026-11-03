// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "MzPeakStream.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/FORMAT/MzPeakFile.h>
#include <OpenMS/PROCESSING/CENTROIDING/PeakPickerHiRes.h>

#include <algorithm>
#include <utility>

#ifdef _OPENMP
#include <omp.h>
#endif

using namespace OpenMS;

namespace FASTag
{
  int centroidProfileMs2(MSSpectrum& s, PeakPickerHiRes& picker)
  {
    if (s.getMSLevel() != 2 || s.empty() || s.getType() != SpectrumSettings::SpectrumType::PROFILE) return 0;
    // pick() copies the spectrum's metadata (precursors included) and labels
    // the result CENTROID.
    MSSpectrum picked;
    try
    {
      picker.pick(s, picked);
    }
    catch (const Exception::BaseException&)
    {
      return -1;
    }
    if (picked.empty()) return -1;
    s = std::move(picked);
    return 1;
  }

  namespace
  {
    void setThreads(int threads)
    {
#ifdef _OPENMP
      // The OpenMP thread count is per thread: a new thread starts from the
      // process default, not from what the caller set.
      omp_set_num_threads(std::max(1, threads));
#else
      static_cast<void>(threads);
#endif
    }

    /// An OpenMS exception for anything else the reader throws.
    [[noreturn]] void rethrowAsOpenMS(const std::exception_ptr& e, const std::string& path)
    {
      try
      {
        std::rethrow_exception(e);
      }
      catch (const Exception::BaseException&)
      {
        throw;
      }
      catch (const std::exception& x)
      {
        throw Exception::ParseError(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path,
                                    std::string("mzPeak read failed: ") + x.what());
      }
    }
  }

  MzPeakStream::MzPeakStream(const std::string& path, int threads, std::size_t window)
    : path_(path), window_(std::max<std::size_t>(1, window))
  {
    reader_ = std::thread([this, threads] { run_(threads); });
  }

  MzPeakStream::~MzPeakStream()
  {
    abort();
    if (reader_.joinable()) reader_.join();
  }

  void MzPeakStream::run_(int threads)
  {
    setThreads(threads);
    std::exception_ptr error;
    try
    {
      MzPeakFile().transform(path_, this);
    }
    catch (const Aborted&)
    {
    }
    catch (...)
    {
      error = std::current_exception();
    }
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (!error && !aborted_ && next_ != expected_)
      {
        try
        {
          throw Exception::ParseError(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path_,
                                      "mzPeak run announced " + std::to_string(expected_) + " spectra but held "
                                          + std::to_string(next_));
        }
        catch (...)
        {
          error = std::current_exception();
        }
      }
      error_ = error;
      done_ = true;
    }
    header_cv_.notify_all();
    for (auto& cv : data_cv_) cv.notify_all();
  }

  void MzPeakStream::setExperimentalSettings(const ExperimentalSettings& exp)
  {
    settings_ = exp;
  }

  void MzPeakStream::setExpectedSize(Size expectedSpectra, Size /*expectedChromatograms*/)
  {
    std::unique_lock<std::mutex> lock(mutex_);
    expected_ = expectedSpectra;
    have_size_ = true;
    header_cv_.notify_all();
    // No spectrum before start(): it says which ones to keep.
    header_cv_.wait(lock, [this] { return started_ || aborted_; });
    if (aborted_) throw Aborted();
  }

  std::size_t MzPeakStream::size()
  {
    std::unique_lock<std::mutex> lock(mutex_);
    header_cv_.wait(lock, [this] { return have_size_ || done_; });
    if (error_) rethrowAsOpenMS(error_, path_);
    return expected_;
  }

  void MzPeakStream::start(std::vector<char> mask, std::set<std::size_t> keep_copy)
  {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      mask_ = std::move(mask);
      keep_copy_ = std::move(keep_copy);
      slots_.reserve(window_);
      started_ = true;
    }
    header_cv_.notify_all();
  }

  void MzPeakStream::consumeSpectrum(SpectrumType& s)
  {
    const std::size_t i = next_++;
    // MS1 peaks are never read; holding them would only cost memory.
    if (s.getMSLevel() != 2)
    {
      s.clear(false);
      s.shrink_to_fit();
    }
    if (keep_copy_.count(i))
    {
      static thread_local PeakPickerHiRes picker;
      MSSpectrum c = s;
      centroidProfileMs2(c, picker);
      copies_.emplace(i, std::move(c));
    }
    if (!mask_.empty() && (i >= mask_.size() || !mask_[i])) return;
    bool wake = false;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      space_cv_.wait(lock, [this] { return held_ < window_ || aborted_; });
      if (aborted_) throw Aborted();
      slots_.emplace(i, std::move(s));
      ++held_;
      produced_ = i + 1;
      wake = waiting_[i % kStripes] > 0;
    }
    if (wake) data_cv_[i % kStripes].notify_all();
  }

  MSSpectrum MzPeakStream::take(std::size_t i, PeakPickerHiRes& picker)
  {
    MSSpectrum s;
    bool space = false;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      if (produced_ <= i && !done_ && !aborted_)
      {
        const std::size_t stripe = i % kStripes;
        ++waiting_[stripe];
        data_cv_[stripe].wait(lock, [this, i] { return produced_ > i || done_ || aborted_; });
        --waiting_[stripe];
      }
      const auto it = slots_.find(i);
      if (it == slots_.end())
      {
        if (error_) rethrowAsOpenMS(error_, path_);
        if (aborted_) throw Exception::Precondition(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, "mzPeak read stopped");
        throw Exception::Precondition(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION,
                                      "mzPeak spectrum " + std::to_string(i) + " not read, or taken twice");
      }
      s = std::move(it->second);
      slots_.erase(it);
      space = held_-- == window_;
    }
    if (space) space_cv_.notify_one();
    const int r = centroidProfileMs2(s, picker);
    if (r > 0) ++picked_;
    else if (r < 0) ++pick_failed_;
    return s;
  }

  MSSpectrum MzPeakStream::copy(std::size_t i) const
  {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto it = copies_.find(i);
    return it == copies_.end() ? MSSpectrum() : it->second;
  }

  void MzPeakStream::abort()
  {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (done_ || aborted_) return;
      aborted_ = true;
    }
    header_cv_.notify_all();
    for (auto& cv : data_cv_) cv.notify_all();
    space_cv_.notify_all();
  }

  void MzPeakStream::finish()
  {
    if (reader_.joinable()) reader_.join();
    std::lock_guard<std::mutex> lock(mutex_);
    if (error_) rethrowAsOpenMS(error_, path_);
  }

  /****************************************************************************/
  namespace
  {
    /// Hands the spectra at the wanted indices to a sink, in file order.
    class Picking : public Interfaces::IMSDataConsumer
    {
    public:
      Picking(const std::vector<std::size_t>& indices, const std::function<void(MSSpectrum&)>& sink)
        : indices_(indices), sink_(sink)
      {
      }
      void setExperimentalSettings(const ExperimentalSettings&) override {}
      void setExpectedSize(Size, Size) override {}
      void consumeSpectrum(SpectrumType& s) override
      {
        const std::size_t i = next_++;
        if (k_ >= indices_.size() || indices_[k_] != i) return;
        ++k_;
        centroidProfileMs2(s, picker_);
        sink_(s);
      }
      void consumeChromatogram(ChromatogramType&) override {}
      std::size_t found() const { return k_; }

    private:
      const std::vector<std::size_t>& indices_;
      const std::function<void(MSSpectrum&)>& sink_;
      PeakPickerHiRes picker_;
      std::size_t next_ = 0, k_ = 0;
    };
  }

  void readMzPeakSpectra(const std::string& path, int threads, const std::vector<std::size_t>& indices,
                         const std::function<void(MSSpectrum&)>& sink)
  {
    Picking consumer(indices, sink);
#ifdef _OPENMP
    const int before = omp_get_max_threads();
#endif
    setThreads(threads);
    try
    {
      MzPeakFile().transform(path, &consumer);
    }
    catch (...)
    {
#ifdef _OPENMP
      omp_set_num_threads(before);
#endif
      rethrowAsOpenMS(std::current_exception(), path);
    }
#ifdef _OPENMP
    omp_set_num_threads(before);
#endif
    if (consumer.found() != indices.size())
    {
      throw Exception::ParseError(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION, path,
                                  "mzPeak run ended before spectrum " + std::to_string(indices[consumer.found()]));
    }
  }
}
