// Centroiding of profile MS2 before tagging (FASTag 1.12 #9).
//
// FASTag tags peaks, not profile samples. Up to 1.11 only the mzPeak reader
// centroided profile MS2 (PeakPickerHiRes, defaults); mzML profile MS2 was
// tagged as sampled. -pick_profile chooses where picking runs:
//
//   legacy  mzPeak only, as in 1.11 (the default); points picked as stored;
//   off     nothing, mzPeak included (for experts).
//
// auto (every PROFILE MS2 on mzML and mzPeak) and -pick_unknown_type failed
// their held-out test and were removed in 1.14; auto is read as legacy.
// A CENTROID or UNKNOWN-typed spectrum is never picked.
//
// -out_spectra exports the spectra as they were tagged: mzPeak picked under
// legacy (1.11), unpicked under off.
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
  /**
    @brief Centroids @p s in place if it is a non-empty PROFILE MS2.

    Points are picked as stored (FASTag 1.11 on mzPeak). A picker that
    yields nothing (data too sparse for peak shapes) leaves the spectrum as
    it was.

    @param[in,out] s the spectrum; replaced by its centroided form when picked
    @param[in,out] picker the peak picker, one per thread (PeakPickerHiRes is not thread-safe)
    @return +1 when picked, -1 when picking yielded nothing (or threw), 0 when
      the spectrum needed no picking
  */
  int centroidProfileMs2(OpenMS::MSSpectrum& s, OpenMS::PeakPickerHiRes& picker);

  namespace Centroid
  {
    /**
      @brief The -pick_profile mode.
    */
    enum class Mode
    {
      LEGACY,  ///< mzPeak only, as in 1.11 (the default)
      OFF      ///< no picking, mzPeak included
    };
    /// @brief The default -pick_profile value.
    inline constexpr const char* kModeDefault = "legacy";
    /// @brief The valid -pick_profile values.
    ///
    /// auto stays valid (1.14: removed, read as legacy; FASTag.cpp kRemovedValues).
    inline constexpr const char* kModeValues = "legacy,auto,off";

    /**
      @brief The reader a spectrum comes from.
    */
    enum class Input
    {
      MZML,
      MZPEAK,
      MGF
    };

    /**
      @brief What a reader does with each MS2 it reads.
    */
    struct Policy
    {
      bool pick = false;     ///< run centroidProfileMs2
    };

    /**
      @brief Parses a -pick_profile value.
      @param[in] value "legacy" or "off"
      @param[out] mode the parsed mode; untouched if @p value is invalid
      @return false if @p value is invalid
    */
    bool parseMode(const std::string& value, Mode& mode);

    /**
      @brief The policy of @p mode on @p input: legacy picks mzPeak only.
      @param[in] mode the -pick_profile mode
      @param[in] input the reader
      @return the policy
    */
    Policy policyFor(Mode mode, Input input);

    /**
      @brief Applies centroidProfileMs2 when @p policy picks.
      @param[in,out] s the spectrum
      @param[in,out] picker the calling thread's peak picker
      @param[in] policy the reader's policy
      @return centroidProfileMs2()'s result when @p policy picks, else 0
    */
    int apply(OpenMS::MSSpectrum& s, OpenMS::PeakPickerHiRes& picker, const Policy& policy);
  }
}
