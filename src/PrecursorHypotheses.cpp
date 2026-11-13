// Precursor charge and isotope hypotheses (FASTag 1.12, item #6). See the header.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#include "PrecursorHypotheses.h"

#include <OpenMS/CONCEPT/Constants.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>
#include <set>

namespace FASTag::Hyp
{
  namespace
  {
    const double kProton = OpenMS::Constants::PROTON_MASS_U;
    const double kC13 = OpenMS::Constants::C13C12_MASSDIFF_U;
    /// c/z range evidence: a charge-reduced species' window, as the tagger's
    /// ETD filter (FASTagger.cpp ETD_REDUCED_ABOVE): one H below (hydrogen
    /// transfer), its isotopes and H transfer up to 3 Da above, neutral.
    constexpr double kHydrogen = 1.00782503207;
    constexpr double kEtdReducedAbove = 3.0;
    /// The infer rule for a best excess E_c* in (0, margin): false = the plan's
    /// rule (the call is c*, ambiguous when the runner-up lies within the
    /// margin; assumed only when E_c* <= 0), true = assumed 2+ (the first
    /// E6 build). Measured on the fixture, PXD003531 and PXD001819 (registry
    /// E6-05): the plan's rule calls more charges right on all three.
    constexpr bool kAssumeBelowMargin = false;

    /// m/z of the strongest kInferTopPeaks finite, positive peaks (intensity
    /// desc, m/z desc: a total order, so the input order does not matter),
    /// ascending.
    std::vector<double> topMz(const OpenMS::MSSpectrum& spec)
    {
      std::vector<std::pair<double, double>> pk;  // (intensity, m/z)
      pk.reserve(spec.size());
      for (const auto& p : spec)
      {
        const double mz = p.getMZ(), in = p.getIntensity();
        if (!std::isfinite(mz) || !std::isfinite(in) || in <= 0 || mz <= 0) continue;
        pk.emplace_back(in, mz);
      }
      std::sort(pk.begin(), pk.end(), [](const auto& a, const auto& b) {
        if (a.first != b.first) return a.first > b.first;
        return a.second > b.second;
      });
      if (pk.size() > kInferTopPeaks) pk.resize(kInferTopPeaks);
      std::vector<double> mz;
      mz.reserve(pk.size());
      for (const auto& p : pk) mz.push_back(p.second);
      std::sort(mz.begin(), mz.end());
      return mz;
    }

    /// Peaks i with a partner j > i at @p sum - m_i (each pair once).
    int pairCount(const std::vector<double>& mz, double sum, const ComplementSpec& cs)
    {
      int n = 0;
      for (std::size_t i = 0; i < mz.size(); ++i)
      {
        const double c = sum - mz[i];
        if (c <= mz[i]) break;  // ascending: every later partner lies below its peak
        const double tol = cs.tol(mz[i], c);
        auto it = std::lower_bound(mz.begin() + static_cast<std::ptrdiff_t>(i) + 1, mz.end(), c - tol);
        if (it != mz.end() && *it <= c + tol) ++n;
      }
      return n;
    }

    /// Peaks i (as the higher-charged ion, weight @p w) with a partner j != i
    /// at @p sum - w * m_i: 1+/(z-1)+ pairs of a z+ precursor at w = z - 1.
    int pairCountW(const std::vector<double>& mz, double sum, int w, const ComplementSpec& cs)
    {
      int n = 0;
      for (std::size_t i = 0; i < mz.size(); ++i)
      {
        const double c = sum - w * mz[i];
        if (c <= 0) break;  // ascending
        const double tol = cs.tol(mz[i], c);
        for (auto it = std::lower_bound(mz.begin(), mz.end(), c - tol); it != mz.end() && *it <= c + tol; ++it)
          if (static_cast<std::size_t>(it - mz.begin()) != i) { ++n; break; }
      }
      return n;
    }

    /// @param z_aware  0: 1+/1+ pairs only (the infer call, bit for bit). From
    ///        3 (header check): the chance-corrected 1+/(z-1)+ pairs, which
    ///        sum to M + z*p weighted, are added.
    double excessOf(const std::vector<double>& mz, double M, const ComplementSpec& cs, int z_aware = 0)
    {
      if (z_aware >= 3)
      {
        double e = excessOf(mz, M, cs);
        const std::vector<double> one{0.0};
        for (const double pd : cs.pair_deltas.empty() ? one : cs.pair_deltas)
        {
          const double target = M + z_aware * kProton + pd;
          double off = 0;
          for (const double d : kOffTargetShifts) off += pairCountW(mz, target + d, z_aware - 1, cs);
          e += pairCountW(mz, target, z_aware - 1, cs) - off / static_cast<double>(std::size(kOffTargetShifts));
        }
        return e;
      }
      // 1+ pairs sum to M + 2p (b/y); a series with a pair delta (c/z-dot:
      // M + H, #15 phase B) adds it. b/y's single delta 0 leaves the sum as
      // it was, bit for bit. A series with several deltas (a/x: M - H and M,
      // 1.13 item 11) sums the excess over them; one delta is the old code.
      const double base = M + 2.0 * kProton;
      if (cs.pair_deltas.size() <= 1)
      {
        double target = base;
        if (!cs.pair_deltas.empty() && cs.pair_deltas.front() != 0.0) target += cs.pair_deltas.front();
        double off = 0;
        for (const double d : kOffTargetShifts) off += pairCount(mz, target + d, cs);
        return pairCount(mz, target, cs) - off / static_cast<double>(std::size(kOffTargetShifts));
      }
      double e = 0;
      for (const double pd : cs.pair_deltas)
      {
        const double target = pd == 0.0 ? base : base + pd;
        double off = 0;
        for (const double d : kOffTargetShifts) off += pairCount(mz, target + d, cs);
        e += pairCount(mz, target, cs) - off / static_cast<double>(std::size(kOffTargetShifts));
      }
      return e;
    }

    /// Isotope list in preference order: smaller |k| first, then smaller k.
    std::vector<int> isoOrder(const std::vector<int>& isotopes)
    {
      std::vector<int> v(isotopes);
      std::sort(v.begin(), v.end(), [](int a, int b) {
        if (std::abs(a) != std::abs(b)) return std::abs(a) < std::abs(b);
        return a < b;
      });
      return v;
    }

    int bestIso(const std::vector<double>& mz, double prec_mz, int charge, const std::vector<int>& order,
                const ComplementSpec& cs, double* excess, bool charge_aware = false)
    {
      const double M = prec_mz * charge - charge * kProton;
      int best_k = order.empty() ? 0 : order.front();
      double best = -std::numeric_limits<double>::infinity();
      for (const int k : order)
      {
        const double e = excessOf(mz, M - k * kC13, cs, charge_aware ? charge : 0);
        if (e > best) { best = e; best_k = k; }
      }
      if (excess) *excess = order.empty() ? 0.0 : best;
      return best_k;
    }

    ChargeCall inferFromTop(const OpenMS::MSSpectrum& spec, const std::vector<double>& mz, double prec_mz,
                            const std::vector<int>& charges, bool one_plus_test, const HypParam& hp,
                            const ComplementSpec& cs, bool charge_aware = false)
    {
      ChargeCall call;
      // The 1+ test: a 1+ precursor has no fragment above its own m/z.
      double tic = 0, above = 0;
      for (const auto& p : spec)
      {
        const double m = p.getMZ(), in = p.getIntensity();
        if (!std::isfinite(m) || !std::isfinite(in) || in <= 0) continue;
        if (std::fabs(m - prec_mz) <= kOnePlusPrecursorWindow) continue;
        tic += in;
        if (m > prec_mz) above += in;
      }
      call.above_share = tic > 0 ? above / tic : 0.0;
      // Every call lies in @p charges: the 1+ test runs only where 1 is a
      // candidate (a -charge_min above 1, or a possible list without 1, rules
      // it out).
      one_plus_test = one_plus_test && std::find(charges.begin(), charges.end(), 1) != charges.end();
      if (one_plus_test && tic > 0 && call.above_share < kOnePlusMaxShare)
      {
        call.charge = 1;
        call.src = ChargeSource::Inferred;
        call.basis = CallBasis::OnePlus;
        return call;
      }
      const std::vector<int> order = isoOrder(hp.isotope_errors);
      // Range evidence: a charge whose fragment ceiling M_c + p lies below one
      // of the strongest peaks is ruled out (mz is ascending: its last entry
      // is the highest strong peak). Nothing is ruled out when every charge
      // would be: the evidence then contradicts itself.
      const double top_mz = mz.empty() ? 0.0 : mz.back();
      // #15 phase B: an electron-activated spectrum (a series that loses a
      // charge, ComplementSpec::charge_loss) keeps its unreacted precursor
      // and charge-reduced species, the 1+ one at M + c*p, above every
      // fragment; they are not fragments, so for candidate c the ceiling is
      // tested against the highest strong peak outside c's species windows
      // (as the tagger's ETD filter drops them). b/y: top_mz, as before.
      const auto top_for = [&](int c) {
        if (cs.charge_loss <= 0) return top_mz;
        for (auto it = mz.rbegin(); it != mz.rend(); ++it)
        {
          bool species = false;
          for (int zr = c; zr >= 1 && !species; --zr)
          {
            const double cr = c * prec_mz / zr;
            const double tol = cs.tol(cr, cr);
            species = *it >= cr - kHydrogen / zr - tol && *it <= cr + kEtdReducedAbove / zr + tol;
          }
          if (!species) return *it;
        }
        return 0.0;
      };
      std::vector<int> left;
      for (const int c : charges)
        if (c >= 1 && !(top_for(c) > c * prec_mz - (c - 1) * kProton + kCeilingMargin)) left.push_back(c);
      std::vector<int> all;
      for (const int c : charges)
        if (c >= 1) all.push_back(c);
      if (left.empty()) left = all;
      if (!left.empty() && !all.empty() && left.front() != all.front()) call.range_min = left.front();
      int c1 = 0, c2 = 0;
      double e1 = -std::numeric_limits<double>::infinity(), e2 = e1;
      for (const int c : left)
      {
        double e = 0;
        const int k = bestIso(mz, prec_mz, c, order, cs, &e, charge_aware);
        call.excess.push_back({c, {e, k}});
        // Ascending charges and strict comparisons: ties go to the lower charge.
        if (e > e1) { c2 = c1; e2 = e1; c1 = c; e1 = e; }
        else if (e > e2) { c2 = c; e2 = e; }
      }
      // No complement evidence for any charge (the best excess is not above
      // 0): 2 (assumed) when 2 is a candidate left, else the lowest candidate
      // left (assumed) -- or, when the range evidence ruled out the lower
      // charges, the lowest charge left (inferred). With kAssumeBelowMargin
      // a best excess below the margin counts as no evidence as well.
      if (c1 == 0 || !(e1 > 0) || (kAssumeBelowMargin && e1 < hp.infer_margin))
      {
        if (call.range_min > 0)
        {
          call.charge = call.range_min;
          call.src = ChargeSource::Inferred;
          call.basis = CallBasis::Range;
          return call;
        }
        call.charge = left.empty() || std::find(left.begin(), left.end(), 2) != left.end() ? 2 : left.front();
        call.src = ChargeSource::Assumed;
        return call;
      }
      call.charge = c1;
      call.basis = CallBasis::Complement;
      if (c2 != 0 && e1 - e2 < hp.infer_margin)
      {
        call.src = ChargeSource::Ambiguous;
        call.runner_up = c2;
      }
      else call.src = ChargeSource::Inferred;
      return call;
    }

    std::vector<int> range(int lo, int hi)
    {
      std::vector<int> v;
      for (int c = std::max(1, lo); c <= std::min(hi, kChargeLimit); ++c) v.push_back(c);
      return v;
    }
  }

  std::string validate(const HypParam& hp, double frag_tol, bool tol_ppm)
  {
    if (hp.charge_min < 1 || hp.charge_max > kChargeLimit)
      return "-charge_min and -charge_max must lie in 1.." + std::to_string(kChargeLimit) + ".";
    if (hp.charge_min > hp.charge_max)
      return "-charge_min (" + std::to_string(hp.charge_min) + ") is above -charge_max ("
           + std::to_string(hp.charge_max) + ").";
    if (!(hp.infer_margin >= 0) || !std::isfinite(hp.infer_margin))
      return "-charge_infer_margin must be a finite value >= 0.";
    if (hp.isotope_errors.empty()) return "-isotope_error needs at least one value (0 = none).";
    std::set<int> seen;
    bool shifted = false;
    for (const int k : hp.isotope_errors)
    {
      if (k < kIsotopeMin || k > kIsotopeMax)
        return "-isotope_error " + std::to_string(k) + " is outside " + std::to_string(kIsotopeMin) + ".."
             + std::to_string(kIsotopeMax) + ".";
      if (!seen.insert(k).second) return "-isotope_error lists " + std::to_string(k) + " twice.";
      shifted = shifted || k != 0;
    }
    if (shifted)
    {
      const double eff = tol_ppm ? frag_tol * 1000.0 * 1e-6 : frag_tol;
      if (!(eff < kIsotopeMaxFragmentTolDa))
        return "-isotope_error other than 0 needs a high-resolution fragment tolerance (below 0.05 Da, "
               "or the ppm equivalent at 1000 m/z); this run's is " + std::to_string(eff) + " Da.";
    }
    return {};
  }

  double complementExcess(const OpenMS::MSSpectrum& spec, double M, const ComplementSpec& cs)
  {
    return excessOf(topMz(spec), M, cs);
  }

  int bestIsotope(const OpenMS::MSSpectrum& spec, double prec_mz, int charge, const std::vector<int>& isotopes,
                  const ComplementSpec& cs, double* excess)
  {
    return bestIso(topMz(spec), prec_mz, charge, isoOrder(isotopes), cs, excess);
  }

  ChargeCall inferCharge(const OpenMS::MSSpectrum& spec, double prec_mz, const std::vector<int>& charges,
                         const HypParam& hp, const ComplementSpec& cs)
  {
    return inferFromTop(spec, topMz(spec), prec_mz, charges, true, hp, cs);
  }

  std::vector<int> headerCheckCandidates(int header, const HypParam& hp)
  {
    std::vector<int> c = range(hp.charge_min, hp.charge_max);
    if (header >= 1 && header <= kChargeLimit && std::find(c.begin(), c.end(), header) == c.end())
    {
      c.push_back(header);
      std::sort(c.begin(), c.end());
    }
    return c;
  }

  namespace
  {
  /// Strongest MS1 peak within kMs1TolPpm of mz; 0 when there is none.
  double ms1At(const OpenMS::MSSpectrum& ms1, double mz)
  {
    const double tol = mz * kMs1TolPpm * 1e-6;
    const auto i = ms1.findHighestInWindow(mz, tol, tol);
    return i < 0 ? 0.0 : static_cast<double>(ms1[static_cast<std::size_t>(i)].getIntensity());
  }
  }

  int ms1Charge(const OpenMS::MSSpectrum& ms1, double prec_mz, int* peaks)
  {
    if (peaks) *peaks = 0;
    if (ms1.empty() || !(prec_mz > 0)) return 0;
    const auto at = [&](double mz) { return ms1At(ms1, mz); };
    const double anchor = at(prec_mz);
    if (!(anchor > 0)) return 0;
    // ponytail: the highest z with a +1/z peak and one supporting position
    // wins. Ceiling: an interfering peak at 1/z beside a lower-charge
    // pattern fakes the higher z (every lower-charge position k/z' is also a
    // position of z = n*z'). Upgrade: require a position k/z with
    // gcd(k, z) = 1 beyond the first, or score whole patterns (averagine).
    for (int z = kChargeLimit; z >= 1; --z)
    {
      const double d = kC13 / z;
      const bool first = at(prec_mz + d) >= kMs1FirstMin * anchor;
      const bool below = at(prec_mz - d) >= kMs1SupportMin * anchor;
      const bool second = at(prec_mz + 2 * d) >= kMs1SupportMin * anchor;
      if (first && (below || second))
      {
        if (peaks) *peaks = 1 + (below ? 1 : 0) + (second ? 1 : 0);
        return z;
      }
    }
    return 0;
  }

  namespace
  {
  /// The complement part of the header check: the infer call and its verdict.
  HeaderCheckResult complementCheck(const OpenMS::MSSpectrum& spec, const OpenMS::Precursor& prec,
                                    const HypParam& hp, const ComplementSpec& cs)
  {
    HeaderCheckResult r;
    const int header = prec.getCharge();
    if (header <= 0) return r;
    r.header = header;
    const std::vector<int> cands = headerCheckCandidates(header, hp);
    const bool one_plus = !cands.empty() && cands.front() == 1;
    const std::vector<double> top = topMz(spec);
    r.call = inferFromTop(spec, top, prec.getMZ(), cands, one_plus, hp, cs, true);
    // The strongest peaks above the header's 1+ fragment ceiling (b/y; an
    // electron-activated read keeps charge-reduced species up there, so the
    // count is left at 0). Reported only: on DEV and the scored runs peaks
    // above the 2+ ceiling never meant a higher charge (DIAGNOSIS.md).
    if (cs.charge_loss <= 0)
    {
      const double ceil = header * prec.getMZ() - (header - 1) * kProton + kCeilingMargin;
      r.header_peaks_above = static_cast<int>(top.end() - std::upper_bound(top.begin(), top.end(), ceil));
    }
    const ChargeCall& c = r.call;
    // The excess at the header and at the call, from the call's own table
    // (one entry per charge the range evidence left).
    bool header_seen = false;
    for (const auto& e : c.excess)
    {
      if (e.first == header) { r.header_excess = e.second.first; header_seen = true; }
      if (e.first == c.charge) r.call_excess = e.second.first;
    }
    // The header is ruled out when the range evidence left charges and the
    // header is not among them (the 1+ test returns before any is tested).
    // A header above kChargeLimit is no candidate: it is never "ruled out".
    const bool header_candidate = std::find(cands.begin(), cands.end(), header) != cands.end();
    r.header_ruled_out = header_candidate && c.basis != CallBasis::OnePlus && !c.excess.empty() && !header_seen;
    // A header the table lacks (ruled out by range, or above kChargeLimit)
    // still has complement pairs of its own: the margin comparisons below
    // are against its real excess, never against 0.
    if (!header_seen && c.basis != CallBasis::OnePlus && !c.excess.empty())
      bestIso(top, prec.getMZ(), header, isoOrder(hp.isotope_errors), cs, &r.header_excess, true);
    if (c.src == ChargeSource::Ambiguous)
    {
      // Two close charges. With the header one of them it agrees; else the
      // evidence is against the header when both charges beat its excess by
      // the margin (the runner-up's excess is the lower one): a disagreement
      // whose call is the better of the two.
      if (c.charge == header || c.runner_up == header) r.verdict = HeaderVerdict::Agree;
      else
      {
        double runner_excess = 0;
        for (const auto& e : c.excess)
          if (e.first == c.runner_up) runner_excess = e.second.first;
        const bool against = runner_excess > 0 && runner_excess - r.header_excess >= hp.header_margin;
        r.verdict = against ? HeaderVerdict::Disagree : HeaderVerdict::Ambiguous;
      }
      return r;
    }
    if (c.src == ChargeSource::Assumed || c.basis == CallBasis::None)
    {
      r.verdict = HeaderVerdict::NoCall;
      return r;
    }
    if (c.charge == header)
    {
      r.verdict = HeaderVerdict::Agree;
      return r;
    }
    // An unambiguous call other than the header.
    bool against = false;
    switch (c.basis)
    {
      case CallBasis::OnePlus: against = true; break;
      case CallBasis::Complement:
        against = r.call_excess > 0 && r.call_excess - r.header_excess >= hp.header_margin;
        break;
      case CallBasis::Range:  // no ground to disagree
      case CallBasis::Ms1Isotope:
      case CallBasis::None: break;
    }
    r.verdict = against ? HeaderVerdict::Disagree : HeaderVerdict::NoCall;
    return r;
  }
  }

  HeaderCheckResult checkHeaderCharge(const OpenMS::MSSpectrum& spec, const OpenMS::Precursor& prec,
                                      const HypParam& hp, const ComplementSpec& cs, const OpenMS::MSSpectrum* ms1)
  {
    HeaderCheckResult r = complementCheck(spec, prec, hp, cs);
    if (r.header <= 0) return r;
    r.flag_basis = r.call.basis;
    r.flag_charge = r.call.charge;
    if (ms1) r.ms1_charge = ms1Charge(*ms1, prec.getMZ(), &r.ms1_peaks);
    if (r.ms1_charge > 0)
    {
      // The precursor's own isotope spacing outranks the fragment evidence.
      // A header whose own +1/header peak is there stands: the MS1 call is
      // then mostly a doubled charge (3 read as 6, 2 as 4) or a co-isolated
      // second pattern (DEV: 79 false flags on real headers without this).
      // ponytail: the same floor as the call's first peak, not fitted apart.
      const double mz = prec.getMZ();
      const bool header_spaced = r.ms1_charge != r.header
                                 && ms1At(*ms1, mz + kC13 / r.header) >= kMs1FirstMin * ms1At(*ms1, mz);
      r.flag_basis = CallBasis::Ms1Isotope;
      r.flag_charge = header_spaced ? r.header : r.ms1_charge;
      r.verdict = r.flag_charge == r.header ? HeaderVerdict::Agree : HeaderVerdict::Disagree;
    }
    return r;
  }

  std::vector<Hypothesis> precursorHypotheses(const OpenMS::MSSpectrum& spec, const OpenMS::Precursor& prec,
                                              const HypParam& hp, const ComplementSpec& cs, ChargeCall* call_out,
                                              const HeaderCheckResult* header_check)
  {
    const int header = prec.getCharge();
    const double prec_mz = prec.getMZ();
    if (hp.isDefault())
      return {Hypothesis{header, 0, prec_mz, header > 0 ? ChargeSource::Header : ChargeSource::Assumed, true}};

    const std::vector<int> order = isoOrder(hp.isotope_errors);
    std::vector<double> top;  // built on first use
    auto top_mz = [&]() -> const std::vector<double>& {
      if (top.empty()) top = topMz(spec);
      return top;
    };
    auto make = [&](int c, ChargeSource src) {
      Hypothesis h;
      h.charge = c;
      h.src = src;
      h.iso = order.size() == 1 ? order.front() : bestIso(top_mz(), prec_mz, c, order, cs, nullptr);
      h.mz = h.iso == 0 ? prec_mz : prec_mz - h.iso * kC13 / c;
      return h;
    };
    std::vector<Hypothesis> out;
    auto finish = [&](int selected_charge) {
      for (Hypothesis& h : out) h.selected = h.charge == selected_charge;
      return out;
    };

    if (header > 0)
    {
      // 1.13 -check_header_charge both: a disagreeing header is tagged at
      // the header charge (selected) and at the check's charge.
      if (hp.header_check == HeaderCheck::Both && header_check && header_check->header == header
          && header_check->verdict == HeaderVerdict::Disagree)
      {
        const int z = header_check->replacement();
        if (z >= 1 && z <= kChargeLimit && z != header)
        {
          out.push_back(make(std::min(z, header), z < header ? ChargeSource::CheckCall : ChargeSource::Header));
          out.push_back(make(std::max(z, header), z < header ? ChargeSource::Header : ChargeSource::CheckCall));
          return finish(header);
        }
      }
      out.push_back(make(header, ChargeSource::Header));
      return finish(header);
    }
    if (hp.mode == ChargeMode::Assume2)
    {
      out.push_back(make(2, ChargeSource::Assumed));
      return finish(2);
    }

    // Listed possible charges: positive, distinct, ascending, within the cap.
    std::vector<int> possible;
    for (const int z : prec.getPossibleChargeStates())
      if (z >= 1 && z <= kChargeLimit) possible.push_back(z);
    std::sort(possible.begin(), possible.end());
    possible.erase(std::unique(possible.begin(), possible.end()), possible.end());
    if (possible.size() == 1)
    {
      out.push_back(make(possible.front(), ChargeSource::Possible));
      return finish(possible.front());
    }

    const std::vector<int> cands = possible.empty() ? range(hp.charge_min, hp.charge_max) : possible;
    // The 1+ test only where 1 can be the answer: a list without 1 rules it out.
    const bool one_plus = possible.empty() ? hp.charge_min <= 1 : possible.front() == 1;
    const ChargeCall call = inferFromTop(spec, top_mz(), prec_mz, cands, one_plus, hp, cs);
    if (call_out) *call_out = call;

    if (hp.mode == ChargeMode::Enumerate)
    {
      const ChargeSource src = possible.empty() ? ChargeSource::Enumerated : ChargeSource::Possible;
      for (const int c : cands) out.push_back(make(c, src));
      const auto has = [&](int c) { return std::find(cands.begin(), cands.end(), c) != cands.end(); };
      int sel = cands.front();
      if (call.src != ChargeSource::Assumed && has(call.charge)) sel = call.charge;
      else if (has(2)) sel = 2;
      return finish(sel);
    }

    // infer
    if (call.src == ChargeSource::Ambiguous)
    {
      const int lo = std::min(call.charge, call.runner_up), hi = std::max(call.charge, call.runner_up);
      out.push_back(make(lo, ChargeSource::Ambiguous));
      out.push_back(make(hi, ChargeSource::Ambiguous));
      return finish(call.charge);
    }
    out.push_back(make(call.charge, call.src));
    return finish(call.charge);
  }

  std::vector<std::pair<Tag, std::uint8_t>> mergeHypotheses(std::vector<std::vector<Tag>> per_hyp, std::size_t cap)
  {
    std::vector<std::pair<Tag, std::uint8_t>> rows;
    std::size_t n = 0;
    for (const auto& v : per_hyp) n += v.size();
    rows.reserve(n);
    for (std::size_t h = 0; h < per_hyp.size(); ++h)
      for (Tag& t : per_hyp[h]) rows.emplace_back(std::move(t), static_cast<std::uint8_t>(h));
    if (per_hyp.size() > 1)
      std::stable_sort(rows.begin(), rows.end(),
                       [](const auto& a, const auto& b) { return a.first.evalue < b.first.evalue; });
    if (cap > 0 && rows.size() > cap) rows.erase(rows.begin() + static_cast<std::ptrdiff_t>(cap), rows.end());
    return rows;
  }
}
