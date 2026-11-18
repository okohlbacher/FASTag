#!/usr/bin/env python3
"""Trim a real timsTOF DDA-PASEF run (.d) to a small test fixture.

    python3 -I make_bruker_fixture.py <run.d> <out.d> <first_frame> <n_frames> [--dia]

Keeps the frames first_frame .. first_frame+n_frames-1 of <run.d>, renumbered
from 1, with their frame data copied byte for byte from analysis.tdf_bin
(no re-compression). MS1 frames are kept as rows but their data is dropped
(NumPeaks 0, an 8-byte frame header): FASTag reads MS2 only, and this keeps
the fixture small. A precursor is kept only when every one of its
PasefFrameMsMsInfo rows lies in the range, so no MS2 spectrum is partial.
Every table with a Frame column is cut to the range; calibration and
metadata tables are kept as they are. The database is vacuumed.

--dia adds a DiaFrameMsMsWindows table with two 25-Th windows, which makes
the run look like dia-PASEF to an analysis.tdf reader (for the refusal test;
the frames stay DDA-PASEF).

The fixture in test/fixtures/bruker/ was made from PXD040281 (PRIDE, public),
20220224_TIMS02_ThNo_SA_02_N756_DDA_120min_Glycerol_DVP_C2_1_8962.d, with the
arguments recorded in test/fixtures/README.md (Bruker timsTOF fixture).

Standard library only.
"""
import os
import shutil
import sqlite3
import struct
import sys


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dia = "--dia" in sys.argv[1:]
    if len(args) != 4:
        sys.exit(__doc__)
    src, out, first, n = args[0], args[1], int(args[2]), int(args[3])
    last = first + n - 1
    if first <= n:
        sys.exit("first_frame must exceed n_frames (the renumbering shifts Ids down in place)")
    if os.path.exists(out):
        sys.exit("refusing to overwrite " + out)
    os.makedirs(out)
    shutil.copyfile(os.path.join(src, "analysis.tdf"), os.path.join(out, "analysis.tdf"))
    db = sqlite3.connect(os.path.join(out, "analysis.tdf"))
    c = db.cursor()

    frames = c.execute("SELECT Id, TimsId, MsMsType FROM Frames WHERE Id BETWEEN ? AND ? ORDER BY Id",
                       (first, last)).fetchall()
    if len(frames) != n:
        sys.exit("frame range not dense in the source")
    newid = {old: i + 1 for i, (old, _, _) in enumerate(frames)}

    # Precursors entirely inside the range.
    c.execute("CREATE TEMP TABLE keep_prec AS SELECT Precursor AS Id FROM PasefFrameMsMsInfo "
              "GROUP BY Precursor HAVING MIN(Frame) >= ? AND MAX(Frame) <= ?", (first, last))
    c.execute("DELETE FROM PasefFrameMsMsInfo WHERE Precursor NOT IN (SELECT Id FROM keep_prec)")
    c.execute("DELETE FROM Precursors WHERE Id NOT IN (SELECT Id FROM keep_prec)")

    # Every table with a Frame column: cut and renumber.
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    for t in tables:
        cols = [r[1] for r in c.execute("PRAGMA table_info(%s)" % t)]
        if t != "Frames" and "Frame" in cols:
            c.execute("DELETE FROM %s WHERE Frame < ? OR Frame > ?" % t, (first, last))
            c.execute("UPDATE %s SET Frame = Frame - ?" % t, (first - 1,))
    c.execute("UPDATE Precursors SET Parent = CASE WHEN Parent BETWEEN ? AND ? THEN Parent - ? ELSE NULL END",
              (first, last, first - 1))
    if "Segments" in tables:
        c.execute("UPDATE Segments SET FirstFrame = 1, LastFrame = ?", (n,))
        c.execute("DELETE FROM Segments WHERE Id <> (SELECT MIN(Id) FROM Segments)")

    # Frame data, copied; MS1 data dropped.
    binsrc = open(os.path.join(src, "analysis.tdf_bin"), "rb")
    binout = open(os.path.join(out, "analysis.tdf_bin"), "wb")
    offset = 0
    rows = []
    for old, tims_id, msms in frames:
        binsrc.seek(tims_id)
        head = binsrc.read(8)
        size, nscans = struct.unpack("<II", head)
        if msms == 0:
            data = struct.pack("<II", 8, nscans)
            peaks = 0
        else:
            data = head + binsrc.read(size - 8)
            peaks = None
        binout.write(data)
        rows.append((old, offset, peaks))
        offset += len(data)
    binout.close()
    for old, off, peaks in rows:
        if peaks is None:
            c.execute("UPDATE Frames SET TimsId = ? WHERE Id = ?", (off, old))
        else:
            c.execute("UPDATE Frames SET TimsId = ?, NumPeaks = 0, MaxIntensity = 0, SummedIntensities = 0 "
                      "WHERE Id = ?", (off, old))
    c.execute("DELETE FROM Frames WHERE Id < ? OR Id > ?", (first, last))
    c.execute("UPDATE Frames SET Id = Id - ?", (first - 1,))

    if dia:
        c.execute("CREATE TABLE IF NOT EXISTS DiaFrameMsMsWindowGroups (Id INTEGER PRIMARY KEY)")
        c.execute("CREATE TABLE IF NOT EXISTS DiaFrameMsMsWindows (WindowGroup INTEGER, ScanNumBegin INTEGER, "
                  "ScanNumEnd INTEGER, IsolationMz REAL, IsolationWidth REAL, CollisionEnergy REAL)")
        c.execute("INSERT INTO DiaFrameMsMsWindowGroups (Id) VALUES (1)")
        c.executemany("INSERT INTO DiaFrameMsMsWindows (WindowGroup, ScanNumBegin, ScanNumEnd, IsolationMz, "
                      "IsolationWidth, CollisionEnergy) VALUES (1, ?, ?, ?, 25.0, 30.0)",
                      [(0, 450, 500.0), (450, 900, 525.0)])
    db.commit()
    c.execute("VACUUM")
    db.close()
    print("frames", n, "precursors", sqlite3.connect(os.path.join(out, "analysis.tdf"))
          .execute("SELECT COUNT(*) FROM Precursors").fetchone()[0], "bin bytes", offset)


if __name__ == "__main__":
    main()
