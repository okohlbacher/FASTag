// 1.13 digqual (backlog 23): missed-cleavage and non-specific-end
// measurements for one enzyme from the tag ends (see Digest.h and
// doc/DESIGN-digest.md, "Digestion quality").
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "Digest.h"

#include <cmath>
#include <cstdio>
#include <limits>

namespace FASTag::Digest
{
  namespace
  {
    Dist normalised(const Dist& d)
    {
      double t = 0.0;
      for (double x : d) t += x;
      Dist o{};
      if (t > 0.0)
        for (std::size_t i = 0; i < o.size(); ++i) o[i] = d[i] / t;
      return o;
    }
    std::string f(double v, int decimals)
    {
      char b[64];
      std::snprintf(b, sizeof b, "%.*f", decimals, v);
      return b;
    }
    std::string u(std::uint64_t v) { return std::to_string(v); }
    std::string siteList(const std::vector<int>& s)
    {
      std::string o;
      for (int a : s)
      {
        if (!o.empty()) o += ',';
        o += kAAs[static_cast<std::size_t>(a)];
      }
      return o.empty() ? "-" : o;
    }
  }

  std::vector<int> siteResidues(const Dist& model_end, const Dist& bg)
  {
    const Dist p = normalised(model_end), b = normalised(bg);
    std::vector<int> s;
    for (int a = 0; a < kNumAA; ++a)
      if (p[static_cast<std::size_t>(a)] > b[static_cast<std::size_t>(a)]) s.push_back(a);
    return s;
  }

  double mixtureShareMle(const std::array<std::uint64_t, kNumAA>& k, const Dist& p_in, const Dist& b_in)
  {
    const Dist p = normalised(p_in), b = normalised(b_in);
    // dL/ds = sum_a k_a (b_a - p_a) / ((1 - s) p_a + s b_a), decreasing in s.
    auto deriv = [&](double s) {
      double d = 0.0;
      for (std::size_t a = 0; a < k.size(); ++a)
      {
        if (k[a] == 0) continue;
        const double den = (1.0 - s) * p[a] + s * b[a];
        if (den <= 0.0) return (b[a] - p[a]) >= 0.0 ? std::numeric_limits<double>::infinity()
                                                    : -std::numeric_limits<double>::infinity();
        d += static_cast<double>(k[a]) * (b[a] - p[a]) / den;
      }
      return d;
    };
    if (!(deriv(0.0) > 0.0)) return 0.0;
    if (!(deriv(1.0) < 0.0)) return 1.0;
    double lo = 0.0, hi = 1.0;
    for (int it = 0; it < 200 && hi - lo > 1e-15; ++it)
    {
      const double mid = 0.5 * (lo + hi);
      (deriv(mid) > 0.0 ? lo : hi) = mid;
    }
    return 0.5 * (lo + hi);
  }

  Quality digestQuality(const TerminusCounter& tc, const ModelTable& table, const Model& model,
                        const std::string& basis, int tag_min)
  {
    Quality q;
    q.enzyme = model.name;
    q.basis = basis;
    for (const char end : {'C', 'N'})
    {
      const bool bg_end = end == 'C' ? model.c_bg : model.n_bg;
      if (bg_end) continue;
      const Dist& pm = end == 'C' ? model.c : model.n;
      const Dist& bg = end == 'C' ? table.bg_c : table.bg_n;
      QualityEnd e;
      e.end = end;
      e.sites = siteResidues(pm, bg);
      if (e.sites.empty()) continue;  // the end equals the background
      const auto counts = end == 'C' ? tc.cterm() : tc.nterm();
      const auto& joint = end == 'C' ? tc.cq : tc.nq;
      for (std::uint64_t c : counts) e.ends += c;
      const Dist bn = normalised(bg);
      std::array<bool, kNumAA> is_site{};
      for (int a : e.sites) is_site[static_cast<std::size_t>(a)] = true;
      for (int a : e.sites)
      {
        e.specific += counts[static_cast<std::size_t>(a)];
        e.mc_background_share += bn[static_cast<std::size_t>(a)];
        for (int r = 0; r < kNumAA; ++r)
        {
          const std::uint64_t n = joint[static_cast<std::size_t>(a)][static_cast<std::size_t>(r)];
          e.mc_positions += n;
          if (is_site[static_cast<std::size_t>(r)]) e.mc_sites += n;
        }
      }
      e.measured = e.ends >= static_cast<std::uint64_t>(tag_min);
      e.mc_measured = e.measured && e.specific >= static_cast<std::uint64_t>(tag_min);
      e.mc_retention = std::numeric_limits<double>::quiet_NaN();
      if (e.measured)
      {
        e.nonspecific_share = 1.0 - static_cast<double>(e.specific) / static_cast<double>(e.ends);
        e.nonspecific_mle = mixtureShareMle(counts, pm, bg);
        const double bs = e.mc_background_share;
        // The missed-cleavage ratios need tag_min specific ends; below that
        // mc_retention stays NaN and the rows say mc_few_specific.
        if (e.mc_measured && e.mc_positions > e.mc_sites && bs > 0.0 && bs < 1.0)
          e.mc_retention = (static_cast<double>(e.mc_sites) / static_cast<double>(e.mc_positions - e.mc_sites)) /
                           (bs / (1.0 - bs));
        q.measured = true;
      }
      q.ends.push_back(e);
    }
    if (!q.measured) q.reason = q.ends.empty() ? "no_specific_end" : "few_tags";
    return q;
  }

  Quality reportQuality(const TerminusCounter& tc, const ModelTable& table, const std::vector<Row>& report,
                        const std::string& option, const DigestSettings& s)
  {
    const bool is_auto = option == "auto";
    Quality q;
    q.basis = is_auto ? "call" : "named";
    q.enzyme = "-";
    if (s.low_resolution)
    {
      // The tag-end windows do not hold on a Da tolerance, as for the
      // protease and label calls of the same report.
      if (!is_auto) q.enzyme = option;
      q.reason = "low_resolution";
      return q;
    }
    std::string enzyme = option;
    if (is_auto)
    {
      std::string status, model;
      for (const Row& r : report)
        if (r.section == "call" && r.key == "status") status = r.value;
        else if (r.section == "call" && r.key == "model") model = r.value;
      enzyme = status == "call" ? model : std::string();
    }
    for (const Model& m : table.models)
      if (!enzyme.empty() && m.name == enzyme) return digestQuality(tc, table, m, q.basis, s.tag_min);
    q.reason = "no_call";
    return q;
  }

  std::vector<Row> qualityRows(const Quality& q, const DigestSettings& s)
  {
    std::vector<Row> out;
    auto add = [&](const std::string& key, const std::string& value, const std::string& n, const std::string& d) {
      out.push_back(Row{"quality", key, value, n, d});
    };
    add("enzyme", q.enzyme, "-",
        q.enzyme == "-" ? "No enzyme is measured."
        : q.basis == "call" ? "The enzyme is " + q.enzyme + ", the protease call of this report."
                            : "The enzyme is " + q.enzyme + ", as named by -digest_quality.");
    add("basis", q.basis, "-",
        q.basis == "call" ? "The enzyme is the report's call (-digest_quality auto)." : "The enzyme is named by -digest_quality.");
    if (!q.measured)
    {
      add("status", "not_measured", "-", "Digestion quality is not measured.");
      const std::string why = q.reason == "low_resolution" ? "the fragment tolerance is in Da, so the tag-end windows do not hold"
                              : q.reason == "no_call" ? "the report makes no protease call"
                              : q.reason == "no_specific_end" ? "every end of the enzyme's model is the background"
                                                              : "fewer than " + std::to_string(s.tag_min) + " tag ends are at the enzyme's cleaving end";
      add("reason", q.reason, "-", "Not measured: " + why + ".");
    }
    else
      add("status", "measured", "-", "Digestion quality is measured.");
    for (const QualityEnd& e : q.ends)
    {
      const std::string E(1, e.end);
      const std::string P1 = e.end == 'C' ? "P1" : "P1'", P24 = e.end == 'C' ? "P2..P4" : "P2'..P4'";
      const std::string sites = siteList(e.sites);
      add(E + ".sites", sites, "-", "The cleaving residues at " + P1 + " are " + sites + " (model above background).");
      add(E + ".ends", u(e.ends), u(e.ends), u(e.ends) + " tag ends are counted at " + P1 + ", " + u(e.specific) + " of them at " + sites + ".");
      if (!e.measured)
      {
        add(E + ".measured", "no", u(e.ends), u(e.ends) + " tag ends are fewer than " + std::to_string(s.tag_min) + ".");
        continue;
      }
      add(E + ".measured", "yes", u(e.ends), "At least " + std::to_string(s.tag_min) + " tag ends are counted at " + P1 + ".");
      add(E + ".nonspecific_share", num(e.nonspecific_share), u(e.ends),
          "A share of " + f(e.nonspecific_share, 4) + " of the " + P1 + " ends are not " + sites + ".");
      add(E + ".nonspecific_mle", num(e.nonspecific_mle), u(e.ends),
          "The " + P1 + " counts fit best with a background share of " + f(e.nonspecific_mle, 4) + " mixed into " + q.enzyme + ".");
      add(E + ".mc_measured", e.mc_measured ? "yes" : "no", u(e.specific),
          e.mc_measured ? "At least " + std::to_string(s.tag_min) + " tag ends are at " + sites + "."
                        : u(e.specific) + " tag ends at " + sites + " are fewer than " + std::to_string(s.tag_min) +
                              "; the missed-cleavage ratios are not measured.");
      if (!e.mc_measured)
        add(E + ".mc_reason", "mc_few_specific", u(e.specific),
            "Not measured: fewer than " + std::to_string(s.tag_min) + " tag ends are at " + sites + ".");
      add(E + ".mc_positions", u(e.mc_positions), u(e.specific),
          u(e.mc_positions) + " residues are counted at " + P24 + " of the " + u(e.specific) + " tags with a " + sites + " end.");
      add(E + ".mc_sites", u(e.mc_sites), u(e.mc_positions), u(e.mc_sites) + " of them are " + sites + ".");
      const double share = e.mc_positions ? static_cast<double>(e.mc_sites) / static_cast<double>(e.mc_positions)
                                          : std::numeric_limits<double>::quiet_NaN();
      add(E + ".mc_site_share", e.mc_measured && e.mc_positions ? num(share) : "-", u(e.mc_positions),
          !e.mc_measured ? "Not measured (mc_few_specific)."
          : e.mc_positions ? "A share of " + f(share, 4) + " of the residues at " + P24 + " are " + sites + "."
                         : "No residue is counted at " + P24 + ".");
      add(E + ".mc_background_share", num(e.mc_background_share), "-",
          "The background share of " + sites + " is " + f(e.mc_background_share, 4) + ".");
      const bool ok = !std::isnan(e.mc_retention);
      add(E + ".mc_retention", ok ? num(e.mc_retention) : "-", u(e.mc_positions),
          !e.mc_measured ? "Not measured (mc_few_specific)."
          : ok ? "Uncut " + sites + " sites at " + P24 + " occur at " + f(e.mc_retention, 4) +
                   " times the background odds (0: every site cut, 1: as in the background)."
             : "The site odds at " + P24 + " are undefined (no residue or no non-site residue counted).");
    }
    return out;
  }
}
