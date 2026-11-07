// -probe_input and -dump_spectrum (1.12 G1). See InputProbe.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "InputProbe.h"

#include "AcquisitionProbe.h"
#include "IndexedMzMLReader.h"
#include "IonSeries.h"
#include "MgfReader.h"
#include "MzPeakStream.h"
#include "NumFormat.h"
#include "Shortlist.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/FORMAT/FASTAFile.h>
#include <OpenMS/FORMAT/FileHandler.h>
#include <OpenMS/FORMAT/FileNameUtils.h>
#include <OpenMS/FORMAT/FileTypes.h>
#include <OpenMS/FORMAT/MzMLFile.h>
#include <OpenMS/FORMAT/MzPeakFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/KERNEL/OnDiscMSExperiment.h>
#include <OpenMS/METADATA/MassAnalyzer.h>
#include <OpenMS/PROCESSING/CENTROIDING/PeakPickerHiRes.h>
#include <OpenMS/SYSTEM/File.h>

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <functional>
#include <memory>

using namespace OpenMS;

namespace FASTag::Probe
{
  // ---- JSON ---------------------------------------------------------------

  std::string jsonString(std::string_view s)
  {
    std::string o;
    o.reserve(s.size() + 2);
    o += '"';
    for (const char ch : s)
    {
      const unsigned char c = static_cast<unsigned char>(ch);
      switch (c)
      {
        case '"': o += "\\\""; break;
        case '\\': o += "\\\\"; break;
        case '\n': o += "\\n"; break;
        case '\r': o += "\\r"; break;
        case '\t': o += "\\t"; break;
        default:
          if (c < 0x20 || c == 0x7f)
          {
            char u[8];
            std::snprintf(u, sizeof u, "\\u%04x", c);
            o += u;
          }
          else o += ch;
      }
    }
    o += '"';
    return o;
  }

  void appendJsonNumber(std::string& buf, double v)
  {
    if (!std::isfinite(v)) { buf += "null"; return; }
    if (v == 0) { buf += '0'; return; }  // also -0, which JSON spells 0 here
    appendShortest(buf, v);
  }

  void appendJsonNumber(std::string& buf, float v)
  {
    if (!std::isfinite(v)) { buf += "null"; return; }
    if (v == 0) { buf += '0'; return; }
    char num[32];
    buf.append(num, std::to_chars(num, num + sizeof num, v).ptr);
  }

  JsonObject::JsonObject(const char* record)
  {
    buf_ = "{\"record\":";
    buf_ += jsonString(record);
  }

  void JsonObject::key_(const char* key)
  {
    buf_ += ',';
    buf_ += jsonString(key);
    buf_ += ':';
  }

  JsonObject& JsonObject::str(const char* key, std::string_view v)
  {
    key_(key);
    buf_ += jsonString(v);
    return *this;
  }

  JsonObject& JsonObject::strOrNull(const char* key, std::string_view v)
  {
    key_(key);
    buf_ += v.empty() ? std::string("null") : jsonString(v);
    return *this;
  }

  JsonObject& JsonObject::num(const char* key, double v)
  {
    key_(key);
    appendJsonNumber(buf_, v);
    return *this;
  }

  JsonObject& JsonObject::count(const char* key, std::size_t v)
  {
    key_(key);
    appendNum(buf_, v);
    return *this;
  }

  JsonObject& JsonObject::integer(const char* key, long long v)
  {
    key_(key);
    appendNum(buf_, v);
    return *this;
  }

  JsonObject& JsonObject::boolean(const char* key, bool v)
  {
    key_(key);
    buf_ += v ? "true" : "false";
    return *this;
  }

  JsonObject& JsonObject::null(const char* key)
  {
    key_(key);
    buf_ += "null";
    return *this;
  }

  JsonObject& JsonObject::raw(const char* key, std::string_view json)
  {
    key_(key);
    buf_ += json;
    return *this;
  }

  std::string JsonObject::line() const { return buf_ + "}\n"; }

  // ---- mzML header --------------------------------------------------------

  namespace
  {
    /// Value of attribute @p name in the tag starting at @p at ("" if none).
    std::string attr(std::string_view xml, std::size_t at, std::string_view name)
    {
      const std::size_t end = xml.find('>', at);
      const std::string_view tag = xml.substr(at, end == std::string_view::npos ? std::string_view::npos : end - at);
      for (std::size_t k = tag.find(name); k != std::string_view::npos; k = tag.find(name, k + 1))
      {
        // a whole attribute name: preceded by whitespace, followed by =
        if (k == 0 || !(tag[k - 1] == ' ' || tag[k - 1] == '\t' || tag[k - 1] == '\n' || tag[k - 1] == '\r')) continue;
        std::size_t e = k + name.size();
        while (e < tag.size() && (tag[e] == ' ' || tag[e] == '\t')) ++e;
        if (e >= tag.size() || tag[e] != '=') continue;
        ++e;
        while (e < tag.size() && (tag[e] == ' ' || tag[e] == '\t')) ++e;
        if (e >= tag.size() || (tag[e] != '"' && tag[e] != '\'')) continue;
        const char q = tag[e];
        const std::size_t v = e + 1;
        const std::size_t ve = tag.find(q, v);
        if (ve == std::string_view::npos) return {};
        return std::string(tag.substr(v, ve - v));
      }
      return {};
    }

    /// Position of the next element <@p name (followed by a name end).
    std::size_t findElement(std::string_view xml, std::string_view name, std::size_t from, std::size_t to)
    {
      const std::string open = "<" + std::string(name);
      for (std::size_t k = xml.find(open, from); k != std::string_view::npos && k < to; k = xml.find(open, k + 1))
      {
        const std::size_t e = k + open.size();
        if (e < xml.size() && (xml[e] == ' ' || xml[e] == '>' || xml[e] == '/' || xml[e] == '\t' || xml[e] == '\n' ||
                               xml[e] == '\r'))
          return k;
      }
      return std::string_view::npos;
    }
  }

  bool isAnalyzerAccession(std::string_view a)
  {
    // MS:1000443 mass analyzer type and its children (psi-ms.obo).
    static const std::array<std::string_view, 18> kAnalyzers = {
        "MS:1000443", "MS:1000078", "MS:1000079", "MS:1000080", "MS:1000081", "MS:1000082",
        "MS:1000083", "MS:1000084", "MS:1000254", "MS:1000264", "MS:1000284", "MS:1000288",
        "MS:1000291", "MS:1000484", "MS:1000139", "MS:1002806", "MS:1003379", "MS:1003378"};
    return std::find(kAnalyzers.begin(), kAnalyzers.end(), a) != kAnalyzers.end();
  }

  MzmlHeader parseMzmlHeader(std::string_view xml)
  {
    MzmlHeader h;
    const std::size_t n = xml.size();
    for (std::size_t ic = findElement(xml, "instrumentConfiguration", 0, n); ic != std::string_view::npos;
         ic = findElement(xml, "instrumentConfiguration", ic + 1, n))
    {
      const std::string id = attr(xml, ic, "id");
      const std::size_t end = std::min(n, xml.find("</instrumentConfiguration>", ic));
      std::string name;
      int best_order = -1;
      for (std::size_t a = findElement(xml, "analyzer", ic, end); a != std::string_view::npos;
           a = findElement(xml, "analyzer", a + 1, end))
      {
        const std::size_t ae = std::min(end, xml.find("</analyzer>", a));
        int order = 0;
        const std::string o = attr(xml, a, "order");
        std::from_chars(o.data(), o.data() + o.size(), order);
        for (std::size_t c = findElement(xml, "cvParam", a, ae); c != std::string_view::npos;
             c = findElement(xml, "cvParam", c + 1, ae))
        {
          if (!isAnalyzerAccession(attr(xml, c, "accession"))) continue;
          if (order >= best_order)
          {
            best_order = order;
            name = attr(xml, c, "name");
          }
          break;
        }
      }
      if (!id.empty()) h.analyzer_of[id] = name;
      if (end >= n) break;
    }
    if (const std::size_t run = findElement(xml, "run", 0, n); run != std::string_view::npos)
      h.default_config = attr(xml, run, "defaultInstrumentConfigurationRef");
    return h;
  }

  MzmlHeader readMzmlHeader(const std::string& path)
  {
    std::ifstream f(path, std::ios::binary);
    if (!f) return {};
    constexpr std::size_t kMax = 8u << 20, kStep = 1u << 16;
    std::string buf;
    while (buf.size() < kMax)
    {
      const std::size_t have = buf.size();
      buf.resize(have + kStep);
      f.read(buf.data() + have, static_cast<std::streamsize>(kStep));
      buf.resize(have + static_cast<std::size_t>(f.gcount()));
      // <run ...> precedes the spectrumList and carries the default ref.
      const std::size_t sl = buf.find("<spectrumList");
      if (sl != std::string::npos)
      {
        buf.resize(sl);
        break;
      }
      if (f.gcount() == 0) break;
    }
    return parseMzmlHeader(buf);
  }

  std::string scanConfigRef(std::string_view xml)
  {
    const std::size_t cut = std::min(xml.size(), xml.find("<binaryDataArrayList"));
    const std::size_t sl = findElement(xml, "scanList", 0, cut);
    if (sl == std::string_view::npos) return {};
    const std::size_t sc = findElement(xml, "scan", sl + 1, cut);
    if (sc == std::string_view::npos) return {};
    return attr(xml, sc, "instrumentConfigurationRef");
  }

  const char* indexStateName(bool has_index_list, bool rebuilt)
  {
    if (!has_index_list) return "absent";
    return rebuilt ? "stale" : "ok";
  }

  bool hasIndexListOffset(const std::string& path)
  {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return false;
    const std::streamoff size = f.tellg();
    const std::streamoff take = std::min<std::streamoff>(size, 4096);
    std::string tail(static_cast<std::size_t>(take), '\0');
    f.seekg(size - take);
    f.read(tail.data(), take);
    return tail.find("<indexListOffset>") != std::string::npos;
  }

  // ---- shared reader setup ------------------------------------------------

  namespace
  {
    enum class Kind
    {
      MzML,
      MzPeak,
      Mgf
    };

    bool isMzPeakPath(const std::string& p)
    {
      return FileHandler::getTypeByFileName(p) == FileTypes::MZPEAK || MzPeakFile::isMzPeak(p);
    }

    /// The input's kind as FASTag's run decides it, or Status::Unsupported.
    Status kindOf(const std::string& in, Kind& kind, std::string& error)
    {
      const bool mzpeak = isMzPeakPath(in);
      if (!mzpeak && FileNameUtils::hasCompressionSuffix(in))
      {
        error = "Input '" + in + "' is compressed; FASTag reads uncompressed input only. Decompress it first.";
        return Status::Unsupported;
      }
      if (mzpeak)
      {
        if (!MzPeakFile::isSupported())
        {
          error = "This build has no mzPeak support: the OpenMS it uses was built without it "
                  "(OPENMS_ENABLE_MZPEAK). Supply mzML.";
          return Status::Unsupported;
        }
        kind = Kind::MzPeak;
        return Status::Ok;
      }
      if (FileHandler::getTypeByFileName(in) == FileTypes::MGF)
      {
        kind = Kind::Mgf;
        return Status::Ok;
      }
      std::string lower = in;
      std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return std::tolower(c); });
      if (lower.size() >= 5 && lower.compare(lower.size() - 5, 5, ".mzml") == 0)
      {
        kind = Kind::MzML;
        return Status::Ok;
      }
      error = "Input '" + in + "' is neither .mzML, .mzpeak nor .mgf.";
      return Status::Unsupported;
    }

    const char* kindName(Kind k)
    {
      return k == Kind::MzML ? "mzML" : k == Kind::MzPeak ? "mzPeak" : "MGF";
    }

    /// The mzML readers, chosen as a run without -out_spectra chooses them.
    struct MzmlReaders
    {
      std::unique_ptr<FASTag::IndexedMzMLReader> fast;
      std::unique_ptr<OnDiscMSExperiment> ondisc;
      bool ondisc_ok = false;
      PeakMap exp;
      std::size_t n = 0;

      void open(const std::string& in)
      {
        auto candidate = std::make_unique<FASTag::IndexedMzMLReader>(in);
        if (candidate->ok() && candidate->reportsSpectrumMetadata())
        {
          fast = std::move(candidate);
          n = fast->getNrSpectra();
          return;
        }
        ondisc = std::make_unique<OnDiscMSExperiment>();
        if (ondisc->openFile(in))
        {
          ondisc_ok = true;
          n = ondisc->getNrSpectra();
          return;
        }
        FileHandler().loadExperiment(in, exp, {FileTypes::MZML});
        n = exp.size();
      }
    };

    std::string lowerCase(std::string s)
    {
      std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
      return s;
    }

    /// The name of the last analyser of an OpenMS Instrument (mzPeak).
    std::string lastAnalyzer(const Instrument& inst)
    {
      const MassAnalyzer* best = nullptr;
      for (const MassAnalyzer& a : inst.getMassAnalyzers())
        if (a.getType() != MassAnalyzer::AnalyzerType::ANALYZERNULL && (!best || a.getOrder() >= best->getOrder()))
          best = &a;
      if (!best) return {};
      return lowerCase(MassAnalyzer::NamesOfAnalyzerType[static_cast<std::size_t>(best->getType())]);
    }

    /// Reads [first, first + min(len, 16 KB)) of @p f.
    std::string readHead(std::ifstream& f, std::pair<std::uint64_t, std::uint64_t> range)
    {
      if (range.second <= range.first) return {};
      const std::uint64_t len = std::min<std::uint64_t>(range.second - range.first, 16384);
      std::string s(static_cast<std::size_t>(len), '\0');
      f.clear();
      f.seekg(static_cast<std::streamoff>(range.first));
      f.read(s.data(), static_cast<std::streamsize>(len));
      s.resize(static_cast<std::size_t>(f.gcount()));
      return s;
    }
  }

  // ---- -probe_input -------------------------------------------------------

  ProbeOutput probeInput(const std::string& in, const ProbeOptions& opt)
  {
    namespace Acq = FASTag::Acquisition;
    namespace IS = FASTag::IonSeries;
    ProbeOutput out;
    Kind kind = Kind::MzML;
    if ((out.status = kindOf(in, kind, out.error)) != Status::Ok) return out;
    const Acq::ProbeLimits lim = Acq::probeLimits(opt.probe_spectra);

    // What the passes below collect.
    std::string inst_name, inst_model, analyzer, analyzer_from;
    std::size_t ms1 = 0, ms2 = 0;
    std::vector<MSSpectrum> heads;           // the probed MS2, without peaks
    std::vector<std::string> head_configs;   // their scan's instrument configuration ("" = none)
    const char* index_state = "not_applicable";
    Acq::ProbeResult acq;
    try
    {
      Acq::ProbeSource src;
      src.n_total = 0;
      std::unique_ptr<FASTag::MgfReader> mgf;
      MzmlReaders mz;
      if (kind == Kind::MzPeak)
      {
        const MzPeakRunScan scan = scanMzPeakRun(in, lim, opt.mzpeak_threads);
        ms1 = scan.ms1;
        ms2 = scan.ms2;
        heads = scan.ms2_head;
        head_configs.assign(heads.size(), std::string());
        inst_name = scan.settings.getInstrument().getName();
        inst_model = scan.settings.getInstrument().getModel();
        analyzer = lastAnalyzer(scan.settings.getInstrument());
        if (!analyzer.empty()) analyzer_from = "run_default";
        src.mzpeak = true;
        src.mzpeak_threads = opt.mzpeak_threads;
      }
      else if (kind == Kind::Mgf)
      {
        try
        {
          mgf = std::make_unique<FASTag::MgfReader>(in);
        }
        catch (const Exception::FileEmpty&)
        {
          out.status = Status::Empty;
          out.error = "'" + in + "' contains no BEGIN IONS block; is it an MGF file?";
          return out;
        }
        catch (const Exception::FileNotReadable& e)
        {
          out.status = Status::NotReadable;
          out.error = e.what();
          return out;
        }
        // Every MGF block is an MS2 (MgfReader.h).
        ms2 = mgf->getNrSpectra();
        for (std::size_t i = 0; i < ms2 && heads.size() < lim.max_ms2 && i < lim.max_spectra; ++i)
        {
          MSSpectrum s;
          try
          {
            s = mgf->getSpectrum(i);
          }
          catch (const Exception::BaseException&)
          {
            // A block the tagging loop would report; its head counts as unknown.
            s = MSSpectrum();
            s.setMSLevel(2);
          }
          s.clear(false);
          heads.push_back(std::move(s));
        }
        head_configs.assign(heads.size(), std::string());
        src.mgf = mgf.get();
        src.n_total = ms2;
      }
      else
      {
        mz.open(in);
        // Run-level instrument, as -digest_out reads it (the header alone).
        try
        {
          PeakMap head;
          MzMLFile mf;
          mf.getOptions().setMetadataOnly(true);
          mf.load(in, head);
          inst_name = head.getInstrument().getName();
          inst_model = head.getInstrument().getModel();
        }
        catch (const Exception::BaseException&)
        {
        }
        const MzmlHeader header = readMzmlHeader(in);
        std::ifstream raw;
        if (mz.fast) raw.open(in, std::ios::binary);
        std::shared_ptr<PeakMap> od_meta = mz.ondisc_ok ? mz.ondisc->getMetaData() : nullptr;
        for (std::size_t i = 0; i < mz.n; ++i)
        {
          MSSpectrum s;
          if (mz.fast) s = mz.fast->getSpectrumMetadata(i);
          else if (od_meta) s = i < od_meta->size() ? (*od_meta)[i] : MSSpectrum();
          else s = mz.exp[i];
          if (s.getMSLevel() == 1) ++ms1;
          if (s.getMSLevel() != 2) continue;
          ++ms2;
          if (i >= lim.max_spectra || heads.size() >= lim.max_ms2) continue;
          s.clear(false);
          heads.push_back(std::move(s));
          head_configs.push_back(mz.fast ? scanConfigRef(readHead(raw, mz.fast->spectrumByteRange(i))) : std::string());
        }
        // The analyser most probed MS2 are read out in; the run's default
        // configuration for MS2 that name none.
        std::map<std::string, std::size_t> votes;
        bool from_scans = false;
        for (const std::string& ref : head_configs)
        {
          const std::string& cfg = ref.empty() ? header.default_config : ref;
          from_scans = from_scans || !ref.empty();
          const auto it = header.analyzer_of.find(cfg);
          if (it != header.analyzer_of.end() && !it->second.empty()) ++votes[it->second];
        }
        if (heads.empty() && !header.default_config.empty())
        {
          const auto it = header.analyzer_of.find(header.default_config);
          if (it != header.analyzer_of.end() && !it->second.empty()) votes[it->second] = 1;
        }
        std::size_t best = 0;
        for (const auto& [name, n] : votes)
          if (n > best) { best = n; analyzer = name; }
        if (!analyzer.empty()) analyzer_from = from_scans ? "spectra" : "run_default";
        // The index.
        const bool has_index = hasIndexListOffset(in);
        if (!has_index) index_state = "absent";
        else if (mz.fast) index_state = indexStateName(true, mz.fast->indexRebuilt());
        else index_state = mz.ondisc_ok ? "ok" : "stale";
        src.fastmz = mz.fast.get();
        if (mz.ondisc_ok) src.ondisc = mz.ondisc.get();
        else if (!mz.fast) src.exp = &mz.exp;
        src.n_total = mz.n;
      }
      acq = Acq::probeRun(in, src, opt.probe_spectra);
      if (!acq.ok)
      {
        out.status = Status::Corrupt;
        out.error = acq.error;
        return out;
      }
    }
    catch (const Exception::FileNotReadable& e)
    {
      out.status = Status::NotReadable;
      out.error = e.what();
      return out;
    }
    catch (const Exception::FileEmpty& e)
    {
      out.status = Status::Empty;
      out.error = e.what();
      return out;
    }
    catch (const Exception::BaseException& e)
    {
      out.status = Status::Corrupt;
      out.error = e.what();
      return out;
    }
    catch (const std::exception& e)
    {
      out.status = Status::Corrupt;
      out.error = e.what();
      return out;
    }

    // ---- the records
    std::string& j = out.jsonl;
    j += JsonObject("probe")
             .integer("format", kFormat)
             .str("version", opt.version)
             .str("input", in)
             .str("file_format", kindName(kind))
             .line();

    // Ion mobility of the probed MS2, by unit; the commonest names it.
    std::size_t im_vssc = 0, im_drift = 0, im_faims = 0;
    std::size_t centroid = 0, profile = 0, untyped = 0;
    IS::ActivationCounts act;
    for (const MSSpectrum& s : heads)
    {
      DriftTimeUnit unit = DriftTimeUnit::NONE;
      if (s.containsIMData()) unit = s.getIMData().second;
      else if (s.getDriftTime() != IMTypes::DRIFTTIME_NOT_SET) unit = s.getDriftTimeUnit();
      if (unit == DriftTimeUnit::VSSC) ++im_vssc;
      else if (unit == DriftTimeUnit::MILLISECOND) ++im_drift;
      else if (unit == DriftTimeUnit::FAIMS_COMPENSATION_VOLTAGE) ++im_faims;
      // MGF declares no type, and FASTag tags it as read: centroid.
      const SpectrumSettings::SpectrumType t =
          kind == Kind::Mgf ? SpectrumSettings::SpectrumType::CENTROID : s.SpectrumSettings::getType();
      if (t == SpectrumSettings::SpectrumType::CENTROID) ++centroid;
      else if (t == SpectrumSettings::SpectrumType::PROFILE) ++profile;
      else ++untyped;
      act.add(IS::activationClass(s));
    }
    const char* ion_mobility = nullptr;
    if (im_vssc + im_drift + im_faims > 0)
      ion_mobility = im_vssc >= im_drift && im_vssc >= im_faims ? "1/K0" : im_drift >= im_faims ? "drift" : "FAIMS";

    JsonObject inst("instrument");
    inst.strOrNull("name", inst_name).strOrNull("model", inst_model).strOrNull("ms2_analyzer", analyzer);
    inst.strOrNull("ms2_analyzer_from", analyzer_from);
    if (ion_mobility) inst.str("ion_mobility", ion_mobility);
    else inst.null("ion_mobility");
    j += inst.line();

    namespace FC = FASTag::Centroid;
    const FC::Input input = kind == Kind::MzPeak ? FC::Input::MzPeak : kind == Kind::Mgf ? FC::Input::Mgf : FC::Input::MzML;
    const FC::Policy policy = FC::policyFor(opt.pick_mode, input, opt.pick_unknown_type);
    const char* verdict = heads.empty()           ? "none"
                          : profile == 0 && untyped == 0 ? "centroid"
                          : centroid == 0 && untyped == 0 ? "profile"
                          : profile == 0 && centroid == 0 ? "unknown"
                                                          : "mixed";
    const char* mode_name = opt.pick_mode == FC::Mode::Auto ? "auto" : opt.pick_mode == FC::Mode::Off ? "off" : "legacy";
    j += JsonObject("spectra")
             .count("ms1", ms1)
             .count("ms2", ms2)
             .count("ms2_probed", heads.size())
             .count("ms2_centroid", centroid)
             .count("ms2_profile", profile)
             .count("ms2_type_unknown", untyped)
             .str("verdict", verdict)
             .str("pick_profile", mode_name)
             .boolean("will_pick", policy.pick && profile > 0)
             .boolean("may_pick_unknown", policy.pick && policy.unknown && untyped > 0)
             .line();

    j += JsonObject("activation")
             .count("of", act.total())
             .count("collisional", act.of(IS::Activation::Collisional))
             .count("electron", act.of(IS::Activation::Electron))
             .count("hybrid", act.of(IS::Activation::Hybrid))
             .count("unknown", act.of(IS::Activation::Unknown))
             .line();

    j += JsonObject("index").str("state", index_state).line();

    const Acq::AcqCall& c = acq.call;
    const bool refuse = c.mode == Acq::Mode::DIA && opt.acquisition_check == "refuse";
    JsonObject a("acquisition");
    a.str("mode", Acq::modeName(c)).str("why", c.why).boolean("warn", c.warn).boolean("refuse", refuse);
    a.str("check", opt.acquisition_check).count("ms2_probed", c.n_ms2).count("windows", c.n_win);
    a.num("median_width", c.median_width);
    j += a.line();

    if (!opt.fasta.empty())
    {
      JsonObject f("fasta");
      f.str("path", opt.fasta);
      try
      {
        std::vector<FASTAFile::FASTAEntry> entries;
        FASTAFile().load(opt.fasta, entries);
        std::size_t decoys = 0;
        std::map<std::string, std::size_t> by_affix;
        for (const FASTAFile::FASTAEntry& e : entries)
        {
          if (!FASTag::Shortlist::isDecoy(e.identifier, opt.decoy_affixes)) continue;
          ++decoys;
          for (const std::string& af : opt.decoy_affixes)
            if (FASTag::Shortlist::isDecoy(e.identifier, {af})) { ++by_affix[af]; break; }
        }
        std::string affix;
        std::size_t best = 0;
        for (const auto& [af, n] : by_affix)
          if (n > best) { best = n; affix = af; }
        f.count("proteins", entries.size()).count("decoys", decoys).strOrNull("decoy_affix", affix);
      }
      catch (const Exception::BaseException& e)
      {
        f.null("proteins").null("decoys").null("decoy_affix").str("error", e.what());
      }
      j += f.line();
    }
    j += JsonObject("end").line();
    return out;
  }

  // ---- -dump_spectrum ------------------------------------------------------

  std::string spectrumRecord(const MSSpectrum& spec, std::size_t index, bool picked, const Param& p)
  {
    const bool has_prec = !spec.getPrecursors().empty();
    const double prec_mz = has_prec ? spec.getPrecursors().front().getMZ() : 0.0;
    const int given = has_prec ? std::max(0, spec.getPrecursors().front().getCharge()) : 0;
    // What tag_one tags: an MS2 with peaks and a precursor.
    const bool tagged = spec.getMSLevel() == 2 && !spec.empty() && has_prec;
    const MSSpectrum peaks = tagged ? preparedPeaks(spec, prec_mz, given, p) : MSSpectrum();
    JsonObject o("spectrum");
    o.integer("format", kFormat).str("native_id", spec.getNativeID()).count("index", index);
    o.integer("ms_level", static_cast<long long>(spec.getMSLevel())).num("rt", spec.getRT());
    if (has_prec) o.num("precursor", prec_mz);
    else o.null("precursor");
    o.integer("charge", given > 0 ? given : 2).integer("charge_given", given);
    o.num("tolerance", p.frag_tol).str("tolerance_unit", p.tol_ppm ? "ppm" : "Da");
    o.boolean("picked", picked).boolean("deisotoped", p.deisotope).boolean("tagged", tagged);
    o.count("n_read", spec.size()).count("n", peaks.size());
    std::string mz = "[", in = "[";
    for (std::size_t i = 0; i < peaks.size(); ++i)
    {
      if (i) { mz += ','; in += ','; }
      appendJsonNumber(mz, peaks[i].getMZ());
      appendJsonNumber(in, peaks[i].getIntensity());
    }
    mz += ']';
    in += ']';
    o.raw("mz", mz).raw("int", in);
    return o.line();
  }

  DumpOutput dumpSpectrum(const std::string& in, const std::string& id, const DumpOptions& opt)
  {
    namespace FC = FASTag::Centroid;
    DumpOutput out;
    Kind kind = Kind::MzML;
    if ((out.status = kindOf(in, kind, out.error)) != Status::Ok) return out;
    MSSpectrum spec;
    std::size_t index = 0;
    int pick_result = 0;
    try
    {
      if (kind == Kind::MzPeak)
      {
        out.found = readMzPeakSpectrumById(in, opt.mzpeak_threads, id,
                                           FC::policyFor(opt.pick_mode, FC::Input::MzPeak, opt.pick_unknown_type),
                                           spec, index, pick_result);
      }
      else
      {
        std::function<MSSpectrum(std::size_t)> read, meta;
        std::size_t n = 0;
        std::unique_ptr<FASTag::MgfReader> mgf;
        MzmlReaders mz;
        if (kind == Kind::Mgf)
        {
          try
          {
            mgf = std::make_unique<FASTag::MgfReader>(in);
          }
          catch (const Exception::FileEmpty&)
          {
            out.status = Status::Empty;
            out.error = "'" + in + "' contains no BEGIN IONS block; is it an MGF file?";
            return out;
          }
          n = mgf->getNrSpectra();
          read = [&](std::size_t i) -> MSSpectrum { return mgf->getSpectrum(i); };
          meta = read;
        }
        else
        {
          mz.open(in);
          n = mz.n;
          std::shared_ptr<PeakMap> od_meta = mz.ondisc_ok ? mz.ondisc->getMetaData() : nullptr;
          read = [&](std::size_t i) -> MSSpectrum {
            if (mz.fast) return mz.fast->getSpectrum(i);
            if (mz.ondisc_ok) return mz.ondisc->getSpectrum(i);
            return mz.exp[i];
          };
          meta = [&, od_meta](std::size_t i) -> MSSpectrum {
            if (mz.fast) return mz.fast->getSpectrumMetadata(i);
            if (od_meta) return i < od_meta->size() ? (*od_meta)[i] : MSSpectrum();
            return mz.exp[i];
          };
        }
        // MGF native IDs are "index=<i>" (MgfReader.h): try that one first.
        std::size_t hint = n;
        if (kind == Kind::Mgf && id.rfind("index=", 0) == 0)
        {
          std::size_t v = 0;
          const char* b = id.data() + 6;
          const auto r = std::from_chars(b, id.data() + id.size(), v);
          if (r.ec == std::errc() && r.ptr == id.data() + id.size() && v < n) hint = v;
        }
        if (hint < n && meta(hint).getNativeID() == id) { index = hint; out.found = true; }
        for (std::size_t i = 0; !out.found && i < n; ++i)
          if (meta(i).getNativeID() == id) { index = i; out.found = true; }
        if (out.found)
        {
          spec = read(index);
          PeakPickerHiRes picker;
          pick_result = FC::apply(spec, picker,
                                  FC::policyFor(opt.pick_mode, kind == Kind::Mgf ? FC::Input::Mgf : FC::Input::MzML,
                                                opt.pick_unknown_type));
        }
      }
    }
    catch (const Exception::FileNotReadable& e)
    {
      out.status = Status::NotReadable;
      out.error = e.what();
      return out;
    }
    catch (const Exception::BaseException& e)
    {
      out.status = Status::Corrupt;
      out.error = e.what();
      return out;
    }
    catch (const std::exception& e)
    {
      out.status = Status::Corrupt;
      out.error = e.what();
      return out;
    }
    if (!out.found) return out;
    out.jsonl = spectrumRecord(spec, index, pick_result > 0, opt.param);
    out.jsonl += JsonObject("end").line();
    return out;
  }
}
