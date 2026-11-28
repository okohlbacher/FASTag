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
// Also packs an index into the compressed form FASTag ships (tax_k7.ftz) and
// back, and verifies one:
//   buildtaxdb --pack <in.taxdb|in.ftz> <out.ftz> [level=19]
//   buildtaxdb --unpack <in.ftz> <out.taxdb>
//   buildtaxdb --verify <in.taxdb|in.ftz> [<sha256 of the .taxdb>]
// --pack re-reads what it wrote and compares it with the input byte for byte;
// --unpack restores the .taxdb the .ftz was packed from; --verify decodes,
// hashes the v2 image and checks it against the digest the .ftz records and
// the one given. Each exits 1 on any mismatch.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $

#include <OpenMS/FORMAT/FASTAFile.h>

#include "Sha256.h"
#include "TaxIndex.h"

#include <chrono>
#include <charconv>
#include <cstring>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

using namespace OpenMS;
namespace fs = std::filesystem;

namespace
{
  /// Loads @p path (any index format), reporting the time it took.
  bool loadTimed(FASTag::TaxIndex& idx, const std::string& path)
  {
    const auto t0 = std::chrono::steady_clock::now();
    std::string err;
    if (!idx.load(path, &err)) { std::cerr << "cannot load " << path << ": " << err << "\n"; return false; }
    const double s = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    std::cerr << path << ": " << (idx.packed() ? "packed (FTZ1)" : "v2 (FTX2)") << ", k=" << idx.k()
              << ", " << idx.taxa().size() << " taxa, " << idx.nKmers() << " k-mers, image "
              << idx.imageBytes() << " bytes, loaded in " << s << " s\n";
    return true;
  }

  std::string imageSha(const FASTag::TaxIndex& idx)
  {
    FASTag::Sha256 h;
    h.update(idx.image(), idx.imageBytes());
    return h.hexDigest();
  }

  int pack(int argc, char** argv)
  {
    if (argc < 4 || argc > 5) { std::cerr << "usage: buildtaxdb --pack <in> <out.ftz> [level=19]\n"; return 2; }
    int level = 19;
    if (argc == 5)
    {
      const char* const last = argv[4] + std::strlen(argv[4]);
      const auto [ptr, ec] = std::from_chars(argv[4], last, level);
      if (ec != std::errc() || ptr != last) { std::cerr << "level must be a number\n"; return 2; }
    }
    FASTag::TaxIndex in;
    if (!loadTimed(in, argv[2])) return 1;
    if (in.image() == nullptr) { std::cerr << "a v1 index cannot be packed: load and save() it as v2 first\n"; return 1; }
    const auto t0 = std::chrono::steady_clock::now();
    std::string err;
    if (!in.savePacked(argv[3], level, &err)) { std::cerr << "pack failed: " << err << "\n"; return 1; }
    std::cerr << "packed at zstd level " << level << " in "
              << std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count() << " s\n";
    FASTag::TaxIndex back;
    if (!loadTimed(back, argv[3])) return 1;
    if (back.imageBytes() != in.imageBytes() || std::memcmp(back.image(), in.image(), in.imageBytes()) != 0)
    { std::cerr << "round trip FAILED: " << argv[3] << " does not decode to " << argv[2] << "\n"; return 1; }
    const std::string sha = imageSha(in);
    if (sha != back.packedSha256()) { std::cerr << "recorded sha256 differs from the image\n"; return 1; }
    std::cerr << "round trip ok: decodes to the input byte for byte, sha256 " << sha << "\n";
    return 0;
  }

  int unpack(int argc, char** argv)
  {
    if (argc != 4) { std::cerr << "usage: buildtaxdb --unpack <in.ftz> <out.taxdb>\n"; return 2; }
    FASTag::TaxIndex in;
    if (!loadTimed(in, argv[2])) return 1;
    if (in.image() == nullptr) { std::cerr << "a v1 index has no v2 image\n"; return 1; }
    const std::string sha = imageSha(in);
    if (in.packed() && sha != in.packedSha256())
    { std::cerr << "sha256 " << sha << " differs from the recorded " << in.packedSha256() << "\n"; return 1; }
    std::string err;
    if (!in.saveImage(argv[3], &err)) { std::cerr << "unpack failed: " << err << "\n"; return 1; }
    std::cerr << "wrote " << argv[3] << ", sha256 " << sha << "\n";
    return 0;
  }

  int verify(int argc, char** argv)
  {
    if (argc < 3 || argc > 4) { std::cerr << "usage: buildtaxdb --verify <index> [<sha256>]\n"; return 2; }
    FASTag::TaxIndex in;
    if (!loadTimed(in, argv[2])) return 1;
    if (in.image() == nullptr) { std::cerr << "a v1 index has no v2 image to hash\n"; return 1; }
    const std::string sha = imageSha(in);
    bool ok = true;
    if (in.packed() && sha != in.packedSha256())
    { std::cerr << "decoded image sha256 " << sha << " differs from the recorded " << in.packedSha256() << "\n"; ok = false; }
    if (argc == 4 && sha != argv[3])
    { std::cerr << "image sha256 " << sha << ", expected " << argv[3] << "\n"; ok = false; }
    // stdout: the digest alone, for scripts.
    std::cout << sha << "\n";
    std::cerr << (ok ? "verified" : "VERIFY FAILED") << "\n";
    return ok ? 0 : 1;
  }
}

int main(int argc, char** argv)
{
  if (argc >= 2 && std::strcmp(argv[1], "--pack") == 0) return pack(argc, argv);
  if (argc >= 2 && std::strcmp(argv[1], "--unpack") == 0) return unpack(argc, argv);
  if (argc >= 2 && std::strcmp(argv[1], "--verify") == 0) return verify(argc, argv);
  if (argc < 3)
  {
    std::cerr << "usage: buildtaxdb <proteomes_dir> <out.taxdb> [k=7]\n"
                 "  <proteomes_dir> holds files named <taxid>.fasta\n"
                 "       buildtaxdb --pack <in.taxdb|in.ftz> <out.ftz> [level=19]\n"
                 "       buildtaxdb --unpack <in.ftz> <out.taxdb>\n"
                 "       buildtaxdb --verify <in.taxdb|in.ftz> [<sha256 of the .taxdb>]\n";
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
