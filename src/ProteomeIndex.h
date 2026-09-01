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

#include <cstdint>
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
    /// sentinel or an ambiguity residue: both are hard cleavage barriers,
    /// which is slightly MORE permissive than TagRecon's historical
    /// skip-the-whole-peptide-on-unknown behavior (a window beside an X is
    /// still usable; one containing it never forms).
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

    /// Smallest tag length whose expected chance-match rate against this text
    /// is below 5% -- same model as FastaFilter::autoMinLen (effective
    /// alphabet 14.7, factor 2 for both orientations).
    int autoMinLen() const;

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
