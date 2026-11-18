// Stage 1 of the Thermo .raw acceptance: the spectra FASTag reads from a .raw
// (src/ThermoInput.h, vendor centroiding) against a pinned reference conversion
// of the same file (ThermoRawFileParser 2.0, centroided: -f=2, default peak
// picking), spectrum by spectrum, matched by native ID.
//
//   thermo_parity <run.raw> <reference.mzML> [<report.tsv>]
//
// Exit 0: every check within its tolerance; 1: a check failed (the report
// names how many spectra and the first examples); 2: usage or read error;
// 77: this build has no Thermo support (ctest SKIP_RETURN_CODE).
//
// PREREGISTERED TOLERANCES (fixed in this file before any .raw was compared
// with its reference; FASTag 1.16, item 3). A check passes only if EVERY
// matched spectrum is within them:
//
//   counts      spectra per MS level: equal
//   native IDs  the same set ("controllerType=0 controllerNumber=1 scan=N"),
//               in the same order
//   RT          |dRT| <= 0.01 s
//   MS level    equal
//   precursor   same number of precursors; selected-ion m/z within 1 ppm;
//               charge equal (0 = unknown on either side counts as a value)
//   filter      Thermo filter string equal, where the reference has one
//   peaks       non-empty MS2 in both or in neither; same peak count;
//               m/z relative difference <= 1e-6 (1 ppm) per peak; intensity
//               relative difference <= 1e-6 (the reference stores 32-bit
//               intensities: a few float32 ulp)
//   non-empty   at least one MS2 with peaks is compared
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "ThermoInput.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

using namespace OpenMS;

namespace
{
  constexpr double RT_TOL_S = 0.01;
  constexpr double PREC_MZ_PPM = 1.0;
  constexpr double PEAK_MZ_REL = 1e-6;
  constexpr double PEAK_INT_REL = 1e-6;

  struct Check
  {
    std::string name;
    size_t compared = 0, failed = 0;
    double worst = 0;
    std::vector<std::string> examples;
    void fail(const std::string& what)
    {
      ++failed;
      if (examples.size() < 5) examples.push_back(what);
    }
  };

  std::string filterOf(const MSSpectrum& s)
  {
    if (s.metaValueExists("filter string")) return s.getMetaValue("filter string").toString();
    for (const auto& a : s.getAcquisitionInfo())
      if (a.metaValueExists("filter string")) return a.getMetaValue("filter string").toString();
    return {};
  }

  double rel(double a, double b)
  {
    const double d = std::fabs(a - b), m = std::max(std::fabs(a), std::fabs(b));
    return m > 0 ? d / m : 0.0;
  }
}

int main(int argc, char** argv)
{
  if (argc < 3)
  {
    std::cerr << "usage: thermo_parity <run.raw> <reference.mzML> [<report.tsv>]\n";
    return 2;
  }
  if (!FASTag::Thermo::supported())
  {
    std::cerr << "thermo_parity: this build has no Thermo support (WITH_THERMO_RAW); skipped\n";
    return 77;
  }
  const std::string raw = argv[1], ref_path = argv[2];
  std::unique_ptr<IMSExperimentRandomAccess> r;
  PeakMap ref;
  try
  {
    r = FASTag::Thermo::open(raw, FASTag::Thermo::Representation::CENTROID);
    MzMLFile().load(ref_path, ref);
  }
  catch (const Exception::BaseException& e)
  {
    std::cerr << "thermo_parity: " << e.what() << "\n";
    return 2;
  }

  std::map<std::string, Size> ref_by_id;
  for (Size i = 0; i < ref.size(); ++i) ref_by_id[ref[i].getNativeID()] = i;

  Check counts{"counts_per_level"}, ids{"native_ids"}, order{"native_id_order"}, rt{"rt"}, lvl{"ms_level"},
      nprec{"precursor_count"}, pmz{"precursor_mz"}, pz{"precursor_charge"}, filt{"filter_string"},
      empty{"nonempty_ms2"}, npk1{"peak_count_ms1"}, npk2{"peak_count_msn"}, pkmz{"peak_mz"}, pkint{"peak_intensity"};
  std::map<UInt, size_t> lv_raw, lv_ref;
  for (const MSSpectrum& s : ref) ++lv_ref[s.getMSLevel()];
  size_t ms2_with_peaks = 0, raw_charge_unknown = 0, ref_charge_unknown = 0;
  size_t raw_only_total = 0, ref_only_total = 0, matched_peaks = 0;
  std::map<long, size_t> raw_only, ref_only;  // unmatched peaks by m/z x 100
  std::map<std::pair<UInt, long long>, size_t> resolving;  // (MS level, stated resolving power or 0) -> spectra
  Size last_ref = 0;
  bool first = true;
  const Size n = r->getNrSpectra();
  for (Size i = 0; i < n; ++i)
  {
    const MSSpectrum a = r->getSpectrum(i);
    ++lv_raw[a.getMSLevel()];
    // Vendor-stated resolving power (for the run QC), by MS level and value.
    if (const auto rp = FASTag::Thermo::massResolvingPower(a)) ++resolving[{a.getMSLevel(), *rp}];
    else ++resolving[{a.getMSLevel(), 0}];
    ++ids.compared;
    const auto it = ref_by_id.find(a.getNativeID());
    if (it == ref_by_id.end())
    {
      ids.fail("raw only: " + a.getNativeID());
      continue;
    }
    const MSSpectrum& b = ref[it->second];
    ++order.compared;
    if (!first && it->second <= last_ref) order.fail("out of order: " + a.getNativeID());
    first = false;
    last_ref = it->second;

    ++rt.compared;
    const double drt = std::fabs(a.getRT() - b.getRT());
    rt.worst = std::max(rt.worst, drt);
    if (drt > RT_TOL_S) rt.fail(a.getNativeID() + " dRT=" + std::to_string(drt));
    ++lvl.compared;
    if (a.getMSLevel() != b.getMSLevel()) lvl.fail(a.getNativeID());

    const std::string fb = filterOf(b);
    if (!fb.empty())
    {
      ++filt.compared;
      if (filterOf(a) != fb) filt.fail(a.getNativeID() + " '" + filterOf(a) + "' vs '" + fb + "'");
    }

    ++nprec.compared;
    if (a.getPrecursors().size() != b.getPrecursors().size())
      nprec.fail(a.getNativeID());
    else
      for (Size k = 0; k < a.getPrecursors().size(); ++k)
      {
        const Precursor &pa = a.getPrecursors()[k], &pb = b.getPrecursors()[k];
        ++pmz.compared;
        const double ppm = pb.getMZ() > 0 ? std::fabs(pa.getMZ() - pb.getMZ()) / pb.getMZ() * 1e6
                                          : (pa.getMZ() > 0 ? 1e9 : 0.0);
        pmz.worst = std::max(pmz.worst, ppm);
        if (ppm > PREC_MZ_PPM)
        {
          std::ostringstream o;
          o.precision(10);
          o << a.getNativeID() << " " << pa.getMZ() << " vs " << pb.getMZ();
          pmz.fail(o.str());
        }
        ++pz.compared;
        raw_charge_unknown += pa.getCharge() == 0;
        ref_charge_unknown += pb.getCharge() == 0;
        if (pa.getCharge() != pb.getCharge())
          pz.fail(a.getNativeID() + " z=" + std::to_string(pa.getCharge()) + " vs " + std::to_string(pb.getCharge()));
      }

    if (a.getMSLevel() == 2)
    {
      ++empty.compared;
      if (a.empty() != b.empty()) empty.fail(a.getNativeID());
      if (!a.empty() && !b.empty()) ++ms2_with_peaks;
    }
    // Peaks: merged by m/z (within PEAK_MZ_REL), so the peaks both sides have
    // are compared even where one side has more, and every peak only one side
    // has is tallied (by m/z, 0.01 bins) to explain the count mismatches.
    Check& npk = a.getMSLevel() == 1 ? npk1 : npk2;
    ++npk.compared;
    // Ordered by m/z, then intensity: a centroid list can hold two peaks at
    // the same m/z, which the sides may list in either order.
    MSSpectrum sa = a, sb = b;
    const auto by_mz_int = [](const Peak1D& p, const Peak1D& q) {
      return p.getMZ() < q.getMZ() || (p.getMZ() == q.getMZ() && p.getIntensity() < q.getIntensity());
    };
    std::sort(sa.begin(), sa.end(), by_mz_int);
    std::sort(sb.begin(), sb.end(), by_mz_int);
    std::ostringstream o;
    o.precision(8);
    o << a.getNativeID() << " " << a.size() << " vs " << b.size() << ":";
    Size x = 0, y = 0, shown = 0;
    bool mz_bad = false, int_bad = false, any_pair = false;
    std::string int_what;
    while (x < sa.size() || y < sb.size())
    {
      const bool take_a = y >= sb.size() || (x < sa.size() && sa[x].getMZ() < sb[y].getMZ()
                                             && rel(sa[x].getMZ(), sb[y].getMZ()) > PEAK_MZ_REL);
      const bool take_b = !take_a && (x >= sa.size() || (sb[y].getMZ() < sa[x].getMZ()
                                             && rel(sa[x].getMZ(), sb[y].getMZ()) > PEAK_MZ_REL));
      if (take_a)
      {
        ++raw_only[std::lround(sa[x].getMZ() * 100)];
        ++raw_only_total;
        if (shown++ < 6) o << " raw-only " << sa[x].getMZ() << "/" << sa[x].getIntensity();
        ++x;
      }
      else if (take_b)
      {
        ++ref_only[std::lround(sb[y].getMZ() * 100)];
        ++ref_only_total;
        if (shown++ < 6) o << " ref-only " << sb[y].getMZ() << "/" << sb[y].getIntensity();
        ++y;
      }
      else
      {
        const double dm = rel(sa[x].getMZ(), sb[y].getMZ()), di = rel(sa[x].getIntensity(), sb[y].getIntensity());
        pkmz.worst = std::max(pkmz.worst, dm);
        pkint.worst = std::max(pkint.worst, di);
        mz_bad |= dm > PEAK_MZ_REL;
        if (di > PEAK_INT_REL && !int_bad)
        {
          std::ostringstream e;
          e.precision(10);
          e << " m/z " << sa[x].getMZ() << " intensity " << sa[x].getIntensity() << " vs " << sb[y].getIntensity();
          // Neighbours: two peaks within 1 ppm of each other pair crosswise
          // when the sides order them differently.
          for (Size k = (x > 0 ? x - 1 : 0); k <= x + 1 && k < sa.size(); ++k)
            e << " [raw " << sa[k].getMZ() << "/" << sa[k].getIntensity() << "]";
          for (Size k = (y > 0 ? y - 1 : 0); k <= y + 1 && k < sb.size(); ++k)
            e << " [ref " << sb[k].getMZ() << "/" << sb[k].getIntensity() << "]";
          int_what = e.str();
        }
        int_bad |= di > PEAK_INT_REL;
        any_pair = true;
        ++matched_peaks;
        ++x;
        ++y;
      }
    }
    if (a.size() != b.size()) npk.fail(o.str());
    if (any_pair)
    {
      ++pkmz.compared;
      ++pkint.compared;
    }
    if (mz_bad) pkmz.fail(a.getNativeID());
    if (int_bad) pkint.fail(a.getNativeID() + int_what);
  }
  // Reference-only native IDs.
  {
    std::set<std::string> raw_ids;
    for (Size i = 0; i < n; ++i) raw_ids.insert(r->getSpectrumMetadata(i).getNativeID());
    for (const MSSpectrum& s : ref)
      if (!raw_ids.count(s.getNativeID())) ids.fail("reference only: " + s.getNativeID());
  }
  std::set<UInt> levels;
  for (const auto& [l, c] : lv_raw) levels.insert(l);
  for (const auto& [l, c] : lv_ref) levels.insert(l);
  for (UInt l : levels)
  {
    ++counts.compared;
    if (lv_raw[l] != lv_ref[l])
      counts.fail("MS" + std::to_string(l) + " " + std::to_string(lv_raw[l]) + " vs " + std::to_string(lv_ref[l]));
  }

  std::ostringstream rep;
  rep << "key\tvalue\n";
  rep << "raw\t" << raw << "\nreference\t" << ref_path << "\n";
  rep << "tolerances\tRT<=" << RT_TOL_S << "s; precursor m/z<=" << PREC_MZ_PPM << "ppm; charge equal; peak m/z rel<="
      << PEAK_MZ_REL << "; intensity rel<=" << PEAK_INT_REL << "\n";
  rep << "spectra_raw\t" << n << "\nspectra_reference\t" << ref.size() << "\n";
  for (UInt l : levels) rep << "ms" << l << "_raw\t" << lv_raw[l] << "\nms" << l << "_reference\t" << lv_ref[l] << "\n";
  rep << "ms2_with_peaks_compared\t" << ms2_with_peaks << "\n";
  rep << "precursor_charge_unknown_raw\t" << raw_charge_unknown << "\nprecursor_charge_unknown_reference\t"
      << ref_charge_unknown << "\n";
  rep << "peaks_matched\t" << matched_peaks << "\npeaks_raw_only\t" << raw_only_total << "\npeaks_reference_only\t"
      << ref_only_total << "\n";
  const auto top = [&rep](const char* key, const std::map<long, size_t>& m) {
    std::vector<std::pair<size_t, long>> v;
    for (const auto& [mz, c] : m) v.emplace_back(c, mz);
    std::sort(v.rbegin(), v.rend());
    rep << key << "\t";
    for (size_t k = 0; k < v.size() && k < 12; ++k) rep << (k ? " " : "") << v[k].second / 100.0 << "x" << v[k].first;
    rep << "\n";
  };
  top("peaks_raw_only_top_mz", raw_only);
  top("peaks_reference_only_top_mz", ref_only);
  rep << "resolving_power_by_level\t";
  bool first_rp = true;
  for (const auto& [k, c] : resolving)
  {
    rep << (first_rp ? "" : " ") << "MS" << k.first << ":" << (k.second ? std::to_string(k.second) : "none") << "x" << c;
    first_rp = false;
  }
  rep << "\n";
  // The profile path (FASTag::Thermo::Representation::PROFILE): the first MS1 as acquired.
  try
  {
    auto prof = FASTag::Thermo::open(raw, FASTag::Thermo::Representation::PROFILE);
    for (Size i = 0; i < prof->getNrSpectra(); ++i)
    {
      if (prof->getSpectrumMSLevel(i) != 1) continue;
      const MSSpectrum p = prof->getSpectrum(i);
      rep << "profile_first_ms1\t" << p.getNativeID() << " type="
          << (p.getType() == SpectrumSettings::SpectrumType::PROFILE ? "profile" : "centroid") << " points=" << p.size() << "\n";
      break;
    }
  }
  catch (const Exception::BaseException& e)
  {
    rep << "profile_first_ms1\terror " << e.what() << "\n";
  }
  bool ok = ms2_with_peaks > 0;
  for (const Check* c : {&counts, &ids, &order, &rt, &lvl, &nprec, &pmz, &pz, &filt, &empty, &npk1, &npk2, &pkmz, &pkint})
  {
    rep << c->name << "\t" << (c->failed == 0 ? "PASS" : "FAIL") << " compared=" << c->compared
        << " failed=" << c->failed << " worst=" << c->worst;
    for (const std::string& e : c->examples) rep << " | " << e;
    rep << "\n";
    ok &= c->failed == 0;
  }
  rep << "nonempty\t" << (ms2_with_peaks > 0 ? "PASS" : "FAIL") << "\n";
  rep << "stage1\t" << (ok ? "PASS" : "FAIL") << "\n";
  std::cout << rep.str();
  if (argc > 3) std::ofstream(argv[3]) << rep.str();
  return ok ? 0 : 1;
}
