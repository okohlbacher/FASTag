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

#include <OpenMS/FORMAT/MSNumpressCoder.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/IONMOBILITY/IMDataArrayUtils.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/OnDiscMSExperiment.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#include <zlib.h>

#ifdef __linux__
#  include <sys/resource.h>
#  include <unistd.h>
#endif

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

namespace
{
  /// Bitwise equality of two doubles (NaN equals NaN, +0 differs from -0).
  bool same_bits(double a, double b) { return std::memcmp(&a, &b, sizeof a) == 0; }
  bool same_bits(float a, float b) { return std::memcmp(&a, &b, sizeof a) == 0; }

  /// Everything domParseSpectrum puts into a spectrum, compared exactly.
  bool same_decoded(const MSSpectrum& a, const MSSpectrum& b, std::string& why)
  {
    if (a.getNativeID() != b.getNativeID()) { why = "native id"; return false; }
    if (a.getMSLevel() != b.getMSLevel()) { why = "ms level"; return false; }
    if (!same_bits(a.getRT(), b.getRT())) { why = "rt"; return false; }
    if (a.size() != b.size()) { why = "peak count"; return false; }
    for (Size k = 0; k < a.size(); ++k)
    {
      if (!same_bits(a[k].getMZ(), b[k].getMZ()) || !same_bits(a[k].getIntensity(), b[k].getIntensity()))
      {
        why = "peak " + std::to_string(k);
        return false;
      }
    }
    if (a.getFloatDataArrays() != b.getFloatDataArrays() || a.getIntegerDataArrays() != b.getIntegerDataArrays() ||
        a.getStringDataArrays() != b.getStringDataArrays())
    {
      why = "data arrays";
      return false;
    }
    std::vector<std::string> ka, kb;
    a.getKeys(ka);
    b.getKeys(kb);
    if (ka != kb) { why = "meta values"; return false; }
    if (a.getPrecursors() != b.getPrecursors()) { why = "precursors"; return false; }
    if (!(a.getInstrumentSettings() == b.getInstrumentSettings())) { why = "instrument settings"; return false; }
    if (!same_bits(a.getDriftTime(), b.getDriftTime()) || a.getDriftTimeUnit() != b.getDriftTimeUnit())
    {
      why = "drift time";
      return false;
    }
    return true;
  }

  /// Every spectrum of @p path read twice, with the direct decoder and with
  /// OpenMS's alone, must be the same. @p expect_direct: whether the direct
  /// decoder must have taken at least one spectrum (false where the file is
  /// built to be declined, e.g. numpress). Returns the MS2 count compared.
  Size direct_vs_openms(const std::string& path, const std::string& what, bool expect_direct)
  {
    FASTag::IndexedMzMLReader direct(path), openms(path);
    check(direct.ok() && openms.ok(), what + ": reader opens the file");
    if (!direct.ok() || !openms.ok()) return 0;
    direct.setDirectDecoding(true);
    openms.setDirectDecoding(false);
    Size bad = 0, ms2 = 0;
    std::string first;
    for (Size i = 0; i < direct.getNrSpectra(); ++i)
    {
      MSSpectrum a, b;
      bool threw_a = false, threw_b = false;
      try { a = direct.getSpectrum(i); } catch (const Exception::BaseException&) { threw_a = true; }
      try { b = openms.getSpectrum(i); } catch (const Exception::BaseException&) { threw_b = true; }
      std::string why;
      if (threw_a != threw_b) why = "one path threw";
      else if (!threw_a) same_decoded(a, b, why);
      if (!why.empty())
      {
        if (bad == 0) first = "spectrum " + std::to_string(i) + ": " + why;
        ++bad;
      }
      if (!threw_b && b.getMSLevel() == 2) ++ms2;
    }
    check(openms.directDecoded() == 0, what + ": the OpenMS-only reader decodes nothing directly");
    if (expect_direct)
      check(direct.directDecoded() > 0, what + ": the direct decoder takes spectra (" +
                                            std::to_string(direct.directDecoded()) + " direct, " +
                                            std::to_string(direct.openmsDecoded()) + " OpenMS)");
    else
      check(direct.directDecoded() == 0, what + ": the direct decoder declines every spectrum");
    check(bad == 0, what + ": direct and OpenMS decoding agree on every spectrum (" + std::to_string(bad) +
                        " differ" + (bad ? "; first " + first : std::string()) + ")");
    std::cout << what << ": " << direct.getNrSpectra() << " spectra, " << ms2 << " MS2, "
              << direct.directDecoded() << " direct, " << direct.openmsDecoded() << " via OpenMS\n";
    return ms2;
  }

  /// @p src rewritten with the given array encoding.
  std::string rewrite_encoded(const std::string& src, const std::string& dst, bool zlib, bool mz32, bool int32,
                              bool numpress = false)
  {
    try
    {
      PeakMap exp;
      MzMLFile mz;
      mz.load(src, exp);
      mz.getOptions().setWriteIndex(true);
      mz.getOptions().setCompression(zlib);
      mz.getOptions().setMz32Bit(mz32);
      mz.getOptions().setIntensity32Bit(int32);
      if (numpress)
      {
        MSNumpressCoder::NumpressConfig c;
        c.np_compression = MSNumpressCoder::LINEAR;
        c.estimate_fixed_point = true;
        mz.getOptions().setNumpressConfigurationMassTime(c);
      }
      mz.store(dst, exp);
      return dst;
    }
    catch (const Exception::BaseException& e)
    {
      std::cerr << "could not write " << dst << ": " << e.what() << "\n";
      return {};
    }
  }
}


namespace
{
  std::string base64(const std::string& in)
  {
    static const char* a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string o;
    std::size_t i = 0;
    const auto b = [&](std::size_t k) { return static_cast<unsigned>(static_cast<unsigned char>(in[k])); };
    for (; i + 2 < in.size(); i += 3)
    {
      const unsigned v = b(i) << 16 | b(i + 1) << 8 | b(i + 2);
      o += a[v >> 18]; o += a[(v >> 12) & 63]; o += a[(v >> 6) & 63]; o += a[v & 63];
    }
    if (in.size() - i == 1)
    {
      const unsigned v = b(i) << 16;
      o += a[v >> 18]; o += a[(v >> 12) & 63]; o += "==";
    }
    else if (in.size() - i == 2)
    {
      const unsigned v = b(i) << 16 | b(i + 1) << 8;
      o += a[v >> 18]; o += a[(v >> 12) & 63]; o += a[(v >> 6) & 63]; o += '=';
    }
    return o;
  }

  /// One 64-bit binaryDataArray of two values; @p extra goes into the
  /// m/z or intensity cvParam (a unit, say).
  std::string synthetic_array(bool zlib, bool intensity, const std::string& extra = "")
  {
    const double v[2] = {intensity ? 1000.5 : 100.5, intensity ? 2000.25 : 200.25};
    std::string bytes(reinterpret_cast<const char*>(v), sizeof v);
    if (zlib)
    {
      uLongf n = compressBound(static_cast<uLong>(bytes.size()));
      std::string z(n, '\0');
      compress2(reinterpret_cast<Bytef*>(z.data()), &n, reinterpret_cast<const Bytef*>(bytes.data()),
                static_cast<uLong>(bytes.size()), 6);
      bytes = z.substr(0, n);
    }
    return std::string("<binaryDataArray encodedLength=\"0\">\n") +
           "<cvParam cvRef=\"MS\" accession=\"MS:1000523\" name=\"64-bit float\" value=\"\"/>\n" +
           (zlib ? "<cvParam cvRef=\"MS\" accession=\"MS:1000574\" name=\"zlib compression\" value=\"\"/>\n"
                 : "<cvParam cvRef=\"MS\" accession=\"MS:1000576\" name=\"no compression\" value=\"\"/>\n") +
           (intensity ? "<cvParam cvRef=\"MS\" accession=\"MS:1000515\" name=\"intensity array\" value=\"\"" + extra + "/>\n"
                      : "<cvParam cvRef=\"MS\" accession=\"MS:1000514\" name=\"m/z array\" value=\"\"" + extra + "/>\n") +
           "<binary>" + base64(bytes) + "</binary>\n</binaryDataArray>\n";
  }

  /// A well-formed MS2 <spectrum> of two peaks, as a writer lays it out.
  std::string synthetic_spectrum(const std::string& id, bool zlib)
  {
    return "<spectrum index=\"0\" id=\"" + id + "\" defaultArrayLength=\"2\">\n"
           "<cvParam cvRef=\"MS\" accession=\"MS:1000511\" name=\"ms level\" value=\"2\"/>\n"
           "<userParam name=\"note\" value=\"plain\"/>\n"
           "<scanList count=\"1\">\n<scan>\n"
           "<cvParam cvRef=\"MS\" accession=\"MS:1000016\" name=\"scan start time\" value=\"60\" "
           "unitCvRef=\"UO\" unitAccession=\"UO:0000010\" unitName=\"second\"/>\n</scan>\n</scanList>\n"
           "<binaryDataArrayList count=\"2\">\n" +
           synthetic_array(zlib, false) + synthetic_array(zlib, true) + "</binaryDataArrayList>\n</spectrum>\n";
  }

  /// An mzML of the given spectra, without an index (the reader scans it).
  void write_synthetic(const std::string& path, const std::vector<std::string>& spectra)
  {
    std::string b = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<mzML xmlns=\"http://psi.hupo.org/ms/mzml\" "
                    "version=\"1.1.0\">\n<run id=\"r\">\n<spectrumList count=\"" + std::to_string(spectra.size()) +
                    "\">\n";
    for (const std::string& sp : spectra) b += sp;
    b += "</spectrumList>\n</run>\n</mzML>\n";
    spit(path, b);
  }

  /// @p sp with the first @p from replaced by @p to (which must be there).
  std::string edit(std::string sp, const std::string& from, const std::string& to)
  {
    const std::size_t at = sp.find(from);
    check(at != std::string::npos, "test edit finds '" + from + "'");
    if (at != std::string::npos) sp.replace(at, from.size(), to);
    return sp;
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

  // temp_directory_path honours TMPDIR on POSIX and TEMP/TMP on Windows,
  // where a literal "/tmp" does not exist (the test skipped there).
  const std::string tmp = std::filesystem::temp_directory_path().string();
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

  // The direct peak decoder against OpenMS's decoder, spectrum by spectrum,
  // on every encoding OpenMS writes and on edits it must decline or survive.
  {
    direct_vs_openms(indexed, "direct: fixture as written", true);
    for (const bool zlib : {false, true})
      for (const bool mz32 : {false, true})
        for (const bool int32 : {false, true})
        {
          const std::string tag = std::string(zlib ? "zlib" : "raw") + (mz32 ? "_mz32" : "_mz64") +
                                  (int32 ? "_int32" : "_int64");
          const std::string f = rewrite_encoded(fixture, tmp + "/fastag_enc_" + tag + ".mzML", zlib, mz32, int32);
          check(!f.empty(), "write the " + tag + " copy");
          if (!f.empty()) direct_vs_openms(f, "direct: " + tag, true);
        }
    // Numpress is OpenMS's alone: every spectrum declined, same result.
    {
      const std::string f = rewrite_encoded(fixture, tmp + "/fastag_enc_numpress.mzML", true, false, true, true);
      if (!f.empty()) direct_vs_openms(f, "direct: numpress (declined)", false);
    }
    // Line breaks inside the base64, as some writers emit them: the index
    // goes stale (rescanned), the decoder skips the whitespace as OpenMS
    // strips it.
    {
      std::string b = slurp(indexed);
      for (std::size_t at = b.find("<binary>"); at != std::string::npos; at = b.find("<binary>", at + 1))
      {
        const std::size_t e = b.find("</binary>", at);
        if (e - at > 40) b.insert(at + 8 + 16, "\n  \t\r ");
      }
      spit(tmp + "/fastag_b64_breaks.mzML", b);
      direct_vs_openms(tmp + "/fastag_b64_breaks.mzML", "direct: whitespace in base64", true);
    }
    // Attributes in single quotes and in another order, a cvParam written
    // with an end tag, and a comment inside the arrays (declined).
    {
      std::string b = slurp(indexed);
      const std::string from = "<cvParam cvRef=\"MS\" accession=\"MS:1000574\" name=\"zlib compression\" />";
      const std::string from_raw = "<cvParam cvRef=\"MS\" accession=\"MS:1000576\" name=\"no compression\" />";
      const std::string to = "<cvParam name='zlib compression' accession='MS:1000574' cvRef='MS'></cvParam>";
      const std::string to_raw = "<cvParam name='no compression' accession='MS:1000576' cvRef='MS'></cvParam>";
      for (std::size_t at = b.find(from); at != std::string::npos; at = b.find(from, at + 1)) b.replace(at, from.size(), to);
      for (std::size_t at = b.find(from_raw); at != std::string::npos; at = b.find(from_raw, at + 1))
        b.replace(at, from_raw.size(), to_raw);
      spit(tmp + "/fastag_attr_forms.mzML", b);
      direct_vs_openms(tmp + "/fastag_attr_forms.mzML", "direct: attribute forms", true);

      std::string c = slurp(indexed);
      for (std::size_t at = c.find("<binaryDataArray "); at != std::string::npos; at = c.find("<binaryDataArray ", at + 30))
        c.insert(at, "<!-- x -->");
      spit(tmp + "/fastag_comment.mzML", c);
      direct_vs_openms(tmp + "/fastag_comment.mzML", "direct: comments in the arrays (declined)", false);
    }
    // Truncated and corrupted zlib streams: OpenMS's verdict either way.
    {
      const std::string z = tmp + "/fastag_enc_zlib_mz64_int32.mzML";
      std::string b = slurp(z);
      std::size_t k = 0;
      for (std::size_t at = b.find("<binary>"); at != std::string::npos; at = b.find("<binary>", at + 1), ++k)
      {
        const std::size_t e = b.find("</binary>", at);
        if (e - at < 40) continue;
        if (k % 7 == 1) b[at + 8 + 12] = b[at + 8 + 12] == 'A' ? 'B' : 'A'; // corrupt
        if (k % 7 == 3) b.replace(e - 8, 8, "AAAAAAAA");                      // damage the stream's end
      }
      spit(tmp + "/fastag_zlib_damaged.mzML", b);
      direct_vs_openms(tmp + "/fastag_zlib_damaged.mzML", "direct: damaged zlib streams", true);
    }
    // The ion mobility file of above: three arrays, declined.
    direct_vs_openms(tmp + "/fastag_im_arrays.mzML", "direct: extra arrays (declined)", false);
  }
  // Synthetic spectra, each the second of a two-spectrum file after a clean
  // one. MALFORMED: libxml2 (non-recovering, as OpenMS runs it) stops on each
  // before the root ends, OpenMS throws, and the run must fail as in 1.10.0:
  // the direct decoder has to decline, wherever in the element the error is.
  {
    const std::string good = synthetic_spectrum("s=1", false);
    const std::string goodz = synthetic_spectrum("s=1", true);
    const std::string arrays = "<binaryDataArrayList count=\"2\">";
    struct Case
    {
      const char* name;
      std::string spectrum;
    };
    const std::vector<Case> malformed = {
        {"unclosed element in the metadata", edit(good, "<scan>\n<cvParam", "<scan>\n<scan>\n<cvParam")},
        {"mismatched end tag in the metadata", edit(good, "</scanList>", "</scanlist>")},
        {"undefined entity in the metadata", edit(good, "value=\"plain\"", "value=\"&bogus;\"")},
        {"unescaped '&' in the metadata", edit(good, "value=\"plain\"", "value=\"A&B\"")},
        {"bad character reference in the metadata", edit(good, "value=\"plain\"", "value=\"&#1;\"")},
        {"']]>' in metadata text", edit(good, "</scan>", "]]></scan>")},
        {"missing </binaryDataArrayList>", edit(good, "</binaryDataArrayList>\n", "")},
        {"no whitespace between attributes", edit(good, "id=\"s=1\" defaultArrayLength", "id=\"s=1\"defaultArrayLength")},
        {"duplicate attribute", edit(good, "id=\"s=1\"", "id=\"a\" id=\"b\"")},
        {"duplicate attribute among the arrays", edit(good, "encodedLength=\"0\"", "encodedLength=\"0\" encodedLength=\"1\"")},
        {"stray '&' between arrays", edit(good, arrays, arrays + " & ")},
        {"invalid UTF-8 in the id", edit(good, "id=\"s=1\"", "id=\"s=\xff\x31\"")},
        {"invalid UTF-8 in the metadata", edit(good, "value=\"plain\"", "value=\"\xb5m\"")},
        {"zlib: unclosed element in the metadata", edit(goodz, "<scan>\n<cvParam", "<scan>\n<scan>\n<cvParam")},
    };
    int k = 0;
    for (const Case& c : malformed)
    {
      const std::string path = tmp + "/fastag_malformed_" + std::to_string(k++) + ".mzML";
      write_synthetic(path, {synthetic_spectrum("s=0", false), c.spectrum});
      const std::string what = std::string("direct: malformed, ") + c.name;
      direct_vs_openms(path, what, true);
      FASTag::IndexedMzMLReader r(path);
      r.setDirectDecoding(true);
      bool threw = false;
      try { r.getSpectrum(1); }
      catch (const Exception::BaseException&) { threw = true; }
      check(r.ok() && threw, what + ": the spectrum is an error, as on OpenMS's path");
      check(r.directDecoded() == 0, what + ": declined by the direct decoder");
    }

    // WELL-FORMED forms the metadata may take: read directly, same result.
    const std::vector<Case> fine = {
        {"comment in the metadata", edit(good, "<scanList", "<!-- a comment -->\n<scanList")},
        {"predefined entity in the metadata", edit(good, "value=\"plain\"", "value=\"A&amp;B &lt;&#181;&#xB5;\"")},
        {"UTF-8 in the metadata", edit(good, "value=\"plain\"", "value=\"\xc2\xb5m \xe2\x82\xac\"")},
        {"end tag with whitespace", edit(good, "</scanList>", "</scanList  >")},
    };
    for (const Case& c : fine)
    {
      const std::string path = tmp + "/fastag_wellformed_" + std::to_string(k++) + ".mzML";
      write_synthetic(path, {synthetic_spectrum("s=0", false), c.spectrum});
      const std::string what = std::string("direct: well-formed, ") + c.name;
      direct_vs_openms(path, what, true);
      FASTag::IndexedMzMLReader r(path);
      r.setDirectDecoding(true);
      check(r.getSpectrum(1).size() == 2 && r.directDecoded() == 1, what + ": decoded directly");
    }

    // An inflated defaultArrayLength on zlib arrays: OpenMS warns and reads
    // the two peaks; the direct decoder must decline without allocating for
    // the claim (2^31 - 1 peaks: 16 GB per array, a bad_alloc where memory
    // is limited) and leave the spectrum to OpenMS.
    // On Linux the address space is capped at 8 GB above what the process
    // maps now, around these cases, as a Windows commit limit or a hosted
    // runner would cap it: an allocation sized from the claim (16 GB) then
    // fails there too, instead of being granted as untouched virtual memory.
#ifdef __linux__
    rlimit saved{};
    const bool limited = getrlimit(RLIMIT_AS, &saved) == 0 && [&] {
      unsigned long long pages = 0;
      std::ifstream statm("/proc/self/statm");
      if (!(statm >> pages) || pages == 0) return false;
      const rlim_t want = static_cast<rlim_t>(pages) * static_cast<rlim_t>(sysconf(_SC_PAGESIZE)) + (rlim_t{8} << 30);
      rlimit cap = saved;
      cap.rlim_cur = std::min<rlim_t>(saved.rlim_cur, want);
      return setrlimit(RLIMIT_AS, &cap) == 0;
    }();
#endif
    for (const char* len : {"2147483647", "1000"})
    {
      const std::string path = tmp + "/fastag_inflated_length_" + len + ".mzML";
      write_synthetic(path, {synthetic_spectrum("s=0", true),
                             edit(goodz, "defaultArrayLength=\"2\"", std::string("defaultArrayLength=\"") + len + "\"")});
      const std::string what = std::string("direct: zlib, defaultArrayLength=") + len;
      direct_vs_openms(path, what, true);
      FASTag::IndexedMzMLReader r(path);
      r.setDirectDecoding(true);
      MSSpectrum got;
      try { got = r.getSpectrum(1); }
      catch (...) {}
      check(got.size() == 2 && r.directDecoded() == 0, what + ": OpenMS reads the two peaks");
    }
#ifdef __linux__
    if (limited) setrlimit(RLIMIT_AS, &saved);
#endif

    // An absorbance unit written with a character reference is still
    // absorbance: OpenMS adds the meta value, so the direct decoder declines.
    {
      const std::string path = tmp + "/fastag_unit_charref.mzML";
      const std::string sp = edit(good, synthetic_array(false, true),
                                  synthetic_array(false, true, " unitCvRef=\"UO\" unitAccession=\"UO&#58;0000269\" "
                                                               "unitName=\"absorbance unit\""));
      write_synthetic(path, {synthetic_spectrum("s=0", false), sp});
      direct_vs_openms(path, "direct: absorbance unit as a character reference", true);
      FASTag::IndexedMzMLReader r(path);
      r.setDirectDecoding(true);
      const MSSpectrum got = r.getSpectrum(1);
      check(got.metaValueExists("mzml intensity array"),
            "absorbance as a character reference: the meta value is there");
    }
  }

  // Further mzML files from the command line, each compared spectrum by
  // spectrum: under ctest the vendored mzML that OpenMS did not write
  // (diaTracer and ddaPASEF layouts), by hand the public gate inputs.
  for (int a = 2; a < argc; ++a) direct_vs_openms(argv[a], std::string("direct: ") + argv[a], true);

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
