// Raw-DIA detection for FASTag (1.12 item #7). See Acquisition.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Acquisition.h"

#include <OpenMS/METADATA/DataProcessing.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <map>
#include <sstream>
#include <string_view>
#include <unordered_map>

using namespace OpenMS;

namespace FASTag::Acquisition
{
  namespace
  {
    /// m/z rounded to 0.1 as an integer key, as prose-auto's np.round(x, 1)
    /// (round half to even).
    long key01(double v) { return static_cast<long>(std::nearbyint(v * 10.0)); }
    long key001(double v) { return static_cast<long>(std::nearbyint(v * 100.0)); }

    double median(std::vector<double> v)
    {
      if (v.empty()) return 0;
      std::sort(v.begin(), v.end());
      const std::size_t n = v.size();
      return n % 2 ? v[n / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
    }

    /// @p v with at most @p decimals decimals and no trailing zeros.
    std::string fmt(double v, int decimals = 2)
    {
      std::ostringstream o;
      o.setf(std::ios::fixed);
      o.precision(decimals);
      o << v;
      std::string s = o.str();
      if (s.find('.') != std::string::npos)
      {
        while (!s.empty() && s.back() == '0') s.pop_back();
        if (!s.empty() && s.back() == '.') s.pop_back();
      }
      if (s == "-0") s = "0";
      return s;
    }
    std::string pct(double share) { return fmt(100.0 * share, 0) + "%"; }

    bool isProvenanceSoftware(const std::string& n) { return n == "DIAspeXtract" || n == "diaTracer"; }

    /// One event: a run of consecutive MS2 on the same rounded m/z and window.
    struct Event
    {
      long kx;
      long klo, kup;
      double x, target, lower, upper;
    };
  }

  AcqCall classifyAcquisition(const std::vector<Ms2Meta>& ms2, const Thresholds& t)
  {
    AcqCall c;
    c.n_ms2 = ms2.size();
    if (ms2.empty())
    {
      c.why = "no MS2 spectrum with a precursor among the spectra probed";
      return c;
    }
    std::size_t n_prov = 0, n_unch = 0, n_im = 0;
    for (const Ms2Meta& m : ms2)
    {
      n_prov += m.provenance;
      n_unch += m.charge <= 0;
      n_im += m.im;
    }
    const double n = static_cast<double>(ms2.size());
    c.frac_provenance = n_prov / n;
    c.frac_uncharged = n_unch / n;
    c.im = n_im > ms2.size() / 2;

    // 1. Event collapse.
    std::vector<Event> ev;
    for (const Ms2Meta& m : ms2)
    {
      const Event e{key01(m.x), key001(m.lower), key001(m.upper), m.x, m.target, m.lower, m.upper};
      if (!ev.empty() && ev.back().kx == e.kx && ev.back().klo == e.klo && ev.back().kup == e.kup) continue;
      ev.push_back(e);
    }
    c.n_events = ev.size();

    // 2. Periodicity on the rounded selected-ion m/z (prose-auto
    // window_periodicity): the gap, in events, since each value was last
    // seen; the commonest gap (the first seen among equally common ones) is
    // the cycle, and its share of all gaps the periodicity.
    std::unordered_map<long, std::size_t> last;
    std::map<std::size_t, std::size_t> gap_count;
    std::vector<std::size_t> gap_order;
    for (std::size_t i = 0; i < ev.size(); ++i)
    {
      const auto it = last.find(ev[i].kx);
      if (it != last.end())
      {
        const std::size_t g = i - it->second;
        if (gap_count[g]++ == 0) gap_order.push_back(g);
        ++c.n_gaps;
        it->second = i;
      }
      else
        last.emplace(ev[i].kx, i);
    }
    c.n_win = last.size();
    if (c.n_gaps >= t.min_gaps)
    {
      std::size_t best = 0;
      for (std::size_t g : gap_order)
        if (gap_count[g] > best)
        {
          best = gap_count[g];
          c.cycle = g;
        }
      c.per = static_cast<double>(best) / static_cast<double>(c.n_gaps);
    }
    const double nw = static_cast<double>(c.n_win);
    c.periodic = c.n_gaps >= t.min_gaps && c.per >= t.min_periodicity &&
                 std::fabs(static_cast<double>(c.cycle) - nw) <= t.cycle_tolerance * nw && c.n_win >= t.min_windows;

    // 2b. Closed window set (1.13): the run keeps returning to the same few
    // m/z, whatever the order. visits = events per distinct m/z; the share of
    // the events of the second half whose m/z the first half had.
    {
      c.visits = c.n_win ? static_cast<double>(ev.size()) / nw : 0.0;
      const std::size_t half = ev.size() / 2;
      std::unordered_map<long, bool> first;
      for (std::size_t i = 0; i < half; ++i) first.emplace(ev[i].kx, true);
      std::size_t seen = 0;
      for (std::size_t i = half; i < ev.size(); ++i) seen += first.count(ev[i].kx);
      c.closed_share = ev.size() > half ? static_cast<double>(seen) / static_cast<double>(ev.size() - half) : 0.0;
      c.closed = c.n_gaps >= t.min_gaps && c.n_win >= t.min_windows && c.visits >= t.closed_min_visits &&
                 c.closed_share >= t.closed_min_share;
    }
    // One and the same charge on (almost) every MS2 is a method default, not
    // a measured charge state.
    {
      std::map<int, std::size_t> zc;
      for (const Ms2Meta& m : ms2)
        if (m.charge > 0) ++zc[m.charge];
      for (const auto& [z, k] : zc)
        if (static_cast<double>(k) >= t.placeholder_min_share * n) c.placeholder_charge = z;
    }

    // 3. Windows: recorded on most events; their median width; the union of
    // [target - lower, target + upper] over the distinct windows.
    std::vector<double> widths;
    std::vector<std::pair<long, long>> wins;
    for (const Event& e : ev)
    {
      if (e.lower + e.upper <= 0) continue;
      widths.push_back(e.lower + e.upper);
      wins.emplace_back(key001(e.target - e.lower), key001(e.target + e.upper));
    }
    c.windows = static_cast<double>(widths.size()) >= t.windows_min_share * static_cast<double>(ev.size());
    c.median_width = median(widths);
    if (!wins.empty())
    {
      std::sort(wins.begin(), wins.end());
      wins.erase(std::unique(wins.begin(), wins.end()), wins.end());
      long cover = 0, cur_lo = wins[0].first, cur_hi = wins[0].second, hi = wins[0].second;
      for (const auto& [a, b] : wins)
      {
        hi = std::max(hi, b);
        if (a > cur_hi)
        {
          cover += cur_hi - cur_lo;
          cur_lo = a;
          cur_hi = b;
        }
        else
          cur_hi = std::max(cur_hi, b);
      }
      cover += cur_hi - cur_lo;
      c.lo = wins.front().first / 100.0;
      c.hi = hi / 100.0;
      const long span = hi - wins.front().first;
      c.coverage = span > 0 ? static_cast<double>(cover) / static_cast<double>(span) : 0.0;
    }
    // The median spacing of the distinct rounded m/z values.
    {
      std::vector<long> ks;
      ks.reserve(last.size());
      for (const auto& kv : last) ks.push_back(kv.first);
      std::sort(ks.begin(), ks.end());
      std::vector<double> d;
      for (std::size_t i = 1; i < ks.size(); ++i) d.push_back((ks[i] - ks[i - 1]) / 10.0);
      c.spacing = median(d);
      // Without recorded windows the values must form a regular grid, as DIA
      // window centres do; an inclusion list of arbitrary targets does not.
      std::size_t on_grid = 0;
      for (double v : d) on_grid += std::fabs(v - c.spacing) <= t.nowin_grid_tolerance * c.spacing;
      c.grid_share = d.empty() ? 0.0 : static_cast<double>(on_grid) / static_cast<double>(d.size());
    }

    const std::string stats =
        "periodicity " + fmt(c.per) + " over " + std::to_string(c.n_gaps) + " repeat gaps, cycle " +
        std::to_string(c.cycle) + ", " + std::to_string(c.n_win) + " distinct precursor m/z, " +
        pct(c.frac_uncharged) + " uncharged, " + std::to_string(c.n_ms2) + " MS2 probed";
    const std::string win_stats = "median width " + fmt(c.median_width) + " Th, " + fmt(c.lo, 1) + "-" +
                                  fmt(c.hi, 1) + " m/z, coverage " + fmt(c.coverage);

    // 4. The call.
    if (c.frac_provenance >= t.min_provenance)
    {
      c.mode = Mode::PseudoDDA;
      c.why = pct(c.frac_provenance) + " of the MS2 were written by a pseudo-DDA generator (DIAspeXtract or "
              "diaTracer)";
      return c;
    }
    const bool tiling = c.windows && c.coverage >= t.min_coverage && c.hi - c.lo >= t.min_span;
    if ((c.periodic || c.closed) && tiling)
    {
      // The wording of a run with one cycle is the 1.12 one.
      const std::string head = c.periodic
          ? "the same " + std::to_string(c.n_win) + " isolation windows repeat every cycle and tile the range ("
          : "the run keeps returning to the same " + std::to_string(c.n_win) + " isolation windows (" +
            fmt(c.visits, 1) + " visits each, no single cycle), which tile the range (";
      if (c.frac_uncharged >= t.dia_min_uncharged)
      {
        c.mode = Mode::DIA;
        c.why = head + win_stats + "); " + stats;
      }
      else if (c.placeholder_charge > 0)
      {
        c.mode = Mode::DIA;
        c.why = head + win_stats + "), and all MS2 carry the same charge " + std::to_string(c.placeholder_charge) +
                "+, a method default; " + stats;
      }
      else
      {
        c.mode = Mode::DIALike;
        c.warn = true;
        c.why = head + win_stats + "), but most MS2 carry a charge; " + stats;
      }
      return c;
    }
    if (c.periodic && !c.windows)
    {
      const bool grid = c.grid_share >= t.nowin_grid_min_share;
      if (c.frac_uncharged >= t.nowin_min_uncharged && c.spacing <= t.nowin_max_spacing && grid)
      {
        c.mode = Mode::DIA;
        c.why = "no isolation windows are recorded, but the same " + std::to_string(c.n_win) +
                " uncharged precursor m/z (a regular grid, median spacing " + fmt(c.spacing) + " Th, " +
                pct(c.grid_share) + " of the spacings within " + pct(t.nowin_grid_tolerance) +
                " of it) repeat every cycle; " + stats;
      }
      else if (c.frac_uncharged < t.dia_min_uncharged)
      {
        c.mode = Mode::DDA;
        c.why = "a repeating precursor list without isolation windows, mostly charged; " + stats;
      }
      else
      {
        c.mode = Mode::PRM;
        c.why = "the same " + std::to_string(c.n_win) + " precursor m/z repeat every cycle (no isolation windows, "
                "median spacing " + fmt(c.spacing) + " Th, " + pct(c.grid_share) + " of the spacings within " +
                pct(t.nowin_grid_tolerance) + " of it" + (grid ? "" : ": not a window grid") + "); " + stats;
      }
      return c;
    }
    if (c.periodic)
    {
      c.mode = Mode::PRM;
      c.why = "the same " + std::to_string(c.n_win) + " targets repeat every cycle but do not tile a range (" +
              win_stats + "); " + stats;
      return c;
    }
    if (c.n_gaps < t.min_gaps)
    {
      c.mode = Mode::Undetermined;
      c.warn = c.median_width >= t.warn_min_width && c.frac_uncharged >= t.warn_min_uncharged;
      c.why = "too few repeated precursor m/z to judge (" + std::to_string(c.n_gaps) + " repeat gaps, " +
              std::to_string(c.n_ms2) + " MS2 probed" +
              (c.windows ? ", " + win_stats : std::string()) + ", " + pct(c.frac_uncharged) + " uncharged)";
      return c;
    }
    c.mode = Mode::DDA;
    c.why = "no repeating window scheme (" + stats + ")";
    return c;
  }

  std::string modeName(const AcqCall& c)
  {
    switch (c.mode)
    {
      case Mode::Undetermined: return "undetermined";
      case Mode::DDA: return "DDA";
      case Mode::PseudoDDA: return "pseudo-DDA";
      case Mode::PRM: return "PRM/targeted";
      case Mode::DIALike: return "DIA-like";
      case Mode::DIA: return c.im ? "DIA (diaPASEF)" : "DIA";
    }
    return "undetermined";
  }

  std::optional<Ms2Meta> fromSpectrum(const MSSpectrum& s, bool run_provenance)
  {
    if (s.getMSLevel() != 2 || s.getPrecursors().empty()) return std::nullopt;
    const Precursor& p = s.getPrecursors().front();
    Ms2Meta m;
    m.x = p.getMZ();
    m.target = m.x;
    // OpenMS's MzMLHandler (and the fast reader since step 0) keep the
    // window target as this meta value whenever the selected ion moved the
    // precursor m/z away from it; 0 when the file gave none. Looked up by
    // name: registering it here would change the registry order.
    if (p.metaValueExists("isolation window target m/z"))
    {
      const double tv = static_cast<double>(p.getMetaValue("isolation window target m/z"));
      if (tv > 0) m.target = tv;
    }
    m.lower = std::max(0.0, p.getIsolationWindowLowerOffset());
    m.upper = std::max(0.0, p.getIsolationWindowUpperOffset());
    m.charge = p.getCharge();
    const DriftTimeUnit u = s.getDriftTimeUnit();
    m.im = ((u == DriftTimeUnit::VSSC || u == DriftTimeUnit::MILLISECOND) && s.getDriftTime() > 0) ||
           p.getDriftTime() > 0 || s.containsIMData();
    m.provenance = run_provenance;
    if (!m.provenance)
    {
      std::vector<std::string> keys;
      s.getKeys(keys);
      for (const std::string& k : keys)
        if (k.compare(0, 4, "spx_") == 0)
        {
          m.provenance = true;
          break;
        }
    }
    if (!m.provenance)
      for (const auto& dp : s.getDataProcessing())
        if (dp && isProvenanceSoftware(dp->getSoftware().getName()))
        {
          m.provenance = true;
          break;
        }
    return m;
  }

  std::vector<Ms2Meta> collectMs2Meta(std::size_t n_total, const std::function<MSSpectrum(std::size_t)>& read,
                                      const ProbeLimits& limits, bool run_provenance)
  {
    std::vector<Ms2Meta> out;
    const std::size_t heads = std::min(n_total, limits.max_spectra);
    for (std::size_t i = 0; i < heads && out.size() < limits.max_ms2; ++i)
      if (auto m = fromSpectrum(read(i), run_provenance)) out.push_back(*m);
    return out;
  }

  bool mzmlHeaderProvenance(const std::string& path)
  {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    constexpr std::size_t kMax = std::size_t{4} << 20, kPiece = 1 << 16;
    std::string head;
    std::vector<char> buf(kPiece);
    while (head.size() < kMax && in)
    {
      in.read(buf.data(), static_cast<std::streamsize>(buf.size()));
      head.append(buf.data(), static_cast<std::size_t>(in.gcount()));
      // The run-level part ends where the spectra start.
      const std::size_t end = head.find("<spectrumList");
      if (end != std::string::npos)
      {
        head.resize(end);
        break;
      }
    }
    for (const std::string_view needle :
         {std::string_view("value=\"DIAspeXtract\""), std::string_view("name=\"spx:"),
          std::string_view("<software id=\"diaTracer\""), std::string_view("softwareRef=\"diaTracer\"")})
      if (head.find(needle) != std::string::npos) return true;
    return false;
  }

  namespace
  {
    std::string pseudoPath(const std::string& in)
    {
      // <stem>.pseudo.mzML: the extension cut only if the dot is in the file name.
      const std::size_t slash = in.find_last_of("/\\");
      const std::size_t dot = in.find_last_of('.');
      const std::string stem = dot != std::string::npos && (slash == std::string::npos || dot > slash) ? in.substr(0, dot) : in;
      return stem + ".pseudo.mzML";
    }
    std::string scheme(const AcqCall& c)
    {
      if (c.windows)
        return std::string("the precursor m/z of its MS2 ") +
               (c.periodic ? "repeats in a cycle of " : "keeps returning to the same ") + std::to_string(c.n_win) +
               " isolation windows (median " + fmt(c.median_width) + " Th, " + fmt(c.lo, 1) + "-" + fmt(c.hi, 1) +
               " m/z, periodicity " + fmt(c.per) + ", " + pct(c.frac_uncharged) + " uncharged" +
               (c.frac_uncharged < 0.5 && c.placeholder_charge > 0
                    ? ", all others " + std::to_string(c.placeholder_charge) + "+, a method default"
                    : std::string()) +
               ")";
      return "the precursor m/z of its MS2 repeats in a cycle of " + std::to_string(c.n_win) +
             " values without recorded isolation windows (median spacing " + fmt(c.spacing) + " Th, periodicity " +
             fmt(c.per) + ", " + pct(c.frac_uncharged) + " uncharged)";
    }
  }

  std::string refusalMessage(const AcqCall& c, const std::string& in)
  {
    return "'" + in + "' is raw " + modeName(c) + ": " + scheme(c) +
           ". Each MS2 mixes several peptides and its 'precursor' is a window, so tags would get wrong flanking "
           "masses and complement statistics. Generate pseudo-DDA spectra first, e.g. DIAspeXtract -in " + in +
           " -out " + pseudoPath(in) +
           " (diaTracer also works for .d), then run FASTag on that file. To tag the raw DIA spectra anyway "
           "(experts; flanks and complements will be wrong), add -acquisition_check warn.";
  }

  std::string refusalSentinel(const AcqCall& c)
  {
    return "FASTAG_REFUSED reason=raw_dia windows=" + std::to_string(c.n_win) +
           " median_width=" + fmt(c.median_width);
  }

  std::string warningMessage(const AcqCall& c, const std::string& in)
  {
    if (!c.warn) return {};
    if (c.mode == Mode::DIALike)
      return "'" + in + "' looks like DIA (" + c.why + "). It is tagged because most of its MS2 carry a precursor "
             "charge, as DDA does. If it is raw DIA with placeholder charges, its tags have wrong flanks and "
             "complements: generate pseudo-DDA spectra with DIAspeXtract first. -acquisition_check off skips "
             "this check.";
    return "'" + in + "': the acquisition could not be determined (" + c.why + "), yet its MS2 have wide, "
           "uncharged isolation windows, as raw DIA does. If it is raw DIA, generate pseudo-DDA spectra with "
           "DIAspeXtract first. -acquisition_check off skips this check.";
  }

  std::string taggedAnywayMessage(const AcqCall& c, const std::string& in)
  {
    return "'" + in + "' is raw " + modeName(c) + " (" + scheme(c) +
           "); tagging it anyway as -acquisition_check warn asks. Its tags have wrong flanking masses and "
           "complement statistics; DIAspeXtract pseudo-DDA spectra are the input FASTag expects.";
  }

  std::string infoLine(const AcqCall& c) { return "Acquisition check: " + modeName(c) + " (" + c.why + ")"; }
}
