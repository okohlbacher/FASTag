// Restrict reported tags to those occurring in supplied sequences.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "ResidueFold.h"

#include <OpenMS/FORMAT/FASTAFile.h>

#include <compare>
#include <cstdint>
#include <string>
#include <vector>

namespace FASTag
{
  /// @brief The longest tag the filter indexes: residues per key at 5 bits each in a 128-bit word.
  ///
  /// A uint64 holds only 12 residues (5*13 = 65 > 64) while the realised tag
  /// length reaches seed + 2*extension = 15 at the documented budget, so 64-bit
  /// packing would silently collide on exactly the long tags that carry the most
  /// information. Over-length tags are rejected, never truncated.
  constexpr int MAX_FILTER_LEN = 25;

  /// @brief The effective amino-acid alphabet size used for chance rates.
  ///
  /// Amino acids are far from uniform: with I/L folded, sum(f^2) = 0.068 over
  /// the human proteome, so the effective alphabet is 1/0.068 = 14.7, not 19.
  /// Using 19 understates the chance rate and picks a floor one residue short.
  constexpr double EFF_ALPHABET = 14.7;

  /**
    @brief Smallest tag length whose expected chance-match rate against @p residues database residues is below 5%.

    k = ceil(log_A(20*c*M)), with A the effective alphabet and c=2 when both
    orientations match. Gives 4 for a 392-residue protein, 8 for the human
    proteome.

    @param[in] residues the number of database residues (M)
    @param[in] both_orientations whether reversed tags also match (c=2)
    @return the length, clamped to [1, MAX_FILTER_LEN]; 1 for an empty database
  */
  int autoMinFilterLen(size_t residues, bool both_orientations);

  /**
    @brief A 125-bit k-mer key as two 64-bit halves.

    Portable where __uint128_t is not, e.g. MSVC; the only operations needed
    are shift-in and comparison.
  */
  struct Kmer128
  {
    uint64_t hi = 0, lo = 0;  ///< high and low 64 bits of the key

    /// @brief Ordering for the sorted query index (lexicographic on (hi, lo), the
    /// member order); also defaults == and !=.
    auto operator<=>(const Kmer128&) const noexcept = default;

    /// @brief Shift left 5 bits and insert a residue code in the low bits.
    /// @param[in] code the residue code (only its low 5 bits are used)
    void push5(uint64_t code) noexcept
    {
      hi = (hi << 5) | (lo >> 59);   // the 5 bits leaving lo enter hi
      lo = (lo << 5) | (code & 0x1full);
    }
    /// @brief The key with all bits set, used as an invalid marker.
    /// @return the invalid key
    static Kmer128 invalid() noexcept { return {~0ull, ~0ull}; }
  };

  /**
    @brief Restricts reported tags to those occurring in supplied sequences.

    An index of every k-mer of the sequences (I folded to L, optional
    residue/pair collapses) per tag length, queried by match().
  */
  class FastaFilter
  {
  public:
    /// @brief How a tag matched.
    enum class Hit { None, Forward, Reverse };

    /**
      @brief Creates an empty filter.
      @param[in] both_orientations also match the reversed tag.
        Tags are stored N->C under a y-ion assumption, so b-derived tags (~57%
        of output) read reversed relative to the sequence. Forward-only would
        discard most of them. Costs a factor of two in chance rate -- 0.26
        residues of effective length -- and buys 2.3x recall.
    */
    explicit FastaFilter(bool both_orientations = true) : both_(both_orientations) {}

    /**
      @brief Adopt sequences parsed by OpenMS.

      I is folded to L unconditionally and there is deliberately no flag: the
      tagger traverses on canonical L because I and L are isobaric, so an
      emitted L carries no information about which residue it was. A "literal"
      match would not be strict, it would silently reject every match landing on
      an isoleucine. Entries with no usable residue are skipped.

      @param[in] entries the FASTA entries
      @param[out] err if not null, receives "no usable sequence" on failure
      @return false when no entry has a usable sequence
    */
    bool load(const std::vector<OpenMS::FASTAFile::FASTAEntry>& entries, std::string* err = nullptr);

    /**
      @brief Derives interchangeable residue/pair rules from the residue masses at @p tol rather than hardcoding them.

      A tag reading N where the sequence spells GG is a mass-correct reading of
      the true peptide that exact string matching rejects -- a recall loss that
      is sequence-correlated, not random. At 0.04 Da (20 ppm over two peaks at
      m/z 1000) the derived set is N=GG, Q=GA/AG, R=GV/VG, W=AD/GE/SV, K=GA.
      No residue equals a sum of three, so one level of collapse suffices.

      @param[in] tol the mass tolerance (Da)
      @param[in] fixed_deltas shifts residue masses before comparison (fixed mods:
        a carbamidomethylated C is 57 Da heavier, which changes which sums are
        isobaric) so the rules match the alphabet the tagger actually spells
    */
    void deriveCollapses(double tol, const std::vector<std::pair<char, double>>& fixed_deltas = {});
    /// @brief The number of collapse rules derived.
    /// @return the rule count
    size_t collapseRules() const { return rules_.size(); }

    /**
      @brief Sets the minimum tag length explicitly.

      Below this length the filter is close to the identity function, so it is
      derived from database size unless set explicitly.

      @param[in] n the minimum length; <= 0 falls back to autoMinLen()
    */
    void setMinLen(int n) { min_len_ = n; min_len_auto_ = false; }
    /// @brief The minimum tag length: the explicit one if positive, else autoMinLen().
    /// @return the minimum length
    int  minLen() const { return min_len_ > 0 ? min_len_ : autoMinLen(); }
    /// @brief Whether the minimum length was left to autoMinLen() (setMinLen() not called).
    /// @return true when automatic
    bool minLenAuto() const { return min_len_auto_; }

    /// @brief autoMinFilterLen() for this database and orientation setting.
    /// @return the automatic minimum length
    int autoMinLen() const { return autoMinFilterLen(residues_, both_); }

    /**
      @brief Expected fraction of random length-k tags that match, so an observed count is never mistaken for signal.
      @param[in] k the tag length
      @return the chance rate; 0 outside [1, MAX_FILTER_LEN]
    */
    double chanceRate(int k) const;

    /**
      @brief Build indices for every length that can occur.

      Call once, after load() and any deriveCollapses(); the filter is
      immutable and thread-safe after. Lengths are clamped to
      [minLen(), MAX_FILTER_LEN].

      A separate full index is materialised per length, so the footprint scales
      with (database residues x number of lengths) -- roughly 0.9 GB for a 3 M
      residue database at seed 6 with extension 6, and far more for a proteome.
      Above @p max_bytes this THROWS rather than returning a status: every
      caller would otherwise have to remember to check, and a filter that
      silently built nothing would reject 100% of tags while looking healthy.

      @param[in] min_k the shortest length to index
      @param[in] max_k the longest length to index
      @param[in] max_bytes the largest projected footprint allowed (bytes)
      @throw OpenMS::Exception::InvalidParameter if the projection exceeds max_bytes,
        or no length in the range reaches minLen()
      @throw OpenMS::Exception::InvalidValue if one length holds more than 2^32 keys
    */
    void build(int min_k, int max_k, size_t max_bytes = size_t(4) << 30);

    /**
      @brief Projected index footprint in bytes for the given length range.
      @param[in] min_k the shortest length (raised to minLen())
      @param[in] max_k the longest length (capped at MAX_FILTER_LEN)
      @return the projected bytes
    */
    size_t projectBytes(int min_k, int max_k) const;

    /// @brief Keys actually indexed, valid after build().
    /// @return the key count over all lengths
    size_t indexedKeys() const;

    /**
      @brief Distinct keys at one length.
      @param[in] k the tag length
      @return the key count; 0 outside the built range
    */
    size_t keyCount(int k) const;

    /**
      @brief Keys of THIS filter at length @p k that are also accepted by @p other at that length.

      Counted ORIENTATION-CLOSED when @p other matches both orientations (the
      accepting side's matching semantics): a key is shared if other holds
      the key or its reverse. This is the honest overlap for entrapment
      accounting -- two databases spelling the same peptide in opposite
      directions accept identical tag sets even though their stored key sets
      are disjoint.

      @param[in] other the accepting filter
      @param[in] k the tag length
      @return the shared key count; 0 when length @p k is not built here
    */
    size_t sharedKeyCount(const FastaFilter& other, int k) const;

    /**
      @brief Matches @p tag (I folded to L) against the index.
      @param[in] tag the tag residues, N->C
      @return Forward or Reverse (reversed tag, when both orientations are on); None when shorter than minLen() or absent
    */
    Hit match(const std::string& tag) const;

    /// @brief The number of sequences loaded.
    /// @return the sequence count
    size_t sequenceCount() const { return seqs_.size(); }
    /// @brief The number of residues loaded.
    /// @return the residue count
    size_t residueCount() const { return residues_; }

  private:
    static Kmer128 encode(const char* s, int n);
    static Kmer128 reverseKey(Kmer128 v, int k);
    bool hasKey(int k, const Kmer128& e) const;
    bool contains(const std::string& t) const;
    void emitReadings(const std::string& seq, size_t i, int k, std::string& cur,
                      std::vector<Kmer128>& out, size_t& budget) const;

    bool both_;
    int  min_len_ = 0;
    bool min_len_auto_ = true;
    size_t residues_ = 0;
    std::vector<std::string> seqs_;
    std::vector<CollapseRule> rules_;
    /// Per-length query index: sorted keys plus a 16-bit prefix bucket table
    /// (offsets into keys by the top 16 bits of the encoded value). The buckets
    /// narrow each membership test from a ~23-probe binary search over 12 M
    /// keys to ~8 probes over ~200, for 256 KB per length.
    struct LenIndex
    {
      std::vector<Kmer128> keys;
      std::vector<uint32_t> buck;  ///< 65537 offsets; empty until built
      int shift = 0;               ///< bits to drop so 16 bits of prefix remain
    };
    std::vector<LenIndex> idx_;
    std::vector<char> built_;
  };
}
