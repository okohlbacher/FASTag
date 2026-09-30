// ProForma 2.0 rendering of a sequence tag, for interoperability.
//
// A FASTag tag is an internal stretch of residues with a known mass to each
// peptide terminus but UNKNOWN flanking composition. ProForma has no first-class
// "mass gap of unknown sequence at a terminus", so the closest standard-conformant
// notation is a terminal mass tag: `[+<nterm>]-RESIDUES-[+<cterm>]`. Downstream
// tools that speak ProForma (e.g. for USI construction or proteoform display)
// can then consume a tag without a bespoke parser.
//
// Two subtleties a naive rendering gets wrong:
//
//  * FIXED modifications (Carbamidomethyl C by default) alter residue masses but
//    are deliberately NOT in the tag sequence -- so a bare `C` in the tag is
//    really carbamidomethyl-C, 57.02 Da heavier than ProForma would read it. They
//    are emitted as a ProForma GLOBAL fixed-modification prefix, `<[Name]@C>`,
//    which is exactly what that syntax is for. The caller supplies the prefix.
//
//  * FASTag folds I onto L (Natural19WithoutI), so an emitted `L` means "I or L".
//    ProForma has `J` for precisely that ambiguity; every L is rendered as J so
//    the string does not assert a leucine FASTag cannot distinguish. Variable
//    mods already written inline as `X[Name]` pass through unchanged and their
//    residue letter is folded the same way.
//
// This is a lossless-of-what-we-know rendering, not a claim that the tag is a
// fully characterised proteoform.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <cmath>
#include <cstdio>
#include <string>

namespace FASTag
{
  /// ProForma string for a tag:
  ///   <global-fixed-mods>[+<nterm>]-<residues>-[+<cterm>]
  ///
  /// @param residues   the tag sequence, possibly with inline `X[Name]` var mods
  /// @param nterm,cterm flank masses; a flank < 0.5 Da (tag at the terminus) is
  ///                    omitted rather than written as `[+0.0000]`. Non-finite or
  ///                    absurd masses are skipped, never emitted as `[+inf]`.
  /// @param global     ProForma global fixed-mod prefix, e.g. `<[Carbamidomethyl]@C>`
  ///                    (empty when there are no fixed mods)
  inline std::string toProforma(const std::string& residues, double nterm, double cterm,
                                const std::string& global = "")
  {
    // "[+m]", or empty for a terminal (< 0.5 Da), non-finite or absurd flank.
    auto massTag = [](double m) -> std::string {
      if (!(std::fabs(m) > 0.5) || !std::isfinite(m) || std::fabs(m) >= 1e12) return {};
      char b[48];
      std::snprintf(b, sizeof b, "[%+.4f]", m);  // %+ gives the leading sign
      return b;
    };

    std::string out = global;
    if (const std::string t = massTag(nterm); !t.empty()) { out += t; out += '-'; }

    // Fold L -> J inside residue text only (not inside a `[...]` mod token).
    bool in_mod = false;
    for (char c : residues)
    {
      if (c == '[') in_mod = true;
      else if (c == ']') in_mod = false;
      out += (!in_mod && c == 'L') ? 'J' : c;
    }

    if (const std::string t = massTag(cterm); !t.empty()) { out += '-'; out += t; }
    return out;
  }
}
