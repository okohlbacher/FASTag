// Synthetic c/z-dot, hybrid (1.13 item 10) and b/y fragment spectra for the #15 phase B tests
// (ion_series_test.cpp, tagrecon_test.cpp), from OpenMS's
// TheoreticalSpectrumGenerator: never from FASTag's own ion formulas, so a
// wrong offset in src/IonSeries.h cannot cancel out.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/CHEMISTRY/AASequence.h>
#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/TheoreticalSpectrumGenerator.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/DATASTRUCTURES/Param.h>
#include <OpenMS/KERNEL/MSSpectrum.h>

#include <cstdint>
#include <random>
#include <string>
#include <vector>

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
    BYCZ,   ///< b, y, c and z-dot ions (1.13 item 10, an EThcD-like mixture)
    /// 1.13 item 10, mixed y/z: the C-terminal half of the cleavage sites as
    /// b/y ions (y_i and b_(n-i) for i <= n/2) and the N-terminal half as
    /// c/z-dot ions (z_i and c_(n-i) for i > n/2), so a b/y reading spells
    /// only the C-terminal residues correctly and a c/z reading only the
    /// N-terminal ones.
    SPLIT,
  };

  /// One series' ions of @p aa at fragment charge @p z from
  /// TheoreticalSpectrumGenerator, ordered by ion index (1 .. n-1; the first
  /// prefix ion included): a single-type ladder at one charge rises with the
  /// index, so its m/z order is its index order.
  inline std::vector<double> ladder(const OpenMS::AASequence& aa, const char* type, int z)
  {
    OpenMS::TheoreticalSpectrumGenerator g;
    OpenMS::Param q = g.getParameters();
    for (const char* t : {"b", "y", "a", "x", "c", "zp1"})
      q.setValue(std::string("add_") + t + "_ions", std::string(t) == type ? "true" : "false");
    q.setValue("add_first_prefix_ion", "true");
    q.setValue("add_metainfo", "false");
    q.setValue("add_losses", "false");
    q.setValue("add_precursor_peaks", "false");
    g.setParameters(q);
    OpenMS::PeakSpectrum one;
    g.getSpectrum(one, aa, z, z);
    one.sortByPosition();
    std::vector<double> mz;
    for (const auto& pk : one) mz.push_back(pk.getMZ());
    return mz;
  }

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

    OpenMS::PeakSpectrum th;
    if (ions == Ions::SPLIT)
    {
      const std::size_t n = aa.size(), h = n / 2;
      for (int z = 1; z <= max_frag_charge; ++z)
      {
        const std::vector<double> b = ladder(aa, "b", z), y = ladder(aa, "y", z), c = ladder(aa, "c", z),
                                  zz = ladder(aa, "zp1", z);
        // ion index i = vector index + 1; a ladder that is not n - 1 long
        // leaves the spectrum empty, so a test on it fails visibly.
        if (b.size() != n - 1 || y.size() != n - 1 || c.size() != n - 1 || zz.size() != n - 1) return r;
        for (std::size_t i = 1; i < n; ++i)
        {
          OpenMS::Peak1D pk;
          if (i <= h)
          {
            pk.setMZ(y[i - 1]);
            th.push_back(pk);
            pk.setMZ(b[n - i - 1]);
            th.push_back(pk);
          }
          else
          {
            pk.setMZ(zz[i - 1]);
            th.push_back(pk);
            pk.setMZ(c[n - i - 1]);
            th.push_back(pk);
          }
        }
      }
      th.sortByPosition();
    }
    OpenMS::TheoreticalSpectrumGenerator tsg;
    OpenMS::Param p = tsg.getParameters();
    const auto on = [](bool b) { return b ? "true" : "false"; };
    p.setValue("add_b_ions", on(ions == Ions::BY || ions == Ions::BYCZ));
    p.setValue("add_y_ions", on(ions == Ions::BY || ions == Ions::BYCZ));
    p.setValue("add_a_ions", "false");
    p.setValue("add_x_ions", "false");
    p.setValue("add_c_ions", on(ions == Ions::CZ || ions == Ions::C || ions == Ions::BYCZ));
    p.setValue("add_zp1_ions", on(ions == Ions::CZ || ions == Ions::Z || ions == Ions::BYCZ));
    p.setValue("add_first_prefix_ion", "false");
    p.setValue("add_metainfo", "false");
    p.setValue("add_losses", "false");
    p.setValue("add_precursor_peaks", "false");
    tsg.setParameters(p);
    if (ions != Ions::SPLIT) tsg.getSpectrum(th, aa, 1, max_frag_charge);

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

  /// Issue T25: an averagine-shaped (Poisson, lambda = mass / 1800) isotope
  /// cluster of 4 peaks at charge 2 whose 1+ equivalent lies @p above Da over
  /// the tagger's precursor cut (M + proton + 1.5), while every peak of the
  /// cluster as measured lies below it. Intense (@p scale), so the deisotoper
  /// reads it at 2+ and moves it to the 1+ scale. Appended to @p s.spec
  /// (re-sorted); returns the 1+ m/z the deisotoper moves it to.
  inline double addReducedAboveCut(Spec& s, double above = 150.0, double scale = 20.0)
  {
    const double P = OpenMS::Constants::PROTON_MASS_U, C13 = 1.0033548378;
    const double mz1 = s.M + P + 1.5 + above;  // the 1+ monoisotopic m/z
    const double mass = mz1 - P;               // its neutral mass
    double w = 1.0;
    for (int k = 0; k < 4; ++k)
    {
      if (k > 0) w *= mass / 1800.0 / k;
      s.spec.emplace_back((mass + 2 * P) / 2 + k * C13 / 2, scale * w);
    }
    s.spec.sortByPosition();
    return mz1;
  }
}
