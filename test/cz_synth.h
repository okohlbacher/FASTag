// Synthetic c/z-dot (and b/y) fragment spectra for the #15 phase B tests
// (ion_series_test.cpp, tagrecon_test.cpp), from OpenMS's
// TheoreticalSpectrumGenerator: never from FASTag's own ion formulas, so a
// wrong offset in src/IonSeries.h cannot cancel out.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/CHEMISTRY/AASequence.h>
#include <OpenMS/CHEMISTRY/TheoreticalSpectrumGenerator.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/DATASTRUCTURES/Param.h>
#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cstdint>
#include <random>
#include <string>

namespace CzSynth
{
  struct Spec
  {
    OpenMS::MSSpectrum spec;
    double prec_mz = 0;
    double M = 0;  ///< neutral peptide mass
  };

  /// Which ladders a spectrum carries.
  enum class Ions
  {
    CZ,     ///< c and z-dot (z+1) ions, as ETD/ECD
    C,      ///< c ions only
    Z,      ///< z-dot ions only
    BY,     ///< b and y ions, as CID/HCD
  };

  /// The fragment spectrum of @p pep (OpenMS notation, modifications
  /// allowed) at precursor charge @p prec_charge: the chosen ladders at
  /// fragment charges 1 .. @p max_frag_charge, unit-ish intensities from a
  /// fixed seed (std::mt19937's raw output, deterministic on every platform),
  /// and @p noise random peaks between 150 Da and the peptide mass.
  inline Spec make(const std::string& pep, int prec_charge, Ions ions, int max_frag_charge = 1, int noise = 0,
                   unsigned seed = 1)
  {
    const double P = OpenMS::Constants::PROTON_MASS_U;
    const OpenMS::AASequence aa = OpenMS::AASequence::fromString(pep);
    Spec r;
    r.M = aa.getMonoWeight();
    r.prec_mz = (r.M + prec_charge * P) / prec_charge;

    OpenMS::TheoreticalSpectrumGenerator tsg;
    OpenMS::Param p = tsg.getParameters();
    const auto on = [](bool b) { return b ? "true" : "false"; };
    p.setValue("add_b_ions", on(ions == Ions::BY));
    p.setValue("add_y_ions", on(ions == Ions::BY));
    p.setValue("add_c_ions", on(ions == Ions::CZ || ions == Ions::C));
    p.setValue("add_zp1_ions", on(ions == Ions::CZ || ions == Ions::Z));
    p.setValue("add_first_prefix_ion", "false");
    p.setValue("add_metainfo", "false");
    p.setValue("add_losses", "false");
    p.setValue("add_precursor_peaks", "false");
    tsg.setParameters(p);
    OpenMS::PeakSpectrum th;
    tsg.getSpectrum(th, aa, 1, max_frag_charge);

    std::mt19937 rng(seed);
    const auto u01 = [&rng]() { return (rng() >> 8) * (1.0 / 16777216.0); };
    for (const auto& pk : th) r.spec.emplace_back(pk.getMZ(), 0.5 + 0.5 * u01());
    const double hi = r.M > 190.0 ? r.M - 40.0 : 150.0;
    for (int k = 0; k < noise; ++k)
    {
      // One draw per statement, intensity first (the x86-64 GCC order); see complement_synth.h.
      const double in = 0.02 + 0.2 * u01();
      const double mz = 150.0 + (hi - 150.0) * u01();
      r.spec.emplace_back(mz, in);
    }
    r.spec.sortByPosition();
    return r;
  }
}
