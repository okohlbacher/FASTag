// See SpeciesCall.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "SpeciesCall.h"

#include "TaxDeconv.h"
#include "TaxStats.h"

#include <OpenMS/MATH/STATISTICS/MultipleTesting.h>

#include <boost/math/special_functions/gamma.hpp>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <map>
#include <numeric>

namespace FASTag::SpeciesCall
{
  namespace
  {
    bool parseDouble(const std::string& s, double& v)
    {
      if (s.empty()) return false;
      char* end = nullptr;
      errno = 0;
      v = std::strtod(s.c_str(), &end);
      return errno == 0 && end == s.c_str() + s.size() && std::isfinite(v);
    }
    bool parseUInt(const std::string& s, uint64_t& v)
    {
      if (s.empty() || s.find_first_not_of("0123456789") != std::string::npos) return false;
      char* end = nullptr;
      errno = 0;
      v = std::strtoull(s.c_str(), &end, 10);
      return errno == 0 && end == s.c_str() + s.size();
    }
    std::string trim(const std::string& s)
    {
      const auto b = s.find_first_not_of(" \t\r\n");
      if (b == std::string::npos) return std::string();
      const auto e = s.find_last_not_of(" \t\r\n");
      return s.substr(b, e - b + 1);
    }
  }

  bool loadParams(const std::string& path, Params& out, std::string* err)
  {
    const auto fail = [&](const std::string& why) {
      if (err) *err = path + ": " + why;
      return false;
    };
    std::ifstream in(path.c_str());
    if (!in) return fail("cannot open the -species_call parameter file");
    std::map<std::string, std::string> kv;
    std::string line;
    int ln = 0;
    while (std::getline(in, line))
    {
      ++ln;
      const std::string t = trim(line);
      if (t.empty() || t[0] == '#') continue;
      const auto tab = t.find('\t');
      if (tab == std::string::npos) return fail("line " + std::to_string(ln) + " is not key<TAB>value");
      const std::string key = trim(t.substr(0, tab));
      const std::string val = trim(t.substr(tab + 1));
      if (key != "alpha" && key != "tau" && key != "n_min" && key != "decoys" && key != "version"
          && key != "training_sha256")
        return fail("unknown key '" + key + "' (line " + std::to_string(ln) + ")");
      if (kv.count(key)) return fail("duplicate key '" + key + "'");
      kv[key] = val;
    }
    Params p;
    for (const char* need : {"alpha", "tau", "n_min"})
      if (!kv.count(need)) return fail(std::string("missing key '") + need + "'");
    if (!parseDouble(kv["alpha"], p.alpha) || !(p.alpha > 0.0 && p.alpha <= 1.0))
      return fail("alpha must be a number in (0, 1], not '" + kv["alpha"] + "'");
    if (!parseDouble(kv["tau"], p.tau) || !(p.tau >= 0.0 && p.tau <= 1.0))
      return fail("tau must be a number in [0, 1], not '" + kv["tau"] + "'");
    if (!parseUInt(kv["n_min"], p.n_min) || p.n_min < 1)
      return fail("n_min must be an integer >= 1, not '" + kv["n_min"] + "'");
    if (kv.count("decoys"))
    {
      uint64_t d = 0;
      if (!parseUInt(kv["decoys"], d) || d > 1000)
        return fail("decoys must be an integer in [0, 1000], not '" + kv["decoys"] + "'");
      p.decoys = static_cast<int>(d);
    }
    if (kv.count("version")) p.version = kv["version"];
    if (kv.count("training_sha256")) p.training_sha256 = kv["training_sha256"];
    out = p;
    return true;
  }

  const char* callName(Call c)
  {
    switch (c)
    {
      case Call::Present: return "present";
      case Call::NoCall: return "no_call";
      case Call::NotDetected: return "not_detected";
    }
    return "not_detected";
  }

  double poissonUpperTail(uint64_t o, double lambda)
  {
    if (o == 0) return 1.0;
    if (!(lambda > 0.0)) return 0.0;
    // P(X >= o) = P(o, lambda), the regularised lower incomplete gamma; Boost
    // computes the small tail directly, without 1 - cdf cancellation.
    return boost::math::gamma_p(static_cast<double>(o), lambda);
  }

  double randomExpected(uint64_t decoy_spectra, int decoys, uint64_t n_trials)
  {
    const double D = static_cast<double>(std::max(1, decoys));
    const double N = static_cast<double>(std::max<uint64_t>(1, n_trials));
    const double r = (static_cast<double>(decoy_spectra) + 0.5) / (D * N);
    return r * N;
  }

  std::vector<double> qValues(const std::vector<double>& p, double pi0)
  {
    if (p.empty()) return {};
    std::vector<double> q = OpenMS::Math::MultipleTesting::qValue(p, pi0);
    for (double& v : q) v = std::min(1.0, v);
    return q;
  }

  double estimatePi0(const std::vector<double>& p)
  {
    if (p.size() < 2) return 1.0;
    double pi0 = 1.0;
    try
    {
      pi0 = OpenMS::Math::MultipleTesting::pi0Est(p).pi0;
    }
    catch (...)
    {
      return 1.0;
    }
    if (!(pi0 > 0.0) || !std::isfinite(pi0)) return 1.0;
    return std::min(1.0, pi0);
  }

  std::vector<uint64_t> rollUpOverlap(const std::vector<uint64_t>& overlap, std::size_t n,
                                      const std::vector<int>& group_of, std::size_t n_groups)
  {
    std::vector<uint64_t> r(n_groups * n_groups, 0);
    if (overlap.size() < n * n || group_of.size() < n) return r;
    for (std::size_t i = 0; i < n; ++i)
    {
      const int a = group_of[i];
      if (a < 0 || static_cast<std::size_t>(a) >= n_groups) continue;
      for (std::size_t j = 0; j < n; ++j)
      {
        const int b = group_of[j];
        if (b < 0 || static_cast<std::size_t>(b) >= n_groups) continue;
        r[static_cast<std::size_t>(a) * n_groups + static_cast<std::size_t>(b)] += overlap[i * n + j];
      }
    }
    return r;
  }

  std::vector<double> rollUpConditional(const std::vector<uint64_t>& overlap, std::size_t n,
                                        const std::vector<int>& group_of, std::size_t n_groups)
  {
    return conditionalMatrix(rollUpOverlap(overlap, n, group_of, n_groups), n_groups);
  }

  std::vector<GenusStat> callGenera(const std::vector<GenusInput>& genera,
                                    const std::vector<double>& C,
                                    const RunInput& run, const Params& params)
  {
    const std::size_t n = genera.size();
    std::vector<GenusStat> st(n);
    if (n == 0) return st;
    const bool homology = C.size() == n * n;

    std::vector<std::size_t> tested;
    for (std::size_t i = 0; i < n; ++i)
    {
      GenusStat& s = st[i];
      s.taxid = genera[i].taxid;
      s.observed = genera[i].observed;
      s.decoy_spectra = genera[i].decoy_spectra;
      s.share = genera[i].share;
      s.random_expected = randomExpected(s.decoy_spectra, run.decoys, run.n_trials);
      s.tested = s.observed >= Taxonomy::kObservedFloor;
      if (s.tested) tested.push_back(i);
    }
    // Descending observed count, ties by taxid: the order in which spill
    // flows (from a genus to the ones below it).
    std::vector<std::size_t> order(n);
    std::iota(order.begin(), order.end(), std::size_t(0));
    std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
      if (st[a].observed != st[b].observed) return st[a].observed > st[b].observed;
      return st[a].taxid < st[b].taxid;
    });

    const auto qOverTested = [&](const std::vector<double>& p, std::vector<double>& q, double& pi0) {
      std::vector<double> pt;
      pt.reserve(tested.size());
      for (std::size_t i : tested) pt.push_back(p[i]);
      pi0 = run.pi0 > 0.0 ? std::min(1.0, run.pi0) : estimatePi0(pt);
      const std::vector<double> qt = qValues(pt, pi0);
      q.assign(n, 1.0);
      for (std::size_t k = 0; k < tested.size() && k < qt.size(); ++k) q[tested[k]] = qt[k];
    };

    // The random part alone (for near_neighbour).
    std::vector<double> p_rand(n), q_rand;
    for (std::size_t i = 0; i < n; ++i) p_rand[i] = poissonUpperTail(st[i].observed, st[i].random_expected);
    double pi0_rand = 1.0;
    qOverTested(p_rand, q_rand, pi0_rand);

    // Spill depends on which genera above are present, and presence on the
    // q-values of all of them, so iterate to a fixed point: start from no
    // genus present (the random null), recompute spill, p and q, and stop
    // when the present set no longer changes. Bounded by n + 2 rounds; the
    // statistics reported are those the final decision was taken on.
    const auto qualifies = [&](std::size_t i, double q) {
      return st[i].tested && q <= params.alpha && st[i].share >= params.tau && st[i].observed >= params.n_min;
    };
    std::vector<char> present(n, 0), next(n, 0);
    std::vector<double> spill(n, 0.0), p(n, 1.0), q;
    double pi0 = 1.0;
    for (std::size_t round = 0; round < n + 2; ++round)
    {
      for (std::size_t pos = 0; pos < n; ++pos)
      {
        const std::size_t g = order[pos];
        double sp = 0.0;
        if (homology)
          for (std::size_t up = 0; up < pos; ++up)
          {
            const std::size_t h = order[up];
            if (!present[h]) continue;
            double Nh = genera[h].deconvolved;
            if (!std::isfinite(Nh) || Nh < 0.0) Nh = static_cast<double>(genera[h].observed);
            const double c = C[g * n + h];
            if (std::isfinite(c) && c > 0.0) sp += c * Nh;
          }
        spill[g] = sp;
        p[g] = poissonUpperTail(st[g].observed, sp + st[g].random_expected);
      }
      qOverTested(p, q, pi0);
      for (std::size_t i = 0; i < n; ++i) next[i] = qualifies(i, q[i]) ? 1 : 0;
      if (next == present) break;
      present.swap(next);
    }
    // The decision below is taken on the last computed spill, p and q (at
    // the fixed point the present set it gives is the one the spill used).

    const std::size_t m = tested.size();
    for (std::size_t i = 0; i < n; ++i)
    {
      GenusStat& s = st[i];
      s.spill = spill[i];
      s.expected = spill[i] + s.random_expected;
      s.pvalue = p[i];
      s.qvalue = q[i];
      s.qvalue_random = q_rand[i];
      s.lod = -1.0;
      if (run.low_resolution) { s.call = Call::NoCall; s.reason = "low_resolution"; continue; }
      if (run.n_units < run.min_units) { s.call = Call::NoCall; s.reason = "few_spectra"; continue; }
      if (qualifies(i, q[i])) { s.call = Call::Present; s.reason = "pass"; continue; }
      if (s.tested && s.qvalue_random <= params.alpha && s.qvalue > params.alpha)
      {
        s.call = Call::NoCall;
        s.reason = "near_neighbour";
        continue;
      }
      s.call = Call::NotDetected;
      if (!s.tested || s.qvalue > params.alpha) s.reason = "not_significant";
      else if (!(s.share >= params.tau)) s.reason = "low_share";
      else s.reason = "few_genus_spectra";

      // Detection limit: the smallest count that would have been significant
      // with this genus's lambda, joining the R genera already significant
      // (BH threshold alpha * (R + 1) / (m * pi0)), and that also meets the
      // n_min, floor and tau rules, as a share of the run's units. Above 1
      // means the genus could not have been detected in this run at all.
      std::size_t R = 0;
      for (std::size_t j : tested) if (j != i && q[j] <= params.alpha) ++R;
      const double m_eff = static_cast<double>(m + (s.tested ? 0 : 1));
      const double thr = params.alpha * static_cast<double>(R + 1) / (m_eff * pi0);
      uint64_t o_star = 0;
      if (thr < 1.0)
      {
        const double lam = s.expected;
        uint64_t lo = 0, hi = std::max<uint64_t>(1, static_cast<uint64_t>(std::ceil(lam)));
        while (poissonUpperTail(hi, lam) > thr && hi < (uint64_t(1) << 50)) hi *= 2;
        // invariant: tail(lo) > thr >= tail(hi)
        while (hi - lo > 1)
        {
          const uint64_t mid = lo + (hi - lo) / 2;
          if (poissonUpperTail(mid, lam) > thr) lo = mid; else hi = mid;
        }
        o_star = hi;
      }
      const uint64_t by_tau = static_cast<uint64_t>(std::ceil(params.tau * static_cast<double>(run.n_units) - 1e-9));
      const uint64_t o_lod = std::max<uint64_t>({o_star, params.n_min, Taxonomy::kObservedFloor, by_tau});
      if (run.n_units > 0) s.lod = static_cast<double>(o_lod) / static_cast<double>(run.n_units);
    }
    return st;
  }
}
