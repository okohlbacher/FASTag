// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "Centroid.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/PROCESSING/CENTROIDING/PeakPickerHiRes.h>

#include <utility>

using namespace OpenMS;

namespace FASTag
{
  int centroidProfileMs2(MSSpectrum& s, PeakPickerHiRes& picker, bool pick_unknown, bool sort)
  {
    if (s.getMSLevel() != 2 || s.empty()) return 0;
    const SpectrumSettings::SpectrumType t = s.getType();
    if (t != SpectrumSettings::SpectrumType::PROFILE)
    {
      // getType(true): the data processing entries, then the data
      // (PeakTypeEstimator), for a spectrum without a declared type.
      if (!pick_unknown || t != SpectrumSettings::SpectrumType::UNKNOWN ||
          s.getType(true) != SpectrumSettings::SpectrumType::PROFILE)
        return 0;
    }
    // pick() copies the spectrum's metadata (precursors included) and labels
    // the result CENTROID.
    MSSpectrum picked;
    try
    {
      if (sort && !s.isSorted())
      {
        // A sorted copy: a spectrum picking leaves alone stays as it was.
        MSSpectrum sorted = s;
        sorted.sortByPosition();
        picker.pick(sorted, picked);
      }
      else picker.pick(s, picked);
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
      else if (value == "auto") mode = Mode::Auto;
      else if (value == "off") mode = Mode::Off;
      else return false;
      return true;
    }

    Policy policyFor(Mode mode, Input input, bool pick_unknown_type)
    {
      Policy p;
      switch (mode)
      {
        case Mode::Legacy: p.pick = input == Input::MzPeak; break;
        case Mode::Auto:
          p.pick = input != Input::Mgf;
          p.unknown = p.pick && pick_unknown_type;
          p.sort = p.pick;
          break;
        case Mode::Off: break;
      }
      return p;
    }

    int apply(MSSpectrum& s, PeakPickerHiRes& picker, const Policy& policy)
    {
      return policy.pick ? centroidProfileMs2(s, picker, policy.unknown, policy.sort) : 0;
    }
  }
}
