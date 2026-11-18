// Run QC report (FASTag 1.16, -qc_out); see RunQC.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#include "RunQC.h"

#include <OpenMS/ANALYSIS/QUANTITATION/ItraqEightPlexQuantitationMethod.h>
#include <OpenMS/ANALYSIS/QUANTITATION/ItraqFourPlexQuantitationMethod.h>
#include <OpenMS/ANALYSIS/QUANTITATION/TMTEighteenPlexQuantitationMethod.h>
#include <OpenMS/ANALYSIS/QUANTITATION/TMTElevenPlexQuantitationMethod.h>
#include <OpenMS/ANALYSIS/QUANTITATION/TMTSixPlexQuantitationMethod.h>
#include <OpenMS/ANALYSIS/QUANTITATION/TMTSixteenPlexQuantitationMethod.h>
#include <OpenMS/ANALYSIS/QUANTITATION/TMTTenPlexQuantitationMethod.h>
#include <OpenMS/CONCEPT/Constants.h>
#include <OpenMS/IONMOBILITY/IMTypes.h>
#include <OpenMS/KERNEL/PeakTypeEstimator.h>
#include <OpenMS/PROCESSING/CENTROIDING/PeakPickerHiRes.h>

#include <algorithm>
#include <bit>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <numeric>
#include <utility>

using namespace OpenMS;

namespace FASTag::RunQC
{
  namespace
  {
    std::string lower(std::string_view s)
    {
      std::string r(s);
      for (char& c : r) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
      return r;
    }

    /// A positive, finite number from a meta value of any type; NaN otherwise.
    double positiveMeta(const MSSpectrum& s, const char* name)
    {
      if (!s.metaValueExists(name)) return std::numeric_limits<double>::quiet_NaN();
      const DataValue& v = s.getMetaValue(name);
      double d = std::numeric_limits<double>::quiet_NaN();
      if (v.valueType() == DataValue::STRING_VALUE)
      {
        const std::string t = v.toString();
        char* end = nullptr;
        d = std::strtod(t.c_str(), &end);
        if (end == t.c_str()) d = std::numeric_limits<double>::quiet_NaN();
      }
      else if (v.valueType() == DataValue::DOUBLE_VALUE || v.valueType() == DataValue::INT_VALUE)
        d = static_cast<double>(v);
      return std::isfinite(d) && d > 0 ? d : std::numeric_limits<double>::quiet_NaN();
    }

    double median(std::vector<double> v)
    {
      if (v.empty()) return std::numeric_limits<double>::quiet_NaN();
      const std::size_t m = v.size() / 2;
      std::nth_element(v.begin(), v.begin() + static_cast<std::ptrdiff_t>(m), v.end());
      const double hi = v[m];
      if (v.size() % 2) return hi;
      const double lo = *std::max_element(v.begin(), v.begin() + static_cast<std::ptrdiff_t>(m));
      return (lo + hi) / 2.0;
    }

    /// A share with four decimals; "" when the denominator is 0.
    std::string share(std::uint64_t a, std::uint64_t b)
    {
      if (b == 0) return {};
      char buf[32];
      std::snprintf(buf, sizeof buf, "%.4f", static_cast<double>(a) / static_cast<double>(b));
      return buf;
    }

    std::string whole(double v)
    {
      if (!std::isfinite(v)) return "n/a";
      char buf[32];
      std::snprintf(buf, sizeof buf, "%.0f", v);
      return buf;
    }

    const char* assessName(Assess a)
    {
      switch (a)
      {
        case Assess::OK: return "assessable";
        case Assess::ION_TRAP: return "ion_trap_ms2";
        case Assess::LOW_MASS_CUTOFF: return "low_mass_cutoff";
        case Assess::NO_PEAKS: return "no_peaks";
      }
      return "?";
    }

    const char* sourceName(Source s)
    {
      switch (s)
      {
        case Source::FILTER: return "filter";
        case Source::CONFIG: return "config";
        case Source::RUN: return "run";
        case Source::NONE: return "none";
      }
      return "?";
    }

    constexpr double BIN_WIDTH = 1.0005079;
    constexpr double H2O = 18.0105646863;
    constexpr double NH3 = 17.0265491015;
    constexpr double C13 = 1.0033548378;

    /// Immonium (and related) ions removed before the cosine (m/z, 1+).
    constexpr std::array<double, 24> IMMONIUM = {
        30.0338,  44.0495,  60.0444,  70.0651,  72.0808,  74.0600,  76.0215,  84.0808,
        86.0964,  87.0553,  88.0393,  101.0709, 101.1073, 102.0550, 104.0528, 110.0713,
        112.0869, 120.0478, 120.0808, 129.1022, 129.1135, 133.0430, 136.0757, 159.0917};
  }

  // ---- analyser classes ----------------------------------------------------

  const char* analyzerName(Analyzer a)
  {
    switch (a)
    {
      case Analyzer::ITMS: return "ITMS";
      case Analyzer::FTMS: return "FTMS";
      case Analyzer::TOF: return "TOF";
      case Analyzer::OTHER: return "other";
      case Analyzer::UNKNOWN: return "unknown";
    }
    return "unknown";
  }

  Analyzer analyzerFromFilter(std::string_view filter)
  {
    std::size_t b = 0;
    while (b < filter.size() && std::isspace(static_cast<unsigned char>(filter[b]))) ++b;
    std::size_t e = b;
    while (e < filter.size() && !std::isspace(static_cast<unsigned char>(filter[e]))) ++e;
    const std::string tok = lower(filter.substr(b, e - b));
    if (tok == "ftms") return Analyzer::FTMS;
    if (tok == "itms") return Analyzer::ITMS;
    if (tok == "tofms" || tok == "astms") return Analyzer::TOF;
    if (tok.size() > 2 && tok.compare(tok.size() - 2, 2, "ms") == 0) return Analyzer::OTHER;
    return Analyzer::UNKNOWN;
  }

  Analyzer analyzerFromName(std::string_view name)
  {
    const std::string n = lower(name);
    if (n.empty()) return Analyzer::UNKNOWN;
    if (n.find("orbitrap") != std::string::npos || n.find("fourier transform") != std::string::npos
        || n.find("cyclotron") != std::string::npos || n.find("ft-icr") != std::string::npos)
      return Analyzer::FTMS;
    if (n.find("ion trap") != std::string::npos || n.find("iontrap") != std::string::npos) return Analyzer::ITMS;
    if (n.find("time-of-flight") != std::string::npos || n.find("time of flight") != std::string::npos
        || n == "tof" || n.find("astral") != std::string::npos)
      return Analyzer::TOF;
    return Analyzer::OTHER;
  }

  Analyzer analyzerFromType(MassAnalyzer::AnalyzerType t)
  {
    using T = MassAnalyzer::AnalyzerType;
    switch (t)
    {
      case T::ANALYZERNULL:
      case T::SIZE_OF_ANALYZERTYPE: return Analyzer::UNKNOWN;
      case T::PAULIONTRAP:
      case T::RADIALEJECTIONLINEARIONTRAP:
      case T::AXIALEJECTIONLINEARIONTRAP:
      case T::IT:
      case T::LIT: return Analyzer::ITMS;
      case T::FOURIERTRANSFORM:
      case T::ORBITRAP:
      case T::CYCLOTRON: return Analyzer::FTMS;
      case T::TOF: return Analyzer::TOF;
      default: return Analyzer::OTHER;
    }
  }

  ScanFacts factsOf(const MSSpectrum& s, const InstrumentMap& map)
  {
    ScanFacts f;
    f.valid = true;
    f.ms_level = static_cast<std::uint8_t>(std::min<UInt>(s.getMSLevel(), 255));
    f.rt = s.getRT();
    f.type = s.getType() == SpectrumSettings::SpectrumType::CENTROID ? 1
             : s.getType() == SpectrumSettings::SpectrumType::PROFILE ? 2 : 0;
    const auto& pcs = s.getPrecursors();
    f.n_precursors = static_cast<std::uint16_t>(std::min<std::size_t>(pcs.size(), 65535));
    if (!pcs.empty())
    {
      f.charge = static_cast<std::int16_t>(std::clamp(pcs.front().getCharge(), 0, 32767));
      f.precursor_mz = pcs.front().getMZ();
    }
    if (s.getDriftTimeUnit() == DriftTimeUnit::VSSC && s.getDriftTime() != IMTypes::DRIFTTIME_NOT_SET)
      f.im = static_cast<float>(s.getDriftTime());
    const auto& wins = s.getInstrumentSettings().getScanWindows();
    for (const auto& w : wins)
      if (std::isfinite(w.begin) && (std::isnan(f.scan_low) || w.begin < f.scan_low))
        f.scan_low = static_cast<float>(w.begin);
    double r = positiveMeta(s, "mass resolving power");
    if (std::isnan(r)) r = positiveMeta(s, "mass resolution");
    if (std::isfinite(r)) f.stated_resolution = static_cast<float>(r);

    if (s.metaValueExists("filter string"))
    {
      const Analyzer a = analyzerFromFilter(std::string(s.getMetaValue("filter string").toString()));
      if (a != Analyzer::UNKNOWN)
      {
        f.analyzer = a;
        f.source = Source::FILTER;
        return f;
      }
    }
    for (const auto& acq : s.getAcquisitionInfo())
    {
      if (!acq.metaValueExists("instrument_configuration_ref")) continue;
      const auto it = map.by_config.find(std::string(acq.getMetaValue("instrument_configuration_ref").toString()));
      if (it != map.by_config.end() && it->second != Analyzer::UNKNOWN)
      {
        f.analyzer = it->second;
        f.source = Source::CONFIG;
        return f;
      }
      break;
    }
    if (const auto it = map.by_config.find(map.default_config);
        it != map.by_config.end() && it->second != Analyzer::UNKNOWN)
    {
      f.analyzer = it->second;
      f.source = Source::RUN;
    }
    else if (map.run_default != Analyzer::UNKNOWN)
    {
      f.analyzer = map.run_default;
      f.source = Source::RUN;
    }
    return f;
  }

  // ---- resolution ----------------------------------------------------------

  std::vector<ResolutionPoint> measureResolution(const MSSpectrum& profile, const ResolutionRules& rules)
  {
    std::vector<ResolutionPoint> out;
    if (profile.size() < 5) return out;
    MSSpectrum in = profile;
    in.sortByPosition();
    in.setType(SpectrumSettings::SpectrumType::PROFILE);
    std::vector<double> pos;
    pos.reserve(in.size());
    for (const auto& p : in)
      if (p.getIntensity() > 0 && std::isfinite(p.getIntensity())) pos.push_back(p.getIntensity());
    if (pos.size() < 5) return out;
    const double background = median(std::move(pos));

    PeakPickerHiRes pp;
    Param par = pp.getParameters();
    par.setValue("report_FWHM", "true");
    par.setValue("report_FWHM_unit", "absolute");
    par.setValue("signal_to_noise", 0.0);
    pp.setParameters(par);
    MSSpectrum picked;
    pp.pick(in, picked);
    const MSSpectrum::FloatDataArray* fw = nullptr;
    for (const auto& a : picked.getFloatDataArrays())
      if (a.getName() == "FWHM") fw = &a;
    if (!fw || fw->size() != picked.size()) return out;

    struct Cand { double mz, fwhm, apex; };
    std::vector<Cand> pass;
    for (std::size_t k = 0; k < picked.size(); ++k)
    {
      const double mz = picked[k].getMZ(), w = (*fw)[k], apex = picked[k].getIntensity();
      if (!std::isfinite(w) || w <= 0 || !std::isfinite(mz) || mz <= 0) continue;
      if (!(apex >= rules.min_signal_to_background * background)) continue;
      // Points with signal inside the FWHM: an undersampled peak has too few.
      const auto lo = in.MZBegin(mz - w / 2), hi = in.MZEnd(mz + w / 2);
      int points = 0;
      for (auto it = lo; it != hi; ++it)
        if (it->getIntensity() > 0) ++points;
      if (points < rules.min_points) continue;
      // Isolated: no comparable neighbour within isolation_fwhm FWHM.
      bool isolated = true;
      for (std::size_t j = k; j-- > 0 && mz - picked[j].getMZ() <= rules.isolation_fwhm * w;)
        if (picked[j].getIntensity() >= rules.neighbour_share * apex) { isolated = false; break; }
      for (std::size_t j = k + 1; isolated && j < picked.size() && picked[j].getMZ() - mz <= rules.isolation_fwhm * w; ++j)
        if (picked[j].getIntensity() >= rules.neighbour_share * apex) isolated = false;
      if (!isolated) continue;
      pass.push_back({mz, w, apex});
    }
    std::sort(pass.begin(), pass.end(), [](const Cand& a, const Cand& b) {
      return a.apex != b.apex ? a.apex > b.apex : a.mz < b.mz;
    });
    if (pass.size() > rules.max_peaks) pass.resize(rules.max_peaks);
    std::sort(pass.begin(), pass.end(), [](const Cand& a, const Cand& b) { return a.mz < b.mz; });
    for (const Cand& c : pass) out.push_back({c.mz, c.mz / c.fwhm});
    return out;
  }

  std::size_t bandOf(double mz)
  {
    std::size_t b = 0;
    while (b + 1 < BAND_LOW.size() && mz >= BAND_LOW[b + 1]) ++b;
    return b;
  }

  std::string bandName(std::size_t b)
  {
    const auto i = [](double v) { return std::to_string(static_cast<long>(v)); };
    if (b + 1 >= BAND_LOW.size()) return "mz" + i(BAND_LOW.back()) + "+";
    return "mz" + i(BAND_LOW[b]) + "-" + i(BAND_LOW[b + 1]);
  }

  std::vector<std::size_t> profileSamples(const std::vector<ScanFacts>& facts, std::size_t per_class)
  {
    std::map<std::pair<int, int>, std::vector<std::size_t>> by_class;
    for (std::size_t i = 0; i < facts.size(); ++i)
    {
      const ScanFacts& f = facts[i];
      if (!f.valid || f.type == 1 || f.ms_level == 0) continue;
      by_class[{static_cast<int>(f.analyzer), f.ms_level}].push_back(i);
    }
    std::vector<std::size_t> out;
    for (const auto& [k, idx] : by_class)
    {
      const std::size_t g = idx.size();
      if (g <= per_class)
      {
        out.insert(out.end(), idx.begin(), idx.end());
        continue;
      }
      for (std::size_t j = 0; j < per_class; ++j)
        out.push_back(idx[static_cast<std::size_t>((static_cast<double>(j) + 0.5) * static_cast<double>(g)
                                                   / static_cast<double>(per_class))]);
    }
    std::sort(out.begin(), out.end());
    out.erase(std::unique(out.begin(), out.end()), out.end());
    return out;
  }

  // ---- isobaric reporters --------------------------------------------------

  ReporterTable::ReporterTable()
  {
    std::vector<std::unique_ptr<IsobaricQuantitationMethod>> methods;
    methods.emplace_back(std::make_unique<TMTSixPlexQuantitationMethod>());
    methods.emplace_back(std::make_unique<TMTTenPlexQuantitationMethod>());
    methods.emplace_back(std::make_unique<TMTElevenPlexQuantitationMethod>());
    methods.emplace_back(std::make_unique<TMTSixteenPlexQuantitationMethod>());
    methods.emplace_back(std::make_unique<TMTEighteenPlexQuantitationMethod>());
    methods.emplace_back(std::make_unique<ItraqFourPlexQuantitationMethod>());
    methods.emplace_back(std::make_unique<ItraqEightPlexQuantitationMethod>());
    family_low = {std::numeric_limits<double>::infinity(), std::numeric_limits<double>::infinity()};
    family_high = {0.0, 0.0};
    for (const auto& m : methods)
    {
      Kit kit;
      kit.name = m->getMethodName();
      kit.family = kit.name.rfind("itraq", 0) == 0 ? 1 : 0;
      for (const auto& ch : m->getChannelInformation())
      {
        const double c = ch.center;
        std::size_t k = 0;
        while (k < mz.size() && std::fabs(mz[k] - c) > 1e-4) ++k;
        if (k == mz.size())
        {
          mz.push_back(c);
          label.push_back(ch.name);
          family.push_back(kit.family);
        }
        else
          label[k] = ch.name;  // the larger kit's (later) name: 127N rather than 127
        kit.channels |= 1u << k;
        family_mask[kit.family] |= 1u << k;
        family_low[kit.family] = std::min(family_low[kit.family], c);
        family_high[kit.family] = std::max(family_high[kit.family], c);
      }
      kits.push_back(std::move(kit));
    }
  }

  const char* ReporterTable::familyName(std::size_t f) { return f == 0 ? "TMT" : "iTRAQ"; }

  std::uint32_t reportersSeen(const MSSpectrum& s, const ReporterTable& t)
  {
    std::vector<double> pos;
    pos.reserve(s.size());
    for (const auto& p : s)
      if (p.getIntensity() > 0 && std::isfinite(p.getIntensity())) pos.push_back(p.getIntensity());
    if (pos.empty()) return 0;
    const double bg = median(std::move(pos));
    const double lo = std::min(t.family_low[0], t.family_low[1]) - 1.0;
    const double hi = std::max(t.family_high[0], t.family_high[1]) + 1.0;
    std::vector<double> best(t.mz.size(), 0.0);
    for (const auto& p : s)
    {
      const double m = p.getMZ();
      if (m < lo || m > hi || !(p.getIntensity() > 0)) continue;
      for (std::size_t c = 0; c < t.mz.size(); ++c)
        if (std::fabs(m - t.mz[c]) <= t.mz[c] * REPORTER_TOL_PPM * 1e-6)
          best[c] = std::max(best[c], static_cast<double>(p.getIntensity()));
    }
    std::uint32_t mask = 0;
    for (std::size_t c = 0; c < t.mz.size(); ++c)
      if (best[c] > 0 && best[c] >= REPORTER_MIN_SB * bg) mask |= 1u << c;
    return mask;
  }

  Assess assessReporters(const ScanFacts& f, double lowest_peak, const ReporterTable& t, std::size_t family)
  {
    if (!std::isfinite(lowest_peak)) return Assess::NO_PEAKS;
    const double low = std::isfinite(f.scan_low) ? static_cast<double>(f.scan_low) : lowest_peak;
    if (low > t.family_low[family] - 0.5) return Assess::LOW_MASS_CUTOFF;
    if (f.analyzer == Analyzer::ITMS) return Assess::ION_TRAP;
    return Assess::OK;
  }

  void ReporterTally::merge(const ReporterTally& o)
  {
    for (std::size_t f = 0; f < FAMILY_COUNT; ++f)
      for (std::size_t a = 0; a < ASSESS_COUNT; ++a) by_assess[f][a] += o.by_assess[f][a];
    if (seen.size() < o.seen.size()) seen.resize(o.seen.size(), 0);
    for (std::size_t c = 0; c < o.seen.size(); ++c) seen[c] += o.seen[c];
  }

  ReporterCall callReporters(const ReporterTally& t, const ReporterTable& table, std::uint64_t n_ms3)
  {
    ReporterCall call;
    std::array<std::string, FAMILY_COUNT> state, reason;
    for (std::size_t f = 0; f < FAMILY_COUNT; ++f)
    {
      const auto& by = t.by_assess[f];
      const std::uint64_t ok = by[static_cast<std::size_t>(Assess::OK)];
      std::uint64_t total = 0;
      for (const auto v : by) total += v;
      for (std::size_t c = 0; c < table.mz.size(); ++c)
        if (table.family[c] == f && ok > 0 && c < t.seen.size()
            && static_cast<double>(t.seen[c]) >= REPORTER_MIN_SHARE * static_cast<double>(ok))
          call.observed[f] |= 1u << c;
      if (ok < REPORTER_MIN_ASSESSABLE)
      {
        state[f] = "not_assessable";
        if (total == 0) reason[f] = "no_ms2";
        else
        {
          // The most frequent reason, the first of equals.
          std::size_t worst = 0;
          for (std::size_t a = 1; a < ASSESS_COUNT; ++a)
            if (by[a] > 0 && (worst == 0 || by[a] > by[worst])) worst = a;
          reason[f] = worst == 0 || by[worst] < ok ? "too_few_assessable_ms2" : assessName(static_cast<Assess>(worst));
        }
        continue;
      }
      const bool present = static_cast<std::size_t>(std::popcount(call.observed[f])) >= REPORTER_MIN_CHANNELS;
      if (!present && n_ms3 > 0)
      {
        state[f] = "not_assessable";
        reason[f] = "sps_ms3_not_read";
        continue;
      }
      state[f] = present ? "present" : "absent";
    }
    for (const auto& kit : table.kits)
    {
      KitCall kc;
      const std::size_t f = kit.family;
      if (state[f] == "not_assessable") kc = {"not_assessable", reason[f]};
      else if (state[f] == "present" && (call.observed[f] & ~kit.channels) == 0) kc = {"present", "-"};
      else kc = {"absent", "-"};
      if (kc.state == "present") call.compatible.push_back(kit.name);
      call.kits.push_back(kc);
    }
    return call;
  }

  // ---- redundancy ----------------------------------------------------------

  Fingerprint fingerprint(const MSSpectrum& s, double precursor_mz, int charge, const ReporterTable& table,
                          double tol, bool tol_ppm, std::size_t top_peaks)
  {
    const double H = Constants::PROTON_MASS_U;
    std::vector<double> remove(table.mz.begin(), table.mz.end());
    remove.insert(remove.end(), IMMONIUM.begin(), IMMONIUM.end());
    if (precursor_mz > 0)
    {
      const std::vector<int> zs = charge > 0 ? std::vector<int>{charge} : std::vector<int>{2, 3};
      for (const int z : zs)
      {
        const double M = (precursor_mz - H) * z;
        for (int zz = 1; zz <= z; ++zz)
        {
          const double m = (M + zz * H) / zz;
          for (const double d : {0.0, -H2O, -NH3, C13}) remove.push_back(m + d / zz);
        }
      }
    }
    std::sort(remove.begin(), remove.end());
    const auto near_removed = [&](double m) {
      const double w = tol_ppm ? m * tol * 1e-6 : tol;
      const auto it = std::lower_bound(remove.begin(), remove.end(), m - w);
      return it != remove.end() && *it <= m + w;
    };
    std::vector<std::pair<double, double>> pk;  // intensity, m/z
    pk.reserve(s.size());
    for (const auto& p : s)
    {
      const double m = p.getMZ(), in = p.getIntensity();
      if (!(in > 0) || !std::isfinite(in) || !std::isfinite(m) || m <= 0) continue;
      if (near_removed(m)) continue;
      pk.emplace_back(in, m);
    }
    std::sort(pk.begin(), pk.end(), [](const auto& a, const auto& b) {
      return a.first != b.first ? a.first > b.first : a.second < b.second;
    });
    if (pk.size() > top_peaks) pk.resize(top_peaks);
    std::map<std::uint32_t, double> bins;
    for (const auto& [in, m] : pk) bins[static_cast<std::uint32_t>(std::lround(m / BIN_WIDTH))] += std::sqrt(in);
    double norm = 0;
    for (const auto& [b, w] : bins) norm += w * w;
    norm = std::sqrt(norm);
    Fingerprint fp;
    fp.reserve(bins.size());
    if (norm > 0)
      for (const auto& [b, w] : bins) fp.emplace_back(b, static_cast<float>(w / norm));
    return fp;
  }

  double cosine(const Fingerprint& a, const Fingerprint& b, std::size_t& matched)
  {
    matched = 0;
    double dot = 0;
    for (std::size_t i = 0, j = 0; i < a.size() && j < b.size();)
    {
      if (a[i].first < b[j].first) ++i;
      else if (b[j].first < a[i].first) ++j;
      else
      {
        dot += static_cast<double>(a[i].second) * static_cast<double>(b[j].second);
        ++matched;
        ++i;
        ++j;
      }
    }
    return dot;
  }

  RedundancyResult cluster(const std::vector<RedundancyRecord>& recs, const RedundancyRules& R, bool by_tag)
  {
    RedundancyResult res;
    const std::size_t n = recs.size();
    res.spectra = n;
    res.cluster_of.assign(n, 0);
    // Candidate pairs in (charge, m/z, index) order.
    std::vector<std::uint32_t> ord(n);
    std::iota(ord.begin(), ord.end(), 0u);
    std::sort(ord.begin(), ord.end(), [&](std::uint32_t a, std::uint32_t b) {
      const auto& A = recs[a];
      const auto& B = recs[b];
      if (A.charge != B.charge) return A.charge < B.charge;
      if (A.mz != B.mz) return A.mz < B.mz;
      return A.index < B.index;
    });
    struct Edge
    {
      std::uint32_t a, b;
      float sim;
    };
    std::vector<Edge> edges;
    for (std::size_t x = 0; x < n; ++x)
    {
      const RedundancyRecord& A = recs[ord[x]];
      if (by_tag && !A.tagged) continue;
      const double lim = A.mz + A.mz * R.precursor_ppm * 1e-6;
      for (std::size_t y = x + 1; y < n; ++y)
      {
        const RedundancyRecord& B = recs[ord[y]];
        if (B.charge != A.charge || B.mz > lim) break;
        if (by_tag && !B.tagged) continue;
        if (std::fabs(A.rt - B.rt) > R.rt_span) continue;
        const bool ai = std::isnan(A.im), bi = std::isnan(B.im);
        if (ai != bi || (!ai && std::fabs(A.im - B.im) > R.im_window)) continue;
        ++res.pairs_compared;
        float sim = 1.0f;
        if (by_tag)
        {
          if (A.tag != B.tag) continue;
        }
        else
        {
          std::size_t matched = 0;
          const double c = cosine(A.fp, B.fp, matched);
          if (matched < R.min_matched || c < R.min_cosine) continue;
          sim = static_cast<float>(c);
        }
        ++res.links;
        edges.push_back({std::min(ord[x], ord[y]), std::max(ord[x], ord[y]), sim});
      }
    }
    // Linked groups (union-find), each clustered on its own.
    std::vector<std::uint32_t> parent(n);
    std::iota(parent.begin(), parent.end(), 0u);
    const auto find = [&](std::uint32_t v) {
      while (parent[v] != v) v = parent[v] = parent[parent[v]];
      return v;
    };
    for (const Edge& e : edges)
    {
      const std::uint32_t ra = find(e.a), rb = find(e.b);
      if (ra != rb) parent[std::max(ra, rb)] = std::min(ra, rb);
    }
    std::map<std::uint32_t, std::vector<std::uint32_t>> groups;  // root (lowest record) -> members, ascending
    for (std::uint32_t v = 0; v < n; ++v) groups[find(v)].push_back(v);
    std::map<std::uint32_t, std::vector<const Edge*>> group_edges;
    for (const Edge& e : edges) group_edges[find(e.a)].push_back(&e);

    std::uint32_t next_id = 0;
    std::vector<std::uint32_t> local(n, 0);
    for (auto& [root, members] : groups)
    {
      if (members.size() == 1)
      {
        res.cluster_of[members[0]] = next_id++;
        continue;
      }
      std::vector<std::vector<std::uint32_t>> pieces;
      if (members.size() > R.max_component)
      {
        ++res.components_split;
        std::vector<std::uint32_t> by_rt = members;
        std::sort(by_rt.begin(), by_rt.end(), [&](std::uint32_t a, std::uint32_t b) {
          return recs[a].rt != recs[b].rt ? recs[a].rt < recs[b].rt : a < b;
        });
        for (std::size_t k = 0; k < by_rt.size(); k += R.max_component)
        {
          std::vector<std::uint32_t> p(by_rt.begin() + static_cast<std::ptrdiff_t>(k),
                                       by_rt.begin() + static_cast<std::ptrdiff_t>(std::min(by_rt.size(), k + R.max_component)));
          std::sort(p.begin(), p.end());
          pieces.push_back(std::move(p));
        }
      }
      else
        pieces.push_back(members);
      for (const auto& piece : pieces)
      {
        const std::size_t m = piece.size();
        for (std::size_t k = 0; k < m; ++k) local[piece[k]] = static_cast<std::uint32_t>(k) + 1;  // 0 = not here
        std::vector<float> S(m * m, -1.0f);
        for (const Edge* e : group_edges[root])
        {
          const std::uint32_t la = local[e->a], lb = local[e->b];
          if (la == 0 || lb == 0) continue;
          S[(la - 1) * m + (lb - 1)] = S[(lb - 1) * m + (la - 1)] = e->sim;
        }
        std::vector<std::vector<std::uint32_t>> mem(m);
        std::vector<double> rlo(m), rhi(m);
        std::vector<char> alive(m, 1);
        for (std::size_t k = 0; k < m; ++k)
        {
          mem[k] = {static_cast<std::uint32_t>(k)};
          rlo[k] = rhi[k] = recs[piece[k]].rt;
        }
        for (;;)
        {
          float best = -1.0f;
          std::size_t ba = 0, bb = 0;
          for (std::size_t a = 0; a < m; ++a)
          {
            if (!alive[a]) continue;
            for (std::size_t b = a + 1; b < m; ++b)
            {
              if (!alive[b]) continue;
              const float s = S[a * m + b];
              if (s <= best || s < 0) continue;
              if (std::max(rhi[a], rhi[b]) - std::min(rlo[a], rlo[b]) > R.rt_span) continue;
              best = s;
              ba = a;
              bb = b;
            }
          }
          if (best < 0) break;
          for (std::size_t k = 0; k < m; ++k)
          {
            if (!alive[k] || k == ba || k == bb) continue;
            const float s1 = S[ba * m + k], s2 = S[bb * m + k];
            const float v = (s1 < 0 || s2 < 0) ? -1.0f : std::min(s1, s2);
            S[ba * m + k] = S[k * m + ba] = v;
          }
          mem[ba].insert(mem[ba].end(), mem[bb].begin(), mem[bb].end());
          rlo[ba] = std::min(rlo[ba], rlo[bb]);
          rhi[ba] = std::max(rhi[ba], rhi[bb]);
          alive[bb] = 0;
        }
        for (std::size_t a = 0; a < m; ++a)
        {
          if (!alive[a]) continue;
          const std::uint32_t id = next_id++;
          for (const std::uint32_t k : mem[a]) res.cluster_of[piece[k]] = id;
          if (mem[a].size() > 1)
          {
            ++res.clusters;
            res.in_clusters += mem[a].size();
            res.largest = std::max<std::uint64_t>(res.largest, mem[a].size());
          }
        }
        for (const std::uint32_t v : piece) local[v] = 0;
      }
    }
    return res;
  }

  // ---- the run --------------------------------------------------------------

  Collector::Collector(std::size_t n_total, InstrumentMap map, std::size_t threads, double frag_tol, bool tol_ppm)
    : map_(std::move(map)), frag_tol_(frag_tol), tol_ppm_(tol_ppm), facts_(n_total), threads_(std::max<std::size_t>(1, threads))
  {
    for (Thread& t : threads_) t.reporters.seen.assign(table_.mz.size(), 0);
    reporters_.seen.assign(table_.mz.size(), 0);
  }

  void Collector::scan(std::size_t, std::size_t index, const MSSpectrum& s)
  {
    if (index < facts_.size()) facts_[index] = factsOf(s, map_);
  }

  void Collector::ms2(std::size_t tid, std::size_t index, const MSSpectrum& s, double best_evalue,
                      const std::string& best_tag)
  {
    if (index >= facts_.size()) return;
    Thread& t = threads_[tid];
    const ScanFacts& f = facts_[index];
    ++t.ms2_read;
    const bool tagged = best_evalue <= TAG_EVALUE;
    if (tagged) ++t.ms2_tagged;
    double lowest = std::numeric_limits<double>::quiet_NaN();
    for (const auto& p : s)
      if (p.getIntensity() > 0 && std::isfinite(p.getMZ()) && !(p.getMZ() >= lowest)) lowest = p.getMZ();
    std::uint32_t seen = 0;
    bool seen_done = false;
    for (std::size_t fam = 0; fam < FAMILY_COUNT; ++fam)
    {
      const Assess a = assessReporters(f, lowest, table_, fam);
      ++t.reporters.by_assess[fam][static_cast<std::size_t>(a)];
      if (a != Assess::OK) continue;
      if (!seen_done)
      {
        seen = reportersSeen(s, table_);
        seen_done = true;
      }
      const std::uint32_t mine = seen & table_.family_mask[fam];
      for (std::size_t c = 0; c < table_.mz.size(); ++c)
        if (mine & (1u << c)) ++t.reporters.seen[c];
    }
    if (s.empty() || s.getPrecursors().empty()) return;
    RedundancyRecord r;
    r.index = index;
    r.mz = s.getPrecursors().front().getMZ();
    r.rt = s.getRT();
    r.im = f.im;
    r.charge = std::max(0, s.getPrecursors().front().getCharge());
    r.tagged = tagged;
    if (tagged) r.tag = best_tag;
    r.fp = fingerprint(s, r.mz, r.charge, table_, frag_tol_, tol_ppm_, RedundancyRules{}.top_peaks);
    t.records.push_back(std::move(r));
  }

  void Collector::finish()
  {
    for (Thread& t : threads_)
    {
      reporters_.merge(t.reporters);
      ms2_read_ += t.ms2_read;
      ms2_tagged_ += t.ms2_tagged;
      for (auto& r : t.records) records_.push_back(std::move(r));
      t = Thread{};
    }
    std::sort(records_.begin(), records_.end(),
              [](const RedundancyRecord& a, const RedundancyRecord& b) { return a.index < b.index; });
  }

  std::vector<std::size_t> Collector::profileSamples() const { return RunQC::profileSamples(facts_, PROFILE_SAMPLES); }

  void Collector::profile(std::size_t index, const MSSpectrum& s)
  {
    if (index >= facts_.size() || !facts_[index].valid) return;
    const ScanFacts& f = facts_[index];
    const std::pair<int, int> key{static_cast<int>(f.analyzer), f.ms_level};
    if (f.type != 2 && PeakTypeEstimator::estimateType(s.begin(), s.end()) != SpectrumSettings::SpectrumType::PROFILE)
    {
      ++sampled_centroid_[key];
      return;
    }
    ++measured_spectra_[key];
    auto& bands = measured_[key];
    for (const ResolutionPoint& p : measureResolution(s)) bands[bandOf(p.mz)].push_back(p.resolution);
  }

  std::vector<Digest::Row> Collector::rows(bool subsampled) const
  {
    using Digest::num;
    const std::string sec = "qc";
    std::vector<Digest::Row> r;
    r.push_back({sec, "qc_version", std::to_string(QC_VERSION), "-",
                 "The qc section follows format " + std::to_string(QC_VERSION) + "."});
    std::uint64_t read = 0;
    std::map<int, std::uint64_t> by_level;
    std::map<std::pair<int, int>, std::uint64_t> by_class;  // (level, analyser)
    std::array<std::uint64_t, SOURCE_COUNT> by_source{};
    std::map<int, std::uint64_t> charges;
    std::uint64_t ms2 = 0, sps = 0;
    std::map<std::pair<int, int>, std::vector<double>> stated;  // (analyser, level)
    std::map<std::pair<int, int>, std::array<std::uint64_t, 3>> types;  // unknown, centroid, profile
    for (const ScanFacts& f : facts_)
    {
      if (!f.valid) continue;
      ++read;
      ++by_level[f.ms_level];
      ++by_class[{f.ms_level, static_cast<int>(f.analyzer)}];
      ++by_source[static_cast<std::size_t>(f.source)];
      ++types[{static_cast<int>(f.analyzer), f.ms_level}][f.type];
      if (std::isfinite(f.stated_resolution))
        stated[{static_cast<int>(f.analyzer), f.ms_level}].push_back(f.stated_resolution);
      if (f.ms_level == 2)
      {
        ++ms2;
        ++charges[f.charge];
      }
      if (f.ms_level >= 3 && f.n_precursors > 1) ++sps;
    }
    const std::string total = num(static_cast<std::uint64_t>(facts_.size()));
    r.push_back({sec, "spectra_input", total, "-", total + " spectra in the input."});
    r.push_back({sec, "spectra_read", num(read), total,
                 subsampled ? "Spectra read (subsampled: every count below covers these only)."
                            : "Spectra read: every spectrum of the input."});
    r.push_back({sec, "subsampled", subsampled ? "1" : "0", "-",
                 subsampled ? "The spectra were subsampled." : "Every spectrum was read."});

    // ---- counts ----
    if (!by_level.count(1)) by_level[1] = 0;
    if (!by_level.count(2)) by_level[2] = 0;
    for (const auto& [lv, c] : by_level)
    {
      const std::string L = "ms" + std::to_string(lv);
      r.push_back({sec, "count_" + L, num(c), num(read),
                   num(c) + " spectra of MS level " + std::to_string(lv) + " (metadata only; peaks are not needed)."});
      for (std::size_t a = 0; a < ANALYZER_COUNT; ++a)
      {
        const auto it = by_class.find({lv, static_cast<int>(a)});
        if (it == by_class.end()) continue;
        const char* an = analyzerName(static_cast<Analyzer>(a));
        r.push_back({sec, "count_" + L + "_" + an, num(it->second), num(c),
                     num(it->second) + " MS" + std::to_string(lv) + " spectra read out in analyser class " + an + "."});
      }
    }
    for (std::size_t s = 0; s < SOURCE_COUNT; ++s)
    {
      const char* sn = sourceName(static_cast<Source>(s));
      static const char* const WHAT[] = {"the Thermo filter string", "the instrument configuration the scan references",
                                         "the run's default instrument configuration", "nothing (class unknown)"};
      r.push_back({sec, std::string("analyzer_source_") + sn, num(by_source[s]), num(read),
                   "Spectra whose analyser class came from " + std::string(WHAT[s]) + "."});
    }
    r.push_back({sec, "sps_ms3", num(sps), num(by_level.count(3) ? by_level.at(3) : 0),
                 "MS3 spectra with more than one precursor (synchronous precursor selection)."});

    // ---- resolution ----
    for (const auto& [key, tcount] : types)
    {
      const auto [a, lv] = key;
      if (lv == 0) continue;
      const std::string cls = std::string(analyzerName(static_cast<Analyzer>(a))) + "_ms" + std::to_string(lv);
      const std::uint64_t n_cls = tcount[0] + tcount[1] + tcount[2];
      const auto st = stated.find(key);
      double stated_med = std::numeric_limits<double>::quiet_NaN();
      if (st != stated.end())
      {
        stated_med = median(st->second);
        r.push_back({sec, "resolution_stated_" + cls, whole(stated_med), num(static_cast<std::uint64_t>(st->second.size())),
                     "The median resolving power the file states for " + cls + " spectra (as the vendor defines it, "
                     "usually at a reference m/z)."});
      }
      else
        r.push_back({sec, "resolution_stated_" + cls, "n/a", num(n_cls), "The file states no resolving power for " + cls + " spectra."});
      // Measured.
      const auto mi = measured_.find(key);
      std::vector<double> all;
      if (mi != measured_.end())
        for (std::size_t b = 0; b < BAND_LOW.size(); ++b)
        {
          const auto& v = mi->second[b];
          if (v.empty()) continue;
          all.insert(all.end(), v.begin(), v.end());
          r.push_back({sec, "resolution_measured_" + cls + "_" + bandName(b), whole(median(v)),
                       num(static_cast<std::uint64_t>(v.size())),
                       "The median m/z / FWHM of the isolated peaks of " + bandName(b) + " in the profile " + cls +
                           " spectra sampled (n = peaks)."});
        }
      std::string why;
      if (all.empty())
      {
        const auto ms = measured_spectra_.find(key);
        const std::uint64_t measured_n = ms == measured_spectra_.end() ? 0 : ms->second;
        if (!profile_unavailable_.empty()) why = profile_unavailable_;
        else if (tcount[2] == 0 && measured_n == 0) why = "centroid_only";
        else why = "no_qualifying_peaks";
        r.push_back({sec, "resolution_measured_" + cls, "n/a", "-",
                     "Not measured: " + why + " (centroid_only: the class has centroided spectra only)."});
      }
      const bool have_stated = std::isfinite(stated_med);
      r.push_back({sec, "resolution_source_" + cls, have_stated ? "stated" : !all.empty() ? "measured" : "n/a", "-",
                   "Where resolution_" + cls + " comes from: stated by the file, else measured on profile spectra."});
      r.push_back({sec, "resolution_" + cls, have_stated ? whole(stated_med) : !all.empty() ? whole(median(all)) : "n/a",
                   "-", "The resolution of " + cls + " spectra: the stated value, else the median measured over every m/z band."});
    }

    // ---- precursor charge ----
    if (!charges.count(0)) charges[0] = 0;
    for (const auto& [z, c] : charges)
    {
      const std::string zs = std::to_string(z);
      r.push_back({sec, "precursor_charge_" + zs, num(c), num(ms2),
                   z == 0 ? "MS2 spectra with no precursor charge given (unknown)." : "MS2 spectra with precursor charge " + zs + "."});
      r.push_back({sec, "precursor_charge_" + zs + "_share", share(c, ms2), num(ms2),
                   "The share of the MS2 spectra with precursor charge " + zs + "."});
    }

    // ---- reporters ----
    std::uint64_t n_ms3 = by_level.count(3) ? by_level.at(3) : 0;
    const ReporterCall call = callReporters(reporters_, table_, n_ms3);
    for (std::size_t f = 0; f < FAMILY_COUNT; ++f)
    {
      const std::string fam = ReporterTable::familyName(f);
      std::uint64_t tot = 0;
      for (const auto v : reporters_.by_assess[f]) tot += v;
      const std::uint64_t ok = reporters_.by_assess[f][static_cast<std::size_t>(Assess::OK)];
      r.push_back({sec, "reporter_assessable_" + fam, num(ok), num(tot),
                   "MS2 spectra that can show " + fam + " reporters (high-resolution analyser, the reporter range "
                   "inside the scan)."});
      for (std::size_t a = 1; a < ASSESS_COUNT; ++a)
        r.push_back({sec, "reporter_" + fam + "_" + assessName(static_cast<Assess>(a)),
                     num(reporters_.by_assess[f][a]), num(tot), "MS2 spectra not assessable for " + fam + ": " +
                         assessName(static_cast<Assess>(a)) + "."});
      std::string obs;
      for (std::size_t c = 0; c < table_.mz.size(); ++c)
        if (call.observed[f] & (1u << c))
          obs += (obs.empty() ? "" : ",") + table_.label[c] + ":" + share(reporters_.seen[c], ok);
      r.push_back({sec, "reporter_observed_" + fam, obs.empty() ? "none" : obs, num(ok),
                   "Channels seen (within " + whole(REPORTER_TOL_PPM) + " ppm, at least 3x the median peak) in at "
                   "least 20% of the assessable MS2, with that share."});
    }
    for (std::size_t k = 0; k < table_.kits.size(); ++k)
    {
      const auto& kit = table_.kits[k];
      const KitCall& kc = call.kits[k];
      r.push_back({sec, "reporter_" + kit.name, kc.state, num(reporters_.by_assess[kit.family][0]),
                   kc.state == "not_assessable" ? "Not assessable: " + kc.reason + "."
                   : kc.state == "present" ? "Present: every observed channel of the family is one of the kit's."
                                           : "Absent."});
    }
    std::string compat;
    for (const auto& c : call.compatible) compat += (compat.empty() ? "" : ",") + c;
    r.push_back({sec, "reporter_compatible_kits", compat.empty() ? "none" : compat, "-",
                 "Kits compatible with the observed reporters, smallest first; several when the channels do not decide."});

    // ---- tag yield ----
    r.push_back({sec, "ms2_tagged_e001", num(ms2_tagged_), num(ms2_read_),
                 "MS2 spectra whose best reported tag has E <= 0.01 (the census best tag)."});
    r.push_back({sec, "tag_yield", share(ms2_tagged_, ms2_read_), num(ms2_read_),
                 "The share of the MS2 spectra read with a tag at E <= 0.01."});

    // ---- redundancy ----
    const RedundancyRules rules;
    for (const bool by_tag : {false, true})
    {
      const RedundancyResult cr = cluster(records_, rules, by_tag);
      const std::string p = by_tag ? "redundancy_tag_" : "redundancy_";
      const std::string what = by_tag ? "the same best tag (E <= 0.01)" : "binned cosine >= 0.8 over >= 6 bins";
      if (!by_tag)
        r.push_back({sec, "redundancy_ms2", num(cr.spectra), num(ms2_read_),
                     "MS2 spectra with peaks and a precursor, clustered for redundancy."});
      r.push_back({sec, p + "share", share(cr.in_clusters, cr.spectra), num(cr.spectra),
                   "The share of those MS2 in clusters of size > 1 (same charge, precursor within 10 ppm, RT span "
                   "<= 60 s, 1/K0 within 0.02, " + what + "; complete linkage)."});
      r.push_back({sec, p + "clusters", num(cr.clusters), num(cr.spectra), "Clusters of size > 1."});
      r.push_back({sec, p + "largest", num(cr.largest), num(cr.spectra), "The largest cluster."});
      r.push_back({sec, p + "pairs_compared", num(cr.pairs_compared), "-",
                   "Pairs inside the precursor, charge, RT and mobility windows that were compared."});
      r.push_back({sec, p + "components_split", num(cr.components_split), "-",
                   "Linked groups larger than " + num(static_cast<std::uint64_t>(rules.max_component)) +
                       " spectra, clustered in RT chunks of that size (bounds time and memory)."});
    }
    return r;
  }
}
