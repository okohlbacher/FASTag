// Freezes the shared run report section (src/RunMeta.h) and checks that the
// per-cluster accumulators (src/ClusterAcc.h) compose.
//
// The Legacy bytes below are what FASTag 1.11.0 (78390cd) writes at the top
// of -digest_out, -label_out and -massgap_out. Changing them, or the
// Versioned rows, needs a kFormatVersion bump and new references.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "ClusterAcc.h"
#include "RunMeta.h"

#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <type_traits>

namespace RR = FASTag::RunReport;

static int failures = 0;
static void check(bool ok, const std::string& what)
{
  if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
}

static std::string written(const std::vector<FASTag::Digest::Row>& rows)
{
  const std::string path = "runmeta_test.tmp.tsv";
  check(FASTag::Digest::writeReport(path, rows), "writeReport succeeds");
  std::ifstream in(path, std::ios::binary);
  std::stringstream ss;
  ss << in.rdbuf();
  in.close();
  std::remove(path.c_str());
  return ss.str();
}

int main()
{
  RR::RunMeta m;
  m.version = "1.11.0";
  m.input = "run.mzML";
  m.fragment_tolerance = 20;
  m.fragment_tolerance_unit = "ppm";
  m.tag_lengths = {3, 5};
  m.subsample_fraction = 0.25;
  m.subsample_spectra = 0;

  const std::string legacy =
    "section\tkey\tvalue\tn\tdescription\n"
    "run\tversion\t1.11.0\t-\tFASTag 1.11.0 wrote this report.\n"
    "run\tinput\trun.mzML\t-\tThe spectra were read from run.mzML.\n"
    "run\tfragment_tolerance\t20\t-\tThe fragment tolerance is 20 ppm.\n"
    "run\tfragment_tolerance_unit\tppm\t-\tThe fragment tolerance is in ppm.\n"
    "run\ttag_length\t3,5\t-\tTags were seeded at length 3,5.\n"
    "run\tsubsample_fraction\t0.25\t-\tA fraction of 0.25 of the spectra was tagged (0 = all).\n"
    "run\tsubsample_spectra\t0\t-\t0 spectra were drawn for tagging (0 = all).\n";
  check(written(RR::runRows(m)) == legacy, "default rows are the 1.11 run rows");
  check(written(RR::runRows(m, RR::Emit::Legacy)) == legacy, "Emit::Legacy is the default");
  check(RR::runRows(m).size() == 7, "7 legacy rows");

  // Shortest round-trip doubles and a single length, as 1.11 writes them.
  RR::RunMeta d = m;
  d.fragment_tolerance = 0.02;
  d.fragment_tolerance_unit = "Da";
  d.tag_lengths = {5};
  d.subsample_fraction = 0;
  d.subsample_spectra = 1000;
  const auto rd = RR::runRows(d);
  check(rd[2].value == "0.02" && rd[2].description == "The fragment tolerance is 0.02 Da.", "Da tolerance row");
  check(rd[4].value == "5" && rd[4].description == "Tags were seeded at length 5.", "single length row");
  check(rd[5].value == "0", "subsample_fraction 0");
  check(rd[6].value == "1000" && rd[6].description == "1000 spectra were drawn for tagging (0 = all).",
        "subsample_spectra row");
  check(RR::joinLengths({}).empty(), "no lengths, empty string");

  // Versioned: the legacy rows are a byte prefix, then the version row.
  const std::string versioned = written(RR::runRows(m, RR::Emit::Versioned));
  check(RR::kFormatVersion == 2, "format version 2");
  check(versioned.rfind(legacy, 0) == 0, "Versioned starts with the legacy bytes");
  check(versioned.substr(legacy.size()) ==
          "run\trun_report_version\t2\t-\tThe run section follows FASTag run report format 2.\n"
          "run\tactivation_collisional\t0\t0\t0 of 0 MS2 spectra were activated by collision "
          "(CID, HCD, trap-type CID, PQD).\n"
          "run\tactivation_electron\t0\t0\t0 of 0 MS2 spectra were activated by electron transfer or "
          "capture (ETD, ECD).\n"
          "run\tactivation_hybrid\t0\t0\t0 of 0 MS2 spectra were activated by a hybrid method (EThcD, ETciD).\n"
          "run\tactivation_unknown\t0\t0\t0 of 0 MS2 spectra carry no activation FASTag classifies.\n",
        "Versioned appends the version row, then the E activation rows (format 2, #15 phase A)");
  // The E activation counts (#15 phase A): value the count, n all MS2.
  {
    RR::RunMeta a = m;
    a.activation_collisional = 3491;
    a.activation_electron = 3492;
    a.activation_hybrid = 1;
    a.activation_unknown = 0;
    const auto ra = RR::runRows(a, RR::Emit::Versioned);
    check(ra.size() == 12, "Versioned format 2 has 12 rows");
    check(ra[8].key == "activation_collisional" && ra[8].value == "3491" && ra[8].n == "6984",
          "activation_collisional row");
    check(ra[9].key == "activation_electron" && ra[9].value == "3492" && ra[9].n == "6984" &&
            ra[9].description == "3492 of 6984 MS2 spectra were activated by electron transfer or capture (ETD, ECD).",
          "activation_electron row");
    check(ra[10].key == "activation_hybrid" && ra[10].value == "1", "activation_hybrid row");
    check(ra[11].key == "activation_unknown" && ra[11].value == "0", "activation_unknown row");
    check(written(RR::runRows(a)) == legacy, "activation counts never reach the Legacy rows");
  }

  // ClusterAcc: composes and merges without touching anything.
  FASTag::ClusterAcc::ClusterThread a, b;
  a.merge(b);
  FASTag::ClusterAcc::ClusterBlock blk;
  blk.prepare(65536);
  static_assert(std::is_default_constructible_v<FASTag::ClusterAcc::ClusterThread>);
  static_assert(std::is_copy_constructible_v<FASTag::ClusterAcc::ClusterBlock>);

  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "runmeta_test: all checks passed\n";
  return 0;
}
