// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $

#include "Centroid.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/PROCESSING/CENTROIDING/PeakPickerHiRes.h>

#include <utility>

using namespace OpenMS;

namespace FASTag
{
  int centroidProfileMs2(MSSpectrum& s, PeakPickerHiRes& picker)
  {
    if (s.getMSLevel() != 2 || s.empty()) return 0;
    if (s.getType() != SpectrumSettings::SpectrumType::PROFILE) return 0;
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

  namespace Centroid
  {
    bool parseMode(const std::string& value, Mode& mode)
    {
      if (value == "legacy") mode = Mode::Legacy;
      else if (value == "off") mode = Mode::Off;
      else return false;
      return true;
    }

    Policy policyFor(Mode mode, Input input)
    {
      Policy p;
      p.pick = mode == Mode::Legacy && input == Input::MzPeak;
      return p;
    }

    int apply(MSSpectrum& s, PeakPickerHiRes& picker, const Policy& policy)
    {
      return policy.pick ? centroidProfileMs2(s, picker) : 0;
    }
  }
}
