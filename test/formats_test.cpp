// The standard-format outputs: USIs for the tag TSV (collection validation,
// the index forms, the USI 1.0 grammar).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Usi.h"

#include <iostream>
#include <regex>
#include <string>

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }

  // USI 1.0 without an interpretation: prefix, a permitted collection, a run
  // that does not open a [subFolder], then one of the spectrum index forms.
  const std::regex USI_GRAMMAR(
      R"(^mzspec:(PXD\d{6}|RPXD\d{6}|PXL\d{6}|MSV\d{9}|RMSV\d{9}|USI000000):)"
      R"([^\[\t\n][^\t\n]*:(scan:\d+|index:\d+|nativeId:\d+(,\d+)*)$)");

  void usiTests()
  {
    for (const char* good : {"PXD000561", "RPXD006668", "PXL000001", "MSV000078556", "RMSV000078556",
                             "USI000000"})
      check(FASTag::isUsiCollection(good), std::string("collection accepted: ") + good);
    for (const char* bad : {"", "PXD", "PXD12345", "PXD0005610", "pxd000561", "PXD00056a", "PDX000561",
                            "MSV00007855", "MSV0000785560", "RPXD00666", "USI000001", "PXD000561 ",
                            " PXD000561", "PXD000561:x", "MSV000078556X"})
      check(!FASTag::isUsiCollection(bad), std::string("collection refused: '") + bad + "'");

    // The spec's own examples (USI 1.0, sections 3.3 and 3.6.4).
    const std::string run = "mzspec:PXD000561:Adult_Frontalcortex_bRP_Elite_85_f09:";
    check(run + FASTag::usiIndex("controllerType=0 controllerNumber=1 scan=17555", 9)
              == "mzspec:PXD000561:Adult_Frontalcortex_bRP_Elite_85_f09:scan:17555",
          "Thermo native ID -> scan");
    check(FASTag::usiIndex("controllerType=5 controllerNumber=1 scan=7", 0) == "nativeId:5,1,7",
          "Thermo off the MS controller -> nativeId");
    check(FASTag::usiIndex("sample=1 period=1 cycle=2740 experiment=10", 0) == "nativeId:1,1,2740,10",
          "WIFF -> nativeId");
    check(FASTag::usiIndex("function=10 process=1 scan=345", 0) == "nativeId:10,1,345",
          "Waters -> nativeId, not its scan field");
    check(FASTag::usiIndex("frame=120 scan=475", 0) == "nativeId:120,475", "Bruker TDF -> nativeId");
    check(FASTag::usiIndex("spectrum=12", 0) == "nativeId:12", "spectrum identifier format -> nativeId");
    // Real inputs: diaTracer writes frame=N (TSF's layout) for pseudo-spectra
    // under a Thermo declaration; a TDF conversion numbers index= from 1.
    check(FASTag::usiIndex("frame=1039", 8) == "index:8", "frame=N alone -> position");
    check(FASTag::usiIndex("index=1", 0) == "index:0", "index=N -> position, whatever its base");
    check(FASTag::usiIndex("scan=42", 0) == "scan:42", "scan number only -> scan");
    // No PSI-MS nativeID format, or one not made of integers: the input position.
    check(FASTag::usiIndex("spectrum_17", 16) == "index:16", "non-native ID -> position");
    check(FASTag::usiIndex("", 1) == "index:1", "empty ID -> position");
    check(FASTag::usiIndex("merged=3", 5) == "index:5", "unknown key -> position");
    check(FASTag::usiIndex("frame=1 scan=2 precursor=3", 6) == "index:6",
          "an ID extending a format's keys (a derived spectrum) -> position");
    check(FASTag::usiIndex("scan=2 frame=1", 7) == "index:7", "keys out of the format's order -> position");
    check(FASTag::usiIndex("controllerType=0 controllerNumber=1 scan=x7", 4) == "index:4",
          "non-integer field -> position");
    check(FASTag::usiIndex("scan=5 merged", 2) == "index:2", "field without '=' -> position");

    for (const std::string& id : {std::string("controllerType=0 controllerNumber=1 scan=17555"),
                                  std::string("sample=1 period=1 cycle=2740 experiment=10"),
                                  std::string("index=0"), std::string("not a native id")})
    {
      const std::string usi = run + FASTag::usiIndex(id, 123);
      check(std::regex_match(usi, USI_GRAMMAR), "USI grammar: " + usi);
    }
    check(!std::regex_match("mzspec:PXD00056:run:scan:1", USI_GRAMMAR), "grammar refuses a bad collection");
  }
}

int main()
{
  usiTests();
  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "formats_test: all passed\n";
  return 0;
}
