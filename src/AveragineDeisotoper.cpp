// Copyright (c) 2026 Oliver Kohlbacher and contributors
// Copyright (c) 2002-present, OpenMS Inc. -- EKU Tuebingen, ETH Zurich, and FU Berlin
// SPDX-License-Identifier: MIT AND BSD-3-Clause
//
// Ported from OpenMS release/3.5.0 (c49149d47d): Deisotoper.cpp's
// deisotopeWithAveragineModel, CoarseIsotopePatternGenerator::
// approximateIntensities, ThresholdMower and MSSpectrum::findNearest /
// sortByPosition. OpenMS is BSD-3-Clause; its notice is kept above.
//
// Every floating-point expression below is OpenMS's, operand for operand and
// in the same order: bit-identity depends on it. Where a line reads oddly
// (the float KL accumulated from doubles, x != x for NaN), that is why.

#include "AveragineDeisotoper.h"

#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/CONCEPT/Exception.h>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <limits>
#include <utility>
#include <vector>

using namespace OpenMS;

namespace FASTag
{
  namespace
  {
    // The arguments FASTag passes (see the header).
    constexpr unsigned MIN_ISOPEAKS = 2;
    constexpr unsigned MAX_ISOPEAKS = 10;

    /// ThresholdMower's default. OpenMS removes every peak below it before
    /// deisotoping, so this does too.
    constexpr double INTENSITY_THRESHOLD = 0.05;

    /// KL-divergence ceiling by cluster size, OpenMS's table.
    constexpr float AVERAGINE_CHECK_THRESHOLD[7] = {0.0f, 0.0f, 0.05f, 0.1f, 0.2f, 0.4f, 0.6f};

    /// CoarseIsotopePatternGenerator::approximateIntensities(mass, MAX_ISOPEAKS)
    /// into a caller's array instead of a fresh vector per candidate cluster,
    /// and NOT yet normalised: it returns the sum, and the caller divides each
    /// entry by it when it first reads it -- the same division, so the same
    /// double. Most candidates fail at their first isotope and read two.
    double approximateIntensities(double mass, double (&result)[MAX_ISOPEAKS])
    {
      const double factor = mass / 1800.0;  // lambda * mass, lambda from Bellew et al.
      double curr_intensity = 1.0;
      double sum = 1.0;
      result[0] = 1.0;
      for (unsigned k = 1; k < MAX_ISOPEAKS; ++k)
      {
        curr_intensity *= factor / k;
        result[k] = curr_intensity != curr_intensity ? 0.0 : curr_intensity;
        sum += result[k];
      }
      return sum;
    }

    /// Per-thread buffers: the tagging loop calls this once per spectrum on
    /// every worker, so they keep their capacity.
    struct Scratch
    {
      std::vector<int>      charge;     ///< per peak: its cluster's charge if monoisotopic, else 0
      std::vector<char>     clustered;  ///< per peak: in a kept cluster. OpenMS numbers the
                                        ///< clusters, but only ever tests the number against -1.
      std::vector<double>   mz;         ///< the peaks' m/z between -inf and +inf sentinels
      std::vector<size_t>   next;       ///< per charge: lower_bound of the last first-isotope target
      std::vector<double>   offset;     ///< [q * MAX_ISOPEAKS + i]: i isotope spacings at charge q
      std::vector<uint32_t> kept_idx;   ///< input index of every survivor whose m/z is unchanged
      std::vector<std::pair<Peak1D, uint32_t>> moved;  ///< survivors moved to charge 1, with input index
    };
  }

  void deisotopeAveragine(MSSpectrum& spec, double fragment_tolerance, bool fragment_unit_ppm,
                          int max_charge)
  {
    if ((fragment_unit_ppm && fragment_tolerance > 100) || (!fragment_unit_ppm && fragment_tolerance > 0.1))
    {
      throw Exception::IllegalArgument(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION,
                                       "Fragment tolerance must not be greater than 100 ppm or 0.1 Da");
    }
    // ponytail: prepare()'s working copy only; the header says why.
    assert(spec.isSorted());
    assert(spec.getPrecursors().empty());
    assert(spec.getFloatDataArrays().empty() && spec.getStringDataArrays().empty() &&
           spec.getIntegerDataArrays().empty());
    if (spec.empty()) return;

    // ThresholdMower::filterPeakSpectrum, in place.
    size_t n = 0;
    for (size_t i = 0; i != spec.size(); ++i)
      if (spec[i].getIntensity() >= INTENSITY_THRESHOLD) spec[n++] = spec[i];
    spec.resize(n);

    static thread_local Scratch S;
    const size_t n_charges = static_cast<size_t>(std::max(0, max_charge));
    S.charge.assign(n, 0);
    S.clustered.assign(n, 0);
    S.next.assign(n_charges + 1, 1);  // index 1: the first peak, past the sentinel
    S.offset.resize((n_charges + 1) * MAX_ISOPEAKS);
    for (size_t q = 1; q <= n_charges; ++q)
      for (unsigned i = 1; i < MAX_ISOPEAKS; ++i)
        // For i == 1 OpenMS writes C13C12 / q; 1.0 * C13C12 is exact, so the same double.
        S.offset[q * MAX_ISOPEAKS + i] =
          static_cast<double>(i) * Constants::C13C12_MASSDIFF_U / static_cast<double>(q);

    const Peak1D* const pk = spec.data();
    const double ppm_factor = fragment_tolerance / 1e6;  // Math::ppmToMass's first step

    // The m/z values alone, densely, between sentinels: mzs[i + 1] is peak i.
    // The sentinels stand in for OpenMS's two border cases -- nothing is
    // nearer than a finite peak -- so the searches below need no bounds tests.
    S.mz.resize(n + 2);
    S.mz[0] = -std::numeric_limits<double>::infinity();
    for (size_t i = 0; i != n; ++i) S.mz[i + 1] = pk[i].getMZ();
    S.mz[n + 1] = std::numeric_limits<double>::infinity();
    const double* const mzs = S.mz.data();

    // MSSpectrum::findNearest(mz, tolerance), handed k = lower_bound(mz) in
    // sentinel indexing: the nearer of k and k - 1, a tie going to k - 1,
    // then OpenMS's own window test (NOT |found - mz| <= tolerance, which
    // rounds differently). Returns the peak index or -1.
    auto nearest = [mzs](size_t k, double mz, double tolerance) -> int
    {
      const size_t j = std::fabs(mzs[k] - mz) < std::fabs(mzs[k - 1] - mz) ? k : k - 1;
      const double found_mz = mzs[j];
      return ((found_mz >= mz - tolerance) & (found_mz <= mz + tolerance)) ? static_cast<int>(j) - 1 : -1;
    };

    for (size_t current_peak = 0; current_peak != n; ++current_peak)
    {
      // Peaks already in a cluster would only re-form a tail of it.
      if (S.clustered[current_peak]) continue;

      const double current_mz = pk[current_peak].getMZ();
      const double current_intensity = pk[current_peak].getIntensity();
      const double tolerance_dalton = fragment_unit_ppm ? ppm_factor * current_mz : fragment_tolerance;

      // The best cluster so far. OpenMS stores every charge's cluster and then
      // takes the largest, ties to the higher charge; charges rise here, so a
      // cluster at least as large as the best replaces it.
      size_t best[MAX_ISOPEAKS];
      size_t best_size = 0;
      int best_charge = 0;

      for (size_t q = 1; q <= n_charges; ++q)
      {
        const double* const offset = &S.offset[q * MAX_ISOPEAKS];

        // Fail early if not even the first isotope is there.
        //
        // No binary search: this target rises with current_peak (the spectrum
        // is sorted, and rounding is monotonic), so its lower_bound never moves
        // left. next[q] carries it from peak to peak, and the scan from it
        // lands on exactly the index std::lower_bound would return. It rarely
        // moves more than three, so those steps are taken without a branch.
        double expected_mz = current_mz + offset[1];
        size_t k = S.next[q];
        k += mzs[k] < expected_mz;
        k += mzs[k] < expected_mz;
        k += mzs[k] < expected_mz;
        while (mzs[k] < expected_mz) ++k;
        S.next[q] = k;
        int p = nearest(k, expected_mz, tolerance_dalton);
        if (p == -1) continue;

        size_t extensions[MAX_ISOPEAKS];
        double extensions_intensities[MAX_ISOPEAKS];
        size_t n_ext = 1;
        extensions[0] = current_peak;
        extensions_intensities[0] = current_intensity;

        double distr[MAX_ISOPEAKS];
        const double distr_sum = approximateIntensities(q * (current_mz - Constants::PROTON_MASS_U), distr);
        distr[0] /= distr_sum;
        double spec_total_intensity = current_intensity;
        double dist_total_intensity = distr[0];
        bool has_min_isopeaks = true;

        for (unsigned i = 1; i < MAX_ISOPEAKS; ++i)
        {
          if (i > 1)  // the first extension was found above
          {
            // Targets rise with i too, so the scan resumes where the last stopped.
            expected_mz = current_mz + offset[i];
            while (mzs[k] < expected_mz) ++k;
            p = nearest(k, expected_mz, tolerance_dalton);
            if (p == -1)
            {
              has_min_isopeaks = (i >= MIN_ISOPEAKS);
              break;
            }
          }

          extensions_intensities[n_ext] = pk[p].getIntensity();
          spec_total_intensity += extensions_intensities[n_ext];
          distr[n_ext] /= distr_sum;
          dist_total_intensity += distr[n_ext];

          // KL divergence of the normalised observed intensities from the model.
          float KL = 0;
          for (size_t peak = 0; peak != n_ext + 1; ++peak)
          {
            const double Px = extensions_intensities[peak] / spec_total_intensity;
            KL += Px * std::log(Px / (distr[peak] / dist_total_intensity));
          }
          const float curr_threshold = (n_ext + 1 >= 6) ? AVERAGINE_CHECK_THRESHOLD[6]
                                                         : AVERAGINE_CHECK_THRESHOLD[n_ext + 1];
          if (KL > curr_threshold)
          {
            has_min_isopeaks = (i >= MIN_ISOPEAKS);
            break;
          }
          extensions[n_ext++] = static_cast<size_t>(p);
        }

        if (has_min_isopeaks && n_ext >= best_size)
        {
          std::copy(extensions, extensions + n_ext, best);
          best_size = n_ext;
          best_charge = static_cast<int>(q);
        }
      }

      if (best_size > 0)
      {
        S.charge[current_peak] = best_charge;
        for (size_t i = 0; i != best_size; ++i) S.clustered[best[i]] = 1;
      }
    }

    // Keep every unclustered peak and each cluster's monoisotopic peak, moved
    // to the singly-charged scale; drop the other isotope peaks. At charge 1
    // the move is m/z * 1 - 0 * proton, which is m/z exactly, so those peaks
    // stay where they are.
    S.kept_idx.clear();
    S.moved.clear();
    size_t w = 0;
    for (size_t i = 0; i != n; ++i)
    {
      const Size z = static_cast<Size>(S.charge[i]);
      if (!S.clustered[i] || z == 1)
      {
        S.kept_idx.push_back(static_cast<uint32_t>(i));
        spec[w++] = spec[i];
      }
      else if (z != 0)
      {
        Peak1D moved = spec[i];
        moved.setMZ(spec[i].getMZ() * z - (z - 1) * Constants::PROTON_MASS_U);
        S.moved.emplace_back(moved, static_cast<uint32_t>(i));
      }
    }

    // OpenMS then sorts stably by m/z: order by (m/z, input position). The
    // unmoved survivors already are, so only the moved ones need sorting, and
    // then one merge from the back, in place -- no temporary spectrum.
    const auto after = [](double mz_a, uint32_t idx_a, double mz_b, uint32_t idx_b)
    { return mz_a > mz_b || (mz_a == mz_b && idx_a > idx_b); };
    std::sort(S.moved.begin(), S.moved.end(), [&after](const auto& a, const auto& b)
              { return after(b.first.getMZ(), b.second, a.first.getMZ(), a.second); });
    size_t i = w, j = S.moved.size(), out = w + S.moved.size();
    spec.resize(out);
    while (j > 0)
    {
      if (i > 0 && after(spec[i - 1].getMZ(), S.kept_idx[i - 1],
                         S.moved[j - 1].first.getMZ(), S.moved[j - 1].second))
        spec[--out] = spec[--i];
      else
        spec[--out] = S.moved[--j].first;
    }
  }
}
