// Build a FASTag taxonomic k-mer index from a directory of per-taxon FASTA files.
//
// Each input file is named <taxid>.fasta and holds one organism's proteins; the
// taxid is taken from the filename, so no header parsing is needed. All proteins
// are pooled and handed to TaxIndex::build, which records, for every I/L-folded
// k-mer, the SET of taxa whose proteins contain it (breadth, not abundance). The
// result is a compact index the classifier loads with -taxdb.
//
// Deliberately a reduced reference set (one representative proteome per
// genus/family), not complete NR: short peptide k-mers cannot resolve species,
// and a curated set keeps the LCA honest at genus/family level while staying
// small enough to index in bounded RAM.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include <OpenMS/FORMAT/FASTAFile.h>

#include "TaxIndex.h"

#include <charconv>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

using namespace OpenMS;
namespace fs = std::filesystem;

int main(int argc, char** argv)
{
  if (argc < 3)
  {
    std::cerr << "usage: buildtaxdb <proteomes_dir> <out.taxdb> [k=7]\n"
                 "  <proteomes_dir> holds files named <taxid>.fasta\n";
    return 2;
  }
  const std::string dir = argv[1];
  const std::string out = argv[2];
  // The whole argument must be a number: atoi took "7x" as 7 and "x" as 0.
  int k = 7;
  if (argc > 3)
  {
    const char* const last = argv[3] + std::char_traits<char>::length(argv[3]);
    const auto [ptr, ec] = std::from_chars(argv[3], last, k);
    if (ec != std::errc() || ptr != last) k = 0;
  }
  // Upper bound is TaxIndex::MAX_K: base-19 codes overflow a uint64 beyond it.
  if (k < 3 || k > FASTag::TaxIndex::MAX_K)
  { std::cerr << "k out of range (3.." << FASTag::TaxIndex::MAX_K << ")\n"; return 2; }

  // No exception may end the program uncaught (a missing directory throws
  // std::filesystem::filesystem_error): report it and fail with 1.
  try
  {
    std::vector<FASTAFile::FASTAEntry> entries;
    std::vector<uint32_t> taxids;
    size_t files = 0;
    for (const auto& e : fs::directory_iterator(dir))
    {
      if (!e.is_regular_file()) continue;
      const std::string path = e.path().string();
      const std::string stem = e.path().stem().string();  // "<taxid>"
      if (e.path().extension() != ".fasta") continue;
      // The WHOLE stem must be a taxid that fits uint32: strtoul took
      // "9606_backup" as 9606, accepted a sign, and wrapped 4294967297 to 1.
      uint32_t tx = 0;
      const char* const first = stem.data();
      const char* const last = first + stem.size();
      const auto [ptr, ec] = std::from_chars(first, last, tx);
      if (ec != std::errc() || ptr != last || tx == 0)
      {
        std::cerr << "  skip (filename is not <taxid>.fasta): " << path << "\n";
        continue;
      }
      std::vector<FASTAFile::FASTAEntry> part;
      try { FASTAFile().load(path, part); }
      catch (const std::exception& ex) { std::cerr << "  FASTA load failed: " << path << ": " << ex.what() << "\n"; continue; }
      for (auto& fe : part) { entries.push_back(std::move(fe)); taxids.push_back(tx); }
      ++files;
      std::cerr << "  taxid " << tx << ": " << part.size() << " proteins (" << stem << ")\n";
    }
    if (entries.empty()) { std::cerr << "no proteins loaded from " << dir << "\n"; return 1; }

    std::cerr << "building k=" << k << " index over " << entries.size()
              << " proteins from " << files << " taxa...\n";
    FASTag::TaxIndex idx;
    idx.build(entries, taxids, k);
    std::cerr << "  " << idx.nKmers() << " distinct k-mers, " << idx.taxa().size() << " taxa\n";

    std::string err;
    if (!idx.save(out, &err)) { std::cerr << "save failed: " << err << "\n"; return 1; }
    std::cerr << "wrote " << out << "\n";
    return 0;
  }
  catch (const std::exception& ex)
  {
    std::cerr << "buildtaxdb failed: " << ex.what() << "\n";
    return 1;
  }
}
