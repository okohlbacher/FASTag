// Universal Spectrum Identifier (HUPO-PSI USI 1.0) for the tag TSV:
//
//   mzspec:<collection>:<msRun>:<indexType>:<indexNumber>
//
// The tool composes the constant "mzspec:<collection>:<msRun>:" once; this
// header validates the collection and derives the per-spectrum
// <indexType>:<indexNumber>. No interpretation suffix: a tag is not a peptide.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <OpenMS/DATASTRUCTURES/String.h>
#include <OpenMS/METADATA/SpectrumLookup.h>

#include <algorithm>
#include <cctype>
#include <string>
#include <vector>

namespace FASTag
{
  /// A collection identifier the USI permits. The list is closed and kept by
  /// HUPO-PSI (github.com/HUPO-PSI/usi, CollectionIdentifiers.md): PXD, RPXD
  /// and PXL with six digits, MSV and RMSV with nine, and USI000000, the
  /// placeholder for a dataset that has no identifier yet.
  inline bool isUsiCollection(const std::string& c)
  {
    const auto is = [&c](const std::string& prefix, size_t digits) {
      return c.size() == prefix.size() + digits && c.compare(0, prefix.size(), prefix) == 0
          && std::all_of(c.begin() + static_cast<long>(prefix.size()), c.end(),
                         [](unsigned char ch) { return std::isdigit(ch) != 0; });
    };
    return c == "USI000000" || is("PXD", 6) || is("RPXD", 6) || is("PXL", 6)
        || is("MSV", 9) || is("RMSV", 9);
  }

  /// "<indexType>:<indexNumber>" for one spectrum, as USI 1.0 prescribes
  /// (sections 3.3.5, 3.6.2, 3.6.4):
  ///
  ///   controllerType=0 controllerNumber=1 scan=N  (Thermo)      scan:N
  ///   scan=N  (scan number only, Bruker BAF/YEP, Shimadzu)      scan:N
  ///   another PSI-MS nativeID format made of integer fields     nativeId:a,b,...
  ///     -- Waters, WIFF, Bruker TDF/U2, UIMF, Agilent, spectrum=N, Thermo on
  ///     another controller: the integers in the format's key order
  ///   anything else                                             index:<i>
  ///
  /// where <i> is the spectrum's 0-based position in the input, the form the
  /// spec requires when no original scan can be named: no native ID, a merged
  /// or derived spectrum whose ID extends a format's keys, and index=N, which
  /// converters number from 0 or 1 alike, so only the position is certain.
  ///
  /// ponytail: the ID's own keys name its format; the file's declared nativeID
  /// format is not read. So Bruker TSF's frame=N, the layout diaTracer also
  /// writes for its pseudo-spectra (declaring Thermo), is left to index:<i>,
  /// which is right for both.
  inline std::string usiIndex(const OpenMS::String& native_id, size_t position)
  {
    // The integer-only layouts among the PSI-MS nativeID formats (the children
    // of MS:1000767), keys in the order the format defines them.
    using Keys = std::vector<std::string>;
    static const std::vector<Keys> formats = {
        {"controllerType", "controllerNumber", "scan"},  // MS:1000768 Thermo
        {"function", "process", "scan"},                 // MS:1000769 Waters
        {"sample", "period", "cycle", "experiment"},     // MS:1000770 WIFF
        {"scan"},  // MS:1000771 YEP, MS:1000772 BAF, MS:1000776, MS:1002898 Shimadzu QTOF
        {"spectrum"},                                    // MS:1000777 spectrum identifier
        {"declaration", "collection", "scan"},           // MS:1000823 Bruker U2
        {"scanId"},                                      // MS:1001508 Agilent MassHunter
        {"query"},                                       // MS:1001528 Mascot query number
        {"frame", "scan", "frameType"},                  // MS:1002532 UIMF
        {"frame", "scan"}};                              // MS:1002818 Bruker TDF

    const std::string by_position = "index:" + std::to_string(position);
    std::vector<OpenMS::String> fields;
    native_id.split(' ', fields);
    Keys keys, values;
    for (const OpenMS::String& f : fields)
    {
      const size_t eq = f.find('=');
      if (eq == std::string::npos || eq == 0 || eq + 1 == f.size()
          || !std::all_of(f.begin() + static_cast<long>(eq) + 1, f.end(),
                          [](unsigned char ch) { return std::isdigit(ch) != 0; }))
        return by_position;
      keys.push_back(f.substr(0, eq));
      values.push_back(f.substr(eq + 1));
    }
    if (std::find(formats.begin(), formats.end(), keys) == formats.end()) return by_position;

    // The two formats whose scan= field IS the scan number, read by OpenMS.
    const char* scan_format = nullptr;
    if (keys == Keys{"scan"})
      scan_format = "MS:1000776";  // scan number only nativeID format
    else if (keys[0] == "controllerType" && values[0] == "0" && values[1] == "1")
      scan_format = "MS:1000768";  // Thermo nativeID format, the MS controller
    if (scan_format != nullptr)
    {
      const int scan = OpenMS::SpectrumLookup::extractScanNumber(native_id, scan_format);
      return scan >= 0 ? "scan:" + std::to_string(scan) : by_position;
    }
    std::string out = "nativeId:";
    for (size_t i = 0; i < values.size(); ++i)
    {
      if (i) out += ',';
      out += values[i];
    }
    return out;
  }
}
