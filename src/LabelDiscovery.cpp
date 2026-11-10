// Database-free label discovery (-label_discovery_out). See LabelDiscovery.h
// and doc/DESIGN-label-discovery.md.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "LabelDiscovery.h"

#include <OpenMS/CHEMISTRY/ModificationsDB.h>
#include <OpenMS/CHEMISTRY/ResidueModification.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <limits>
#include <map>
#include <numeric>
#include <set>
#include <utility>

namespace FASTag::LabelDiscovery
{
  namespace
  {
    using u64 = std::uint64_t;
    using i64 = std::int64_t;

    bool fullPrecision()
    {
      static const bool on = [] {
        const char* e = std::getenv("FASTAG_FULL_PRECISION");
        return e != nullptr && std::string(e) == "1";
      }();
      return on;
    }
    /// A number rounded to @p dp decimals (unless FASTAG_FULL_PRECISION=1).
    std::string fix(double v, int dp)
    {
      if (!std::isfinite(v)) return "-";
      if (!fullPrecision())
      {
        const double f = std::pow(10.0, dp);
        v = std::round(v * f) / f;
        if (v == 0.0) v = 0.0;  // no "-0"
      }
      return Digest::num(v);
    }
    std::string signedFix(double v, int dp)
    {
      std::string s = fix(v, dp);
      if (!s.empty() && s[0] != '-') s = "+" + s;
      return s;
    }
    std::string fixed4(double v)
    {
      char b[64];
      std::snprintf(b, sizeof b, "%+.4f", v);
      return b;
    }

    double median(std::vector<double> v)
    {
      if (v.empty()) return 0.0;
      std::sort(v.begin(), v.end());
      const std::size_t n = v.size();
      return n % 2 ? v[n / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
    }
    double mad(const std::vector<double>& v, double centre)
    {
      std::vector<double> d;
      d.reserve(v.size());
      for (double x : v) d.push_back(std::fabs(x - centre));
      return median(std::move(d));
    }
    double quantile(std::vector<double> v, double q)
    {
      if (v.empty()) return 0.0;
      std::sort(v.begin(), v.end());
      const double pos = q * static_cast<double>(v.size() - 1);
      const std::size_t lo = static_cast<std::size_t>(std::floor(pos));
      const std::size_t hi = std::min(v.size() - 1, lo + 1);
      return v[lo] + (pos - static_cast<double>(lo)) * (v[hi] - v[lo]);
    }
    /// Weighted median of (value, weight) pairs, ascending by value.
    double weightedMedian(const std::vector<std::pair<double, double>>& vw)
    {
      double tot = 0;
      for (const auto& p : vw) tot += p.second;
      if (tot <= 0) return 0.0;
      double acc = 0;
      for (const auto& p : vw)
      {
        acc += p.second;
        if (acc >= 0.5 * tot) return p.first;
      }
      return vw.back().first;
    }

    const std::array<const char*, 22> kCuratedLabels = {
        "Dimethyl", "Dimethyl:2H(4)", "Dimethyl:2H(4)13C(2)", "Dimethyl:2H(6)13C(2)", "Dimethyl:2H(6)",
        "Dimethyl:13C(2)", "Acetyl", "Acetyl:2H(3)", "Propionyl", "Propionyl:13C(3)", "Carbamyl",
        "TMT6plex", "TMT", "TMT2plex", "TMTpro", "TMTpro_zero", "iTRAQ4plex", "iTRAQ8plex",
        "DiLeu4plex", "DiLeu4plex115", "DiLeu4plex117", "DiLeu4plex118"};
    int curatedIndex(const std::string& id)
    {
      for (std::size_t i = 0; i < kCuratedLabels.size(); ++i)
        if (id == kCuratedLabels[i]) return static_cast<int>(i);
      return -1;
    }
    /// The group priority of section 8: curated labels, then ISOTOPIC_LABEL or
    /// CHEMICAL_DERIVATIVE, then the rest, ARTIFACT and Delta: entries last.
    int priorityRank(const UnimodEntry& e)
    {
      const int c = curatedIndex(e.id);
      if (c >= 0) return c;
      if (e.classification == kClassIsotopicLabel || e.classification == kClassChemicalDerivative) return 100;
      if (e.classification == kClassArtifact || e.id.rfind("Delta:", 0) == 0) return 300;
      return 200;
    }
    bool anyOrigin(char o) { return o == 'X' || o == '.' || o == '\0' || o == ' '; }
  }

  // ---- records ---------------------------------------------------------------

  std::uint8_t residueFlags(std::string_view s)
  {
    std::uint8_t f = 0;
    if (s.empty()) return f;
    if (s.front() == 'K') f |= kFirstK;
    if (s.front() == 'R') f |= kFirstR;
    if (s.back() == 'K') f |= kLastK;
    if (s.back() == 'R') f |= kLastR;
    return f;
  }

  void Collector::configure(const std::vector<KnownSet>& k, double w)
  {
    known = k;
    known_window = w;
    known_tags.assign(known.size(), {});
    known_spectra.assign(known.size(), {});
    last_.assign(known.size(), {});
  }

  void Collector::add(double nterm, double cterm, double M, std::uint32_t spectrum, std::uint16_t order,
                      std::string_view seq, bool is_cz)
  {
    // ld_known: the -label_out near_ rule on the values as written (double),
    // every counted tag (as TerminusCounter::add counts them).
    const double w = known_window;
    auto near = [w](double v, double m) { return v >= m - w && v <= m + w; };
    for (std::size_t i = 0; i < known.size(); ++i)
    {
      const double L = known[i].mass;
      const bool hit[kKnownImages] = {near(nterm, L), near(cterm, L - kH2O), near(cterm, L), near(cterm, kMassK + L),
                                      near(nterm, kMassK + L + kH2O)};
      for (int j = 0; j < kKnownImages; ++j)
      {
        if (!hit[j]) continue;
        ++known_tags[i][static_cast<std::size_t>(j)];
        const u64 key = static_cast<u64>(spectrum) + 1;
        if (last_[i][static_cast<std::size_t>(j)] != key)
        {
          last_[i][static_cast<std::size_t>(j)] = key;
          ++known_spectra[i][static_cast<std::size_t>(j)];
        }
      }
    }
    if (is_cz)
    {
      ++cz;
      return;
    }
    Record r;
    r.n = static_cast<float>(nterm);
    r.c = static_cast<float>(cterm);
    r.M = static_cast<float>(M);
    r.spectrum = spectrum;
    r.order = order;
    r.flags = residueFlags(seq);
    records.push_back(r);
  }

  void Collector::merge(const Collector& o)
  {
    records.insert(records.end(), o.records.begin(), o.records.end());
    cz += o.cz;
    if (known_tags.size() < o.known_tags.size())
    {
      known = o.known;
      known_tags.resize(o.known_tags.size(), {});
      known_spectra.resize(o.known_spectra.size(), {});
    }
    for (std::size_t i = 0; i < o.known_tags.size(); ++i)
      for (int j = 0; j < kKnownImages; ++j)
      {
        known_tags[i][static_cast<std::size_t>(j)] += o.known_tags[i][static_cast<std::size_t>(j)];
        known_spectra[i][static_cast<std::size_t>(j)] += o.known_spectra[i][static_cast<std::size_t>(j)];
      }
  }

  void Collector::finish()
  {
    std::stable_sort(records.begin(), records.end(), [](const Record& a, const Record& b) {
      return a.spectrum != b.spectrum ? a.spectrum < b.spectrum : a.order < b.order;
    });
  }

  // ---- settings --------------------------------------------------------------

  std::vector<Residue> runAlphabet(const std::vector<AlphabetMod>& mods)
  {
    std::vector<Residue> out;
    const auto& keys = Digest::residueKeys();
    for (int i = 0; i < Digest::kNumAA; ++i)
    {
      Residue r;
      r.letter = Digest::kAAs[static_cast<std::size_t>(i)];
      r.name = std::string(1, r.letter);
      r.mass = r.letter == 'C' ? 103.00919 : keys[static_cast<std::size_t>(i)].mass;
      for (const AlphabetMod& m : mods)
        if (!m.variable && (m.residue == r.letter || (r.letter == 'L' && m.residue == 'I'))) r.mass += m.delta;
      out.push_back(r);
    }
    const std::size_t base = out.size();
    for (const AlphabetMod& m : mods)
    {
      if (!m.variable) continue;
      const char letter = m.residue == 'I' ? 'L' : m.residue;
      for (std::size_t i = 0; i < base; ++i)
        if (out[i].letter == letter)
        {
          Residue r = out[i];
          r.mass += m.delta;
          r.name = std::string(1, letter) + "[" + m.name + "]";
          out.push_back(r);
        }
    }
    return out;
  }

  std::vector<KnownSet> Settings::knownSets() const
  {
    std::vector<KnownSet> k;
    for (const auto& l : Digest::labelKeys()) k.push_back({l.name, l.mass});
    if (fixed_nterm != 0.0) k.push_back({fixed_nterm_name.empty() ? std::string("fixed_nterm") : fixed_nterm_name, fixed_nterm});
    for (const KnownSet& f : fixed_k) k.push_back(f);
    // unique names
    for (std::size_t i = 0; i < k.size(); ++i)
      for (std::size_t j = 0; j < i; ++j)
        if (k[i].name == k[j].name) k[i].name += "#" + std::to_string(i);
    return k;
  }

  // ---- Unimod adaptor -----------------------------------------------------------

  void UnimodTable::sort()
  {
    std::sort(entries.begin(), entries.end(), [](const UnimodEntry& a, const UnimodEntry& b) {
      if (a.mass != b.mass) return a.mass < b.mass;
      if (a.record_id != b.record_id) return a.record_id < b.record_id;
      return a.full_id < b.full_id;
    });
  }

  UnimodTable UnimodTable::fromModificationsDB()
  {
    UnimodTable t;
    const OpenMS::ModificationsDB* db = OpenMS::ModificationsDB::getInstance();
    const std::size_t n = db->getNumberOfModifications();
    for (std::size_t i = 0; i < n; ++i)
    {
      const OpenMS::ResidueModification* m = db->getModification(i);
      if (m == nullptr || m->getUniModRecordId() <= 0) continue;
      UnimodEntry e;
      e.id = m->getId();
      e.full_id = m->getFullId();
      e.formula = m->getDiffFormula().toString();
      e.record_id = m->getUniModRecordId();
      e.mass = m->getDiffMonoMass();
      e.origin = m->getOrigin();
      e.term = static_cast<Term>(static_cast<int>(m->getTermSpecificity()));
      e.classification = static_cast<int>(m->getSourceClassification());
      if (!std::isfinite(e.mass)) continue;
      t.entries.push_back(std::move(e));
    }
    t.sort();
    return t;
  }

  // ---- calibration ------------------------------------------------------------------

  namespace
  {
    std::vector<double> referenceMasses(const std::vector<Residue>& alphabet)
    {
      std::vector<double> m;
      for (const Residue& r : alphabet) m.push_back(r.mass);
      m.push_back(kMassK);
      m.push_back(kMassR);
      std::sort(m.begin(), m.end());
      m.erase(std::unique(m.begin(), m.end(), [](double a, double b) { return std::fabs(a - b) < 1e-9; }), m.end());
      return m;
    }
    /// Index of the reference nearest @p v within kRefWindow, or -1.
    int nearestRef(const std::vector<double>& refs, double v)
    {
      const auto it = std::lower_bound(refs.begin(), refs.end(), v);
      int best = -1;
      double bd = kRefWindow;
      if (it != refs.end() && std::fabs(*it - v) <= bd) { best = static_cast<int>(it - refs.begin()); bd = std::fabs(*it - v); }
      if (it != refs.begin())
      {
        const auto p = it - 1;
        if (std::fabs(*p - v) <= bd && (best < 0 || std::fabs(*p - v) < bd)) best = static_cast<int>(p - refs.begin());
      }
      return best;
    }
  }

  Calibration calibrate(const std::vector<Record>& records, const std::vector<Residue>& alphabet)
  {
    // Reference deviations form a peak when most of them lie near their
    // median; chance values near a residue mass (a run whose C-termini all
    // carry a modification) spread over the whole reference window.
    auto peaked = [](const std::vector<double>& dev) {
      if (dev.empty()) return false;
      const double c = median(dev);
      std::size_t near = 0;
      for (double d : dev) near += std::fabs(d - c) <= kReferencePeakHalfWidth;
      return static_cast<double>(near) >= kReferencePeakShare * static_cast<double>(dev.size());
    };
    Calibration cal;
    const std::vector<double> refs = referenceMasses(alphabet);
    // channel n: the reversed read of a one-residue C side, which in a
    // tryptic run is K or R (n = K + H2O, R + H2O); other residue masses
    // there are mostly chance compositions
    std::vector<double> refs_n{kMassK, kMassR};
    for (const Residue& r : alphabet)
      if (r.letter == 'K' || r.letter == 'R') refs_n.push_back(r.mass);
    std::sort(refs_n.begin(), refs_n.end());
    refs_n.erase(std::unique(refs_n.begin(), refs_n.end(), [](double a, double b) { return std::fabs(a - b) < 1e-9; }),
                 refs_n.end());
    std::vector<double> ppm_c, ppm_n, ppm_n_all;
    std::vector<int> ref_c;
    std::vector<double> dev_c_da, mass_c;
    for (const Record& r : records)
    {
      if (r.c > 0)
      {
        const int k = nearestRef(refs, r.c);
        if (k >= 0)
        {
          const double m = refs[static_cast<std::size_t>(k)];
          ppm_c.push_back((r.c - m) / m * 1e6);
          ref_c.push_back(k);
          dev_c_da.push_back(r.c - m);
          mass_c.push_back(m);
        }
      }
      if (r.n > 0 && r.M > 0)
      {
        // the spread (window) from every residue, the offset from K and R
        const int k = nearestRef(refs, r.n - kH2O);
        if (k >= 0) ppm_n_all.push_back((r.n - (refs[static_cast<std::size_t>(k)] + kH2O)) / r.M * 1e6);
        const int q = nearestRef(refs_n, r.n - kH2O);
        if (q >= 0) ppm_n.push_back((r.n - (refs_n[static_cast<std::size_t>(q)] + kH2O)) / r.M * 1e6);
      }
    }
    cal.n_ref_c = ppm_c.size();
    cal.n_ref_n = ppm_n.size();
    cal.n_ref_n_all = ppm_n_all.size();
    // per-reference medians of channel c (>= kPerReferenceMin values each)
    auto perRefMedians = [&](const std::vector<double>& resid_ppm) {
      std::vector<std::pair<double, double>> pts;  // (mass, median ppm)
      std::vector<std::vector<double>> by(refs.size());
      for (std::size_t i = 0; i < resid_ppm.size(); ++i) by[static_cast<std::size_t>(ref_c[i])].push_back(resid_ppm[i]);
      for (std::size_t k = 0; k < refs.size(); ++k)
        if (by[k].size() >= kPerReferenceMin) pts.emplace_back(refs[k], median(by[k]));
      return pts;
    };
    if (cal.n_ref_c >= kMinCalibrationReference)
    {
      cal.estimated_c = true;
      cal.ppm_c = median(ppm_c);
      // linear term: Theil-Sen over the per-reference medians
      double lo = std::numeric_limits<double>::infinity(), hi = -lo;
      for (double m : mass_c) { lo = std::min(lo, m); hi = std::max(hi, m); }
      std::vector<std::pair<double, double>> pts = perRefMedians(ppm_c);
      if (cal.n_ref_c >= kSlopeReference && hi - lo >= kSlopeSpan && pts.size() >= 3)
      {
        std::vector<double> slopes;
        for (std::size_t i = 0; i < pts.size(); ++i)
          for (std::size_t j = i + 1; j < pts.size(); ++j)
            if (pts[j].first != pts[i].first) slopes.push_back((pts[j].second - pts[i].second) / (pts[j].first - pts[i].first));
        if (!slopes.empty())
        {
          cal.slope = true;
          cal.slope_c = median(slopes);
          std::vector<double> ic;
          for (const auto& p : pts) ic.push_back(p.second - cal.slope_c * p.first);
          cal.intercept_c = median(ic);
        }
      }
      std::vector<double> resid_ppm(ppm_c.size()), resid_da(ppm_c.size());
      for (std::size_t i = 0; i < ppm_c.size(); ++i)
      {
        resid_ppm[i] = ppm_c[i] - cal.ppmC(mass_c[i]);
        resid_da[i] = dev_c_da[i] - cal.ppmC(mass_c[i]) * mass_c[i] * 1e-6;
      }
      cal.sigma_c = 1.4826 * mad(resid_da, median(resid_da));
      // The residual uncertainty: the standard error of the offset plus the
      // spread of the per-reference medians. Each reference's median is
      // taken over its residuals within a tight window (4 sigma_c, at least
      // 2 mDa) around the calibrated position, so that a neighbouring peak
      // inside the 0.02 Da reference window (+-350 ppm at G, 57 Da) does
      // not move it; the spread is the robust standard deviation of the
      // medians (1.4826 MAD; with two references half their difference),
      // not their range, which one contaminated reference sets (evaluation
      // 1: above 50 ppm on 64 of 183 runs).
      const double tight = std::max(4.0 * cal.sigma_c, 0.002), rc = median(resid_da);
      std::vector<double> tight_ppm;
      std::vector<std::vector<double>> byref(refs.size());
      for (std::size_t i = 0; i < resid_ppm.size(); ++i)
        if (std::fabs(resid_da[i] - rc) <= tight)
        {
          tight_ppm.push_back(resid_ppm[i]);
          byref[static_cast<std::size_t>(ref_c[i])].push_back(resid_ppm[i]);
        }
      std::vector<double> meds;
      for (const auto& v : byref)
        if (v.size() >= kPerReferenceMin) meds.push_back(median(v));
      double spread = 0;
      if (meds.size() >= 3) spread = 1.4826 * mad(meds, median(meds));
      else if (meds.size() == 2) spread = 0.5 * std::fabs(meds[0] - meds[1]);
      const std::vector<double>& base = tight_ppm.size() >= kMinCalibrationReference ? tight_ppm : resid_ppm;
      cal.unc_ppm_c = mad(base, median(base)) / std::sqrt(static_cast<double>(base.size())) + spread;
      // references that do not form a peak (deviations spread over the
      // whole reference window: chance values near a residue mass, as in a
      // run whose C-termini all carry a modification) calibrate nothing
      if (!peaked(dev_c_da) || std::fabs(cal.ppm_c) > kMaxCalibrationPpm)
      {
        cal.estimated_c = false;
        cal.slope = false;
        cal.ppm_c = 0;
        cal.unc_ppm_c = -1;
      }
    }
    if (cal.n_ref_n >= kMinCalibrationReference)
    {
      cal.estimated_n = true;
      cal.ppm_n = median(ppm_n);
      cal.unc_ppm_n = mad(ppm_n, cal.ppm_n) / std::sqrt(static_cast<double>(cal.n_ref_n));
      if (std::fabs(cal.ppm_n) > kMaxCalibrationPpm)
      {
        cal.estimated_n = false;
        cal.ppm_n = 0;
        cal.unc_ppm_n = -1;
      }
    }
    if (!ppm_n_all.empty())
    {
      // the window's spread around the offset in use
      const double c = cal.estimated_n ? cal.ppm_n : median(ppm_n_all);
      cal.sigma_ppm_n = 1.4826 * mad(ppm_n_all, c);
    }
    return cal;
  }

  double Windows::wn(double M) const
  {
    if (n_flat > 0) return n_flat;
    return std::clamp(3.0 * sigma_ppm_n * M * 1e-6, kWindowMin, kWindowMax);
  }

  Windows estimateWindows(const std::vector<Record>& records, const Calibration& cal, const Settings& s)
  {
    Windows w;
    std::vector<double> Ms;
    Ms.reserve(records.size());
    for (const Record& r : records)
      if (r.M > 0) Ms.push_back(r.M);
    w.m_q10 = quantile(Ms, 0.10);
    w.m_q50 = quantile(Ms, 0.50);
    w.m_q90 = quantile(Ms, 0.90);
    if (s.window_c > 0) { w.w_c = s.window_c; w.source_c = "option"; }
    else if (cal.estimated_c && cal.n_ref_c >= kMinReference) { w.w_c = std::clamp(3.0 * cal.sigma_c, kWindowMin, kWindowMax); w.source_c = "estimated"; }
    else { w.w_c = kDefaultWindowC; w.source_c = "default"; }
    if (s.window_n > 0) { w.n_flat = s.window_n; w.source_n = "option"; }
    else if (cal.n_ref_n_all >= kMinReference) { w.n_flat = 0; w.sigma_ppm_n = cal.sigma_ppm_n; w.source_n = "estimated"; }
    else { w.n_flat = kDefaultWindowN; w.source_n = "default"; }
    w.sigma_ppm_n = cal.sigma_ppm_n;
    w.w_n_hist = w.n_flat > 0 ? w.n_flat : w.wn(w.m_q90);
    return w;
  }

  // ---- statistics ----------------------------------------------------------------

  double log10PoissonUpper(std::uint64_t k, double lambda)
  {
    if (k == 0) return 0.0;
    if (!(lambda > 0)) return -300.0;
    const double a = static_cast<double>(k), x = lambda;
    double lnp;
    if (x < a + 1.0)
    {
      // P(a, x) = exp(-x) x^a / Gamma(a+1) * sum_n x^n / ((a+1)..(a+n))
      double term = 1.0, sum = 1.0;
      for (int n = 1; n < 100000; ++n)
      {
        term *= x / (a + n);
        sum += term;
        if (term < sum * 1e-16) break;
      }
      lnp = -x + a * std::log(x) - std::lgamma(a + 1.0) + std::log(sum);
    }
    else
    {
      // Q(a, x) by the continued fraction (modified Lentz); P = 1 - Q
      const double tiny = 1e-300;
      double b = x + 1.0 - a, c = 1.0 / tiny, d = 1.0 / b, h = d;
      for (int i = 1; i < 100000; ++i)
      {
        const double an = -i * (i - a);
        b += 2.0;
        d = an * d + b;
        if (std::fabs(d) < tiny) d = tiny;
        c = b + an / c;
        if (std::fabs(c) < tiny) c = tiny;
        d = 1.0 / d;
        const double del = d * c;
        h *= del;
        if (std::fabs(del - 1.0) < 1e-15) break;
      }
      const double lnq = -x + a * std::log(x) - std::lgamma(a) + std::log(h);
      const double q = std::exp(lnq);
      lnp = std::log(std::max(1e-300, 1.0 - q));
    }
    return std::max(-300.0, std::min(0.0, lnp / std::log(10.0)));
  }

  double log10Q(double log10p, double n_tested)
  {
    const double q = log10p + std::log10(std::max(1.0, n_tested));
    return std::max(-300.0, std::min(0.0, q));
  }

  // ---- null image set ----------------------------------------------------------------

  Compositions compositions(const std::vector<Residue>& alphabet, double max_mass)
  {
    Compositions out;
    if (alphabet.empty() || !(max_mass > 0)) return out;
    std::vector<double> masses;
    for (const Residue& r : alphabet)
      if (r.mass > 0) masses.push_back(r.mass);
    std::sort(masses.begin(), masses.end());
    masses.erase(std::unique(masses.begin(), masses.end(), [](double a, double b) { return std::fabs(a - b) < 1e-9; }),
                 masses.end());
    const std::size_t nb = static_cast<std::size_t>(std::ceil(max_mass / kBin)) + 1;
    const double inf = std::numeric_limits<double>::infinity();
    std::vector<double> lo(nb, inf), hi(nb, -inf);
    std::vector<std::uint8_t> nres(nb, 255);
    auto put = [&](double v, std::uint8_t k) {
      if (!(v <= max_mass)) return;
      const std::size_t b = static_cast<std::size_t>(std::floor(v / kBin));
      if (b >= nb) return;
      lo[b] = std::min(lo[b], v);
      hi[b] = std::max(hi[b], v);
      nres[b] = std::min(nres[b], k);
    };
    for (double m : masses) put(m, 1);
    // ascending bins: every bin a residue mass below is final when reached
    for (std::size_t b = 0; b < nb; ++b)
    {
      if (nres[b] == 255) continue;
      const std::uint8_t k = static_cast<std::uint8_t>(std::min(254, nres[b] + 1));
      for (double m : masses)
      {
        put(lo[b] + m, k);
        if (hi[b] != lo[b]) put(hi[b] + m, k);
      }
    }
    for (std::size_t b = 0; b < nb; ++b)
      if (nres[b] != 255)
      {
        out.lo.push_back(lo[b]);
        out.hi.push_back(hi[b]);
        out.nres.push_back(nres[b]);
      }
    return out;
  }

  void NullImages::add(char ch, double lo, double hi, std::uint8_t k, std::uint8_t reading, int owner)
  {
    (ch == 'n' ? n : c).push_back({lo, hi, k, reading, owner});
    max_len = std::max(max_len, hi - lo);
  }

  void NullImages::sortAll()
  {
    auto by = [](const Interval& a, const Interval& b) {
      if (a.lo != b.lo) return a.lo < b.lo;
      if (a.nres != b.nres) return a.nres < b.nres;
      return a.reading < b.reading;
    };
    std::sort(n.begin(), n.end(), by);
    std::sort(c.begin(), c.end(), by);
  }

  const NullImages::Interval* NullImages::nearest(char ch, double v, double w) const
  {
    const std::vector<Interval>& iv = ch == 'n' ? n : c;
    const double from = v - w - max_len;
    auto it = std::lower_bound(iv.begin(), iv.end(), from, [](const Interval& a, double x) { return a.lo < x; });
    const Interval* best = nullptr;
    double bd = std::numeric_limits<double>::infinity();
    for (; it != iv.end() && it->lo <= v + w; ++it)
    {
      const double d = v < it->lo ? it->lo - v : (v > it->hi ? v - it->hi : 0.0);
      if (d <= w && (d < bd || (d == bd && best != nullptr && it->nres < best->nres)))
      {
        bd = d;
        best = &*it;
      }
    }
    return best;
  }

  bool NullImages::near(char ch, double v, double w) const { return nearest(ch, v, w) != nullptr; }

  const std::vector<NullReading>& nullReadings()
  {
    static const std::vector<NullReading> r = [] {
      std::vector<NullReading> v = {
        // channel c (index 0 must be m(S) itself)
        {'c', 0.0, "S", false},                        // forward y
        {'c', -kNH3, "S-NH3", false},                  // forward y - NH3 (y1(K) - NH3 = 111.068)
        {'c', -kH2O, "S-H2O", false},                  // forward y - H2O = reversed b
        {'c', -kH2O - kNH3, "S-H2O-NH3", false},       // reversed b - NH3
        {'c', -2 * kH2O, "S-2H2O", false},             // reversed b - H2O
        {'c', -kH2O - kCO, "S-H2O-CO", false},         // reversed a
        {'c', -kH2O - kCO - kNH3, "S-H2O-CO-NH3", false},  // reversed a - NH3 (|S| = 1: immonium - NH3)
      };
      // channel n: forward y_high (S, + NH3, + H2O) and reversed b_high (S +
      // H2O, + NH3, + H2O), the H2O reading shared; each at 0, 1, 2 13C picks
      const std::pair<double, const char*> nb[5] = {
        {0.0, "S"}, {kNH3, "S+NH3"}, {kH2O, "S+H2O"}, {kH2O + kNH3, "S+H2O+NH3"}, {2 * kH2O, "S+2H2O"}};
      const char* iso[3] = {"", "+13C", "+2x13C"};
      for (int k = 0; k < 3; ++k)
        for (const auto& b : nb)
        {
          v.push_back({'n', b.first + k * kC13, std::string(b.second) + iso[k], false});
        }
      // the precursor family (S empty): forward precursor - NH3 / - H2O,
      // reversed b_n = M - H2O, less NH3 or H2O; at -1, 0, 1, 2 13C
      const std::pair<double, const char*> pb[4] = {
        {kNH3, "M-NH3"}, {kH2O, "M-H2O"}, {kH2O + kNH3, "M-H2O-NH3"}, {2 * kH2O, "M-2H2O"}};
      const char* piso[4] = {"-13C", "", "+13C", "+2x13C"};
      for (int k = -1; k <= 2; ++k)
        for (const auto& b : pb)
        {
          v.push_back({'n', b.first + k * kC13, std::string(b.second) + piso[k + 1], true});
        }
      return v;
    }();
    return r;
  }

  double compositionLimit(double max_flank) { return max_flank + kH2O + kCO + kNH3 + 1.0; }

  NullImages nullImages(const Compositions& comps, double max_mass)
  {
    NullImages ni;
    const std::vector<NullReading>& R = nullReadings();
    for (std::size_t j = 0; j < R.size(); ++j)
      if (R[j].precursor && R[j].shift > 0) ni.add(R[j].ch, R[j].shift, R[j].shift, 0, static_cast<std::uint8_t>(j));
    for (std::size_t i = 0; i < comps.size(); ++i)
    {
      const std::uint8_t k = comps.nres[i];
      for (std::size_t j = 0; j < R.size(); ++j)
      {
        if (R[j].precursor) continue;
        const double lo = comps.lo[i] + R[j].shift, hi = comps.hi[i] + R[j].shift;
        if (!(hi > 0) || lo > max_mass) continue;
        ni.add(R[j].ch, std::max(0.0, lo), hi, k, static_cast<std::uint8_t>(j));
      }
    }
    ni.sortAll();
    return ni;
  }

  // ---- images --------------------------------------------------------------------------

  std::vector<Image> imagesFor(char site, double d, const std::vector<Residue>& A, int max_s, double max_flank)
  {
    std::vector<Image> out;
    auto push = [&](char ch, double m, std::string name, int residue, int nres, bool zero, std::uint8_t need) {
      // below kMinImageMass a flank is the clamp's noise, not a mass
      if (!(m >= kMinImageMass) || m > max_flank) return;
      Image im;
      im.ch = ch;
      im.mass = m;
      im.name = std::move(name);
      im.residue = residue;
      im.nres = nres;
      im.zero = zero;
      im.need = need;
      out.push_back(std::move(im));
    };
    const int nA = static_cast<int>(A.size());
    if (site == 'N')
    {
      push('n', d, "N0f", -1, 0, true, 0);
      push('c', d - kH2O, "N0r", -1, 0, true, 0);
      if (max_s >= 1)
        for (int r = 0; r < nA; ++r)
        {
          push('n', d + A[static_cast<std::size_t>(r)].mass, "N1f" + A[static_cast<std::size_t>(r)].name, r, 1, false, 0);
          push('c', d + A[static_cast<std::size_t>(r)].mass - kH2O, "N1r" + A[static_cast<std::size_t>(r)].name, r, 1, false, 0);
        }
      if (max_s >= 2)
        for (int r = 0; r < nA; ++r)
          for (int t = r; t < nA; ++t)
          {
            const double m = A[static_cast<std::size_t>(r)].mass + A[static_cast<std::size_t>(t)].mass;
            const std::string nm = A[static_cast<std::size_t>(r)].name + A[static_cast<std::size_t>(t)].name;
            push('n', d + m, "N2f" + nm, -1, 2, false, 0);
            push('c', d + m - kH2O, "N2r" + nm, -1, 2, false, 0);
          }
      return out;
    }
    // nres of an anchored image counts the residues besides the site's own
    // K or R (K1f: 0, K2f: 1), so that the parsimony order compares like with like.
    auto anchored = [&](char s, double anchor) {
      const std::string p(1, s);
      push('c', anchor + d, p + "1f", -1, 0, false, 0);
      push('n', anchor + d + kH2O, p + "1r", -1, 0, false, 0);
      if (max_s >= 1)
        for (int r = 0; r < nA; ++r)
        {
          const double m = anchor + A[static_cast<std::size_t>(r)].mass + d;
          push('c', m, p + "2f" + A[static_cast<std::size_t>(r)].name, r, 1, false, 0);
          push('n', m + kH2O, p + "2r" + A[static_cast<std::size_t>(r)].name, r, 1, false, 0);
        }
    };
    if (site == 'K')
    {
      push('c', d, "K0f", -1, 0, true, kLastK);
      // its reversed counterpart: a b tag whose first residue is the K
      push('n', d + kH2O, "K0r", -1, 0, false, kFirstK);
      anchored('K', kMassK);
    }
    else if (site == 'R')
      anchored('R', kMassR);
    else if (site == 'C')
    {
      // the C-terminal modification left in the flank of a tag that reads
      // the last residue (forward c = y, reversed n = y + H2O)
      push('c', d, "C0f", -1, 0, true, 0);
      push('n', d + kH2O, "C0r", -1, 0, false, 0);
      anchored('K', kMassK);
      anchored('R', kMassR);
    }
    return out;
  }

  // ---- the analysis -------------------------------------------------------------------------

  namespace
  {
    struct Hist
    {
      std::size_t nb = 0;
      i64 r = 0;
      double max_flank = 0;
      std::vector<std::uint32_t> H, HK;
      std::vector<u64> P, PK;
      i64 binOf(double v) const
      {
        if (!(v > 0) || v > max_flank) return -1;
        i64 i = static_cast<i64>(std::floor(v / kBin));
        if (i >= static_cast<i64>(nb)) i = static_cast<i64>(nb) - 1;
        return i;
      }
      void finish()
      {
        P.assign(nb + 1, 0);
        PK.assign(nb + 1, 0);
        for (std::size_t i = 0; i < nb; ++i)
        {
          P[i + 1] = P[i] + H[i];
          PK[i + 1] = PK[i] + HK[i];
        }
      }
      u64 C(i64 i, bool k = false) const
      {
        if (i < 0 || i >= static_cast<i64>(nb)) return 0;
        const i64 lo = std::max<i64>(0, i - r), hi = std::min<i64>(static_cast<i64>(nb) - 1, i + r);
        const std::vector<u64>& p = k ? PK : P;
        return p[static_cast<std::size_t>(hi + 1)] - p[static_cast<std::size_t>(lo)];
      }
      u64 at(double v, bool k = false) const { return C(binOf(v), k); }
    };

    struct Entry
    {
      float v;
      std::uint32_t rec;
    };

    struct Match
    {
      std::uint32_t sid;
      std::uint32_t img;
      float dev;  ///< value - image mass
    };

    /// What one evaluation of a hypothesis found.
    struct Eval
    {
      SiteCandidate s;
      // base-null metrics (classification)
      int ladder_clean_base = 0;
      bool zero_clean_base = false;
      u64 support_c_base = 0, support_n_base = 0;
      u64 shadow_spectra = 0;
      int shadow_owner = -1;  ///< the accepted hypothesis most shadowed spectra point at
      bool base_shadow = false;  ///< every base image with spectra is an accepted image
      double est_top = 0;        ///< x + the mean deviation of the image with the most tags
      u64 spectra_nonzero = 0;
      std::vector<std::pair<double, double>> est_c;  ///< (image mass, delta estimate) per clean c image
    };

    /// The run's tags, indexed and histogrammed (shared by both passes).
    struct Data
    {
      std::vector<Record> rec;            ///< b/y records, calibrated
      std::vector<std::uint32_t> sid;     ///< dense spectrum id per record
      std::uint32_t nspec = 0;
      std::vector<Entry> byN, byC;
      Hist hn, hc;  ///< hc.HK: last residue K; hn.HK: first residue K
    };

    struct Ctx
    {
      const Settings* s = nullptr;
      const UnimodTable* unimod = nullptr;
      const Data* d = nullptr;
      Windows win;
      Calibration cal;
      std::vector<Residue> alphabet;
      Compositions comps;
      NullImages null;
      u64 spectra_counted = 0;
      double n_tested_peaks = 1, n_tested_sites = 1;
      u64 thr4() const { return std::max<u64>(1, s->min_spectra / 4); }
      double wch(char ch) const { return ch == 'n' ? win.w_n_hist : win.w_c; }

      /// The tags of image @p im (index @p ii) into @p out.
      void match(const Image& im, std::uint32_t ii, std::vector<Match>& out) const
      {
        const std::vector<Entry>& idx = im.ch == 'n' ? d->byN : d->byC;
        const double wmax = im.ch == 'n' ? (win.n_flat > 0 ? win.n_flat : kWindowMax) : win.w_c;
        const float from = static_cast<float>(im.mass - wmax);
        auto it = std::lower_bound(idx.begin(), idx.end(), from, [](const Entry& e, float x) { return e.v < x; });
        for (; it != idx.end() && it->v <= im.mass + wmax; ++it)
        {
          const Record& r = d->rec[it->rec];
          const double w = im.ch == 'n' ? win.wn(r.M) : win.w_c;
          const double dv = static_cast<double>(it->v) - im.mass;
          if (std::fabs(dv) > w) continue;
          if (im.need != 0 && (r.flags & im.need) == 0) continue;
          out.push_back({d->sid[it->rec], ii, static_cast<float>(dv)});
        }
      }
      u64 hits(const Image& im, double shift = 0.0) const
      {
        const double m = im.mass + shift;
        if (im.ch == 'n') return d->hn.at(m, im.need == kFirstK);
        return d->hc.at(m, im.need == kLastK);
      }
    };

    /// Evaluates the hypothesis (site, x) over @p imgs. @p accepted: images
    /// of accepted hypotheses (may be null). A control (delta 0) counts every
    /// image as clean.
    Eval evaluate(const Ctx& ctx, char site, double x, const std::vector<Image>& imgs, bool control,
                  const NullImages* accepted)
    {
      Eval ev;
      SiteCandidate& sc = ev.s;
      sc.site = site;
      sc.control = control;
      const std::size_t ni = imgs.size();
      std::vector<char> conf_base(ni, 0);
      std::vector<int> conf_acc(ni, 0);  ///< owner + 1 of the accepted image, 0: none
      for (std::size_t i = 0; i < ni; ++i)
      {
        const double w = ctx.wch(imgs[i].ch);
        if (!control) conf_base[i] = ctx.null.near(imgs[i].ch, imgs[i].mass, w) ? 1 : 0;
        if (accepted != nullptr)
          if (const NullImages::Interval* iv = accepted->nearest(imgs[i].ch, imgs[i].mass, w))
            conf_acc[i] = static_cast<int>(std::max(0, iv->owner) + 1);
      }
      std::vector<Match> m;
      for (std::size_t i = 0; i < ni; ++i) ctx.match(imgs[i], static_cast<std::uint32_t>(i), m);
      // per-image tags and spectra
      std::vector<u64> img_tags(ni, 0), img_spec(ni, 0);
      std::vector<double> img_dev(ni, 0.0);  ///< summed deviations, then the mean
      {
        // matches are grouped per image, value order; count distinct sids per image
        std::vector<std::vector<std::uint32_t>> sids(ni);
        for (const Match& q : m)
        {
          ++img_tags[q.img];
          sids[q.img].push_back(q.sid);
          img_dev[q.img] += static_cast<double>(q.dev);
        }
        for (std::size_t i = 0; i < ni; ++i)
        {
          auto& v = sids[i];
          std::sort(v.begin(), v.end());
          img_spec[i] = static_cast<u64>(std::unique(v.begin(), v.end()) - v.begin());
        }
      }
      // an image is a peak at its own mass when its tags are centred on it
      // (the tail of a neighbouring peak spilling into the window is not)
      std::vector<char> centred(ni, 0);
      for (std::size_t i = 0; i < ni; ++i)
      {
        if (img_tags[i] > 0) img_dev[i] /= static_cast<double>(img_tags[i]);
        centred[i] = std::fabs(img_dev[i]) <= 0.5 * ctx.wch(imgs[i].ch);
      }
      auto clean2 = [&](std::size_t i) { return control || (!conf_base[i] && !conf_acc[i]); };
      auto clean1 = [&](std::size_t i) { return control || !conf_base[i]; };
      // per-spectrum flags
      std::map<int, u64> owners;
      std::vector<Match> bys = m;
      std::stable_sort(bys.begin(), bys.end(), [](const Match& a, const Match& b) { return a.sid < b.sid; });
      for (std::size_t i = 0; i < bys.size();)
      {
        std::size_t j = i;
        bool any_clean = false, c_clean = false, n_clean = false, c_base = false, n_base = false, all_shadow = true,
             nonzero = false;
        int kmin = 99;
        for (; j < bys.size() && bys[j].sid == bys[i].sid; ++j)
        {
          const std::size_t k = bys[j].img;
          if (clean2(k))
          {
            any_clean = true;
            (imgs[k].ch == 'c' ? c_clean : n_clean) = true;
            kmin = std::min(kmin, imgs[k].nres);
          }
          if (clean1(k)) (imgs[k].ch == 'c' ? c_base : n_base) = true;
          if (!conf_acc[k]) all_shadow = false;
          if (!imgs[k].zero) nonzero = true;
        }
        ++sc.spectra;
        sc.spectra_clean += any_clean;
        if (any_clean) sc.parsimony += std::ldexp(1.0, -kmin);
        sc.support_c += c_clean;
        sc.support_n += n_clean;
        ev.support_c_base += c_base;
        ev.support_n_base += n_base;
        if (all_shadow && accepted != nullptr)
        {
          ++ev.shadow_spectra;
          ++owners[conf_acc[bys[i].img] - 1];
        }
        ev.spectra_nonzero += nonzero;
        i = j;
      }
      {
        u64 best = 0;
        for (const auto& kv : owners)
          if (kv.second > best) { best = kv.second; ev.shadow_owner = kv.first; }
      }
      sc.share = ctx.spectra_counted > 0 ? static_cast<double>(sc.spectra) / static_cast<double>(ctx.spectra_counted) : 0.0;
      // ladders and zero images
      const u64 thr = ctx.thr4();
      std::map<int, std::pair<bool, std::pair<bool, bool>>> lad;  // residue -> (clean2 reach, (confounded reach, clean1 reach))
      for (std::size_t i = 0; i < ni; ++i)
      {
        const Image& im = imgs[i];
        if (im.zero && img_spec[i] >= ctx.s->min_spectra && centred[i])
        {
          if (clean2(i)) sc.zero_clean = true;
          if (clean1(i)) ev.zero_clean_base = true;
        }
        if (im.residue < 0) continue;
        auto& L = lad[im.residue];
        if (img_spec[i] >= thr && centred[i])
        {
          if (clean2(i)) L.first = true;
          else L.second.first = true;
          if (clean1(i)) L.second.second = true;
        }
      }
      for (const auto& kv : lad)
      {
        sc.ladder_clean += kv.second.first;
        sc.ladder_confounded += kv.second.second.first;
        ev.ladder_clean_base += kv.second.second.second;
      }
      // the base images (no residue besides the site's own) with spectra
      // all lie on accepted images: the offset is an accepted hypothesis
      // seen through one more residue
      if (accepted != nullptr)
      {
        bool any = false, all = true;
        int owner = -1;
        for (std::size_t i = 0; i < ni; ++i)
        {
          if (imgs[i].nres != 0 || img_spec[i] < thr) continue;
          any = true;
          if (conf_acc[i] == 0) all = false;
          else if (owner < 0) owner = conf_acc[i] - 1;
        }
        if (any && all)
        {
          ev.base_shadow = true;
          if (ev.shadow_owner < 0) ev.shadow_owner = owner;
        }
      }
      // reads
      for (std::size_t i = 0; i < ni; ++i)
      {
        const u64 h = ctx.hits(imgs[i]);
        sc.image_hits += h;
        if (clean2(i)) sc.clean_hits += h;
        if (!control && conf_base[i]) sc.null_expectation += static_cast<double>(h);
      }
      // half-integer background of the clean reads (control: all reads)
      {
        double sum = 0;
        int nb = 0;
        for (int k = -5; k <= 4; ++k)
        {
          const double off = k + 0.5;
          if (x + off < kScanLow || x + off > ctx.s->max_flank) continue;
          u64 h = 0;
          for (std::size_t i = 0; i < ni; ++i)
            if (clean2(i)) h += ctx.hits(imgs[i], off);
          sum += static_cast<double>(h);
          ++nb;
        }
        sc.background = nb > 0 ? sum / nb : 0.0;
      }
      const double lambda = std::max(sc.background, 1.0);
      sc.fold = static_cast<double>(sc.clean_hits) / lambda;
      sc.log10_q = log10Q(log10PoissonUpper(sc.clean_hits, lambda), ctx.n_tested_sites);
      // delta estimate: clean c images, else clean images, else all
      auto estimate = [&](auto pred) {
        std::vector<double> d;
        for (const Match& q : m)
          if (pred(q.img)) d.push_back(static_cast<double>(q.dev));
        return d;
      };
      {
        // the offset its strongest image (most tags) puts it at
        std::size_t top = ni;
        for (std::size_t i = 0; i < ni; ++i)
          if (img_tags[i] > 0 && (top == ni || img_tags[i] > img_tags[top])) top = i;
        ev.est_top = top == ni ? x : x + img_dev[top];
      }
      std::vector<double> dev = estimate([&](std::size_t k) { return clean2(k) && imgs[k].ch == 'c'; });
      if (dev.size() < thr) dev = estimate([&](std::size_t k) { return clean2(k); });
      if (dev.empty()) dev = estimate([](std::size_t) { return true; });
      if (!dev.empty())
      {
        double sum = 0;
        for (double v : dev) sum += v;
        const double mean = sum / static_cast<double>(dev.size());
        sc.delta = x + mean;
        sc.sigma = 1.4826 * mad(dev, median(dev));
      }
      else
        sc.delta = x;
      sc.se = sc.spectra > 0 ? sc.sigma / std::sqrt(static_cast<double>(sc.spectra)) : 0.0;
      // per clean c image estimates (precision rule) and the pooled c estimate
      {
        std::vector<std::vector<double>> per(ni);
        for (const Match& q : m)
          if (imgs[q.img].ch == 'c' && clean2(q.img)) per[q.img].push_back(static_cast<double>(q.dev));
        std::vector<double> pooled;
        for (std::size_t i = 0; i < ni; ++i)
        {
          if (per[i].empty()) continue;
          pooled.insert(pooled.end(), per[i].begin(), per[i].end());
          if (img_spec[i] >= thr)
          {
            double s = 0;
            for (double v : per[i]) s += v;
            ev.est_c.emplace_back(imgs[i].mass, x + s / static_cast<double>(per[i].size()));
          }
        }
        if (pooled.size() >= thr)
        {
          double s = 0;
          for (double v : pooled) s += v;
          sc.est_c = x + s / static_cast<double>(pooled.size());
          sc.has_est_c = true;
        }
      }
      // image list: every image with >= thr spectra (zero images always)
      {
        std::string s;
        for (std::size_t i = 0; i < ni; ++i)
        {
          if (!(imgs[i].zero || img_spec[i] >= thr)) continue;
          if (!s.empty()) s += ';';
          s += imgs[i].name;
          if (!clean2(i)) s += '*';
          s += '=';
          s += std::to_string(img_tags[i]);
        }
        sc.images = s.empty() ? "-" : s;
      }
      // null coincidence of the offset itself
      if (!control)
      {
        const double w = sc.has_est_c ? ctx.win.w_c : ctx.win.w_n_hist;
        const double d = sc.has_est_c ? sc.est_c : sc.delta;
        for (int k = -1; k <= 1 && !sc.null_coincident; ++k)
        {
          const double v = d - k * kH2O;
          if (v <= 0) continue;
          // composition masses: channel c reading 0 holds m(S) exactly
          const NullImages::Interval* iv = nullptr;
          const auto& arr = ctx.null.c;
          auto it = std::lower_bound(arr.begin(), arr.end(), v - w - ctx.null.max_len,
                                     [](const NullImages::Interval& q, double y) { return q.lo < y; });
          for (; it != arr.end() && it->lo <= v + w; ++it)
            if (it->reading == 0 && v >= it->lo - w && v <= it->hi + w) { iv = &*it; break; }
          if (iv != nullptr)
          {
            sc.null_coincident = true;
            sc.null_composition = std::string(k == 0 ? "m(S)" : (k > 0 ? "m(S)+H2O" : "m(S)-H2O")) + ":|S|=" +
                                  std::to_string(static_cast<int>(iv->nres));
          }
        }
      }
      return ev;
    }

    // ---- explanations ----

    struct Expl
    {
      std::string cls;   ///< known_label, unimod
      std::string name;  ///< what the label is called (TMT, Dimethyl, ...)
      std::string text;  ///< the explanation text
      double mass = 0;   ///< the label mass (the lower end of a range)
      double hi = 0;     ///< the upper end of a range label (iTRAQ8plex), else = mass
      double obs = 0;    ///< the observed mass the error is taken at
      double err = 0;    ///< observed - predicted (0 inside a range)
      int nres = 0;
      int prio = 0;      ///< group priority (lower first)
      bool label_like = false;  ///< known or curated: the precision rule applies
      bool outside = false;     ///< beyond the window, inside the calibration allowance: a rival only
      std::vector<std::string> same;  ///< same-composition members
    };

    /// The error of @p e at the observed mass @p x (0 inside a range label).
    double errAt(const Expl& e, double x)
    {
      const double hi = std::max(e.mass, e.hi);
      return x < e.mass ? x - e.mass : (x > hi ? x - hi : 0.0);
    }
    /// One family of names: iTRAQ8plex and its 13C(6)15N(2) composition.
    bool sameFamily(const std::string& a, const std::string& b)
    {
      auto fam = [](const std::string& x) { return x.rfind("iTRAQ8plex", 0) == 0 ? std::string("iTRAQ8plex") : x; };
      return fam(a) == fam(b);
    }

    struct KnownSite
    {
      std::string name;
      double mass;
      double hi = -1;  ///< > mass: a range (the label's channels differ in composition)
      bool configured = false;  ///< the run's own fixed modification (not a known label: tier 2)
    };
    /// iTRAQ8plex: the kit's channels carry two compositions, Unimod 730
    /// (304.205360) and 731 iTRAQ8plex:13C(6)15N(2) (304.199040), so a sample
    /// of mixed channels centres between them. TMTpro's 16 channels share one
    /// composition (304.207146).
    constexpr double kITRAQ8Lo = 304.199040, kITRAQ8Hi = 304.205360;
    /// The known labels of the lower evidence bar (tier 0) beside
    /// Digest::labelKeys(): dimethyl light, medium and heavy at N and K, and
    /// the SILAC lysines and arginines.
    const std::vector<KnownSite>& dimethyls()
    {
      static const std::vector<KnownSite> d = {{"Dimethyl", 28.031300}, {"Dimethyl:2H(4)", 32.056407},
                                               {"Dimethyl:2H(4)13C(2)", 34.063117}, {"Dimethyl:2H(6)13C(2)", 36.075670}};
      return d;
    }
    std::vector<KnownSite> knownAt(char site, const Settings& s)
    {
      std::vector<KnownSite> k;
      auto isobaric = [&] {
        for (const auto& l : Digest::labelKeys()) k.push_back({l.name, l.mass});
        k.push_back({"iTRAQ8plex", kITRAQ8Lo, kITRAQ8Hi});
        for (const KnownSite& d : dimethyls()) k.push_back(d);
      };
      if (site == 'N')
      {
        isobaric();
        if (s.fixed_nterm != 0.0)
          k.push_back({s.fixed_nterm_name.empty() ? "fixed_nterm" : s.fixed_nterm_name, s.fixed_nterm, -1, true});
      }
      else if (site == 'K')
      {
        isobaric();
        k.push_back({"Lys4", 4.025107});
        k.push_back({"Lys6", 6.020129});
        k.push_back({"Lys8", 8.014199});
        for (const KnownSet& f : s.fixed_k) k.push_back({f.name, f.mass, -1, true});
      }
      else if (site == 'R')
      {
        k.push_back({"Arg6", 6.020129});
        k.push_back({"Arg10", 10.008269});
      }
      else if (site == 'C')
      {
        if (s.fixed_cterm != 0.0) k.push_back({s.fixed_cterm_name.empty() ? "fixed_cterm" : s.fixed_cterm_name, s.fixed_cterm, -1, true});
      }
      return k;
    }

    bool siteMatches(const UnimodEntry& e, char site, const std::string& s_letters)
    {
      switch (site)
      {
        case 'N':
          if (e.term != Term::NTerm && e.term != Term::ProteinNTerm) return false;
          if (anyOrigin(e.origin)) return true;
          return !s_letters.empty() && s_letters.find(e.origin) != std::string::npos;
        case 'K': return e.origin == 'K' && e.term == Term::Anywhere;
        case 'R': return e.origin == 'R' && e.term == Term::Anywhere;
        case 'C': return (e.term == Term::CTerm || e.term == Term::ProteinCTerm) && anyOrigin(e.origin);
        default: return false;
      }
    }

    /// Unimod groups (same formula) at @p site within @p w of @p L.
    void unimodAt(const UnimodTable& t, char site, double L, double w, const std::string& letters, int nres,
                  const std::string& prefix, std::vector<Expl>& out)
    {
      auto it = std::lower_bound(t.entries.begin(), t.entries.end(), L - w,
                                 [](const UnimodEntry& e, double x) { return e.mass < x; });
      std::map<std::string, std::vector<const UnimodEntry*>> groups, others;
      for (; it != t.entries.end() && it->mass <= L + w; ++it)
        (siteMatches(*it, site, letters) ? groups : others)[it->formula].push_back(&*it);
      for (auto& g : groups)
      {
        auto& v = g.second;
        std::sort(v.begin(), v.end(), [](const UnimodEntry* a, const UnimodEntry* b) {
          const int pa = priorityRank(*a), pb = priorityRank(*b);
          if (pa != pb) return pa < pb;
          if (a->record_id != b->record_id) return a->record_id < b->record_id;
          return a->full_id < b->full_id;
        });
        // the same id at several specificities is one name
        Expl e;
        e.cls = "unimod";
        e.name = v.front()->id;
        e.text = prefix + v.front()->id;
        e.mass = v.front()->mass;
        e.hi = e.mass;
        e.obs = L;
        e.err = L - v.front()->mass;
        e.nres = nres;
        e.prio = priorityRank(*v.front());
        e.label_like = curatedIndex(v.front()->id) >= 0;
        std::set<std::string> seen{v.front()->id};
        for (std::size_t i = 1; i < v.size(); ++i)
          if (seen.insert(v[i]->id).second) e.same.push_back(v[i]->id);
        // entries of the same composition at other sites name the same mass
        if (const auto o = others.find(g.first); o != others.end())
        {
          std::vector<const UnimodEntry*> ov = o->second;
          std::sort(ov.begin(), ov.end(), [](const UnimodEntry* a, const UnimodEntry* b) {
            if (a->record_id != b->record_id) return a->record_id < b->record_id;
            return a->full_id < b->full_id;
          });
          for (const UnimodEntry* x : ov)
            if (seen.insert(x->id).second) e.same.push_back(x->id);
        }
        out.push_back(std::move(e));
      }
    }

    bool better(const Expl& a, const Expl& b)
    {
      if (a.nres != b.nres) return a.nres < b.nres;
      const double ea = std::fabs(a.err), eb = std::fabs(b.err);
      if (ea != eb) return ea < eb;
      if (a.prio != b.prio) return a.prio < b.prio;
      return a.text < b.text;
    }

    std::string altText(const Expl& e)
    {
      std::string s = e.text + "(" + signedFix(e.err, 5) + ")";
      for (const std::string& m : e.same) s += ";same_composition:" + m;
      return s;
    }

    struct Decision
    {
      bool any = false;
      Expl best;
      std::string cls, explanation, label;
      std::vector<std::string> alts;
    };

    /// Section 5's near-isobaric rule over the label-like explanations of
    /// the best residue count. @p estimates are (mass, shift): one estimate
    /// of the observed mass per image, as a shift from the centre the errors
    /// of @p ex are taken at. Label a is decided against b when at every
    /// estimate |err_a + shift| < s/4 and the calibration uncertainty at that
    /// mass < s/4, s = |err_a - err_b| the separation; else ambiguous.
    Decision decide(std::vector<Expl> ex, const std::vector<std::pair<double, double>>& estimates,
                    const std::function<double(double)>& unc_da, int top)
    {
      Decision d;
      if (ex.empty()) return d;
      std::sort(ex.begin(), ex.end(), [](const Expl& a, const Expl& b) {
        // inside the window first; fewer residues, then known labels before
        // unimod (class order), then the ranking
        if (a.outside != b.outside) return !a.outside;
        const int ca = a.cls == "known_label" ? 0 : 1, cb = b.cls == "known_label" ? 0 : 1;
        if (a.nres != b.nres) return a.nres < b.nres;
        if (ca != cb) return ca < cb;
        return better(a, b);
      });
      if (ex.front().outside) return d;
      d.any = true;
      d.best = ex.front();
      // label-like rivals of a different predicted mass at the same residue count
      std::vector<const Expl*> all;
      if (d.best.label_like)
        for (const Expl& e : ex)
          if (e.label_like && e.nres == d.best.nres &&
              (&e == &ex.front() || (std::fabs(e.err - d.best.err) > 1e-6 && !sameFamily(e.name, d.best.name))))
            all.push_back(&e);
      // a rival of the same family as one already listed is not a rival
      {
        std::vector<const Expl*> keep;
        for (const Expl* e : all)
        {
          bool dup = false;
          for (const Expl* k : keep) dup = dup || sameFamily(k->name, e->name);
          if (!dup) keep.push_back(e);
        }
        all.swap(keep);
      }
      bool ambiguous = false;
      if (all.size() >= 2)
      {
        std::stable_sort(all.begin(), all.end(), [](const Expl* a, const Expl* b) {
          if (std::fabs(a->err) != std::fabs(b->err)) return std::fabs(a->err) < std::fabs(b->err);
          return better(*a, *b);
        });
        const Expl* a = all.front();
        bool decided = !estimates.empty();
        for (std::size_t i = 1; i < all.size() && decided; ++i)
        {
          const double sep = std::fabs(a->err - all[i]->err);
          if (sep <= 1e-6) continue;
          for (const auto& e : estimates)
          {
            const double u = unc_da(e.first);
            if (!(u >= 0) || u >= 0.25 * sep || std::fabs(errAt(*a, a->obs + e.second)) >= 0.25 * sep)
            {
              decided = false;
              break;
            }
          }
        }
        d.best = *a;
        if (!decided)
        {
          ambiguous = true;
          d.label = "ambiguous:" + a->name + "|" + all[1]->name;
          d.explanation = d.label;
          d.cls = a->cls;
        }
      }
      if (!ambiguous)
      {
        d.cls = d.best.cls;
        d.explanation = d.best.text;
        d.label = d.best.name;
      }
      int nu = 0;
      for (const Expl& e : ex)
      {
        if (!ambiguous && e.text == d.best.text && e.cls == d.best.cls) continue;
        if (e.cls == "unimod" && !e.label_like && nu++ >= top) continue;
        d.alts.push_back(altText(e));
      }
      if (!ambiguous)
        for (auto it = d.best.same.rbegin(); it != d.best.same.rend(); ++it) d.alts.insert(d.alts.begin(), "same_composition:" + *it);
      return d;
    }

    std::string joinAlts(const std::vector<std::string>& v)
    {
      if (v.empty()) return "-";
      std::string s;
      for (const std::string& a : v)
      {
        if (!s.empty()) s += ';';
        s += a;
      }
      return s;
    }

    std::string letters(const std::vector<Residue>& A, std::initializer_list<int> idx)
    {
      std::string s;
      for (int i : idx) s += A[static_cast<std::size_t>(i)].letter;
      return s;
    }

    /// Annotates a channel peak (section 8).
    void annotatePeak(const Ctx& ctx, Peak& p)
    {
      const Settings& s = *ctx.s;
      const std::vector<Residue>& A = ctx.alphabet;
      const double v = p.mass;
      const double w = ctx.wch(p.ch);
      const int nA = static_cast<int>(A.size());
      // 1. residue_combo
      {
        struct C
        {
          std::string text;
          double err;
          int nres;
        };
        std::vector<C> combos;
        // every null reading (section 7) of the compositions up to depth,
        // named, then the precursor family, then any longer composition
        const std::vector<NullReading>& R = nullReadings();
        auto readings = [&](double m, const std::string& S, int k) {
          for (const NullReading& q : R)
            if (!q.precursor && q.ch == p.ch && std::fabs(v - (m + q.shift)) <= w)
              combos.push_back({std::string(1, p.ch) + ":" + q.name + ":" + S, v - (m + q.shift), k});
        };
        for (const NullReading& q : R)
          if (q.precursor && q.ch == p.ch && std::fabs(v - q.shift) <= w)
            combos.push_back({std::string(1, p.ch) + ":" + q.name, v - q.shift, 0});
        if (s.depth >= 1)
          for (int r = 0; r < nA; ++r) readings(A[static_cast<std::size_t>(r)].mass, A[static_cast<std::size_t>(r)].name, 1);
        if (s.depth >= 2)
          for (int r = 0; r < nA; ++r)
            for (int t = r; t < nA; ++t)
              readings(A[static_cast<std::size_t>(r)].mass + A[static_cast<std::size_t>(t)].mass,
                       A[static_cast<std::size_t>(r)].name + A[static_cast<std::size_t>(t)].name, 2);
        if (combos.empty())
          if (const NullImages::Interval* iv = ctx.null.nearest(p.ch, v, w))
          {
            const std::string rn = iv->reading == kReadingAccepted ? std::string("accepted") : R[iv->reading].name;
            const double mid = 0.5 * (iv->lo + iv->hi);
            combos.push_back({std::string(1, p.ch) + ":" + rn + ":|S|=" + std::to_string(static_cast<int>(iv->nres)),
                              v - mid, static_cast<int>(iv->nres)});
          }
        if (!combos.empty())
        {
          std::sort(combos.begin(), combos.end(), [](const C& a, const C& b) {
            if (a.nres != b.nres) return a.nres < b.nres;
            if (std::fabs(a.err) != std::fabs(b.err)) return std::fabs(a.err) < std::fabs(b.err);
            return a.text < b.text;
          });
          p.cls = "residue_combo";
          p.explanation = combos.front().text;
          std::vector<std::string> alts;
          for (std::size_t i = 1; i < combos.size() && i <= 4; ++i)
            alts.push_back(combos[i].text + "(" + signedFix(combos[i].err, 5) + ")");
          // Unimod alternatives at the zero-residue images (e.g. N-terminal
          // carbamidomethyl = G): listed, never silently dropped.
          std::vector<Expl> ex;
          if (p.ch == 'n') unimodAt(*ctx.unimod, 'N', v, w, "", 0, "N0f:", ex);
          else unimodAt(*ctx.unimod, 'N', v + kH2O, w, "", 0, "N0r:", ex);
          std::sort(ex.begin(), ex.end(), better);
          int nu = 0;
          for (const Expl& e : ex)
            if (nu++ < s.unimod_top) alts.push_back(altText(e));
          p.alternatives = joinAlts(alts);
          return;
        }
      }
      // 2./3. known labels and Unimod at every image hypothesis
      std::vector<Expl> ex;
      // label-like rivals are sought within the window plus the calibration
      // allowance (the uncertainty, or kUnknownCalibrationPpm without one)
      const double unc_ppm0 = p.ch == 'c' ? ctx.cal.unc_ppm_c : ctx.cal.unc_ppm_n;
      const double mref0 = p.ch == 'c' ? v : ctx.win.m_q50;
      const double allow = (unc_ppm0 >= 0 ? unc_ppm0 : kUnknownCalibrationPpm) * mref0 * 1e-6;
      const double wl = w + allow;
      auto hyp = [&](char site, double L, int nres, const std::string& S, const std::string& let, const std::string& img) {
        for (const KnownSite& k : knownAt(site, s))
        {
          Expl e;
          e.mass = k.mass;
          e.hi = std::max(k.mass, k.hi);
          e.obs = L;
          e.err = errAt(e, L);
          if (std::fabs(e.err) <= wl)
          {
            e.cls = "known_label";
            e.name = k.name;
            const std::string anchor = img == "K0f" ? "" : (site == 'K' ? "K+" : (site == 'R' ? "R+" : ""));
            e.text = img + ":" + anchor + k.name + (S.empty() ? "" : "+" + S);
            e.nres = nres;
            e.prio = k.configured ? 150 : -1;
            e.label_like = true;
            e.outside = std::fabs(e.err) > w;
            ex.push_back(std::move(e));
          }
        }
        const std::string anchor = img == "K0f" ? "" : (site == 'K' ? "K+" : (site == 'R' ? "R+" : ""));
        std::vector<Expl> u;
        unimodAt(*ctx.unimod, site, L, wl, let, nres, img + ":" + anchor, u);
        for (Expl& e : u)
        {
          e.outside = std::fabs(e.err) > w;
          if (e.outside && !e.label_like) continue;
          if (!S.empty()) e.text += "+" + S;
          ex.push_back(std::move(e));
        }
      };
      auto overS = [&](auto f) {
        f(0.0, 0, std::string(), std::string());
        if (s.depth >= 1)
          for (int r = 0; r < nA; ++r) f(A[static_cast<std::size_t>(r)].mass, 1, A[static_cast<std::size_t>(r)].name, letters(A, {r}));
        if (s.depth >= 2)
          for (int r = 0; r < nA; ++r)
            for (int t = r; t < nA; ++t)
              f(A[static_cast<std::size_t>(r)].mass + A[static_cast<std::size_t>(t)].mass, 2,
                A[static_cast<std::size_t>(r)].name + A[static_cast<std::size_t>(t)].name, letters(A, {r, t}));
      };
      if (p.ch == 'n')
      {
        overS([&](double mS, int k, const std::string& S, const std::string& let) {
          hyp('N', v - mS, k, S, let, "N" + std::to_string(k) + "f");
          hyp('K', v - kMassK - mS - kH2O, k + 1, S, let, "K" + std::to_string(k + 1) + "r");
          hyp('R', v - kMassR - mS - kH2O, k + 1, S, let, "R" + std::to_string(k + 1) + "r");
        });
      }
      else
      {
        overS([&](double mS, int k, const std::string& S, const std::string& let) {
          hyp('N', v + kH2O - mS, k, S, let, "N" + std::to_string(k) + "r");
          hyp('K', v - kMassK - mS, k + 1, S, let, "K" + std::to_string(k + 1) + "f");
          hyp('R', v - kMassR - mS, k + 1, S, let, "R" + std::to_string(k + 1) + "f");
        });
        if (p.share_adjacent_k >= 0.5) hyp('K', v, 0, "", "", "K0f");
      }
      const double unc_ppm = p.ch == 'c' ? ctx.cal.unc_ppm_c : ctx.cal.unc_ppm_n;
      const double mref = ctx.win.m_q50;
      auto unc = [&](double mass) {
        if (unc_ppm < 0) return -1.0;
        return unc_ppm * (p.ch == 'c' ? mass : mref) * 1e-6;
      };
      if (!ex.empty())
      {
        const std::vector<std::pair<double, double>> est{{v, 0.0}};
        const Decision dd = decide(ex, est, unc, s.unimod_top);
        p.cls = dd.cls;
        p.explanation = dd.explanation;
        p.alternatives = joinAlts(dd.alts);
        return;
      }
      p.cls = "unexplained";
      p.explanation = "-";
      p.alternatives = "-";
    }

    /// The channel peaks of @p h (section 6).
    std::vector<Peak> callPeaks(const Ctx& ctx, char ch)
    {
      const Hist& h = ch == 'n' ? ctx.d->hn : ctx.d->hc;
      const Settings& s = *ctx.s;
      std::vector<Peak> out;
      const i64 nb = static_cast<i64>(h.nb), r2 = 2 * h.r;
      const u64 min_c = std::max<u64>(1, s.min_spectra);
      for (i64 i = 0; i < nb; ++i)
      {
        if (h.H[static_cast<std::size_t>(i)] == 0 && h.C(i) < min_c) continue;
        const u64 c = h.C(i);
        if (c < min_c || static_cast<double>(c) < s.min_share * static_cast<double>(ctx.spectra_counted)) continue;
        bool mx = true;
        for (i64 j = std::max<i64>(0, i - r2); j <= std::min(nb - 1, i + r2) && mx; ++j)
        {
          if (j == i) continue;
          const u64 cj = h.C(j);
          if (j < i ? cj >= c : cj > c) mx = false;
        }
        if (!mx) continue;
        // background: ten half-integer offsets
        double sum = 0;
        int n = 0;
        for (int k = -5; k <= 4; ++k)
        {
          const i64 j = i + 2000 * k + 1000;
          if (j < 0 || j >= nb) continue;
          sum += static_cast<double>(h.C(j));
          ++n;
        }
        Peak p;
        p.ch = ch;
        p.hits = c;
        p.background = n > 0 ? sum / n : 0.0;
        const double lambda = std::max(p.background, 1.0);
        p.fold = static_cast<double>(c) / lambda;
        p.log10_q = log10Q(log10PoissonUpper(c, lambda), ctx.n_tested_peaks);
        // centroid and spread over the bins within +-w
        {
          double wsum = 0, msum = 0;
          std::vector<std::pair<double, double>> vw;
          for (i64 j = std::max<i64>(0, i - h.r); j <= std::min(nb - 1, i + h.r); ++j)
          {
            const double cnt = h.H[static_cast<std::size_t>(j)];
            if (cnt <= 0) continue;
            const double centre = (static_cast<double>(j) + 0.5) * kBin;
            wsum += cnt;
            msum += cnt * centre;
            vw.emplace_back(centre, cnt);
          }
          p.mass = wsum > 0 ? msum / wsum : (static_cast<double>(i) + 0.5) * kBin;
          const double med = weightedMedian(vw);
          std::vector<std::pair<double, double>> dv;
          for (const auto& q : vw) dv.emplace_back(std::fabs(q.first - med), q.second);
          std::sort(dv.begin(), dv.end());
          p.sigma = 1.4826 * weightedMedian(dv);
        }
        // exact recount at the peak position
        Image im;
        im.ch = ch;
        im.mass = p.mass;  // at the centroid: a plateau's lowest bin may lie off its centre
        std::vector<Match> m;
        ctx.match(im, 0, m);
        p.tags = m.size();
        std::vector<std::uint32_t> sids;
        u64 adjk = 0;
        for (const Match& q : m) sids.push_back(q.sid);
        {
          // adjacent K: count over the matched tags
          const std::vector<Entry>& idx = ch == 'n' ? ctx.d->byN : ctx.d->byC;
          const double wmax = ch == 'n' ? (ctx.win.n_flat > 0 ? ctx.win.n_flat : kWindowMax) : ctx.win.w_c;
          auto it = std::lower_bound(idx.begin(), idx.end(), static_cast<float>(im.mass - wmax),
                                     [](const Entry& e, float x) { return e.v < x; });
          for (; it != idx.end() && it->v <= im.mass + wmax; ++it)
          {
            const Record& rr = ctx.d->rec[it->rec];
            const double w = ch == 'n' ? ctx.win.wn(rr.M) : ctx.win.w_c;
            if (std::fabs(static_cast<double>(it->v) - im.mass) > w) continue;
            adjk += (rr.flags & (ch == 'c' ? kLastK : kFirstK)) != 0;
          }
        }
        std::sort(sids.begin(), sids.end());
        p.spectra = static_cast<u64>(std::unique(sids.begin(), sids.end()) - sids.begin());
        p.share_adjacent_k = p.tags > 0 ? static_cast<double>(adjk) / static_cast<double>(p.tags) : 0.0;
        p.se = p.spectra > 0 ? p.sigma / std::sqrt(static_cast<double>(p.spectra)) : 0.0;
        const double share = ctx.spectra_counted > 0 ? static_cast<double>(p.spectra) / static_cast<double>(ctx.spectra_counted) : 0.0;
        if (p.spectra < s.min_spectra || share < s.min_share || p.fold < s.min_fold || p.log10_q > s.max_log10_q) continue;
        out.push_back(std::move(p));
      }
      std::sort(out.begin(), out.end(), [](const Peak& a, const Peak& b) {
        if (a.spectra != b.spectra) return a.spectra > b.spectra;
        return a.mass < b.mass;
      });
      if (out.size() > kMaxPeaks) out.resize(kMaxPeaks);
      for (Peak& p : out) annotatePeak(ctx, p);
      return out;
    }

    /// The offset spectrum of @p site and its local maxima (section 7).
    std::vector<double> siteScan(const Ctx& ctx, char site, const std::vector<Residue>& A)
    {
      const Settings& s = *ctx.s;
      struct Term
      {
        bool n, k;  ///< channel n; the last-residue-K histogram
        double add;
      };
      std::vector<Term> terms;
      if (site == 'N')
      {
        terms.push_back({true, false, 0.0});
        terms.push_back({false, false, -kH2O});
        for (const Residue& r : A)
        {
          terms.push_back({true, false, r.mass});
          terms.push_back({false, false, r.mass - kH2O});
        }
      }
      else
      {
        const double anchor = site == 'K' ? kMassK : kMassR;
        if (site == 'K') terms.push_back({false, true, 0.0});
        terms.push_back({false, false, anchor});
        terms.push_back({true, false, anchor + kH2O});
        for (const Residue& r : A)
        {
          terms.push_back({false, false, anchor + r.mass});
          terms.push_back({true, false, anchor + r.mass + kH2O});
        }
      }
      const i64 P = static_cast<i64>(std::ceil((s.max_flank - kScanLow) / kBin));
      std::vector<u64> O(static_cast<std::size_t>(P), 0);
      for (const Term& t : terms)
      {
        const Hist& h = t.n ? ctx.d->hn : ctx.d->hc;
        for (i64 j = 0; j < P; ++j)
        {
          const double x = kScanLow + (static_cast<double>(j) + 0.5) * kBin;
          O[static_cast<std::size_t>(j)] += h.at(x + t.add, t.k);
        }
      }
      const i64 rO = 2 * std::max(ctx.d->hn.r, ctx.d->hc.r);
      const double w0 = std::max(ctx.win.w_n_hist, ctx.win.w_c);
      std::vector<std::pair<u64, double>> cand;
      for (i64 j = 0; j < P; ++j)
      {
        const u64 o = O[static_cast<std::size_t>(j)];
        if (o < std::max<u64>(1, s.min_spectra)) continue;
        const double x = kScanLow + (static_cast<double>(j) + 0.5) * kBin;
        if (std::fabs(x) <= w0) continue;
        bool mx = true;
        for (i64 q = std::max<i64>(0, j - rO); q <= std::min(P - 1, j + rO) && mx; ++q)
        {
          if (q == j) continue;
          const u64 oq = O[static_cast<std::size_t>(q)];
          if (q < j ? oq >= o : oq > o) mx = false;
        }
        if (!mx) continue;
        double sum = 0;
        int n = 0;
        for (int k = -5; k <= 4; ++k)
        {
          const i64 q = j + 2000 * k + 1000;
          if (q < 0 || q >= P) continue;
          sum += static_cast<double>(O[static_cast<std::size_t>(q)]);
          ++n;
        }
        const double bg = std::max(n > 0 ? sum / n : 0.0, 1.0);
        if (static_cast<double>(o) < s.min_fold * bg) continue;
        // a flat top (the window wider than the spread of the flanks) is
        // taken at its centre, not its lowest bin, so that the images sit on
        // the flanks
        i64 e = j;
        while (e + 1 < P && O[static_cast<std::size_t>(e + 1)] == o) ++e;
        cand.emplace_back(o, x + 0.5 * static_cast<double>(e - j) * kBin);
      }
      std::sort(cand.begin(), cand.end(), [](const auto& a, const auto& b) {
        if (a.first != b.first) return a.first > b.first;
        return a.second < b.second;
      });
      if (cand.size() > kMaxSiteCandidates) cand.resize(kMaxSiteCandidates);
      std::vector<double> xs;
      for (const auto& c : cand) xs.push_back(c.second);
      return xs;
    }

    /// The site's explanation (section 8, classes 2-4) of a candidate.
    void explainSite(const Ctx& ctx, SiteCandidate& sc, const std::vector<std::pair<double, double>>& est_c)
    {
      const Settings& s = *ctx.s;
      const double d = sc.has_est_c ? sc.est_c : sc.delta;
      const double w = sc.has_est_c ? ctx.win.w_c : ctx.win.w_n_hist;
      std::vector<Expl> ex;
      const double allow = (sc.has_est_c ? (ctx.cal.unc_ppm_c >= 0 ? ctx.cal.unc_ppm_c : kUnknownCalibrationPpm)
                                         : (ctx.cal.unc_ppm_n >= 0 ? ctx.cal.unc_ppm_n : kUnknownCalibrationPpm)) *
                           (sc.has_est_c ? std::max(1.0, d) : ctx.win.m_q50) * 1e-6;
      const double wl = w + allow;
      for (const KnownSite& k : knownAt(sc.site, s))
      {
        Expl e;
        e.mass = k.mass;
        e.hi = std::max(k.mass, k.hi);
        e.obs = d;
        e.err = errAt(e, d);
        if (std::fabs(e.err) <= wl)
        {
          e.cls = "known_label";
          e.name = k.name;
          e.text = k.name;
          e.prio = k.configured ? 150 : -1;
          e.label_like = true;
          e.outside = std::fabs(e.err) > w;
          ex.push_back(std::move(e));
        }
      }
      {
        std::vector<Expl> u;
        unimodAt(*ctx.unimod, sc.site, d, wl, "", 0, "", u);
        for (Expl& e : u)
        {
          e.outside = std::fabs(e.err) > w;
          if (!e.outside || e.label_like) ex.push_back(std::move(e));
        }
      }
      auto unc = [&](double mass) {
        if (ctx.cal.unc_ppm_c < 0) return -1.0;
        return ctx.cal.unc_ppm_c * mass * 1e-6;
      };
      // per clean c image estimates of the offset, as shifts from d
      std::vector<std::pair<double, double>> est;
      for (const auto& e : est_c) est.emplace_back(e.first, e.second - d);
      const Decision dd = decide(ex, est, unc, s.unimod_top);
      std::vector<std::string> alts = dd.alts;
      if (sc.null_coincident) alts.push_back("null:" + sc.null_composition);
      if (dd.any)
      {
        sc.cls = dd.cls;
        sc.explanation = dd.explanation;
        sc.label = dd.label;
        // the evidence tier: a known label (an ambiguous pair of known
        // labels too), a Unimod label, anything else
        if (dd.cls == "known_label") sc.tier = dd.best.prio < 0 ? 0 : 2;
        else if (dd.cls == "unimod") sc.tier = dd.best.prio <= 100 ? 1 : 2;
        else sc.tier = 2;
      }
      else
      {
        sc.cls = "unexplained";
        sc.explanation = "-";
        sc.label = "unknown:" + std::string(1, sc.site) + fixed4(d);
        sc.tier = 2;
      }
      sc.alternatives = joinAlts(alts);
    }

    bool excludedClass(const std::string& c)
    {
      return c == "null_shadow" || c == "isotope_error" || c.rfind("shadow:", 0) == 0 || c == "residue_combo";
    }
  }

  // ---- analyze ----------------------------------------------------------------------------

  // ---- reporter ions ------------------------------------------------------------------------

  namespace
  {
    bool isobaric(const std::string& label) { return label.find("TMT") != std::string::npos || label.find("iTRAQ") != std::string::npos; }

    /// The called site candidates as the ld_call labels and sites; false when none is left.
    bool joinCalls(const Analysis& a, bool skip_isobaric, std::string& labels, std::string& sites)
    {
      labels.clear();
      sites.clear();
      for (char site : std::string("NKRC"))
        for (const SiteCandidate& c : a.sites)
        {
          if (c.site != site || !c.called || (skip_isobaric && isobaric(c.label))) continue;
          std::string nm = c.label;
          const bool own_site = nm.rfind("unknown:", 0) == 0;
          if (c.site != 'N' && !own_site) nm = std::string(1, c.site) + ":" + nm;
          labels += (labels.empty() ? "" : "+") + nm;
          const std::string st(1, c.site);
          if (sites.find(st) == std::string::npos) sites += (sites.empty() ? "" : ",") + st;
        }
      return !labels.empty();
    }

    constexpr double kTmt[] = {126.127726, 127.124761, 127.131081, 128.128116, 128.134436, 129.131471,
                               129.137790, 130.134825, 130.141145, 131.138180, 131.144500};
    constexpr double kTmtproOnly[] = {132.141535, 132.147855, 133.144890, 133.151210, 134.148245, 134.154565, 135.151600};
    constexpr double kItraq4[] = {114.110680, 115.107715, 116.111069, 117.114424};
    constexpr double kItraq8Only[] = {113.107325, 118.111459, 119.114814, 121.121524};
    constexpr double kReporterTol = 0.003, kReporterDecoy = 0.0170, kReporterMinRel = 0.01;
    constexpr std::uint64_t kGateMinScans = 200;
    constexpr double kGateOn = 0.3, kGateOff = 0.05, kVariantTol = 0.008;

    template <std::size_t N>
    int channels(const std::vector<std::pair<double, double>>& low, const double (&set)[N], double shift, double thr)
    {
      int k = 0;
      for (double m : set)
        for (const auto& p : low)  // ponytail: linear scan, the list holds the peaks of 25 m/z units
          if (std::fabs(p.first - (m + shift)) <= kReporterTol && p.second >= thr)
          {
            ++k;
            break;
          }
      return k;
    }
  }

  void ReporterCounter::add(const std::vector<std::pair<double, double>>& low, double base_peak)
  {
    ++scans;
    if (low.empty() || !(base_peak > 0)) return;
    ++covered;
    const double thr = kReporterMinRel * base_peak;
    tmt += channels(low, kTmt, 0, thr) >= 2;
    itraq4 += channels(low, kItraq4, 0, thr) >= 2;
    itraq8 += channels(low, kItraq8Only, 0, thr) >= 1;
    tmtpro += channels(low, kTmtproOnly, 0, thr) >= 2;
    for (double d : {kReporterDecoy, -kReporterDecoy})
    {
      tmt_decoy += channels(low, kTmt, d, thr) >= 2;
      itraq4_decoy += channels(low, kItraq4, d, thr) >= 2;
      itraq8_decoy += channels(low, kItraq8Only, d, thr) >= 1;
      tmtpro_decoy += channels(low, kTmtproOnly, d, thr) >= 2;
    }
  }

  void ReporterCounter::merge(const ReporterCounter& o)
  {
    scans += o.scans; covered += o.covered; ms2 += o.ms2; ms2_ion_trap += o.ms2_ion_trap;
    it_scans += o.it_scans; it_covered += o.it_covered;
    tmt += o.tmt; itraq4 += o.itraq4; itraq8 += o.itraq8; tmtpro += o.tmtpro;
    tmt_decoy += o.tmt_decoy; itraq4_decoy += o.itraq4_decoy; itraq8_decoy += o.itraq8_decoy; tmtpro_decoy += o.tmtpro_decoy;
  }

  std::string reporterGate(const ReporterCounter& rc)
  {
    if (rc.scans < kGateMinScans) return "unknown";
    const double t = rc.excess(rc.tmt, rc.tmt_decoy), i = rc.excess(rc.itraq4, rc.itraq4_decoy);
    if (t >= kGateOn && i >= kGateOn) return "unclear";
    if (t >= kGateOn) return "tmt";
    if (i >= kGateOn) return rc.excess(rc.itraq8, rc.itraq8_decoy) >= kGateOn ? "itraq8" : "itraq4";
    // "none" only when the scans record the reporter region at all (a first mass above it leaves it empty).
    return t < kGateOff && i < kGateOff && 2 * rc.covered >= rc.scans ? "none" : "unclear";
  }

  bool ReporterCounter::regionNotRecorded() const
  {
    // scans counts empty high-resolution scans too; they record nothing either.
    const std::uint64_t all = scans + it_scans, cov = covered + it_covered;
    if (all < kGateMinScans || 2 * cov >= all) return false;
    auto present = [&](std::uint64_t hits, std::uint64_t decoy) {
      return static_cast<double>(hits) - 0.5 * static_cast<double>(decoy) >= kGateOff * static_cast<double>(covered);
    };
    return covered == 0 || (!present(tmt, tmt_decoy) && !present(itraq4, itraq4_decoy));
  }

  void applyReporters(Analysis& a, const ReporterCounter& rc)
  {
    a.reporters = rc;
    a.reporter_gate = reporterGate(rc);
    const std::string& g = a.reporter_gate;
    if (g == "tmt" || g == "itraq4" || g == "itraq8")
    {
      const bool tmt = g == "tmt";
      const std::string family = tmt ? "TMT" : "iTRAQ";
      // The near-isobaric pair the tag flanks cannot separate.
      for (const char* amb : {"ambiguous:iTRAQ8plex|TMTpro", "ambiguous:TMTpro|iTRAQ8plex"})
        for (std::size_t p; a.status == "call" && (p = a.labels.find(amb)) != std::string::npos;)
          a.labels.replace(p, std::string(amb).size(), tmt ? "TMTpro" : "iTRAQ8plex");
      if (a.status == "call" && a.labels.find(family) != std::string::npos) return;
      // The variant from the tags: the strongest N-terminal candidate at a label mass of the family.
      std::string name = tmt ? "TMT" : g == "itraq8" ? "iTRAQ8plex" : "iTRAQ4";
      const SiteCandidate* best = nullptr;
      const std::pair<double, const char*> variants[] = {{229.162932, "TMT"}, {304.207146, "TMTpro"}};
      if (tmt)
        for (const SiteCandidate& c : a.sites)
          for (const auto& v : variants)
            if (c.site == 'N' && !c.control && std::fabs(c.delta - v.first) <= kVariantTol && (!best || c.spectra > best->spectra))
            {
              best = &c;
              name = v.second;
            }
      a.status = "call";
      a.labels = name;
      a.call_sites = best || !tmt ? "N" : "-";
      a.reason = "-";
      a.basis = "reporter_ions";
      return;
    }
    if (g == "none" && a.status == "call" && isobaric(a.labels))
    {
      a.basis = "reporter_ions";
      if (!joinCalls(a, true, a.labels, a.call_sites))
      {
        a.status = "no_call";
        a.labels = a.call_sites = "-";
        a.reason = "no_reporter_ions";
      }
    }
    if (a.status == "no_call" && rc.ionTrapMs2() && (a.reason == "few_spectra" || a.reason == "no_reference" || a.reason == "low_resolution"))
      a.reason = "low_resolution_ms2";
  }

  void PairCounter::add(double rt_seconds, double mz, int charge)
  {
    if (charge >= 2 && charge <= 4 && mz > 0) precursors.push_back({mz, static_cast<float>(rt_seconds), static_cast<std::int8_t>(charge)});
  }

  void PairCounter::merge(PairCounter&& o)
  {
    precursors.insert(precursors.end(), o.precursors.begin(), o.precursors.end());
    o.precursors.clear();
  }

  void PairCounter::count()
  {
    constexpr double kTol = 0.002, kRt = 9.0, kLys8 = 8.014199, kArg10 = 10.008269;
    // The label masses shifted by whole Da; none within 8 mDa of n x 1.00335.
    constexpr double kControl[] = {7.014199, 9.014199, 13.014199, 9.008269, 11.008269, 12.008269, 3.025107, 5.025107};
    std::sort(precursors.begin(), precursors.end(), [](const Precursor& a, const Precursor& b) {
      return a.z != b.z ? a.z < b.z : a.mz != b.mz ? a.mz < b.mz : a.rt < b.rt;
    });
    auto pairs = [&](double delta) {
      std::uint64_t n = 0;
      std::size_t lo = 0;
      for (const Precursor& p : precursors)
      {
        const double want = p.mz + delta / p.z, tol = kTol / p.z;
        while (lo < precursors.size() && (precursors[lo].z < p.z || (precursors[lo].z == p.z && precursors[lo].mz < want - tol))) ++lo;
        for (std::size_t j = lo; j < precursors.size() && precursors[j].z == p.z && precursors[j].mz <= want + tol; ++j)
          if (std::fabs(precursors[j].rt - p.rt) <= kRt)
          {
            ++n;
            break;
          }
      }
      return n;
    };
    lys8 = pairs(kLys8);
    arg10 = pairs(kArg10);
    // Format 5: medium to heavy (Lys4 to Lys8, Arg6 to Arg10), the pairs of a run without a light channel.
    other = std::max({pairs(4.025107), pairs(6.020129), pairs(8.044366), pairs(3.989092), pairs(3.988140)});
    std::array<std::uint64_t, 8> c{};
    for (std::size_t i = 0; i < c.size(); ++i) c[i] = pairs(kControl[i]);
    std::sort(c.begin(), c.end());
    control = 0.5 * static_cast<double>(c[3] + c[4]);
  }

  bool PairCounter::silac() const
  {
    return lys8 >= 30 && arg10 >= 30 && ratio(lys8) >= 2.0 && ratio(arg10) >= 2.0;
  }

  bool PairCounter::anyLabel() const
  {
    const std::uint64_t m = std::max({lys8, arg10, other});
    return m >= 30 && ratio(m) >= 2.0;
  }

  void applyPairs(Analysis& a, PairCounter pc)
  {
    pc.count();
    a.pairs = std::move(pc);
    a.pairs.precursors.shrink_to_fit();
    // Too few tags for the site scan, but reporters and label pairs were looked for and are absent.
    // ponytail: a sample labelled in one channel only (all heavy, light dimethyl) is called label-free here.
    // Format 5: a run that does not record the reporter region (ion-trap CID, a first mass above it) cannot
    // quantify an isobaric label; it counts like the gate `none`, also when the no call says low_resolution_ms2.
    const bool not_recorded = a.reporters.regionNotRecorded();
    if (a.status == "no_call" &&
        (a.reason == "few_spectra" || a.reason == "no_reference" || (a.reason == "low_resolution_ms2" && not_recorded)) &&
        (a.reporter_gate == "none" || not_recorded) && a.pairs.precursors.size() >= 500 && !a.pairs.anyLabel())
    {
      a.status = "call";
      a.labels = "label-free";
      a.call_sites = a.reason = "-";
      a.basis = "absence";
      return;
    }
    if (!a.pairs.silac()) return;
    if (a.status == "call" && a.labels != "label-free")
    {
      // Format 4: a call of SILAC labels only (the tags often show one residue's label) gains the label the pairs show.
      // Any other label call stays: pairs on an isobaric run are not evaluated.
      const std::string have = "+" + a.labels + "+";
      for (std::size_t p = 0, q; p < a.labels.size(); p = q + 1)
      {
        q = std::min(a.labels.find('+', p), a.labels.size());
        if (a.labels.compare(p, 5, "K:Lys") != 0 && a.labels.compare(p, 5, "R:Arg") != 0) return;
      }
      bool added = false;
      for (const char* label : {"K:Lys8", "R:Arg10"})
      {
        if (have.find(std::string("+") + label + "+") != std::string::npos) continue;
        a.labels += std::string("+") + label;
        if (a.call_sites.find(label[0]) == std::string::npos) a.call_sites += std::string(",") + label[0];
        added = true;
      }
      if (added) a.basis += "+precursor_pairs";
      return;
    }
    a.status = "call";
    a.labels = "K:Lys8+R:Arg10";
    a.call_sites = "K,R";
    a.reason = "-";
    a.basis = "precursor_pairs";
  }

  Analysis analyze(const Collector& col, const Settings& s_in, const UnimodTable& unimod)
  {
    Analysis a;
    Settings s = s_in;
    if (s.alphabet.empty()) s.alphabet = runAlphabet({});
    a.known = col.known;
    a.known_tags = col.known_tags;
    a.known_spectra = col.known_spectra;
    a.tags_excluded_cz = col.cz;
    a.unimod_entries = unimod.entries.size();
    // counts
    {
      std::uint32_t last = 0;
      bool any = false;
      for (const Record& r : col.records)
      {
        ++a.tags_counted;
        if (!any || r.spectrum != last) { ++a.spectra_counted; last = r.spectrum; any = true; }
        if (r.n == 0) ++a.clamped_n;
        else if (r.n > s.max_flank) ++a.above_max_n;
        if (r.c == 0) ++a.clamped_c;
        else if (r.c > s.max_flank) ++a.above_max_c;
      }
    }
    if (s.low_resolution)
    {
      a.reason = "low_resolution";
      return a;
    }
    if (a.tags_counted == 0 && a.tags_excluded_cz > 0)
    {
      a.reason = "cz_only";
      return a;
    }
    a.analysed = true;
    Ctx ctx;
    ctx.s = &s;
    ctx.unimod = &unimod;
    ctx.alphabet = s.alphabet;
    ctx.spectra_counted = a.spectra_counted;
    // calibration and windows on the raw values
    a.cal = calibrate(col.records, s.alphabet);
    a.win = estimateWindows(col.records, a.cal, s);
    ctx.cal = a.cal;
    ctx.win = a.win;
    Data data;
    // calibrated records
    data.rec = col.records;
    for (Record& r : data.rec)
    {
      if (r.c > 0 && a.cal.estimated_c) r.c = static_cast<float>(r.c - a.cal.ppmC(r.c) * r.c * 1e-6);
      if (r.n > 0 && a.cal.estimated_n) r.n = static_cast<float>(r.n - a.cal.ppm_n * r.M * 1e-6);
    }
    // dense spectrum ids
    data.sid.resize(data.rec.size());
    {
      std::uint32_t id = 0;
      for (std::size_t i = 0; i < data.rec.size(); ++i)
      {
        if (i > 0 && data.rec[i].spectrum != data.rec[i - 1].spectrum) ++id;
        data.sid[i] = id;
      }
      data.nspec = data.rec.empty() ? 0 : id + 1;
    }
    // value indexes
    for (std::size_t i = 0; i < data.rec.size(); ++i)
    {
      if (data.rec[i].n > 0) data.byN.push_back({data.rec[i].n, static_cast<std::uint32_t>(i)});
      if (data.rec[i].c > 0) data.byC.push_back({data.rec[i].c, static_cast<std::uint32_t>(i)});
    }
    auto byv = [](const Entry& x, const Entry& y) { return x.v != y.v ? x.v < y.v : x.rec < y.rec; };
    std::sort(data.byN.begin(), data.byN.end(), byv);
    std::sort(data.byC.begin(), data.byC.end(), byv);
    // histograms
    const std::size_t nb = static_cast<std::size_t>(std::ceil(s.max_flank / kBin));
    for (Hist* h : {&data.hn, &data.hc})
    {
      h->nb = nb;
      h->max_flank = s.max_flank;
      h->H.assign(nb, 0);
      h->HK.assign(nb, 0);
    }
    data.hn.r = static_cast<i64>(std::floor(a.win.w_n_hist / kBin + 1e-9));
    data.hc.r = static_cast<i64>(std::floor(a.win.w_c / kBin + 1e-9));
    for (const Record& r : data.rec)
    {
      if (const i64 i = data.hn.binOf(r.n); i >= 0)
      {
        ++data.hn.H[static_cast<std::size_t>(i)];
        if (r.flags & kFirstK) ++data.hn.HK[static_cast<std::size_t>(i)];
      }
      if (const i64 i = data.hc.binOf(r.c); i >= 0)
      {
        ++data.hc.H[static_cast<std::size_t>(i)];
        if (r.flags & kLastK) ++data.hc.HK[static_cast<std::size_t>(i)];
      }
    }
    data.hn.finish();
    data.hc.finish();
    ctx.d = &data;
    ctx.n_tested_peaks = 2.0 * static_cast<double>(nb);
    const double P = std::ceil((s.max_flank - kScanLow) / kBin);
    ctx.n_tested_sites = 3.0 * P;
    // null image set
    ctx.comps = compositions(s.alphabet, compositionLimit(s.max_flank));
    ctx.null = nullImages(ctx.comps, s.max_flank + 1.0);
    a.null_compositions = ctx.comps.size();
    // channel peaks
    a.peaks_n = callPeaks(ctx, 'n');
    a.peaks_c = callPeaks(ctx, 'c');

    // ---- site scan, classification, call ----
    const int max_s = 2;
    auto controlOf = [&](const Ctx& c, char site) {
      std::vector<Image> imgs = imagesFor(site, 0.0, c.alphabet, max_s, s.max_flank);
      imgs.erase(std::remove_if(imgs.begin(), imgs.end(), [](const Image& im) { return im.zero; }), imgs.end());
      Eval ev = evaluate(c, site, 0.0, imgs, true, nullptr);
      ev.s.delta = 0.0;
      ev.s.cls = "control";
      ev.s.explanation = "unlabelled";
      ev.s.alternatives = "-";
      ev.s.label = "-";
      return ev;
    };
    struct Cand
    {
      char site;
      double x;
      std::vector<Image> imgs;
      const Ctx* ctx;
      Eval ev;
      bool kept = false, decided = false;
      int twin = -1;  ///< the isomorphic candidate of another site that explains the same images
    };
    NullImages accepted;
    std::vector<SiteCandidate> called;
    double ctrl_spec[3] = {0, 0, 0};  // N, K, R: spectra of the delta 0 controls; set below, before the call
    auto shares = [&](SiteCandidate& sc) {
      const double c0 = sc.site == 'N' ? ctrl_spec[0]
                                       : (sc.site == 'K' ? ctrl_spec[1] : (sc.site == 'R' ? ctrl_spec[2] : ctrl_spec[1] + ctrl_spec[2]));
      const double cl = static_cast<double>(sc.spectra_clean);
      sc.relative_share = cl + c0 > 0 ? cl / (cl + c0) : 0.0;
      sc.clean_share = a.spectra_counted > 0 ? cl / static_cast<double>(a.spectra_counted) : 0.0;
    };
    auto acceptImages = [&](const Cand& c, int owner) {
      for (const Image& im : c.imgs)
      {
        const auto k = static_cast<std::uint8_t>(im.nres);
        accepted.add(im.ch, im.mass, im.mass, k, kReadingAccepted, owner);
        // ion-series satellites of the low or high peak (a = b - CO,
        // - NH3): the flank moves down in c, up in n. (- H2O is left out:
        // K0f - H2O is exactly N0r of the same label.)
        const double sat[2] = {kCO, kNH3};
        for (double d : sat)
          accepted.add(im.ch, im.ch == 'c' ? im.mass - d : im.mass + d, im.ch == 'c' ? im.mass - d : im.mass + d, k, kReadingAccepted, owner);
        if (im.ch == 'n')
        {
          accepted.add('n', im.mass + kC13, im.mass + kC13, k, kReadingAccepted, owner);
          accepted.add('n', im.mass + 2 * kC13, im.mass + 2 * kC13, k, kReadingAccepted, owner);
        }
      }
      accepted.sortAll();
    };
    auto classify = [&](Cand& c, const std::vector<Cand>& all) {
      SiteCandidate& sc = c.ev.s;
      const u64 thr = c.ctx->thr4();
      sc.cls.clear();
      sc.tier = 2;
      shares(sc);
      if (c.ev.ladder_clean_base < 3 && !c.ev.zero_clean_base) sc.cls = "null_shadow";
      if (sc.cls.empty() && c.ev.support_c_base < thr)
        for (int k = 1; k <= 2; ++k)
          if (std::fabs(sc.delta - k * kC13) <= c.ctx->win.w_n_hist) sc.cls = "isotope_error";
      if (sc.cls.empty())
        for (const Cand& o : all)
        {
          if (&o == &c || o.site != c.site || o.ev.s.spectra <= sc.spectra) continue;
          for (int k = 1; k <= 2; ++k)
            if (std::fabs(sc.delta - (o.ev.s.delta + k * kC13)) <= c.ctx->win.w_n_hist && c.ev.support_c_base < thr)
              sc.cls = "isotope_error";
        }
      if (sc.cls.empty() && c.twin >= 0)
      {
        const Cand& t = all[static_cast<std::size_t>(c.twin)];
        sc.cls = "shadow:" + std::string(1, t.site) + fixed4(t.ev.s.delta);
      }
      if (sc.cls.empty() && sc.spectra > 0 && (2 * c.ev.shadow_spectra > sc.spectra || c.ev.base_shadow))
      {
        // the accepted hypothesis whose images it shares
        std::string who = "-";
        if (c.ev.shadow_owner >= 0 && static_cast<std::size_t>(c.ev.shadow_owner) < called.size())
        {
          const SiteCandidate& h = called[static_cast<std::size_t>(c.ev.shadow_owner)];
          who = std::string(1, h.site) + fixed4(h.delta);
        }
        sc.cls = "shadow:" + who;
      }
      if (sc.cls.empty())
        explainSite(*c.ctx, sc, c.ev.est_c);
      else
      {
        // still name what it would be, as an alternative
        SiteCandidate tmp = sc;
        explainSite(*c.ctx, tmp, c.ev.est_c);
        sc.explanation = tmp.cls == "unexplained" ? "-" : tmp.explanation;
        std::vector<std::string> alts;
        if (tmp.alternatives != "-") alts.push_back(tmp.alternatives);
        sc.alternatives = joinAlts(alts);
        sc.label = "-";
      }
    };
    auto passes = [&](const Cand& c) {
      const SiteCandidate& sc = c.ev.s;
      const u64 thr = c.ctx->thr4();
      if (excludedClass(sc.cls)) return false;
      if (std::fabs(sc.delta) <= std::max(c.ctx->win.w_n_hist, c.ctx->win.w_c)) return false;
      if (sc.spectra < s.min_spectra || sc.share < s.call_min_share) return false;
      if (sc.fold < s.min_fold || sc.log10_q > s.max_log10_q) return false;
      if (!(sc.ladder_clean >= 3 || sc.zero_clean)) return false;
      if (!(sc.support_c >= s.min_spectra || (sc.support_c >= thr && sc.support_n >= thr))) return false;
      // the evidence bar of the candidate's tier (Settings::tier_min_*): a
      // label sits on a share of the peptides comparable to the unlabelled
      // ones and on a ladder of many residues; the chance offsets of a
      // label-free run (variable modifications, internal and chimeric
      // fragments) do not
      const int t = std::clamp(sc.tier, 0, 2);
      if (sc.relative_share < s.tier_min_relative[t] || sc.clean_share < s.tier_min_clean_share[t] ||
          sc.ladder_clean < s.tier_min_ladder[t])
        return false;
      return true;
    };
    auto keptRule = [&](const SiteCandidate& sc) {
      return sc.spectra >= s.min_spectra && sc.share >= s.min_share && sc.fold >= s.min_fold && sc.log10_q <= s.max_log10_q;
    };
    // A scan maximum on a flat top can lie up to a window off the offset
    // (the window wider than the spread of the flanks): evaluate, move x to
    // where the candidate's strongest image puts it, rebuild the images and
    // evaluate again.
    auto refine = [&](Cand& c, const NullImages* acc) {
      c.ev = evaluate(*c.ctx, c.site, c.x, c.imgs, false, acc);
      const double d = c.ev.est_top;
      if (std::isfinite(d) && std::fabs(d - c.x) > kBin)
      {
        c.x = d;
        c.imgs = imagesFor(c.site, c.x, c.ctx->alphabet, max_s, s.max_flank);
        c.ev = evaluate(*c.ctx, c.site, c.x, c.imgs, false, acc);
      }
    };
    auto runSites = [&](const Ctx& c, const std::string& sites, std::vector<Cand>& cands) {
      for (char site : sites)
        for (double x : siteScan(c, site, c.alphabet))
        {
          Cand cd;
          cd.site = site;
          cd.x = x;
          cd.imgs = imagesFor(site, x, c.alphabet, max_s, s.max_flank);
          cd.ctx = &c;
          cands.push_back(std::move(cd));
        }
    };
    auto mergeC = [&](std::vector<Cand>& cands, const Ctx& c) {
      // an offset common to K and R within w_c: a C-terminal candidate
      std::vector<Cand> extra;
      for (Cand& k : cands)
      {
        if (k.site != 'K' || !k.kept) continue;
        for (Cand& r : cands)
        {
          if (r.site != 'R' || !r.kept) continue;
          if (std::fabs(k.ev.s.delta - r.ev.s.delta) > c.win.w_c) continue;
          // a SILAC pair of the same offset (Lys6 and Arg6, 13C(6)) is a K
          // and an R label, not a C-terminal modification
          {
            const double m = 0.5 * (k.ev.s.delta + r.ev.s.delta);
            bool kk = false, rr = false;
            for (const KnownSite& q : knownAt('K', s)) kk = kk || (!q.configured && std::fabs(m - q.mass) <= c.win.w_c);
            for (const KnownSite& q : knownAt('R', s)) rr = rr || (!q.configured && std::fabs(m - q.mass) <= c.win.w_c);
            if (kk && rr) continue;
          }
          Cand cc;
          cc.site = 'C';
          cc.x = 0.5 * (k.ev.s.delta + r.ev.s.delta);
          cc.imgs = imagesFor('C', cc.x, c.alphabet, max_s, s.max_flank);
          cc.ctx = &c;
          cc.ev = evaluate(c, 'C', cc.x, cc.imgs, false, nullptr);
          // channel-c support on both the K1f and R1f images
          u64 k1 = 0, r1 = 0;
          for (std::size_t i = 0; i < cc.imgs.size(); ++i)
          {
            std::vector<Match> m;
            if (cc.imgs[i].name == "K1f" || cc.imgs[i].name == "R1f")
            {
              c.match(cc.imgs[i], 0, m);
              std::vector<std::uint32_t> ids;
              for (const Match& q : m) ids.push_back(q.sid);
              std::sort(ids.begin(), ids.end());
              const u64 n = static_cast<u64>(std::unique(ids.begin(), ids.end()) - ids.begin());
              (cc.imgs[i].name == "K1f" ? k1 : r1) = n;
            }
          }
          if (k1 >= c.thr4() && r1 >= c.thr4())
          {
            cc.kept = keptRule(cc.ev.s);
            if (cc.kept)
            {
              k.kept = false;
              r.kept = false;
              extra.push_back(std::move(cc));
            }
          }
        }
      }
      for (Cand& e : extra) cands.push_back(std::move(e));
    };
    // Section 7's site attribution, made explicit: in the two raw channels
    // an N offset x and the K or R offset y = x - H2O - K (R) predict the
    // same masses (N0r = K1f, N0f = K1r, N1r = K2f, N1f = K2r). Such twins
    // are one family; one member takes its evidence, the others are
    // shadows of it: a member with a known or curated label explanation,
    // else a K member with a clean K0f image (the one image a twin cannot
    // show), else the N member.
    auto resolveTwins = [&](std::vector<Cand>& cs) {
      for (Cand& c : cs) c.twin = -1;
      auto labelish = [&](const Cand& c) {
        SiteCandidate tmp = c.ev.s;
        explainSite(*c.ctx, tmp, c.ev.est_c);
        return tmp.cls == "known_label" || (tmp.cls == "unimod" && curatedIndex(tmp.label) >= 0);
      };
      auto rank = [&](const Cand& c) {
        if (labelish(c)) return c.site == 'N' ? 0 : 1;
        if (c.site == 'C') return 2;  // one offset explains both its K and R twins
        if (c.site == 'K' && c.ev.s.zero_clean) return 3;
        if (c.site == 'N') return 4;
        return 5;
      };
      for (std::size_t i = 0; i < cs.size(); ++i)
      {
        if (cs[i].site != 'N' || !cs[i].kept || cs[i].decided) continue;
        std::vector<std::size_t> fam{i};
        for (std::size_t j = 0; j < cs.size(); ++j)
        {
          if (j == i || !cs[j].kept || cs[j].decided || cs[j].site == 'N') continue;
          const double tol = 2 * cs[i].ctx->win.w_c;
          const double xi = cs[i].ev.s.delta, yj = cs[j].ev.s.delta;
          bool twin = false;
          // N1/N0 images = K2/K1 (R2/R1) images of y = x - H2O - K (R)
          if (cs[j].site == 'K' || cs[j].site == 'C') twin = twin || std::fabs(xi - (yj + kMassK + kH2O)) <= tol;
          if (cs[j].site == 'R' || cs[j].site == 'C') twin = twin || std::fabs(xi - (yj + kMassR + kH2O)) <= tol;
          // N0r/N0f = K0f/K0r of y = x - H2O
          if (cs[j].site == 'K' || cs[j].site == 'C') twin = twin || std::fabs(xi - (yj + kH2O)) <= tol;
          if (twin) fam.push_back(j);
        }
        if (fam.size() < 2) continue;
        std::size_t best = fam.front();
        int br = rank(cs[best]);
        for (std::size_t k : fam)
        {
          const int r = rank(cs[k]);
          if (r < br || (r == br && cs[k].ev.s.parsimony > cs[best].ev.s.parsimony)) { best = k; br = r; }
        }
        for (std::size_t k : fam)
          if (k != best && cs[k].twin < 0) cs[k].twin = static_cast<int>(best);
      }
    };

    double ctrl_pars[3] = {0, 0, 0};  // N, K, R; set below, before the call
    auto controlParsimony = [&](char site) {
      switch (site)
      {
        case 'N': return ctrl_pars[0];
        case 'K': return ctrl_pars[1];
        case 'R': return ctrl_pars[2];
        default: return std::max(ctrl_pars[1], ctrl_pars[2]);
      }
    };
    auto callLoop = [&](std::vector<Cand>& cands) {
      for (;;)
      {
        for (Cand& c : cands)
          if (c.kept && !c.decided)
          {
            c.ev = evaluate(*c.ctx, c.site, c.x, c.imgs, false, accepted.n.empty() && accepted.c.empty() ? nullptr : &accepted);
          }
        resolveTwins(cands);
        for (Cand& c : cands)
          if (c.kept && !c.decided) classify(c, cands);
        std::vector<Cand*> order;
        for (Cand& c : cands)
          if (c.kept && !c.decided) order.push_back(&c);
        std::stable_sort(order.begin(), order.end(), [](const Cand* x, const Cand* y) {
          if (x->ev.s.parsimony != y->ev.s.parsimony) return x->ev.s.parsimony > y->ev.s.parsimony;
          if (x->ev.s.spectra_clean != y->ev.s.spectra_clean) return x->ev.s.spectra_clean > y->ev.s.spectra_clean;
          if (x->ev.s.spectra != y->ev.s.spectra) return x->ev.s.spectra > y->ev.s.spectra;
          const std::string so = "NKRC";
          if (x->site != y->site) return so.find(x->site) < so.find(y->site);
          return x->x < y->x;
        });
        // a further label needs a tenth of the strongest called one's
        // parsimony (prior): the residue-sum and ion-series relatives of a
        // strong label that no image rule catches stay below it
        // and a tenth of its site's delta 0 control (prior): a label sits on
        // a share of the peptides comparable to the unlabelled ones, the
        // chance offsets of a label-free run do not
        double top = 0;
        for (const SiteCandidate& h : called) top = std::max(top, h.parsimony);
        Cand* pick = nullptr;
        for (Cand* c : order)
          if (passes(*c) && c->ev.s.parsimony >= s.min_relative_parsimony * std::max(top, controlParsimony(c->site)))
          {
            pick = c;
            break;
          }
        if (pick == nullptr) break;
        pick->decided = true;
        pick->ev.s.called = true;
        called.push_back(pick->ev.s);
        acceptImages(*pick, static_cast<int>(called.size()) - 1);
      }
    };

    {
      const char cs[3] = {'N', 'K', 'R'};
      for (int i = 0; i < 3; ++i)
      {
        const Eval e = controlOf(ctx, cs[i]);
        ctrl_pars[i] = e.s.parsimony;
        ctrl_spec[i] = static_cast<double>(e.s.spectra);
      }
    }
    std::vector<Cand> cands;
    runSites(ctx, "NKR", cands);
    const double w_zero = std::max(a.win.w_n_hist, a.win.w_c);  // delta 0 is the control, never a candidate
    for (Cand& c : cands)
    {
      refine(c, nullptr);
      c.kept = keptRule(c.ev.s) && std::fabs(c.x) > w_zero;
    }
    mergeC(cands, ctx);
    callLoop(cands);

    // second pass: a K label joins the alphabet and O_N is scanned again
    Ctx ctx2;
    bool second = false;
    {
      std::vector<Residue> A2 = s.alphabet;
      for (const SiteCandidate& h : called)
        if (h.site == 'K')
        {
          const double m = kMassK + h.delta;
          bool dup = false;
          for (const Residue& r : A2) dup = dup || std::fabs(r.mass - m) <= a.win.w_c;
          if (dup) continue;
          Residue r;
          r.letter = 'K';
          r.name = "K[" + signedFix(h.delta, 4) + "]";
          r.mass = m;
          A2.push_back(r);
          second = true;
        }
      if (second)
      {
        ctx2 = ctx;  // shares the data; own alphabet and null set
        ctx2.alphabet = A2;
        ctx2.comps = compositions(A2, compositionLimit(s.max_flank));
        ctx2.null = nullImages(ctx2.comps, s.max_flank + 1.0);
        // the first pass' decisions stand; offsets the rescan finds that no
        // N candidate holds yet join the undecided ones
        const double w0 = std::max(a.win.w_n_hist, a.win.w_c);
        std::vector<Cand> n2;
        runSites(ctx2, "N", n2);
        const NullImages* acc = accepted.n.empty() && accepted.c.empty() ? nullptr : &accepted;
        for (Cand& c : n2)
        {
          bool dup = false;
          for (const Cand& o : cands) dup = dup || (o.site == 'N' && std::fabs(o.x - c.x) <= w0);
          if (dup) continue;
          refine(c, acc);
          c.kept = keptRule(c.ev.s) && std::fabs(c.x) > w_zero;
          cands.push_back(std::move(c));
        }
        callLoop(cands);
      }
    }
    // final classification of the undecided against the final accepted set
    for (Cand& c : cands)
      if (c.kept && !c.decided)
      {
        c.ev = evaluate(*c.ctx, c.site, c.x, c.imgs, false, accepted.n.empty() && accepted.c.empty() ? nullptr : &accepted);
        classify(c, cands);
      }

    // controls and the result list
    const Ctx& nctx = second ? ctx2 : ctx;
    Eval ctrl[3] = {controlOf(nctx, 'N'), controlOf(ctx, 'K'), controlOf(ctx, 'R')};
    const std::string order = "NKRC";
    for (char site : order)
    {
      if (site != 'C')
      {
        SiteCandidate cs = ctrl[order.find(site)].s;
        cs.tier = -1;
        a.sites.push_back(cs);
      }
      std::vector<const Cand*> v;
      for (const Cand& c : cands)
        if (c.site == site && (c.kept || c.decided)) v.push_back(&c);
      std::sort(v.begin(), v.end(), [](const Cand* x, const Cand* y) {
        if (x->ev.s.called != y->ev.s.called) return x->ev.s.called;
        if (x->ev.s.parsimony != y->ev.s.parsimony) return x->ev.s.parsimony > y->ev.s.parsimony;
        if (x->ev.s.spectra_clean != y->ev.s.spectra_clean) return x->ev.s.spectra_clean > y->ev.s.spectra_clean;
        if (x->ev.s.spectra != y->ev.s.spectra) return x->ev.s.spectra > y->ev.s.spectra;
        return x->x < y->x;
      });
      for (const Cand* c : v)
      {
        SiteCandidate sc = c->ev.s;
        if (site != 'C')
        {
          const u64 c0 = ctrl[order.find(site)].s.spectra;
          const u64 cl = c->ev.spectra_nonzero;
          sc.completeness = cl + c0 > 0 ? static_cast<double>(cl) / static_cast<double>(cl + c0) : -1;
        }
        a.sites.push_back(std::move(sc));
      }
    }

    // ---- the call ----
    if (a.spectra_counted < s.min_counted_spectra)
    {
      a.status = "no_call";
      a.reason = "few_spectra";
      return a;
    }
    if (joinCalls(a, false, a.labels, a.call_sites))
    {
      a.status = "call";
      a.reason = "-";
      return a;
    }
    a.labels = a.call_sites = "-";
    // label-free: the delta 0 N-terminal control passes the same rule
    {
      const SiteCandidate& c0 = ctrl[0].s;
      const bool ok = c0.spectra >= s.min_spectra && c0.share >= s.call_min_share && c0.fold >= s.min_fold &&
                      c0.log10_q <= s.max_log10_q && c0.ladder_clean >= 3 &&
                      (c0.support_c >= s.min_spectra || (c0.support_c >= ctx.thr4() && c0.support_n >= ctx.thr4()));
      if (ok)
      {
        a.status = "call";
        a.labels = "label-free";
        a.call_sites = "-";
        a.reason = "-";
      }
      else
      {
        a.status = "no_call";
        a.reason = "no_reference";
      }
    }
    return a;
  }

  // ---- report rows --------------------------------------------------------------------------

  std::vector<Digest::Row> reportRows(const Analysis& a, const Settings& s_in)
  {
    using Digest::num;
    Settings s = s_in;
    if (s.alphabet.empty()) s.alphabet = runAlphabet({});
    std::vector<Digest::Row> rows;
    auto row = [&](const std::string& sec, const std::string& key, const std::string& value, const std::string& n,
                   const std::string& desc) { rows.push_back({sec, key, value.empty() ? "-" : value, n, desc}); };
    const bool an = a.analysed;
    // ld_run
    row("ld_run", "format", std::to_string(kFormat), "-", "label discovery report format (doc/LABEL-DISCOVERY-REPORT.md)");
    row("ld_run", "tags_source", s.fasta_filtered ? "fasta_filtered" : "all", "-",
        "which tags were written: all, or only the -fasta matches");
    row("ld_run", "low_resolution", s.low_resolution ? "yes" : "no", "-", "fragment tolerance in Da: no peaks are called");
    row("ld_run", "window_n", an ? (a.win.n_flat > 0 ? fix(a.win.n_flat, 6) : "ppm") : "-", "-",
        "half-window of channel n in Da, or ppm (w_n(M) = 3 sigma_ppm_n M; histograms at window_n_p90)");
    row("ld_run", "window_c", an ? fix(a.win.w_c, 6) : "-", "-", "half-window of channel c (Da)");
    row("ld_run", "window_source_n", an ? a.win.source_n : "-", "-", "estimated, default or option");
    row("ld_run", "window_source_c", an ? a.win.source_c : "-", "-", "estimated, default or option");
    row("ld_run", "bin_da", fix(kBin, 6), "-", "histogram bin width (Da)");
    row("ld_run", "max_flank_da", fix(s.max_flank, 6), "-", "largest flank mass histogrammed (Da)");
    row("ld_run", "depth", std::to_string(s.depth), "-", "most residues a channel-peak explanation names");
    row("ld_run", "min_spectra", num(s.min_spectra), "-", "spectra a peak or site candidate needs");
    row("ld_run", "min_share", fix(s.min_share, 6), "-", "share of the counted spectra a peak needs");
    row("ld_run", "min_fold", fix(s.min_fold, 6), "-", "fold over the background a peak needs");
    row("ld_run", "max_log10_q", fix(s.max_log10_q, 6), "-", "log10 q a peak needs at most");
    row("ld_run", "call_min_share", fix(s.call_min_share, 6), "-", "share of the counted spectra a called candidate needs");
    row("ld_run", "min_relative_parsimony", fix(s.min_relative_parsimony, 6), "-",
        "share of the strongest called label's parsimony a further label needs");
    for (int t = 0; t < 3; ++t)
    {
      const std::string k = "tier" + std::to_string(t) + "_";
      const char* what = t == 0 ? "a known label" : (t == 1 ? "a Unimod label" : "an unknown or other offset");
      row("ld_run", k + "min_relative_share", fix(s.tier_min_relative[t], 6), "-",
          std::string("relative share a called candidate needs, explained as ") + what);
      row("ld_run", k + "min_clean_share", fix(s.tier_min_clean_share[t], 6), "-",
          std::string("clean share of the counted spectra a called candidate needs, explained as ") + what);
      row("ld_run", k + "min_ladder_clean", std::to_string(s.tier_min_ladder[t]), "-",
          std::string("clean ladder residues a called candidate needs, explained as ") + what);
    }
    row("ld_run", "fixed_nterm_delta", fix(s.fixed_nterm, 6), "-", "the run's fixed N-terminal modification (not subtracted)");
    row("ld_run", "fixed_cterm_delta", fix(s.fixed_cterm, 6), "-", "the run's fixed C-terminal modification (not subtracted)");
    {
      std::string al;
      for (const Residue& r : s.alphabet) al += (al.empty() ? "" : ",") + r.name + "=" + fix(r.mass, 6);
      row("ld_run", "alphabet", al, num(static_cast<std::uint64_t>(s.alphabet.size())), "run alphabet S1 (residue=mass)");
    }
    row("ld_run", "unimod_entries", num(static_cast<std::uint64_t>(a.unimod_entries)), "-", "ModificationsDB entries searched");
    row("ld_run", "digest_assumption", "tryptic_P1", "-", "the site scan assumes K and R at P1");
    row("ld_run", "sigma_ppm_n", an && a.cal.n_ref_n_all > 0 ? fix(a.cal.sigma_ppm_n, 4) : "-", num(a.cal.n_ref_n_all),
        "1.4826 MAD of the channel n reference deviations, ppm of M");
    row("ld_run", "window_n_p90", an ? fix(a.win.w_n_hist, 6) : "-", "-", "the histograms' n window: w_n at the 90th percentile of M");
    row("ld_run", "precursor_mass_q10", an ? fix(a.win.m_q10, 4) : "-", "-", "precursor neutral mass, 10 % quantile");
    row("ld_run", "precursor_mass_q50", an ? fix(a.win.m_q50, 4) : "-", "-", "precursor neutral mass, median");
    row("ld_run", "precursor_mass_q90", an ? fix(a.win.m_q90, 4) : "-", "-", "precursor neutral mass, 90 % quantile");
    row("ld_run", "calib_ppm_c", an && a.cal.estimated_c ? fix(a.cal.ppm_c, 4) : "-", num(a.cal.n_ref_c),
        "median ppm offset of channel c against the reference images (n: reference values)");
    row("ld_run", "calib_ppm_n", an && a.cal.estimated_n ? fix(a.cal.ppm_n, 4) : "-", num(a.cal.n_ref_n),
        "median offset of channel n, ppm of M (n: reference values)");
    row("ld_run", "calib_slope_c", an && a.cal.slope ? fix(a.cal.slope_c, 6) : "-", "-",
        "linear term of the channel c calibration (ppm per Da), - when not fitted");
    row("ld_run", "calib_unc_ppm_c", an && a.cal.unc_ppm_c >= 0 ? fix(a.cal.unc_ppm_c, 4) : "-", "-",
        "residual calibration uncertainty of channel c (ppm)");
    row("ld_run", "calib_unc_ppm_n", an && a.cal.unc_ppm_n >= 0 ? fix(a.cal.unc_ppm_n, 4) : "-", "-",
        "residual calibration uncertainty of channel n (ppm of M)");
    row("ld_run", "null_compositions", an ? num(static_cast<std::uint64_t>(a.null_compositions)) : "-", "-",
        "residue compositions of the null image set (0.0005 Da bins)");
    // ld_count
    row("ld_count", "spectra_counted", num(a.spectra_counted), "-", "spectra with a counted b/y tag");
    row("ld_count", "tags_counted", num(a.tags_counted), "-", "counted b/y tags (ungapped, E <= 1, selected hypothesis)");
    row("ld_count", "tags_excluded_cz", num(a.tags_excluded_cz), "-", "c/z tags, counted and not binned");
    row("ld_count", "clamped_n", num(a.clamped_n), "-", "n flanks of exactly 0 (the clamp), never binned");
    row("ld_count", "clamped_c", num(a.clamped_c), "-", "c flanks of exactly 0 (the clamp), never binned");
    row("ld_count", "above_max_n", num(a.above_max_n), "-", "n flanks above max_flank");
    row("ld_count", "above_max_c", num(a.above_max_c), "-", "c flanks above max_flank");
    if (an)
    {
      // ld_peak
      for (const auto* pv : {&a.peaks_n, &a.peaks_c})
      {
        std::size_t i = 0;
        for (const Peak& p : *pv)
        {
          ++i;
          const std::string k = std::string(1, p.ch) + "." + std::to_string(i) + ".";
          row("ld_peak", k + "mass", fix(p.mass, 6), "-", "peak mass (Da), calibrated");
          row("ld_peak", k + "sigma", fix(p.sigma, 6), "-", "1.4826 MAD of the peak (Da)");
          row("ld_peak", k + "spectra", num(p.spectra), "-", "distinct spectra within the window");
          row("ld_peak", k + "tags", num(p.tags), "-", "tags within the window");
          row("ld_peak", k + "background", fix(p.background, 4), "-", "half-integer background");
          row("ld_peak", k + "fold", fix(p.fold, 4), "-", "smoothed count over max(background, 1)");
          row("ld_peak", k + "log10_q", fix(p.log10_q, 4), "-", "Poisson upper tail, Bonferroni, log10");
          row("ld_peak", k + "class", p.cls, "-", "residue_combo, known_label, unimod or unexplained");
          row("ld_peak", k + "explanation", p.explanation, "-", "the best explanation");
          row("ld_peak", k + "alternatives", p.alternatives, "-", "other explanations (error in Da)");
          row("ld_peak", k + "share_adjacent_k", fix(p.share_adjacent_k, 4), "-",
              p.ch == 'c' ? "share of the tags whose last residue is K" : "share of the tags whose first residue is K");
          row("ld_peak", k + "se", fix(p.se, 7), "-", "standard error of the mass (Da)");
        }
      }
      // ld_site
      std::map<char, int> idx;
      for (const SiteCandidate& sc : a.sites)
      {
        const int i = sc.control ? 0 : ++idx[sc.site];
        const std::string k = std::string(1, sc.site) + "." + std::to_string(i) + ".";
        row("ld_site", k + "delta", fix(sc.delta, 6), "-", sc.control ? "delta 0: the unlabelled control" : "offset (Da)");
        row("ld_site", k + "sigma", fix(sc.sigma, 6), "-", "1.4826 MAD of the supporting deviations (Da)");
        row("ld_site", k + "spectra", num(sc.spectra), "-", "distinct spectra with a tag at one of the images");
        row("ld_site", k + "spectra_clean", num(sc.spectra_clean), "-", "the same, clean images only");
        row("ld_site", k + "parsimony", fix(sc.parsimony, 4), "-",
            "sum over the clean spectra of 2^-k, k the fewest residues of a supporting image (the call's order)");
        row("ld_site", k + "image_hits", num(sc.image_hits), "-", "summed histogram reads over the images");
        row("ld_site", k + "null_expectation", fix(sc.null_expectation, 4), "-", "summed reads of the confounded images");
        row("ld_site", k + "share", fix(sc.share, 6), "-", "spectra over counted spectra");
        row("ld_site", k + "ladder_clean", std::to_string(sc.ladder_clean), "-", "residues with a clean ladder image");
        row("ld_site", k + "ladder_confounded", std::to_string(sc.ladder_confounded), "-",
            "residues with a confounded ladder image (descriptive)");
        row("ld_site", k + "support_c", num(sc.support_c), "-", "spectra with a clean image in channel c");
        row("ld_site", k + "support_n", num(sc.support_n), "-", "spectra with a clean image in channel n");
        row("ld_site", k + "null_coincident", sc.control ? "-" : (sc.null_coincident ? "yes" : "no"), "-",
            "the offset lies within w of m(S) or m(S) +- H2O");
        row("ld_site", k + "images", sc.images, "-", "tags per image class, * = confounded");
        row("ld_site", k + "fold", fix(sc.fold, 4), "-", "clean reads over max(background of the clean images, 1)");
        row("ld_site", k + "log10_q", fix(sc.log10_q, 4), "-", "Poisson upper tail, Bonferroni, log10");
        row("ld_site", k + "class", sc.cls, "-", "class (doc/LABEL-DISCOVERY-REPORT.md)");
        row("ld_site", k + "explanation", sc.explanation, "-", "the best explanation");
        row("ld_site", k + "alternatives", sc.alternatives, "-", "other explanations (error in Da)");
        row("ld_site", k + "completeness", sc.completeness >= 0 ? fix(sc.completeness, 4) : "-", "-",
            "spectra(L) / (spectra(L) + spectra(delta 0)), descriptive");
        row("ld_site", k + "called", sc.called ? "yes" : "no", "-", "the candidate is part of the call");
        row("ld_site", k + "tier", sc.control ? "-" : std::to_string(sc.tier), "-",
            "evidence tier of the explanation: 0 known label, 1 Unimod label, 2 other or unknown");
        row("ld_site", k + "relative_share", sc.control ? "-" : fix(sc.relative_share, 4), "-",
            "spectra_clean / (spectra_clean + the site's delta 0 control spectra)");
        row("ld_site", k + "clean_share", sc.control ? "-" : fix(sc.clean_share, 4), "-", "spectra_clean / counted spectra");
      }
    }
    if (!an)
    {
      // the delta 0 controls are always written; without an analysis
      // (low_resolution, cz_only) they hold no values
      for (char site : {'N', 'K', 'R'})
      {
        const std::string k = std::string(1, site) + ".0.";
        row("ld_site", k + "delta", "0", "-", "delta 0: the unlabelled control");
        for (const char* f : {"sigma", "spectra", "spectra_clean", "parsimony", "image_hits", "null_expectation", "share",
                              "ladder_clean", "ladder_confounded", "support_c", "support_n", "null_coincident", "images",
                              "fold", "log10_q"})
          row("ld_site", k + f, "-", "-", "not analysed");
        row("ld_site", k + "class", "control", "-", "class (doc/LABEL-DISCOVERY-REPORT.md)");
        row("ld_site", k + "explanation", "unlabelled", "-", "the best explanation");
        row("ld_site", k + "alternatives", "-", "-", "other explanations (error in Da)");
        row("ld_site", k + "completeness", "-", "-", "spectra(L) / (spectra(L) + spectra(delta 0)), descriptive");
        row("ld_site", k + "called", "no", "-", "the candidate is part of the call");
        for (const char* f : {"tier", "relative_share", "clean_share"}) row("ld_site", k + f, "-", "-", "not analysed");
      }
    }
    if (!s.low_resolution)
    {
      // ld_known
      for (std::size_t i = 0; i < a.known.size(); ++i)
        for (int j = 0; j < kKnownImages; ++j)
        {
          const std::string k = a.known[i].name + "." + kKnownImageNames[static_cast<std::size_t>(j)];
          row("ld_known", k + ".tags", num(a.known_tags[i][static_cast<std::size_t>(j)]), "-",
              "tags at the image (-digest_window, as -label_out counts)");
          row("ld_known", k + ".spectra", num(a.known_spectra[i][static_cast<std::size_t>(j)]), "-", "distinct spectra at the image");
        }
    }
    // ld_reporter
    {
      const ReporterCounter& rc = a.reporters;
      const std::string sc = num(rc.scans);
      row("ld_reporter", "scans", sc, "-", "high-resolution (not ion-trap) MS2 and MS3 scans examined for reporter ions");
      row("ld_reporter", "covered", num(rc.covered), sc, "scans with a peak in 112-137 m/z; gate none needs at least half");
      row("ld_reporter", "ms2_scans", num(rc.ms2), "-", "MS2 scans seen");
      row("ld_reporter", "ms2_ion_trap", num(rc.ms2_ion_trap), "-", "MS2 scans from an ion trap (filter string ITMS)");
      row("ld_reporter", "tmt_excess", fix(rc.excess(rc.tmt, rc.tmt_decoy), 4), sc, "share of scans with >= 2 TMT reporters (126-131) minus the share at decoy m/z");
      row("ld_reporter", "itraq4_excess", fix(rc.excess(rc.itraq4, rc.itraq4_decoy), 4), sc, "the same for >= 2 iTRAQ 4-plex reporters (114-117)");
      row("ld_reporter", "itraq8_excess", fix(rc.excess(rc.itraq8, rc.itraq8_decoy), 4), sc, "the same for >= 1 reporter of iTRAQ 8-plex only (113, 118, 119, 121)");
      row("ld_reporter", "tmtpro_excess", fix(rc.excess(rc.tmtpro, rc.tmtpro_decoy), 4), sc, "the same for >= 2 reporters of TMTpro only (132-135); not used by the call");
      row("ld_reporter", "it_scans", num(rc.it_scans), "-", "ion-trap MS2 and MS3 scans with peaks (not examined for reporter ions)");
      row("ld_reporter", "it_covered", num(rc.it_covered), num(rc.it_scans), "ion-trap scans with a peak in 112-137 m/z");
      row("ld_reporter", "region_recorded", rc.regionNotRecorded() ? "no" : "yes", "-",
          "no: >= 200 scans (scans + it_scans), under half with a peak in 112-137 m/z, no reporters in the covered high-resolution scans");
      row("ld_reporter", "gate", a.reporter_gate, "-", "unknown (below 200 scans), tmt, itraq4, itraq8, none or unclear");
    }
    // ld_pair
    {
      const PairCounter& pc = a.pairs;
      const std::string n = num(static_cast<std::uint64_t>(pc.precursors.size()));
      row("ld_pair", "precursors", n, "-", "MS2 precursors of charge 2-4 examined for SILAC pairs");
      row("ld_pair", "lys8_pairs", num(pc.lys8), n, "precursors with a partner of the same charge at +8.0142 Da within 2 mDa and 9 s");
      row("ld_pair", "arg10_pairs", num(pc.arg10), n, "the same at +10.0083 Da");
      row("ld_pair", "control_pairs", fix(pc.control, 1), n, "median over eight control spacings (the label masses shifted by whole Da)");
      row("ld_pair", "lys8_ratio", fix(pc.ratio(pc.lys8), 2), "-", "lys8_pairs / (control_pairs + 5)");
      row("ld_pair", "arg10_ratio", fix(pc.ratio(pc.arg10), 2), "-", "arg10_pairs / (control_pairs + 5)");
      row("ld_pair", "other_pairs", num(pc.other), n, "the largest count at +4.0251 (Lys4, dimethyl), +6.0201 (Lys6, Arg6), +8.0444 (dimethyl), +3.9891 and +3.9881 Da (Lys4 to Lys8, Arg6 to Arg10)");
      row("ld_pair", "other_ratio", fix(pc.ratio(pc.other), 2), "-", "other_pairs / (control_pairs + 5)");
      row("ld_pair", "silac", pc.silac() ? "yes" : "no", "-", "yes: both counts >= 30 and both ratios >= 2");
    }
    // ld_call
    row("ld_call", "status", a.status, "-", "call or no_call");
    row("ld_call", "labels", a.status == "call" ? a.labels : "-", "-", "the labels called, +-joined");
    row("ld_call", "sites", a.status == "call" ? a.call_sites : "-", "-", "the sites of the called labels");
    row("ld_call", "basis", a.basis, "-", "what the call is made from: site_scan, reporter_ions, precursor_pairs or absence; +precursor_pairs: the pairs added a SILAC label");
    row("ld_call", "reason", a.status == "call" ? "-" : a.reason, "-", "why there is no call");
    return rows;
  }
}
