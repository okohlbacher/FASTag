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
  check(RR::kFormatVersion == 4, "format version 4");
  check(versioned.rfind(legacy, 0) == 0, "Versioned starts with the legacy bytes");
  check(versioned.substr(legacy.size()) ==
          "run\trun_report_version\t4\t-\tThe run section follows FASTag run report format 4.\n"
          "run\tpick_profile\tlegacy\t-\tProfile MS2 was centroided under -pick_profile legacy.\n"
          "run\tprofile_ms2_picked\t0\t0\t0 of 0 profile MS2 spectra were centroided before tagging.\n"
          "run\tprofile_ms2_kept\t0\t0\t0 of 0 profile MS2 spectra were tagged as profile "
          "(picking yielded nothing).\n"
          "run\tactivation_collisional\t0\t0\t0 of 0 MS2 spectra were activated by collision "
          "(CID, HCD, trap-type CID, PQD).\n"
          "run\tactivation_electron\t0\t0\t0 of 0 MS2 spectra were activated by electron transfer or "
          "capture (ETD, ECD).\n"
          "run\tactivation_hybrid\t0\t0\t0 of 0 MS2 spectra were activated by a hybrid method (EThcD, ETciD).\n"
          "run\tactivation_unknown\t0\t0\t0 of 0 MS2 spectra carry no activation FASTag classifies.\n"
          "run\tunknown_charge\tassume2\t-\tPrecursors without a charge were tagged under -unknown_charge assume2.\n"
          "run\tisotope_error\t0\t-\tPrecursor isotope offsets 0 were considered.\n"
          "run\tcharge_header\t0\t0\t0 of 0 MS2 spectra were reported at their precursor's charge.\n"
          "run\tcharge_possible\t0\t0\t0 of 0 MS2 spectra were reported at a listed possible charge.\n"
          "run\tcharge_inferred\t0\t0\t0 of 0 MS2 spectra were reported at an inferred charge.\n"
          "run\tcharge_ambiguous\t0\t0\t0 of 0 MS2 spectra were reported at the better of two inferred charges.\n"
          "run\tcharge_assumed\t0\t0\t0 of 0 MS2 spectra were reported at charge 2 without charge evidence.\n"
          "run\tcharge_enumerated\t0\t0\t0 of 0 MS2 spectra were reported at an enumerated charge.\n"
          "run\tisotope_shifted\t0\t0\t0 of 0 MS2 spectra were reported at a precursor isotope offset other than 0.\n"
          "run\tmulti_hypothesis\t0\t0\t0 of 0 MS2 spectra were tagged under more than one precursor hypothesis.\n",
        "Versioned appends the version row, then the E picking rows (#9), the E activation rows (#15 phase A) "
        "and the E precursor-hypothesis rows (#6), format 4");
  // The E picking rows (#9): value the count, n the profile MS2 that needed picking.
  {
    RR::RunMeta e = m;
    e.pick_profile = "auto";
    e.pick_picked = 47470;
    e.pick_failed = 3;
    const auto re = RR::runRows(e, RR::Emit::Versioned);
    check(re.size() == 25, "Versioned format 4 has 25 rows");
    check(re[8].key == "pick_profile" && re[8].value == "auto" && re[8].n == "-" &&
            re[8].description == "Profile MS2 was centroided under -pick_profile auto.",
          "pick_profile row");
    check(re[9].key == "profile_ms2_picked" && re[9].value == "47470" && re[9].n == "47473" &&
            re[9].description == "47470 of 47473 profile MS2 spectra were centroided before tagging.",
          "profile_ms2_picked row");
    check(re[10].key == "profile_ms2_kept" && re[10].value == "3" && re[10].n == "47473",
          "profile_ms2_kept row");
    check(written(RR::runRows(e)) == legacy, "picking counts never reach the Legacy rows");
  }
  // The E activation counts (#15 phase A): value the count, n all MS2.
  {
    RR::RunMeta a = m;
    a.activation_collisional = 3491;
    a.activation_electron = 3492;
    a.activation_hybrid = 1;
    a.activation_unknown = 0;
    const auto ra = RR::runRows(a, RR::Emit::Versioned);
    check(ra.size() == 25, "Versioned format 4 has 25 rows");
    check(ra[11].key == "activation_collisional" && ra[11].value == "3491" && ra[11].n == "6984",
          "activation_collisional row");
    check(ra[12].key == "activation_electron" && ra[12].value == "3492" && ra[12].n == "6984" &&
            ra[12].description == "3492 of 6984 MS2 spectra were activated by electron transfer or capture (ETD, ECD).",
          "activation_electron row");
    check(ra[13].key == "activation_hybrid" && ra[13].value == "1", "activation_hybrid row");
    check(ra[14].key == "activation_unknown" && ra[14].value == "0", "activation_unknown row");
    check(written(RR::runRows(a)) == legacy, "activation counts never reach the Legacy rows");
  }
  // The E precursor-hypothesis rows (#6): value the count, n the spectra
  // with a selected hypothesis.
  {
    RR::RunMeta h = m;
    h.unknown_charge = "infer";
    h.isotope_error = "0,1";
    h.charge_header = 90;
    h.charge_possible = 1;
    h.charge_inferred = 30;
    h.charge_ambiguous = 5;
    h.charge_assumed = 13;
    h.charge_enumerated = 0;
    h.iso_shifted = 7;
    h.multi_hypothesis = 5;
    const auto rh = RR::runRows(h, RR::Emit::Versioned);
    check(rh.size() == 25, "Versioned format 4 has 25 rows");
    check(rh[15].key == "unknown_charge" && rh[15].value == "infer" && rh[15].n == "-", "unknown_charge row");
    check(rh[16].key == "isotope_error" && rh[16].value == "0,1" &&
            rh[16].description == "Precursor isotope offsets 0,1 were considered.", "isotope_error row");
    check(rh[17].key == "charge_header" && rh[17].value == "90" && rh[17].n == "139", "charge_header row");
    check(rh[19].key == "charge_inferred" && rh[19].value == "30" && rh[19].n == "139" &&
            rh[19].description == "30 of 139 MS2 spectra were reported at an inferred charge.", "charge_inferred row");
    check(rh[20].key == "charge_ambiguous" && rh[20].value == "5", "charge_ambiguous row");
    check(rh[21].key == "charge_assumed" && rh[21].value == "13", "charge_assumed row");
    check(rh[23].key == "isotope_shifted" && rh[23].value == "7" && rh[23].n == "139", "isotope_shifted row");
    check(rh[24].key == "multi_hypothesis" && rh[24].value == "5", "multi_hypothesis row");
    check(written(RR::runRows(h)) == legacy, "hypothesis counts never reach the Legacy rows");
  }

  // ClusterAcc: composes and merges without touching anything.
  FASTag::ClusterAcc::ClusterThread a, b;
  a.merge(b);
  // ThreadE (#9): the picking counts add up across threads.
  {
    FASTag::ClusterAcc::ClusterThread t1, t2, run;
    t1.e.pick.add(1); t1.e.pick.add(1); t1.e.pick.add(0);
    t2.e.pick.add(1); t2.e.pick.add(-1);
    run.merge(t1);
    run.merge(t2);
    check(run.e.pick.picked == 3 && run.e.pick.failed == 1, "ThreadE::merge sums the picking counts");
  }
  // ThreadE (#6): the hypothesis counts add up across threads.
  {
    namespace HY = FASTag::Hyp;
    FASTag::ClusterAcc::ClusterThread t1, t2, run;
    HY::Hypothesis a3{3, 0, 500.0, HY::ChargeSource::Ambiguous, true}, a4{4, 0, 500.0, HY::ChargeSource::Ambiguous, false};
    t1.e.hyp.add({a3, a4});
    t2.e.hyp.add({HY::Hypothesis{2, 1, 600.0, HY::ChargeSource::Header, true}});
    run.merge(t1);
    run.merge(t2);
    const auto& c = run.e.hyp;
    check(c.tagged[static_cast<size_t>(HY::ChargeSource::Ambiguous)] == 2 &&
            c.selected[static_cast<size_t>(HY::ChargeSource::Ambiguous)] == 1 &&
            c.selected[static_cast<size_t>(HY::ChargeSource::Header)] == 1 && c.iso_shifted == 1 && c.multi == 1,
          "ThreadE::merge sums the hypothesis counts");
  }
  FASTag::ClusterAcc::ClusterBlock blk;
  blk.prepare(65536);
  static_assert(std::is_default_constructible_v<FASTag::ClusterAcc::ClusterThread>);
  static_assert(std::is_copy_constructible_v<FASTag::ClusterAcc::ClusterBlock>);

  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "runmeta_test: all checks passed\n";
  return 0;
}
