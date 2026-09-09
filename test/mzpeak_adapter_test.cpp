// The mzPeak adapter, field by field.
//
// test/mzpeak_roundtrip.sh proves the TOOL gives byte-identical tags from an
// archive it wrote and from the mzML it wrote it from. That is the property a
// user sees, and it is blind to a whole class of writer/reader defects: the
// tagger ranks intensities rather than reading them, consumes one precursor's
// m/z and charge, and never looks at retention time, polarity, the isolation
// window or a precursor's intensity. Halving every intensity, dropping the
// second precursor or zeroing every RT leaves the tags exactly as they were.
//
// So this links the same adapter object the tool ships (fastag_mzpeak),
// writes the fixture through MzPeakSpectrumWriter, reads it back through
// OnDiscMzPeakExperiment and compares every field the adapter claims to
// carry, exactly where the format stores the exact type (m/z double,
// intensity float32, charge, ids) and to float32 where it narrows on purpose
// (isolation offsets, precursor intensity). Retention time is stored in
// minutes and read back in seconds, so it gets a 1e-6 relative tolerance.
//
// The fixture (139 ion-trap MS2) carries neither a precursor intensity nor a
// second precursor, so both are planted on a few spectra first; a path the
// fixture never exercises is a path the test cannot fail.
//
// Also here: the FASTAG_MZPEAK_POINTS_PER_ROW_GROUP knob (a multi-row-group
// archive reads back identically; junk is refused), and the run-metadata
// mapping -- an mzML-origin archive carries the schema's "ionsource" and a
// run id, and legacy raw metadata with the old spelling and no id is
// normalised before it is written again.
//
// Exit 77 (ctest SKIP) when the fixture is not there.
#include "OnDiscMzPeakExperiment.h"

#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/MSSpectrum.h>
#include <OpenMS/METADATA/ExperimentalSettings.h>
#include <OpenMS/METADATA/Precursor.h>

#include <boost/json.hpp>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <set>
#include <string>
#include <vector>

using namespace OpenMS;
namespace fs = std::filesystem;
namespace json = boost::json;

namespace
{
  int g_fail = 0;
  int g_ok = 0;

  void check(bool ok, const std::string& what)
  {
    if (ok) { ++g_ok; return; }
    ++g_fail;
    std::printf("  FAIL %s\n", what.c_str());
  }

  void setEnv(const char* key, const char* value)
  {
#ifdef _WIN32
    _putenv_s(key, value);
#else
    setenv(key, value, 1);
#endif
  }
  void unsetEnv(const char* key)
  {
#ifdef _WIN32
    _putenv_s(key, "");
#else
    unsetenv(key);
#endif
  }

  std::string str(double v)
  {
    char b[64];
    std::snprintf(b, sizeof b, "%.17g", v);
    return b;
  }

  /// Every field the adapter maps, want (as loaded by OpenMS from the mzML,
  /// plus what main() planted) against got (read back from the archive).
  void compareSpectrum(const MSSpectrum& want, const MSSpectrum& got, std::size_t i)
  {
    const std::string tag = "spectrum " + std::to_string(i) + " '" + want.getNativeID() + "'";
    check(got.getNativeID() == want.getNativeID(), tag + ": native id read back as '" + got.getNativeID() + "'");
    check(got.getMSLevel() == want.getMSLevel(), tag + ": ms level " + std::to_string(got.getMSLevel()));
    check(std::fabs(got.getRT() - want.getRT()) <= 1e-6 * std::max(1.0, std::fabs(want.getRT())),
          tag + ": RT " + str(got.getRT()) + " want " + str(want.getRT()));
    check(got.getInstrumentSettings().getPolarity() == want.getInstrumentSettings().getPolarity(),
          tag + ": polarity");
    check(got.size() == want.size(),
          tag + ": " + std::to_string(got.size()) + " peaks, want " + std::to_string(want.size()));
    if (got.size() == want.size())
    {
      std::size_t bad_mz = 0, bad_int = 0, first_bad = 0;
      for (std::size_t k = 0; k < want.size(); ++k)
      {
        // Exact: the format stores m/z as float64 and intensity as float32,
        // and OpenMS holds exactly those types, so nothing may move.
        const bool mz_ok = got[k].getMZ() == want[k].getMZ();
        const bool in_ok = got[k].getIntensity() == want[k].getIntensity();
        if (!mz_ok) { if (!bad_mz && !bad_int) first_bad = k; ++bad_mz; }
        if (!in_ok) { if (!bad_mz && !bad_int) first_bad = k; ++bad_int; }
      }
      check(bad_mz == 0, tag + ": " + std::to_string(bad_mz) + " m/z values differ (first at peak "
                             + std::to_string(first_bad) + ": " + str(got[first_bad].getMZ())
                             + " want " + str(want[first_bad].getMZ()) + ")");
      check(bad_int == 0, tag + ": " + std::to_string(bad_int) + " intensities differ (first at peak "
                              + std::to_string(first_bad) + ": " + str(got[first_bad].getIntensity())
                              + " want " + str(want[first_bad].getIntensity()) + ")");
    }
    const auto& wp = want.getPrecursors();
    const auto& gp = got.getPrecursors();
    check(gp.size() == wp.size(), tag + ": " + std::to_string(gp.size()) + " precursors, want "
                                      + std::to_string(wp.size()));
    for (std::size_t k = 0; k < std::min(wp.size(), gp.size()); ++k)
    {
      const std::string ptag = tag + " precursor " + std::to_string(k);
      check(gp[k].getMZ() == wp[k].getMZ(), ptag + ": m/z " + str(gp[k].getMZ()) + " want " + str(wp[k].getMZ()));
      check(gp[k].getCharge() == wp[k].getCharge(), ptag + ": charge " + std::to_string(gp[k].getCharge())
                                                        + " want " + std::to_string(wp[k].getCharge()));
      // Stored as float32 on purpose (the format's isolation-window columns),
      // so the comparison is at that precision.
      check(static_cast<float>(gp[k].getIsolationWindowLowerOffset())
                == static_cast<float>(wp[k].getIsolationWindowLowerOffset()),
            ptag + ": isolation lower offset");
      check(static_cast<float>(gp[k].getIsolationWindowUpperOffset())
                == static_cast<float>(wp[k].getIsolationWindowUpperOffset()),
            ptag + ": isolation upper offset");
      check(static_cast<float>(gp[k].getIntensity()) == static_cast<float>(wp[k].getIntensity()),
            ptag + ": intensity " + str(gp[k].getIntensity()) + " want " + str(wp[k].getIntensity()));
    }
  }

  /// Write @p exp through the streaming writer exactly as -out_spectra does.
  void writeArchive(const fs::path& path, const PeakMap& exp)
  {
    FASTag::MzPeakSpectrumWriter writer(path.string(), exp.getExperimentalSettings(), &exp);
    for (const MSSpectrum& s : exp) writer.add(s);
    writer.finish();
  }

  /// Read the archive and compare every spectrum with @p exp. Returns the
  /// reader so callers can ask it about the layout.
  std::unique_ptr<FASTag::OnDiscMzPeakExperiment> readAndCompare(const fs::path& path, const PeakMap& exp,
                                                                  const std::string& label)
  {
    std::unique_ptr<FASTag::OnDiscMzPeakExperiment> rd;
    try
    {
      rd = std::make_unique<FASTag::OnDiscMzPeakExperiment>(path.string());
    }
    catch (const Exception::BaseException& e)
    {
      check(false, label + ": cannot open the archive FASTag just wrote: " + std::string(e.what()));
      return rd;
    }
    check(rd->getNrSpectra() == exp.size(), label + ": archive holds " + std::to_string(rd->getNrSpectra())
                                                + " spectra, wrote " + std::to_string(exp.size()));
    std::set<std::string> ids_want, ids_got;
    for (const MSSpectrum& s : exp) ids_want.insert(s.getNativeID());
    const std::size_t n = std::min<std::size_t>(rd->getNrSpectra(), exp.size());
    for (std::size_t i = 0; i < n; ++i)
    {
      const MSSpectrum got = rd->getSpectrum(i);
      ids_got.insert(got.getNativeID());
      compareSpectrum(exp[i], got, i);
    }
    check(ids_got == ids_want, label + ": the set of native ids differs from what was written");
    return rd;
  }

  json::object rawMetadata(const ExperimentalSettings& es)
  {
    if (!es.metaValueExists(FASTag::kRawMetaKey)) return {};
    return json::parse(std::string(es.getMetaValue(FASTag::kRawMetaKey).toString())).as_object();
  }

  std::string firstComponentType(const json::object& o)
  {
    const auto* ics = o.if_contains("instrument_configuration_list");
    if (!ics || !ics->is_array() || ics->as_array().empty()) return "<no instrument_configuration_list>";
    const auto* comps = ics->as_array()[0].as_object().if_contains("components");
    if (!comps || !comps->is_array() || comps->as_array().empty()) return "<no components>";
    const auto* t = comps->as_array()[0].as_object().if_contains("component_type");
    return t && t->is_string() ? std::string(t->as_string()) : "<no component_type>";
  }

  std::string runId(const json::object& o)
  {
    const auto* run = o.if_contains("run");
    if (!run || !run->is_object()) return "<no run>";
    const auto* id = run->as_object().if_contains("id");
    return id && id->is_string() ? std::string(id->as_string()) : "<no id>";
  }
}

int main()
{
  const std::string fixture = std::string(FASTAG_TEST_DATA) + "/Ecoli_MS2_small.mzML";
  if (!fs::exists(fixture))
  {
    std::printf("SKIP: fixture not found: %s\n", fixture.c_str());
    return 77;
  }
  PeakMap exp;
  MzMLFile().load(fixture, exp);
  if (exp.empty())
  {
    std::printf("SKIP: fixture holds no spectra\n");
    return 77;
  }
  std::printf("fixture: %zu spectra\n", static_cast<std::size_t>(exp.size()));

  // Plant what the fixture lacks. A selected-ion intensity on three spectra
  // (the writer emits it only when > 0), and a second precursor with its own
  // window on one -- a DIA-style frame, which the adapter maps to one OpenMS
  // Precursor per selected ion.
  std::size_t planted_intensity = 0, planted_second = 0;
  for (const std::size_t i : {0u, 7u, 50u})
  {
    if (i < exp.size() && !exp[i].getPrecursors().empty())
    {
      exp[i].getPrecursors()[0].setIntensity(1234.5f + static_cast<float>(i));
      ++planted_intensity;
    }
  }
  if (exp.size() > 3 && !exp[3].getPrecursors().empty())
  {
    Precursor second;
    second.setMZ(500.25);
    second.setCharge(3);
    second.setIsolationWindowLowerOffset(0.5);
    second.setIsolationWindowUpperOffset(0.75);
    second.setIntensity(42.0f);
    exp[3].getPrecursors().push_back(second);
    ++planted_second;
  }
  std::printf("planted: %zu precursor intensities, %zu second precursors\n", planted_intensity, planted_second);

  const fs::path dir = fs::temp_directory_path()
      / ("fastag-mzpeak-adapter-"
         + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
  fs::create_directories(dir);
  unsetEnv("FASTAG_MZPEAK_POINTS_PER_ROW_GROUP");

  try
  {
    // 1. Default layout: one row group for a fixture this size.
    const fs::path a = dir / "default.mzpeak";
    writeArchive(a, exp);
    if (auto rd = readAndCompare(a, exp, "default layout"))
    {
      check(rd->rowGroupCount() == 1, "default layout: " + std::to_string(rd->rowGroupCount())
                                          + " row groups, want 1 (36,050 points < 2^20)");
      // Run metadata, mzML origin: what the validator rejected before the fix.
      const json::object raw = rawMetadata(rd->getMetaData());
      check(!raw.empty(), "default layout: the reader kept the archive's raw run metadata");
      check(firstComponentType(raw) == "ionsource",
            "default layout: first instrument component is '" + firstComponentType(raw) + "', want 'ionsource'");
      check(runId(raw) == "ru_0", "default layout: run id is '" + runId(raw) + "', want 'ru_0'");
      // ...and the reader still maps that component back to an OpenMS ion source.
      check(rd->getMetaData().getInstrument().getIonSources().size() == 1,
            "default layout: 'ionsource' maps back to one OpenMS IonSource");
    }

    // 2. Multi-row-group layout through the knob: same content, several
    //    groups, so the reader's group-boundary planning is what runs.
    setEnv("FASTAG_MZPEAK_POINTS_PER_ROW_GROUP", "4096");
    const fs::path b = dir / "small-groups.mzpeak";
    writeArchive(b, exp);
    unsetEnv("FASTAG_MZPEAK_POINTS_PER_ROW_GROUP");
    if (auto rd = readAndCompare(b, exp, "4096-point groups"))
    {
      check(rd->rowGroupCount() > 1, "4096-point groups: " + std::to_string(rd->rowGroupCount())
                                         + " row groups, want > 1");
      std::printf("4096-point groups: %zu row groups\n", rd->rowGroupCount());
    }

    // 3. Junk in the knob is refused, not truncated to something plausible.
    setEnv("FASTAG_MZPEAK_POINTS_PER_ROW_GROUP", "12abc");
    const fs::path c = dir / "junk-knob.mzpeak";
    writeArchive(c, exp);
    unsetEnv("FASTAG_MZPEAK_POINTS_PER_ROW_GROUP");
    try
    {
      FASTag::OnDiscMzPeakExperiment rd(c.string());
      check(rd.rowGroupCount() == 1, "junk knob '12abc': " + std::to_string(rd.rowGroupCount())
                                         + " row groups, want the default layout (1)");
    }
    catch (const Exception::BaseException& e)
    {
      check(false, std::string("junk knob: cannot open: ") + e.what());
    }

    // 4. Legacy raw metadata (every archive FASTag wrote before the fix) is
    //    normalised when written again, so an mzpeak -> mzpeak run does not
    //    carry the two schema violations forward.
    {
      PeakMap one;
      one.addSpectrum(exp[0]);
      one.getExperimentalSettings().setMetaValue(
          FASTag::kRawMetaKey,
          String(R"({"run":{"start_time":"2010-02-22T16:21:17","default_instrument_id":0},)"
                 R"("instrument_configuration_list":[{"id":0,"software_reference":"x",)"
                 R"("parameters":[],"components":[{"component_type":"source","order":1,"parameters":[]}]}]})"));
      const fs::path d = dir / "legacy-metadata.mzpeak";
      writeArchive(d, one);
      try
      {
        FASTag::OnDiscMzPeakExperiment rd(d.string());
        const json::object raw = rawMetadata(rd.getMetaData());
        check(firstComponentType(raw) == "ionsource",
              "legacy raw metadata: component_type is '" + firstComponentType(raw) + "', want 'ionsource'");
        check(runId(raw) == "ru_0", "legacy raw metadata: run id is '" + runId(raw) + "', want 'ru_0'");
        // The rest of the raw block survived untouched.
        const auto* run = raw.if_contains("run");
        check(run && run->is_object() && run->as_object().contains("start_time"),
              "legacy raw metadata: start_time carried through");
      }
      catch (const Exception::BaseException& e)
      {
        check(false, std::string("legacy raw metadata: cannot open: ") + e.what());
      }
    }
  }
  catch (const Exception::BaseException& e)
  {
    check(false, std::string("adapter threw: ") + e.what());
  }
  catch (const std::exception& e)
  {
    check(false, std::string("threw: ") + e.what());
  }

  std::error_code ec;
  fs::remove_all(dir, ec);

  if (g_fail)
  {
    std::printf("mzpeak_adapter_test: %d checks FAILED (%d passed)\n", g_fail, g_ok);
    return 1;
  }
  std::printf("mzpeak_adapter_test: all %d checks passed\n", g_ok);
  return 0;
}
