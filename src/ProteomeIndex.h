// A per-run, in-memory locate index over a whole proteome: where does this
// tag occur, and what are the database flanking masses of a tryptic window
// around that occurrence? The substrate TagRecon needs to run at proteome
// scale (FastaFilter answers only "does this k-mer exist"; reconciliation
// needs positions, proteins and flank masses).
//
// One suffix array over the concatenated, I/L-folded proteome with '#'
// sentinels between proteins, plus prefix-mass checkpoints and per-segment
// tryptic cleavage boundaries: ~6.5 bytes per residue, 4 of them the suffix
// array. Human reference proteome: ~75 MB, ~1.4 s to build on one thread --
// cheap enough to rebuild per run, so nothing is persisted and there is no
// cache-invalidation surface.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#pragma once

#include "ResidueFold.h"

#include <OpenMS/FORMAT/FASTAFile.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace FASTag
{
  /**
    @brief A per-run, in-memory locate index over a whole proteome.

    One suffix array over the concatenated, I/L-folded proteome with '#'
    sentinels between proteins, plus prefix-mass checkpoints and per-segment
    tryptic cleavage boundaries (see the file comment).
  */
  class ProteomeIndex
  {
  public:
    /**
      @brief One occurrence of a (possibly collapse-respelled) tag in the text.
    */
    struct TagOcc
    {
      uint32_t pos;      ///< text position of the first matched database char
      uint16_t len;      ///< matched DATABASE length (>= tag length when a
                         ///< collapse rule spelled one tag residue as two)
      bool     reversed; ///< matched the reversed tag (b-ion reading)
    };

    /**
      @brief One tryptic window [start, end) in text coordinates containing an
      occurrence, honoring missed cleavages.
    */
    struct Window
    {
      uint32_t start, end;  ///< text positions, half-open
    };

    /**
      @brief Builds the index; every query is const and thread-safe afterwards.

      Replaces any previous content.

      @param[in] entries The database entries, in database order.
      @param[in] fixed_mods (residue, delta mass in Da); shift residue masses in
        the prefix-mass array (database peptides carry fixed mods, so database
        flanks must too). Variable mods are deliberately absent -- they are
        what reconciliation discovers as mass gaps.
      @param[in] isobaric_tol > 0 derives collapse rules at that tolerance
        (Da; shared derivation with FastaFilter), letting a tag spelling N
        match a database spelling GG. 0 disables collapse branching.
      @throw OpenMS::Exception::InvalidValue when the database exceeds the
        index's 4 GiB text limit.
    */
    void build(const std::vector<OpenMS::FASTAFile::FASTAEntry>& entries,
               const std::vector<std::pair<char, double>>& fixed_mods,
               double isobaric_tol);

    /**
      @brief All occurrences of @p tag.

      Collapse rules are applied query-side. Deduplicated on (pos, len,
      reversed).

      @param[in] tag Base residues, N->C, unfolded ok.
      @param[in] both Also search the reversed tag.
      @param[in,out] out The occurrences are appended.
    */
    void locateTag(const std::string& tag, bool both, std::vector<TagOcc>& out) const;

    /**
      @brief Tryptic windows containing [pos, pos+len).

      Windows never span a sentinel or an ambiguity residue: both are hard
      cleavage barriers (a window beside an X is still usable; one
      containing it never forms).

      @param[in] pos Text position of the occurrence.
      @param[in] len Its length.
      @param[in] missed_cleavages Maximum number of internal cleavage sites.
      @param[in,out] out The windows are appended.
    */
    void windowsAt(uint32_t pos, uint32_t len, int missed_cleavages,
                   std::vector<Window>& out) const;

    /**
      @brief Windows by mass instead of by cleavage site (1.13 item 20).

      Every window [s, e) around [pos, pos+len) whose N-side mass (text
      [s, pos)) is within @p tol of one of @p want_n and whose C-side mass
      (text [pos+len, e)) is within @p tol of one of @p want_c, inside one
      sentinel- and ambiguity-free segment. A candidate set for tryPlace,
      which judges each flank at its own tolerance; ascending (start, end),
      no duplicates.

      @param[in] pos Text position of the occurrence.
      @param[in] len Its length.
      @param[in] want_n Wanted N-side masses (Da).
      @param[in] want_c Wanted C-side masses (Da).
      @param[in] tol Mass tolerance (Da).
      @param[in,out] out The windows are appended.
    */
    void windowsByMass(uint32_t pos, uint32_t len, const std::vector<double>& want_n,
                       const std::vector<double>& want_c, double tol, std::vector<Window>& out) const;

    /**
      @brief The database sequence of protein @p i as the index keeps it.

      Original spelling, ambiguity residues as 'X', so text position
      starts + k is residue k (proteinOffset's coordinates).

      @param[in] i Protein ordinal (database order).
      @return The sequence.
    */
    std::string proteinText(uint32_t i) const;

    /**
      @brief Sum of (fixed-mod-adjusted) residue masses over text [from, to).

      @param[in] from First text position.
      @param[in] to One past the last text position.
      @return The mass (Da).
    */
    double massBetween(uint32_t from, uint32_t to) const
    {
      return prefixMass_(to) - prefixMass_(from);
    }

    /**
      @brief Accession of the protein covering text position @p pos.

      @param[in] pos Text position.
      @return The accession; empty when no protein covers @p pos.
    */
    const std::string& proteinAt(uint32_t pos) const;
    /**
      @brief Ordinal (0-based, database order) of the protein covering text position @p pos.

      @param[in] pos Text position.
      @return The ordinal; proteinCount() for a position before the first
        protein, which build() never produces.
    */
    uint32_t proteinIndexAt(uint32_t pos) const;
    /// @brief Accession of protein @p i.
    /// @param[in] i Protein ordinal (database order, i < proteinCount()).
    /// @return The accession.
    const std::string& accession(uint32_t i) const { return acc_[i]; }
    /**
      @brief Residues the index keeps of protein @p i.

      The letters of its database sequence; ambiguity residues count, dropped
      non-letters do not.

      @param[in] i Protein ordinal (database order).
      @return The length.
    */
    uint32_t proteinLength(uint32_t i) const
    {
      const size_t end = i + 1 < starts_.size() ? starts_[i + 1] : text_.size();
      return static_cast<uint32_t>(end - starts_[i] - 1);  // less the '#' sentinel
    }
    /**
      @brief 0-based residue position of text position @p pos in its protein.

      Known limit: counts the letters the index keeps, so a non-letter inside
      a database sequence (a mid-protein '*') shifts the positions after it.

      @param[in] pos Text position.
      @return The residue position.
    */
    uint32_t proteinOffset(uint32_t pos) const;

    /**
      @brief Original (unfolded, as-in-database) spelling of text [from, to).

      @param[in] from First text position.
      @param[in] to One past the last text position.
      @return The spelling.
    */
    std::string originalText(uint32_t from, uint32_t to) const;
    /**
      @brief Folded spelling of text [from, to) (what matching ran on).

      @param[in] from First text position.
      @param[in] to One past the last text position.
      @return The spelling.
    */
    std::string foldedText(uint32_t from, uint32_t to) const
    {
      return text_.substr(from, to - from);
    }

    /// @brief Number of residues indexed.
    /// @return The count.
    size_t residueCount() const { return residues_; }
    /// @brief Number of proteins indexed.
    /// @return The count.
    size_t proteinCount() const { return starts_.size(); }
    /// @brief Number of collapse rules derived at build().
    /// @return The count.
    size_t collapseRuleCount() const { return rules_.size(); }

    /// @brief autoMinFilterLen() over this text, both orientations.
    /// @return The minimum filter length.
    int autoMinLen() const;

    /// Suffix order: the first SORT_DEPTH chars, ties broken by position -- a
    /// strict total order, so every correct sort yields the same array.
    /// SORT_DEPTH must exceed the longest pattern locate can ask about (a
    /// 25-residue tag collapse-respelled pair by pair is 50 database chars);
    /// past it the order is by position, which is fine BECAUSE locate refines
    /// character by character and never compares past the pattern.
    static constexpr size_t SORT_DEPTH = 64;
    /**
      @brief Suffix order of suffixes @p a and @p b of text @p t (see SORT_DEPTH).

      @param[in] t The text.
      @param[in] n Length of the text.
      @param[in] a Start of the first suffix.
      @param[in] b Start of the second suffix.
      @return true when suffix @p a sorts before suffix @p b.
    */
    static bool suffixLess(const char* t, size_t n, uint32_t a, uint32_t b)
    {
      const size_t la = n - a, lb = n - b;
      const size_t l = std::min(std::min(la, lb), SORT_DEPTH);
      const int c = std::memcmp(t + a, t + b, l);
      if (c) return c < 0;
      if (l == SORT_DEPTH) return a < b;
      return la < lb;
    }
    /**
      @brief Suffix array of @p text under suffixLess.

      Sorted in parallel over three-character buckets.

      @param[in] text The text ('#' and 'A'..'Z' only).
      @return The suffix array.
    */
    static std::vector<uint32_t> suffixArray(const std::string& text);

  private:
    struct Range { uint32_t lo, hi; };  ///< half-open SA interval

    /// Prefix-mass checkpoint spacing. A lookup re-adds at most this many
    /// residue masses, in the order the build summed them, so every prefix is
    /// bit-identical to a full per-position array at 1/32 of its memory.
    static constexpr size_t PREFIX_STRIDE = 32;
    /// Residue mass of text_[0..i).
    double prefixMass_(size_t i) const
    {
      double m = ckpt_[i / PREFIX_STRIDE];
      for (size_t k = i - i % PREFIX_STRIDE; k < i; ++k)
        m += mass_[static_cast<unsigned char>(text_[k])];
      return m;
    }

    char charAt_(size_t p) const { return p < text_.size() ? text_[p] : '\0'; }
    Range refine_(Range r, uint32_t depth, char c) const;
    void descend_(const std::string& tag, size_t i, Range r, uint32_t depth,
                 bool reversed, size_t& budget, std::vector<TagOcc>& out) const;

    std::string text_;              ///< folded, '#'-separated, trailing '#'
    std::vector<bool> is_i_;        ///< per text position: database spelled I (text_ has L)
    std::vector<uint32_t> sa_;      ///< suffix array over text_
    double mass_[128] = {};         ///< residue mass by char; 0 for '#'
    std::vector<double> ckpt_;      ///< ckpt_[j] = residue mass of text_[0..j*PREFIX_STRIDE)
    std::vector<uint32_t> starts_;  ///< text start of each protein (sorted)
    std::vector<std::string> acc_;  ///< accession per protein
    /// Cleavage boundaries as (text position, segment id): segment start,
    /// after-K/R-not-before-P sites, segment end -- where a segment is a
    /// maximal run free of sentinels and ambiguity residues.
    std::vector<std::pair<uint32_t, uint32_t>> bounds_;
    std::vector<CollapseRule> rules_;
    size_t residues_ = 0;
  };
}
