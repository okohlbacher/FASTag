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

#include <OpenMS/FORMAT/FileHandler.h>
#include <OpenMS/FORMAT/MzMLFile.h>
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

  // A file with no index is refused rather than half-read. Written here
  // rather than assumed of the fixture, which is itself indexed.
  {
    const std::string plain = rewrite(fixture, tmp + "/fastag_plain_fixture.mzML", false);
    if (!plain.empty())
    {
      FASTag::IndexedMzMLReader unindexed(plain);
      check(!unindexed.ok(), "an mzML without an index is refused");
    }
  }
  // A truncated index is refused too: the offsets still parse, but they no
  // longer point at spectra.
  {
    const std::string mangled = tmp + "/fastag_stale_index.mzML";
    std::ifstream src(indexed, std::ios::binary);
    std::string bytes((std::istreambuf_iterator<char>(src)), std::istreambuf_iterator<char>());
    if (bytes.size() > 4096)
    {
      // Shift the body so every recorded offset is wrong.
      bytes.insert(bytes.find("<spectrum"), std::string(64, ' '));
      std::ofstream out(mangled, std::ios::binary);
      out << bytes;
      out.close();
      FASTag::IndexedMzMLReader stale(mangled);
      check(!stale.ok(), "an index that no longer points at spectra is refused");
    }
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
