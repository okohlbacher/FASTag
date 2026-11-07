// Precursor charge and isotope hypotheses (1.12 #6, src/PrecursorHypotheses.h).
//
// Every case runs under cliDefaultParam() (deisotoping on, as the tool runs)
// and with deisotoping off (PLAN-data-types item #6, Tests):
//   (a) a 3+ synthetic spectrum with the charge removed infers 3; 2+ infers 2;
//   (a2) range evidence: a 3+ spectrum of b ions only (no complement pair)
//       with b ions above the 2+ fragment ceiling infers 3;
//   (b) a 1+ synthetic spectrum infers 1 (with -charge_min 1);
//   (c) an uncharged 3+ spectrum with the m/z shifted by C13C12/3 gives
//       iso 1 under -isotope_error 0,1, and nterm within 0.01 Da;
//   (c2) a header-charged 3+ precursor with a +1 isotope shift gives iso 1
//       and the corrected nterm;
//   (d) random-peak spectra give assumed 2 or a call below the margin;
//   (e) possible charges {2,3} under enumerate give exactly those two;
//   (f) the hypotheses do not depend on the input peak order;
//   (g) a header charge is never replaced;
//   (h) multiplicity: on 500 random-peak spectra with the charge removed,
//       enumerate gives no more rows with E <= 1 than assume2 (3 SD slack),
//       and the Bonferroni factor is what keeps it there;
//   (i) selection follows the charge evidence: a construct whose 4+
//       hypothesis has the lower E-value while infer calls 3 selects 3;
//   (j) every hypothesis lies in the candidates: infer and enumerate with
//       -charge_min = -charge_max = 4 (random peaks, a 2+ and a 3+ spectrum),
//       with possible charges {3,4} and no complement evidence (assumed 3,
//       the lowest candidate), and with -charge_min 2 on a 1+ spectrum.
// Plus: the defaults give the single 1.11 hypothesis; mergeHypotheses order
// and cap; tagSpectrum's multiplicity; validate()'s refusals.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "CliParam.h"
#include "FASTagger.h"
#include "PrecursorHypotheses.h"
#include "complement_synth.h"

#include <OpenMS/CONCEPT/Constants.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <random>
#include <string>
#include <vector>

using namespace OpenMS;
namespace H = FASTag::Hyp;

static int failures = 0;
#define CHECK(c, ...) do { if (!(c)) { ++failures; std::printf("FAIL %d: ", __LINE__); \
  std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

namespace
{
  const double kP = Constants::PROTON_MASS_U;
  const double kC13 = Constants::C13C12_MASSDIFF_U;

  Precursor precursor(double mz, int charge, std::vector<Int> possible = {})
  {
    Precursor p;
    p.setMZ(mz);
    p.setCharge(charge);
    p.setPossibleChargeStates(possible);
    return p;
  }

  H::HypParam mode(H::ChargeMode m, std::vector<int> iso = {0})
  {
    H::HypParam hp;
    hp.mode = m;
    hp.isotope_errors = std::move(iso);
    return hp;
  }

  const H::Hypothesis* selected(const std::vector<H::Hypothesis>& h)
  {
    const H::Hypothesis* s = nullptr;
    int n = 0;
    for (const auto& x : h)
      if (x.selected) { s = &x; ++n; }
    return n == 1 ? s : nullptr;
  }

  MSSpectrum randomPeaks(std::mt19937& rng, int n, double lo, double hi)
  {
    MSSpectrum s;
    for (int k = 0; k < n; ++k)
      s.emplace_back(lo + (hi - lo) * ComplementSynth::u01(rng), 0.05 + ComplementSynth::u01(rng));
    s.sortByPosition();
    return s;
  }

  void run(const FASTag::Param& P, const char* label)
  {
    const FASTag::ComplementSpec cs = FASTag::ComplementSpec::fromParam(P);
    const FASTag::Tables T(P);

    // ---- defaults: the single 1.11 hypothesis, whatever the spectrum ----
    {
      const auto s3 = ComplementSynth::make("SAMPLERKDLVEGFNTWQR", 3, false, 0, 0.0, 40, 12);
      const auto h = H::precursorHypotheses(s3.spec, precursor(s3.prec_mz, 0, {3, 4}), H::HypParam{}, cs);
      CHECK(h.size() == 1 && h[0].charge == 0 && h[0].iso == 0 && h[0].mz == s3.prec_mz && h[0].selected
                && h[0].src == H::ChargeSource::Assumed,
            "%s: defaults give the 1.11 hypothesis (charge as given, m/z unchanged)", label);
      const auto hh = H::precursorHypotheses(s3.spec, precursor(s3.prec_mz, 3), H::HypParam{}, cs);
      CHECK(hh.size() == 1 && hh[0].charge == 3 && hh[0].src == H::ChargeSource::Header, "%s: defaults, header", label);
      CHECK(H::HypParam{}.isDefault() && !mode(H::ChargeMode::Infer).isDefault()
                && !mode(H::ChargeMode::Assume2, {0, 1}).isDefault(),
            "%s: isDefault", label);
    }

    // ---- (a) 3+ infers 3, 2+ infers 2 ----
    const ComplementSynth::Case cases3[] = {{"SAMPLERKDLVEGFNTWQR", 3, false, 0, 40, 12},
                                            {"LLEQTHGGLNAIPKDEFAR", 3, false, 2, 25, 13}};
    for (const auto& c : cases3)
    {
      const auto s = ComplementSynth::make(c.pep, 3, c.y2, c.iso, 0.0, c.noise, c.seed);
      H::ChargeCall call;
      const auto h = H::precursorHypotheses(s.spec, precursor(s.prec_mz, 0), mode(H::ChargeMode::Infer), cs, &call);
      const H::Hypothesis* sel = selected(h);
      CHECK(h.size() == 1 && sel && sel->charge == 3 && sel->src == H::ChargeSource::Inferred && sel->iso == 0,
            "%s (a): %s 3+ infers 3 (got %zu hyps, charge %d, src %s)", label, c.pep, h.size(),
            sel ? sel->charge : -1, sel ? H::sourceName(sel->src) : "-");
    }
    const ComplementSynth::Case cases2[] = {{"VGAHAGEYGAEALER", 2, false, 1, 30, 11},
                                            {"GDFQKMVYTNPAWSR", 2, false, 0, 15, 15}};
    for (const auto& c : cases2)
    {
      const auto s = ComplementSynth::make(c.pep, 2, c.y2, c.iso, 0.0, c.noise, c.seed);
      const auto h = H::precursorHypotheses(s.spec, precursor(s.prec_mz, 0), mode(H::ChargeMode::Infer), cs);
      const H::Hypothesis* sel = selected(h);
      CHECK(h.size() == 1 && sel && sel->charge == 2 && sel->src == H::ChargeSource::Inferred,
            "%s (a): %s 2+ infers 2 (got charge %d, src %s)", label, c.pep, sel ? sel->charge : -1,
            sel ? H::sourceName(sel->src) : "-");
    }

    // ---- (a2) range evidence: a 3+ spectrum of b ions only (no complement
    // pair at all) whose large b ions lie above the 2+ fragment ceiling
    // infers 3, not assumed 2 ----
    {
      const AASequence aa = AASequence::fromString("SAMPLERKDLVEGFNTWQR");
      const double M = aa.getMonoWeight();
      MSSpectrum s;
      std::mt19937 rng(31);
      for (size_t i = 1; i < aa.size(); ++i)
        ComplementSynth::addFragment(s, aa.getPrefix(i).getMonoWeight(Residue::BIon, 1) - kP, 1,
                                     0.5 + 0.5 * ComplementSynth::u01(rng), 0);
      for (int k = 0; k < 30; ++k) s.emplace_back(150.0 + (M - 200.0) * ComplementSynth::u01(rng), 0.05);
      s.sortByPosition();
      const double mz3 = (M + 3 * kP) / 3.0;
      H::ChargeCall call;
      const auto h = H::precursorHypotheses(s, precursor(mz3, 0), mode(H::ChargeMode::Infer), cs, &call);
      const H::Hypothesis* sel = selected(h);
      CHECK(h.size() == 1 && sel && sel->charge == 3 && sel->src == H::ChargeSource::Inferred && call.range_min == 3,
            "%s (a2): b-only 3+ infers 3 by range (got charge %d, src %s, range_min %d)", label,
            sel ? sel->charge : -1, sel ? H::sourceName(sel->src) : "-", call.range_min);
      // Its complement evidence alone has nothing: the 2+ call would be assumed.
      CHECK(H::complementExcess(s, M, cs) < 1.0, "%s (a2): the construct has complement pairs", label);
    }

    // ---- (b) 1+ infers 1 ----
    {
      // 1 is a candidate only from -charge_min 1 on (the default range is 2..4).
      const auto s = ComplementSynth::make("GDFQKMVYTNPAWSR", 1, false, 1, 0.0, 20, 21);
      H::ChargeCall call;
      H::HypParam hp1 = mode(H::ChargeMode::Infer);
      hp1.charge_min = 1;
      const auto h = H::precursorHypotheses(s.spec, precursor(s.prec_mz, 0), hp1, cs, &call);
      const H::Hypothesis* sel = selected(h);
      CHECK(h.size() == 1 && sel && sel->charge == 1 && sel->src == H::ChargeSource::Inferred,
            "%s (b): 1+ infers 1 (got charge %d, above share %.3f)", label, sel ? sel->charge : -1, call.above_share);
      // The 1+ hypothesis tags at charge 1.
      const auto tags = FASTag::tagSpectrum(s.spec, sel ? sel->mz : 0.0, 1, P, T);
      CHECK(!tags.empty(), "%s (b): the 1+ hypothesis tags", label);
    }

    // ---- (c) isotope shift on an uncharged 3+ ----
    {
      const auto s = ComplementSynth::make("SAMPLERKDLVEGFNTWQR", 3, false, 0, 0.0, 40, 12);
      const double shifted = s.prec_mz + kC13 / 3.0;
      const auto h = H::precursorHypotheses(s.spec, precursor(shifted, 0), mode(H::ChargeMode::Infer, {0, 1}), cs);
      const H::Hypothesis* sel = selected(h);
      CHECK(sel && sel->charge == 3 && sel->iso == 1, "%s (c): iso 1 at charge 3 (got charge %d iso %d)", label,
            sel ? sel->charge : -1, sel ? sel->iso : -9);
      if (sel)
      {
        const double M = sel->mz * 3 - 3 * kP;
        CHECK(std::fabs(M - s.M) < 0.01, "%s (c): corrected neutral mass %.4f vs %.4f", label, M, s.M);
        const auto ref = FASTag::tagSpectrum(s.spec, s.prec_mz, 3, P, T);
        const auto got = FASTag::tagSpectrum(s.spec, sel->mz, 3, P, T);
        CHECK(!got.empty(), "%s (c): tags at the corrected m/z", label);
        size_t matched = 0;
        for (const auto& t : got)
          for (const auto& r : ref)
            if (r.seq == t.seq && r.charge == t.charge && r.cterm_mass == t.cterm_mass)
            {
              ++matched;
              CHECK(std::fabs(r.nterm_mass - t.nterm_mass) < 0.01, "%s (c): nterm %.4f vs %.4f", label, t.nterm_mass,
                    r.nterm_mass);
              break;
            }
        CHECK(matched > 0, "%s (c): no tag of the corrected hypothesis matches the true one", label);
        // Without the isotope list the shifted precursor's nterm is off by 1 Da.
        const auto off = FASTag::tagSpectrum(s.spec, shifted, 3, P, T);
        bool any_off = false;
        for (const auto& t : off)
          for (const auto& r : ref)
            if (r.seq == t.seq && r.charge == t.charge && r.cterm_mass == t.cterm_mass
                && std::fabs(r.nterm_mass - t.nterm_mass) > 0.9)
              any_off = true;
        CHECK(any_off, "%s (c): the uncorrected nterm is off (the construct is valid)", label);
      }
    }

    // ---- (c2) header-charged 3+ with a +1 isotope shift ----
    for (const H::ChargeMode m : {H::ChargeMode::Assume2, H::ChargeMode::Infer})
    {
      const auto s = ComplementSynth::make("LLEQTHGGLNAIPKDEFAR", 3, false, 0, 0.0, 25, 13);
      const auto h = H::precursorHypotheses(s.spec, precursor(s.prec_mz + kC13 / 3.0, 3), mode(m, {0, 1}), cs);
      const H::Hypothesis* sel = selected(h);
      CHECK(h.size() == 1 && sel && sel->charge == 3 && sel->iso == 1 && sel->src == H::ChargeSource::Header,
            "%s (c2): header 3+ with a +1 isotope gives iso 1 (got %d/%d)", label, sel ? sel->charge : -1,
            sel ? sel->iso : -9);
      if (sel) CHECK(std::fabs(sel->mz * 3 - 3 * kP - s.M) < 0.01, "%s (c2): corrected mass", label);
      // Without a shift the same list keeps k = 0.
      const auto h0 = H::precursorHypotheses(s.spec, precursor(s.prec_mz, 3), mode(m, {0, 1}), cs);
      CHECK(h0.size() == 1 && h0[0].iso == 0 && h0[0].mz == s.prec_mz, "%s (c2): no shift keeps k 0", label);
    }

    // ---- (d) random peaks give no confident call ----
    // The plan's rule: assumed 2 when no charge has complement evidence
    // (best excess <= 0); a best excess above 0 is called, ambiguous when the
    // runner-up lies within the margin. Noise must not reach the margin: each
    // random spectrum is assumed 2, or a call whose best excess is below it.
    {
      std::mt19937 rng(4242);
      int assumed = 0, confident = 0, weak = 0;
      for (int k = 0; k < 20; ++k)
      {
        const MSSpectrum s = randomPeaks(rng, 150, 150.0, 1400.0);
        H::ChargeCall call;
        const auto h = H::precursorHypotheses(s, precursor(700.0, 0), mode(H::ChargeMode::Infer), cs, &call);
        const H::Hypothesis* sel = selected(h);
        double best = -1e300;
        for (const auto& e : call.excess) best = std::max(best, e.second.first);
        if (h.size() == 1 && sel && sel->charge == 2 && sel->src == H::ChargeSource::Assumed) ++assumed;
        else if (!(best < H::kInferMarginDefault)) ++confident;
        else if (best > 0 && sel && sel->src != H::ChargeSource::Assumed) ++weak;
      }
      CHECK(confident == 0, "%s (d): %d of 20 random spectra reach the margin", label, confident);
      CHECK(assumed >= 10, "%s (d): only %d of 20 random spectra assumed 2", label, assumed);
      // The plan's rule, not the first build's: an excess in (0, margin) is
      // a call (inferred or ambiguous), not assumed 2+.
      CHECK(weak > 0, "%s (d): no random spectrum with an excess below the margin is called", label);
    }

    // ---- (e) possible charges under enumerate ----
    {
      const auto s = ComplementSynth::make("SAMPLERKDLVEGFNTWQR", 3, false, 0, 0.0, 40, 12);
      const auto h = H::precursorHypotheses(s.spec, precursor(s.prec_mz, 0, {3, 2}), mode(H::ChargeMode::Enumerate), cs);
      CHECK(h.size() == 2 && h[0].charge == 2 && h[1].charge == 3 && h[0].src == H::ChargeSource::Possible
                && h[1].src == H::ChargeSource::Possible,
            "%s (e): possible {2,3} gives exactly 2 and 3 (got %zu)", label, h.size());
      const H::Hypothesis* sel = selected(h);
      CHECK(sel && sel->charge == 3, "%s (e): the infer call selects 3", label);
      // Without possible charges: charge_min .. charge_max.
      const auto r = H::precursorHypotheses(s.spec, precursor(s.prec_mz, 0), mode(H::ChargeMode::Enumerate), cs);
      CHECK(r.size() == 3 && r[0].charge == 2 && r[2].charge == 4 && r[1].src == H::ChargeSource::Enumerated,
            "%s (e): enumerate without possible charges gives 2..4", label);
      // One possible charge is that charge, in every non-default mode.
      for (const H::ChargeMode m : {H::ChargeMode::Enumerate, H::ChargeMode::Infer})
      {
        const auto o = H::precursorHypotheses(s.spec, precursor(s.prec_mz, 0, {4}), mode(m), cs);
        CHECK(o.size() == 1 && o[0].charge == 4 && o[0].src == H::ChargeSource::Possible && o[0].selected,
              "%s (e): a single possible charge is used", label);
      }
      // Under assume2 the possible charges are ignored, as in 1.11.
      const auto a = H::precursorHypotheses(s.spec, precursor(s.prec_mz, 0, {3, 4}), mode(H::ChargeMode::Assume2, {0, 1}), cs);
      CHECK(a.size() == 1 && a[0].charge == 2 && a[0].src == H::ChargeSource::Assumed, "%s (e): assume2 gives 2", label);
    }

    // ---- (f) peak order ----
    {
      const auto s = ComplementSynth::make("LLEQTHGGLNAIPKDEFAR", 3, false, 2, 0.0, 25, 13);
      MSSpectrum shuffled = s.spec;
      std::mt19937 rng(7);
      std::shuffle(shuffled.begin(), shuffled.end(), rng);
      for (const H::ChargeMode m : {H::ChargeMode::Enumerate, H::ChargeMode::Infer})
      {
        H::ChargeCall c1, c2;
        const auto a = H::precursorHypotheses(s.spec, precursor(s.prec_mz + kC13 / 3, 0), mode(m, {-1, 0, 1, 2}), cs, &c1);
        const auto b = H::precursorHypotheses(shuffled, precursor(s.prec_mz + kC13 / 3, 0), mode(m, {-1, 0, 1, 2}), cs, &c2);
        bool same = a.size() == b.size() && c1.excess == c2.excess && c1.charge == c2.charge;
        for (size_t i = 0; same && i < a.size(); ++i)
          same = a[i].charge == b[i].charge && a[i].iso == b[i].iso && a[i].mz == b[i].mz && a[i].src == b[i].src
                 && a[i].selected == b[i].selected;
        CHECK(same, "%s (f): hypotheses depend on the peak order", label);
      }
    }

    // ---- (g) a header charge is never replaced ----
    {
      const auto s = ComplementSynth::make("SAMPLERKDLVEGFNTWQR", 3, false, 0, 0.0, 40, 12);
      for (const H::ChargeMode m : {H::ChargeMode::Enumerate, H::ChargeMode::Infer})
      {
        const auto h = H::precursorHypotheses(s.spec, precursor(s.prec_mz, 2, {3}), mode(m), cs);
        CHECK(h.size() == 1 && h[0].charge == 2 && h[0].src == H::ChargeSource::Header && h[0].selected
                  && h[0].mz == s.prec_mz,
              "%s (g): header 2 kept on a 3+ spectrum", label);
      }
    }

    // ---- (h) multiplicity ----
    {
      std::mt19937 rng(1312);
      long n_assume = 0, n_enum = 0, n_enum_raw = 0;
      const auto hp = mode(H::ChargeMode::Enumerate);
      for (int k = 0; k < 500; ++k)
      {
        const double prec_mz = 450.0 + 500.0 * ComplementSynth::u01(rng);
        const MSSpectrum s = randomPeaks(rng, 120, 120.0, 1600.0);
        const auto a = FASTag::tagSpectrum(s, prec_mz, 0, P, T);
        for (const auto& t : a) n_assume += t.evalue <= 1.0;
        const auto h = H::precursorHypotheses(s, precursor(prec_mz, 0), hp, cs);
        std::vector<std::vector<FASTag::Tag>> per, per_raw;
        for (const auto& x : h)
        {
          per.push_back(FASTag::tagSpectrum(s, x.mz, x.charge, P, T, nullptr, static_cast<double>(h.size())));
          per_raw.push_back(FASTag::tagSpectrum(s, x.mz, x.charge, P, T));
        }
        for (const auto& r : H::mergeHypotheses(per, static_cast<size_t>(P.max_tag_count))) n_enum += r.first.evalue <= 1.0;
        for (const auto& r : H::mergeHypotheses(per_raw, static_cast<size_t>(P.max_tag_count))) n_enum_raw += r.first.evalue <= 1.0;
      }
      const double slack = 3.0 * std::sqrt(std::max(1.0, static_cast<double>(n_assume)));
      CHECK(n_assume > 0, "%s (h): no random row with E <= 1 under assume2; the check is vacuous", label);
      CHECK(static_cast<double>(n_enum) <= n_assume + slack,
            "%s (h): enumerate gives %ld rows with E <= 1, assume2 %ld (slack %.1f)", label, n_enum, n_assume, slack);
      CHECK(n_enum_raw > n_enum, "%s (h): the Bonferroni factor changes nothing (%ld vs %ld)", label, n_enum_raw, n_enum);
      std::printf("%s (h): E<=1 rows assume2 %ld, enumerate %ld (uncorrected %ld)\n", label, n_assume, n_enum, n_enum_raw);
    }

    // ---- (i) selection follows the charge evidence ----
    {
      // A 3+ peptide (b/y at 1+: the infer call is 3) plus an intense ladder
      // of another peptide's y ions at 3+, which only the 4+ hypothesis reads
      // (fragment charges up to c-1).
      auto s = ComplementSynth::make("SAMPLERKDLVEGFNTWQR", 3, false, 0, 0.0, 10, 12);
      const AASequence other = AASequence::fromString("WHFYWHMYFWK");
      for (size_t i = 3; i < other.size(); ++i)
      {
        const double ny = other.getSuffix(i).getMonoWeight(Residue::YIon, 1) - kP;
        s.spec.emplace_back((ny + 3 * kP) / 3.0, 3.0);
      }
      s.spec.sortByPosition();
      const auto hp = mode(H::ChargeMode::Enumerate);
      H::ChargeCall call;
      const auto h = H::precursorHypotheses(s.spec, precursor(s.prec_mz, 0), hp, cs, &call);
      double best3 = 1e300, best4 = 1e300;
      for (const auto& x : h)
      {
        const auto tags = FASTag::tagSpectrum(s.spec, x.mz, x.charge, P, T, nullptr, static_cast<double>(h.size()));
        if (tags.empty()) continue;
        if (x.charge == 3) best3 = tags.front().evalue;
        if (x.charge == 4) best4 = tags.front().evalue;
      }
      CHECK(best4 < best3, "%s (i): construct invalid, best E at 4+ %.3g not below 3+ %.3g", label, best4, best3);
      const H::Hypothesis* sel = selected(h);
      CHECK(call.charge == 3 && sel && sel->charge == 3, "%s (i): selected %d (call %d), not the lowest E-value",
            label, sel ? sel->charge : -1, call.charge);
    }

    // ---- (j) every hypothesis lies in the candidates ----
    {
      auto inside = [](const std::vector<H::Hypothesis>& h, const std::vector<int>& cands) {
        if (h.empty() || !selected(h)) return false;
        for (const auto& x : h)
          if (std::find(cands.begin(), cands.end(), x.charge) == cands.end()) return false;
        return true;
      };
      auto ranged = [](H::ChargeMode m, int lo, int hi) {
        H::HypParam hp = mode(m);
        hp.charge_min = lo;
        hp.charge_max = hi;
        return hp;
      };
      std::mt19937 rng(977);
      std::vector<MSSpectrum> specs;
      std::vector<double> mzs;
      for (int k = 0; k < 10; ++k)
      {
        specs.push_back(randomPeaks(rng, 150, 150.0, 1400.0));
        mzs.push_back(700.0);
      }
      const auto s2 = ComplementSynth::make("VGAHAGEYGAEALER", 2, false, 1, 0.0, 30, 11);
      const auto s3 = ComplementSynth::make("SAMPLERKDLVEGFNTWQR", 3, false, 0, 0.0, 40, 12);
      const auto s1 = ComplementSynth::make("GDFQKMVYTNPAWSR", 1, false, 1, 0.0, 20, 21);
      for (const auto* c : {&s1, &s2, &s3})
      {
        specs.push_back(c->spec);
        mzs.push_back(c->prec_mz);
      }
      for (const H::ChargeMode m : {H::ChargeMode::Infer, H::ChargeMode::Enumerate})
      {
        const char* mn = m == H::ChargeMode::Infer ? "infer" : "enumerate";
        int n_out = 0;
        for (size_t k = 0; k < specs.size(); ++k)
        {
          // -charge_min = -charge_max = 4.
          const auto h4 = H::precursorHypotheses(specs[k], precursor(mzs[k], 0), ranged(m, 4, 4), cs);
          n_out += !inside(h4, {4});
          // -charge_min 3 -charge_max 4.
          const auto h34 = H::precursorHypotheses(specs[k], precursor(mzs[k], 0), ranged(m, 3, 4), cs);
          n_out += !inside(h34, {3, 4});
          // Possible charges {3,4}.
          const auto hp34 = H::precursorHypotheses(specs[k], precursor(mzs[k], 0, {4, 3}), mode(m), cs);
          n_out += !inside(hp34, {3, 4});
          // -charge_min 2 (the default range): never 1.
          const auto h24 = H::precursorHypotheses(specs[k], precursor(mzs[k], 0), ranged(m, 2, 4), cs);
          n_out += !inside(h24, {2, 3, 4});
        }
        CHECK(n_out == 0, "%s (j) %s: %d hypothesis sets with a charge outside the candidates", label, mn, n_out);
      }
      // No complement evidence with possible {3,4}: the lowest candidate, assumed.
      int assumed = 0, low = 0;
      for (int k = 0; k < 10; ++k)
      {
        const auto h = H::precursorHypotheses(specs[k], precursor(mzs[k], 0, {3, 4}), mode(H::ChargeMode::Infer), cs);
        const H::Hypothesis* sel = selected(h);
        if (!sel || sel->src != H::ChargeSource::Assumed) continue;
        ++assumed;
        low += h.size() == 1 && sel->charge == 3;
      }
      CHECK(assumed > 0 && low == assumed, "%s (j): %d of %d assumed random spectra with possible {3,4} got 3",
            label, low, assumed);
      // The 1+ spectrum under -charge_min 2: the 1+ test does not run, and with
      // -charge_min 1 it does (the construct is a valid 1+).
      H::ChargeCall c2, c1;
      const auto h2 = H::precursorHypotheses(s1.spec, precursor(s1.prec_mz, 0), ranged(H::ChargeMode::Infer, 2, 4), cs, &c2);
      const auto h1 = H::precursorHypotheses(s1.spec, precursor(s1.prec_mz, 0), ranged(H::ChargeMode::Infer, 1, 4), cs, &c1);
      const H::Hypothesis* sel1 = selected(h1);
      CHECK(c2.charge >= 2 && sel1 && sel1->charge == 1, "%s (j): 1+ spectrum gives %d at -charge_min 2, %d at 1",
            label, c2.charge, sel1 ? sel1->charge : -1);
      // A 2+ spectrum at -charge_min = -charge_max = 4: 4, never the 2 it would infer.
      const auto h44 = H::precursorHypotheses(s2.spec, precursor(s2.prec_mz, 0), ranged(H::ChargeMode::Infer, 4, 4), cs);
      CHECK(h44.size() == 1 && h44[0].charge == 4 && h44[0].selected, "%s (j): 2+ spectrum at range 4..4 gives 4", label);
    }
  }
}

int main()
{
  FASTag::Param cli = FASTag::Cli::cliDefaultParam();
  FASTag::Param nodeiso = cli;
  nodeiso.deisotope = false;
  run(cli, "cli");
  run(nodeiso, "nodeiso");

  // ---- mergeHypotheses ----
  {
    auto tag = [](const char* s, double e) { FASTag::Tag t; t.seq = s; t.evalue = e; return t; };
    std::vector<std::vector<FASTag::Tag>> per{{tag("AAA", 0.1), tag("BBB", 0.5)}, {tag("CCC", 0.1), tag("DDD", 0.2)}};
    const auto m = H::mergeHypotheses(per, 3);
    CHECK(m.size() == 3 && m[0].first.seq == "AAA" && m[0].second == 0 && m[1].first.seq == "CCC" && m[1].second == 1
              && m[2].first.seq == "DDD",
          "merge: by E-value, ties in hypothesis order, capped");
    const auto one = H::mergeHypotheses({{tag("BBB", 0.5), tag("AAA", 0.1)}}, 0);
    CHECK(one.size() == 2 && one[0].first.seq == "BBB", "merge: one hypothesis keeps its order");
  }

  // ---- tagSpectrum's multiplicity ----
  {
    const auto s = ComplementSynth::make("SAMPLERKDLVEGFNTWQR", 3, false, 0, 0.0, 40, 12);
    const FASTag::Tables T(cli);
    const auto a = FASTag::tagSpectrum(s.spec, s.prec_mz, 3, cli, T);
    const auto b = FASTag::tagSpectrum(s.spec, s.prec_mz, 3, cli, T, nullptr, 1.0);
    const auto c = FASTag::tagSpectrum(s.spec, s.prec_mz, 3, cli, T, nullptr, 4.0);
    bool same = a.size() == b.size();
    for (size_t i = 0; same && i < a.size(); ++i) same = a[i].evalue == b[i].evalue && a[i].seq == b[i].seq;
    CHECK(same && !a.empty(), "multiplicity 1 is the default");
    CHECK(!c.empty() && !a.empty() && std::fabs(c.front().evalue / a.front().evalue - 4.0) < 1e-9,
          "multiplicity 4 multiplies the E-value");
  }

  // ---- validate ----
  {
    H::HypParam hp;
    CHECK(H::validate(hp, 20, true).empty(), "validate: defaults pass");
    hp.charge_min = 4; hp.charge_max = 3;
    CHECK(!H::validate(hp, 20, true).empty(), "validate: charge_min > charge_max refused");
    hp = H::HypParam{}; hp.isotope_errors = {0, 4};
    CHECK(!H::validate(hp, 20, true).empty(), "validate: isotope 4 refused");
    hp.isotope_errors = {-2};
    CHECK(!H::validate(hp, 20, true).empty(), "validate: isotope -2 refused");
    hp.isotope_errors = {1, 1};
    CHECK(!H::validate(hp, 20, true).empty(), "validate: duplicate isotope refused");
    hp.isotope_errors = {0, 1};
    CHECK(H::validate(hp, 20, true).empty(), "validate: isotope 0,1 at 20 ppm passes");
    CHECK(H::validate(hp, 0.02, false).empty(), "validate: isotope 0,1 at 0.02 Da passes");
    CHECK(!H::validate(hp, 0.5, false).empty(), "validate: isotope 1 at 0.5 Da refused");
    CHECK(!H::validate(hp, 60, true).empty(), "validate: isotope 1 at 60 ppm (0.06 Da at 1000) refused");
    hp.isotope_errors = {0};
    CHECK(H::validate(hp, 0.5, false).empty(), "validate: isotope 0 at 0.5 Da passes");
  }

  if (failures) { std::printf("%d failure(s)\n", failures); return 1; }
  std::printf("precursor_hypotheses_test: all checks passed\n");
  return 0;
}
