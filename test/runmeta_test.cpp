// Freezes the shared run report section (src/RunMeta.h) and checks that the
// per-cluster accumulators (src/ClusterAcc.h) compose.
//
// The Legacy bytes below are what FASTag 1.11.0 (78390cd) writes at the top
// of -digest_out, -label_out and -massgap_out. Changing them, or the
// Versioned rows, needs a kFormatVersion bump and new references. Format 6
// (1.13 item 15) adds rows only under -complement_tolerance_unit auto; the
// section without them stays format 5, byte for byte.
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
  check(written(RR::runRows(m, RR::Emit::LEGACY)) == legacy, "Emit::Legacy is the default");
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
  const std::string versioned = written(RR::runRows(m, RR::Emit::VERSIONED));
  check(RR::kFormatVersion == 6, "format version 6");
  check(RR::kFormatVersionNoAuto == 5, "without -complement_tolerance_unit auto the run section is format 5");
  check(versioned.rfind(legacy, 0) == 0, "Versioned starts with the legacy bytes");
  check(versioned.substr(legacy.size()) ==
          "run\trun_report_version\t5\t-\tThe run section follows FASTag run report format 5.\n"
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
          "run\tmulti_hypothesis\t0\t0\t0 of 0 MS2 spectra were tagged under more than one precursor hypothesis.\n"
          "run\tion_series\tby\t-\tMS2 spectra were read under -ion_series by.\n"
          "run\tion_series_by\t0\t0\t0 of 0 MS2 spectra were tagged as b/y ions.\n"
          "run\tion_series_cz\t0\t0\t0 of 0 MS2 spectra were tagged as c/z-dot ions.\n",
        "Versioned appends the version row, then the E picking rows (#9), the E activation rows (#15 phase A), "
        "the E precursor-hypothesis rows (#6) and the E ion-series rows (#15 phase B), format 5");
  // The E picking rows (#9): value the count, n the profile MS2 that needed picking.
  {
    RR::RunMeta e = m;
    e.pick_profile = "legacy";  // the only mode that picks (mzPeak); auto was removed in 1.14
    e.pick_picked = 47470;
    e.pick_failed = 3;
    const auto re = RR::runRows(e, RR::Emit::VERSIONED);
    check(re.size() == 28, "Versioned format 5 has 28 rows");
    check(re[8].key == "pick_profile" && re[8].value == "legacy" && re[8].n == "-" &&
            re[8].description == "Profile MS2 was centroided under -pick_profile legacy.",
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
    const auto ra = RR::runRows(a, RR::Emit::VERSIONED);
    check(ra.size() == 28, "Versioned format 5 has 28 rows");
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
    const auto rh = RR::runRows(h, RR::Emit::VERSIONED);
    check(rh.size() == 28, "Versioned format 5 has 28 rows");
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
  // The E ion-series rows (#15 phase B): value the spectra per series, n all
  // tagged MS2.
  {
    RR::RunMeta s = m;
    s.ion_series = "auto";
    s.ion_series_ms2_by = 3492;
    s.ion_series_ms2_cz = 3491;
    const auto rs = RR::runRows(s, RR::Emit::VERSIONED);
    check(rs.size() == 28, "Versioned format 5 has 28 rows");
    check(rs[25].key == "ion_series" && rs[25].value == "auto" && rs[25].n == "-" &&
            rs[25].description == "MS2 spectra were read under -ion_series auto.",
          "ion_series row");
    check(rs[26].key == "ion_series_by" && rs[26].value == "3492" && rs[26].n == "6983" &&
            rs[26].description == "3492 of 6983 MS2 spectra were tagged as b/y ions.",
          "ion_series_by row");
    check(rs[27].key == "ion_series_cz" && rs[27].value == "3491" && rs[27].n == "6983" &&
            rs[27].description == "3491 of 6983 MS2 spectra were tagged as c/z-dot ions.",
          "ion_series_cz row");
    check(written(RR::runRows(s)) == legacy, "ion-series counts never reach the Legacy rows");
  }
  // The 1.13 complement-tolerance rows (format 6): only under
  // -complement_tolerance_unit auto; without it the section is format 5.
  {
    RR::RunMeta c = m;
    c.complement_tol_auto = true;
    c.complement_tol_measured = true;
    c.complement_tol_source = "measured";
    c.complement_tol = 0.22422414115406886;
    c.complement_tol_measured_value = 0.22422414115406886;
    c.complement_tol_window = 0.9;
    c.complement_probe_ms2 = 500;
    c.complement_probe_confident = 160;
    c.complement_probe_pairs = 286;
    c.complement_probe_signal = 259.4;
    c.complement_probe_median = 0.0547615;
    c.complement_probe_mad = 0.0583168;
    const auto rc = RR::runRows(c, RR::Emit::VERSIONED);
    check(rc.size() == 35, "Versioned format 6 (measured) has 35 rows");
    check(rc[7].key == "run_report_version" && rc[7].value == "6" &&
            rc[7].description == "The run section follows FASTag run report format 6.",
          "auto: format 6");
    check(rc.size() == 35 && rc[28].key == "complement_tolerance" && rc[28].value == "0.22422414115406886" &&
            rc[28].description == "The complement window in force was 0.22422414115406886 Da "
                                   "(-complement_tolerance_unit auto).",
          "complement_tolerance row, full precision");
    check(rc.size() == 35 && rc[29].key == "complement_tolerance_source" && rc[29].value == "measured" &&
            rc[29].description == "The window was measured on the run's probe.",
          "complement_tolerance_source row");
    check(rc.size() == 35 && rc[30].key == "complement_tolerance_measured" && rc[30].value == "0.22422414115406886",
          "complement_tolerance_measured row");
    check(rc.size() == 35 && rc[31].key == "complement_probe_confident" && rc[31].value == "160" &&
            rc[31].n == "500",
          "complement_probe_confident row");
    check(rc.size() == 35 && rc[32].key == "complement_probe_signal" && rc[32].value == "259" &&
            rc[32].n == "286" &&
            rc[32].description == "286 complement pairs fell within 0.9 Da, 259 above the chance floor.",
          "complement_probe_signal row");
    check(rc.size() == 35 && rc[33].key == "complement_probe_median" && rc[33].value == "0.0547615" &&
            rc[34].key == "complement_probe_mad" && rc[34].value == "0.0583168",
          "complement_probe_median/mad rows");
    // Measured below -complement_tolerance: the lower bound is in force.
    RR::RunMeta lb = c;
    lb.complement_tol_source = "lower_bound";
    lb.complement_tol = 0.02;
    lb.complement_tol_measured_value = 0.013872973632812499;
    const auto rl = RR::runRows(lb, RR::Emit::VERSIONED);
    check(rl.size() == 35 && rl[28].value == "0.02" && rl[29].value == "lower_bound" &&
            rl[29].description == "The measured window was below -complement_tolerance, the lower bound." &&
            rl[30].value == "0.013872973632812499",
          "lower-bound rows");
    RR::RunMeta fb = c;
    fb.complement_tol_measured = false;
    fb.complement_tol_source = "fallback";
    fb.complement_tol = 0.02;
    fb.complement_tol_why = "too few complement pairs above the chance floor (signal 18, needs 40)";
    const auto rf = RR::runRows(fb, RR::Emit::VERSIONED);
    check(rf.size() == 32, "Versioned format 6 (fallback) has 32 rows");
    check(rf.size() == 32 && rf[28].value == "0.02" && rf[29].value == "fallback" &&
            rf[29].description == "The window is -complement_tolerance: too few complement pairs above the "
                                  "chance floor (signal 18, needs 40)." &&
            rf[30].key == "complement_probe_confident",
          "fallback rows");
    check(written(RR::runRows(c)) == legacy, "complement rows never reach the Legacy rows");
    RR::RunMeta off = c;
    off.complement_tol_auto = false;
    check(written(RR::runRows(off, RR::Emit::VERSIONED)) == versioned,
          "without auto the complement fields write nothing (format 5 bytes)");
  }

  // ClusterAcc: composes and merges without touching anything.
  FASTag::ClusterAcc::ClusterThread a, b;
  a.merge(b);
  // ThreadE (#6): the hypothesis counts add up across threads.
  {
    namespace HY = FASTag::Hyp;
    FASTag::ClusterAcc::ClusterThread t1, t2, run;
    HY::Hypothesis a3{3, 0, 500.0, HY::ChargeSource::AMBIGUOUS, true}, a4{4, 0, 500.0, HY::ChargeSource::AMBIGUOUS, false};
    t1.e.hyp.add({a3, a4});
    t2.e.hyp.add({HY::Hypothesis{2, 1, 600.0, HY::ChargeSource::HEADER, true}});
    run.merge(t1);
    run.merge(t2);
    const auto& c = run.e.hyp;
    check(c.tagged[static_cast<size_t>(HY::ChargeSource::AMBIGUOUS)] == 2 &&
            c.selected[static_cast<size_t>(HY::ChargeSource::AMBIGUOUS)] == 1 &&
            c.selected[static_cast<size_t>(HY::ChargeSource::HEADER)] == 1 && c.iso_shifted == 1 && c.multi == 1,
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
