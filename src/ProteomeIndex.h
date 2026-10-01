// A per-run, in-memory locate index over a whole proteome: where does this
// tag occur, and what are the database flanking masses of a tryptic window
// around that occurrence? The substrate TagRecon needs to run at proteome
// scale (FastaFilter answers only "does this k-mer exist"; reconciliation
// needs positions, proteins and flank masses).
//
// One suffix array over the concatenated, I/L-folded proteome with '#'
// sentinels between proteins, plus a double prefix-mass array and per-segment
// tryptic cleavage boundaries. Human reference proteome: ~46 MB SA + ~91 MB
// prefix masses, ~2 s to build -- cheap enough to rebuild per run, so nothing
// is persisted and there is no cache-invalidation surface.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
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
  class ProteomeIndex
  {
  public:
    /// One occurrence of a (possibly collapse-respelled) tag in the text.
    struct TagOcc
    {
      uint32_t pos;      ///< text position of the first matched database char
      uint16_t len;      ///< matched DATABASE length (>= tag length when a
                         ///< collapse rule spelled one tag residue as two)
      bool     reversed; ///< matched the reversed tag (b-ion reading)
    };

    /// One tryptic window [start, end) in text coordinates containing an
    /// occurrence, honoring missed cleavages.
    struct Window
    {
      uint32_t start, end;
    };

    /// Build once; every query is const and thread-safe afterwards.
    ///
    /// @p fixed_mods shift residue masses in the prefix-mass array (database
    ///   peptides carry fixed mods, so database flanks must too). Variable
    ///   mods are deliberately absent -- they are what reconciliation
    ///   discovers as mass gaps.
    /// @p isobaric_tol > 0 derives collapse rules at that tolerance (shared
    ///   derivation with FastaFilter), letting a tag spelling N match a
    ///   database spelling GG. 0 disables collapse branching.
    void build(const std::vector<OpenMS::FASTAFile::FASTAEntry>& entries,
               const std::vector<std::pair<char, double>>& fixed_mods,
               double isobaric_tol);

    /// All occurrences of @p tag (base residues, N->C, unfolded ok), collapse
    /// rules applied query-side, both orientations when @p both. Deduplicated
    /// on (pos, len, reversed). Appends to @p out.
    void locateTag(const std::string& tag, bool both, std::vector<TagOcc>& out) const;

    /// Tryptic windows containing [pos, pos+len), with at most
    /// @p missed_cleavages internal cleavage sites. Windows never span a
    /// sentinel or an ambiguity residue: both are hard cleavage barriers (a
    /// window beside an X is still usable; one containing it never forms).
    void windowsAt(uint32_t pos, uint32_t len, int missed_cleavages,
                   std::vector<Window>& out) const;

    /// Sum of (fixed-mod-adjusted) residue masses over text [from, to).
    double massBetween(uint32_t from, uint32_t to) const
    {
      return prefix_[to] - prefix_[from];
    }

    /// Accession of the protein covering text position @p pos.
    const std::string& proteinAt(uint32_t pos) const;

    /// Original (unfolded, as-in-database) spelling of text [from, to).
    std::string originalText(uint32_t from, uint32_t to) const
    {
      return orig_.substr(from, to - from);
    }
    /// Folded spelling of text [from, to) (what matching ran on).
    std::string foldedText(uint32_t from, uint32_t to) const
    {
      return text_.substr(from, to - from);
    }

    size_t residueCount() const { return residues_; }
    size_t proteinCount() const { return starts_.size(); }
    size_t collapseRuleCount() const { return rules_.size(); }

    /// autoMinFilterLen() over this text, both orientations.
    int autoMinLen() const;

    /// Suffix order: the first SORT_DEPTH chars, ties broken by position -- a
    /// strict total order, so every correct sort yields the same array.
    /// SORT_DEPTH must exceed the longest pattern locate can ask about (a
    /// 25-residue tag collapse-respelled pair by pair is 50 database chars);
    /// past it the order is by position, which is fine BECAUSE locate refines
    /// character by character and never compares past the pattern.
    static constexpr size_t SORT_DEPTH = 64;
    static bool suffixLess(const char* t, size_t n, uint32_t a, uint32_t b)
    {
      const size_t la = n - a, lb = n - b;
      const size_t l = std::min(std::min(la, lb), SORT_DEPTH);
      const int c = std::memcmp(t + a, t + b, l);
      if (c) return c < 0;
      if (l == SORT_DEPTH) return a < b;
      return la < lb;
    }
    /// Suffix array of @p text ('#' and 'A'..'Z' only) under suffixLess,
    /// sorted in parallel over three-character buckets.
    static std::vector<uint32_t> suffixArray(const std::string& text);

  private:
    struct Range { uint32_t lo, hi; };  ///< half-open SA interval

    char charAt(size_t p) const { return p < text_.size() ? text_[p] : '\0'; }
    Range refine(Range r, uint32_t depth, char c) const;
    void descend(const std::string& tag, size_t i, Range r, uint32_t depth,
                 bool reversed, size_t& budget, std::vector<TagOcc>& out) const;

    std::string text_;              ///< folded, '#'-separated, trailing '#'
    std::string orig_;              ///< same layout, original spelling
    std::vector<uint32_t> sa_;      ///< suffix array over text_
    std::vector<double> prefix_;    ///< prefix_[i] = residue mass of text_[0..i)
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
