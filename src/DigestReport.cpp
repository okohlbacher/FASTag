// The rows of -digest_out, -label_out and -massgap_out (see Digest.h).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// Compiled with -ffp-contract=off, like Digest.cpp: the shares are 0.1.3's.

#include "Digest.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <limits>

namespace FASTag::Digest
{
  namespace
  {
    /// A number for a sentence: @p prec significant digits.
    std::string g(double v, int prec = 3)
    {
      char b[64];
      std::snprintf(b, sizeof b, "%.*g", prec, v);
      return b;
    }
    std::string f(double v, int decimals)
    {
      char b[64];
      std::snprintf(b, sizeof b, "%.*f", decimals, v);
      return b;
    }
    std::string u(std::uint64_t v) { return std::to_string(v); }

    struct Rows
    {
      std::vector<Row>& out;
      void add(const std::string& section, const std::string& key, const std::string& value,
               const std::string& n, const std::string& description)
      {
        out.push_back(Row{section, key, value, n, description});
      }
    };

    std::string lower(std::string s)
    {
      for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
      return s;
    }

    const char* kKeys7[] = {"K", "K+TMT", "K+TMTpro", "K+iTRAQ4", "K+8", "R", "R+10"};

    int keyIndex(const std::string& name)
    {
      const auto& keys = residueKeys();
      for (int k = 0; k < kNumKeys; ++k)
        if (name == keys[static_cast<std::size_t>(k)].name) return k;
      return -1;
    }
  }

  double median(std::vector<double> v)
  {
    if (v.empty()) return std::numeric_limits<double>::quiet_NaN();
    std::sort(v.begin(), v.end());
    const std::size_t n = v.size();
    return n % 2 ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  }

  std::vector<Row> digestRows(const TerminusCounter& tc, const ModelTable& table, const RunMeta& meta,
                              const DigestSettings& s)
  {
    std::vector<Row> out;
    Rows r{out};
    const std::string w = num(s.window);
    r.add("run", "window_da", w, "-", "A tag end counts for a residue when its mass is within " + w + " Da of it.");
    r.add("run", "tag_min", std::to_string(s.tag_min), "-",
          "The call needs " + std::to_string(s.tag_min) + " C-terminal tag ends, and uses the N-terminal ends when there are as many.");
    r.add("run", "background_share", num(s.background_share), "-",
          "Every model is mixed with the background at a share of " + num(s.background_share) + ".");
    r.add("run", "models", s.models, "-",
          s.models == "shipped" ? "The models are the cleavage rules shipped with FASTag." : "The models are read from " + s.models + ".");
    r.add("run", "background", s.background, "-",
          s.background == "shipped_human" ? "The background is the residue composition of the human reference proteome shipped with FASTag."
          : s.background == "models_table" ? "The background is the one in the model table."
                                           : "The background is the residue composition of " + s.background.substr(6) +
                                                 (s.background_pseudocount ? ", with one count added to every residue because one is absent." : "."));

    // ---- meta
    const bool have_inst = !meta.instrument_name.empty() || !meta.instrument_model.empty();
    r.add("meta", "instrument", meta.instrument_name.empty() ? "-" : meta.instrument_name, "-",
          meta.instrument_name.empty() ? "The input names no instrument (metadata absent)." : "The input names the instrument " + meta.instrument_name + ".");
    r.add("meta", "instrument_model", meta.instrument_model.empty() ? "-" : meta.instrument_model, "-",
          meta.instrument_model.empty() ? "The input names no instrument model (metadata absent)." : "The input names the instrument model " + meta.instrument_model + ".");
    r.add("meta", "native_id_format", meta.native_id_type.empty() ? "-" : meta.native_id_type, "-",
          meta.native_id_type.empty() ? "The input names no native ID format (metadata absent)." : "The native ID format of the input is " + meta.native_id_type + ".");
    const std::uint64_t im = meta.im_vssc + meta.im_drift + meta.im_faims + meta.im_other;
    const std::string im_word = meta.ms2 == 0 ? "absent" : im ? "yes" : "no";
    r.add("meta", "ion_mobility", im_word, u(meta.ms2),
          meta.ms2 == 0 ? "No MS2 spectrum was read (metadata absent)."
                        : u(im) + " of " + u(meta.ms2) + " MS2 spectra carry an ion mobility.");
    std::string unit = "-";
    if (meta.im_vssc) unit = "1/K0";
    else if (meta.im_drift) unit = "ms";
    else if (meta.im_faims) unit = "FAIMS CV";
    else if (meta.im_other) unit = "other";
    r.add("meta", "ion_mobility_unit", unit, u(im),
          u(meta.im_vssc) + " MS2 spectra carry 1/K0, " + u(meta.im_drift) + " a drift time, " + u(meta.im_faims) +
              " a FAIMS compensation voltage and " + u(meta.im_other) + " another ion mobility.");
    const double low = median(meta.scan_low), first = median(meta.first_peak);
    r.add("meta", "ms2_scan_window_low", meta.scan_low.empty() ? "-" : num(low), u(meta.scan_low.size()),
          meta.scan_low.empty() ? "No MS2 spectrum states its scan window (metadata absent)."
                                : "The median MS2 scan window starts at m/z " + f(low, 2) + " over " + u(meta.scan_low.size()) + " spectra.");
    r.add("meta", "ms2_first_peak_mz", meta.first_peak.empty() ? "-" : num(first), u(meta.first_peak.size()),
          meta.first_peak.empty() ? "No MS2 spectrum has a peak."
                                  : "The median first MS2 peak is at m/z " + f(first, 2) + " over " + u(meta.first_peak.size()) + " spectra.");

    // ---- counts
    const auto cterm = tc.cterm(), nterm = tc.nterm();
    std::uint64_t n_c = 0, n_n = 0;
    for (int a = 0; a < kNumAA; ++a) { n_c += cterm[a]; n_n += nterm[a]; }
    const std::uint64_t tot = tc.tot();
    r.add("count", "tags_filtered", u(tc.tags), u(tc.tags), u(tc.tags) + " reported tags are ungapped with an E-value of at most 1.");
    r.add("count", "tot", u(tot), u(tc.tags),
          u(tot) + " C-terminal tag ends match a residue key, labelled K and R+10 included.");
    r.add("count", "n_c", u(n_c), u(tc.tags), u(n_c) + " C-terminal tag ends match a residue, labelled K counted as K and R+10 left out.");
    r.add("count", "n_n", u(n_n), u(tc.tags), u(n_n) + " N-terminal tag ends match a residue, labelled K counted as K and R+10 left out.");

    for (const char* key : kKeys7)
    {
      const int k = keyIndex(key);
      r.add("residue", std::string("C.") + key, u(tc.res(k)), u(tot),
            u(tc.res(k)) + " tag ends are a C-terminal " + key + " (" + u(tc.c_near[k]) + " after a y tag, " +
                u(tc.n_h2o[k]) + " before a reversed b tag).");
    }
    for (const char* key : kKeys7)
    {
      const int k = keyIndex(key);
      r.add("residue", std::string("N.") + key, u(tc.n_near[k]), "-", u(tc.n_near[k]) + " tag ends are an N-terminal " + key + ".");
    }

    for (int p = 3; p >= 0; --p)
    {
      std::uint64_t col = 0;
      for (int a = 0; a < kNumAA; ++a) col += tc.cpos[p][a];
      for (int a = 0; a < kNumAA; ++a)
        r.add("pos", "C.P" + std::to_string(p + 1) + "." + kAAs[a], u(tc.cpos[p][a]), u(col),
              u(tc.cpos[p][a]) + " of " + u(col) + " C-terminal tag ends have " + kAAs[a] + " at P" + std::to_string(p + 1) + ".");
    }
    for (int p = 0; p < 4; ++p)
    {
      std::uint64_t col = 0;
      for (int a = 0; a < kNumAA; ++a) col += tc.npos[p][a];
      for (int a = 0; a < kNumAA; ++a)
        r.add("pos", "N.P" + std::to_string(p + 1) + "'." + kAAs[a], u(tc.npos[p][a]), u(col),
              u(tc.npos[p][a]) + " of " + u(col) + " N-terminal tag ends have " + kAAs[a] + " at P" + std::to_string(p + 1) + "'.");
    }

    // ---- shares, as 0.1.3 computes them from res / tot
    const auto& keys = residueKeys();
    if (tot > 0)
    {
      PySum kr, anch;
      for (int k = 0; k < kNumKeys; ++k)
        if (keys[k].name[0] == 'K' || keys[k].name[0] == 'R')
          kr.add(static_cast<double>(tc.res(k)) / static_cast<double>(tot));
      for (const char* a : {"L", "V", "F", "Y", "M"})
        anch.add(static_cast<double>(tc.res(keyIndex(a))) / static_cast<double>(tot));
      r.add("share", "kr", num(kr.value()), u(tot), "A share of " + f(kr.value(), 3) + " of the C-terminal tag ends are K or R, labelled ones included.");
      r.add("share", "anchors_LVFYM", num(anch.value()), u(tot), "A share of " + f(anch.value(), 3) + " of the C-terminal tag ends are L, V, F, Y or M.");
    }
    else
    {
      r.add("share", "kr", "-", "0", "No C-terminal tag end matches a residue.");
      r.add("share", "anchors_LVFYM", "-", "0", "No C-terminal tag end matches a residue.");
    }
    const double nd = static_cast<double>(nterm[static_cast<std::size_t>(aaIndex('D'))]) / static_cast<double>(std::max<std::uint64_t>(n_n, 1));
    r.add("share", "nterm_D", num(nd), u(n_n), "A share of " + f(nd, 3) + " of the N-terminal tag ends are D.");

    // ---- models and the call
    const Classification c = classify(cterm, nterm, table, s.background_share, s.tag_min);
    for (const ModelScore& m : c.scores)
    {
      r.add("model", m.name + ".loglik", num(m.loglik), u(c.n_c + (c.uses_nterm ? c.n_n : 0)),
            m.name + " gives the tag ends a log-likelihood of " + g(m.loglik, 6) + ".");
      r.add("model", m.name + ".class", m.cls, "-", m.name + " belongs to the class " + m.cls + ".");
    }

    // ---- the distributions the models are scored with, normalised, before mixing
    auto dist = [&](const std::string& section, const std::string& prefix, const Dist& d,
                    const std::string& who) {
      double z = 0.0;
      for (double x : d) z += x;
      for (int a = 0; a < kNumAA; ++a)
      {
        const double v = z > 0.0 ? d[a] / z : 0.0;
        r.add(section, prefix + kAAs[a], num(v), "-", who + " gives " + kAAs[a] + " a share of " + f(v, 4) + ".");
      }
    };
    dist("background", "C.", table.bg_c, "The C-terminal background");
    dist("background", "N.", table.bg_n, "The N-terminal background");
    if (c.scored)
      for (const Model& m : table.models)
      {
        dist("model", m.name + ".C.", m.c_bg ? table.bg_c : m.c, m.name + " at the C end");
        dist("model", m.name + ".N.", m.n_bg ? table.bg_n : m.n, m.name + " at the N end");
      }

    // no-call rules, in order
    const std::string inst = lower(meta.instrument_name + " " + meta.instrument_model);
    const bool tims_yes = inst.find("timstof") != std::string::npos || meta.native_id_type == "MS:1002818" ||
                          meta.native_id_type == "MS:1002819" || meta.im_vssc > 0;
    const std::string tims = tims_yes ? "yes" : (have_inst || !meta.native_id_type.empty()) ? "no" : "unknown";
    constexpr double kY1K = 147.1128;
    const std::string scan = meta.scan_low.empty() ? "unknown" : low > kY1K + 0.1 ? "yes" : "no";
    // 0.1.3's own gate: the median lowest MS2 peak, which needs no metadata.
    const std::string fpk = meta.first_peak.empty() ? "unknown" : first > kY1K + 0.1 ? "yes" : "no";
    const std::string few = (tot < static_cast<std::uint64_t>(std::max(0, s.tag_min)) || !c.scored) ? "yes" : "no";
    const std::string lowres = s.low_resolution ? "yes" : "no";
    const std::string nonfin = c.scored && c.nonfinite ? "yes" : "no";
    const std::string tie = c.scored && !c.tied.empty() ? "yes" : "no";
    std::string reason;
    for (const auto& [name, v] : {std::pair{"low_resolution", lowres}, std::pair{"timstof", tims},
                                  std::pair{"ms2_scan_window", scan}, std::pair{"ms2_first_peak", fpk},
                                  std::pair{"few_tags", few}, std::pair{"nonfinite_score", nonfin},
                                  std::pair{"tie", tie}})
      if (reason.empty() && v == "yes") reason = name;
    std::string tied_names;
    for (const std::string& t : c.tied) tied_names += (tied_names.empty() ? "" : ", ") + t;

    if (reason.empty())
    {
      const ModelScore& top = c.scores[static_cast<std::size_t>(c.top)];
      const std::string used = c.uses_nterm ? u(c.n_c) + " C- and " + u(c.n_n) + " N-terminal" : u(c.n_c) + " C-terminal";
      r.add("call", "status", "call", u(c.n_c), top.name + " fits the " + used + " tag ends best.");
      r.add("call", "model", top.name, u(c.n_c), "The call is " + top.name + ".");
      r.add("call", "class", top.cls, "-", top.name + " belongs to the class " + top.cls + ".");
      if (c.runner_up >= 0)
      {
        const ModelScore& ru = c.scores[static_cast<std::size_t>(c.runner_up)];
        r.add("call", "runner_up", ru.name, "-", "The best model of another class is " + ru.name + ".");
        r.add("call", "runner_up_class", ru.cls, "-", ru.name + " belongs to the class " + ru.cls + ".");
        r.add("call", "margin", num(c.margin), u(c.n_c + (c.uses_nterm ? c.n_n : 0)),
              top.name + " fits " + g(c.margin, 3) + " log-likelihood per tag end better than " + ru.name + ".");
      }
      else
      {
        r.add("call", "runner_up", "none", "-", "No model of another class is in the table.");
        r.add("call", "runner_up_class", "none", "-", "No model of another class is in the table.");
        r.add("call", "margin", "-", "-", "Without a model of another class there is no margin.");
      }
      r.add("call", "uses_nterm", c.uses_nterm ? "yes" : "no", u(c.n_n),
            c.uses_nterm ? "The call uses the " + u(c.n_n) + " N-terminal tag ends."
                         : "The call leaves out the N-terminal tag ends: " + u(c.n_n) + " are fewer than " + std::to_string(s.tag_min) + ".");
    }
    else
    {
      std::string why;
      if (reason == "low_resolution") why = "the fragment tolerance is in Da, so the residue windows do not hold";
      else if (reason == "timstof") why = "the input is from a timsTOF";
      else if (reason == "ms2_scan_window") why = "the median MS2 scan window starts at m/z " + f(low, 2) + ", above y1 of K plus 0.1 (147.21)";
      else if (reason == "ms2_first_peak") why = "the median first MS2 peak is at m/z " + f(first, 2) + ", above y1 of K plus 0.1 (147.21)";
      else if (reason == "nonfinite_score") why = "a residue seen at the tag ends has probability 0 under the call or the runner-up";
      else if (reason == "tie") why = tied_names + " fit the tag ends equally well";
      else why = u(n_c) + " C-terminal tag ends are fewer than " + std::to_string(s.tag_min);
      r.add("call", "status", "no_call", u(c.n_c), "No protease is called: " + why + ".");
      r.add("call", "reason", reason, "-", "The first no-call rule that applies is " + reason + ".");
      if (reason == "tie")
        r.add("call", "tied", tied_names, std::to_string(c.tied.size()), tied_names + " have the same log-likelihood.");
    }

    r.add("nocall", "low_resolution", lowres, "-",
          s.low_resolution ? "The fragment tolerance is in Da." : "The fragment tolerance is in ppm.");
    r.add("nocall", "timstof", tims, "-",
          tims == "yes" ? "The instrument, the native ID format or a 1/K0 ion mobility marks the input as timsTOF data."
          : tims == "no" ? "Neither the instrument, the native ID format nor the ion mobility marks the input as timsTOF data."
                         : "The input names no instrument and no native ID format (metadata absent).");
    r.add("nocall", "ms2_scan_window", scan, u(meta.scan_low.size()),
          scan == "unknown" ? "No MS2 spectrum states its scan window (metadata absent)."
                            : "The median MS2 scan window starts at m/z " + f(low, 2) + (scan == "yes" ? ", above" : ", not above") +
                                  " y1 of K plus 0.1 (147.21).");
    r.add("nocall", "ms2_first_peak", fpk, u(meta.first_peak.size()),
          fpk == "unknown" ? "No MS2 spectrum has a peak."
                           : "The median first MS2 peak is at m/z " + f(first, 2) + (fpk == "yes" ? ", above" : ", not above") +
                                 " y1 of K plus 0.1 (147.21).");
    r.add("nocall", "few_tags", few, u(n_c),
          u(tot) + " residue-key and " + u(n_c) + " C-terminal tag ends against a minimum of " + std::to_string(s.tag_min) + ".");
    r.add("nocall", "nonfinite_score", nonfin, "-",
          nonfin == "yes" ? "The call or the runner-up gives a residue seen at the tag ends probability 0."
                          : "The call and the runner-up have finite log-likelihoods, or no call was scored.");
    r.add("nocall", "tie", tie, std::to_string(c.tied.size()),
          tie == "yes" ? tied_names + " have the same log-likelihood."
                       : "No model of another class has the call's log-likelihood, or no call was scored.");
    return out;
  }

  std::vector<Row> labelRows(const TerminusCounter& tc, const DigestSettings& s)
  {
    std::vector<Row> out;
    Rows r{out};
    r.add("run", "window_da", num(s.window), "-", "A tag end counts for a label when its mass is within " + num(s.window) + " Da of it.");
    r.add("run", "low_resolution", s.low_resolution ? "yes" : "no", "-",
          s.low_resolution ? "The fragment tolerance is in Da, so the label windows do not hold."
                           : "The fragment tolerance is in ppm.");
    r.add("run", "silac_min", std::to_string(s.silac_min), "-",
          "The heavy shares are gated on " + std::to_string(s.silac_min) + " K- and R-terminal tag ends each.");
    r.add("count", "tags_filtered", u(tc.tags), u(tc.tags), u(tc.tags) + " reported tags are ungapped with an E-value of at most 1.");
    const auto& labs = labelKeys();
    for (std::size_t l = 0; l < labs.size(); ++l)
    {
      const std::string L = labs[l].name;
      const std::uint64_t x = tc.lab_n[l] + tc.lab_c[l], bg = tc.lab_bg_n[l] + tc.lab_bg_c[l];
      r.add("nlabel", L + ".count", u(x), u(tc.tags),
            u(x) + " tag ends are a bare " + f(labs[l].mass, 4) + " Da gap (" + L + "), " + u(tc.lab_n[l]) + " N- and " + u(tc.lab_c[l]) + " C-terminal.");
      r.add("nlabel", L + ".background", u(bg), u(tc.tags), u(bg) + " tag ends are a gap of " + f(labs[l].mass + 0.5, 4) + " Da, 0.5 Da above " + L + ".");
      const std::string sh = tc.tags ? num(static_cast<double>(x) / static_cast<double>(tc.tags)) : "-";
      r.add("nlabel", L + ".share", sh, u(tc.tags),
            tc.tags ? "A share of " + g(static_cast<double>(x) / static_cast<double>(tc.tags), 3) + " of the filtered tags end in the " + L + " gap."
                    : "There are no filtered tags.");
    }
    const std::uint64_t tot = tc.tot();
    const int K = keyIndex("K"), K8 = keyIndex("K+8"), R = keyIndex("R"), R10 = keyIndex("R+10");
    auto heavy = [&](int light, int hv) -> double {
      const double sl = static_cast<double>(tc.res(light)) / static_cast<double>(tot);
      const double sh = static_cast<double>(tc.res(hv)) / static_cast<double>(tot);
      return sh / std::max(sh + sl, 1e-9);
    };
    const double hk = tot ? heavy(K, K8) : 0.0, hr = tot ? heavy(R, R10) : 0.0;
    r.add("heavy", "K8.share", tot ? num(hk) : "-", u(tc.res(K) + tc.res(K8)),
          !tot ? "No C-terminal tag end matches a residue." : "Lys8 is a share of " + g(hk, 3) + " of the C-terminal K and Lys8 ends.");
    r.add("heavy", "R10.share", tot ? num(hr) : "-", u(tc.res(R) + tc.res(R10)),
          !tot ? "No C-terminal tag end matches a residue." : "Arg10 is a share of " + g(hr, 3) + " of the C-terminal R and Arg10 ends.");
    const std::uint64_t nk = tc.res(K) + tc.res(K8), nr = tc.res(R) + tc.res(R10);
    r.add("heavy", "K.tags", u(nk), "-", u(nk) + " C-terminal tag ends are K or Lys8.");
    r.add("heavy", "R.tags", u(nr), "-", u(nr) + " C-terminal tag ends are R or Arg10.");
    const std::uint64_t smin = static_cast<std::uint64_t>(std::max(0, s.silac_min));
    r.add("heavy", "gate", nk >= smin && nr >= smin ? "yes" : "no", "-",
          u(nk) + " K and " + u(nr) + " R tag ends against a minimum of " + std::to_string(s.silac_min) + " each.");
    return out;
  }

  std::vector<Row> massgapRows(const std::vector<GapRow>& rows, const std::vector<std::string>& keys,
                               const std::vector<GapMod>& mods, const std::vector<Combo>& combos,
                               const std::vector<GapMod>& cys, const GapSettings& s)
  {
    std::vector<Row> out;
    Rows r{out};
    const double t = s.window;
    r.add("run", "window_da", num(t), "-", "Gaps within " + num(t) + " Da count as one mass.");
    r.add("run", "min_spectra", u(s.min_spectra), "-", "A gap peak needs " + u(s.min_spectra) + " spectra.");
    r.add("run", "min_share", num(s.min_share), "-", "A gap peak needs a share of " + num(s.min_share) + " of the placed spectra.");
    r.add("run", "min_bin", u(s.min_bin), "-", "Histogram rows with fewer than " + u(s.min_bin) + " spectra are left out of the peaks.");
    r.add("run", "max_mods", std::to_string(s.max_mods), "-", "A gap is explained by up to " + std::to_string(s.max_mods) + " modifications.");
    r.add("run", "mods", std::to_string(mods.size()), "-", std::to_string(mods.size()) + " modifications are combined.");

    std::uint64_t all = 0, zero = 0;
    for (std::size_t i = 0; i < rows.size(); ++i)
    {
      all += rows[i].spectra;
      if (std::fabs(rows[i].delta) <= t) zero += rows[i].spectra;
      r.add("hist", keys[i], u(rows[i].spectra), "-", u(rows[i].spectra) + " placed spectra have a gap of " + keys[i] + " Da.");
    }
    r.add("cys", "spectra", u(all), "-", u(all) + " spectra are placed with a mass gap.");
    r.add("cys", "zero_bin", u(zero), u(all), u(zero) + " placed spectra have a gap within " + num(t) + " Da of zero.");
    for (const GapMod& m : cys)
    {
      std::uint64_t n = 0;
      for (const GapRow& h : rows)
        if (std::fabs(h.delta - m.mass) <= t) n += h.spectra;
      r.add("cys", m.site, u(n), u(all),
            u(n) + " placed spectra have a gap within " + num(t) + " Da of " + f(m.mass, 4) + " Da (" + m.site + ").");
    }

    std::vector<GapRow> hist;
    for (const GapRow& h : rows)
      if (h.spectra >= s.min_bin) hist.push_back(h);
    const GapResult res = detectGaps(hist, mods, combos, t, s.min_spectra, s.min_share, s.silac_share, s.silac_min);
    r.add("combo", "placed_spectra", u(res.placed), "-",
          u(res.placed) + " placed spectra are in histogram rows of at least " + u(s.min_bin) + ".");
    r.add("combo", "shifted_spectra", u(res.shifted), u(res.placed),
          u(res.shifted) + " of them have a gap more than " + num(2 * t) + " Da from zero.");

    // members joined by " + ": names contain '+' (Met-loss+Acetyl) but no space
    auto names = [&](const std::vector<int>& c) {
      std::string x;
      for (int m : c) x += (x.empty() ? "" : " + ") + mods[static_cast<std::size_t>(m)].name;
      return x;
    };
    for (std::size_t i = 0; i < res.peaks.size(); ++i)
    {
      const GapPeak& p = res.peaks[i];
      const std::string k = std::to_string(i + 1) + ".";
      r.add("peak", k + "delta", num(p.delta), u(p.spectra), "Peak " + std::to_string(i + 1) + " is at " + f(p.delta, 4) + " Da.");
      r.add("peak", k + "spectra", u(p.spectra), "-", u(p.spectra) + " placed spectra are in peak " + std::to_string(i + 1) + ".");
      const std::string ex = p.explained_by.empty() ? "none" : names(p.explained_by);
      r.add("peak", k + "explained_by", ex, u(p.spectra),
            p.explained_by.empty() ? "No combination of up to " + std::to_string(s.max_mods) + " modifications is taken for peak " + std::to_string(i + 1) + "."
                                   : ex + " sums to the gap of peak " + std::to_string(i + 1) + " within " + num(t) + " Da.");
      std::string alt;
      for (const auto& c : p.alternatives) alt += (alt.empty() ? "" : ";") + names(c);
      r.add("peak", k + "alternatives", alt.empty() ? "-" : alt, "-",
            alt.empty() ? "No other combination fits peak " + std::to_string(i + 1) + "."
                        : std::to_string(p.alternatives.size()) + " other combinations fit peak " + std::to_string(i + 1) + ".");
      r.add("peak", k + "context", p.context.empty() ? "-" : p.context, "-",
            p.explained_by.empty() ? "Peak " + std::to_string(i + 1) + " has no explanation."
            : p.context.empty()    ? "The explanation of peak " + std::to_string(i + 1) + " is the first by size and prior."
                              : "The explanation of peak " + std::to_string(i + 1) + " was chosen because its " + p.context + ".");
    }

    std::vector<std::pair<int, double>> share = res.share;
    std::stable_sort(share.begin(), share.end(), [](const auto& a, const auto& b) { return -a.second < -b.second; });
    for (const auto& [m, v] : share)
      r.add("share", mods[static_cast<std::size_t>(m)].name, num(v), u(res.shifted),
            "The peaks " + mods[static_cast<std::size_t>(m)].name + " explains hold a share of " + g(v, 3) + " of the shifted spectra.");
    for (int i = 0; i < s.top && static_cast<std::size_t>(i) < share.size(); ++i)
      r.add("top", std::to_string(i + 1), mods[static_cast<std::size_t>(share[static_cast<std::size_t>(i)].first)].name, "-",
            mods[static_cast<std::size_t>(share[static_cast<std::size_t>(i)].first)].name + " has the " + std::to_string(i + 1) +
                (i == 0 ? "st" : i == 1 ? "nd" : i == 2 ? "rd" : "th") + " largest share.");
    r.add("silac", "call", res.silac, u(res.shifted),
          res.silac == "none" ? "Fewer than two SILAC labels reach a share of " + num(s.silac_share) + " of at least " + u(s.silac_min) + " shifted spectra."
                              : "Two or more SILAC labels each explain a share of at least " + num(s.silac_share) + " of " + u(res.shifted) + " shifted spectra.");
    const char* lab[4] = {"Lys4", "Arg6", "Lys8", "Arg10"};
    for (int i = 0; i < 4; ++i)
      r.add("silac", lab[i], num(res.silac_share[static_cast<std::size_t>(i)]), u(res.shifted),
            std::string(lab[i]) + " explains a share of " + g(res.silac_share[static_cast<std::size_t>(i)], 3) + " of the shifted spectra.");
    return out;
  }
}
