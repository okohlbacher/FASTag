// Shortlist (#5): ranking and its tie-break chain, one count per spectrum and
// protein, exact / label-exact / gapped placements, the E-value and
// min_spectra boundaries, subset and greedy parsimony, the top cap with ties,
// decoys in every affix form, duplicate identifiers, evidence-order
// invariance, the checked reduced-FASTA writer and the protease check.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Digest.h"
#include "Shortlist.h"

#include <OpenMS/FORMAT/FASTAFile.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include <string>

#ifndef _WIN32
#include <unistd.h>
#endif

namespace fs = std::filesystem;
namespace SL = FASTag::Shortlist;
using OpenMS::FASTAFile;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok)
    {
      ++failures;
      std::cerr << "FAIL: " << what << "\n";
    }
  }

  SL::Evidence ev(std::uint32_t spec, std::uint32_t prot, float e, bool exact = true, std::uint32_t ws = 0,
                  std::uint16_t wl = 8)
  {
    SL::Evidence x;
    x.spectrum = spec;
    x.protein = prot;
    x.evalue = e;
    x.exact = exact ? 1 : 0;
    x.window_start = ws;
    x.window_len = wl;
    return x;
  }

  std::vector<SL::ProteinInfo> proteins(std::size_t n, std::uint32_t len = 100)
  {
    std::vector<SL::ProteinInfo> p(n);
    for (std::uint32_t i = 0; i < n; ++i)
    {
      p[i].accession = "P" + std::string(i < 10 ? "0" : "") + std::to_string(i);
      p[i].length = len;
      p[i].canonical = i;
    }
    return p;
  }

  const SL::ProteinRow* row(const std::vector<SL::ProteinRow>& rows, const std::string& acc)
  {
    for (const auto& r : rows)
      if (r.accession == acc) return &r;
    return nullptr;
  }

  std::vector<std::string> order(const std::vector<SL::ProteinRow>& rows)
  {
    std::vector<std::string> o;
    for (const auto& r : rows) o.push_back(r.accession);
    return o;
  }

  SL::Settings open_settings()
  {
    SL::Settings s;
    s.min_spectra = 1;
    s.max_evalue = 1.0;
    return s;
  }

  FASTAFile::FASTAEntry entry(const std::string& id, const std::string& desc, const std::string& seq)
  {
    FASTAFile::FASTAEntry e;
    e.identifier = id;
    e.description = desc;
    e.sequence = seq;
    return e;
  }
}

int main()
{
  const char* tmp_env = std::getenv("TMPDIR");
  const fs::path root = fs::path(tmp_env && *tmp_env ? tmp_env : fs::temp_directory_path().string()) /
                        ("fastag-shortlist-" + std::to_string(
#ifndef _WIN32
                                                   static_cast<long>(getpid())
#else
                                                   0L
#endif
                                                       ));
  fs::create_directories(root);

  // ---- 1. ranking and the full tie-break chain
  {
    auto p = proteins(7);
    p[4].accession = "B";  // ties with 5 on everything but accession
    p[5].accession = "A";
    p[6].accession = "A";  // ties with 5 on everything: ordinal decides
    std::vector<SL::Evidence> e = {
        // P00: 3 spectra
        ev(1, 0, 0.01f), ev(2, 0, 0.01f), ev(3, 0, 0.01f),
        // P01: 2 spectra, 2 peptides
        ev(4, 1, 0.01f, true, 0), ev(5, 1, 0.01f, true, 20),
        // P02: 2 spectra, 1 peptide, alone on its spectra (weighted 2)
        ev(6, 2, 0.01f), ev(7, 2, 0.01f),
        // P03: 2 spectra, 1 peptide, shares spectrum 8 with P00..: weighted < 2
        ev(8, 3, 0.01f), ev(9, 3, 0.01f), ev(8, 0, 0.01f),
        // B, A(5), A(6): 1 spectrum each, same weighted and E
        ev(10, 4, 0.05f), ev(11, 5, 0.05f), ev(12, 6, 0.05f)};
    const auto rows = SL::rankProteins(e, p, open_settings());
    const std::vector<std::string> want = {"P00", "P01", "P02", "P03", "A", "A", "B"};
    check(order(rows) == want, "rank order follows spectra, peptides, weighted, accession");
    check(rows.size() == 7 && rows[4].ordinal == 5 && rows[5].ordinal == 6, "ordinal breaks a full tie");
    for (std::size_t i = 0; i < rows.size(); ++i) check(rows[i].rank == i + 1, "ranks are 1-based and dense");
    // best E before accession: a better E on A(6) moves it ahead of A(5)
    auto e2 = e;
    e2.back().evalue = 0.001f;
    const auto rows2 = SL::rankProteins(e2, p, open_settings());
    check(rows2[4].ordinal == 6 && rows2[5].ordinal == 5, "best E-value breaks a tie before the accession");
  }

  // ---- 2. a spectrum counts once per protein; weighted shares sum to 1
  {
    auto p = proteins(3);
    std::vector<SL::Evidence> e = {ev(1, 0, 0.01f, true, 0), ev(1, 0, 0.02f, true, 30), ev(1, 1, 0.01f),
                                   ev(1, 2, 0.01f), ev(2, 0, 0.01f)};
    const auto rows = SL::rankProteins(e, p, open_settings());
    const auto* r0 = row(rows, "P00");
    check(r0 && r0->spectra == 2, "two tags of one spectrum on one protein count once");
    check(r0 && r0->peptides == 2, "distinct windows are distinct peptides");
    double sum1 = 0;
    for (const auto& r : rows) sum1 += r.weighted;
    check(std::abs(sum1 - 2.0) < 1e-12, "weighted shares sum to 1 per spectrum (2 spectra)");
    check(r0 && std::abs(r0->weighted - (1.0 / 3 + 1.0)) < 1e-12, "spectrum 1 is shared three ways");
    check(r0 && std::abs(r0->nsaf - r0->weighted / 100.0) < 1e-15, "nsaf = weighted / length");
  }

  // ---- 3. gapped, label-exact, label + shift, unlabelled
  {
    const double tmt = 229.162932, tol = 0.02;
    check(SL::classifyPlacement(true, true, 0.0, tmt, 0, tol) == SL::Placement::Exact, "both flanks: exact");
    check(SL::classifyPlacement(false, true, tmt + 0.005, tmt, 0, tol) == SL::Placement::LabelExact,
          "N-side gap equal to the fixed N-term label is label-exact");
    check(SL::classifyPlacement(false, true, tmt + 15.994915, tmt, 0, tol) == SL::Placement::Gapped,
          "label plus another shift is gapped");
    check(SL::classifyPlacement(false, true, tmt, 0, 0, tol) == SL::Placement::Gapped,
          "without a fixed label the same gap is gapped");
    check(SL::classifyPlacement(true, false, tmt, tmt, 0, tol) == SL::Placement::Gapped,
          "an N-terminal label does not excuse a C-side gap");
    check(SL::classifyPlacement(true, false, 0.984, 0, 0.984, tol) == SL::Placement::LabelExact,
          "C-side gap equal to a fixed C-term mod is label-exact");
    // incompletely labelled peptide: both flanks match -> exact
    check(SL::classifyPlacement(true, true, 0.0, tmt, 0, tol) == SL::Placement::Exact, "unlabelled peptide is exact");

    auto p = proteins(2);
    std::vector<SL::Evidence> e = {ev(1, 0, 0.01f), ev(2, 0, 0.01f, false), ev(3, 1, 0.01f, false),
                                   ev(4, 1, 0.01f, false)};
    auto s = open_settings();
    auto rows = SL::rankProteins(e, p, s);
    check(rows.size() == 1 && rows[0].accession == "P00" && rows[0].spectra == 1,
          "gapped placements are excluded by default");
    s.gapped = true;
    rows = SL::rankProteins(e, p, s);
    const auto* r0 = row(rows, "P00");
    const auto* r1 = row(rows, "P01");
    check(r0 && r0->spectra == 2 && r0->exact_spectra == 1 && r0->gapped_spectra == 1, "-shortlist_gapped counts both");
    check(r1 && r1->gapped_spectra == 2 && r1->exact_spectra == 0, "gapped-only protein");
  }

  // ---- 4. E above max_e excluded; 5. min_spectra boundary
  {
    auto p = proteins(2);
    SL::Settings s;
    s.max_evalue = 0.1;
    s.min_spectra = 2;
    std::vector<SL::Evidence> e = {ev(1, 0, 0.1f), ev(2, 0, 0.1000001f), ev(3, 1, 0.05f), ev(4, 1, 0.05f)};
    s.max_evalue = static_cast<double>(0.1f);
    const auto rows = SL::rankProteins(e, p, s);
    const auto* r0 = row(rows, "P00");
    const auto* r1 = row(rows, "P01");
    check(r0 && r0->spectra == 1, "E above max_evalue excluded, E equal to it kept");
    check(r0 && !r0->kept && r0->reason == "below_min_spectra", "one spectrum is below min_spectra 2");
    check(r1 && r1->kept && r1->reason == "selected", "two spectra meet min_spectra 2");
  }

  // ---- 6. subset parsimony: equal set, strict subset, overlap
  {
    auto p = proteins(5);
    std::vector<SL::Evidence> e = {
        ev(1, 0, 0.01f), ev(2, 0, 0.01f), ev(3, 0, 0.01f),  // P00 {1,2,3}
        ev(1, 1, 0.02f), ev(2, 1, 0.02f), ev(3, 1, 0.02f),  // P01 {1,2,3} equal, ranks below (E)
        ev(1, 2, 0.01f), ev(2, 2, 0.01f),                    // P02 {1,2} strict subset
        ev(3, 3, 0.01f), ev(4, 3, 0.01f),                    // P03 {3,4} overlap
        ev(9, 4, 0.01f)};                                    // P04 {9}
    auto s = open_settings();
    s.parsimony = SL::Parsimony::Subset;
    const auto rows = SL::rankProteins(e, p, s);
    check(row(rows, "P00")->kept, "the first of an equal set is kept");
    check(row(rows, "P01")->reason == "subset_of:P00", "an equal set later in rank order is subset_of the first");
    check(row(rows, "P02")->reason == "subset_of:P00", "a strict subset is subset_of its superset");
    check(row(rows, "P03")->kept, "an overlap is kept");
    check(row(rows, "P04")->kept, "a disjoint protein is kept");
  }

  // ---- 7. greedy cover on a 5-protein instance
  {
    auto p = proteins(5);
    // universe 1..6. P00 {1,2,3,4}, P01 {1,2,5}, P02 {5,6}, P03 {3,4}, P04 {6}
    std::vector<SL::Evidence> e = {ev(1, 0, 0.01f), ev(2, 0, 0.01f), ev(3, 0, 0.01f), ev(4, 0, 0.01f),
                                   ev(1, 1, 0.01f), ev(2, 1, 0.01f), ev(5, 1, 0.01f), ev(5, 2, 0.01f),
                                   ev(6, 2, 0.01f), ev(3, 3, 0.01f), ev(4, 3, 0.01f), ev(6, 4, 0.01f)};
    auto s = open_settings();
    s.parsimony = SL::Parsimony::Greedy;
    const auto rows = SL::rankProteins(e, p, s);
    check(row(rows, "P00")->kept && row(rows, "P02")->kept, "greedy picks P00 then P02");
    check(row(rows, "P01")->reason == "not_in_cover" && row(rows, "P03")->reason == "not_in_cover" &&
              row(rows, "P04")->reason == "not_in_cover",
          "the rest is not_in_cover");
  }

  // ---- 8. top-N ties kept
  {
    auto p = proteins(5);
    std::vector<SL::Evidence> e = {ev(1, 0, 0.01f), ev(2, 0, 0.01f), ev(3, 0, 0.01f),  // 3 spectra
                                   ev(4, 1, 0.01f), ev(5, 1, 0.01f),                    // 2
                                   ev(6, 2, 0.01f), ev(7, 2, 0.01f),                    // 2, tie with P01
                                   ev(8, 3, 0.01f), ev(9, 3, 0.01f), ev(10, 4, 0.01f), ev(11, 4, 0.01f)};
    auto s = open_settings();
    s.top = 2;
    auto rows = SL::rankProteins(e, p, s);
    std::size_t kept = 0;
    for (const auto& r : rows) kept += r.kept;
    check(kept == 5, "ties at the cut are kept (P01..P04 all tie)");
    e.push_back(ev(12, 1, 0.01f));  // P01 now 3 spectra, P02..P04 2 each: no tie at the cut of 2
    rows = SL::rankProteins(e, p, s);
    kept = 0;
    for (const auto& r : rows) kept += r.kept;
    check(kept == 2 && row(rows, "P02")->reason == "beyond_top", "without a tie the cap holds");
  }

  // ---- 9. decoys
  {
    const auto aff = SL::defaultDecoyAffixes();
    check(SL::isDecoy("DECOY_sp|P1|X", aff) && SL::isDecoy("rev_P1", aff) && SL::isDecoy("REV_P1", aff) &&
              SL::isDecoy("Decoy_P1", aff) && SL::isDecoy("XXX_P1", aff) && SL::isDecoy("shuffled_P1", aff) &&
              SL::isDecoy("random_P1", aff) && SL::isDecoy("reverse_P1", aff),
          "every default prefix, any case");
    check(SL::isDecoy("P1_DECOY", aff) && SL::isDecoy("P1_rev", aff) && SL::isDecoy("P1_REV", aff),
          "suffix forms");
    check(!SL::isDecoy("sp|P02768|ALBU_HUMAN", aff) && !SL::isDecoy("REVERSIBLE_P1", aff) && !SL::isDecoy("P1rev", aff),
          "targets are not decoys (separator required)");
    check(SL::isDecoy("FAKE_P1", {"FAKE_"}) && !SL::isDecoy("DECOY_P1", {"FAKE_"}), "a custom affix list");
    // 1 decoy among 100 entries, mixed prefixes: none kept
    auto p = proteins(100);
    p[7].accession = "DECOY_P07";
    p[8].accession = "rev_P08";
    for (auto& x : p) x.decoy = SL::isDecoy(x.accession, aff);
    std::vector<SL::Evidence> e;
    for (std::uint32_t sp = 0; sp < 5; ++sp)
    {
      e.push_back(ev(sp, 7, 0.001f));
      e.push_back(ev(sp, 8, 0.001f));
      e.push_back(ev(sp, 3, 0.01f));
    }
    const auto rows = SL::rankProteins(e, p, open_settings());
    const auto* d1 = row(rows, "DECOY_P07");
    const auto* d2 = row(rows, "rev_P08");
    check(d1 && !d1->kept && d1->reason == "decoy" && d1->rank == 0, "a DECOY_ entry is listed as decoy, not kept");
    check(d2 && !d2->kept && d2->reason == "decoy", "a rev_ entry is listed as decoy, not kept");
    check(row(rows, "P03")->rank == 1 && std::abs(row(rows, "P03")->weighted - 5.0) < 1e-12,
          "decoys take no share of a spectrum's weight");
    check(rows.back().reason == "decoy", "decoy rows follow the target rows");
    // decoys in the background
    std::vector<FASTAFile::FASTAEntry> db = {entry("P1", "", "PEPTIDEK")};
    std::vector<FASTAFile::FASTAEntry> bg = {entry("DECOY_B1", "", "AAAK"), entry("B2", "x", "CCCK"),
                                             entry("B2_rev", "", "KCCC")};
    std::vector<FASTAFile::FASTAEntry> kept;
    std::size_t nd = 0;
    check(SL::selectBackground(db, bg, aff, kept, &nd).empty() && kept.size() == 1 && kept[0].identifier == "B2" &&
              nd == 2,
          "decoys in the background are left out");
  }

  // ---- 10. duplicates
  {
    std::vector<FASTAFile::FASTAEntry> db = {entry("A", "", "PEPK"), entry("B", "", "MMMK"), entry("A", "again", "PEPK")};
    auto d = SL::checkDuplicates(db);
    check(d.conflict.empty() && d.identical == 1 && d.canonical[2] == 0, "an identical duplicate collapses to the first");
    auto p = proteins(3);
    for (std::uint32_t i = 0; i < 3; ++i) p[i].canonical = d.canonical[i];
    p[2].accession = "P00";
    const auto rows = SL::rankProteins({ev(1, 2, 0.01f), ev(2, 0, 0.01f)}, p, open_settings());
    check(rows.size() == 1 && rows[0].ordinal == 0 && rows[0].spectra == 2, "evidence on a duplicate counts for the first");
    db.push_back(entry("B", "", "MMMR"));
    d = SL::checkDuplicates(db);
    check(d.conflict == "B", "a conflicting duplicate in the database is reported");
    std::vector<FASTAFile::FASTAEntry> bg = {entry("A", "", "PEPK"), entry("C", "", "CCK")}, kept;
    std::size_t dup = 0;
    check(SL::selectBackground({entry("A", "", "PEPK")}, bg, SL::defaultDecoyAffixes(), kept, nullptr, &dup).empty() &&
              kept.size() == 1 && dup == 1,
          "a background entry identical to a database entry is dropped");
    bg.push_back(entry("A", "", "PEPR"));
    check(SL::selectBackground({entry("A", "", "PEPK")}, bg, SL::defaultDecoyAffixes(), kept) == "A",
          "a conflict between database and background is reported");
    check(SL::selectBackground({}, {entry("Z", "", "AK"), entry("Z", "", "AR")}, SL::defaultDecoyAffixes(), kept) == "Z",
          "a conflict within the background is reported");
    // A background entry identical to a database entry the selection did not
    // keep is kept through that entry (once, at its canonical ordinal).
    {
      const std::vector<FASTAFile::FASTAEntry> tdb = {entry("H1", "", "PEPK"), entry("H2", "", "MMMK"),
                                                      entry("H1", "", "PEPK"), entry("H3", "", "CCCK")};
      const std::vector<FASTAFile::FASTAEntry> tbg = {entry("H1", "", "PEPK"), entry("H2", "", "MMMK"),
                                                      entry("H9", "", "WWWK")};
      std::vector<std::uint32_t> twins;
      std::size_t tdup = 0;
      check(SL::selectBackground(tdb, tbg, SL::defaultDecoyAffixes(), kept, nullptr, &tdup, &twins).empty() &&
                kept.size() == 1 && kept[0].identifier == "H9" && tdup == 2 &&
                twins == std::vector<std::uint32_t>({0, 1}),
            "background duplicates report their first database ordinal");
      auto tp = proteins(4);
      const auto td = SL::checkDuplicates(tdb);
      for (std::uint32_t i = 0; i < 4; ++i)
      {
        tp[i].accession = tdb[i].identifier;
        tp[i].canonical = td.canonical[i];
      }
      // H1 has one spectrum (below min_spectra 2), H2 none, H3 two (selected).
      SL::Settings ts = open_settings();
      ts.min_spectra = 2;
      auto trows = SL::rankProteins({ev(1, 2, 0.01f), ev(2, 3, 0.01f), ev(3, 3, 0.01f)}, tp, ts);
      std::vector<bool> tkeep(4, false);
      for (const auto& r : trows)
        if (r.kept) tkeep[r.ordinal] = true;
      check(row(trows, "H1") && !row(trows, "H1")->kept && row(trows, "H1")->reason == "below_min_spectra",
            "H1 is below min_spectra before the background");
      check(SL::keepBackgroundTwins(twins, tp, tkeep, trows) == 2 &&
                tkeep == std::vector<bool>({true, true, false, true}),
            "background twins below min_spectra or without evidence are kept, at the canonical ordinal");
      check(row(trows, "H1")->kept && row(trows, "H1")->reason == "background" && row(trows, "H1")->spectra == 1,
            "a ranked twin's row becomes kept, reason background");
      check(row(trows, "H2") && row(trows, "H2")->kept && row(trows, "H2")->reason == "background" &&
                row(trows, "H2")->rank == 0 && row(trows, "H2")->spectra == 0,
            "a twin without evidence gets a background row");
      check(row(trows, "H3")->reason == "selected", "a selected protein stays selected");
      check(SL::keepBackgroundTwins(twins, tp, tkeep, trows) == 0, "keeping twins twice adds nothing");
      const fs::path troot = fs::temp_directory_path() / ("fastag-sl-twins-" + std::to_string(::getpid()));
      fs::create_directories(troot);
      {
        std::ofstream f(troot / "db.fasta");
        for (const auto& e : tdb) f << '>' << e.identifier << '\n' << e.sequence << '\n';
      }
      const auto wr = SL::writeReducedFasta((troot / "db.fasta").string(), tkeep, kept, (troot / "out.fasta").string());
      std::vector<FASTAFile::FASTAEntry> back;
      if (wr.ok) FASTAFile().load((troot / "out.fasta").string(), back);
      std::size_t n_h1 = 0;
      for (const auto& e : back) n_h1 += e.identifier == "H1";
      check(wr.ok && back.size() == 4 && n_h1 == 1 && back[0].identifier == "H1" && back[1].identifier == "H2" &&
                back[2].identifier == "H3" && back[3].identifier == "H9",
            "-fasta_out holds a background twin exactly once, in database order, then the new background");
      std::error_code ec;
      fs::remove_all(troot, ec);
    }
  }

  // ---- 11. shuffled evidence gives an identical result
  {
    auto p = proteins(20);
    std::vector<SL::Evidence> e;
    std::mt19937 rng(7);
    for (std::uint32_t sp = 0; sp < 300; ++sp)
      for (int k = 0; k < 3; ++k)
      {
        // One draw per statement, last argument first (the x86-64 GCC order of the former argument list).
        const auto d = static_cast<std::uint32_t>(rng() % 5) * 10;
        const bool c = rng() % 4 != 0;
        const float b = 0.001f * static_cast<float>(rng() % 100);
        const auto a = static_cast<std::uint32_t>(rng() % 20);
        e.push_back(ev(sp, a, b, c, d));
      }
    auto s = open_settings();
    s.gapped = true;
    s.parsimony = SL::Parsimony::Greedy;
    s.top = 7;
    const auto a = SL::rankProteins(e, p, s);
    std::shuffle(e.begin(), e.end(), rng);
    const auto b = SL::rankProteins(e, p, s);
    bool same = a.size() == b.size();
    for (std::size_t i = 0; same && i < a.size(); ++i)
      same = a[i].ordinal == b[i].ordinal && a[i].spectra == b[i].spectra && a[i].weighted == b[i].weighted &&
             a[i].reason == b[i].reason && a[i].peptides == b[i].peptides;
    check(same, "the result does not depend on the evidence order");
  }

  // ---- 12. writeReducedFasta
  {
    const fs::path in = root / "in.fasta";
    {
      std::ofstream f(in);
      const std::string long_seq(150, 'A');
      f << ">P1 first protein\n" << long_seq.substr(0, 60) << "\n" << long_seq.substr(60, 60) << "\n"
        << long_seq.substr(120) << "\n";
      f << ">P2\n" << std::string(130, 'K') << "\n";  // unwrapped
      f << ">P3 third\nMPEPTIDER\n";
    }
    const std::vector<FASTAFile::FASTAEntry> bg = {entry("B1", "background one", std::string(85, 'W'))};
    const fs::path out = root / "out.fasta";
    auto r = SL::writeReducedFasta(in.string(), {true, true, false}, bg, out.string());
    check(r.ok && r.entries == 3, "reduced FASTA written");
    std::vector<FASTAFile::FASTAEntry> back;
    FASTAFile().load(out.string(), back);
    check(back.size() == 3 && back[0].identifier == "P1" && back[0].description == "first protein" &&
              back[0].sequence == std::string(150, 'A') && back[1].identifier == "P2" && back[1].description.empty() &&
              back[1].sequence == std::string(130, 'K') && back[2].identifier == "B1" &&
              back[2].description == "background one" && back[2].sequence == std::string(85, 'W'),
          "identifier, description and sequence round-trip; order kept; background last");
    {
      std::ifstream f(out);
      std::string l;
      std::size_t longest = 0;
      while (std::getline(f, l)) longest = std::max(longest, l.size());
      check(longest <= 80, "sequence lines wrapped at 80 columns");
    }
    check(!fs::exists(out.string() + ".part"), "no .part file left after success");
    r = SL::writeReducedFasta(in.string(), {false, false, false}, {}, (root / "empty.fasta").string());
    check(r.ok && r.entries == 0 && fs::exists(root / "empty.fasta") && fs::file_size(root / "empty.fasta") == 0,
          "an empty selection writes an empty file");
    r = SL::writeReducedFasta(in.string(), {true, true}, {}, (root / "short.fasta").string());
    check(!r.ok && !fs::exists(root / "short.fasta"), "a database that changed since indexing is an error");
    // A failing write: /dev/full on Linux; elsewhere a directory removed
    // before the write.
    if (fs::exists("/dev/full"))
    {
      r = SL::writeReducedFasta(in.string(), {true, true, true}, bg, "/dev/full");
      check(!r.ok && !r.error.empty(), "a write to a full device fails");
    }
    const fs::path gone = root / "gone";
    fs::create_directories(gone);
    fs::remove(gone);
    r = SL::writeReducedFasta(in.string(), {true, true, true}, bg, (gone / "x.fasta").string());
    check(!r.ok && !fs::exists(gone / "x.fasta") && !fs::exists(gone / "x.fasta.part"),
          "a write into a removed directory fails and leaves nothing");
    // the shortlist TSV
    std::string err;
    SL::ProteinRow pr;
    pr.accession = "P\t1";
    pr.rank = 1;
    pr.spectra = 2;
    pr.kept = true;
    pr.reason = "selected";
    check(SL::writeShortlist((root / "sl.tsv").string(), {"a header"}, {pr}, bg, &err), "shortlist written");
    std::ifstream f(root / "sl.tsv");
    std::string l1, l2, l3, l4;
    std::getline(f, l1);
    std::getline(f, l2);
    std::getline(f, l3);
    std::getline(f, l4);
    check(l1 == "# a header", "header line");
    check(l2.rfind("rank\taccession\tspectra", 0) == 0, "column header");
    check(std::count(l3.begin(), l3.end(), '\t') == 11 && l3.find("P 1") != std::string::npos, "12 fields, tab escaped");
    check(l4 == "-\tB1\t0\t0\t0\t0\t0.0000\t0\t-\t85\t1\tbackground", "background row");
  }

  // ---- protease verdict
  {
    FASTag::Digest::Classification c;
    c.scored = true;
    c.n_c = 500;
    c.scores = {{"Trypsin", "Trypsin", -1000.0}, {"Lys-C", "Lys-C", -1100.0}, {"Chymotrypsin", "Chymotrypsin", -1500.0}};
    c.top = 0;
    c.runner_up = 2;
    check(SL::proteaseVerdict(c, false, 500).kind == SL::ProteaseVerdict::Compatible, "trypsin call proceeds");
    c.top = 1;
    check(SL::proteaseVerdict(c, false, 500).kind == SL::ProteaseVerdict::Compatible, "Lys-C call proceeds");
    c.scores[2].loglik = -800.0;
    c.top = 2;
    auto v = SL::proteaseVerdict(c, false, 500);
    check(v.kind == SL::ProteaseVerdict::NonTryptic && v.model == "Chymotrypsin" && std::abs(v.margin - 0.4) < 1e-12,
          "a confident chymotrypsin call refuses");
    check(SL::proteaseVerdict(c, true, 500).kind == SL::ProteaseVerdict::Inconclusive, "a Da run is inconclusive");
    check(SL::proteaseVerdict(c, false, 99).kind == SL::ProteaseVerdict::Inconclusive, "fewer than 100 spectra");
    c.scores[2].loglik = -999.0;  // margin 1/500 = 0.002 < 0.05
    check(SL::proteaseVerdict(c, false, 500).kind == SL::ProteaseVerdict::Inconclusive, "a thin margin is inconclusive");
    c.scored = false;
    check(SL::proteaseVerdict(c, false, 500).kind == SL::ProteaseVerdict::Inconclusive, "too few tag ends");
    c.scored = true;
    c.tied = {"Chymotrypsin", "Trypsin"};
    check(SL::proteaseVerdict(c, false, 500).kind == SL::ProteaseVerdict::Inconclusive, "a tie is inconclusive");
  }

  std::error_code ec;
  fs::remove_all(root, ec);
  if (failures)
  {
    std::cerr << failures << " check(s) failed\n";
    return 1;
  }
  std::cout << "shortlist_test: all checks passed\n";
  return 0;
}
