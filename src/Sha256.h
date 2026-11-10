// SHA-256 (FIPS 180-4), for checking a shipped data file against the sha256
// its manifest records (1.13 #24: data/alkylation/proteomes.tsv). Neither
// OpenMS nor FASTag's other dependencies expose one, so it is here: plain
// C++, no state beyond one hash.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

namespace FASTag
{
  class Sha256
  {
  public:
    Sha256();
    void update(const void* data, std::size_t n);
    /// The digest as 64 lowercase hex digits; the object is spent afterwards.
    std::string hexDigest();

  private:
    void block_(const unsigned char* p);
    std::array<std::uint32_t, 8> h_;
    std::array<unsigned char, 64> buf_{};
    std::size_t fill_ = 0;
    std::uint64_t bytes_ = 0;
  };

  /// SHA-256 of a file's bytes as 64 lowercase hex digits; "" when the file
  /// cannot be read.
  std::string sha256File(const std::string& path);

  /// Whether @p s is 64 lowercase hex digits (a sha256 as sha256sum prints it).
  bool isSha256Hex(const std::string& s);
}
