// Ranked protein shortlist and reduced FASTA (FASTag 1.12, item #5).
// See Shortlist.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#include "Shortlist.h"

#include "Digest.h"
#include "NumFormat.h"
#include "OutputGuard.h"

#include <OpenMS/DATASTRUCTURES/StringUtils.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
#include <limits>
#include <map>
#include <unordered_map>

namespace FASTag::Shortlist
{
  namespace
  {
    /// Tabs and line breaks would split a TSV field.
    std::string field(const std::string& s)
    {
      std::string out = s;
      for (char& c : out)
        if (c == '\t' || c == '\n' || c == '\r') c = ' ';
      return out;
    }

    bool trypsinCompatible(const std::string& cls)
    {
      return cls == "Trypsin" || cls == "Lys-C" || cls == "Arg-C";
    }
  }

  Placement classifyPlacement(bool nterm_match, bool cterm_match, double delta, double fixed_n,
                              double fixed_c, double tol_da)
  {
    if (nterm_match && cterm_match) return Placement::Exact;
    // A labelled peptide's gap on the labelled side is the label itself: the
    // spectrum flank carries it, the database prefix does not (TagRecon.h,
    // setFixedTermMods).
    if (!nterm_match && cterm_match && fixed_n != 0.0 && std::fabs(delta - fixed_n) <= tol_da)
      return Placement::LabelExact;
    if (nterm_match && !cterm_match && fixed_c != 0.0 && std::fabs(delta - fixed_c) <= tol_da)
      return Placement::LabelExact;
    return Placement::Gapped;
  }

  std::vector<std::string> defaultDecoyAffixes()
  {
    return {"DECOY_", "decoy_", "rev_", "REV_", "reverse_", "XXX_", "shuffled_", "random_", "_DECOY", "_rev"};
  }

  bool isDecoy(const std::string& accession, const std::vector<std::string>& affixes)
  {
    const std::string acc = OpenMS::StringUtils::toLowered(accession);
    for (const std::string& raw : affixes)
    {
      if (raw.empty()) continue;
      const std::string a = OpenMS::StringUtils::toLowered(raw);
      const bool suffix = a.front() == '_' && a.back() != '_';
      if (a.size() > acc.size()) continue;
      if (suffix ? acc.compare(acc.size() - a.size(), a.size(), a) == 0 : acc.compare(0, a.size(), a) == 0)
        return true;
    }
    return false;
  }

  DuplicateCheck checkDuplicates(const std::vector<OpenMS::FASTAFile::FASTAEntry>& entries)
  {
    DuplicateCheck d;
    d.canonical.resize(entries.size());
    std::unordered_map<std::string, std::uint32_t> first;
    for (std::uint32_t i = 0; i < entries.size(); ++i)
    {
      const auto [it, inserted] = first.emplace(entries[i].identifier, i);
      d.canonical[i] = i;
      if (inserted) continue;
      if (entries[it->second].sequence == entries[i].sequence)
      {
        d.canonical[i] = it->second;
        ++d.identical;
      }
      else if (d.conflict.empty())
      {
        d.conflict = entries[i].identifier;
      }
    }
    return d;
  }

  std::string selectBackground(const std::vector<OpenMS::FASTAFile::FASTAEntry>& database,
                               const std::vector<OpenMS::FASTAFile::FASTAEntry>& background,
                               const std::vector<std::string>& affixes,
                               std::vector<OpenMS::FASTAFile::FASTAEntry>& kept, std::size_t* decoys,
                               std::size_t* duplicates, std::vector<std::uint32_t>* in_database)
  {
    kept.clear();
    if (in_database) in_database->clear();
    std::size_t n_decoys = 0, n_dup = 0;
    std::unordered_map<std::string, const std::string*> seen;  // identifier -> sequence
    std::unordered_map<std::string, std::uint32_t> db_first;   // identifier -> first database ordinal
    for (std::uint32_t i = 0; i < database.size(); ++i)
    {
      seen.emplace(database[i].identifier, &database[i].sequence);
      db_first.emplace(database[i].identifier, i);
    }
    std::string conflict;
    for (const auto& e : background)
    {
      if (isDecoy(e.identifier, affixes))
      {
        ++n_decoys;
        continue;
      }
      const auto it = seen.find(e.identifier);
      if (it != seen.end())
      {
        if (*it->second == e.sequence)
        {
          ++n_dup;
          // A duplicate of a database entry is kept through that entry.
          const auto db = db_first.find(e.identifier);
          if (in_database && db != db_first.end()) in_database->push_back(db->second);
          continue;
        }
        if (conflict.empty()) conflict = e.identifier;
        continue;
      }
      kept.push_back(e);
      seen.emplace(e.identifier, &kept.back().sequence);
    }
    // seen holds pointers into kept; nothing below reads them.
    if (decoys) *decoys = n_decoys;
    if (duplicates) *duplicates = n_dup;
    return conflict;
  }

  std::vector<ProteinRow> rankProteins(std::vector<Evidence> evidence, const std::vector<ProteinInfo>& proteins,
                                       const Settings& s)
  {
    // Canonical ordinals, then the order every sum below runs in: by spectrum,
    // then protein, then the rest, so nothing depends on the input order.
    // E-values are stored as float: compare against the cutoff as float too,
    // so a tag at exactly -shortlist_max_evalue stays in.
    const float max_e = static_cast<float>(s.max_evalue);
    for (Evidence& e : evidence)
      if (e.protein < proteins.size()) e.protein = proteins[e.protein].canonical;
    evidence.erase(std::remove_if(evidence.begin(), evidence.end(),
                                  [&](const Evidence& e) {
                                    return e.protein >= proteins.size() || !(e.evalue <= max_e) ||
                                           (!e.exact && !s.gapped);
                                  }),
                   evidence.end());
    std::sort(evidence.begin(), evidence.end(), [](const Evidence& a, const Evidence& b) {
      if (a.spectrum != b.spectrum) return a.spectrum < b.spectrum;
      if (a.protein != b.protein) return a.protein < b.protein;
      if (a.exact != b.exact) return a.exact > b.exact;
      if (a.evalue != b.evalue) return a.evalue < b.evalue;
      if (a.window_start != b.window_start) return a.window_start < b.window_start;
      return a.window_len < b.window_len;
    });

    struct Acc
    {
      std::uint64_t spectra = 0, exact = 0, gapped = 0;
      double weighted = 0.0;
      float best = std::numeric_limits<float>::infinity();
      std::vector<std::pair<std::uint32_t, std::uint16_t>> windows;
      std::vector<std::uint32_t> spec;  // sorted (evidence is spectrum-ordered)
    };
    std::map<std::uint32_t, Acc> acc;  // ordinal -> evidence
    for (std::size_t i = 0; i < evidence.size();)
    {
      // One spectrum: its distinct target proteins share it.
      std::size_t j = i;
      while (j < evidence.size() && evidence[j].spectrum == evidence[i].spectrum) ++j;
      std::size_t targets = 0;
      for (std::size_t k = i; k < j; ++k)
        if ((k == i || evidence[k].protein != evidence[k - 1].protein) && !proteins[evidence[k].protein].decoy)
          ++targets;
      for (std::size_t k = i; k < j;)
      {
        const std::uint32_t prot = evidence[k].protein;
        Acc& a = acc[prot];
        ++a.spectra;
        a.spec.push_back(evidence[k].spectrum);
        bool any_exact = false;
        for (; k < j && evidence[k].protein == prot; ++k)
        {
          any_exact = any_exact || evidence[k].exact;
          a.best = std::min(a.best, evidence[k].evalue);
          a.windows.emplace_back(evidence[k].window_start, evidence[k].window_len);
        }
        if (any_exact) ++a.exact;
        else ++a.gapped;
        if (!proteins[prot].decoy && targets > 0) a.weighted += 1.0 / static_cast<double>(targets);
      }
      i = j;
    }

    std::vector<ProteinRow> rows, decoy_rows;
    std::map<std::uint32_t, const std::vector<std::uint32_t>*> spectra_of;
    for (auto& [ordinal, a] : acc)
    {
      std::sort(a.windows.begin(), a.windows.end());
      ProteinRow r;
      r.ordinal = ordinal;
      r.accession = proteins[ordinal].accession;
      r.spectra = a.spectra;
      r.peptides = static_cast<std::uint64_t>(std::unique(a.windows.begin(), a.windows.end()) - a.windows.begin());
      r.exact_spectra = a.exact;
      r.gapped_spectra = a.gapped;
      r.weighted = a.weighted;
      r.length = proteins[ordinal].length;
      r.nsaf = r.length ? r.weighted / static_cast<double>(r.length) : 0.0;
      r.best_evalue = a.best;
      spectra_of[ordinal] = &a.spec;
      if (proteins[ordinal].decoy)
      {
        r.reason = "decoy";
        decoy_rows.push_back(std::move(r));
      }
      else
      {
        rows.push_back(std::move(r));
      }
    }
    std::sort(rows.begin(), rows.end(), [](const ProteinRow& a, const ProteinRow& b) {
      if (a.spectra != b.spectra) return a.spectra > b.spectra;
      if (a.peptides != b.peptides) return a.peptides > b.peptides;
      if (a.weighted != b.weighted) return a.weighted > b.weighted;
      if (a.best_evalue != b.best_evalue) return a.best_evalue < b.best_evalue;
      if (a.accession != b.accession) return a.accession < b.accession;
      return a.ordinal < b.ordinal;
    });
    for (std::size_t i = 0; i < rows.size(); ++i) rows[i].rank = i + 1;

    // (1) the evidence floor
    std::vector<std::size_t> cand;
    for (std::size_t i = 0; i < rows.size(); ++i)
    {
      if (rows[i].spectra < s.min_spectra) rows[i].reason = "below_min_spectra";
      else cand.push_back(i);
    }
    // (2) parsimony, in rank order
    std::vector<std::size_t> kept;
    if (s.parsimony == Parsimony::Subset)
    {
      for (std::size_t i : cand)
      {
        const auto& si = *spectra_of[rows[i].ordinal];
        bool sub = false;
        for (std::size_t k : kept)
        {
          const auto& sk = *spectra_of[rows[k].ordinal];
          if (std::includes(sk.begin(), sk.end(), si.begin(), si.end()))
          {
            rows[i].reason = "subset_of:" + rows[k].accession;
            sub = true;
            break;
          }
        }
        if (!sub) kept.push_back(i);
      }
    }
    else if (s.parsimony == Parsimony::Greedy)
    {
      std::vector<std::uint32_t> uncovered;
      for (std::size_t i : cand)
      {
        const auto& si = *spectra_of[rows[i].ordinal];
        uncovered.insert(uncovered.end(), si.begin(), si.end());
      }
      std::sort(uncovered.begin(), uncovered.end());
      uncovered.erase(std::unique(uncovered.begin(), uncovered.end()), uncovered.end());
      std::vector<char> chosen(cand.size(), 0);
      while (!uncovered.empty())
      {
        std::size_t best = cand.size(), best_gain = 0;
        for (std::size_t c = 0; c < cand.size(); ++c)
        {
          if (chosen[c]) continue;
          const auto& si = *spectra_of[rows[cand[c]].ordinal];
          std::vector<std::uint32_t> inter;
          std::set_intersection(si.begin(), si.end(), uncovered.begin(), uncovered.end(), std::back_inserter(inter));
          if (inter.size() > best_gain) { best_gain = inter.size(); best = c; }
        }
        if (best == cand.size()) break;
        chosen[best] = 1;
        const auto& sb = *spectra_of[rows[cand[best]].ordinal];
        std::vector<std::uint32_t> rest;
        std::set_difference(uncovered.begin(), uncovered.end(), sb.begin(), sb.end(), std::back_inserter(rest));
        uncovered.swap(rest);
      }
      for (std::size_t c = 0; c < cand.size(); ++c)
      {
        if (chosen[c]) kept.push_back(cand[c]);
        else rows[cand[c]].reason = "not_in_cover";
      }
      std::sort(kept.begin(), kept.end());
    }
    else
    {
      kept = cand;
    }
    // (3) the top cap, ties at the cut kept
    const auto same_rank = [&](std::size_t a, std::size_t b) {
      return rows[a].spectra == rows[b].spectra && rows[a].peptides == rows[b].peptides &&
             rows[a].weighted == rows[b].weighted && rows[a].best_evalue == rows[b].best_evalue;
    };
    for (std::size_t n = 0; n < kept.size(); ++n)
    {
      const std::size_t i = kept[n];
      if (s.top == 0 || n < s.top || same_rank(i, kept[s.top - 1]))
      {
        rows[i].kept = true;
        rows[i].reason = "selected";
      }
      else
      {
        rows[i].reason = "beyond_top";
      }
    }
    rows.insert(rows.end(), std::make_move_iterator(decoy_rows.begin()), std::make_move_iterator(decoy_rows.end()));
    return rows;
  }

  std::size_t keepBackgroundTwins(const std::vector<std::uint32_t>& twins, const std::vector<ProteinInfo>& proteins,
                                  std::vector<bool>& keep, std::vector<ProteinRow>& rows)
  {
    std::size_t added = 0;
    for (std::uint32_t t : twins)
    {
      if (t >= proteins.size() || t >= keep.size()) continue;
      const std::uint32_t c = proteins[t].canonical;
      if (c >= keep.size() || keep[c] || proteins[c].decoy) continue;
      keep[c] = true;
      ++added;
      const auto row = std::find_if(rows.begin(), rows.end(), [&](const ProteinRow& r) { return r.ordinal == c; });
      if (row != rows.end())
      {
        row->kept = true;
        row->reason = "background";
        continue;
      }
      ProteinRow r;
      r.ordinal = c;
      r.accession = proteins[c].accession;
      r.length = proteins[c].length;
      r.kept = true;
      r.reason = "background";
      rows.push_back(std::move(r));
    }
    return added;
  }

  bool writeShortlist(const std::string& path, const std::vector<std::string>& header,
                      const std::vector<ProteinRow>& rows,
                      const std::vector<OpenMS::FASTAFile::FASTAEntry>& background, std::string* err)
  {
    FASTag::PartFile pf(path);
    std::ofstream os;
    if (!pf.open(os, std::ios::out | std::ios::binary))
    {
      if (err) *err = pf.error();
      return false;
    }
    std::string buf;
    for (const std::string& h : header) buf += "# " + field(h) + "\n";
    buf += "rank\taccession\tspectra\tpeptides\texact_spectra\tgapped_spectra\tweighted\tnsaf\tbest_evalue"
           "\tlength\tkept\treason\n";
    for (const ProteinRow& r : rows)
    {
      if (r.rank) appendNum(buf, r.rank);
      else buf += '-';
      buf += '\t';
      buf += field(r.accession);
      buf += '\t';
      appendNum(buf, r.spectra);
      buf += '\t';
      appendNum(buf, r.peptides);
      buf += '\t';
      appendNum(buf, r.exact_spectra);
      buf += '\t';
      appendNum(buf, r.gapped_spectra);
      buf += '\t';
      appendNum(buf, r.weighted, std::chars_format::fixed, 4);
      buf += '\t';
      appendNum(buf, r.nsaf, std::chars_format::general, 6);
      buf += '\t';
      // A database entry kept only as a background twin has no evidence.
      if (r.spectra == 0) buf += '-';
      else appendNum(buf, static_cast<double>(r.best_evalue), std::chars_format::general, 3);
      buf += '\t';
      appendNum(buf, r.length);
      buf += '\t';
      buf += r.kept ? '1' : '0';
      buf += '\t';
      buf += r.reason;
      buf += '\n';
    }
    for (const auto& e : background)
    {
      buf += "-\t" + field(e.identifier) + "\t0\t0\t0\t0\t0.0000\t0\t-\t";
      appendNum(buf, e.sequence.size());
      buf += "\t1\tbackground\n";
    }
    os << buf;
    os.close();
    if (os.fail())
    {
      if (err) *err = "write failed (disk full?)";
      pf.discard();
      return false;
    }
    if (!pf.commit())
    {
      if (err) *err = pf.error();
      return false;
    }
    return true;
  }

  namespace
  {
    void putEntry(std::ostream& os, const std::string& id, const std::string& desc, const std::string& seq)
    {
      os << '>' << id;
      if (!desc.empty()) os << ' ' << desc;
      os << '\n';
      for (std::size_t p = 0; p < seq.size(); p += 80) os.write(seq.data() + p, static_cast<std::streamsize>(std::min<std::size_t>(80, seq.size() - p))) << '\n';
    }
  }

  FastaWriteResult writeReducedFasta(const std::string& db_path, const std::vector<bool>& keep,
                                     const std::vector<OpenMS::FASTAFile::FASTAEntry>& background,
                                     const std::string& out_path, const std::string& decoy_prefix)
  {
    FastaWriteResult res;
    const bool decoys = !decoy_prefix.empty();
    std::vector<OpenMS::FASTAFile::FASTAEntry> written;  // for the decoys
    FASTag::PartFile pf(out_path);
    std::ofstream os;
    if (!pf.open(os, std::ios::out | std::ios::binary))
    {
      res.error = pf.error();
      return res;
    }
    try
    {
      OpenMS::FASTAFile in;
      in.readStart(db_path);
      OpenMS::FASTAFile::FASTAEntry e;
      std::size_t ordinal = 0;
      while (in.readNext(e))
      {
        if (ordinal >= keep.size())
        {
          res.error = "'" + db_path + "' has more entries than when it was indexed (changed during the run?)";
          pf.discard();
          return res;
        }
        if (keep[ordinal])
        {
          putEntry(os, e.identifier, e.description, e.sequence);
          if (!os) break;
          ++res.entries;
          if (decoys) written.push_back(e);
        }
        ++ordinal;
      }
      if (os && ordinal != keep.size())
      {
        res.error = "'" + db_path + "' has fewer entries than when it was indexed (changed during the run?)";
        pf.discard();
        return res;
      }
    }
    catch (const std::exception& ex)
    {
      res.error = std::string("cannot read '") + db_path + "': " + ex.what();
      pf.discard();
      return res;
    }
    for (const auto& b : background)
    {
      if (!os) break;
      putEntry(os, b.identifier, b.description, b.sequence);
      if (os) ++res.entries;
      if (decoys) written.push_back(b);
    }
    for (const auto& w : written)
    {
      if (!os) break;
      putEntry(os, decoy_prefix + w.identifier, w.description, std::string(w.sequence.rbegin(), w.sequence.rend()));
      if (os) ++res.decoys;
    }
    os.close();
    if (os.fail())
    {
      res.error = "write failed (disk full?)";
      res.entries = 0;
      res.decoys = 0;
      pf.discard();
      return res;
    }
    if (!pf.commit())
    {
      res.error = pf.error();
      res.entries = 0;
      res.decoys = 0;
      return res;
    }
    res.ok = true;
    return res;
  }

  ProteaseVerdict proteaseVerdict(const FASTag::Digest::Classification& c, bool low_resolution,
                                  std::uint64_t spectra, std::uint64_t min_spectra, double min_margin)
  {
    ProteaseVerdict v;
    if (c.scored && c.top >= 0) v.model = c.scores[static_cast<std::size_t>(c.top)].name;
    if (low_resolution)
    {
      v.reason = "the fragment tolerance is in Da, so the residue windows at the tag ends do not hold";
      return v;
    }
    if (!c.scored || c.top < 0)
    {
      v.reason = std::to_string(c.n_c) + " C-terminal tag ends are too few for a protease call";
      return v;
    }
    if (spectra < min_spectra)
    {
      v.reason = std::to_string(spectra) + " spectra with counted tag ends are fewer than " + std::to_string(min_spectra);
      return v;
    }
    if (c.nonfinite)
    {
      v.reason = "a residue at the tag ends has probability 0 under the call or the runner-up";
      return v;
    }
    if (!c.tied.empty())
    {
      v.reason = "several protease models fit the tag ends equally well";
      return v;
    }
    const FASTag::Digest::ModelScore& top = c.scores[static_cast<std::size_t>(c.top)];
    if (trypsinCompatible(top.cls))
    {
      v.kind = ProteaseVerdict::Compatible;
      v.reason = v.model + " fits the tag ends best";
      return v;
    }
    double best_compatible = -std::numeric_limits<double>::infinity();
    for (const auto& m : c.scores)
      if (trypsinCompatible(m.cls)) best_compatible = std::max(best_compatible, m.loglik);
    const std::uint64_t n_used = c.n_c + (c.uses_nterm ? c.n_n : 0);
    v.margin = n_used ? (top.loglik - best_compatible) / static_cast<double>(n_used)
                      : std::numeric_limits<double>::infinity();
    std::string m;
    appendNum(m, v.margin, std::chars_format::general, 3);
    if (v.margin >= min_margin)
    {
      v.kind = ProteaseVerdict::NonTryptic;
      v.reason = v.model + " fits the tag ends best, not a trypsin-compatible protease (by " + m +
                 " log-likelihood per tag end)";
    }
    else
    {
      std::string mm;
      appendNum(mm, min_margin, std::chars_format::general, 3);
      v.reason = v.model + " fits the tag ends best, but by " + m + " < " + mm +
                 " log-likelihood per tag end over a trypsin-compatible protease";
    }
    return v;
  }
}
