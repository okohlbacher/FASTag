// OpenMS's averagine deisotoper, ported for the one way FASTag calls it.
//
// Deisotoper::deisotopeWithAveragineModel was the largest single cost in the
// tagging loop at benchmark settings: 26.4% of worker CPU (12.4% at tool
// defaults), on the unreduced peak list -- diaTracer spectra carry exactly 500
// peaks. Most of that was not the algorithm. It was an out-of-line binary
// search per isotope position (14.9% of CPU on its own), a vector allocated
// per candidate cluster for the averagine intensities and another for the
// observed ones, and a DefaultParamHandler built and queried by name on every
// call just to drop sub-0.05 intensities.
//
// This is the same algorithm with those costs taken out, and it is
// BIT-IDENTICAL to the OpenMS it replaces: same peaks, same order, same m/z
// doubles and intensity floats. test/deisotoper_test.cpp proves it against
// OpenMS on synthetic edge cases and, given an archive, on every spectrum of
// a real run.
//
// Source: OpenMS release/3.5.0 (c49149d47d, 2025-12-10), the tree the conda
// package FASTag links ("3.5.0-pre-exported-20251212") was exported from; its
// installed headers match that tag byte for byte.
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
