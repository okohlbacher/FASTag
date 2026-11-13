// The rows of -digest_out, -label_out and -massgap_out (see Digest.h).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
//
// Compiled with -ffp-contract=off, like Digest.cpp, to match the reference's
// floating-point results.

#include "Digest.h"

#include <OpenMS/DATASTRUCTURES/StringUtils.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
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

    const char* kKeys7[] = {"K", "K+TMT", "K+TMTpro", "K+iTRAQ4", "K+8", "R", "R+10"};

    int keyIndex(const std::string& name)
    {
      const auto& keys = residueKeys();
      for (int k = 0; k < NUM_KEYS; ++k)
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
          s.models == "shipped" ? "The models are the cleavage rules shipped with FASTag."
          : s.models == "shipped_v2" ? "The models are the v2 table shipped with FASTag (-digest_models_version v2)."
                                     : "The models are read from " + s.models + ".");
    r.add("run", "background", s.background, "-",
          s.background == "shipped_human" ? "The background is the residue composition of the human reference proteome shipped with FASTag."
          : s.background == "models_table" ? "The background is the one in the model table."
                                           : "The background is the residue composition of " + s.background.substr(6) +
                                                 (s.background_pseudocount ? ", with one count added to every residue because one is absent." : "."));
    // 1.12 D (#3c-#3f): the v2 settings, only when one of them is on or the
    // table is a v2 table (its specificity rows change the scores).
    const bool v2 = s.chemV2() || table.version == 2;
    if (v2)
    {
      r.add("run", "models_version", table.version == 2 ? "v2" : "v1", "-",
            table.version == 2 ? "The model table is a v2 table (detection, reference and specificity rows); not validated on held-out data."
                               : "The model table is a v1 table.");
      r.add("run", "specificity", table.has_specificity ? num(table.s_trypsin) + "," + num(table.s_nontryptic) : "-", "-",
            table.has_specificity ? "The Trypsin-class models are mixed with the background at a share of " + num(table.s_trypsin) +
                                        ", every other model at " + num(table.s_nontryptic) + " (the table's specificity rows)."
                                  : "Every model is mixed at the background share above.");
      r.add("run", "reference_kr", table.has_reference ? num(table.ref_k) + "," + num(table.ref_r) : "-", "-",
            table.has_reference ? "The detection weights were fitted against an in-silico tryptic K share of " + num(table.ref_k) +
                                      " and R share of " + num(table.ref_r) + "."
                                : "The table names no reference K:R.");
      r.add("run", "detection", s.detection ? "shipped" : "none", "-",
            s.detection ? "The tag ends are scored with the table's detection weights of the run's instrument class; not validated on held-out data."
                        : "No detection weights are applied.");
      r.add("run", "flank2", s.flank2 ? "auto" : "off", "-",
            s.flank2 ? "Two-residue flank masses are scored when the P1 counts are too few or y1 is cut off; not validated on held-out data."
                     : "Two-residue flank masses are not scored.");
      r.add("run", "min_confidence", num(s.min_confidence), "-",
            s.min_confidence > 0 ? "A call with a calibrated p_correct below " + num(s.min_confidence) + " is a no_call (low_confidence)."
                                 : "No call is withheld for its p_correct.");
      r.add("run", "calibration", s.calibration.loaded ? s.calibration_source : "-", "-",
            s.calibration.loaded ? (s.calibration_source == "shipped" ? "p_correct uses the calibration shipped with FASTag."
                                                                      : "p_correct uses the calibration in " + s.calibration_source + ".")
                                 : "No p_correct is computed.");
    }

    // ---- meta
    const bool have_inst = !meta.instrument_name.empty() || !meta.instrument_model.empty();
    r.add("meta", "instrument", meta.instrument_name.empty() ? "-" : meta.instrument_name, "-",
          meta.instrument_name.empty() ? "The input names no instrument (metadata absent)." : "The input names the instrument " + meta.instrument_name + ".");
    r.add("meta", "instrument_model", meta.instrument_model.empty() ? "-" : meta.instrument_model, "-",
          meta.instrument_model.empty() ? "The input names no instrument model (metadata absent)." : "The input names the instrument model " + meta.instrument_model + ".");
    // The peak-list and generic native ID formats name no vendor, so they say nothing about
    // the instrument: MS:1000774 multiple peak list (MGF; FASTag's -out_spectra from an MGF),
    // MS:1000775 single peak list, MS:1000776 scan number only, MS:1000777 spectrum identifier
    // (what OpenMS writes when the type is unknown, so every FileConverter mzML made from an
    // MGF carries it), MS:1000824 no nativeID format.
    const std::string& nid = meta.native_id_type;
    const bool nid_generic = nid == "MS:1000774" || nid == "MS:1000775" || nid == "MS:1000776" ||
                             nid == "MS:1000777" || nid == "MS:1000824";
    const bool have_nid = !meta.native_id_type.empty() && !nid_generic;
    r.add("meta", "native_id_format", meta.native_id_type.empty() ? "-" : meta.native_id_type, "-",
          meta.native_id_type.empty() ? "The input names no native ID format (metadata absent)."
          : nid_generic ? "The native ID format of the input is the generic " + meta.native_id_type + ", which names no instrument (metadata absent)."
                        : "The native ID format of the input is " + meta.native_id_type + ".");
    const std::uint64_t im = meta.im_vssc + meta.im_drift + meta.im_faims + meta.im_other;
    const std::string im_word = meta.ms2 == 0 || meta.im_unread ? "absent" : im ? "yes" : "no";
    r.add("meta", "ion_mobility", im_word, u(meta.ms2),
          meta.im_unread ? "The input format carries no ion mobility (metadata absent)."
          : meta.ms2 == 0 ? "No MS2 spectrum was read (metadata absent)."
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
    const double whole = meta.peaks ? static_cast<double>(meta.peaks_whole) / static_cast<double>(meta.peaks) : 0.0;
    r.add("meta", "ms2_whole_intensity_share", meta.peaks ? num(whole) : "-", u(meta.peaks),
          meta.peaks ? "A share of " + f(whole, 4) + " of the " + u(meta.peaks) + " MS2 peak intensities above 0 are whole numbers."
                     : "No MS2 spectrum has a peak with an intensity above 0.");
    const std::string inst_class = instrumentClass(meta);
    if (v2)
      r.add("meta", "instrument_class", inst_class, "-",
            "The detection class of the run is " + inst_class + " (orbitrap_hcd, timstof or other).");

    // ---- counts
    const auto cterm = tc.cterm(), nterm = tc.nterm();
    std::uint64_t n_c = 0, n_n = 0;
    for (int a = 0; a < NUM_AA; ++a) { n_c += cterm[a]; n_n += nterm[a]; }
    const std::uint64_t tot = tc.tot();
    r.add("count", "tags_filtered", u(tc.tags), u(tc.tags), u(tc.tags) + " reported tags are ungapped with an E-value of at most 1.");
    r.add("count", "tot", u(tot), u(tc.tags),
          u(tot) + " C-terminal tag ends match a residue key, labelled K and R+10 included.");
    r.add("count", "n_c", u(n_c), u(tc.tags), u(n_c) + " C-terminal tag ends match a residue, labelled K counted as K and R+10 left out.");
    r.add("count", "n_n", u(n_n), u(tc.tags), u(n_n) + " N-terminal tag ends match a residue, labelled K counted as K and R+10 left out.");
    std::uint64_t n_f2 = 0;
    for (std::uint64_t v : tc.dip) n_f2 += v;
    if (v2 && s.flank2)
      r.add("count", "flank2_n", u(n_f2), u(tc.tags), u(n_f2) + " tag ends are a two-residue flank sum (C-terminal, or N-terminal less H2O).");

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
      for (int a = 0; a < NUM_AA; ++a) col += tc.cpos[p][a];
      for (int a = 0; a < NUM_AA; ++a)
        r.add("pos", "C.P" + std::to_string(p + 1) + "." + AAS[a], u(tc.cpos[p][a]), u(col),
              u(tc.cpos[p][a]) + " of " + u(col) + " C-terminal tag ends have " + AAS[a] + " at P" + std::to_string(p + 1) + ".");
    }
    for (int p = 0; p < 4; ++p)
    {
      std::uint64_t col = 0;
      for (int a = 0; a < NUM_AA; ++a) col += tc.npos[p][a];
      for (int a = 0; a < NUM_AA; ++a)
        r.add("pos", "N.P" + std::to_string(p + 1) + "'." + AAS[a], u(tc.npos[p][a]), u(col),
              u(tc.npos[p][a]) + " of " + u(col) + " N-terminal tag ends have " + AAS[a] + " at P" + std::to_string(p + 1) + "'.");
    }

    // ---- shares, from res / tot as the reference computes them
    if (tot > 0)
    {
      const double kr = krShare(tc);
      PySum anch;
      for (const char* a : {"L", "V", "F", "Y", "M"})
        anch.add(static_cast<double>(tc.res(keyIndex(a))) / static_cast<double>(tot));
      r.add("share", "kr", num(kr), u(tot), "A share of " + f(kr, 3) + " of the C-terminal tag ends are K or R, labelled ones included.");
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
    // 1.12 D: detection (#3c) and the table's specificity (#3e); inactive
    // at the defaults, where this is the 1.11 classifier.
    ClassifyOptions opt;
    if (s.detection) opt.detection = table.detectionFor(inst_class);
    if (table.has_specificity)
    {
      opt.specificity = true;
      opt.s_trypsin = table.s_trypsin;
      opt.s_nontryptic = table.s_nontryptic;
    }
    Classification c = classify(cterm, nterm, table, s.background_share, s.tag_min, opt);
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
      for (int a = 0; a < NUM_AA; ++a)
      {
        const double v = z > 0.0 ? d[a] / z : 0.0;
        r.add(section, prefix + AAS[a], num(v), "-", who + " gives " + AAS[a] + " a share of " + f(v, 4) + ".");
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
    const std::string inst = OpenMS::StringUtils::toLowered(meta.instrument_name + " " + meta.instrument_model);
    const bool tims_yes = inst.find("timstof") != std::string::npos || meta.native_id_type == "MS:1002818" ||
                          meta.native_id_type == "MS:1002819" || meta.im_vssc > 0;
    const std::string tims = tims_yes ? "yes" : (have_inst || have_nid) ? "no" : "unknown";
    constexpr double kY1K = 147.1128;
    const std::string scan = meta.scan_low.empty() ? "unknown" : low > kY1K + 0.1 ? "yes" : "no";
    // The reference's gate: the median lowest MS2 peak, which needs no metadata.
    const std::string fpk = meta.first_peak.empty() ? "unknown" : first > kY1K + 0.1 ? "yes" : "no";
    // Without instrument metadata (MGF, converted pseudo-spectra), intensities
    // that are mostly whole numbers are ion counts, as timsTOF data are.
    constexpr double kWholeShare = 0.5;
    const std::string counts = tims != "unknown" ? "no" : meta.peaks == 0 ? "unknown" : whole >= kWholeShare ? "yes" : "no";
    const std::string few = (tot < static_cast<std::uint64_t>(std::max(0, s.tag_min)) || !c.scored) ? "yes" : "no";
    const std::string lowres = s.low_resolution ? "yes" : "no";
    const std::string nonfin = c.scored && c.nonfinite ? "yes" : "no";
    const std::string tie = c.scored && !c.tied.empty() ? "yes" : "no";
    // 1.12 D: with detection weights for the run's class (#3c), a timsTOF
    // run is called rather than withheld (the timsTOF call).
    const bool tims_call = opt.detection != nullptr && inst_class == "timstof";
    const std::string tims_rule = tims_call && tims == "yes" ? "no" : tims;
    const std::string counts_rule = tims_call && counts == "yes" ? "no" : counts;
    std::string reason;
    for (const auto& [name, v] : {std::pair{"low_resolution", lowres}, std::pair{"timstof", tims_rule},
                                  std::pair{"ms2_scan_window", scan}, std::pair{"ms2_first_peak", fpk},
                                  std::pair{"ion_counts", counts_rule}, std::pair{"few_tags", few}, std::pair{"nonfinite_score", nonfin},
                                  std::pair{"tie", tie}})
      if (reason.empty() && v == "yes") reason = name;
    // 1.12 D #3d: when the P1 counts are too few or y1 is cut off, the
    // two-residue flank masses are scored instead, if there are enough.
    bool flank2_used = false;
    if (s.flank2 && tc.flank2() &&
        (reason == "timstof" || reason == "ms2_scan_window" || reason == "ms2_first_peak" || reason == "ion_counts" ||
         reason == "few_tags"))
    {
      Classification c2 = classify2(tc.dip, *tc.flank2Table(), table, s.background_share, s.tag_min, opt);
      if (c2.scored)
      {
        flank2_used = true;
        for (const ModelScore& m : c2.scores)
          r.add("model", m.name + ".flank2_loglik", num(m.loglik), u(c2.n_c),
                m.name + " gives the two-residue flank sums a log-likelihood of " + g(m.loglik, 6) + ".");
        c = std::move(c2);
        reason.clear();
        if (c.nonfinite) reason = "nonfinite_score";
        else if (!c.tied.empty()) reason = "tie";
      }
    }
    // 1.12 D #3f: the calibrated p_correct of a call, and the low_confidence
    // no-call below -digest_min_confidence.
    double p_correct = std::numeric_limits<double>::quiet_NaN();
    if (s.calibration.loaded && reason.empty())
    {
      p_correct = pCorrect(s.calibration, c.margin, c.n_c + (c.uses_nterm ? c.n_n : 0), fpk == "yes");
      if (s.min_confidence > 0.0 && p_correct < s.min_confidence) reason = "low_confidence";
    }
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
      if (s.calibration.loaded)
        r.add("call", "p_correct", num(p_correct), u(c.n_c + (c.uses_nterm ? c.n_n : 0)),
              "The calibrated probability that the call is correct is " + f(p_correct, 3) + " (not validated on held-out data).");
    }
    else
    {
      std::string why;
      if (reason == "low_resolution") why = "the fragment tolerance is in Da, so the residue windows do not hold";
      else if (reason == "timstof") why = "the input is from a timsTOF";
      else if (reason == "ms2_scan_window") why = "the median MS2 scan window starts at m/z " + f(low, 2) + ", above y1 of K plus 0.1 (147.21)";
      else if (reason == "ms2_first_peak") why = "the median first MS2 peak is at m/z " + f(first, 2) + ", above y1 of K plus 0.1 (147.21)";
      else if (reason == "ion_counts")
        why = "the input names no instrument, and a share of " + f(whole, 4) + " of its MS2 peak intensities above 0 are whole numbers, as in timsTOF data";
      else if (reason == "nonfinite_score") why = "a residue seen at the tag ends has probability 0 under the call or the runner-up";
      else if (reason == "tie") why = tied_names + " fit the tag ends equally well";
      else if (reason == "low_confidence")
        why = "the calibrated probability that " + c.scores[static_cast<std::size_t>(c.top)].name + " is correct, " + f(p_correct, 3) +
              ", is below " + num(s.min_confidence);
      else why = u(n_c) + " C-terminal tag ends are fewer than " + std::to_string(s.tag_min);
      r.add("call", "status", "no_call", u(c.n_c), "No protease is called: " + why + ".");
      r.add("call", "reason", reason, "-", "The first no-call rule that applies is " + reason + ".");
      if (reason == "tie")
        r.add("call", "tied", tied_names, std::to_string(c.tied.size()), tied_names + " have the same log-likelihood.");
      if (reason == "low_confidence")
        r.add("call", "p_correct", num(p_correct), u(c.n_c + (c.uses_nterm ? c.n_n : 0)),
              "The calibrated probability that the call is correct is " + f(p_correct, 3) + " (not validated on held-out data).");
    }
    if (v2)
    {
      r.add("call", "flank2_used", flank2_used ? "yes" : "no", flank2_used ? u(c.n_c) : "-",
            flank2_used ? "The call is scored on " + u(c.n_c) + " two-residue flank sums, as the P1 counts are too few or y1 is cut off."
                        : "The call is scored on the P1 and P1' counts.");
      r.add("call", "timstof_call", tims_call ? "yes" : "no", "-",
            tims_call ? "The run is timsTOF data and is called with the timstof detection weights rather than withheld."
                      : "The timsTOF rule withholds the call as in FASTag 1.11, or the run is not timsTOF data.");
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
    r.add("nocall", "ion_counts", counts, u(meta.peaks),
          tims != "unknown" ? "The input names its instrument or native ID format, so the timstof rule decides."
          : meta.peaks == 0 ? "No MS2 spectrum has a peak with an intensity above 0."
                            : "The input names no instrument, and a share of " + f(whole, 4) + " of the MS2 peak intensities above 0 are whole numbers (" +
                                  (counts == "yes" ? "at least " : "below ") + f(kWholeShare, 2) + ").");
    r.add("nocall", "few_tags", few, u(n_c),
          u(tot) + " residue-key and " + u(n_c) + " C-terminal tag ends against a minimum of " + std::to_string(s.tag_min) + ".");
    r.add("nocall", "nonfinite_score", nonfin, "-",
          nonfin == "yes" ? "The call or the runner-up gives a residue seen at the tag ends probability 0."
                          : "The call and the runner-up have finite log-likelihoods, or no call was scored.");
    r.add("nocall", "tie", tie, std::to_string(c.tied.size()),
          tie == "yes" ? tied_names + " have the same log-likelihood."
                       : "No model of another class has the call's log-likelihood, or no call was scored.");
    if (s.calibration.loaded)
    {
      const bool low = reason == "low_confidence";
      r.add("nocall", "low_confidence", low ? "yes" : "no", "-",
            low ? "The calibrated p_correct " + f(p_correct, 3) + " is below " + num(s.min_confidence) + "."
            : std::isnan(p_correct) ? "No p_correct was computed: an earlier rule withheld the call."
                                    : "The calibrated p_correct " + f(p_correct, 3) + " is not below " + num(s.min_confidence) + ".");
    }
    return out;
  }

  // ---- 1.12 D: instrument class (#3c) ----
  Fragmentation fragmentationFromFilter(std::string_view filter)
  {
    bool beam = false, res = false;
    for (std::size_t at = filter.find('@'); at != std::string_view::npos; at = filter.find('@', at + 1))
    {
      std::string tok;
      for (std::size_t i = at + 1; i < filter.size(); ++i)
      {
        const char c = static_cast<char>(std::tolower(static_cast<unsigned char>(filter[i])));
        if (c < 'a' || c > 'z') break;
        tok += c;
      }
      if (tok == "hcd") beam = true;
      else if (tok == "cid" || tok == "pqd") res = true;
    }
    return beam ? Fragmentation::BEAM : res ? Fragmentation::RESONANCE : Fragmentation::UNKNOWN;
  }

  void addFragmentation(RunMeta& meta, Fragmentation frag, std::string_view filter)
  {
    if (frag == Fragmentation::UNKNOWN) frag = fragmentationFromFilter(filter);
    if (frag == Fragmentation::BEAM) ++meta.ms2_beam;
    else if (frag == Fragmentation::RESONANCE) ++meta.ms2_resonance;
    const std::size_t b = filter.find_first_not_of(" \t");
    if (b != std::string_view::npos && filter.size() - b >= 4)
    {
      std::string head(filter.substr(b, 4));
      for (char& c : head) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
      if (head == "ITMS") ++meta.ms2_itms;
      else if (head == "FTMS") ++meta.ms2_ftms;
    }
  }

  std::string instrumentClass(const RunMeta& meta)
  {
    // The timstof and ion_counts rules of digestRows(), read the same way.
    const std::string inst = OpenMS::StringUtils::toLowered(meta.instrument_name + " " + meta.instrument_model);
    const bool tims = inst.find("timstof") != std::string::npos || meta.native_id_type == "MS:1002818" ||
                      meta.native_id_type == "MS:1002819" || meta.im_vssc > 0;
    if (tims) return "timstof";
    const std::string& nid = meta.native_id_type;
    const bool nid_generic = nid == "MS:1000774" || nid == "MS:1000775" || nid == "MS:1000776" ||
                             nid == "MS:1000777" || nid == "MS:1000824";
    const bool have_meta = !meta.instrument_name.empty() || !meta.instrument_model.empty() || (!nid.empty() && !nid_generic);
    if (!have_meta && meta.peaks > 0 &&
        static_cast<double>(meta.peaks_whole) / static_cast<double>(meta.peaks) >= 0.5)
      return "timstof";
    bool orbi = meta.analyzer_orbitrap;
    for (const char* k : {"orbitrap", "q exactive", "exploris", "astral", "lumos", "fusion", "eclipse", "ascend"})
      if (inst.find(k) != std::string::npos) orbi = true;
    if (!orbi) return "other";
    if (meta.ms2_itms > meta.ms2_ftms) return "other";  // MS2 mostly read in the ion trap
    if (meta.ms2_beam + meta.ms2_resonance > 0)
      return meta.ms2_beam > meta.ms2_resonance ? "orbitrap_hcd" : "other";
    // No activation information: only what can only be HCD in the Orbitrap.
    for (const char* k : {"q exactive", "exploris", "astral"})
      if (inst.find(k) != std::string::npos) return "orbitrap_hcd";
    if (meta.analyzer_orbitrap && !meta.analyzer_iontrap) return "orbitrap_hcd";
    return "other";
  }
  // ---- end 1.12 D ----

  double krShare(const TerminusCounter& tc)
  {
    const auto& keys = residueKeys();
    const std::uint64_t tot = tc.tot();
    PySum kr;
    for (int k = 0; k < NUM_KEYS; ++k)
      if (keys[k].name[0] == 'K' || keys[k].name[0] == 'R')
        kr.add(static_cast<double>(tc.res(k)) / static_cast<double>(tot));
    return kr.value();
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

  namespace
  {
    /// The heavy share of -label_out's heavy rows: heavy / (heavy + light),
    /// both as shares of tot.
    double heavyShare(const TerminusCounter& tc, int light, int hv)
    {
      const std::uint64_t tot = tc.tot();
      const double sl = static_cast<double>(tc.res(light)) / static_cast<double>(tot);
      const double sh = static_cast<double>(tc.res(hv)) / static_cast<double>(tot);
      return sh / std::max(sh + sl, 1e-9);
    }

    /// @p v rounded to 3 decimals as Python's round(v, 3) rounds it: the
    /// decimal nearest to the double's exact value (no binary double lies
    /// exactly half-way between two 3-decimal numbers), read back.
    double round3(double v)
    {
      char b[64];
      std::snprintf(b, sizeof b, "%.3f", v);
      return std::strtod(b, nullptr);
    }
  }

  LabelCall labelCall(const TerminusCounter& tc, const DigestSettings& s)
  {
    LabelCall c;
    const std::uint64_t tot = tc.tot();
    if (tot > 0) c.kr_rounded = round3(krShare(tc));
    if (s.low_resolution) { c.reason = "low_resolution"; return c; }
    if (tot < LABEL_TAG_MIN) { c.reason = "few_tags"; return c; }
    c.called = true;
    const double tags = static_cast<double>(tc.tags);
    const auto& labs = labelKeys();
    for (std::size_t l = 0; l < labs.size(); ++l)
    {
      const double x = static_cast<double>(tc.lab_n[l] + tc.lab_c[l]);
      const double bg = static_cast<double>(tc.lab_bg_n[l] + tc.lab_bg_c[l]);
      if (x >= LABEL_MIN_SHARE * tags && x >= LABEL_BACKGROUND_FOLD * std::max(bg, 1.0))
      {
        c.labels.push_back(labs[l].name);
        c.isobaric = true;
      }
    }
    if (tot == 0) return c;  // no C-terminal end: the heavy shares are undefined, no SILAC test
    const int K = keyIndex("K"), K8 = keyIndex("K+8"), R = keyIndex("R"), R10 = keyIndex("R+10");
    const double hk = heavyShare(tc, K, K8), hr = heavyShare(tc, R, R10);
    const std::uint64_t nk = tc.res(K) + tc.res(K8), nr = tc.res(R) + tc.res(R10);
    const std::uint64_t smin = static_cast<std::uint64_t>(std::max(0, s.silac_min));
    if (hk >= HEAVY_MIN && hr >= HEAVY_MIN && c.kr_rounded >= KR_TRYPTIC && std::min(nk, nr) >= smin)
    {
      c.labels.push_back("SILAC");
      c.silac = true;
      c.silac_strong = std::min(hk, hr) >= HEAVY_STRONG;
    }
    return c;
  }

  std::vector<Row> labelCallRows(const LabelCall& c, const TerminusCounter& tc, const DigestSettings& s)
  {
    std::vector<Row> out;
    Rows r{out};
    const std::uint64_t tot = tc.tot();
    const std::string sec = "label_call";
    if (!c.called)
    {
      const std::string why =
          c.reason == "low_resolution"
              ? "the fragment tolerance is in Da, so the label windows do not hold"
              : u(tot) + " C-terminal tag ends are fewer than " + std::to_string(LABEL_TAG_MIN);
      r.add(sec, "status", "no_call", u(tot), "No label is called: " + why + ".");
      r.add(sec, "label", "-", "-", "There is no label call.");
      r.add(sec, "basis", "-", "-", "There is no label call.");
      r.add(sec, "silac", "-", "-", "There is no label call.");
      r.add(sec, "reason", c.reason, "-", "The first no-call rule that applies is " + c.reason + ".");
      return out;
    }
    std::string label;
    for (const std::string& l : c.labels) label += (label.empty() ? "" : "+") + l;
    if (label.empty()) label = "label-free";
    r.add(sec, "status", "call", u(tot),
          "A label call is made from " + u(tot) + " C-terminal tag ends and " + u(tc.tags) + " filtered tags.");
    std::string desc;
    if (c.labels.empty())
      desc = "No label passes: no isobaric gap reaches " + g(LABEL_MIN_SHARE * 100, 3) + "% of the filtered tags and " +
             g(LABEL_BACKGROUND_FOLD, 3) + "x its background, and the heavy shares do not make SILAC.";
    else
    {
      desc = "The run is labelled " + label + ".";
      for (const std::string& l : c.labels)
        if (l == "TMTpro") desc += " TMTpro and iTRAQ8plex have the same mass; the reporter ions decide.";
    }
    r.add(sec, "label", label, u(tc.tags), desc);
    std::string basis = c.isobaric ? "nterm_gap" : "";
    if (c.silac) basis += std::string(basis.empty() ? "" : "+") + "heavy_share";
    if (basis.empty()) basis = "none";
    r.add(sec, "basis", basis, "-",
          basis == "none" ? "No label rule fired."
          : "The call rests on " +
                std::string(c.isobaric && c.silac ? "N-terminal label gaps of at least " + g(LABEL_MIN_SHARE * 100, 3) +
                                                        "% of the filtered tags and the heavy Lys8/Arg10 shares"
                            : c.isobaric ? "N-terminal label gaps of at least " + g(LABEL_MIN_SHARE * 100, 3) +
                                               "% of the filtered tags and " + g(LABEL_BACKGROUND_FOLD, 3) + "x their background"
                                         : "the heavy Lys8/Arg10 shares") +
                ".");
    const std::string sil = c.silac ? (c.silac_strong ? "strong" : "weak") : "none";
    r.add(sec, "silac", sil, "-",
          c.silac ? "Lys8 and Arg10 are each at least " + g(c.silac_strong ? HEAVY_STRONG : HEAVY_MIN, 3) +
                        " of their residue's C-terminal ends, the K/R share is " + f(c.kr_rounded, 3) + " and " +
                        std::to_string(s.silac_min) + " K- and R-terminal ends each are reached."
                  : "SILAC needs Lys8 and Arg10 shares of at least " + g(HEAVY_MIN, 3) + ", a K/R share of at least " +
                        g(KR_TRYPTIC, 3) + " and " + std::to_string(s.silac_min) + " K- and R-terminal ends each.");
    r.add(sec, "reason", "-", "-", "A label call is made.");
    return out;
  }

  GapResult gapResult(const std::vector<GapRow>& rows, const std::vector<GapMod>& mods,
                      const std::vector<Combo>& combos, const GapSettings& s)
  {
    std::vector<GapRow> hist;
    std::vector<std::size_t> at;  // hist[k] is rows[at[k]]
    for (std::size_t i = 0; i < rows.size(); ++i)
      if (rows[i].spectra >= s.min_bin)
      {
        hist.push_back(rows[i]);
        at.push_back(i);
      }
    GapResult res = detectGaps(hist, mods, combos, s.window, s.min_spectra, s.min_share, s.silac_share, s.silac_min);
    for (GapPeak& p : res.peaks)
      for (std::size_t& m : p.members) m = at[m];
    return res;
  }

  std::vector<Row> massgapRows(const std::vector<GapRow>& rows, const std::vector<std::string>& keys,
                               const std::vector<GapMod>& mods, const std::vector<Combo>& combos,
                               const std::vector<GapMod>& cys, const GapSettings& s)
  {
    return massgapRows(rows, keys, mods, cys, s, gapResult(rows, mods, combos, s));
  }

  std::vector<Row> massgapRows(const std::vector<GapRow>& rows, const std::vector<std::string>& keys,
                               const std::vector<GapMod>& mods, const std::vector<GapMod>& cys,
                               const GapSettings& s, const GapResult& res)
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
