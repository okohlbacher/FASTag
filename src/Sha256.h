// SHA-256 (FIPS 180-4), for checking a shipped data file against the sha256
// its manifest records (1.13 #24: data/alkylation/proteomes.tsv). Neither
// OpenMS nor FASTag's other dependencies expose one, so it is here: plain
// C++, no state beyond one hash.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

namespace FASTag
{
  /**
    @brief Incremental SHA-256 (FIPS 180-4) hasher for one message.

    Feed bytes with update(), then call hexDigest() once.
  */
  class Sha256
  {
  public:
    /// @brief Starts a new hash with the FIPS 180-4 initial state.
    Sha256();
    /**
      @brief Appends bytes to the message being hashed.

      @param[in] data Pointer to the bytes to append.
      @param[in] n Number of bytes to append.
    */
    void update(const void* data, std::size_t n);
    /**
      @brief Finishes the hash and returns the digest.

      The digest as 64 lowercase hex digits; the object is spent afterwards.

      @return The SHA-256 digest as 64 lowercase hex digits.
    */
    std::string hexDigest();

  private:
    void block_(const unsigned char* p);
    std::array<std::uint32_t, 8> h_;
    std::array<unsigned char, 64> buf_{};
    std::size_t fill_ = 0;
    std::uint64_t bytes_ = 0;
  };

  /**
    @brief Computes the SHA-256 of a file's bytes.

    @param[in] path Path of the file to hash.
    @return The digest as 64 lowercase hex digits; "" when the file cannot be read.
  */
  std::string sha256File(const std::string& path);

  /**
    @brief Checks whether a string is a SHA-256 digest in hex form.

    @param[in] s String to check.
    @return Whether @p s is 64 lowercase hex digits (a sha256 as sha256sum prints it).
  */
  bool isSha256Hex(const std::string& s);
}
