// -probe_input and -dump_spectrum (1.12 G1): the JSON writers, the mzML
// header parse (analyser per instrument configuration, the scan's
// configuration), the spectrum record against the tagger's own
// preprocessing, and probeInput()/dumpSpectrum() on the fixtures.
//
//   input_probe_test <fixture dir>
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "CliParam.h"
#include "FASTagger.h"
#include "InputProbe.h"

#include <OpenMS/FORMAT/FileHandler.h>
#include <OpenMS/KERNEL/MSExperiment.h>

#include <cmath>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

using namespace OpenMS;
namespace P = FASTag::Probe;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (ok) return;
    std::cerr << "FAIL: " << what << "\n";
    ++failures;
  }

  bool has(const std::string& hay, const std::string& needle) { return hay.find(needle) != std::string::npos; }

  /// The value text of "key": in a one-line JSON object (numbers, literals).
  std::string field(const std::string& line, const std::string& key)
  {
    const std::string k = "\"" + key + "\":";
    const std::size_t a = line.find(k);
    if (a == std::string::npos) return "<absent>";
    std::size_t b = a + k.size();
    if (line[b] == '"')
    {
      const std::size_t e = line.find('"', b + 1);
      return line.substr(b + 1, e - b - 1);
    }
    std::size_t e = b;
    int depth = 0;
    while (e < line.size() && (depth > 0 || (line[e] != ',' && line[e] != '}')))
    {
      if (line[e] == '[') ++depth;
      if (line[e] == ']') --depth;
      ++e;
    }
    return line.substr(b, e - b);
  }

  /// The line of record @p rec in a JSON-lines stream.
  std::string record(const std::string& jsonl, const std::string& rec)
  {
    const std::string k = "{\"record\":\"" + rec + "\"";
    std::size_t a = jsonl.find(k);
    if (a == std::string::npos) return {};
    return jsonl.substr(a, jsonl.find('\n', a) - a);
  }

  void json()
  {
    check(P::jsonString("a\"b\\c\n\t\x01") == "\"a\\\"b\\\\c\\n\\t\\u0001\"", "jsonString escapes");
    check(P::jsonString("controllerType=0 scan=5") == "\"controllerType=0 scan=5\"", "jsonString plain");
    std::string b;
    P::appendJsonNumber(b, 0.1);
    check(b == "0.1", "shortest double: " + b);
    b.clear();
    P::appendJsonNumber(b, std::nan(""));
    check(b == "null", "NaN is null");
    b.clear();
    P::appendJsonNumber(b, 1234.5677f);
    check(std::strtof(b.c_str(), nullptr) == 1234.5677f, "float round trip: " + b);
    b.clear();
    const double v = 445.12002563476562;
    P::appendJsonNumber(b, v);
    check(std::strtod(b.c_str(), nullptr) == v, "double round trip: " + b);
    const std::string line = P::JsonObject("x").str("s", "v").count("n", 3).boolean("t", true).null("z").line();
    check(line == "{\"record\":\"x\",\"s\":\"v\",\"n\":3,\"t\":true,\"z\":null}\n", "object: " + line);
  }

  void header()
  {
    // PXD010783's shape: an Orbitrap configuration for MS1, an ion trap one
    // for MS2, each scan naming its own.
    const std::string two = R"(<mzML><instrumentConfigurationList count="2">
      <instrumentConfiguration id="IC1"><componentList count="3">
        <source order="1"><cvParam cvRef="MS" accession="MS:1000398" value="" name="nanoelectrospray" /></source>
        <analyzer order="2"><cvParam cvRef="MS" accession="MS:1000484" value="" name="orbitrap" /></analyzer>
        <detector order="3"><cvParam cvRef="MS" accession="MS:1000624" value="" name="inductive detector" /></detector>
      </componentList></instrumentConfiguration>
      <instrumentConfiguration id="IC2"><componentList count="3">
        <analyzer order="2"><cvParam cvRef="MS" accession="MS:1000264" value="" name="ion trap" /></analyzer>
      </componentList></instrumentConfiguration></instrumentConfigurationList>
      <run id="r" defaultInstrumentConfigurationRef="IC1" startTimeStamp="x">)";
    const P::MzmlHeader h = P::parseMzmlHeader(two);
    check(h.analyzer_of.size() == 2, "two configurations");
    check(h.analyzer_of.count("IC1") && h.analyzer_of.at("IC1") == "orbitrap", "IC1 orbitrap");
    check(h.analyzer_of.count("IC2") && h.analyzer_of.at("IC2") == "ion trap", "IC2 ion trap");
    check(h.default_config == "IC1", "default configuration: " + h.default_config);
    // OpenMS writes property cvParams into <analyzer> before its type; a
    // quadrupole before the TOF of a QqTOF is not the MS2 analyser.
    const std::string openms = R"(<instrumentConfiguration id="ic_0"><componentList count="3">
        <analyzer order="2"><cvParam cvRef="MS" accession="MS:1000081" name="quadrupole" /></analyzer>
        <analyzer order="3">
          <cvParam cvRef="MS" accession="MS:1000014" name="accuracy" value="0" />
          <cvParam cvRef="MS" accession="MS:1000025" name="magnetic field strength" value="0" />
          <cvParam cvRef="MS" accession="MS:1000084" name="time-of-flight" />
        </analyzer></componentList></instrumentConfiguration><run id="r" defaultInstrumentConfigurationRef="ic_0">)";
    const P::MzmlHeader o = P::parseMzmlHeader(openms);
    check(o.analyzer_of.count("ic_0") && o.analyzer_of.at("ic_0") == "time-of-flight",
          "last analyser by order, its type cvParam: " + (o.analyzer_of.count("ic_0") ? o.analyzer_of.at("ic_0") : ""));
    check(P::scanConfigRef(R"(<spectrum id="s"><scanList count="1"><scan instrumentConfigurationRef="IC2"><cvParam/></scan>)") == "IC2",
          "scan configuration");
    check(P::scanConfigRef(R"(<spectrum id="s"><scanList count="1"><scan ><cvParam/></scan>)").empty(), "scan without one");
    check(P::scanConfigRef(R"(<spectrum id="s"><scanList count="1"><scanWindowList/></scanList>)").empty(),
          "scanWindowList is no scan");
    check(std::string(P::indexStateName(false, false)) == "absent", "absent");
    check(std::string(P::indexStateName(true, true)) == "stale", "stale");
    check(std::string(P::indexStateName(true, false)) == "ok", "ok");
  }

  /// The record's peaks are preparedPeaks(), which tagSpectrum tags:
  /// complementPopulation()[0] counts the same preparation.
  void records(const std::string& dir)
  {
    PeakMap exp;
    FileHandler().loadExperiment(dir + "/Ecoli_MS2_small.mzML", exp);
    FASTag::Param p = FASTag::cliDefaultParam(true);
    std::size_t n2 = 0;
    for (std::size_t i = 0; i < exp.size(); ++i)
    {
      const MSSpectrum& s = exp[i];
      if (s.getMSLevel() != 2 || s.getPrecursors().empty()) continue;
      ++n2;
      const double mz = s.getPrecursors().front().getMZ();
      const int z = s.getPrecursors().front().getCharge();
      const std::vector<int> pop = FASTag::complementPopulation(s, mz, z, p);
      const MSSpectrum peaks = FASTag::preparedPeaks(s, mz, z, p);
      check(!pop.empty() && static_cast<std::size_t>(pop[0]) == peaks.size(),
            "preparedPeaks size equals the tagger's prepared count at " + s.getNativeID());
      bool sorted = true;
      for (std::size_t k = 1; k < peaks.size(); ++k) sorted = sorted && peaks[k - 1].getMZ() < peaks[k].getMZ();
      check(sorted, "prepared peaks m/z sorted");
      const std::string rec = P::spectrumRecord(s, i, false, p);
      check(field(rec, "n") == std::to_string(peaks.size()), "record n at " + s.getNativeID());
      check(field(rec, "native_id") == s.getNativeID(), "record native_id");
      check(field(rec, "tagged") == "true", "MS2 is tagged");
      check(field(rec, "tolerance") == "20" && field(rec, "tolerance_unit") == "ppm", "record tolerance");
      check(field(rec, "deisotoped") == "true", "CLI default deisotopes");
      if (!peaks.empty())
      {
        std::string first;
        P::appendJsonNumber(first, peaks[0].getMZ());
        check(has(field(rec, "mz"), "[" + first), "record first m/z");
      }
      if (n2 >= 20) break;
    }
    check(n2 > 0, "fixture has MS2");
    MSSpectrum ms1;
    ms1.setMSLevel(1);
    ms1.setNativeID("scan=1");
    ms1.push_back(Peak1D(100.0, 5.0f));
    const std::string r1 = P::spectrumRecord(ms1, 0, false, p);
    check(field(r1, "tagged") == "false" && field(r1, "n") == "0" && field(r1, "mz") == "[]", "MS1: nothing tagged");
    check(field(r1, "precursor") == "null", "MS1: no precursor");
  }

  void probes(const std::string& dir)
  {
    P::ProbeOptions opt;
    opt.version = "test";
    const P::ProbeOutput e = P::probeInput(dir + "/Ecoli_MS2_small.mzML", opt);
    check(e.status == P::Status::Ok, "Ecoli probe ok: " + e.error);
    check(e.jsonl.rfind("{\"record\":\"probe\",\"format\":1", 0) == 0, "probe record first");
    check(has(e.jsonl, "{\"record\":\"end\"}\n") && e.jsonl.size() >= 17 &&
              e.jsonl.compare(e.jsonl.size() - 17, 17, "{\"record\":\"end\"}\n") == 0,
          "end record last");
    const std::string sp = record(e.jsonl, "spectra");
    check(field(sp, "ms2") == "139" && field(sp, "ms1") == "0", "Ecoli 139 MS2: " + sp);
    check(field(sp, "verdict") == "centroid", "Ecoli centroid: " + sp);
    const std::string in = record(e.jsonl, "instrument");
    check(field(in, "ms2_analyzer") == "orbitrap" && field(in, "ms2_analyzer_from") == "run_default", "Ecoli analyser: " + in);
    check(field(record(e.jsonl, "index"), "state") == "ok", "Ecoli index ok");
    check(field(record(e.jsonl, "acquisition"), "refuse") == "false", "Ecoli not refused");

    const P::ProbeOutput d = P::probeInput(dir + "/dia_like.mzML", opt);
    check(d.status == P::Status::Ok, "dia probe ok");
    const std::string a = record(d.jsonl, "acquisition");
    check(field(a, "mode") == "DIA" && field(a, "refuse") == "true", "raw DIA refused: " + a);
    opt.acquisition_check = "warn";
    check(field(record(P::probeInput(dir + "/dia_like.mzML", opt).jsonl, "acquisition"), "refuse") == "false",
          "warn never refuses");
    opt.acquisition_check = "refuse";

    const P::ProbeOutput m = P::probeInput(dir + "/Ecoli_MS2_small.mgf", opt);
    check(m.status == P::Status::Ok, "MGF probe ok");
    check(field(record(m.jsonl, "probe"), "file_format") == "MGF", "MGF format");
    check(field(record(m.jsonl, "index"), "state") == "not_applicable", "MGF index n/a");
    check(field(record(m.jsonl, "spectra"), "ms2") == "139", "MGF 139 MS2");

    const P::ProbeOutput pr = P::probeInput(dir + "/profile_ms2_small.mzML", opt);
    const std::string ps = record(pr.jsonl, "spectra");
    check(field(ps, "verdict") == "profile" && field(ps, "will_pick") == "false", "profile, legacy keeps it: " + ps);
    opt.pick_mode = FASTag::Centroid::Mode::Auto;
    check(field(record(P::probeInput(dir + "/profile_ms2_small.mzML", opt).jsonl, "spectra"), "will_pick") == "true",
          "auto picks profile mzML");
    check(field(record(P::probeInput(dir + "/Ecoli_MS2_small.mgf", opt).jsonl, "spectra"), "will_pick") == "false",
          "auto never picks MGF");

    // A FASTA alone: probe, fasta and end records, no spectra records.
    check(P::isFastaPath("a/B.FASTA") && P::isFastaPath("x.fa") && P::isFastaPath("x.faa") && !P::isFastaPath("x.mzML") &&
              !P::isFastaPath(".fa"),
          "FASTA names");
    const P::ProbeOutput fa = P::probeInput(dir + "/Ecoli_MS2_small.fasta", opt);
    check(fa.status == P::Status::Ok, "FASTA probe ok: " + fa.error);
    check(field(record(fa.jsonl, "probe"), "file_format") == "FASTA", "FASTA format");
    const std::string fr = record(fa.jsonl, "fasta");
    check(!fr.empty() && field(fr, "decoys") == "0" && field(fr, "proteins") != "null", "FASTA counts: " + fr);
    check(record(fa.jsonl, "spectra").empty() && record(fa.jsonl, "acquisition").empty(), "FASTA alone reads no spectra");
    check(fa.jsonl.size() >= 17 && fa.jsonl.compare(fa.jsonl.size() - 17, 17, "{\"record\":\"end\"}\n") == 0,
          "FASTA probe ends with the end record");
    check(P::probeInput(dir + "/missing.fasta", opt).status == P::Status::NotReadable, "missing FASTA not readable");

    check(P::probeInput(dir + "/nope.txt", opt).status == P::Status::Unsupported, "unsupported extension");
    check(P::probeInput(dir + "/x.mzML.gz", opt).status == P::Status::Unsupported, "compressed refused");
  }

  void dumps(const std::string& dir)
  {
    P::DumpOptions opt;
    opt.param = FASTag::cliDefaultParam(true);
    PeakMap exp;
    FileHandler().loadExperiment(dir + "/Ecoli_MS2_small.mzML", exp);
    std::size_t i = 0;
    while (i < exp.size() && exp[i].getMSLevel() != 2) ++i;
    const MSSpectrum& s = exp[i];
    const P::DumpOutput r = P::dumpSpectrum(dir + "/Ecoli_MS2_small.mzML", s.getNativeID(), opt);
    check(r.status == P::Status::Ok && r.found, "dump found " + s.getNativeID());
    const std::string rec = record(r.jsonl, "spectrum");
    check(rec == P::spectrumRecord(s, i, false, opt.param).substr(0, rec.size()), "dump equals the record of OpenMS's read");
    const P::DumpOutput mg = P::dumpSpectrum(dir + "/Ecoli_MS2_small.mgf", "index=" + std::to_string(i), opt);
    check(mg.found && field(record(mg.jsonl, "spectrum"), "mz") == field(rec, "mz"), "MGF twin: same peaks");
    const P::DumpOutput no = P::dumpSpectrum(dir + "/Ecoli_MS2_small.mzML", "scan=does-not-exist", opt);
    check(no.status == P::Status::Ok && !no.found && no.jsonl.empty(), "unknown id: not found, no stream");
  }
}

int main(int argc, char** argv)
{
  const std::string dir = argc > 1 ? argv[1] : FASTAG_TEST_DATA;
  json();
  header();
  records(dir);
  probes(dir);
  dumps(dir);
  if (failures)
  {
    std::cerr << failures << " failure(s)\n";
    return 1;
  }
  std::cout << "input_probe_test: all checks passed\n";
  return 0;
}
