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
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <OpenMS/KERNEL/MSSpectrum.h>

namespace FASTag
{
  /**
    @brief Deisotopes a spectrum in place with the averagine model, bit-identical to OpenMS for FASTag's parameters.

    Equivalent to OpenMS
      Deisotoper::deisotopeWithAveragineModel(spectrum, fragment_tolerance,
        fragment_unit_ppm, 0, 1, max_charge, false, 2, 10, true, false, false, false)
    i.e. no peak cap, charges 1..max_charge, unclustered peaks kept, 2 to 10
    isotope peaks, monoisotopic peaks moved to the singly-charged scale, no
    annotations and no intensity summing.

    Scope: only the parameter combination FASTag uses; OpenMS remains the
    reference. The spectrum must also be what prepare() hands over: sorted by
    m/z, finite, with no data arrays and no precursor. OpenMS would cut
    candidate clusters at the precursor mass; FASTag's working copy has
    none, so that branch never runs there and is not ported.

    @param[in,out] spectrum Spectrum to deisotope; replaced by the deisotoped peaks.
    @param[in] fragment_tolerance Fragment mass tolerance (ppm or Da, see @p fragment_unit_ppm).
    @param[in] fragment_unit_ppm Whether @p fragment_tolerance is in ppm (true) or Da (false).
    @param[in] max_charge Highest fragment charge considered (charges 1..max_charge).
    @param[in] intensity_threshold The ThresholdMower step: peaks below it are
      removed first. 0.05 is OpenMS's default (and what bit-identity with it
      means); it is an ABSOLUTE intensity, so a caller with relative
      intensities passes a scaled one.

    @throw OpenMS::Exception::IllegalArgument above 100 ppm or 0.1 Da, as
      OpenMS does.
  */
  void deisotopeAveragine(OpenMS::MSSpectrum& spectrum, double fragment_tolerance,
                          bool fragment_unit_ppm, int max_charge,
                          double intensity_threshold = 0.05);
}
