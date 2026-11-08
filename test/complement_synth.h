// Synthetic fragment spectra for complement_test.cpp and its 1.11 reference
// generator (complement_ref_gen.cpp). Depends on OpenMS only, never on the
// FASTag library, so the generator builds unchanged against FASTag 1.11.0
// (78390cd) and the test against the current tree.
//
// Deterministic on every platform: the random numbers are std::mt19937's raw
// 32-bit output (fixed by the standard), mapped to [0,1) by hand; the
// std::*_distribution classes are implementation-defined and are not used.
// Every RNG draw must be its own statement: two draws in one expression or
// argument list are unsequenced, so the result would follow the compiler's
// evaluation order (x86-64 GCC right to left, clang and aarch64 left to right).
// The sequenced draws below keep the x86-64 GCC order of FASTag 1.11, from
// which complement_ref_1_11.inc was made. (The .inc names the sha256 of this
// header before the draws were sequenced; the generator gives the same table,
// byte for byte, with this version on x86-64.)
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/CHEMISTRY/AASequence.h>
#include <OpenMS/CHEMISTRY/Residue.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cmath>
#include <cstdint>
#include <random>
#include <string>

namespace ComplementSynth
{
  constexpr double kC13 = 1.0033548378;  ///< 13C - 12C

  inline double u01(std::mt19937& rng) { return (rng() >> 8) * (1.0 / 16777216.0); }

  /// Adds the monoisotopic peak of a fragment of neutral mass @p neutral at
  /// charge @p z, with @p iso isotope peaks after it in an averagine-like
  /// Poisson ratio (lambda ~ 0.00055 per Da), spaced 1.00336/z.
  inline void addFragment(OpenMS::MSSpectrum& s, double neutral, int z, double intensity, int iso,
                          double shift = 0.0)
  {
    const double P = OpenMS::Constants::PROTON_MASS_U;
    const double mz = (neutral + z * P) / z + shift;
    const double lambda = neutral * 0.00055;
    double term = 1.0;
    for (int k = 0; k <= iso; ++k)
    {
      if (k > 0) term *= lambda / k;
      s.emplace_back(mz + k * kC13 / z, intensity * term);
    }
  }

  /// Spectrum and precursor of @p pep at charge @p prec_charge.
  ///   b ions at 1+; y ions at 2+ when @p y2 (otherwise 1+); a y ion is never
  ///   put at 2+ below 400 Da neutral, as on an instrument.
  ///   @p iso isotope peaks per fragment (0 = monoisotopic only).
  ///   @p shift Da added to every fragment m/z (pair sums move by 2*shift).
  ///   @p noise random peaks between 150 and the precursor's neutral mass.
  struct Spec
  {
    OpenMS::MSSpectrum spec;
    double prec_mz = 0;
    double M = 0;  ///< neutral peptide mass
  };

  inline Spec make(const std::string& pep, int prec_charge, bool y2, int iso, double shift,
                   int noise, unsigned seed)
  {
    const double P = OpenMS::Constants::PROTON_MASS_U;
    const OpenMS::AASequence aa = OpenMS::AASequence::fromString(pep);
    Spec r;
    r.M = aa.getMonoWeight();
    r.prec_mz = (r.M + prec_charge * P) / prec_charge;
    std::mt19937 rng(seed);
    for (size_t i = 1; i < aa.size(); ++i)
    {
      const double nb = aa.getPrefix(i).getMonoWeight(OpenMS::Residue::BIon, 1) - P;
      const double ny = aa.getSuffix(aa.size() - i).getMonoWeight(OpenMS::Residue::YIon, 1) - P;
      addFragment(r.spec, nb, 1, 0.5 + 0.5 * u01(rng), iso, shift);
      const int zy = (y2 && ny >= 400.0) ? 2 : 1;
      addFragment(r.spec, ny, zy, 0.5 + 0.5 * u01(rng), iso, shift);
    }
    const double hi = std::max(300.0, r.M - 40.0);
    for (int k = 0; k < noise; ++k)
    {
      const double in = 0.02 + 0.2 * u01(rng);  // intensity first (x86-64 GCC order)
      const double mz = 150.0 + (hi - 150.0) * u01(rng);
      r.spec.emplace_back(mz, in);
    }
    r.spec.sortByPosition();
    return r;
  }

  /// The five spectra of the stored 1.11 E-value vector (test (e)).
  struct Case
  {
    const char* pep;
    int charge;
    bool y2;
    int iso;
    int noise;
    unsigned seed;
  };
  inline constexpr Case kRefCases[5] = {
      {"VGAHAGEYGAEALER", 2, false, 2, 30, 11},
      {"SAMPLERKDLVEGFNTWQR", 3, true, 2, 40, 12},
      {"LLEQTHGGLNAIPKDEFAR", 3, false, 0, 25, 13},
      {"ELVISLIVESMPEPTIDEHR", 4, true, 3, 60, 14},
      {"GDFQKMVYTNPAWSR", 2, false, 1, 15, 15},
  };
}
