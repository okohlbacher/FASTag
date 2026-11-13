// The census ids join (#11 phase B); see CensusIds.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#include "CensusIds.h"

#include <OpenMS/DATASTRUCTURES/StringUtils.h>
#include <OpenMS/FORMAT/FileHandler.h>
#include <OpenMS/METADATA/PeptideHit.h>
#include <OpenMS/METADATA/PeptideIdentification.h>
#include <OpenMS/METADATA/PeptideIdentificationList.h>
#include <OpenMS/METADATA/ProteinIdentification.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <limits>
#include <set>

namespace FASTag::CensusIds
{
  const char* text(Ident i)
  {
    switch (i)
    {
      case Ident::YES: return "1";
      case Ident::NO: return "0";
      default: return "";
    }
  }

  const char* key(Ident i)
  {
    switch (i)
    {
      case Ident::YES: return "1";
      case Ident::NO: return "0";
      default: return "unknown";
    }
  }

  namespace
  {
    bool allDigits(const std::string& s, std::size_t from, std::size_t to)
    {
      if (from >= to || to - from > 18) return false;
      for (std::size_t i = from; i < to; ++i)
        if (!std::isdigit(static_cast<unsigned char>(s[i]))) return false;
      return true;
    }

    /// A reference or native id as the census writes it (Census::appendField).
    std::string escaped(const std::string& s)
    {
      std::string out;
      Census::appendField(out, s);
      return out;
    }

    /// Field @p k (0-based) of a tab-separated line; npos-safe.
    bool field(const std::string& line, std::size_t k, std::string& out)
    {
      std::size_t start = 0;
      for (std::size_t i = 0; i < k; ++i)
      {
        start = line.find('\t', start);
        if (start == std::string::npos) return false;
        ++start;
      }
      const std::size_t end = line.find('\t', start);
      out = line.substr(start, end == std::string::npos ? std::string::npos : end - start);
      return true;
    }

    std::size_t fields(const std::string& line) { return static_cast<std::size_t>(std::count(line.begin(), line.end(), '\t')) + 1; }

    bool statusIndex(const std::string& name, std::size_t& out)
    {
      for (std::size_t i = 0; i < Census::kStatusCount; ++i)
        if (name == Census::name(static_cast<Census::Status>(i))) { out = i; return true; }
      return false;
    }

  }

  long long scanOf(const std::string& id)
  {
    if (allDigits(id, 0, id.size())) return std::stoll(id);
    std::size_t pos = 0;
    while ((pos = id.find("scan=", pos)) != std::string::npos)
    {
      if (pos == 0 || id[pos - 1] == ' ')
      {
        const std::size_t from = pos + 5;
        std::size_t to = id.find(' ', from);
        if (to == std::string::npos) to = id.size();
        return allDigits(id, from, to) ? std::stoll(id.substr(from, to - from)) : -1;
      }
      pos += 5;
    }
    return -1;
  }

  std::string runStem(const std::string& path)
  {
    std::string p = path;
    if (p.rfind("file://", 0) == 0) p = p.substr(7);
    std::replace(p.begin(), p.end(), '\\', '/');
    while (!p.empty() && p.back() == '/') p.pop_back();  // a .d directory
    const std::size_t slash = p.rfind('/');
    std::string name = slash == std::string::npos ? p : p.substr(slash + 1);
    static const std::set<std::string> ext = {"mzml", "mzxml", "mgf", "raw", "d", "mzpeak", "wiff", "mzdata",
                                              "gz", "bz2", "zip"};
    for (;;)
    {
      const std::size_t dot = name.rfind('.');
      if (dot == std::string::npos || dot == 0 || !ext.count(OpenMS::StringUtils::toLowered(name.substr(dot + 1)))) break;
      name.resize(dot);
    }
    return name;
  }

  bool isQValueScoreType(const std::string& score_type)
  {
    const std::string s = OpenMS::StringUtils::toLowered(OpenMS::StringUtils::trimmed(score_type));
    return s == "q-value" || s == "qvalue" || s == "q_value" || s == "ms:1002354" || s == "psm-level q-value";
  }

  double qValue(const OpenMS::PeptideIdentification& id, const OpenMS::PeptideHit& hit)
  {
    if (!id.isHigherScoreBetter() && isQValueScoreType(id.getScoreType())) return hit.getScore();
    for (const char* k : {"q-value", "MS:1002354"})
      if (hit.metaValueExists(k))
      {
        const OpenMS::DataValue& v = hit.getMetaValue(k);
        if (v.valueType() == OpenMS::DataValue::DOUBLE_VALUE || v.valueType() == OpenMS::DataValue::INT_VALUE)
          return static_cast<double>(v);
        if (v.valueType() == OpenMS::DataValue::STRING_VALUE)
        {
          const std::string t = v.toString();
          char* end = nullptr;
          const double q = std::strtod(t.c_str(), &end);
          if (end != t.c_str()) return q;
        }
      }
    return std::numeric_limits<double>::quiet_NaN();
  }

  // ---- Index -------------------------------------------------------------------

  bool Index::add(const std::string& ref, bool accepted)
  {
    if (OpenMS::StringUtils::trimmed(ref).empty()) return false;
    auto [it, fresh] = refs_.try_emplace(escaped(ref));
    if (fresh) it->second.scan = scanOf(it->first);
    it->second.accepted = it->second.accepted || accepted;
    return true;
  }

  void Index::see(const std::string& native_id)
  {
    if (!scans_built_)
    {
      for (auto& [ref, r] : refs_)
        if (r.scan >= 0) by_scan_[r.scan].push_back(&r);
      scans_built_ = true;
    }
    const auto it = refs_.find(native_id);
    if (it != refs_.end()) it->second.exact = true;
    const long long s = scanOf(native_id);
    if (s >= 0) ++input_scans_[s];
  }

  Ident Index::lookup(const std::string& native_id)
  {
    const auto it = refs_.find(native_id);
    if (it != refs_.end()) return it->second.accepted ? Ident::YES : Ident::NO;
    const long long s = scanOf(native_id);
    if (s < 0) return Ident::NO;
    const auto bs = by_scan_.find(s);
    if (bs == by_scan_.end()) return Ident::NO;
    std::vector<Ref*> cand;
    for (Ref* r : bs->second)
      if (!r->exact) cand.push_back(r);
    if (cand.empty()) return Ident::NO;
    const auto ic = input_scans_.find(s);
    if (cand.size() > 1 || ic == input_scans_.end() || ic->second != 1)
    {
      for (Ref* r : cand) r->ambiguous = true;
      return Ident::UNKNOWN;
    }
    cand[0]->by_scan = true;
    return cand[0]->accepted ? Ident::YES : Ident::NO;
  }

  Index::Counts Index::counts() const
  {
    Counts c;
    c.refs = refs_.size();
    for (const auto& [ref, r] : refs_)
    {
      if (r.exact) ++c.exact;
      else if (r.ambiguous) ++c.ambiguous;
      else if (r.by_scan) ++c.by_scan;
      else ++c.unmatched;
    }
    return c;
  }

  // ---- loading ------------------------------------------------------------------

  Loaded interpret(const std::vector<OpenMS::ProteinIdentification>& proteins,
                   const OpenMS::PeptideIdentificationList& peptides, double fdr, Index& index)
  {
    Loaded L;
    std::set<std::string> runs;
    for (const OpenMS::ProteinIdentification& p : proteins)
    {
      OpenMS::StringList paths;
      p.getPrimaryMSRunPath(paths);
      for (const std::string& s : paths)
        if (!OpenMS::StringUtils::trimmed(s).empty()) runs.insert(runStem(OpenMS::StringUtils::trimmed(s)));
    }
    L.runs.assign(runs.begin(), runs.end());
    for (const OpenMS::PeptideIdentification& id : peptides)
    {
      ++L.n_ids;
      bool accepted = false, any_target = false;
      const auto& hits = id.getHits();
      if (!hits.empty()) ++L.n_with_hits;
      for (const OpenMS::PeptideHit& h : hits)
      {
        ++L.n_hits;
        const double q = qValue(id, h);
        if (std::isfinite(q)) ++L.n_hits_q;
        // target+decoy counts as a target (OpenMS FDR); unannotated as well.
        if (h.getTargetDecoyType() == OpenMS::PeptideHit::TargetDecoyType::DECOY) continue;
        any_target = true;
        if (std::isfinite(q) && q <= fdr) accepted = true;
      }
      if (!hits.empty() && !any_target) ++L.n_decoy_only;
      if (accepted) ++L.n_accepted;
      if (!index.add(id.getSpectrumReference(), accepted))
      {
        ++L.n_no_ref;
        if (!hits.empty()) ++L.n_no_ref_hits;
      }
    }
    if (L.n_no_ref_hits > 0)
      L.refusal = "-census_ids: " + std::to_string(L.n_no_ref_hits) + " of " + std::to_string(L.n_with_hits) +
                  " spectrum identifications with hits carry no spectrum_reference, so FASTag cannot tell which "
                  "spectrum they identify. Add the references from the mzML of -in, e.g. by converting the "
                  "search engine output with IDFileConverter -mz_file.";
    else if (L.n_hits_q == 0)
      L.refusal = "-census_ids: no hit carries a q-value (as the score, or as a 'q-value' or MS:1002354 meta "
                  "value), so FASTag cannot tell which identifications pass an FDR. Estimate and filter it "
                  "first, e.g. with FalseDiscoveryRate and IDFilter (-score:psm " +
                  std::to_string(fdr) + "), or use the search engine's own q-values.";
    else if (L.runs.size() > 1)
      L.refusal = "-census_ids references more than one run (" + std::to_string(L.runs.size()) +
                  "; a merged file): split it per run (e.g. IDFilter -mz / IDSplitter) so that every "
                  "spectrum reference names a spectrum of -in.";
    return L;
  }

  Loaded load(const std::string& path, double fdr, Index& index)
  {
    std::vector<OpenMS::ProteinIdentification> proteins;
    OpenMS::PeptideIdentificationList peptides;
    try
    {
      OpenMS::FileHandler().loadIdentifications(path, proteins, peptides,
                                                {OpenMS::FileTypes::IDXML, OpenMS::FileTypes::MZIDENTML});
    }
    catch (const std::exception& e)
    {
      Loaded L;
      L.refusal = "-census_ids: cannot read " + path + ": " + e.what();
      return L;
    }
    return interpret(proteins, peptides, fdr, index);
  }

  // ---- the join -------------------------------------------------------------------

  bool layoutOf(const std::string& head, Layout& layout)
  {
    layout = Layout{};
    bool sp = false, st = false, be = false;
    std::size_t i = 0, start = 0;
    for (;; ++i)
    {
      const std::size_t end = head.find('\t', start);
      const std::string name = head.substr(start, end == std::string::npos ? std::string::npos : end - start);
      if (name == "spectrum" && !sp) { layout.spectrum = i; sp = true; }
      else if (name == "status" && !st) { layout.status = i; st = true; }
      else if (name == "best_evalue" && !be) { layout.best_evalue = i; be = true; }
      if (end == std::string::npos) break;
      start = end + 1;
    }
    layout.fields = i + 1;
    return sp && st && be;
  }

  bool joinTable(const std::string& in, const std::string& out, Index& index, double triage_evalue,
                 JoinTally& tally, std::string& error)
  {
    const std::string header = Census::header();
    return joinTableAs(header.substr(0, header.size() - 1), in, out, index, triage_evalue, tally, error);
  }

  bool joinTableAs(const std::string& head, const std::string& in, const std::string& out, Index& index,
                   double triage_evalue, JoinTally& tally, std::string& error)
  {
    tally = JoinTally{};
    Layout lay;
    if (!layoutOf(head, lay))
    {
      error = "the census header lacks spectrum, status or best_evalue";
      return false;
    }
    std::string line, id, status, best;
    {
      std::ifstream f(in, std::ios::binary);
      if (!f) { error = "cannot read " + in; return false; }
      if (!std::getline(f, line) || line != head) { error = in + " is not a census table"; return false; }
      while (std::getline(f, line))
      {
        if (fields(line) != lay.fields || !field(line, lay.spectrum, id))
        {
          error = in + ": a row has not " + std::to_string(lay.fields) + " fields";
          return false;
        }
        index.see(id);
      }
      if (f.bad()) { error = "failed reading " + in; return false; }
    }
    std::ifstream f(in, std::ios::binary);
    std::ofstream o(out, std::ios::binary | std::ios::trunc);
    if (!f) { error = "cannot read " + in; return false; }
    if (!o) { error = "cannot write " + out; return false; }
    std::getline(f, line);
    o << head << kHeaderSuffix << '\n';
    std::string buf;
    while (std::getline(f, line))
    {
      std::size_t st = 0;
      if (!field(line, lay.spectrum, id) || !field(line, lay.status, status) || !field(line, lay.best_evalue, best)
          || !statusIndex(status, st))
      {
        error = in + ": a row cannot be read";
        return false;
      }
      const Ident ident = index.lookup(id);
      const auto ix = static_cast<std::size_t>(ident);
      ++tally.rows;
      ++tally.by_ident[ix];
      ++tally.by_status[st][ix];
      const char* triage = "";
      if (ident != Ident::UNKNOWN)
      {
        triage = "0";
        const bool reported = st == static_cast<std::size_t>(Census::Status::TAGGED)
                              || st == static_cast<std::size_t>(Census::Status::PLACED);
        if (ident == Ident::NO && reported)
        {
          ++tally.triage_eligible;
          char* end = nullptr;
          const double e = std::strtod(best.c_str(), &end);
          if (!best.empty() && end != best.c_str() && e <= triage_evalue)
          {
            triage = "1";
            ++tally.triage;
          }
        }
      }
      buf.clear();
      buf += line;
      buf += '\t';
      buf += text(ident);
      buf += '\t';
      buf += triage;
      buf += '\n';
      o << buf;
    }
    o.close();
    if (f.bad()) { error = "failed reading " + in; return false; }
    if (o.fail()) { error = "failed writing " + out + " (disk full?)"; return false; }
    return true;
  }

  std::string runCheck(const Loaded& loaded, const std::string& in_path)
  {
    if (loaded.runs.empty()) return "unnamed";
    return std::find(loaded.runs.begin(), loaded.runs.end(), runStem(in_path)) != loaded.runs.end() ? "match"
                                                                                                    : "mismatch";
  }

  std::vector<Digest::Row> summaryRows(const Loaded& L, const Index::Counts& c, const JoinTally& t,
                                       const std::string& ids_path, const std::string& run_check, double fdr,
                                       double triage_evalue, bool unmatched_known)
  {
    using Digest::num;
    const std::string sec = "census_ids";
    std::vector<Digest::Row> r;
    std::string file = ids_path;
    std::replace(file.begin(), file.end(), '\\', '/');
    if (const auto s = file.rfind('/'); s != std::string::npos) file = file.substr(s + 1);
    const std::string rows = num(t.rows), refs = num(static_cast<std::uint64_t>(c.refs));
    const auto u = [](std::size_t v) { return num(static_cast<std::uint64_t>(v)); };
    r.push_back({sec, "census_ids_version", std::to_string(kVersion), "-",
                 "The ids join follows format " + std::to_string(kVersion) +
                     ": identified is 1, 0 or empty (unknown); triage is an E-value threshold, not a quality call."});
    r.push_back({sec, "ids_file", file, "-", "Identifications were read from " + file + "."});
    r.push_back({sec, "ids_fdr", num(fdr), "-",
                 "A target hit with a q-value <= " + num(fdr) + " identifies its spectrum; decoys are ignored."});
    r.push_back({sec, "triage_evalue", num(triage_evalue), "-",
                 "Triage candidates are unidentified tagged or placed spectra with best_evalue <= " +
                     num(triage_evalue) + "."});
    r.push_back({sec, "run_check", run_check, "-",
                 run_check == "match"      ? "The file names the run of -in."
                 : run_check == "mismatch" ? "The file names a run other than -in."
                                           : "The file names no run."});
    r.push_back({sec, "id_spectra", u(L.n_ids), "-", u(L.n_ids) + " spectrum identifications in the file."});
    r.push_back({sec, "id_accepted", u(L.n_accepted), u(L.n_ids),
                 u(L.n_accepted) + " of them hold a target hit that passes the FDR."});
    r.push_back({sec, "id_no_ref", u(L.n_no_ref), u(L.n_ids),
                 u(L.n_no_ref) + " of them carry no spectrum_reference (and no hit; with hits the file is refused)."});
    r.push_back({sec, "id_decoy_only", u(L.n_decoy_only), u(L.n_ids), u(L.n_decoy_only) + " of them hold only decoy hits."});
    r.push_back({sec, "refs", refs, "-", refs + " distinct spectrum references."});
    r.push_back({sec, "refs_exact", u(c.exact), refs, u(c.exact) + " references name a spectrum read by its native id."});
    r.push_back({sec, "refs_scan", u(c.by_scan), refs,
                 u(c.by_scan) + " references name a spectrum read by a unique scan number."});
    r.push_back({sec, "refs_ambiguous", u(c.ambiguous), refs,
                 u(c.ambiguous) + " references share a scan number with others; their spectra are unknown."});
    r.push_back({sec, "refs_unmatched", unmatched_known ? u(c.unmatched) : std::string(), refs,
                 unmatched_known ? u(c.unmatched) + " references name no spectrum read."
                                 : "Not known: unread spectra cannot be told from foreign references when subsampling."});
    for (std::size_t i = 0; i < kIdentCount; ++i)
    {
      const Ident id = static_cast<Ident>(i);
      r.push_back({sec, std::string("identified_") + key(id), num(t.by_ident[i]), rows,
                   num(t.by_ident[i]) + " census rows have identified " + key(id) + "."});
    }
    for (std::size_t s = 0; s < Census::kStatusCount; ++s)
    {
      const std::string nm = Census::name(static_cast<Census::Status>(s));
      for (std::size_t i = 0; i < kIdentCount; ++i)
      {
        const Ident id = static_cast<Ident>(i);
        r.push_back({sec, nm + "_identified_" + key(id), num(t.by_status[s][i]), rows,
                     num(t.by_status[s][i]) + " census rows have status " + nm + " and identified " + key(id) + "."});
      }
    }
    r.push_back({sec, "triage_candidates", num(t.triage), num(t.triage_eligible),
                 num(t.triage) + " of " + num(t.triage_eligible) +
                     " unidentified tagged or placed spectra have best_evalue <= " + num(triage_evalue) + "."});
    return r;
  }
}
