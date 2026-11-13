// MgfReader against its own construction and against OpenMS's MascotGenericFile.
//
//  1. The block scan: identical offsets at every piece size, on a file built
//     to break a piece-local search (CRLF, a marker indented across a piece
//     boundary, a TITLE ending in BEGIN IONS on a boundary, stray END IONS, a
//     BOM, a 70 KiB header), and structural errors that name the LOWEST bad
//     block at every piece size. A lost BEGIN IONS (or both markers) is
//     counted, not dropped silently; the scan's peak memory per block.
//  2. Every block of the fixture against MascotGenericFile::load, bit for bit
//     on every field both read (and of any MGF given on the command line).
//  3. The fields where FASTag differs from OpenMS on purpose (CHARGE forms,
//     PEPMASS without a value, RT ranges and nan/inf, strict MSLEVEL,
//     comments, TITLE and SCANS sanitised).
//  4. Content errors: a ParseError naming block and byte offset, also for a
//     malformed FIRST peak line.
//  5. Per-thread copies read concurrently give the serial result; a large
//     block's buffer is released.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "MgfReader.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/DATASTRUCTURES/StringUtils.h>
#include <OpenMS/FORMAT/FileTypes.h>
#include <OpenMS/FORMAT/MascotGenericFile.h>
#include <OpenMS/KERNEL/MSExperiment.h>
#include <OpenMS/METADATA/IonSource.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <string>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif
#ifdef __linux__
#include <sys/resource.h>
#endif

using namespace OpenMS;
using FASTag::MgfReader;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }

  std::string tmp_path(const std::string& name)
  {
    // temp_directory_path honours TMPDIR on POSIX and TEMP/TMP on Windows,
    // where a literal "/tmp" does not exist.
    return (std::filesystem::temp_directory_path() / ("fastag-mgf-test-" + name)).string();
  }

  void write_file(const std::string& path, const std::string& bytes)
  {
    std::ofstream out(path, std::ios::binary);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
  }

  const std::vector<std::size_t> kChunks = {1024, 1500, 4096, 65536, std::size_t{4} << 20};

  /// The message of the ParseError @p f throws, or "" when it throws none.
  template <typename F> std::string parse_error(F&& f)
  {
    try
    {
      f();
    }
    catch (const Exception::ParseError& e)
    {
      return e.what();
    }
    catch (const std::exception& e)
    {
      return std::string("OTHER: ") + e.what();
    }
    return {};
  }

  bool has(const std::string& s, const std::string& what) { return s.find(what) != std::string::npos; }

  /// Builds an MGF and records where its blocks are.
  struct Builder
  {
    std::string bytes;
    std::vector<std::uint64_t> begin, end;
    void text(const std::string& s) { bytes += s; }
    void open(const std::string& line) { begin.push_back(bytes.size()); bytes += line; }
    void close(const std::string& line) { bytes += line; end.push_back(bytes.size()); }
  };

  // --------------------------------------------------------------------------
  void test_scan()
  {
    Builder b;
    b.text("\xEF\xBB\xBF");                               // BOM
    b.text("CHARGE=2+\r\nCOM=a file-level header\r\n");   // a Mascot default, not applied
    while (b.bytes.size() < 70 * 1024) b.text("# header padding line, to push the header past 64 KiB\r\n");
    b.text("END IONS\r\n");                                // stray, between blocks: ignored
    // 0: CRLF
    b.open("BEGIN IONS\r\n");
    b.text("TITLE=b0\r\nPEPMASS=500.25 1000\r\nCHARGE=2+\r\n100.5 10\r\n200.25 20\r\n");
    b.close("END IONS\r\n");
    b.text("text between blocks\r\nEND IONS  \t\r\n\r\n");
    // 1: markers indented by 5000 spaces, across several 1 KiB pieces
    b.open(std::string(5000, ' ') + "BEGIN IONS \t\r\n");
    b.text("TITLE=b1\nPEPMASS=600.5\n150.5 1\n");
    b.close(std::string(5000, ' ') + "END IONS\t \n");
    // 2: a TITLE whose "BEGIN IONS" starts exactly on a 4096-byte boundary
    b.open("BEGIN IONS   \n");
    {
      std::string title = "TITLE=x";
      while ((b.bytes.size() + title.size()) % 4096 != 0) title += 'x';
      b.text(title + "BEGIN IONS\n");
      check((b.bytes.size() - std::string("BEGIN IONS\n").size()) % 4096 == 0, "fixture: TITLE marker on a boundary");
    }
    b.text("PEPMASS=700.75\n250.5 2\n");
    b.close("END IONS");                                   // no newline at EOF... not yet:
    b.bytes += "\n";
    b.end.back() = b.bytes.size();
    // 3: the last block, no newline at EOF
    b.open("BEGIN IONS\n");
    b.text("TITLE=b3\nPEPMASS=800\n300.5 3\n");
    b.close("END IONS");

    const std::string path = tmp_path("scan.mgf");
    write_file(path, b.bytes);
    for (const std::size_t chunk : kChunks)
    {
      const auto blocks = MgfReader::scanBlocks(path, chunk);
      check(blocks.begin == b.begin, "begin offsets at chunk " + std::to_string(chunk));
      check(blocks.end == b.end, "end offsets at chunk " + std::to_string(chunk));
      check(blocks.data_start == 3, "BOM skipped at chunk " + std::to_string(chunk));
      check(blocks.stray_ends == 2 && blocks.first_stray_end == b.begin[0], "2 stray END IONS, the first just before block 0, at chunk " + std::to_string(chunk));
      check(blocks.loose_regions == 0, "header CHARGE=/COM= and 'text between blocks' do not look like spectra, at chunk " + std::to_string(chunk));
    }
    MgfReader r(path, 1024);
    check(r.getNrSpectra() == 4, "4 blocks");
    check(r.hasBom(), "hasBom");
    check(r.headerCharge(), "the file-level CHARGE= is seen");
    check(r.headerBytes() > MgfReader::HEADER_SCAN, "the header is longer than the scan");
    const MSSpectrum s0 = r.getSpectrum(0);
    check(s0.size() == 2 && s0[1].getMZ() == 200.25 && s0.getPrecursors()[0].getCharge() == 2, "block 0 read");
    check(s0.getPrecursors()[0].getIntensity() == 1000.0f, "PEPMASS intensity");
    const MSSpectrum s1 = r.getSpectrum(1);
    check(s1.size() == 1 && s1.getPrecursors()[0].getCharge() == 0, "block 1: no CHARGE, header default not applied");
    const MSSpectrum s2 = r.getSpectrum(2);
    check(s2.size() == 1 && s2.getPrecursors()[0].getMZ() == 700.75, "block 2 read whole");
    check(s2.getNativeID() == "index=2", "native id index=2");
    const MSSpectrum s3 = r.getSpectrum(3);
    check(s3.size() == 1 && s3[0].getMZ() == 300.5, "block 3 read at EOF without newline");
    std::remove(path.c_str());

    // A header with CHARGE= only after 64 KiB is not looked at.
    {
      std::string late(70 * 1024, '#');
      late += "\nCHARGE=3+\nBEGIN IONS\nPEPMASS=1\n1 1\nEND IONS\n";
      const std::string p = tmp_path("late.mgf");
      write_file(p, late);
      MgfReader lr(p);
      check(!lr.headerCharge() && !lr.hasBom(), "CHARGE= beyond the header scan is not seen");
      std::remove(p.c_str());
    }

    // A lost BEGIN IONS line, or both markers: the spectrum between the
    // blocks is ignored (as in OpenMS) but counted, with where it starts.
    {
      const std::string blk = "BEGIN IONS\nTITLE=t\nPEPMASS=500\nCHARGE=2+\n100 1\n200 2\nEND IONS\n";
      const std::string headless = "TITLE=lost\nPEPMASS=600\nCHARGE=2+\n100 1\nEND IONS\n";
      const std::string bare = "\nTITLE=bare\nPEPMASS=700\n100 1\n\n";
      const std::string pad(3000, '#');
      struct Lost { std::string name, bytes; std::size_t blocks, stray, loose; std::uint64_t first_loose; };
      const std::vector<Lost> lost = {
          {"BEGIN IONS lost mid-file", blk + pad + "\n" + headless + blk, 2, 1, 1, blk.size() + pad.size() + 1},
          {"BEGIN IONS of block 0 lost", headless + blk + blk, 2, 1, 1, 0},
          {"both markers lost", blk + bare + blk, 2, 0, 1, blk.size() + 1},
          {"peak lines in the header", "COM=x\n  100 1\n" + blk, 1, 0, 1, 8},
          {"nothing lost", "COM=x\nCHARGE=2+\n" + blk + "\n\n" + blk + "\n", 2, 0, 0, 0},
      };
      for (const Lost& c : lost)
      {
        const std::string p = tmp_path("lost.mgf");
        write_file(p, c.bytes);
        for (const std::size_t chunk : kChunks)
        {
          const auto bl = MgfReader::scanBlocks(p, chunk);
          const std::string at = c.name + " at chunk " + std::to_string(chunk);
          check(bl.begin.size() == c.blocks, at + ": blocks");
          check(bl.stray_ends == c.stray, at + ": stray END IONS " + std::to_string(bl.stray_ends));
          check(bl.loose_regions == c.loose && (c.loose == 0 || bl.first_loose == c.first_loose),
                at + ": spectrum-like text " + std::to_string(bl.loose_regions) + " at " + std::to_string(bl.first_loose));
        }
        std::remove(p.c_str());
      }
    }

    // Structural errors: the LOWEST bad block, at every piece size.
    const std::string good = "BEGIN IONS\nTITLE=good\nPEPMASS=500\n100 1\n200 2\nEND IONS\n";
    const std::string pad(3000, '#');
    struct Case { std::string name, bytes, expect; std::uint64_t cap; };
    std::vector<Case> cases;
    {
      // Block 1 runs into block 2's BEGIN; block 3 runs into EOF.
      std::string s = good + pad + "\n" + "BEGIN IONS\nTITLE=bad1\nPEPMASS=1\n1 1\n" + pad + "\n" + good + pad +
                      "\nBEGIN IONS\nTITLE=bad3\n1 1\n";
      cases.push_back({"END IONS missing mid-file", s, "MGF block 1 (byte " + std::to_string(good.size() + pad.size() + 1) + ", TITLE=bad1)", MgfReader::MAX_BLOCK_BYTES});
    }
    cases.push_back({"END IONS missing at EOF", good + pad + "\n" + good + "BEGIN IONS\nTITLE=bad2\n1 1\n",
                     "MGF block 2 ", MgfReader::MAX_BLOCK_BYTES});
    {
      std::string big = "BEGIN IONS\nTITLE=big\n" + std::string(200, '#') + "\nEND IONS\n";
      cases.push_back({"block over the cap", good + pad + "\n" + big + pad + "\n" + big, "MGF block 1 ", 120});
    }
    for (const Case& c : cases)
    {
      const std::string p = tmp_path("structural.mgf");
      write_file(p, c.bytes);
      for (const std::size_t chunk : kChunks)
      {
        const std::string msg = parse_error([&] { MgfReader::scanBlocks(p, chunk, c.cap); });
        check(has(msg, c.expect), c.name + " at chunk " + std::to_string(chunk) + ": got '" + msg + "'");
      }
      std::remove(p.c_str());
    }
    for (const std::string& empty : {std::string(), std::string("not an mgf\nEND IONS\n"), std::string("\xEF\xBB\xBF")})
    {
      const std::string p = tmp_path("empty.mgf");
      write_file(p, empty);
      bool thrown = false;
      try { MgfReader::scanBlocks(p); } catch (const Exception::FileEmpty&) { thrown = true; }
      check(thrown, "no block -> FileEmpty ('" + empty.substr(0, 10) + "')");
      std::remove(p.c_str());
    }
  }

  // --------------------------------------------------------------------------
  bool same_bits(float a, float b) { return std::memcmp(&a, &b, sizeof a) == 0; }
  bool same_bits(double a, double b) { return std::memcmp(&a, &b, sizeof a) == 0; }

  bool same_peaks(const MSSpectrum& a, const MSSpectrum& b)
  {
    if (a.size() != b.size()) return false;
    for (Size j = 0; j < a.size(); ++j)
      if (!same_bits(a[j].getMZ(), b[j].getMZ()) || !same_bits(a[j].getIntensity(), b[j].getIntensity())) return false;
    return true;
  }

  /// Every block of @p path against MascotGenericFile::load; @p expect blocks
  /// (0: any number, as long as OpenMS reads as many).
  void test_against_openms(const std::string& path, Size expect)
  {
    PeakMap ref;
    MascotGenericFile().load(path, ref);
    MgfReader r(path);
    check(r.getNrSpectra() == ref.size() && (expect == 0 || ref.size() == expect),
          std::to_string(r.getNrSpectra()) + " blocks, as OpenMS reads (" + std::to_string(ref.size()) + ")");
    for (Size i = 0; i < std::min<Size>(r.getNrSpectra(), ref.size()); ++i)
    {
      const MSSpectrum s = r.getSpectrum(i);
      const MSSpectrum& o = ref[i];
      const std::string at = " at block " + std::to_string(i);
      check(same_peaks(s, o), "peaks bit-identical" + at);
      check(s.getPrecursors().size() == 1 && o.getPrecursors().size() == 1, "one precursor" + at);
      const Precursor& p = s.getPrecursors()[0];
      const Precursor& q = o.getPrecursors()[0];
      check(same_bits(p.getMZ(), q.getMZ()) && same_bits(p.getIntensity(), q.getIntensity()), "precursor" + at);
      check(p.getCharge() == q.getCharge(), "charge" + at);
      check(s.getMSLevel() == o.getMSLevel(), "MS level" + at);
      check(s.getNativeID() == o.getNativeID(), "native id" + at);
      check(s.getType() == o.getType(), "centroid" + at);
      check(StringUtils::toStr(s.getMetaValue("Scan_ID")) == StringUtils::toStr(o.getMetaValue("Scan_ID")), "SCANS" + at);
      const std::string t = StringUtils::toStr(s.getMetaValue("TITLE"));
      if (t.find("min") == std::string::npos)
      {
        check(same_bits(s.getRT(), o.getRT()), "RT" + at);
        check(t + "_" + s.getNativeID() == StringUtils::toStr(o.getMetaValue("TITLE")),
              "TITLE is OpenMS's without its _index suffix" + at);
      }
    }
    if (expect == 0)
    {
      std::cout << path << ": " << r.getNrSpectra() << " blocks compared with MascotGenericFile, "
                << failures << " failure(s)\n";
      return;
    }
    check(r.counts().no_pepmass == 0 && r.counts().titles_sanitised == 0, "fixture: nothing counted");
    const SourceFile& sf = r.settings().getSourceFiles().at(0);
    check(sf.getNameOfFile() == "Ecoli_MS2_small.mgf" && sf.getNativeIDTypeAccession() == "MS:1000774" &&
              sf.getFileType() == FileTypes::typeToMZML(FileTypes::MGF),
          "SourceFile: name, MS:1000774, OpenMS's MGF file type (got '" + sf.getFileType() + "')");
  }

  // --------------------------------------------------------------------------
  MSSpectrum parse(const std::string& body, MgfReader::Counts& c, Size index = 0)
  {
    MSSpectrum s;
    MgfReader::parseBlock("BEGIN IONS\n" + body + "END IONS\n", index, 0, "test", s, c);
    return s;
  }
  MSSpectrum parse(const std::string& body)
  {
    MgfReader::Counts c;
    return parse(body, c);
  }

  void test_fields()
  {
    const std::string peaks = "PEPMASS=500.5\n100 1\n";
    const auto charge = [&](const std::string& v) { return parse("CHARGE=" + v + "\n" + peaks).getPrecursors()[0]; };
    check(charge("2").getCharge() == 2 && charge("2+").getCharge() == 2 && charge("+2").getCharge() == 2, "CHARGE 2, 2+, +2");
    for (const std::string v : {"3-", "-3", "-3-"})
    {
      const MSSpectrum s = parse("CHARGE=" + v + "\n" + peaks);
      check(s.getPrecursors()[0].getCharge() == 3 &&
                s.getInstrumentSettings().getPolarity() == IonSource::Polarity::NEGATIVE,
            "CHARGE " + v + " -> 3, negative polarity");
    }
    check(parse("CHARGE=2+\n" + peaks).getInstrumentSettings().getPolarity() != IonSource::Polarity::NEGATIVE,
          "positive charge leaves polarity alone");
    check(charge("0").getCharge() == 0 && charge("0").getPossibleChargeStates().empty(), "CHARGE 0");
    for (const std::string v : {"2+ and 3+", "2+,3+", "2, 3"})
    {
      const Precursor p = charge(v);
      check(p.getCharge() == 0 && p.getPossibleChargeStates() == std::vector<Int>({2, 3}),
            "CHARGE " + v + " -> 0 with possible 2, 3");
    }
    check(parse(peaks).getPrecursors()[0].getCharge() == 0, "no CHARGE -> 0");

    {
      MgfReader::Counts c;
      const MSSpectrum s = parse("PEPMASS=500.5 1234.5\n100 1\n", c);
      check(s.getPrecursors()[0].getMZ() == 500.5 && s.getPrecursors()[0].getIntensity() == 1234.5f && c.no_pepmass == 0,
            "PEPMASS with intensity");
      parse("100 1\n", c);
      parse("PEPMASS=nan\n100 1\n", c);
      const MSSpectrum m = parse("100 1\n");
      check(c.no_pepmass == 2 && m.getPrecursors().size() == 1 && m.getPrecursors()[0].getMZ() == 0,
            "PEPMASS missing or nan: one precursor at m/z 0, counted");
    }
    check(parse("RTINSECONDS=10.5-11.5\n" + peaks).getRT() == 11.0, "RT range -> midpoint");
    check(parse("RTINSECONDS=42.25\n" + peaks).getRT() == 42.25, "RT");
    check(parse(peaks).getRT() == MSSpectrum().getRT(), "no RT -> OpenMS's unset RT");
    check(parse("MSLEVEL=1\n" + peaks).getMSLevel() == 1, "MSLEVEL 1");
    check(parse(peaks).getMSLevel() == 2, "MS level 2 by default");
    check(has(parse_error([&] { parse("MSLEVEL=2abc\n" + peaks); }), "MSLEVEL"), "MSLEVEL 2abc is an error");

    {
      const MSSpectrum e = parse("PEPMASS=500\n");
      check(e.empty() && e.getPrecursors().size() == 1, "empty block -> empty spectrum with a precursor");
    }
    {
      const MSSpectrum s = parse("# comment\n; comment\nPEPMASS=500\nUNKNOWN=x\nnot a key\n100\t1\n! comment\n200  2 1+\n/ c\n300 3 2 extra\n");
      check(s.size() == 3 && s[1].getMZ() == 200 && s[2].getIntensity() == 3.0f, "comments, tabs, 3-column peaks, unknown keys");
      check(s[0].getMZ() == 100 && s.getNativeID() == "index=0", "peak order and native id");
    }
    {
      MgfReader::Counts c;
      const MSSpectrum s = parse(std::string("TITLE=  a\x01" "b\xff" "c\tok\n") + peaks, c);
      check(StringUtils::toStr(s.getMetaValue("TITLE")) == "a?b?c\tok" && c.titles_sanitised == 1,
            "TITLE trimmed, control byte and invalid UTF-8 replaced, counted");
      const MSSpectrum u = parse("TITLE=caf\xc3\xa9 10.5 min, x\n" + peaks, c);
      check(StringUtils::toStr(u.getMetaValue("TITLE")) == "caf\xc3\xa9 10.5 min, x" && u.getRT() == MSSpectrum().getRT(),
            "valid UTF-8 kept, TITLE never parsed for RT");
    }
    {
      // A 64 KiB TITLE is kept whole, and cut in a message.
      const std::string big(64 * 1024, 'T');
      const std::string msg = parse_error([&] { parse("TITLE=" + big + "\nPEPMASS=x\n"); });
      check(has(msg, "TITLE=" + std::string(MgfReader::TITLE_IN_MESSAGES, 'T') + "...)"), "long TITLE cut to 120 bytes in a message");
      check(StringUtils::toStr(parse("TITLE=" + big + "\n" + peaks).getMetaValue("TITLE")).size() == big.size(), "long TITLE kept");
    }
    check(parse("SCANS=17\n" + peaks).getMetaValue("Scan_ID") == "17", "SCANS -> Scan_ID");
    {
      // SCANS goes to -out_spectra's XML like TITLE: a control byte there made
      // the mzML not well-formed.
      MgfReader::Counts c;
      const MSSpectrum s = parse(std::string("SCANS=1\x01\n") + peaks, c);
      check(StringUtils::toStr(s.getMetaValue("Scan_ID")) == "1?" && c.scans_sanitised == 1 && c.titles_sanitised == 0,
            "SCANS control byte replaced, counted");
    }
    {
      // A non-finite RTINSECONDS: RT unset (an mzML would carry "nan"), counted.
      MgfReader::Counts c;
      for (const std::string v : {"nan", "NaN", "inf", "-inf", "nan-5", "5-inf"})
        check(parse("RTINSECONDS=" + v + "\n" + peaks, c).getRT() == MSSpectrum().getRT(), "RTINSECONDS=" + v + " -> unset");
      check(c.rt_not_finite == 6, "non-finite RTs counted (" + std::to_string(c.rt_not_finite) + ")");
      parse("RTINSECONDS=1e300\n" + peaks, c);
      check(c.rt_not_finite == 6, "a finite RT is not counted");
    }
    {
      // Blocks without their own CHARGE, for the header-CHARGE warning.
      MgfReader::Counts c;
      parse(peaks, c);
      parse("CHARGE=2+\n" + peaks, c);
      parse("CHARGE=0\n" + peaks, c);
      check(c.no_charge_key == 1, "one block without CHARGE counted (" + std::to_string(c.no_charge_key) + ")");
    }
  }

  // --------------------------------------------------------------------------
  void test_content_errors()
  {
    const auto err = [](const std::string& body) {
      return parse_error([&] {
        MSSpectrum s;
        MgfReader::Counts c;
        MgfReader::parseBlock("BEGIN IONS\nTITLE=t7\n" + body + "END IONS\n", 7, 1234, "x.mgf", s, c);
      });
    };
    const struct { const char* name; std::string body, what; } cases[] = {
        {"non-numeric peak", "PEPMASS=500\n100x 1\n", "does not start with a number"},
        {"non-numeric intensity", "PEPMASS=500\n100 abc\n", "intensity"},
        {"one-value peak line", "PEPMASS=500\n100\n", "has one value"},
        {"non-numeric PEPMASS", "PEPMASS=abc\n100 1\n", "PEPMASS"},
        {"three PEPMASS values", "PEPMASS=1 2 3\n100 1\n", "PEPMASS"},
        {"bad CHARGE", "CHARGE=2+x\nPEPMASS=500\n100 1\n", "CHARGE"},
        {"bad CHARGE sign", "CHARGE=+2-\nPEPMASS=500\n100 1\n", "CHARGE"},
        {"key after peaks", "PEPMASS=500\n100 1\nCHARGE=2+\n", "follows the peaks"},
        {"bad RT", "RTINSECONDS=soon\nPEPMASS=500\n100 1\n", "RTINSECONDS"},
        {"second BEGIN IONS", "PEPMASS=500\nBEGIN IONS\n100 1\n", "second BEGIN IONS"},
        // A malformed FIRST peak line was skipped silently (as text before
        // the peaks), while the same line later was an error.
        {"first peak nan", "PEPMASS=500\nnan 5\n100 1\n", "looks like a peak line"},
        {"first peak inf", "PEPMASS=500\ninf 5\n100 1\n", "looks like a peak line"},
        {"first peak INF", "PEPMASS=500\nINF 5\n100 1\n", "looks like a peak line"},
        {"first peak Infinity", "PEPMASS=500\nInfinity 5\n", "looks like a peak line"},
        {"first peak negative", "PEPMASS=500\n-100 5\n100 1\n", "looks like a peak line"},
        {"first peak .5", "PEPMASS=500\n.5 5\n100 1\n", "looks like a peak line"},
        {"first peak +200", "PEPMASS=500\n+200 5\n100 1\n", "looks like a peak line"},
        {"only peak nan", "PEPMASS=500\nnan 5\n", "looks like a peak line"},
        {"later peak nan", "PEPMASS=500\n100 1\nnan 5\n", "looks like a peak line"},
        {"later peak negative", "PEPMASS=500\n100 1\n-100 5\n", "looks like a peak line"},
    };
    for (const auto& c : cases)
    {
      const std::string msg = err(c.body);
      check(has(msg, "MGF block 7 (byte 1234, TITLE=t7): ") && has(msg, c.what) && has(msg, "x.mgf"),
            std::string(c.name) + ": got '" + msg + "'");
    }
  }

  // --------------------------------------------------------------------------
  /// The scan's peak memory per block, on many tiny blocks: it held about
  /// 68 bytes per block (two 24-byte markers, and the offsets doubling on
  /// top). Now one word per marker and offsets sized once: about 32. Linux
  /// only (ru_maxrss); run first, while the process peak is still its RSS.
  void test_scan_memory()
  {
#ifdef __linux__
    const std::size_t n = 2'000'000;
    const std::string blk = "BEGIN IONS\nPEPMASS=500.25\nCHARGE=2+\n100.1 1\n200.2 2\nEND IONS\n";
    const std::string p = tmp_path("tiny.mgf");
    {
      std::ofstream out(p, std::ios::binary);
      std::string chunk;
      for (std::size_t k = 0; k < 1000; ++k) chunk += blk;
      for (std::size_t k = 0; k < n / 1000; ++k) out.write(chunk.data(), static_cast<std::streamsize>(chunk.size()));
    }
    const auto peak_kib = [] { rusage u{}; getrusage(RUSAGE_SELF, &u); return static_cast<double>(u.ru_maxrss); };
    const double before = peak_kib();
    // 1 MiB pieces: the read buffers (one per thread) stay small next to the
    // markers.
    const auto bl = MgfReader::scanBlocks(p, std::size_t{1} << 20);
    const double per_block = (peak_kib() - before) * 1024.0 / static_cast<double>(n);
    check(bl.begin.size() == n && bl.stray_ends == 0 && bl.loose_regions == 0, "tiny blocks scanned");
    // 32 bytes per block plus up to 16 MiB of buffers (8 B/block here).
    check(per_block < 48.0, "the scan's peak is " + std::to_string(per_block) + " bytes per block, expected < 48");
    std::cout << "scan peak: " << per_block << " bytes per block over " << n << " blocks\n";
    std::remove(p.c_str());
#endif
  }

  // --------------------------------------------------------------------------
  void test_concurrency()
  {
    const std::string path = std::string(FASTAG_TEST_DATA) + "/Ecoli_MS2_small.mgf";
    MgfReader serial(path);
    const Size n = serial.getNrSpectra();
    std::vector<MSSpectrum> want(n), got(n);
    for (Size i = 0; i < n; ++i) want[i] = serial.getSpectrum(i);
    std::vector<Size> order(n);
    for (Size i = 0; i < n; ++i) order[i] = i;
    std::shuffle(order.begin(), order.end(), std::mt19937(7));
    const int threads = 8;
    std::vector<std::unique_ptr<MgfReader>> copies;
    for (int t = 0; t < threads; ++t) copies.push_back(std::make_unique<MgfReader>(serial));
#pragma omp parallel for num_threads(threads) schedule(dynamic, 1)
    for (long k = 0; k < static_cast<long>(n); ++k)
    {
      int t = 0;
#ifdef _OPENMP
      t = omp_get_thread_num();
#endif
      got[order[static_cast<Size>(k)]] = copies[static_cast<size_t>(t)]->getSpectrum(order[static_cast<Size>(k)]);
    }
    bool same = true;
    for (Size i = 0; i < n; ++i)
      same = same && same_peaks(want[i], got[i]) && want[i].getNativeID() == got[i].getNativeID() &&
             want[i].getPrecursors()[0] == got[i].getPrecursors()[0];
    check(same, "8 threads in random order read what one thread reads");

    // A 5 MiB block: read, then its buffer is released.
    std::string big = "BEGIN IONS\nPEPMASS=500\n";
    while (big.size() < (std::size_t{5} << 20)) big += "123.456789 1000.5\n";
    big += "END IONS\nBEGIN IONS\nPEPMASS=600\n100 1\nEND IONS\n";
    const std::string p = tmp_path("big.mgf");
    write_file(p, big);
    MgfReader r(p);
    const MSSpectrum s = r.getSpectrum(0);
    check(s.size() > 200000, "large block read");
    check(r.bufferCapacity() <= (std::size_t{4} << 20), "the buffer is released after a large block");
    r.getSpectrum(1);
    check(r.bufferCapacity() < 4096, "a small block keeps a small buffer");
    std::remove(p.c_str());
  }
}

int main(int argc, char** argv)
{
  // Given MGF files, compare each with OpenMS block by block (not part of
  // ctest: needs real data).
  if (argc > 1)
  {
    for (int i = 1; i < argc; ++i) test_against_openms(argv[i], 0);
    return failures ? 1 : 0;
  }
  test_scan_memory();
  test_scan();
  test_against_openms(std::string(FASTAG_TEST_DATA) + "/Ecoli_MS2_small.mgf", 139);
  test_fields();
  test_content_errors();
  test_concurrency();
  if (failures)
  {
    std::cerr << failures << " check(s) failed\n";
    return 1;
  }
  std::cout << "mgf_reader_test: all checks passed\n";
  return 0;
}
