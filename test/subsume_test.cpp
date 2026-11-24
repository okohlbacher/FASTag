// -subsume_tags: FASTag::subsumedTags, the containment rule (contiguous path
// peaks on which the container reads the same residues, step by step; same
// charge, series and hypothesis; the container at least as significant,
// E(B) <= E(A); duplicates by E-value). seq is written N->C from the high m/z
// end: on peaks 100 < 200 < 300 < 400 < 500, "PEPT" reads T on 100-200 and P
// on 400-500, so its peaks 200..500 read "PEP" and 100..400 read "EPT".
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "FASTagger.h"

#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using FASTag::Tag;

namespace
{
  void require(bool value, const std::string& message)
  {
    if (!value) throw std::runtime_error(message);
  }
  Tag tag(std::string seq, std::vector<double> mz, double e = 0.01, int z = 1,
          FASTag::IonSeries::Series sr = FASTag::IonSeries::Series::BY, std::vector<std::uint8_t> steps = {})
  {
    Tag t;
    t.step_res = std::move(steps);
    t.seq = std::move(seq);
    t.path_mz = std::move(mz);
    t.evalue = e;
    t.charge = z;
    t.ion_series = sr;
    t.low_mz = t.path_mz.empty() ? 0 : t.path_mz.front();
    t.high_mz = t.path_mz.empty() ? 0 : t.path_mz.back();
    return t;
  }
  /// A tag with its residues per step (Tag::step_res, ascending m/z).
  Tag stepped(std::string seq, std::vector<double> mz, std::vector<std::uint8_t> steps, double e = 0.01)
  {
    return tag(std::move(seq), std::move(mz), e, 1, FASTag::IonSeries::Series::BY, std::move(steps));
  }
  std::string flags(const std::vector<char>& f)
  {
    std::string s;
    for (char c : f) s += c ? '1' : '0';
    return s;
  }
}

int main()
{
  try
  {
    using FASTag::subsumedTags;
    // Peaks 100 < 200 < 300 < 400 < 500: AB C DE over four steps.
    const std::vector<double> P5{100, 200, 300, 400, 500};

    // A shorter tag on a contiguous run of the longer one's peaks, spelling a
    // contiguous run of its residues: subsumed (either order of the rows).
    {
      const std::vector<Tag> t{tag("PEPT", P5), tag("PEP", {200, 300, 400, 500})};
      require(flags(subsumedTags(t)) == "01", "high-end run not subsumed: " + flags(subsumedTags(t)));
      const std::vector<Tag> l{tag("PEPT", P5), tag("EPT", {100, 200, 300, 400})};
      require(flags(subsumedTags(l)) == "01", "low-end run not subsumed: " + flags(subsumedTags(l)));
      const std::vector<Tag> u{tag("EP", {200, 300, 400}), tag("PEPT", P5)};
      require(flags(subsumedTags(u)) == "10", "inner run not subsumed: " + flags(subsumedTags(u)));
    }
    // A gap in the longer tag's peaks: the shorter tag's peaks are not a
    // contiguous run of them (the gapped tag skips 300), so nothing is dropped.
    {
      const std::vector<Tag> t{tag("PEGT", {100, 200, 400, 500}), tag("EP", {200, 300, 400})};
      require(flags(subsumedTags(t)) == "00", "peaks not contiguous in the other tag: " + flags(subsumedTags(t)));
      // Peaks a subset but not contiguous (200 and 400 of 100..500).
      const std::vector<Tag> u{tag("PEPT", P5), tag("G", {200, 400})};
      require(flags(subsumedTags(u)) == "00", "a gapped subset of peaks subsumed");
    }
    // Peaks contained but the residues differ (another spelling of a step).
    {
      const std::vector<Tag> t{tag("PEPT", P5), tag("QEP", {200, 300, 400, 500})};
      require(flags(subsumedTags(t)) == "00", "a different spelling subsumed");
    }
    // Residues contained but not the peaks (the same letters elsewhere).
    {
      const std::vector<Tag> t{tag("PEPT", P5), tag("EPT", {600, 700, 800, 900})};
      require(flags(subsumedTags(t)) == "00", "same letters on other peaks subsumed");
    }
    // Peaks and residues both contained, but the residues lie on other peaks
    // of the container: PEPT reads PEP on 200..500, its EPT lies on 100..400.
    {
      const std::vector<Tag> t{tag("PEPT", P5), tag("EPT", {200, 300, 400, 500})};
      require(flags(subsumedTags(t)) == "00", "a run present only on other peaks subsumed: " + flags(subsumedTags(t)));
      const std::vector<Tag> u{tag("PEPT", P5), tag("PE", {100, 200, 300})};
      require(flags(subsumedTags(u)) == "00", "a low-peak tag matched to high-end residues");
    }
    // PXD003531: AGD (a gap step AG and D) on the peaks where KDAGD reads KD
    // (K = 128.09 is within an ion-trap tolerance of AG = 128.06); KDAGD's
    // own AGD lies on its low peaks.
    {
      const std::vector<double> K6{100, 215.03, 272.05, 343.09, 458.12, 586.21};
      const std::vector<Tag> t{stepped("KDAGD", K6, {1, 1, 1, 1, 1}), stepped("AGD", {343.09, 458.12, 586.21}, {1, 2})};
      require(flags(subsumedTags(t)) == "00", "AGD subsumed by KDAGD on the peaks reading KD: " + flags(subsumedTags(t)));
      const std::vector<Tag> u{stepped("KDAGD", K6, {1, 1, 1, 1, 1}), stepped("AGD", {100, 215.03, 272.05, 343.09}, {1, 1, 1})};
      require(flags(subsumedTags(u)) == "01", "AGD on KDAGD's AGD peaks not subsumed: " + flags(subsumedTags(u)));
    }
    // Gap steps at the edge of the window: AGEK with its gap AG on the top
    // step (300-400), PEAG with its gap AG on the bottom step (100-200).
    {
      const std::vector<double> P4{100, 200, 300, 400};
      const Tag top = stepped("AGEK", P4, {1, 1, 2});
      require(flags(subsumedTags({top, stepped("AGE", {200, 300, 400}, {1, 2})})) == "01", "gap at the top edge: AGE");
      require(flags(subsumedTags({top, stepped("AG", {300, 400}, {2})})) == "01", "gap alone: AG");
      require(flags(subsumedTags({top, stepped("EK", {100, 200, 300}, {1, 1})})) == "01", "below the gap: EK");
      // The same peaks with the gap's residues split differently: not inside.
      require(flags(subsumedTags({top, stepped("GE", {200, 300, 400}, {1, 1})})) == "00", "GE across the gap subsumed");
      require(flags(subsumedTags({top, stepped("AGE", {200, 300, 400}, {2, 1})})) == "00", "AGE with the gap on the other step subsumed");
      const Tag bottom = stepped("PEAG", P4, {2, 1, 1});
      require(flags(subsumedTags({bottom, stepped("EAG", {100, 200, 300}, {2, 1})})) == "01", "gap at the bottom edge: EAG");
      require(flags(subsumedTags({bottom, stepped("PE", {200, 300, 400}, {1, 1})})) == "01", "above the gap: PE");
      require(flags(subsumedTags({bottom, stepped("AG", {100, 200}, {2})})) == "01", "bottom gap alone: AG");
      require(flags(subsumedTags({bottom, stepped("EA", {100, 200, 300}, {1, 1})})) == "00", "EA on the gap's peaks subsumed");
      // Inconsistent step counts (they do not sum to the residues): no part.
      require(flags(subsumedTags({bottom, stepped("AG", {100, 200}, {1})})) == "00", "inconsistent step counts subsumed");
    }
    // A different fragment charge, series or hypothesis: never.
    {
      const std::vector<Tag> t{tag("PEPT", P5, 0.01, 1), tag("PEP", {200, 300, 400, 500}, 0.01, 2)};
      require(flags(subsumedTags(t)) == "00", "different charge subsumed");
      const std::vector<Tag> u{tag("PEPT", P5), tag("PEP", {200, 300, 400, 500}, 0.01, 1, FASTag::IonSeries::Series::CZ)};
      require(flags(subsumedTags(u)) == "00", "different series subsumed");
      const std::vector<Tag> v{tag("PEPT", P5), tag("PEP", {200, 300, 400, 500})};
      require(flags(subsumedTags(v, {0, 1})) == "00", "different hypothesis subsumed");
      require(flags(subsumedTags(v, {1, 1})) == "01", "same hypothesis not subsumed");
    }
    // Duplicates (same peaks, same sequence): the lower E-value is kept; on a
    // tie the earlier row.
    {
      const std::vector<Tag> t{tag("PEPT", P5, 0.5), tag("PEPT", P5, 0.01)};
      require(flags(subsumedTags(t)) == "10", "duplicate: the worse E-value kept");
      const std::vector<Tag> u{tag("PEPT", P5, 0.01), tag("PEPT", P5, 0.01)};
      require(flags(subsumedTags(u)) == "01", "duplicate tie: the earlier row not kept");
      // Same peaks, different spelling (a gap's two orders): both kept.
      const std::vector<Tag> v{tag("PEPT", P5), tag("EPPT", P5)};
      require(flags(subsumedTags(v)) == "00", "two spellings of one path dropped");
    }
    // Inline modifications are residues: M[Oxidation]K lies in LM[Oxidation]K
    // (on its low peaks), MK does not, nor does a run of letters inside a
    // modification name.
    {
      const std::vector<Tag> t{tag("LM[Oxidation]K", {100, 200, 300, 400}), tag("M[Oxidation]K", {100, 200, 300})};
      require(flags(subsumedTags(t)) == "01", "modified run not subsumed");
      const std::vector<Tag> u{tag("LM[Oxidation]K", {100, 200, 300, 400}), tag("MK", {100, 200, 300})};
      require(flags(subsumedTags(u)) == "00", "unmodified run subsumed by a modified tag");
      const std::vector<Tag> v{tag("AK[TMT6plex]", {100, 200, 300}), tag("TMT", {200, 300})};
      require(flags(subsumedTags(v)) == "00", "letters of a modification name read as residues");
    }
    // A chain: every dropped row lies in a kept one, and an ineligible row
    // neither subsumes nor is subsumed.
    {
      const std::vector<Tag> t{tag("EP", {200, 300, 400}), tag("PEP", {200, 300, 400, 500}), tag("PEPT", P5)};
      require(flags(subsumedTags(t)) == "110", "chain: " + flags(subsumedTags(t)));
      require(flags(subsumedTags(t, {}, {1, 1, 0})) == "100", "ineligible row subsumes: " + flags(subsumedTags(t, {}, {1, 1, 0})));
      require(flags(subsumedTags(t, {}, {0, 1, 1})) == "010", "ineligible row subsumed");
      // -fasta with -entrapment_fasta: a target row (class 1) is never
      // subsumed by an entrapment-only row (class 2), nor the other way.
      require(flags(subsumedTags(t, {}, {1, 2, 2})) == "010",
              "target row subsumed by an entrapment row: " + flags(subsumedTags(t, {}, {1, 2, 2})));
      require(flags(subsumedTags(t, {}, {2, 1, 1})) == "010", "entrapment row subsumed by a target row");
      require(flags(subsumedTags(t, {}, {2, 2, 2})) == "110", "entrapment rows among themselves");
    }
    // The E-value condition: a longer tag with a worse E-value keeps the
    // shorter one; an equal E-value drops it.
    {
      const std::vector<Tag> t{tag("PEPT", P5, 0.5), tag("PEP", {200, 300, 400, 500}, 0.01)};
      require(flags(subsumedTags(t)) == "00", "a longer tag with a worse E-value dropped the short one: " + flags(subsumedTags(t)));
      const std::vector<Tag> u{tag("PEPT", P5, 0.01), tag("PEP", {200, 300, 400, 500}, 0.01)};
      require(flags(subsumedTags(u)) == "01", "equal E-values: the contained tag kept: " + flags(subsumedTags(u)));
      const std::vector<Tag> v{tag("PEP", {200, 300, 400, 500}, 0.5), tag("PEPT", P5, 0.01)};
      require(flags(subsumedTags(v)) == "10", "a better container kept the short one");
    }
    // A chain EP in PEP in PEPT: each drop needs its own container at least
    // as significant, and every dropped row lies in a kept row whose E-value
    // is at most its own.
    {
      const std::vector<double> P3{200, 300, 400}, P4{200, 300, 400, 500};
      // E ascending with length: nothing is dropped.
      const std::vector<Tag> a{tag("EP", P3, 0.001), tag("PEP", P4, 0.01), tag("PEPT", P5, 0.1)};
      require(flags(subsumedTags(a)) == "000", "chain, worse with length: " + flags(subsumedTags(a)));
      // E descending with length: both short ones go.
      const std::vector<Tag> b{tag("EP", P3, 0.1), tag("PEP", P4, 0.01), tag("PEPT", P5, 0.001)};
      require(flags(subsumedTags(b)) == "110", "chain, better with length: " + flags(subsumedTags(b)));
      // EP dropped by PEP, PEP kept (PEPT worse than PEP), PEPT kept.
      const std::vector<Tag> c{tag("EP", P3, 0.1), tag("PEP", P4, 0.01), tag("PEPT", P5, 0.05)};
      require(flags(subsumedTags(c)) == "100", "chain, middle best: " + flags(subsumedTags(c)));
      // EP dropped by PEPT directly although PEP is worse than EP.
      const std::vector<Tag> d{tag("EP", P3, 0.1), tag("PEP", P4, 0.5), tag("PEPT", P5, 0.01)};
      require(flags(subsumedTags(d)) == "110", "chain, outer best: " + flags(subsumedTags(d)));
      // PEP dropped by PEPT, EP kept: no container is at least as significant as EP.
      const std::vector<Tag> e{tag("EP", P3, 0.001), tag("PEP", P4, 0.1), tag("PEPT", P5, 0.01)};
      require(flags(subsumedTags(e)) == "010", "chain, inner best: " + flags(subsumedTags(e)));
    }
    // An unscored row (NaN E-value) counts as +infinity: it drops only
    // unscored rows and gives way to any container.
    {
      const double nan = std::numeric_limits<double>::quiet_NaN();
      const std::vector<Tag> t{tag("PEPT", P5, nan), tag("PEP", {200, 300, 400, 500}, 0.01)};
      require(flags(subsumedTags(t)) == "00", "an unscored container dropped a scored row");
      const std::vector<Tag> u{tag("PEPT", P5, 0.01), tag("PEP", {200, 300, 400, 500}, nan)};
      require(flags(subsumedTags(u)) == "01", "an unscored row kept inside a scored one");
      const std::vector<Tag> v{tag("PEPT", P5, nan), tag("PEP", {200, 300, 400, 500}, nan)};
      require(flags(subsumedTags(v)) == "01", "an unscored row kept inside an unscored one");
      const std::vector<Tag> w{tag("PEPT", P5, nan), tag("PEPT", P5, 0.01)};
      require(flags(subsumedTags(w)) == "10", "duplicate: the unscored copy kept");
    }
    // No path peaks (a tag not from the tagger): never subsumed.
    {
      const std::vector<Tag> t{tag("PEPT", P5), tag("EPT", {})};
      require(flags(subsumedTags(t)) == "00", "a tag without path peaks subsumed");
    }
    // Empty and one-row lists.
    {
      require(subsumedTags({}).empty() && flags(subsumedTags({tag("PEPT", P5)})) == "0", "one row");
    }
  }
  catch (const std::exception& e)
  {
    std::cerr << "FAIL: " << e.what() << std::endl;
    return 1;
  }
  std::cout << "subsume_test: OK" << std::endl;
  return 0;
}
