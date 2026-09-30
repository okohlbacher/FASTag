// OpenMS's averagine deisotoper, ported for the one way FASTag calls it.
//
// Deisotoper::deisotopeWithAveragineModel was the largest single cost in the
// tagging loop, and most of it was not the algorithm: an out-of-line binary
// search per isotope position, two vectors allocated per candidate cluster,
// and a DefaultParamHandler built and queried by name on every call.
//
// This is the same algorithm without those costs, and it is BIT-IDENTICAL to
// OpenMS release/3.5.0 (c49149d47d): same peaks, same order, same m/z doubles
// and intensity floats. test/deisotoper_test.cpp proves it against OpenMS on
// synthetic edge cases and, given an archive, on every spectrum of a real run.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>

namespace FASTag
{
  /// Equivalent to OpenMS
  ///   Deisotoper::deisotopeWithAveragineModel(spectrum, fragment_tolerance,
  ///     fragment_unit_ppm, 0, 1, max_charge, false, 2, 10, true, false, false, false)
  /// i.e. no peak cap, charges 1..max_charge, unclustered peaks kept, 2 to 10
  /// isotope peaks, monoisotopic peaks moved to the singly-charged scale, no
  /// annotations and no intensity summing.
  ///
  /// ponytail: only the parameter combination FASTag uses; OpenMS remains the
  /// reference. The spectrum must also be what prepare() hands over: sorted by
  /// m/z, finite, with no data arrays and no precursor. OpenMS would cut
  /// candidate clusters at the precursor mass; FASTag's working copy has
  /// none, so that branch never runs there and is not ported.
  ///
  /// @throws OpenMS::Exception::IllegalArgument above 100 ppm or 0.1 Da, as
  ///   OpenMS does.
  void deisotopeAveragine(OpenMS::MSSpectrum& spectrum, double fragment_tolerance,
                          bool fragment_unit_ppm, int max_charge);
}
