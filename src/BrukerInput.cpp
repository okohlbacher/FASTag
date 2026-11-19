// Bruker timsTOF input (see BrukerInput.h).
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $

#include "BrukerInput.h"

#include <OpenMS/CONCEPT/Exception.h>
#include <OpenMS/DATASTRUCTURES/StringUtils.h>
#include <OpenMS/FORMAT/SqliteConnector.h>
#include <OpenMS/FORMAT/ZipArchiveFile.h>
#include <OpenMS/SYSTEM/File.h>
#include <OpenMS/SYSTEM/SystemSettings.h>
#include <OpenMS/SYSTEM/TempFiles.h>
#include <OpenMS/config.h>
#ifdef WITH_OPENTIMS
#include <OpenMS/FORMAT/BrukerTimsFile.h>
#endif

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <memory>
#include <sstream>
#include <system_error>
#include <vector>

using namespace OpenMS;

namespace FASTag::Bruker
{
  namespace
  {
    bool endsWith(const std::string& s, const char* suffix)
    {
      return StringUtils::hasSuffix(StringUtils::toLowered(s), suffix);
    }

    // The entry of analysis.tdf the reader would read: in a directory '*.d',
    // the shallowest, not below __MACOSX (as BrukerTimsFile::unpack_() picks
    // its .d directory). Empty if there is none.
    std::string tdfEntry(const std::vector<std::string>& entries)
    {
      std::string best;
      long best_depth = -1;
      for (const std::string& e : entries)
      {
        if (e.find("__MACOSX") != std::string::npos) continue;
        const std::string name = "analysis.tdf";
        if (e.size() < name.size() + 3 || e.compare(e.size() - name.size(), name.size(), name) != 0) continue;
        const std::string dir = e.substr(0, e.size() - name.size());  // ends in '/'
        if (dir.empty() || dir.back() != '/' || !endsWith(dir.substr(0, dir.size() - 1), ".d")) continue;
        const long depth = static_cast<long>(std::count(e.begin(), e.end(), '/'));
        if (best_depth < 0 || depth < best_depth || (depth == best_depth && e < best))
        {
          best = e;
          best_depth = depth;
        }
      }
      return best;
    }

    // Rows of a derived table: SqliteConnector counts "SELECT count(*) FROM <table>",
    // and a parenthesised SELECT is a table there.
    std::size_t count(SqliteConnector& db, const std::string& select)
    {
      return db.countTableRows("(" + select + ")");
    }

    std::string fmt(double v)
    {
      std::ostringstream o;
      o.setf(std::ios::fixed);
      o.precision(2);
      o << v;
      std::string s = o.str();
      if (s.find('.') != std::string::npos)
      {
        while (!s.empty() && s.back() == '0') s.pop_back();
        if (!s.empty() && s.back() == '.') s.pop_back();
      }
      return s;
    }
  }

  bool supported()
  {
#ifdef WITH_OPENTIMS
    return true;
#else
    return false;
#endif
  }

  std::string normalizePath(const std::string& path)
  {
    std::string p = path;
    while (p.size() > 1 && (p.back() == '/' || p.back() == '\\')) p.pop_back();
    return p;
  }

  bool isBrukerPath(const std::string& path)
  {
    const std::string p = normalizePath(path);
    if (endsWith(p, ".d.zip")) return true;
    return endsWith(p, ".d") && File::isDirectory(p);
  }

  std::string runName(const std::string& path)
  {
    std::string b = File::basename(normalizePath(path));
    for (const char* ext : {".d.zip", ".d"})
    {
      if (endsWith(b, ext))
      {
        b.resize(b.size() - std::string(ext).size());
        break;
      }
    }
    return b;
  }

  TdfFacts facts(const std::string& path_in)
  {
    TdfFacts f;
    const std::string path = normalizePath(path_in);
    std::unique_ptr<TempDir> tmp;  // holds an extracted analysis.tdf, removed on return
    std::string tdf;
    try
    {
      if (File::isDirectory(path))
      {
        tdf = path + "/analysis.tdf";
        if (!File::exists(tdf))
        {
          f.tsf = File::exists(path + "/analysis.tsf");
          f.error = f.tsf ? "'" + path + "' holds timsTOF data without ion mobility (analysis.tsf), "
                            "which FASTag does not read; convert it to mzML first."
                          : "'" + path + "' has no analysis.tdf: not a timsTOF .d directory.";
          return f;
        }
      }
      else
      {
        std::vector<std::string> entries;
        if (!ZipArchiveFile::listEntries(path, entries))
        {
          f.error = "'" + path + "' cannot be read as a ZIP archive.";
          return f;
        }
        const std::string entry = tdfEntry(entries);
        if (entry.empty())
        {
          const bool tsf = std::any_of(entries.begin(), entries.end(), [](const std::string& e) {
            return StringUtils::hasSuffix(e, "/analysis.tsf");
          });
          f.tsf = tsf;
          f.error = tsf ? "'" + path + "' holds timsTOF data without ion mobility (analysis.tsf), "
                          "which FASTag does not read; convert it to mzML first."
                        : "'" + path + "' holds no .d directory with analysis.tdf.";
          return f;
        }
        tdf = ZipArchiveFile::extractEntryToTempFile(path, entry, tmp);
      }

      SqliteConnector db(tdf, SqliteConnector::SqlOpenMode::READ_ONLY);
      if (!db.tableExists("Frames"))
      {
        f.error = "'" + path + "': analysis.tdf has no Frames table.";
        return f;
      }
      f.frames = db.countTableRows("Frames");
      f.ms1_frames = count(db, "SELECT 1 FROM Frames WHERE MsMsType = 0");
      f.pasef_frames = count(db, "SELECT 1 FROM Frames WHERE MsMsType = 8");
      f.dia_frames = count(db, "SELECT 1 FROM Frames WHERE MsMsType = 9");
      f.other_ms2_frames = f.frames - f.ms1_frames - f.pasef_frames - f.dia_frames;
      if (db.tableExists("Precursors"))
      {
        f.precursors = db.countTableRows("Precursors");
        f.precursors_no_charge = count(db, "SELECT 1 FROM Precursors WHERE Charge IS NULL OR Charge = 0");
        f.precursors_no_mono = count(db, "SELECT 1 FROM Precursors WHERE MonoisotopicMz IS NULL");
      }
      if (db.tableExists("DiaFrameMsMsWindows"))
      {
        f.dia_windows = db.countTableRows("DiaFrameMsMsWindows");
        if (f.dia_windows > 0)
        {
          // The median isolation width by bisection on counts (the connector
          // returns counts only): the smallest w with at least half the rows
          // at or below it, to 0.005 Th.
          const std::size_t half = (f.dia_windows + 1) / 2;
          double lo = 0, hi = 10000;
          for (int i = 0; i < 24; ++i)
          {
            const double mid = (lo + hi) / 2;
            const std::size_t n = count(db, "SELECT 1 FROM DiaFrameMsMsWindows WHERE IsolationWidth <= "
                                                + std::to_string(mid));
            (n >= half ? hi : lo) = mid;
          }
          f.dia_median_width = hi;
        }
      }
      f.ok = true;
    }
    catch (const Exception::BaseException& e)
    {
      f.ok = false;
      f.error = "'" + path + "': cannot read analysis.tdf (" + std::string(e.what()) + ").";
    }
    catch (const std::exception& e)
    {
      f.ok = false;
      f.error = "'" + path + "': cannot read analysis.tdf (" + std::string(e.what()) + ").";
    }
    return f;
  }

  std::string checkTempSpace(const std::string& path_in, std::string& tmp_dir, std::uintmax_t& free_bytes)
  {
    const std::string path = normalizePath(path_in);
    tmp_dir = SystemSettings::getTempDirectory();
    free_bytes = 0;
    if (File::isDirectory(path)) return {};
    std::error_code ec;
    const std::filesystem::space_info si = std::filesystem::space(tmp_dir, ec);
    if (ec) return {};  // unknown: OpenMS's own check decides
    free_bytes = si.available;
    const std::uintmax_t archive = File::fileSize(path);
    const std::uintmax_t need = archive + archive / 2;
    if (free_bytes < need)
    {
      const auto gb = [](std::uintmax_t b) { return fmt(static_cast<double>(b) / 1e9); };
      return "'" + path + "' (" + gb(archive) + " GB) is unpacked in full for reading, into the temporary "
             "directory '" + tmp_dir + "', which has " + gb(free_bytes) + " GB free; it needs about " +
             gb(need) + " GB. Point OPENMS_TMPDIR at a local disk with more space (or unzip the run "
             "and give the .d directory).";
    }
    return {};
  }

  namespace
  {
    LoadStats load(const std::string& path_in, PeakMap& exp, std::uint32_t max_frames)
    {
      LoadStats s;
#ifdef WITH_OPENTIMS
      const std::string path = normalizePath(path_in);
      const auto t0 = std::chrono::steady_clock::now();
      BrukerTimsFile reader;
      reader.setLogType(ProgressLogger::NONE);
      BrukerTimsFile::Config c;
      c.load_ms1 = false;  // MS2 only: the MS1 frames are neither decoded nor kept
      if (max_frames > 0) c.frame_id_max = max_frames;
      reader.load(path, exp, c);
      s.seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      for (const MSSpectrum& sp : exp)
      {
        if (sp.getMSLevel() != 2) continue;
        ++s.spectra;
        if (sp.getPrecursors().empty() || sp.getPrecursors().front().getCharge() == 0) ++s.charge_unknown;
      }
#else
      static_cast<void>(path_in);
      static_cast<void>(exp);
      static_cast<void>(max_frames);
      throw Exception::NotImplemented(__FILE__, __LINE__, OPENMS_PRETTY_FUNCTION);
#endif
      return s;
    }
  }

  LoadStats loadMs2(const std::string& path, PeakMap& exp) { return load(path, exp, 0); }

  LoadStats loadMs2Head(const std::string& path, PeakMap& exp, std::uint32_t max_frames)
  {
    return load(path, exp, std::max<std::uint32_t>(1, max_frames));
  }

  std::string diaRefusalMessage(const TdfFacts& f, const std::string& in)
  {
    return "'" + in + "' is dia-PASEF: analysis.tdf lists " + std::to_string(f.dia_windows) +
           " isolation windows (median width " + fmt(f.dia_median_width) + " Th) and " +
           std::to_string(f.dia_frames) + " DIA MS/MS frames. Each MS2 mixes several peptides and its "
           "'precursor' is a window, so tags would get wrong flanking masses and complement statistics. "
           "Generate pseudo-DDA spectra first (diaTracer reads .d), then run FASTag on that file. To tag the "
           "raw DIA spectra anyway (experts; flanks and complements will be wrong), add -acquisition_check warn.";
  }

  std::string diaRefusalSentinel(const TdfFacts& f)
  {
    return "FASTAG_REFUSED reason=raw_dia windows=" + std::to_string(f.dia_windows) +
           " median_width=" + fmt(f.dia_median_width);
  }
}
