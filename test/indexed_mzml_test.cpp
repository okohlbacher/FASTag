// IndexedMzMLReader against OpenMS itself, spectrum by spectrum.
//
// The tag output carries no retention time and no precursor charge, so a
// byte-identical TSV does NOT prove this reader's metadata scrape is right.
// This does: OnDiscMSExperiment with metadata loaded is the reference, and
// every field the reader claims to fill is compared against it for every
// spectrum of the fixture.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "IndexedMzMLReader.h"

#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/IONMOBILITY/IMDataArrayUtils.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/OnDiscMSExperiment.h>

#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>

using namespace OpenMS;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }

  /// Rewrite @p src to @p dst with or without an index, so both cases are
  /// exercised whatever the fixture happens to be.
  std::string rewrite(const std::string& src, const std::string& dst, bool with_index)
  {
    try
    {
      PeakMap exp;
      MzMLFile mz;
      mz.load(src, exp);
      if (exp.empty()) return {};
      mz.getOptions().setWriteIndex(with_index);
      mz.store(dst, exp);
      return dst;
    }
    catch (const Exception::BaseException& e)
    {
      std::cerr << "could not write an indexed copy: " << e.what() << "\n";
      return {};
    }
  }

  std::string slurp(const std::string& path)
  {
    std::ifstream in(path, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  }

  void spit(const std::string& path, const std::string& bytes)
  {
    std::ofstream out(path, std::ios::binary);
    out << bytes;
  }

  /// Every spectrum @p got reads must equal what @p want reads: offsets are
  /// only proved right by reading the whole file through them.
  void same_spectra(FASTag::IndexedMzMLReader& got, FASTag::IndexedMzMLReader& want,
                    const std::string& what)
  {
    check(got.getNrSpectra() == want.getNrSpectra(), what + ": same spectrum count");
    const Size n = std::min(got.getNrSpectra(), want.getNrSpectra());
    Size bad = 0;
    for (Size i = 0; i < n; ++i)
    {
      const MSSpectrum a = got.getSpectrum(i);
      const MSSpectrum b = want.getSpectrum(i);
      bool same = a.getMSLevel() == b.getMSLevel() && a.getRT() == b.getRT() &&
                  a.getNativeID() == b.getNativeID() && a.size() == b.size() &&
                  a.getPrecursors().size() == b.getPrecursors().size();
      for (Size k = 0; same && k < a.size(); ++k)
      {
        same = a[k].getMZ() == b[k].getMZ() && a[k].getIntensity() == b[k].getIntensity();
      }
      for (Size k = 0; same && k < a.getPrecursors().size(); ++k)
      {
        same = a.getPrecursors()[k].getMZ() == b.getPrecursors()[k].getMZ() &&
               a.getPrecursors()[k].getCharge() == b.getPrecursors()[k].getCharge();
      }
      if (!same) ++bad;
    }
    check(n > 0 && bad == 0, what + ": every spectrum reads the same (" + std::to_string(bad) +
                                 " of " + std::to_string(n) + " differ)");
  }
}

int main(int argc, char** argv)
{
  const std::string fixture =
      argc > 1 ? argv[1] : std::string(FASTAG_TEST_DATA) + "/Ecoli_MS2_small.mzML";
  {
    std::ifstream probe(fixture);
    if (!probe)
    {
      std::cerr << "SKIP: fixture not readable: " << fixture << "\n";
      return 77;
    }
  }

  const std::string tmp =
      std::getenv("TMPDIR") ? std::getenv("TMPDIR") : std::string("/tmp");
  const std::string indexed = rewrite(fixture, tmp + "/fastag_indexed_fixture.mzML", true);
  if (indexed.empty())
  {
    std::cerr << "SKIP: could not produce an indexed fixture\n";
    return 77;
  }

  FASTag::IndexedMzMLReader reader(indexed);
  check(reader.ok(), "reader accepts an indexed mzML");
  if (!reader.ok()) return failures ? 1 : 0;
  check(reader.reportsSpectrumMetadata(), "reader reports MS2 with a precursor");

  // The reference: OpenMS with metadata loaded, which is what the fast path
  // replaces.
  OnDiscMSExperiment ref;
  check(ref.openFile(indexed, /*skipMetaData=*/false), "OpenMS opens the same file");
  check(reader.getNrSpectra() == ref.getNrSpectra(), "same spectrum count");

  const Size n = std::min<Size>(reader.getNrSpectra(), ref.getNrSpectra());
  check(n > 0, "fixture has spectra");
  Size ms2 = 0, with_prec = 0, with_charge = 0;
  for (Size i = 0; i < n; ++i)
  {
    const MSSpectrum got = reader.getSpectrum(i);
    const MSSpectrum want = ref.getSpectrum(i);
    const std::string at = " (spectrum " + std::to_string(i) + ")";

    check(got.getMSLevel() == want.getMSLevel(), "ms level" + at);
    // Retention time to the microsecond: the reader converts from minutes.
    check(std::fabs(got.getRT() - want.getRT()) < 1e-6, "retention time" + at);
    check(got.getNativeID() == want.getNativeID(), "native id" + at);
    check(got.getPrecursors().size() == want.getPrecursors().size(), "precursor count" + at);

    if (want.getMSLevel() == 2)
    {
      ++ms2;
      // Peaks are decoded for MS2 only, and must match exactly.
      check(got.size() == want.size(), "peak count" + at);
      const Size m = std::min(got.size(), want.size());
      bool peaks_ok = true;
      for (Size k = 0; k < m; ++k)
      {
        if (got[k].getMZ() != want[k].getMZ() || got[k].getIntensity() != want[k].getIntensity())
        {
          peaks_ok = false;
          break;
        }
      }
      check(peaks_ok, "peaks identical" + at);
    }
    else
    {
      // Deliberate: MS1 peaks are not decoded.
      check(got.empty(), "non-MS2 carries no peaks" + at);
    }

    const Size p = std::min(got.getPrecursors().size(), want.getPrecursors().size());
    for (Size k = 0; k < p; ++k)
    {
      ++with_prec;
      check(std::fabs(got.getPrecursors()[k].getMZ() - want.getPrecursors()[k].getMZ()) < 1e-6,
            "precursor m/z" + at);
      check(got.getPrecursors()[k].getCharge() == want.getPrecursors()[k].getCharge(),
            "precursor charge" + at);
      if (want.getPrecursors()[k].getCharge() != 0) ++with_charge;
      check(std::fabs(got.getPrecursors()[k].getIsolationWindowLowerOffset() -
                      want.getPrecursors()[k].getIsolationWindowLowerOffset()) < 1e-6,
            "isolation lower offset" + at);
      check(std::fabs(got.getPrecursors()[k].getIsolationWindowUpperOffset() -
                      want.getPrecursors()[k].getIsolationWindowUpperOffset()) < 1e-6,
            "isolation upper offset" + at);
    }
  }
  // A fixture with no MS2, or no charges, would make the comparison above
  // vacuous; say so rather than passing on nothing.
  check(ms2 > 0, "fixture exercises MS2 spectra");
  check(with_prec > 0, "fixture exercises precursors");
  check(with_charge > 0, "fixture exercises precursor charges");

  check(!reader.indexRebuilt(), "a valid index is used, not rebuilt");

  // The scan finds the same spectra however the file is cut into pieces:
  // sizes around the 32-byte overlap and odd ones put tag starts on every
  // kind of boundary.
  {
    const auto whole = FASTag::IndexedMzMLReader::scanSpectrumOffsets(indexed);
    check(whole.size() == reader.getNrSpectra() + 1, "scan finds every spectrum, plus the list end");
    for (const std::size_t chunk : {std::size_t{1}, std::size_t{31}, std::size_t{32}, std::size_t{33},
                                    std::size_t{57}, std::size_t{1000}, std::size_t{65536}})
    {
      check(FASTag::IndexedMzMLReader::scanSpectrumOffsets(indexed, chunk) == whole,
            "scan result does not depend on the piece size (" + std::to_string(chunk) + ")");
    }
  }

  // A file with no index is read all the same: its offsets are rebuilt by
  // scanning. Written here rather than assumed of the fixture, which is
  // itself indexed.
  {
    const std::string plain = rewrite(fixture, tmp + "/fastag_plain_fixture.mzML", false);
    if (!plain.empty())
    {
      FASTag::IndexedMzMLReader unindexed(plain);
      check(unindexed.ok() && unindexed.indexRebuilt(), "an mzML without an index is scanned");
      if (unindexed.ok()) same_spectra(unindexed, reader, "no index");
    }
  }
  // So is a file whose index is stale -- the offsets still parse, but no
  // longer point at spectra. Two edits, as tools make them: bytes inserted
  // before the spectrumList, which moves every offset; and bytes inserted
  // inside the middle spectrum (whitespace, so its content is unchanged),
  // which moves only the offsets after it, and indexListOffset.
  {
    const std::string bytes = slurp(indexed);
    const std::size_t list = bytes.find("<spectrumList");
    check(list != std::string::npos, "fixture has a spectrumList");
    std::size_t mid = list;
    for (Size i = 0; i <= reader.getNrSpectra() / 2 && mid != std::string::npos; ++i)
    {
      mid = bytes.find("<spectrum ", mid + 1);
    }
    const std::size_t inside = mid == std::string::npos ? mid : bytes.find("<binaryDataArrayList", mid);
    check(inside != std::string::npos, "fixture's middle spectrum has arrays");
    if (list != std::string::npos && inside != std::string::npos)
    {
      std::string shifted = bytes;
      shifted.insert(list, std::string(64, ' '));
      spit(tmp + "/fastag_stale_index.mzML", shifted);
      FASTag::IndexedMzMLReader stale(tmp + "/fastag_stale_index.mzML");
      check(stale.ok() && stale.indexRebuilt(), "an index shifted as a whole is rebuilt");
      if (stale.ok()) same_spectra(stale, reader, "index shifted as a whole");

      std::string patched = bytes;
      patched.insert(inside, "\n          ");
      spit(tmp + "/fastag_stale_mid.mzML", patched);
      FASTag::IndexedMzMLReader mid_stale(tmp + "/fastag_stale_mid.mzML");
      check(mid_stale.ok() && mid_stale.indexRebuilt(), "an index stale from the middle on is rebuilt");
      if (mid_stale.ok()) same_spectra(mid_stale, reader, "index stale from the middle on");
    }
  }
  // Per-peak ion mobility: -digest_out's timsTOF rule reads containsIMData(),
  // so the fast reader must see the array as OpenMS's own reader does, in
  // its place after another extra float array.
  {
    PeakMap exp;
    MzMLFile().load(indexed, exp);
    PeakMap im_exp;
    static_cast<ExperimentalSettings&>(im_exp) = exp.getExperimentalSettings();
    for (const MSSpectrum& s : exp)
      if (s.getMSLevel() == 2 && !s.empty())
      {
        MSSpectrum t = s;
        t.getFloatDataArrays().clear();
        auto& extra = t.getFloatDataArrays().emplace_back();
        extra.setName("FASTag test array");
        extra.assign(t.size(), 1.0f);
        auto& fda = t.getFloatDataArrays().emplace_back();
        IMDataArrayUtils::setIMUnit(fda, DriftTimeUnit::VSSC);
        fda.assign(t.size(), 0.9f);
        im_exp.addSpectrum(t);
        break;
      }
    check(im_exp.size() == 1, "fixture has an MS2 spectrum with peaks");
    if (im_exp.size() == 1)
    {
      const std::string path = tmp + "/fastag_im_arrays.mzML";
      MzMLFile mz;
      mz.getOptions().setWriteIndex(true);
      mz.store(path, im_exp);
      FASTag::IndexedMzMLReader r(path);
      check(r.ok(), "reader accepts the ion mobility file");
      const MSSpectrum got = r.getSpectrum(0);
      OnDiscMSExperiment od;
      od.openFile(path, false);
      const MSSpectrum want = od.getSpectrum(0);
      check(want.containsIMData(), "OpenMS sees the ion mobility array");
      check(got.containsIMData() && got.getIMData().second == DriftTimeUnit::VSSC,
            "fast reader sees the ion mobility array as 1/K0");
      check(got.getFloatDataArrays().size() == 2 && got.getIMData().first == 1,
            "the ion mobility array keeps its place after the extra one");
    }
  }

  // In-place edits of the indexed copy (same byte length, so the index stays
  // valid): each is a file the reader once handled wrongly.
  {
    const std::string base = slurp(indexed);
    // (a) A run that opens with MS1 only: the first 70 spectra relabelled as
    // level 1. The probe looked at 64 and gave up the fast reader.
    {
      std::string b = base;
      const std::string lvl2 = "name=\"ms level\" value=\"2\"";
      size_t at = 0;
      for (int k = 0; k < 70; ++k)
      {
        at = b.find(lvl2, at);
        if (at == std::string::npos) break;
        b[at + lvl2.size() - 2] = '1';
        at += lvl2.size();
      }
      spit(tmp + "/fastag_ms1_first.mzML", b);
      FASTag::IndexedMzMLReader r(tmp + "/fastag_ms1_first.mzML");
      check(r.ok() && r.reportsSpectrumMetadata(),
            "a run opening with 70 MS1 spectra keeps the fast reader");
    }
    // (b) Scan start time without a unit: seconds, as OpenMS reads it.
    {
      std::string b = base;
      const std::string u = "unitAccession=\"UO:0000010\" unitName=\"second\"";
      const std::string blank = "unitAccession=\"          \" unitName=\"      \"";
      for (size_t at = b.find(u); at != std::string::npos; at = b.find(u, at + 1)) b.replace(at, u.size(), blank);
      spit(tmp + "/fastag_rt_nounit.mzML", b);
      FASTag::IndexedMzMLReader r(tmp + "/fastag_rt_nounit.mzML");
      OnDiscMSExperiment od;
      od.openFile(tmp + "/fastag_rt_nounit.mzML", /*skipMetaData=*/false);
      const MSSpectrum got = r.getSpectrum(0), want = od.getSpectrum(0);
      check(want.getRT() > 0 && got.getRT() == want.getRT(),
            "an RT without a unit reads as OpenMS reads it (" + std::to_string(got.getRT()) +
                " vs " + std::to_string(want.getRT()) + ")");
    }
    // (c) An MS2 whose arrays cannot be parsed must fail, not come back empty.
    {
      std::string b = base;
      const size_t sp = b.find("<spectrum ", b.find("<spectrum ") + 1);   // spectrum 1
      const size_t bin = b.find("<binary>", sp);
      if (bin != std::string::npos) b.replace(bin, 8, "<binarx>");
      spit(tmp + "/fastag_bad_binary.mzML", b);
      FASTag::IndexedMzMLReader r(tmp + "/fastag_bad_binary.mzML");
      bool threw = false;
      try { r.getSpectrum(1); }
      catch (const Exception::BaseException&) { threw = true; }
      check(bin != std::string::npos && threw, "an unparsable MS2 spectrum throws");
      bool other = false;
      try { other = !r.getSpectrum(0).empty(); }
      catch (...) {}
      check(other, "the spectrum before it still reads");
    }
  }

  // An XML file with no spectrumList holds nothing to scan for.
  {
    spit(tmp + "/fastag_no_list.mzML", "<?xml version=\"1.0\"?>\n<mzML><run id=\"r\"></run></mzML>\n");
    check(FASTag::IndexedMzMLReader::scanSpectrumOffsets(tmp + "/fastag_no_list.mzML").empty(),
          "no spectrumList, no offsets");
    FASTag::IndexedMzMLReader none(tmp + "/fastag_no_list.mzML");
    check(!none.ok(), "a file with no spectrumList is refused");
  }
  // So is a file that does not exist.
  {
    FASTag::IndexedMzMLReader missing("/nonexistent/nope.mzML");
    check(!missing.ok(), "a missing file is refused");
  }

  if (failures == 0) std::cout << "indexed_mzml_test: all checks passed (" << n << " spectra, "
                               << ms2 << " MS2)\n";
  return failures ? 1 : 0;
}
