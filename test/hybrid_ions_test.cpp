// Hybrid EThcD/ETciD reading (FASTag 1.13 backlog item 10; src/IonSeries.h,
// -ion_series auto -ion_series_hybrid both):
//   (a) the rules: hybridTwoPass only under auto + both, for hybrid spectra,
//       in a run with the ion_series column; seriesColumn with hybrid_both;
//       the option values; 1.12's seriesFor/seriesColumn unchanged.
//   (b) mergeSeriesPasses: one list sorted by E-value, ties b/y first, the
//       cap, every row's ion_series kept, nothing deduplicated.
//   (c) mixed y/z ladders (cz_synth SPLIT: b/y ions for the C-terminal half
//       of the cleavage sites, c/z-dot for the N-terminal half) of 5 tryptic
//       peptides at 2+ and 3+: read as b/y only, no tag of the N-terminal
//       half has the true flanks; read as c/z only, none of the C-terminal
//       half; read in two passes and merged, both halves have true tags,
//       each with the right ion_series, E-values exactly 2x the single pass.
//   (d) the merged reading on pure ladders: on b/y (CID-like) ladders its
//       rank-1 tag is as often right as the b/y reading's, on c/z (ETD-like)
//       ladders as often as the c/z reading's, on b/y+c/z (EThcD-like)
//       ladders at least as often as either.
//   (e) consumers take the row's series: a c/z row of a hybrid spectrum is
//       placed by TagRecon with the c/z pair and not with b/y's; a b/y row
//       the other way round; the digest TerminusCounter likewise.
//   (f) the INFO and WARN lines: 1.12's text without hybrid_both, the
//       hybrid count with it; never the gate summary pattern.
//   (g) RunMeta writes the ion_series_hybrid row only for such runs.
//   plus --write-mzml for the CLI test (hybrid_cli_test.sh).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "CliParam.h"
#include "ClusterAcc.h"
#include "Digest.h"
#include "FASTagger.h"
#include "IonSeries.h"
#include "ProteomeIndex.h"
#include "RunMeta.h"
#include "TagRecon.h"
#include "cz_synth.h"

#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CHEMISTRY/ProteaseDigestion.h>
#include <OpenMS/CHEMISTRY/ResidueDB.h>
#include <OpenMS/FORMAT/FASTAFile.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/Precursor.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <regex>
#include <set>
#include <string>
#include <vector>

using OpenMS::MSSpectrum;
using OpenMS::Precursor;
using AM = OpenMS::Precursor::ActivationMethod;
namespace IS = FASTag::IonSeries;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }

  const std::regex kGateSummary("^[0-9]+ MS2 spectra, [0-9]+ tags");

  double resMass(char c)
  {
    return OpenMS::ResidueDB::getInstance()->getResidue(std::string(1, c))->getMonoWeight(OpenMS::Residue::Internal);
  }
  double sumMass(const std::string& s)
  {
    double m = 0;
    for (char c : s) m += resMass(c);
    return m;
  }

  /// The flanks of a read of residues [pos, pos+len) under @p ip (the
  /// tagger's convention; see ion_series_test.cpp).
  std::pair<double, double> flanksOf(const std::string& pep, size_t pos, size_t len, bool reversed,
                                     const IS::IonPair& ip)
  {
    const double nside = sumMass(pep.substr(0, pos)), cside = sumMass(pep.substr(pos + len));
    double n, c;
    if (!reversed) { n = nside; c = cside; }
    else { n = cside + ip.reversedOffset(); c = nside - ip.reversedOffset(); }
    return {std::max(0.0, n), std::max(0.0, c)};
  }

  struct Occ
  {
    size_t pos;
    bool rev;
  };
  std::vector<Occ> occurrences(const std::string& pep, const std::string& tag)
  {
    std::vector<Occ> out;
    const std::string rev(tag.rbegin(), tag.rend());
    for (size_t at = pep.find(tag); at != std::string::npos; at = pep.find(tag, at + 1)) out.push_back({at, false});
    for (size_t at = pep.find(rev); at != std::string::npos; at = pep.find(rev, at + 1)) out.push_back({at, true});
    return out;
  }

  /// The occurrence of tag @p t in @p pep whose flanks (under the tag's own
  /// series) are within 0.01 Da of the truth, or nullptr-like {npos}.
  Occ trueOcc(const std::string& pep, const FASTag::Tag& t)
  {
    const IS::IonPair ip = IS::ionPair(t.ion_series);
    const std::string seq = FASTag::baseSequence(t.seq);
    for (const Occ& o : occurrences(pep, seq))
    {
      const auto [n, c] = flanksOf(pep, o.pos, seq.size(), o.rev, ip);
      if (std::fabs(t.nterm_mass - n) <= 0.01 && std::fabs(t.cterm_mass - c) <= 0.01) return o;
    }
    return {std::string::npos, false};
  }
  bool flankTrue(const std::string& pep, const FASTag::Tag& t)
  {
    return !t.gapped && t.evalue <= 1.0 && trueOcc(pep, t).pos != std::string::npos;
  }

  FASTag::Param withPair(FASTag::Param p, IS::Series s)
  {
    p.ion_pair = IS::ionPair(s);
    return p;
  }

  FASTag::Tag mk(double e, IS::Series s, const std::string& seq)
  {
    FASTag::Tag t;
    t.evalue = e;
    t.ion_series = s;
    t.seq = seq;
    t.n_res = seq.size();
    return t;
  }

  const char* const kPeptides[5] = {"VGAHAGEYGAEALER", "LLEQTHGGLNAWK", "DLVEGFNTWQR", "GDFQAMVYTNSAWR",
                                    "YLGYLEQLLR"};

  /// The tool's two-pass reading of one spectrum (FASTag.cpp tag_at):
  /// b/y and c/z-dot at multiplicity HYBRID_PASSES, merged under the cap.
  struct Reader
  {
    FASTag::Param pby, pcz;
    FASTag::Tables tby, tcz;
    explicit Reader(const FASTag::Param& base)
        : pby(withPair(base, IS::Series::BY)), pcz(withPair(base, IS::Series::CZ)), tby(pby), tcz(pcz)
    {
    }
    std::vector<FASTag::Tag> by(const CzSynth::Spec& s, int z, double m = 1.0) const
    {
      return FASTag::tagSpectrum(s.spec, s.prec_mz, z, pby, tby, nullptr, m);
    }
    std::vector<FASTag::Tag> cz(const CzSynth::Spec& s, int z, double m = 1.0) const
    {
      return FASTag::tagSpectrum(s.spec, s.prec_mz, z, pcz, tcz, nullptr, m);
    }
    std::vector<FASTag::Tag> both(const CzSynth::Spec& s, int z) const
    {
      return FASTag::mergeSeriesPasses(by(s, z, IS::HYBRID_PASSES), cz(s, z, IS::HYBRID_PASSES),
                                       static_cast<size_t>(std::max(0, pby.max_tag_count)));
    }
  };

  /// hybrid_ions_test --write-mzml <fasta> <out.mzML> <kind> [n]: n (40)
  /// tryptic peptides of @p fasta (as ion_series_test --write-mzml),
  /// precursor charge 2 and 3 alternately, fragment charges 1 .. z-1, 15
  /// noise peaks. Kinds:
  ///   split        SPLIT ladders (mixed y/z), activation ETD + supplemental
  ///                beam-type CID (both mzML readers give {ETD, EThcD});
  ///   split_filter the same peaks, no activation term, filter string
  ///                "...@etd50.00@hcd25.00 [..]" (hybrid by the token rule);
  ///   bycz         b, y, c and z-dot ions, EThcD;
  ///   etd          c and z-dot ions, ETD;
  ///   cid          b and y ions, CID.
  int writeMzml(int argc, char** argv)
  {
    if (argc < 5)
    {
      std::cerr << "usage: hybrid_ions_test --write-mzml <fasta> <out.mzML> <split|split_filter|bycz|etd|cid> [n]\n";
      return 2;
    }
    const std::string kind = argv[4];
    CzSynth::Ions ions;
    if (kind == "split" || kind == "split_filter") ions = CzSynth::Ions::SPLIT;
    else if (kind == "bycz") ions = CzSynth::Ions::BYCZ;
    else if (kind == "etd") ions = CzSynth::Ions::CZ;
    else if (kind == "cid") ions = CzSynth::Ions::BY;
    else
    {
      std::cerr << "unknown kind " << kind << "\n";
      return 2;
    }
    const size_t n = argc > 5 ? static_cast<size_t>(std::stoul(argv[5])) : 40;
    std::vector<OpenMS::FASTAFile::FASTAEntry> prot;
    OpenMS::FASTAFile().load(argv[2], prot);
    OpenMS::ProteaseDigestion dig;
    dig.setEnzyme("Trypsin");
    dig.setMissedCleavages(1);
    std::set<std::string> seen;
    std::vector<std::string> peps;
    for (const auto& e : prot)
    {
      std::vector<OpenMS::AASequence> out;
      dig.digest(OpenMS::AASequence::fromString(e.sequence), out, 8, 18);
      for (const auto& a : out)
      {
        const std::string s = a.toUnmodifiedString();
        if (s.find_first_of("CUXBZ") != std::string::npos || !seen.insert(s).second) continue;
        peps.push_back(s);
        if (peps.size() == n) break;
      }
      if (peps.size() == n) break;
    }
    OpenMS::PeakMap exp;
    for (size_t i = 0; i < peps.size(); ++i)
    {
      const int z = i % 2 == 0 ? 2 : 3;
      CzSynth::Spec sp = CzSynth::make(peps[i], z, ions, std::max(1, z - 1), 15, 5000u + static_cast<unsigned>(i));
      if (sp.spec.size() < 20) return 1;  // a fixture that failed to build
      sp.spec.setMSLevel(2);
      sp.spec.setRT(10.0 + i);
      sp.spec.setNativeID("controllerType=0 controllerNumber=1 scan=" + std::to_string(i + 1));
      sp.spec.setType(OpenMS::SpectrumSettings::SpectrumType::CENTROID);
      Precursor pr;
      pr.setMZ(sp.prec_mz);
      pr.setCharge(z);
      if (kind == "split" || kind == "bycz") pr.setActivationMethods({AM::ETD, AM::EThcD});
      else if (kind == "etd") pr.setActivationMethods({AM::ETD});
      else if (kind == "cid") pr.setActivationMethods({AM::CID});
      sp.spec.setPrecursors({pr});
      if (kind == "split_filter")
      {
        char f[160];
        std::snprintf(f, sizeof f, "FTMS + c NSI d Full ms2 %.4f@etd50.00 %.4f@hcd25.00 [100.0000-2000.0000]",
                      sp.prec_mz, sp.prec_mz);
        sp.spec.setMetaValue("filter string", std::string(f));
      }
      exp.addSpectrum(sp.spec);
    }
    OpenMS::MzMLFile().store(argv[3], exp);
    std::cout << "wrote " << exp.size() << " " << kind << " spectra to " << argv[3] << "\n";
    return peps.size() == n ? 0 : 1;
  }
}

int main(int argc, char** argv)
{
  if (argc > 1 && std::string(argv[1]) == "--write-mzml") return writeMzml(argc, argv);
  using A = IS::Activation;

  // ---- (a) rules ----
  {
    check(std::string(IS::HYBRID_DEFAULT) == "by" && std::string(IS::HYBRID_VALUES) == "by,both",
          "-ion_series_hybrid values; default by");
    check(IS::HYBRID_PASSES == 2.0, "two passes, factor 2");
    for (IS::Mode m : {IS::Mode::BY, IS::Mode::CZ, IS::Mode::AUTO})
      for (A a : {A::COLLISIONAL, A::ELECTRON, A::HYBRID, A::UNKNOWN})
        for (bool col : {false, true})
          for (bool hb : {false, true})
            check(IS::hybridTwoPass(m, a, col, hb) == (m == IS::Mode::AUTO && a == A::HYBRID && col && hb),
                  std::string("hybridTwoPass ") + IS::modeName(m) + " " + IS::activationName(a) + (col ? " col" : "") +
                      (hb ? " both" : ""));
    // 1.12's per-spectrum rule is untouched: hybrid stays b/y in seriesFor.
    check(IS::seriesFor(IS::Mode::AUTO, A::HYBRID) == IS::Series::BY, "seriesFor(auto, hybrid) stays b/y");
    IS::ActivationCounts hyb, col, ele;
    hyb.add(A::HYBRID);
    col.add(A::COLLISIONAL);
    ele.add(A::ELECTRON);
    check(!IS::seriesColumn(IS::Mode::AUTO, hyb), "auto on a hybrid run: no column (1.12)");
    check(!IS::seriesColumn(IS::Mode::AUTO, hyb, false), "hybrid_both off: no column");
    check(IS::seriesColumn(IS::Mode::AUTO, hyb, true), "auto + both on a hybrid run: the column");
    check(!IS::seriesColumn(IS::Mode::AUTO, col, true), "auto + both on a collisional run: no column");
    check(IS::seriesColumn(IS::Mode::AUTO, ele, true) == IS::seriesColumn(IS::Mode::AUTO, ele),
          "auto + both on an electron run: as auto");
    check(!IS::seriesColumn(IS::Mode::BY, hyb, true), "by never writes the column");
    IS::SeriesCounts s1, s2;
    s1.ms2_hybrid = 2;
    s2.ms2_hybrid = 5;
    s1.merge(s2);
    check(s1.ms2_hybrid == 7, "SeriesCounts merge sums hybrid");
    FASTag::ClusterAcc::ClusterThread t1, t2;
    t2.e.series.ms2_hybrid = 4;
    t1.merge(t2);
    check(t1.e.series.ms2_hybrid == 4, "ClusterThread merge sums hybrid");
  }

  // ---- (b) mergeSeriesPasses ----
  {
    const auto by = std::vector<FASTag::Tag>{mk(0.1, IS::Series::BY, "AAA"), mk(0.5, IS::Series::BY, "CCC"),
                                            mk(2.0, IS::Series::BY, "DDD")};
    const auto cz = std::vector<FASTag::Tag>{mk(0.05, IS::Series::CZ, "EEE"), mk(0.5, IS::Series::CZ, "CCC"),
                                            mk(1.0, IS::Series::CZ, "AAA")};
    const auto m = FASTag::mergeSeriesPasses(by, cz, 0);
    check(m.size() == 6, "no cap: every row of both passes");
    std::string order;
    for (const auto& t : m) order += t.seq + IS::seriesName(t.ion_series) + " ";
    check(order == "EEEcz AAAby CCCby CCCcz AAAcz DDDby ", "sorted by E-value, ties b/y first: " + order);
    const auto c4 = FASTag::mergeSeriesPasses(by, cz, 4);
    check(c4.size() == 4 && c4.back().seq == "CCC" && c4.back().ion_series == IS::Series::CZ,
          "the cap keeps the best rows of both passes");
    check(FASTag::mergeSeriesPasses(by, {}, 0).size() == 3 && FASTag::mergeSeriesPasses({}, cz, 2).size() == 2,
          "one empty pass");
  }

  const FASTag::Param base = FASTag::cliDefaultParam();
  const Reader rd(base);
  const IS::IonPair byp = IS::ionPair(IS::Series::BY), czp = IS::ionPair(IS::Series::CZ);

  // ---- (c) mixed y/z ladders ----
  {
    int spectra = 0, both_halves = 0, by_nhalf = 0, cz_chalf = 0, by_chalf = 0, cz_nhalf = 0, e_mismatch = 0,
        e_checked = 0, wrong_series = 0;
    for (const char* pc : kPeptides)
      for (int z : {2, 3})
      {
        const std::string pep = pc;
        const size_t n = pep.size(), h = n / 2;
        const CzSynth::Spec s = CzSynth::make(pep, z, CzSynth::Ions::SPLIT, z - 1, 20, 700u + static_cast<unsigned>(z));
        const std::string what = pep + " " + std::to_string(z) + "+";
        check(s.spec.size() >= 2 * (n - 1), what + ": the SPLIT fixture was built");
        ++spectra;
        // Cleavage site k (between residues k-1 and k) is b/y for k >= n-h,
        // c/z for k < n-h. A tag of residues [pos, pos+len) spans the sites
        // pos .. pos+len: N-terminal half iff pos+len < n-h, C-terminal half
        // iff pos >= n-h.
        const auto half = [&](const FASTag::Tag& t) {
          const Occ o = trueOcc(pep, t);
          const size_t len = FASTag::baseSequence(t.seq).size();
          if (o.pos + len < n - h) return 'N';
          if (o.pos >= n - h) return 'C';
          return 'X';
        };
        for (const auto& t : rd.by(s, z))
          if (flankTrue(pep, t)) (half(t) == 'N' ? by_nhalf : by_chalf) += half(t) != 'X';
        for (const auto& t : rd.cz(s, z))
          if (flankTrue(pep, t)) (half(t) == 'C' ? cz_chalf : cz_nhalf) += half(t) != 'X';
        bool n_ok = false, c_ok = false;
        for (const auto& t : rd.both(s, z))
        {
          if (!flankTrue(pep, t)) continue;
          if (half(t) == 'N') { n_ok = n_ok || t.ion_series == IS::Series::CZ; wrong_series += t.ion_series != IS::Series::CZ; }
          if (half(t) == 'C') { c_ok = c_ok || t.ion_series == IS::Series::BY; wrong_series += t.ion_series != IS::Series::BY; }
        }
        both_halves += n_ok && c_ok;
        // E-values: every merged row is its pass's row at multiplicity 2.
        const auto b1 = rd.by(s, z), c1 = rd.cz(s, z);
        for (const auto& t : rd.both(s, z))
        {
          const auto& src = t.ion_series == IS::Series::BY ? b1 : c1;
          bool found = false;
          for (const auto& u : src)
            if (u.seq == t.seq && u.charge == t.charge && u.nterm_mass == t.nterm_mass && u.cterm_mass == t.cterm_mass &&
                u.low_mz == t.low_mz)
            {
              found = true;
              ++e_checked;
              if (std::fabs(t.evalue - 2.0 * u.evalue) > 1e-12 * std::max(1.0, t.evalue)) ++e_mismatch;
              break;
            }
          if (!found) ++e_mismatch;
        }
        const auto m = rd.both(s, z);
        bool sorted = true;
        for (size_t i = 1; i < m.size(); ++i) sorted = sorted && m[i - 1].evalue <= m[i].evalue;
        check(sorted, what + ": merged rows sorted by E-value");
        check(m.size() <= static_cast<size_t>(base.max_tag_count), what + ": the merged rows keep one pass's cap");
      }
    std::cout << "c. SPLIT, " << spectra << " spectra: true tags b/y-only N-half " << by_nhalf << " C-half " << by_chalf
              << "; c/z-only C-half " << cz_chalf << " N-half " << cz_nhalf << "; merged with both halves " << both_halves
              << "; E-values checked " << e_checked << " (mismatch " << e_mismatch << ")\n";
    check(by_nhalf == 0, "read as b/y, no tag of the c/z half has true flanks");
    check(cz_chalf == 0, "read as c/z, no tag of the b/y half has true flanks");
    check(by_chalf >= 10 && cz_nhalf >= 10, "each single reading has true tags in its own half (the fixture works)");
    check(both_halves >= 8, "two passes: both halves have true tags in at least 8 of 10 spectra (" +
                                std::to_string(both_halves) + ")");
    check(wrong_series == 0, "a true-flank row of either half carries that half's series");
    check(e_checked >= 50 && e_mismatch == 0, "merged E-values are exactly 2x the single pass's");
  }

  // ---- (d) pure ladders: rank 1 ----
  {
    struct Kind
    {
      CzSynth::Ions ions;
      const char* name;
    };
    for (const Kind k : {Kind{CzSynth::Ions::BY, "b/y"}, Kind{CzSynth::Ions::CZ, "c/z"}, Kind{CzSynth::Ions::BYCZ, "b/y+c/z"}})
    {
      int r_by = 0, r_cz = 0, r_both = 0;
      for (const char* pc : kPeptides)
        for (int z : {2, 3})
        {
          const CzSynth::Spec s = CzSynth::make(pc, z, k.ions, z - 1, 20, 900u + static_cast<unsigned>(z));
          const auto one = [&](const std::vector<FASTag::Tag>& v) { return !v.empty() && flankTrue(pc, v.front()); };
          r_by += one(rd.by(s, z));
          r_cz += one(rd.cz(s, z));
          r_both += one(rd.both(s, z));
        }
      std::cout << "d. " << k.name << " ladders, rank-1 true of 10: by " << r_by << ", cz " << r_cz << ", both " << r_both
                << "\n";
      if (k.ions == CzSynth::Ions::BY) check(r_by >= 8 && r_both >= r_by - 1, "b/y ladders: both ~ by at rank 1");
      if (k.ions == CzSynth::Ions::CZ) check(r_cz >= 8 && r_both >= r_cz - 1, "c/z ladders: both ~ cz at rank 1");
      if (k.ions == CzSynth::Ions::BYCZ)
        check(r_both >= std::max(r_by, r_cz) - 1, "b/y+c/z ladders: both at least ~ the better single reading");
    }
  }

  // ---- (e) consumers per row ----
  {
    // A SPLIT spectrum of a peptide inside a protein: its merged rows are
    // placed exactly by TagRecon with their own series' pair only.
    const std::string pep = "VGAHAGEYGAEALER";
    std::vector<OpenMS::FASTAFile::FASTAEntry> entries;
    entries.emplace_back("PROT1", "test protein", "MSTVWYAAR" + pep + "GTANLEFDSK");
    FASTag::ProteomeIndex idx;
    idx.build(entries, {}, 0);
    FASTag::TagReconciler r(0.02, false, true);
    r.attach(&idx, 0, 4);
    const CzSynth::Spec s = CzSynth::make(pep, 2, CzSynth::Ions::SPLIT, 1, 10, 77u);
    FASTag::Param p4 = base;
    p4.tag_length = 4;
    const Reader r4(p4);
    const auto exact = [&](const FASTag::Tag& t, const IS::IonPair* ip) {
      for (const auto& x : r.reconcile(FASTag::baseSequence(t.seq), t.nterm_mass, t.cterm_mass, nullptr, 2, nullptr, ip))
        if (x.peptide == pep && x.nterm_match && x.cterm_match && std::fabs(x.delta_mass) < 0.02) return true;
      return false;
    };
    int cz_rows = 0, cz_own = 0, cz_as_by = 0, by_rows = 0, by_own = 0, by_as_cz = 0, cz_rev = 0, by_rev = 0;
    for (const auto& t : r4.both(s, 2))
    {
      if (!flankTrue(pep, t)) continue;
      const bool cz = t.ion_series == IS::Series::CZ;
      const IS::IonPair* own = cz ? &czp : nullptr;  // FASTag.cpp: c/z rows pass &cz_pair, b/y rows nullptr
      const IS::IonPair* other = cz ? nullptr : &czp;
      const bool rev = trueOcc(pep, t).rev;
      (cz ? cz_rows : by_rows) += 1;
      (cz ? cz_own : by_own) += exact(t, own);
      // A forward read places under either convention (same flank sums);
      // only a reversed read tells the series apart.
      if (rev) (cz ? cz_as_by : by_as_cz) += exact(t, other);
      if (rev) (cz ? cz_rev : by_rev) += 1;
    }
    std::cout << "e. SPLIT " << pep << ": " << cz_rows << " true c/z rows (" << cz_own << " placed with c/z; of "
              << cz_rev << " reversed, " << cz_as_by << " placed with b/y), " << by_rows << " true b/y rows (" << by_own
              << " placed with b/y; of " << by_rev << " reversed, " << by_as_cz << " placed with c/z)\n";
    check(cz_rows >= 2 && by_rows >= 2, "(e) the merged reading has true rows of both series");
    check(cz_own == cz_rows && by_own == by_rows, "(e) every true row places exactly with its own series' pair");
    check(cz_rev >= 1 && by_rev >= 1, "(e) reversed rows of both series (the check below is not empty)");
    check(cz_as_by == 0 && by_as_cz == 0, "(e) no reversed row places with the other series' pair");
    // Digest: one reversed read next to the C-terminal R, in each series'
    // convention, counts R at P1 with its own offset only.
    const size_t kpos = pep.size() - 5;
    const std::string krev = std::string(pep.rbegin() + 1, pep.rbegin() + 5);
    const int R = FASTag::Digest::aaIndex('R');
    for (const IS::IonPair* ip : {&byp, &czp})
    {
      const auto [kn, kc] = flanksOf(pep, kpos, 4, true, *ip);
      FASTag::Digest::TerminusCounter own, wrong;
      if (ip == &byp) { own.add(kn, kc, krev); wrong.add(kn, kc, krev, czp.reversedOffset()); }
      else { own.add(kn, kc, krev, czp.reversedOffset()); wrong.add(kn, kc, krev); }
      check(R >= 0 && own.cterm()[static_cast<size_t>(R)] == 1 && wrong.cterm()[static_cast<size_t>(R)] == 0,
            std::string("(e) the digest counts a reversed ") + IS::seriesName(ip->kind) + " read with its own offset");
    }
  }

  // ---- (f) INFO and WARN lines ----
  {
    IS::SeriesCounts sc;
    sc.ms2_by = 4;
    sc.ms2_cz = 3;
    IS::ActivationCounts act;
    act.add(A::ELECTRON);
    act.add(A::HYBRID);
    const std::string v112 =
        "Ion series (-ion_series auto): 3 MS2 spectra tagged as c/z-dot ions, 4 as b/y ions (activation: 0 "
        "collisional, 1 electron, 1 hybrid, 0 unknown).";
    check(IS::seriesInfo(IS::Mode::AUTO, sc, act) == v112, "auto without hybrid_both: 1.12's INFO line");
    check(IS::seriesInfo(IS::Mode::AUTO, sc, act, false) == v112, "hybrid_both false is the 1.12 line");
    sc.ms2_hybrid = 2;
    const std::string hb = IS::seriesInfo(IS::Mode::AUTO, sc, act, true);
    check(hb == "Ion series (-ion_series auto): 3 MS2 spectra tagged as c/z-dot ions, 4 as b/y ions, 2 as b/y and "
                "c/z-dot ions (hybrid, two passes) (activation: 0 collisional, 1 electron, 1 hybrid, 0 unknown).",
          "auto + both: the hybrid count (" + hb + ")");
    check(IS::seriesInfo(IS::Mode::CZ, sc, act, true).find("hybrid, two") == std::string::npos,
          "cz never names two passes");
    check(!std::regex_search(hb, kGateSummary) && hb.find('\n') == std::string::npos, "one line, not the gate pattern");
  }

  // ---- (g) RunMeta rows ----
  {
    namespace RR = FASTag::RunReport;
    RR::RunMeta m;
    m.ion_series = "auto";
    m.ion_series_ms2_by = 5;
    m.ion_series_ms2_cz = 1;
    const auto find = [](const std::vector<FASTag::Digest::Row>& rows, const std::string& key) -> const FASTag::Digest::Row* {
      for (const auto& r : rows)
        if (r.key == key) return &r;
      return nullptr;
    };
    auto rows = RR::runRows(m, RR::Emit::VERSIONED);
    check(find(rows, "ion_series_cz") && !find(rows, "ion_series_hybrid"), "no hybrid row by default (1.12 layout)");
    const size_t n112 = rows.size();
    m.ion_series_hybrid_row = true;
    m.ion_series_ms2_hybrid = 3;
    rows = RR::runRows(m, RR::Emit::VERSIONED);
    const auto* hr = find(rows, "ion_series_hybrid");
    check(hr && hr->value == "3" && hr->n == "9", "a two-pass run writes ion_series_hybrid (3 of 9)");
    const auto* br = find(rows, "ion_series_by");
    check(br && br->n == "9", "the other ion_series rows count the hybrid spectra in n");
    check(rows.size() == n112 + 1, "exactly one row more");
  }

  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "hybrid_ions_test: all checks passed\n";
  return 0;
}
