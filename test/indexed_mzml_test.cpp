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
#include "IonSeries.h"

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
#include <set>
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
  /// MS-Numpress: @p mz_np for m/z, @p other_np for the intensities and for
  /// an added per-peak float array named "Ion Mobility" (written as a
  /// non-standard array, MS:1000786, as timsTOF conversions do).
  std::string rewrite_encoded(const std::string& src, const std::string& dst, bool zlib, bool mz32, bool int32,
                              MSNumpressCoder::NumpressCompression mz_np = MSNumpressCoder::NONE,
                              MSNumpressCoder::NumpressCompression other_np = MSNumpressCoder::NONE)
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
      MSNumpressCoder::NumpressConfig c;
      c.estimate_fixed_point = true;
      c.numpressErrorTolerance = 0; // lossy is fine here; never fall back to plain arrays
      c.np_compression = mz_np;
      mz.getOptions().setNumpressConfigurationMassTime(c);
      c.np_compression = other_np;
      mz.getOptions().setNumpressConfigurationIntensity(c);
      mz.getOptions().setNumpressConfigurationFloatDataArray(c);
      if (other_np != MSNumpressCoder::NONE)
        for (MSSpectrum& sp : exp)
        {
          auto& im = sp.getFloatDataArrays().emplace_back();
          im.setName("Ion Mobility");
          for (Size k = 0; k < sp.size(); ++k) im.push_back(0.6f + 0.001f * static_cast<float>(k % 900));
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

// ---- step 0 (1.12): the metadata OpenMS's MzMLHandler fills and the fast
// reader now fills too, compared field by field.
namespace
{
  /// What the step-0 comparisons exercised, so a vacuous pass is caught.
  struct Step0Seen
  {
    Size typed = 0, filter = 0, activation = 0, energy = 0, possible = 0, target_meta = 0, spectra = 0;
    /// Known 1.11 divergence, not step 0: a <precursor> with neither a
    /// selected ion nor an isolation target (ddaPASEF MS2 without a pick)
    /// is a Precursor at m/z 0 in OpenMS and none in the fast reader. Such
    /// m/z-less precursors (OpenMS's, counted here, and the fast reader's for
    /// an ion with a charge but no m/z) are left out of the comparison.
    Size mzless_precursor = 0;
  };

  /// The step-0 fields of @p got (fast reader) against @p want (OpenMS);
  /// empty if equal, else the first difference. Precursor @p k of each.
  std::string step0_precursor_diff(const Precursor& a, const Precursor& b, Step0Seen& seen)
  {
    if (std::fabs(a.getMZ() - b.getMZ()) > 1e-6) return "precursor m/z";
    if (a.getCharge() != b.getCharge()) return "precursor charge";
    if (a.getActivationMethods() != b.getActivationMethods()) return "activation methods";
    if (!b.getActivationMethods().empty()) ++seen.activation;
    if (a.getActivationEnergy() != b.getActivationEnergy()) return "activation energy";
    if (b.getActivationEnergy() != 0) ++seen.energy;
    if (a.getPossibleChargeStates() != b.getPossibleChargeStates()) return "possible charge states";
    if (!b.getPossibleChargeStates().empty()) ++seen.possible;
    const std::string t = "isolation window target m/z";
    if (a.metaValueExists(t) != b.metaValueExists(t)) return "isolation target meta value present";
    if (b.metaValueExists(t))
    {
      ++seen.target_meta;
      if (std::fabs(double(a.getMetaValue(t)) - double(b.getMetaValue(t))) > 1e-9) return "isolation target meta value";
    }
    if (std::fabs(a.getIsolationWindowLowerOffset() - b.getIsolationWindowLowerOffset()) > 1e-6 ||
        std::fabs(a.getIsolationWindowUpperOffset() - b.getIsolationWindowUpperOffset()) > 1e-6)
      return "isolation window offsets";
    return {};
  }

  std::string step0_diff(const MSSpectrum& got, const MSSpectrum& want, Step0Seen& seen)
  {
    if (got.getMSLevel() != want.getMSLevel()) return "ms level";
    if (got.getNativeID() != want.getNativeID()) return "native id";
    if (std::fabs(got.getRT() - want.getRT()) > 1e-6) return "retention time";
    if (got.getType() != want.getType()) return "spectrum type";
    if (want.getType() != SpectrumSettings::SpectrumType::UNKNOWN) ++seen.typed;
    const std::string f = "filter string";
    if (got.metaValueExists(f) != want.metaValueExists(f)) return "filter string present";
    if (want.metaValueExists(f))
    {
      ++seen.filter;
      if (got.getMetaValue(f).toString() != want.getMetaValue(f).toString())
        return "filter string '" + got.getMetaValue(f).toString() + "' vs '" + want.getMetaValue(f).toString() + "'";
    }
    // OpenMS keeps a precursor's FIRST selected ion only, the fast reader one
    // Precursor per ion: the counts agree whenever every precursor has one.
    // m/z-less precursors are set aside on both sides (see Step0Seen).
    std::vector<Precursor> pa, pb;
    for (const Precursor& x : got.getPrecursors())
      if (x.getMZ() != 0) pa.push_back(x);
    for (const Precursor& x : want.getPrecursors())
    {
      if (x.getMZ() == 0) ++seen.mzless_precursor;
      else pb.push_back(x);
    }
    if (pa.empty() != pb.empty()) return "precursor presence";
    const Size np = pa.size() == pb.size() ? pa.size() : std::min<Size>(1, pa.size());
    for (Size k = 0; k < np; ++k)
    {
      const std::string d = step0_precursor_diff(pa[k], pb[k], seen);
      if (!d.empty()) return d + " (precursor " + std::to_string(k) + ")";
    }
    ++seen.spectra;
    return {};
  }

  /// getSpectrumMetadata() must give exactly getSpectrum()'s metadata.
  std::string metadata_only_diff(const MSSpectrum& meta, const MSSpectrum& full)
  {
    if (!meta.empty() && full.getMSLevel() == 2) return "metadata read decoded peaks";
    if (meta.getMSLevel() != full.getMSLevel() || meta.getNativeID() != full.getNativeID() ||
        meta.getRT() != full.getRT() || meta.getType() != full.getType())
      return "spectrum fields";
    std::vector<std::string> ka, kb;
    meta.getKeys(ka);
    full.getKeys(kb);
    if (ka != kb) return "meta value keys";
    if (meta.metaValueExists("filter string") && meta.getMetaValue("filter string") != full.getMetaValue("filter string"))
      return "filter string";
    if (meta.getPrecursors() != full.getPrecursors()) return "precursors";
    if (!(meta.getInstrumentSettings() == full.getInstrumentSettings())) return "instrument settings";
    return {};
  }

  /// @p full with the step-0 fields NOT in @p fields cleared: what a read
  /// with that field mask must give (1.12.2).
  MSSpectrum masked(MSSpectrum full, unsigned fields)
  {
    using R = FASTag::IndexedMzMLReader;
    if (!(fields & R::kStep0Type)) full.setType(SpectrumSettings::SpectrumType::UNKNOWN);
    if (!(fields & R::kStep0FilterString) && full.metaValueExists("filter string")) full.removeMetaValue("filter string");
    for (Precursor& p : full.getPrecursors())
    {
      if (!(fields & R::kStep0Activation)) p.setActivationMethods({});
      if (!(fields & R::kStep0ActivationEnergy)) p.setActivationEnergy(0.0);
      if (!(fields & R::kStep0PossibleCharges)) p.setPossibleChargeStates({});
      if (!(fields & R::kStep0TargetMeta) && p.metaValueExists("isolation window target m/z"))
        p.removeMetaValue("isolation window target m/z");
    }
    return full;
  }

  /// The field masks a read is checked under: none, each field alone, and
  /// the callers' (1.12.2).
  std::vector<unsigned> field_masks()
  {
    using R = FASTag::IndexedMzMLReader;
    std::vector<unsigned> m = {0u, R::kTaggingFields, R::kProbeFields, R::kActivationFields};
    for (unsigned b = 1; b < R::kAllFields; b <<= 1) m.push_back(b);
    return m;
  }

  /// Every spectrum of @p path through the fast reader against OpenMS's
  /// MzMLFile, which parses with the same MzMLHandler as OnDiscMSExperiment
  /// and needs no index (the synthetic fixtures have none).
  Step0Seen metadata_vs_openms(const std::string& path, const std::string& what)
  {
    Step0Seen seen;
    PeakMap ref;
    try { MzMLFile().load(path, ref); }
    catch (const Exception::BaseException& e)
    {
      check(false, what + ": OpenMS loads the file (" + e.what() + ")");
      return seen;
    }
    FASTag::IndexedMzMLReader r(path);
    check(r.ok(), what + ": reader opens the file");
    check(r.getNrSpectra() == ref.size(), what + ": same spectrum count");
    const Size n = std::min<Size>(r.getNrSpectra(), ref.size());
    Size bad = 0, bad_meta = 0, bad_mask = 0;
    std::string first, first_meta, first_mask;
    for (Size i = 0; i < n; ++i)
    {
      const MSSpectrum got = r.getSpectrum(i);
      const std::string d = step0_diff(got, ref[i], seen);
      if (!d.empty() && bad++ == 0) first = "spectrum " + std::to_string(i) + ": " + d;
      const std::string dm = metadata_only_diff(r.getSpectrumMetadata(i), got);
      if (!dm.empty() && bad_meta++ == 0) first_meta = "spectrum " + std::to_string(i) + ": " + dm;
      // A masked read is the full read with the other step-0 fields unset.
      const MSSpectrum got_meta = r.getSpectrumMetadata(i);
      for (const unsigned m : field_masks())
      {
        if (!(r.getSpectrum(i, m) == masked(got, m)) && bad_mask++ == 0)
          first_mask = "spectrum " + std::to_string(i) + ", getSpectrum mask " + std::to_string(m);
        if (!(r.getSpectrumMetadata(i, m) == masked(got_meta, m)) && bad_mask++ == 0)
          first_mask = "spectrum " + std::to_string(i) + ", getSpectrumMetadata mask " + std::to_string(m);
      }
    }
    check(bad_mask == 0, what + ": a masked read is the full read with the other step-0 fields unset (" +
                             std::to_string(bad_mask) + " differ" +
                             (bad_mask ? "; first " + first_mask : std::string()) + ")");
    check(n > 0 && bad == 0, what + ": step-0 metadata equals OpenMS's (" + std::to_string(bad) + " of " +
                                 std::to_string(n) + " differ" + (bad ? "; first " + first : std::string()) + ")");
    check(bad_meta == 0, what + ": getSpectrumMetadata equals getSpectrum's metadata (" +
                             std::to_string(bad_meta) + " differ" +
                             (bad_meta ? "; first " + first_meta : std::string()) + ")");
    std::cout << what << ": step 0 on " << n << " spectra: " << seen.typed << " typed, " << seen.filter
              << " filter strings, " << seen.activation << " activations (" << seen.energy << " with energy), "
              << seen.possible << " with possible charges, " << seen.target_meta << " target meta values"
              << (seen.mzless_precursor ? ", " + std::to_string(seen.mzless_precursor) +
                                              " m/z-less precursors (known, not compared)"
                                        : std::string())
              << "\n";
    return seen;
  }

  /// A cvParam line.
  std::string cv(const std::string& acc, const std::string& name, const std::string& value = "",
                 const std::string& unit = "")
  {
    return "<cvParam cvRef=\"MS\" accession=\"" + acc + "\" name=\"" + name + "\" value=\"" + value + "\"" +
           (unit.empty() ? std::string() : " unitAccession=\"" + unit + "\"") + "/>\n";
  }
  std::string ref(const std::string& id) { return "<referenceableParamGroupRef ref=\"" + id + "\"/>\n"; }

  /// One synthetic <spectrum>, its parts given as XML: @p spec_params go
  /// right after the start tag, @p scan_params into the one <scan>,
  /// @p precursor the whole <precursorList> (or empty).
  std::string param_spectrum(int index, const std::string& spec_params, const std::string& scan_params,
                             const std::string& precursor)
  {
    return "<spectrum index=\"" + std::to_string(index) + "\" id=\"scan=" + std::to_string(index + 1) +
           "\" defaultArrayLength=\"2\">\n" + spec_params + "<scanList count=\"1\">\n" +
           cv("MS:1000795", "no combination") + "<scan>\n" + scan_params +
           cv("MS:1000016", "scan start time", std::to_string(10 * (index + 1)), "UO:0000010") +
           "</scan>\n</scanList>\n" + precursor + "<binaryDataArrayList count=\"2\">\n" +
           synthetic_array(false, false) + synthetic_array(false, true) + "</binaryDataArrayList>\n</spectrum>\n";
  }

  /// An mzML with @p groups (referenceableParamGroup elements) in its run
  /// header and @p sp as its spectra. The header is @p header_src's (an
  /// OpenMS-written file), so OpenMS reads it as a normal run.
  bool write_group_mzml(const std::string& header_src, const std::string& path, const std::string& groups,
                        const std::vector<std::string>& sp)
  {
    const std::string src = slurp(header_src);
    const std::size_t sl = src.find("<spectrumList");
    if (sl == std::string::npos) return false;
    std::string head = src.substr(0, sl);
    if (const std::size_t gl = head.find("</referenceableParamGroupList>"); gl != std::string::npos)
      head.insert(gl, groups);
    else if (const std::size_t fd = head.find("</fileDescription>"); fd != std::string::npos)
      head.insert(fd + 18, "\n<referenceableParamGroupList count=\"1\">\n" + groups + "</referenceableParamGroupList>\n");
    else
      return false;
    // The source's own spectrumList start tag (OpenMS requires its
    // defaultDataProcessingRef), with this file's count.
    std::string list_tag = src.substr(sl, src.find('>', sl) + 1 - sl);
    if (const std::size_t c = list_tag.find("count=\""); c != std::string::npos)
      list_tag.replace(c + 7, list_tag.find('"', c + 7) - (c + 7), std::to_string(sp.size()));
    std::string b = head + list_tag + "\n";
    for (const std::string& x : sp) b += x;
    b += "</spectrumList>\n</run>\n</mzML>\n";
    if (head.find("<indexedmzML") != std::string::npos) b += "</indexedmzML>\n";
    spit(path, b);
    return true;
  }

  /// The step-0 fixture: an mzML whose spectra take their type, filter
  /// string, isolation target, possible charges and activation from
  /// referenceableParamGroups, mixed with spectra that carry their own
  /// cvParams (one overriding a group). The fields 1.11 already read (MS
  /// level, selected ion, isolation offsets) are given as own cvParams here,
  /// since the fast reader does not resolve them from groups (see
  /// write_pinned_fixture).
  bool write_paramgroup_fixture(const std::string& header_src, const std::string& path)
  {
    const std::string groups =
        "<referenceableParamGroup id=\"pg_ms2_profile\">\n" + cv("MS:1000511", "ms level", "2") +
        cv("MS:1000580", "MSn spectrum") + cv("MS:1000128", "profile spectrum") +
        "</referenceableParamGroup>\n"
        "<referenceableParamGroup id=\"pg_centroid\">\n" + cv("MS:1000127", "centroid spectrum") +
        "</referenceableParamGroup>\n"
        "<referenceableParamGroup id=\"pg_ethcd\">\n" + cv("MS:1000598", "electron transfer dissociation") +
        cv("MS:1002678", "supplemental beam-type collision-induced dissociation") +
        cv("MS:1000509", "activation energy", "25", "UO:0000266") + "</referenceableParamGroup>\n"
        "<referenceableParamGroup id=\"pg_charges\">\n" + cv("MS:1000633", "possible charge state", "2") +
        cv("MS:1000633", "possible charge state", "3") + "</referenceableParamGroup>\n"
        "<referenceableParamGroup id=\"pg_filter\">\n" +
        cv("MS:1000512", "filter string", "FTMS + c NSI d Full ms2 500.50@etd25.00 [120.00-2000.00]") +
        "</referenceableParamGroup>\n"
        "<referenceableParamGroup id=\"pg_iso\">\n" + cv("MS:1000827", "isolation window target m/z", "500.5", "MS:1000040") +
        "</referenceableParamGroup>\n";

    const std::string iso_own = "<isolationWindow>\n" +
                                cv("MS:1000827", "isolation window target m/z", "445.12", "MS:1000040") +
                                cv("MS:1000828", "isolation window lower offset", "0.5", "MS:1000040") +
                                cv("MS:1000829", "isolation window upper offset", "0.5", "MS:1000040") +
                                "</isolationWindow>\n";
    std::vector<std::string> sp;
    // 0: MS1, typed from a group.
    sp.push_back(param_spectrum(0, cv("MS:1000511", "ms level", "1") + ref("pg_centroid"), "", ""));
    // 1: MS2 with the step-0 fields from groups: type, filter string,
    //    isolation target (meta value), possible charges (no charge), EThcD
    //    activation. Its MS level is in the group AND its own (equal), the
    //    isolation offsets its own.
    sp.push_back(param_spectrum(
        1, ref("pg_ms2_profile") + cv("MS:1000511", "ms level", "2"), ref("pg_filter"),
        "<precursorList count=\"1\">\n<precursor>\n<isolationWindow>\n" + ref("pg_iso") +
            cv("MS:1000828", "isolation window lower offset", "1.25", "MS:1000040") +
            cv("MS:1000829", "isolation window upper offset", "0.75", "MS:1000040") + "</isolationWindow>\n<selectedIonList count=\"1\">\n<selectedIon>\n" + ref("pg_charges") +
            cv("MS:1000744", "selected ion m/z", "500.75", "MS:1000040") +
            "</selectedIon>\n</selectedIonList>\n<activation>\n" + ref("pg_ethcd") +
            "</activation>\n</precursor>\n</precursorList>\n"));
    // 2: own cvParams that override a group (centroid over the group's
    //    profile), an escaped filter string, possible charges from a group
    //    AND its own, a selected ion equal to the target (no meta value),
    //    CID with an activation energy.
    sp.push_back(param_spectrum(
        2, ref("pg_ms2_profile") + cv("MS:1000511", "ms level", "2") + cv("MS:1000127", "centroid spectrum"),
        cv("MS:1000512", "filter string", "ITMS + c ESI d w Full ms2 445.12@cid35.00 [110.00-2000.00] &amp; &lt;x&gt; &#65;"),
        "<precursorList count=\"1\">\n<precursor>\n" + iso_own + "<selectedIonList count=\"1\">\n<selectedIon>\n" +
            ref("pg_charges") + cv("MS:1000744", "selected ion m/z", "445.12", "MS:1000040") +
            cv("MS:1000041", "charge state", "2") + cv("MS:1000633", "possible charge state", "4") +
            "</selectedIon>\n</selectedIonList>\n<activation>\n" + cv("MS:1000133", "collision-induced dissociation") +
            cv("MS:1000509", "activation energy", "35", "UO:0000266") + "</activation>\n</precursor>\n</precursorList>\n"));
    // 3: a precursor without a selected ion (its m/z is the target), HCD.
    sp.push_back(param_spectrum(
        3, cv("MS:1000511", "ms level", "2"), "",
        "<precursorList count=\"1\">\n<precursor>\n<isolationWindow>\n" +
            cv("MS:1000827", "isolation window target m/z", "600.25", "MS:1000040") +
            "</isolationWindow>\n<activation>\n" + cv("MS:1000422", "beam-type collision-induced dissociation") +
            "</activation>\n</precursor>\n</precursorList>\n"));
    // 4: a selected ion without an isolation window (OpenMS keeps 0 as the
    //    target), and a reference to a group that does not exist.
    sp.push_back(param_spectrum(
        4, cv("MS:1000511", "ms level", "2") + ref("pg_missing"), "",
        "<precursorList count=\"1\">\n<precursor>\n<selectedIonList count=\"1\">\n<selectedIon>\n" +
            cv("MS:1000744", "selected ion m/z", "700.5", "MS:1000040") + cv("MS:1000041", "charge state", "3") +
            "</selectedIon>\n</selectedIonList>\n<activation>\n" + cv("MS:1002472", "trap-type collision-induced dissociation") +
            "</activation>\n</precursor>\n</precursorList>\n"));
    return write_group_mzml(header_src, path, groups, sp);
  }

  /// The pinned fixture: the fields 1.11 already read, each ONLY in a
  /// referenced group, which OpenMS resolves and the fast reader (1.11 and
  /// step 0 alike) does not. Resolving them changes tags, so it is a separate
  /// declared item; until then these must read exactly as 1.11 reads them.
  ///  0: MS1, own MS level;
  ///  1: MS level only in a group (1.11: not read, so not an MS2, not tagged);
  ///  2: charge only in a group (1.11: no charge, tagged as 2+);
  ///  3: isolation target and offsets only in a group (1.11: no offsets);
  ///  4: selected-ion m/z and intensity only in a group, own isolation target
  ///     (1.11: the target as precursor m/z, no intensity).
  bool write_pinned_fixture(const std::string& header_src, const std::string& path)
  {
    const std::string groups =
        "<referenceableParamGroup id=\"pin_ms2\">\n" + cv("MS:1000511", "ms level", "2") +
        "</referenceableParamGroup>\n"
        "<referenceableParamGroup id=\"pin_z3\">\n" + cv("MS:1000041", "charge state", "3") +
        "</referenceableParamGroup>\n"
        "<referenceableParamGroup id=\"pin_iso\">\n" +
        cv("MS:1000827", "isolation window target m/z", "612", "MS:1000040") +
        cv("MS:1000828", "isolation window lower offset", "1", "MS:1000040") +
        cv("MS:1000829", "isolation window upper offset", "1.5", "MS:1000040") + "</referenceableParamGroup>\n"
        "<referenceableParamGroup id=\"pin_ion\">\n" + cv("MS:1000744", "selected ion m/z", "700.75", "MS:1000040") +
        cv("MS:1000042", "peak intensity", "1234", "MS:1000131") + "</referenceableParamGroup>\n";
    const std::string hcd = "<activation>\n" + cv("MS:1000422", "beam-type collision-induced dissociation") +
                            "</activation>\n";
    const std::string ms2 = cv("MS:1000511", "ms level", "2");
    std::vector<std::string> sp;
    sp.push_back(param_spectrum(0, cv("MS:1000511", "ms level", "1"), "", ""));
    sp.push_back(param_spectrum(
        1, ref("pin_ms2"), "",
        "<precursorList count=\"1\">\n<precursor>\n<selectedIonList count=\"1\">\n<selectedIon>\n" +
            cv("MS:1000744", "selected ion m/z", "445.25", "MS:1000040") + cv("MS:1000041", "charge state", "2") +
            "</selectedIon>\n</selectedIonList>\n" + hcd + "</precursor>\n</precursorList>\n"));
    sp.push_back(param_spectrum(
        2, ms2, "",
        "<precursorList count=\"1\">\n<precursor>\n<selectedIonList count=\"1\">\n<selectedIon>\n" +
            ref("pin_z3") + cv("MS:1000744", "selected ion m/z", "512.25", "MS:1000040") +
            "</selectedIon>\n</selectedIonList>\n" + hcd + "</precursor>\n</precursorList>\n"));
    sp.push_back(param_spectrum(
        3, ms2, "",
        "<precursorList count=\"1\">\n<precursor>\n<isolationWindow>\n" + ref("pin_iso") +
            "</isolationWindow>\n<selectedIonList count=\"1\">\n<selectedIon>\n" +
            cv("MS:1000744", "selected ion m/z", "612.3", "MS:1000040") + cv("MS:1000041", "charge state", "2") +
            "</selectedIon>\n</selectedIonList>\n" + hcd + "</precursor>\n</precursorList>\n"));
    sp.push_back(param_spectrum(
        4, ms2, "",
        "<precursorList count=\"1\">\n<precursor>\n<isolationWindow>\n" +
            cv("MS:1000827", "isolation window target m/z", "700.5", "MS:1000040") +
            "</isolationWindow>\n<selectedIonList count=\"1\">\n<selectedIon>\n" + ref("pin_ion") +
            cv("MS:1000041", "charge state", "2") + "</selectedIon>\n</selectedIonList>\n" + hcd +
            "</precursor>\n</precursorList>\n"));
    return write_group_mzml(header_src, path, groups, sp);
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
  Step0Seen ondisc_seen;
  for (Size i = 0; i < n; ++i)
  {
    const MSSpectrum got = reader.getSpectrum(i);
    const MSSpectrum want = ref.getSpectrum(i);
    const std::string at = " (spectrum " + std::to_string(i) + ")";
    // Step 0 (1.12): type, filter string, activation, possible charges and
    // the isolation target, against OnDiscMSExperiment itself.
    {
      const std::string d = step0_diff(got, want, ondisc_seen);
      check(d.empty(), "step-0 metadata as OnDisc: " + d + at);
      const std::string dm = metadata_only_diff(reader.getSpectrumMetadata(i), got);
      check(dm.empty(), "getSpectrumMetadata as getSpectrum: " + dm + at);
    }

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
  check(ondisc_seen.typed > 0 && ondisc_seen.activation > 0, "fixture exercises spectrum type and activation");

  // Step 0 against OpenMS on the param-group fixture and on every vendored
  // mzML: each field must be exercised somewhere, or the test proves nothing.
  {
    const std::string pg = tmp + "/fastag_paramgroups.mzML";
    check(write_paramgroup_fixture(indexed, pg), "write the param-group fixture");
    const Step0Seen s = metadata_vs_openms(pg, "param groups");
    check(s.spectra == 5, "param groups: all 5 spectra compared");
    check(s.typed == 3, "param groups: type from a group, from a group overridden, and from a group on MS1");
    check(s.filter == 2, "param groups: filter string from a group and escaped in its own cvParam");
    check(s.activation == 4 && s.energy == 2, "param groups: activation from a group and own, energy both ways");
    check(s.possible == 2, "param groups: possible charge states from a group and mixed");
    check(s.target_meta == 2, "param groups: the isolation target kept as meta value (and 0 without a window)");
    FASTag::IndexedMzMLReader r(pg);
    check(r.ok() && r.reportsSpectrumMetadata(), "param groups: the fast reader takes the file");
    const MSSpectrum s1 = r.getSpectrum(1);
    check(s1.getMSLevel() == 2 && s1.size() == 2, "param groups: spectrum 1 decodes as an MS2");
    check(s1.getPrecursors().size() == 1 && s1.getPrecursors()[0].metaValueExists("isolation window target m/z") &&
              double(s1.getPrecursors()[0].getMetaValue("isolation window target m/z")) == 500.5,
          "param groups: the isolation-target meta value comes from a group");
    check(s1.getType() == SpectrumSettings::SpectrumType::PROFILE &&
              s1.getPrecursors().size() == 1 &&
              s1.getPrecursors()[0].getActivationMethods() ==
                  std::set<Precursor::ActivationMethod>{Precursor::ActivationMethod::ETD,
                                                       Precursor::ActivationMethod::EThcD} &&
              s1.getPrecursors()[0].getPossibleChargeStates() == std::vector<Int>{2, 3},
          "param groups: spectrum 1 reads as written");
    const MSSpectrum s2 = r.getSpectrum(2);
    check(s2.getMetaValue("filter string").toString() ==
              "ITMS + c ESI d w Full ms2 445.12@cid35.00 [110.00-2000.00] & <x> A",
          "param groups: the filter string is unescaped");
    check(s2.getPrecursors().size() == 1 &&
              s2.getPrecursors()[0].getPossibleChargeStates() == std::vector<Int>{2, 3, 4},
          "param groups: group possible charges come first, then own ones");
  }

  // 1.12 #15: the activation class (IonSeries::activationClass, what
  // -ion_series auto decides by) of the fast reader equals OnDisc's and
  // OpenMS's, on etd_like (every CID term of the indexed fixture replaced by
  // ETD, same byte length so the index stays exact) and on etd_paramgroup
  // (ETD, EThcD and CID from groups and own, plus a filter-string-only
  // spectrum).
  {
    namespace IS = FASTag::IonSeries;
    const std::string etd_like = tmp + "/fastag_etd_like.mzML";
    std::string b = slurp(indexed);
    const std::string cid = "accession=\"MS:1000133\" name=\"collision-induced dissociation\"";
    const std::string etd = "accession=\"MS:1000598\" name=\"electron transfer dissociation\"";
    Size replaced = 0;
    for (std::size_t at = b.find(cid); at != std::string::npos; at = b.find(cid, at + etd.size()))
    {
      b.replace(at, cid.size(), etd);
      ++replaced;
    }
    spit(etd_like, b);
    check(replaced > 0 && etd.size() == cid.size(), "etd_like: CID terms replaced at equal length");
    FASTag::IndexedMzMLReader fast(etd_like);
    OnDiscMSExperiment od;
    check(fast.ok() && od.openFile(etd_like, false), "etd_like: both readers open it");
    Size electron = 0, ms2n = 0, bad = 0;
    for (Size i = 0; fast.ok() && i < std::min<Size>(fast.getNrSpectra(), od.getNrSpectra()); ++i)
    {
      const MSSpectrum g = fast.getSpectrumMetadata(i), w = od.getSpectrum(i);
      if (w.getMSLevel() != 2) continue;
      ++ms2n;
      const IS::Activation ag = IS::activationClass(g), aw = IS::activationClass(w);
      if (ag != aw) ++bad;
      if (ag == IS::Activation::Electron) ++electron;
    }
    check(ms2n > 0 && bad == 0 && electron == ms2n,
          "etd_like: the fast activation class equals OnDisc's, all electron (" + std::to_string(electron) + " of " +
              std::to_string(ms2n) + ", " + std::to_string(bad) + " differ)");
    metadata_vs_openms(etd_like, "etd_like");

    const std::string groups =
        "<referenceableParamGroup id=\"pg_etd\">\n" + cv("MS:1000598", "electron transfer dissociation") +
        "</referenceableParamGroup>\n"
        "<referenceableParamGroup id=\"pg_ethcd2\">\n" + cv("MS:1000598", "electron transfer dissociation") +
        cv("MS:1002678", "supplemental beam-type collision-induced dissociation") + "</referenceableParamGroup>\n";
    const auto prec = [&](const std::string& mz, const std::string& act) {
      return "<precursorList count=\"1\">\n<precursor>\n<selectedIonList count=\"1\">\n<selectedIon>\n" +
             cv("MS:1000744", "selected ion m/z", mz, "MS:1000040") + cv("MS:1000041", "charge state", "3") +
             "</selectedIon>\n</selectedIonList>\n<activation>\n" + act + "</activation>\n</precursor>\n</precursorList>\n";
    };
    const std::string ms2 = cv("MS:1000511", "ms level", "2");
    std::vector<std::string> sp;
    sp.push_back(param_spectrum(0, cv("MS:1000511", "ms level", "1"), "", ""));
    sp.push_back(param_spectrum(1, ms2, "", prec("500.25", ::ref("pg_etd"))));
    sp.push_back(param_spectrum(2, ms2, "", prec("600.25", ::ref("pg_ethcd2"))));
    sp.push_back(param_spectrum(3, ms2, cv("MS:1000512", "filter string", "ITMS + c NSI d Full ms2 700.25@etd66.67 [50.00-2000.00]"),
                                prec("700.25", "")));
    sp.push_back(param_spectrum(4, ms2, "", prec("800.25", cv("MS:1000133", "collision-induced dissociation"))));
    sp.push_back(param_spectrum(5, ms2, "", prec("900.25", ::ref("pg_etd") + cv("MS:1000422", "beam-type collision-induced dissociation"))));
    const std::string pgf = tmp + "/fastag_etd_paramgroup.mzML";
    check(write_group_mzml(indexed, pgf, groups, sp), "etd_paramgroup: written");
    PeakMap want;
    try { MzMLFile().load(pgf, want); }
    catch (const Exception::BaseException& e) { check(false, std::string("etd_paramgroup: OpenMS loads it (") + e.what() + ")"); }
    FASTag::IndexedMzMLReader r(pgf);
    const IS::Activation expect[6] = {IS::Activation::Unknown, IS::Activation::Electron, IS::Activation::Hybrid,
                                      IS::Activation::Electron, IS::Activation::Collisional, IS::Activation::Hybrid};
    check(r.ok() && r.getNrSpectra() == 6 && want.size() == 6, "etd_paramgroup: 6 spectra on both sides");
    for (Size i = 0; r.ok() && i < 6 && i < want.size(); ++i)
    {
      const IS::Activation ag = IS::activationClass(r.getSpectrumMetadata(i)), aw = IS::activationClass(want[i]);
      check(ag == aw && ag == expect[i], "etd_paramgroup spectrum " + std::to_string(i) + ": " +
                                             IS::activationName(ag) + " fast, " + IS::activationName(aw) +
                                             " OpenMS, " + IS::activationName(expect[i]) + " expected");
    }
    metadata_vs_openms(pgf, "etd_paramgroup");
  }

  // The fields 1.11 already read stay as 1.11 reads them when they are only
  // in a param group (byte-identical tags; resolving them is a separate,
  // declared output change). OpenMS must resolve each, or the fixture
  // proves nothing.
  {
    const std::string pin = tmp + "/fastag_paramgroups_pinned.mzML";
    check(write_pinned_fixture(indexed, pin), "write the pinned param-group fixture");
    PeakMap want;
    try { MzMLFile().load(pin, want); }
    catch (const Exception::BaseException& e) { check(false, std::string("pinned: OpenMS loads the file (") + e.what() + ")"); }
    FASTag::IndexedMzMLReader r(pin);
    check(r.ok() && r.getNrSpectra() == 5 && want.size() == 5, "pinned: 5 spectra on both sides");
    if (r.ok() && r.getNrSpectra() == 5 && want.size() == 5)
    {
      const MSSpectrum g1 = r.getSpectrum(1), g2 = r.getSpectrum(2), g3 = r.getSpectrum(3), g4 = r.getSpectrum(4);
      check(want[1].getMSLevel() == 2, "pinned: OpenMS takes the MS level from a group");
      // Not read, the spectrum keeps MSSpectrum's default level 1: not an
      // MS2, not decoded, not tagged.
      check(g1.getMSLevel() == 1 && g1.empty(), "pinned: an MS level only in a group is not read (1.11)");
      check(r.getSpectrumMetadata(1).getMSLevel() == 1, "pinned: nor by getSpectrumMetadata (1.11)");
      check(!want[2].getPrecursors().empty() && want[2].getPrecursors()[0].getCharge() == 3,
            "pinned: OpenMS takes the charge from a group");
      check(g2.getPrecursors().size() == 1 && g2.getPrecursors()[0].getCharge() == 0 &&
                g2.getPrecursors()[0].getMZ() == 512.25,
            "pinned: a charge only in a group is not read (1.11)");
      check(!want[3].getPrecursors().empty() && want[3].getPrecursors()[0].getIsolationWindowLowerOffset() == 1.0 &&
                want[3].getPrecursors()[0].getIsolationWindowUpperOffset() == 1.5,
            "pinned: OpenMS takes the isolation offsets from a group");
      check(g3.getPrecursors().size() == 1 && g3.getPrecursors()[0].getIsolationWindowLowerOffset() == 0 &&
                g3.getPrecursors()[0].getIsolationWindowUpperOffset() == 0 && g3.getPrecursors()[0].getMZ() == 612.3,
            "pinned: isolation offsets only in a group are not read (1.11)");
      // The step-0 target meta value does take the group's target.
      check(g3.getPrecursors().size() == 1 &&
                g3.getPrecursors()[0].metaValueExists("isolation window target m/z") &&
                double(g3.getPrecursors()[0].getMetaValue("isolation window target m/z")) == 612.0,
            "pinned: the isolation-target meta value is resolved from a group (step 0)");
      check(!want[4].getPrecursors().empty() && std::fabs(want[4].getPrecursors()[0].getMZ() - 700.75) < 1e-9 &&
                want[4].getPrecursors()[0].getIntensity() == 1234.0f,
            "pinned: OpenMS takes the selected-ion m/z and intensity from a group");
      check(g4.getPrecursors().size() == 1 && g4.getPrecursors()[0].getMZ() == 700.5 &&
                g4.getPrecursors()[0].getIntensity() == 0.0f && g4.getPrecursors()[0].getCharge() == 2,
            "pinned: a selected-ion m/z and intensity only in a group are not read; the target is the m/z (1.11)");
    }
  }
  for (int a = 2; a < argc; ++a) metadata_vs_openms(argv[a], std::string("step 0: ") + argv[a]);

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
    // MS-Numpress, decoded with OpenMS's own functions: m/z alone, and all
    // three arrays of a timsTOF conversion (m/z, intensity, "Ion Mobility").
    {
      using NP = MSNumpressCoder;
      const std::string f = rewrite_encoded(fixture, tmp + "/fastag_enc_numpress.mzML", true, false, true, NP::LINEAR);
      check(!f.empty(), "numpress fixture written");
      if (!f.empty()) direct_vs_openms(f, "direct: numpress linear m/z", true);
      for (const bool zlib : {false, true})
        for (const NP::NumpressCompression other : {NP::LINEAR, NP::PIC, NP::SLOF})
        {
          const std::string tag = std::string("numpress linear+") + (other == NP::LINEAR ? "linear" : other == NP::PIC ? "pic" : "slof") +
                                  (zlib ? "+zlib" : "") + " with ion mobility";
          const std::string g = rewrite_encoded(fixture, tmp + "/fastag_enc_np" + std::to_string(int(other)) + (zlib ? "z" : "") + ".mzML",
                                                zlib, false, false, NP::LINEAR, other);
          check(!g.empty(), tag + ": fixture written");
          if (g.empty()) continue;
          check(slurp(g).find("value=\"Ion Mobility\"") != std::string::npos && slurp(g).find("MS-Numpress") != std::string::npos,
                tag + ": the file has a Numpress non-standard array");
          direct_vs_openms(g, "direct: " + tag, true);
        }
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
    const std::string pad(37, 'x'); // more plain bytes than one 16-byte scanner step
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
        // The one-pass scanner's byte classes and 16-byte steps: each defect
        // also placed after a run of plain bytes longer than one step.
        {"UTF-16 surrogate in UTF-8", edit(good, "value=\"plain\"", "value=\"" + pad + "\xed\xa0\x80\"")},
        {"overlong UTF-8", edit(good, "value=\"plain\"", "value=\"" + pad + "\xe0\x80\xaf\"")},
        {"overlong 2-byte UTF-8", edit(good, "value=\"plain\"", "value=\"\xc0\xbc\"")},
        {"U+FFFE in UTF-8", edit(good, "value=\"plain\"", "value=\"" + pad + "\xef\xbf\xbe\"")},
        {"code point above U+10FFFF", edit(good, "value=\"plain\"", "value=\"\xf4\x90\x80\x80\"")},
        {"truncated UTF-8 before the quote", edit(good, "value=\"plain\"", "value=\"" + pad + "\xe2\x82\"")},
        {"character reference to U+FFFE", edit(good, "value=\"plain\"", "value=\"&#xFFFE;\"")},
        {"character reference to a surrogate", edit(good, "value=\"plain\"", "value=\"&#xD800;\"")},
        {"control character in a value", edit(good, "value=\"plain\"", "value=\"" + pad + "\x01\"")},
        {"control character in text", edit(good, "</scan>", pad + "\x1f</scan>")},
        {"NUL in text", edit(good, "</scan>", pad + std::string(1, '\0') + "</scan>")},
        {"'<' in a value", edit(good, "value=\"plain\"", "value=\"" + pad + "<\"")},
        {"']]>' after plain text", edit(good, "</scan>", pad + "]]></scan>")},
        {"duplicate attribute, other quotes", edit(good, "value=\"plain\"", "value=\"plain\" value='plain'")},
        {"attribute without a value", edit(good, "<scan>", "<scan x>")},
        {"unquoted attribute value", edit(good, "<scan>", "<scan x=1>")},
        {"tag that does not end", good.substr(0, good.find("<scan>") + 5)},
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
        {"UTF-8 after plain bytes", edit(good, "value=\"plain\"", "value=\"" + pad + "\xf4\x8f\xbf\xbf" + pad + "\xc2\xb5\"")},
        {"'>', ']]>' and the other quote in a value", edit(good, "value=\"plain\"", "value=\"" + pad + "a>b]]>c'\"")},
        {"character reference to U+10FFFF", edit(good, "value=\"plain\"", "value=\"&#x10FFFF;\"")},
        {"tabs and line breaks in text", edit(good, "</scan>", pad + "\t\r\n" + pad + "</scan>")},
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
