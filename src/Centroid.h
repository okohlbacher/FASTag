// Centroiding of profile MS2 before tagging (FASTag 1.12 #9).
//
// FASTag tags peaks, not profile samples. Up to 1.11 only the mzPeak reader
// centroided profile MS2 (PeakPickerHiRes, defaults); mzML profile MS2 was
// tagged as sampled. -pick_profile chooses where picking runs:
//
//   legacy  mzPeak only, as in 1.11 (the default until validated);
//   auto    every PROFILE MS2 on every reader except MGF (and -stream, which
//           refuses the option): mzML through the fast reader,
//           OnDiscMSExperiment or a full load, and mzPeak;
//   off     nothing, mzPeak included (for experts).
//
// Under auto a spectrum whose points are out of m/z order is picked from a
// sorted copy (centroidProfileMs2, @p sort); legacy picks mzPeak points as
// stored, exactly as 1.11.
//
// A CENTROID spectrum is never re-picked. An UNKNOWN-typed spectrum (no
// MS:1000127/128 anywhere, e.g. in a converter's output) is picked only under
// auto with -pick_unknown_type, and only when OpenMS's PeakTypeEstimator
// (MSSpectrum::getType(true)) reads its data as PROFILE.
//
// -out_spectra exports the spectra as they were tagged: picked under auto,
// mzPeak picked under legacy (1.11), unpicked under off.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <cstddef>
#include <string>

namespace OpenMS
{
  class MSSpectrum;
  class PeakPickerHiRes;
}

namespace FASTag
{
  /// Centroids @p s in place if it is a non-empty PROFILE MS2, with @p picker
  /// (one per thread: PeakPickerHiRes is not thread-safe).
  ///
  /// With @p pick_unknown, an MS2 of type UNKNOWN is picked too when its data
  /// look like profile (MSSpectrum::getType(true)). A picker that yields
  /// nothing (data too sparse for peak shapes) leaves the spectrum as it was.
  /// Returns +1 when picked, -1 when picking yielded nothing (or threw), 0
  /// when the spectrum needed no picking.
  ///
  /// With @p sort, a spectrum whose points are not in m/z order is picked
  /// from a copy sorted by m/z: PeakPickerHiRes walks neighbouring points
  /// and needs sorted input. Thermo profile mzML (PXD000865, msconvert) puts
  /// a zero-intensity padding point after the last sample of a peak at a
  /// slightly LOWER m/z; picked unsorted, that peak's boundary and centroid
  /// shift (and its spline can overshoot), picked sorted it is the peak an
  /// mzPeak archive of the same file gives (mzpeak-convert stores points in
  /// m/z order). Without @p sort the points are picked as stored (FASTag
  /// 1.11 on mzPeak).
  int centroidProfileMs2(OpenMS::MSSpectrum& s, OpenMS::PeakPickerHiRes& picker, bool pick_unknown = false,
                         bool sort = false);

  namespace Centroid
  {
    /// -pick_profile.
    enum class Mode
    {
      Legacy,
      Auto,
      Off
    };
    inline constexpr const char* kModeDefault = "legacy";
    inline constexpr const char* kModeValues = "legacy,auto,off";

    /// The reader a spectrum comes from.
    enum class Input
    {
      MzML,
      MzPeak,
      Mgf
    };

    /// What a reader does with each MS2 it reads.
    struct Policy
    {
      bool pick = false;     ///< run centroidProfileMs2
      bool unknown = false;  ///< ... with pick_unknown
      bool sort = false;     ///< ... with sort (auto; legacy picks as 1.11 did)
    };

    /// Parses a -pick_profile value; false (and @p mode untouched) if invalid.
    bool parseMode(const std::string& value, Mode& mode);

    /// The policy of @p mode on @p input; @p pick_unknown_type is
    /// -pick_unknown_type, read only under Auto.
    Policy policyFor(Mode mode, Input input, bool pick_unknown_type);

    /// centroidProfileMs2 when @p policy picks, else 0.
    int apply(OpenMS::MSSpectrum& s, OpenMS::PeakPickerHiRes& picker, const Policy& policy);

    /// centroidProfileMs2 outcomes, per thread, summed after the loop.
    struct Counts
    {
      std::size_t picked = 0;  ///< +1
      std::size_t failed = 0;  ///< -1: kept as profile, picking yielded nothing
      void add(int r)
      {
        if (r > 0) ++picked;
        else if (r < 0) ++failed;
      }
      void merge(const Counts& o)
      {
        picked += o.picked;
        failed += o.failed;
      }
    };
  }
}
