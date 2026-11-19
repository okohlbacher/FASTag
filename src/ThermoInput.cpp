// Thermo .raw input; see ThermoInput.h.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
#include "ThermoInput.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/config.h>

#ifdef WITH_THERMO_RAW
#include <OpenMS/FORMAT/OnDiscThermoRawExperiment.h>
#endif

#include <algorithm>
#include <cctype>

using namespace OpenMS;

namespace FASTag::Thermo
{
  bool supported()
  {
#ifdef WITH_THERMO_RAW
    return true;
#else
    return false;
#endif
  }

  bool isThermoPath(const std::string& path)
  {
    if (path.size() < 4) return false;
    std::string tail = path.substr(path.size() - 4);
    std::transform(tail.begin(), tail.end(), tail.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return tail == ".raw";
  }

  const char* copyrightNotice()
  {
    // RawFileReader distribution licence, section 3.2: verbatim.
    return "RawFileReader reading tool. Copyright \xC2\xA9 2016 by Thermo Fisher Scientific, Inc. All rights reserved.";
  }

  std::unique_ptr<IMSExperimentRandomAccess> open(const std::string& path, Representation rep)
  {
#ifdef WITH_THERMO_RAW
    OnDiscThermoRawExperiment::Options o;
    // Set explicitly: the reader's default is the acquired representation.
    o.centroid = rep == Representation::CENTROID;
    o.checksum = false;            // reads the whole file once more
    o.preserve_trailers = false;   // the resolving power is read without it
    o.instrument_methods = false;
    o.skip_chromatograms = true;
    o.charge_data = false;
    o.noise_data = false;
    o.all_detectors = false;
    auto r = std::make_unique<OnDiscThermoRawExperiment>();
    r->openFile(path, o);
    return r;
#else
    static_cast<void>(path);
    static_cast<void>(rep);
    throw Exception::NotImplemented(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION);
#endif
  }

  std::optional<long long> massResolvingPower(const MSSpectrum& spectrum)
  {
    if (!spectrum.metaValueExists("mass resolving power")) return std::nullopt;
    const DataValue& v = spectrum.getMetaValue("mass resolving power");
    double r = 0;
    switch (v.valueType())
    {
      case DataValue::INT_VALUE: r = static_cast<double>(static_cast<long long>(v)); break;
      case DataValue::DOUBLE_VALUE: r = static_cast<double>(v); break;
      case DataValue::STRING_VALUE:
        try { r = std::stod(v.toString()); } catch (...) { return std::nullopt; }
        break;
      default: return std::nullopt;
    }
    if (!(r > 0)) return std::nullopt;
    return static_cast<long long>(r + 0.5);
  }

  std::optional<long long> massResolvingPower(IMSExperimentRandomAccess& reader, Size index)
  {
    return massResolvingPower(reader.getSpectrumMetadata(index));
  }

  MSSpectrum ms2Metadata(IMSExperimentRandomAccess& reader, Size index)
  {
    if (reader.getSpectrumMSLevel(index) == 2) return reader.getSpectrumMetadata(index);
    MSSpectrum s;
    s.setMSLevel(reader.getSpectrumMSLevel(index));
    s.setRT(reader.getSpectrumRT(index));
    return s;
  }

  std::string runtimeHint(const std::string& error)
  {
    std::string e = error;
    std::transform(e.begin(), e.end(), e.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    const bool runtime = e.find("dotnet") != std::string::npos || e.find(".net") != std::string::npos
                         || e.find("hostfxr") != std::string::npos || e.find("managed") != std::string::npos
                         || e.find("runtime") != std::string::npos || e.find("bridge") != std::string::npos;
    if (!runtime) return {};
    return "Reading .raw needs a .NET 8 (or newer) runtime: install it, or set DOTNET_ROOT to where it is; "
           "OPENMS_THERMO_MANAGED_DIR may name the directory with the bridge's managed files "
           "(ThermoWrapperManaged.dll and the Thermo CommonCore assemblies).";
  }
}
