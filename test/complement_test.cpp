// Complement-ion rules and tolerance (1.12 E2): -complement_rule,
// -complement_tolerance(_unit) and -complement_midp at the library level.
//
// Cases that depend on preprocessing run twice: under cliDefaultParam()
// (deisotoping on, as the tool runs) and with deisotoping off.
//   (a) complementMz: c=2/z=1 equal under both rules (bit for bit), c=3/z=1
//       gives (M + 3p - m)/2, z >= c gives no partner.
//   (b) a 3+ precursor with y at 2+ and b at 1+: with deisotoping off the
//       precursor rule finds the complements and same_charge does not; at
//       the CLI default (2+ moved onto the 1+ scale) both finds them; and the
//       rule reaches the E-values through Tables.
//   (c) pair sums off by 0.3 Da: the fragment mode at k = 0.5 with a 0.5 Da
//       fragment tolerance finds the complements, 0.02 Da about none.
//   (d) mid-p equals a reference summed from Boost's pdf; the plain tail
//       equals P(X >= c); the support ends; mid-p reaches scorePath for
//       tags with 0 or 1 complemented peaks only (DirecTag's scope), and
//       tags with 2 or more keep the plain value.
//   (e) the default Param reproduces the stored E-value vector that FASTag
//       1.11.0 (78390cd) wrote for 5 synthetic spectra, under both Params.
//   negatives: precursor charge 1 under precursor has no complements and
//       drops p_complement; the fragment-charge cap of 8 holds.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "CliParam.h"
#include "FASTagger.h"
#include "complement_synth.h"

#include <OpenMS/CONCEPT/Constants.h>

#include <boost/math/distributions/hypergeometric.hpp>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace OpenMS;
using FASTag::ComplementRule;
using FASTag::ComplementTolMode;

static int failures = 0;
#define CHECK(c, ...) do { if (!(c)) { ++failures; std::printf("FAIL %d: ", __LINE__); \
  std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

namespace
{
  struct RefRow
  {
    int ci, pi;
    size_t rank;
    const char* seq;
    int charge;
    double evalue, p_complement;
  };
  const RefRow REF[] = {
#include "complement_ref_1_11.inc"
  };

  FASTag::Param withRule(FASTag::Param p, ComplementRule r)
  {
    p.complement_rule = r;
    return p;
  }

  /// Both Params of the plan: the CLI's and the CLI's without deisotoping.
  std::vector<std::pair<const char*, FASTag::Param>> bothParams()
  {
    FASTag::Param cli = FASTag::cliDefaultParam();
    FASTag::Param off = cli;
    off.deisotope = false;
    return {{"cli", cli}, {"deisotope off", off}};
  }

  int pop(const std::vector<int>& v, size_t z) { return z < v.size() ? v[z] : -1; }
}

int main()
{
  const double P = Constants::PROTON_MASS_U;

  // ---------------------------------------------------------------- (a)
  {
    const double M = 1500.73, m = 612.31;
    const double s21 = FASTag::complementMz(M, 2, 1, m, ComplementRule::SAME_CHARGE);
    const double p21 = FASTag::complementMz(M, 2, 1, m, ComplementRule::PRECURSOR);
    CHECK(s21 == p21, "c=2 z=1: same_charge %.17g != precursor %.17g", s21, p21);
    CHECK(s21 == M / 1 + 2.0 * P - m, "same_charge is not M/z + 2p - m");
    const double p31 = FASTag::complementMz(M, 3, 1, m, ComplementRule::PRECURSOR);
    CHECK(std::fabs(p31 - (M + 3 * P - m) / 2) < 1e-12, "c=3 z=1: %.17g, want (M+3p-m)/2", p31);
    const double s32 = FASTag::complementMz(M, 3, 2, m, ComplementRule::SAME_CHARGE);
    CHECK(std::fabs(s32 - (M / 2 + 2 * P - m)) < 1e-12, "c=3 z=2 same_charge");
    const double p42 = FASTag::complementMz(M, 4, 2, m, ComplementRule::PRECURSOR);
    CHECK(std::fabs(p42 - (M + 4 * P - 2 * m) / 2) < 1e-12, "c=4 z=2: partner at 2+");
    CHECK(std::isnan(FASTag::complementMz(M, 2, 2, m, ComplementRule::PRECURSOR)), "z == c has a partner");
    CHECK(std::isnan(FASTag::complementMz(M, 1, 1, m, ComplementRule::PRECURSOR)), "c=1 has a partner");
    CHECK(std::isnan(FASTag::complementMz(M, 3, 4, m, ComplementRule::PRECURSOR)), "z > c has a partner");
    // A real pair: b at 1+ and y at 2+ of a 3+ precursor.
    const double nb = 700.0, ny = M - nb;
    const double y2 = (ny + 2 * P) / 2, b1 = nb + P;
    CHECK(std::fabs(FASTag::complementMz(M, 3, 1, b1, ComplementRule::PRECURSOR) - y2) < 1e-9,
          "precursor rule misses the 2+ partner of a 1+ b ion");
    CHECK(std::fabs(FASTag::complementMz(M, 3, 2, y2, ComplementRule::PRECURSOR) - b1) < 1e-9,
          "precursor rule misses the 1+ partner of a 2+ y ion");
    std::printf("a. complementMz identities\n");
  }

  // ---------------------------------------------------------------- (b)
  {
    const std::string pep = "SAMPLERKDLVEGFNTWQRAGHK";
    // Isotope envelopes, so the deisotoper can move the 2+ y ions.
    const ComplementSynth::Spec s = ComplementSynth::make(pep, 3, true, 3, 0.0, 0, 21);
    FASTag::Param off = FASTag::cliDefaultParam();
    off.deisotope = false;
    const FASTag::Param cli = FASTag::cliDefaultParam();

    const auto off_same = FASTag::complementPopulation(s.spec, s.prec_mz, 3, withRule(off, ComplementRule::SAME_CHARGE));
    const auto off_prec = FASTag::complementPopulation(s.spec, s.prec_mz, 3, withRule(off, ComplementRule::PRECURSOR));
    const auto off_both = FASTag::complementPopulation(s.spec, s.prec_mz, 3, withRule(off, ComplementRule::BOTH));
    const auto cli_same = FASTag::complementPopulation(s.spec, s.prec_mz, 3, withRule(cli, ComplementRule::SAME_CHARGE));
    const auto cli_prec = FASTag::complementPopulation(s.spec, s.prec_mz, 3, withRule(cli, ComplementRule::PRECURSOR));
    const auto cli_both = FASTag::complementPopulation(s.spec, s.prec_mz, 3, withRule(cli, ComplementRule::BOTH));
    std::printf("b. 3+ precursor, y 2+ / b 1+: kept %d/%d peaks; z=1 complements "
                "off: same %d prec %d both %d | cli: same %d prec %d both %d\n",
                pop(off_same, 0), pop(cli_same, 0), pop(off_same, 1), pop(off_prec, 1),
                pop(off_both, 1), pop(cli_same, 1), pop(cli_prec, 1), pop(cli_both, 1));
    CHECK(off_same.size() == 3 && off_prec.size() == 3, "a 3+ precursor tries fragment charges 1 and 2");
    // deisotope off: only the precursor rule pairs b1+ with y2+ (same_charge
    // still pairs the short y ions, which stay at 1+ below 400 Da, with their
    // b ions, plus chance hits among the isotope peaks).
    CHECK(pop(off_prec, 1) >= pop(off_same, 1) + 8, "z=1: precursor rule found %d, same_charge %d",
          pop(off_prec, 1), pop(off_same, 1));
    CHECK(pop(off_prec, 2) >= 2 * pop(off_same, 2) + 8, "z=2: precursor rule found %d, same_charge %d",
          pop(off_prec, 2), pop(off_same, 2));
    CHECK(pop(off_both, 1) >= pop(off_prec, 1) && pop(off_both, 1) >= pop(off_same, 1), "both < either rule");
    // CLI default: the deisotoper moved the y ions onto the 1+ scale, where
    // the same-charge rule pairs them; both finds them as well.
    CHECK(pop(cli_same, 1) >= 10, "deisotoped: same_charge found %d z=1 complements", pop(cli_same, 1));
    CHECK(pop(cli_both, 1) >= 10 && pop(cli_both, 1) >= pop(cli_same, 1) && pop(cli_both, 1) >= pop(cli_prec, 1),
          "deisotoped: both found %d", pop(cli_both, 1));

    // Through tagSpectrum: the rule reaches p_complement via Tables.
    const auto pcompl = [&](const FASTag::Param& p) {
      const FASTag::Tables tab(p);
      int below = 0;
      for (const auto& t : FASTag::tagSpectrum(s.spec, s.prec_mz, 3, p, tab)) below += t.p_complement < 1.0;
      return below;
    };
    const int same_below = pcompl(withRule(off, ComplementRule::SAME_CHARGE));
    const int prec_below = pcompl(withRule(off, ComplementRule::PRECURSOR));
    CHECK(prec_below > same_below, "deisotope off: precursor rule gives %d tags with complement "
          "evidence, same_charge %d", prec_below, same_below);
  }

  // ---------------------------------------------------------------- (c)
  for (const auto& [name, base] : bothParams())
  {
    // Every fragment +0.15 Da: each b/y pair sum is 0.3 Da off.
    const ComplementSynth::Spec s = ComplementSynth::make("VGAHAGEYGAEALERK", 2, false, 0, 0.15, 0, 31);
    FASTag::Param p = base;
    p.frag_tol = 0.5;
    p.tol_ppm = false;
    FASTag::Param frag = p;
    FASTag::Cli::setComplementTolerance(frag, FASTag::Cli::COMPLEMENT_TOLERANCE, 0.5, "fragment");
    FASTag::Param da = p;
    FASTag::Cli::setComplementTolerance(da, 0.02, FASTag::Cli::COMPLEMENT_TOL_FACTOR, "Da");
    CHECK(frag.complement_tol_mode == ComplementTolMode::FRAGMENT && frag.complement_tol_factor == 0.5
          && frag.complement_tol == base.complement_tol, "fragment unit: k in force, the Da value kept");
    // The fragment unit with both values at their CLI defaults runs at the
    // library's k (0.5), not at the Da default 0.02 read as k.
    FASTag::Param unit_only = p;
    FASTag::Cli::setComplementTolerance(unit_only, FASTag::Cli::COMPLEMENT_TOLERANCE,
                                        FASTag::Cli::COMPLEMENT_TOL_FACTOR, "fragment");
    CHECK(unit_only.complement_tol_factor == FASTag::Param{}.complement_tol_factor
          && unit_only.complement_tol_factor == 0.5, "fragment unit alone: k %g, want 0.5",
          unit_only.complement_tol_factor);
    const FASTag::ComplementSpec cs = FASTag::ComplementSpec::fromParam(frag);
    CHECK(std::fabs(cs.tol(400.0, 900.0) - 0.5) < 1e-12, "fragment window at 0.5 Da: %g", cs.tol(400.0, 900.0));
    FASTag::Param ppm = frag;
    ppm.frag_tol = 20.0;
    ppm.tol_ppm = true;
    CHECK(std::fabs(FASTag::ComplementSpec::fromParam(ppm).tol(400.0, 900.0) - 0.5 * 20e-6 * 1300.0) < 1e-12,
          "fragment window in ppm follows both m/z");
    const int nf = pop(FASTag::complementPopulation(s.spec, s.prec_mz, 2, frag), 1);
    const int nd = pop(FASTag::complementPopulation(s.spec, s.prec_mz, 2, da), 1);
    const int kept = pop(FASTag::complementPopulation(s.spec, s.prec_mz, 2, da), 0);
    std::printf("c. [%s] 0.3 Da pair offset: fragment k=0.5 finds %d, 0.02 Da finds %d of %d peaks\n",
                name, nf, nd, kept);
    CHECK(nf >= kept - 2, "[%s] fragment mode found %d of %d", name, nf, kept);
    CHECK(nd <= 2, "[%s] 0.02 Da found %d complements 0.3 Da off", name, nd);
  }

  // ---------------------------------------------------------------- (d)
  {
    struct HG { unsigned N, K, n; };
    const HG cases[] = {{60, 12, 4}, {100, 30, 6}, {40, 35, 7}, {25, 5, 5}, {400, 80, 9}, {10, 10, 4}};
    int checked = 0;
    for (const HG& c : cases)
    {
      boost::math::hypergeometric_distribution<double> h(c.K, c.n, c.N);
      const unsigned lo = (c.n + c.K > c.N) ? c.n + c.K - c.N : 0u, hi = std::min(c.K, c.n);
      for (unsigned obs = lo; obs <= hi; ++obs)
      {
        double above = 0, ge = 0;
        for (unsigned x = obs; x <= hi; ++x)
        {
          const double px = boost::math::pdf(h, x);
          ge += px;
          if (x > obs) above += px;
        }
        const double ref_mid = above + 0.5 * boost::math::pdf(h, obs);
        const double got_mid = FASTag::complementPValue(c.N, c.K, c.n, obs, true);
        CHECK(std::fabs(got_mid - ref_mid) < 1e-12, "mid-p N%u K%u n%u obs%u: %.17g vs %.17g",
              c.N, c.K, c.n, obs, got_mid, ref_mid);
        const double got = FASTag::complementPValue(c.N, c.K, c.n, obs, false);
        const double ref = obs <= lo ? 1.0 : ge;
        CHECK(std::fabs(got - ref) < 1e-12, "plain N%u K%u n%u obs%u: %.17g vs %.17g",
              c.N, c.K, c.n, obs, got, ref);
        CHECK(obs == lo || got_mid < got, "mid-p not below the plain tail at obs%u", obs);
        ++checked;
      }
      CHECK(FASTag::complementPValue(c.N, c.K, c.n, hi + 1, false) == 0.0, "plain above the support");
      CHECK(FASTag::complementPValue(c.N, c.K, c.n, hi + 1, true) == 0.0, "mid-p above the support");
    }
    // Scope: counts 0 and 1 only.
    CHECK(FASTag::complementMidpApplies(true, 0) && FASTag::complementMidpApplies(true, 1)
          && !FASTag::complementMidpApplies(true, 2) && !FASTag::complementMidpApplies(false, 0),
          "mid-p scope is not counts 0 and 1");
    // Mid-p reaches scorePath: tags without a complemented peak (plain p 1)
    // get a mid-p below 1 when the spectrum has complements; a tag either
    // keeps its plain value (2 or more complemented peaks) or moves below
    // it (0 or 1), and both kinds occur.
    int plain_one_total = 0, kept_total = 0, lowered_total = 0;
    for (const auto& [name, base] : bothParams())
    {
      const ComplementSynth::Spec s = ComplementSynth::make("VGAHAGEYGAEALER", 2, false, 1, 0.0, 40, 41);
      FASTag::Param mid = base;
      mid.complement_midp = true;
      const FASTag::Tables tp(base), tm(mid);
      const auto plain = FASTag::tagSpectrum(s.spec, s.prec_mz, 2, base, tp);
      const auto midp = FASTag::tagSpectrum(s.spec, s.prec_mz, 2, mid, tm);
      int plain_one = 0, mid_below = 0, kept = 0, lowered = 0, matched = 0;
      for (const auto& t : plain) plain_one += t.p_complement == 1.0;
      for (const auto& t : midp) mid_below += t.p_complement < 1.0;
      for (const auto& m : midp)
        for (const auto& t : plain)
        {
          if (t.seq != m.seq || t.charge != m.charge || t.low_mz != m.low_mz) continue;
          ++matched;
          if (m.p_complement == t.p_complement) ++kept;
          else if (m.p_complement < t.p_complement) ++lowered;
          else CHECK(false, "[%s] mid-p raised %s from %g to %g", name, m.seq.c_str(), t.p_complement,
                     m.p_complement);
          CHECK(t.p_complement < 1.0 || m.p_complement < 1.0, "[%s] mid-p left %s at p=1", name,
                m.seq.c_str());
          break;
        }
      std::printf("d. [%s] mid-p: %zu/%zu tags, %d plain at p=1, %d mid-p below 1; of %d matched, "
                  "%d keep the plain value, %d lowered\n",
                  name, plain.size(), midp.size(), plain_one, mid_below, matched, kept, lowered);
      CHECK(!plain.empty(), "[%s] no tags", name);
      CHECK(matched > 0, "[%s] no tag in both runs", name);
      plain_one_total += plain_one;
      kept_total += kept;
      lowered_total += lowered;
    }
    CHECK(plain_one_total > 0, "no tag without complement evidence; the mid-p check proves nothing");
    CHECK(kept_total > 0, "no tag with 2 or more complemented peaks kept its plain value");
    CHECK(lowered_total > 0, "no tag moved to mid-p");
    std::printf("d. %d hypergeometric points against Boost\n", checked);
  }

  // ---------------------------------------------------------------- (e)
  {
    FASTag::Param cli = FASTag::cliDefaultParam();
    FASTag::Param off = cli;
    off.deisotope = false;
    const FASTag::Param* params[2] = {&cli, &off};
    int rows = 0, worst_rank = 0;
    double worst = 0;
    for (int pi = 0; pi < 2; ++pi)
    {
      const FASTag::Tables tab(*params[pi]);
      for (int ci = 0; ci < 5; ++ci)
      {
        const ComplementSynth::Case& c = ComplementSynth::kRefCases[ci];
        const ComplementSynth::Spec s = ComplementSynth::make(c.pep, c.charge, c.y2, c.iso, 0.0, c.noise, c.seed);
        const auto tags = FASTag::tagSpectrum(s.spec, s.prec_mz, c.charge, *params[pi], tab);
        for (const RefRow& r : REF)
        {
          if (r.ci != ci || r.pi != pi) continue;
          if (r.rank == 999)
          {
            CHECK(tags.size() == static_cast<size_t>(r.evalue), "case %d param %d: %zu tags, 1.11 wrote %g",
                  ci, pi, tags.size(), r.evalue);
            continue;
          }
          ++rows;
          if (r.rank >= tags.size()) { CHECK(false, "case %d param %d: no rank %zu", ci, pi, r.rank); continue; }
          const FASTag::Tag& t = tags[r.rank];
          CHECK(t.seq == r.seq && t.charge == r.charge, "case %d param %d rank %zu: %s/%d, 1.11 %s/%d",
                ci, pi, r.rank, t.seq.c_str(), t.charge, r.seq, r.charge);
          const double de = std::fabs(t.evalue - r.evalue) / std::max(1e-300, std::fabs(r.evalue));
          const double dp = std::fabs(t.p_complement - r.p_complement);
          if (de > worst) { worst = de; worst_rank = static_cast<int>(r.rank); }
          CHECK(de <= 1e-12 && dp <= 1e-15, "case %d param %d rank %zu: E %.17g vs 1.11 %.17g, p_c %.17g vs %.17g",
                ci, pi, r.rank, t.evalue, r.evalue, t.p_complement, r.p_complement);
        }
      }
    }
    std::printf("e. %d rows equal FASTag 1.11.0 (largest relative E-value difference %.3g at rank %d)\n",
                rows, worst, worst_rank);
    CHECK(rows >= 40, "only %d reference rows; the check would prove little", rows);
    // The spelled-out generator Param is the CLI's.
    CHECK(cli.complement_rule == ComplementRule::SAME_CHARGE && cli.complement_tol_mode == ComplementTolMode::DA
          && cli.complement_tol == 0.02 && !cli.complement_midp, "CLI complement defaults are not 1.11's");
  }

  // ---------------------------------------------------------- negatives
  for (const auto& [name, base] : bothParams())
  {
    const ComplementSynth::Spec s = ComplementSynth::make("VGAHAGEYGAEALER", 1, false, 1, 0.0, 10, 51);
    const FASTag::Param prec = withRule(base, ComplementRule::PRECURSOR);
    const auto v = FASTag::complementPopulation(s.spec, s.prec_mz, 1, prec);
    CHECK(v.size() == 2 && v[1] == 0, "[%s] charge 1 under precursor: %d complements", name, pop(v, 1));
    const FASTag::Tables tab(prec);
    const auto tags = FASTag::tagSpectrum(s.spec, s.prec_mz, 1, prec, tab);
    int with = 0;
    for (const auto& t : tags) with += t.p_complement != 1.0;
    CHECK(with == 0, "[%s] charge 1 under precursor: %d tags carry a complement p-value", name, with);
    FASTag::Param mid = prec;
    mid.complement_midp = true;
    const FASTag::Tables tm(mid);
    int with_mid = 0;
    for (const auto& t : FASTag::tagSpectrum(s.spec, s.prec_mz, 1, mid, tm)) with_mid += t.p_complement != 1.0;
    CHECK(with_mid == 0, "[%s] mid-p scored an empty complement population (%d tags)", name, with_mid);

    // The fragment-charge cap: a 12+ precursor tries charges 1..8.
    const ComplementSynth::Spec s12 = ComplementSynth::make("VGAHAGEYGAEALERSAMPLERKDLVEGFNTWQR", 12, false, 0, 0.0, 0, 52);
    for (ComplementRule r : {ComplementRule::SAME_CHARGE, ComplementRule::PRECURSOR, ComplementRule::BOTH})
    {
      const auto v12 = FASTag::complementPopulation(s12.spec, s12.prec_mz, 12, withRule(base, r));
      CHECK(v12.size() == 9, "[%s] charge 12: %zu fragment-charge slots, want 8 + 1", name, v12.size());
      const FASTag::Tables t12(withRule(base, r));
      for (const auto& t : FASTag::tagSpectrum(s12.spec, s12.prec_mz, 12, withRule(base, r), t12))
        CHECK(t.charge >= 1 && t.charge <= 8 && std::isfinite(t.evalue), "[%s] tag at charge %d", name, t.charge);
    }
  }
  std::printf("negatives: charge 1 under precursor, charge cap 8\n");

  if (failures) { std::printf("%d failure(s)\n", failures); return 1; }
  std::printf("complement_test: all checks passed\n");
  return 0;
}
