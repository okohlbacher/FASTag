// MzPeakStream against MzPeakFile::load(), spectrum by spectrum.
//
// The tag TSV ranks intensities and reads one precursor, so byte-identical
// tags do not prove the reader hands out the right spectra. This writes the
// fixture (plus one synthetic profile MS2) as an archive, loads it with
// MzPeakFile as the reference, and takes every spectrum from MzPeakStream the
// way the tagging loop does: from several threads in monotonic chunks, with a
// subsampling mask and a window small enough to make the reader wait. It also
// checks the copies kept for the tolerance probe, readMzPeakSpectra(), the
// error of an unreadable archive and abort().
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "MzPeakStream.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/FORMAT/MzPeakFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/PROCESSING/CENTROIDING/PeakPickerHiRes.h>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <random>
#include <set>
#include <string>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif
// As in FASTag.cpp: chunks in index order (MSVC's OpenMP 2.0 has no modifier,
// and its dynamic schedule is monotonic anyway).
#if defined(_OPENMP) && _OPENMP >= 201511
#define FASTAG_MONOTONIC monotonic:
#else
#define FASTAG_MONOTONIC
#endif

using namespace OpenMS;
namespace fs = std::filesystem;

namespace
{
  int failures = 0;
  std::mutex check_mutex;
  void check(bool ok, const std::string& what)
  {
    if (ok) return;
    std::lock_guard<std::mutex> lock(check_mutex);
    std::cerr << "FAIL: " << what << "\n";
    ++failures;
  }

  /// A profile MS2: Gaussian peaks sampled every 0.002 Th.
  MSSpectrum profileMs2()
  {
    MSSpectrum s;
    s.setMSLevel(2);
    s.setRT(4321.5);
    s.setNativeID("synthetic=profile");
    s.setType(SpectrumSettings::SpectrumType::PROFILE);
    Precursor p;
    p.setMZ(612.3);
    p.setCharge(2);
    s.getPrecursors().push_back(p);
    for (const double centre : {201.1, 333.2, 480.25, 701.4})
      for (int k = -15; k <= 15; ++k)
      {
        const double mz = centre + k * 0.002;
        s.push_back(Peak1D(mz, static_cast<float>(1e5 * std::exp(-0.5 * (k / 5.0) * (k / 5.0)))));
      }
    return s;
  }

  /// What MzPeakStream promises for spectrum @p ref: MS1 without peaks,
  /// profile MS2 centroided.
  MSSpectrum expected(const MSSpectrum& ref, PeakPickerHiRes& picker)
  {
    MSSpectrum e = ref;
    if (e.getMSLevel() != 2) e.clear(false);
    FASTag::centroidProfileMs2(e, picker);
    return e;
  }

  void compare(const MSSpectrum& got, const MSSpectrum& want, const std::string& what)
  {
    check(got.getNativeID() == want.getNativeID(), what + ": native id '" + got.getNativeID() + "'");
    check(got.getMSLevel() == want.getMSLevel(), what + ": MS level");
    check(got.getRT() == want.getRT(), what + ": RT");
    check(got.getType() == want.getType(), what + ": spectrum type");
    check(got.size() == want.size(), what + ": " + std::to_string(got.size()) + " peaks, want " +
                                         std::to_string(want.size()));
    bool same = got.size() == want.size();
    for (Size i = 0; same && i < got.size(); ++i)
      same = got[i].getMZ() == want[i].getMZ() && got[i].getIntensity() == want[i].getIntensity();
    check(same, what + ": peaks differ");
    check(got.getPrecursors().size() == want.getPrecursors().size(), what + ": precursor count");
    if (!got.getPrecursors().empty() && !want.getPrecursors().empty())
    {
      check(got.getPrecursors().front().getMZ() == want.getPrecursors().front().getMZ(), what + ": precursor m/z");
      check(got.getPrecursors().front().getCharge() == want.getPrecursors().front().getCharge(),
            what + ": precursor charge");
    }
  }
}

int main()
{
  if (!MzPeakFile::isSupported())
  {
    std::cerr << "SKIP: this OpenMS has no mzPeak support\n";
    return 77;
  }
  const fs::path dir = fs::temp_directory_path() / ("fastag-mzpeak-stream-" + std::to_string(std::random_device()()));
  fs::create_directories(dir);
  const std::string archive = (dir / "fixture.mzpeak").string();
  PeakMap ref;
  try
  {
    PeakMap exp;
    MzMLFile().load(std::string(FASTAG_TEST_DATA) + "/Ecoli_MS2_small.mzML", exp);
    // Ion trap MS2 marked centroid; one profile MS2 in the middle exercises
    // the centroiding.
    std::vector<MSSpectrum> spectra(exp.begin(), exp.end());
    spectra.insert(spectra.begin() + static_cast<long>(spectra.size() / 2), profileMs2());
    for (MSSpectrum& s : spectra) s.getFloatDataArrays().clear();
    exp.setSpectra(std::move(spectra));
    MzPeakFile().store(archive, exp);
    MzPeakFile().load(archive, ref);
  }
  catch (const Exception::BaseException& e)
  {
    std::cerr << "FAIL: cannot write or load the archive: " << e.what() << "\n";
    return 1;
  }
  const Size n = ref.size();
  check(n > 100, "archive holds the fixture (" + std::to_string(n) + " spectra)");

  PeakPickerHiRes picker;
  std::vector<MSSpectrum> want(n);
  Size profile_at = n;
  for (Size i = 0; i < n; ++i)
  {
    want[i] = expected(ref[i], picker);
    if (ref[i].getType() == SpectrumSettings::SpectrumType::PROFILE) profile_at = i;
  }
  check(profile_at < n, "the profile MS2 survived the round trip");
  check(profile_at < n && want[profile_at].getType() == SpectrumSettings::SpectrumType::CENTROID
            && want[profile_at].size() == 4,
        "the profile MS2 centroids to its four peaks");

  // A. Every third spectrum masked out, a window of 5, 4 threads.
  {
    std::vector<char> mask(n, 1);
    for (Size i = 0; i < n; i += 3) mask[i] = 0;
    const std::set<std::size_t> probe = {0, 1, 2, profile_at, n - 1};
    FASTag::MzPeakStream stream(archive, 2, 5);
    check(stream.size() == n, "size() is the spectrum count");
    stream.start(mask, probe);
    const int threads = 4;
    std::vector<std::unique_ptr<PeakPickerHiRes>> pickers(threads);
    for (auto& p : pickers) p = std::make_unique<PeakPickerHiRes>();
#pragma omp parallel for num_threads(threads) schedule(FASTAG_MONOTONIC dynamic, 4)
    for (long i = 0; i < static_cast<long>(n); ++i)
    {
      if (!mask[static_cast<Size>(i)]) continue;
#ifdef _OPENMP
      PeakPickerHiRes& p = *pickers[static_cast<size_t>(omp_get_thread_num())];
#else
      PeakPickerHiRes& p = *pickers[0];
#endif
      try
      {
        compare(stream.take(static_cast<std::size_t>(i), p), want[static_cast<Size>(i)],
                "spectrum " + std::to_string(i));
      }
      catch (const Exception::BaseException& e)
      {
        check(false, std::string("take(") + std::to_string(i) + "): " + e.what());
      }
    }
    stream.finish();
    check(stream.picked() == (mask[profile_at] ? 1u : 0u), "picked() counts the taken profile MS2");
    for (const std::size_t i : probe) compare(stream.copy(i), want[i], "copy " + std::to_string(i));
    check(stream.copy(3).empty() && stream.copy(3).getNativeID().empty(), "no copy outside the probe set");
  }

  // B. readMzPeakSpectra: a subset, in order.
  {
    const std::vector<std::size_t> idx = {1, 4, profile_at, n - 2};
    std::vector<MSSpectrum> got;
    FASTag::readMzPeakSpectra(archive, 3, idx, [&got](MSSpectrum& s) { got.push_back(s); });
    check(got.size() == idx.size(), "readMzPeakSpectra hands out every index");
    for (Size k = 0; k < std::min(got.size(), idx.size()); ++k)
    {
      MSSpectrum w = ref[idx[k]];
      FASTag::centroidProfileMs2(w, picker);
      compare(got[k], w, "readMzPeakSpectra " + std::to_string(idx[k]));
    }
    bool threw = false;
    try
    {
      FASTag::readMzPeakSpectra(archive, 1, {n + 5}, [](MSSpectrum&) {});
    }
    catch (const Exception::BaseException&)
    {
      threw = true;
    }
    check(threw, "readMzPeakSpectra past the end throws");
  }

  // C. An unreadable archive: size() throws, it does not hang or report 0.
  {
    const std::string bad = (dir / "bad.mzpeak").string();
    { std::ofstream(bad) << "not an archive"; }
    bool threw = false;
    try
    {
      FASTag::MzPeakStream stream(bad, 1, 8);
      static_cast<void>(stream.size());
    }
    catch (const Exception::BaseException&)
    {
      threw = true;
    }
    check(threw, "an unreadable archive throws from size()");
  }

  // D. abort(): a waiting take() throws, and the reader stops.
  {
    FASTag::MzPeakStream stream(archive, 1, 2);
    static_cast<void>(stream.size());
    stream.start({});
    PeakPickerHiRes p;
    static_cast<void>(stream.take(0, p));
    stream.abort();
    bool threw = false;
    try
    {
      static_cast<void>(stream.take(n - 1, p));
    }
    catch (const Exception::BaseException&)
    {
      threw = true;
    }
    check(threw, "take() after abort() throws");
    stream.finish();
  }

  std::error_code ec;
  fs::remove_all(dir, ec);
  if (failures > 0)
  {
    std::cerr << "mzpeak_stream_test: " << failures << " checks FAILED\n";
    return 1;
  }
  std::cout << "mzpeak_stream_test: all checks passed (" << n << " spectra)\n";
  return 0;
}
