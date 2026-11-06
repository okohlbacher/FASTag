#!/usr/bin/env python3
"""Write a plan file for ladder_run.sh.

    make_plan.py fastag  DATASET STEM [--formats mzML,point,chunked] [--threads 1,2,...] [--reps 3]
    make_plan.py matched DATASET MZML  [--threads 1,8,32,64,384] [--reps 3] [--tool fastag|directag]

STEM is the input path without extension: STEM.mzML, STEM.point.mzpeak, STEM.chunked.mzpeak.
Runs are interleaved (rep -> threads -> format) so drift on the node spreads over all cells.
The 'matched' profile is the DirecTag paper configuration used for the head-to-head:
tag length 3, 50 tags, 100 peaks, 0.02 Da, no gaps, no deisotoping, no static modifications.
"""
import argparse

LADDER = [1, 2, 4, 8, 16, 32, 64, 128, 256, 384]
FASTAG_MATCHED = ("-tag_length 3 -gaps 0 -no_deisotope -max_tags 50 -max_peaks 100 -peaks_per_window 0 "
                  "-fragment_tolerance 0.02 -fragment_tolerance_unit Da -fixed_modifications ''")
DIRECTAG_MATCHED = "-TagLength 3 -MaxTagCount 50 -MaxPeakCount 100 -FragmentMzTolerance 0.02 -PrecursorMzTolerance 1.5"
EXT = {"mzML": ".mzML", "point": ".point.mzpeak", "chunked": ".chunked.mzpeak"}


def ints(s):
    return [int(x) for x in s.split(",") if x]


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("mode", choices=["fastag", "matched"])
ap.add_argument("dataset")
ap.add_argument("path")
ap.add_argument("--formats", default="mzML,point,chunked")
ap.add_argument("--threads", type=ints)
ap.add_argument("--reps", type=int, default=3)
ap.add_argument("--tool", default="fastag", choices=["fastag", "directag"])
ap.add_argument("--max-threads", type=int, default=384, help="cap at the node's hardware threads")
a = ap.parse_args()

rows = []
if a.mode == "fastag":
    thr = [t for t in (a.threads or LADDER) if t <= a.max_threads]
    for rep in range(1, a.reps + 1):
        for t in thr:
            for f in a.formats.split(","):
                rows.append(["fastag", "default", a.dataset, f, a.path + EXT[f], t, rep, ""])
else:
    thr = [t for t in (a.threads or [1, 8, 32, 64, 384]) if t <= a.max_threads]
    extra = FASTAG_MATCHED if a.tool == "fastag" else DIRECTAG_MATCHED
    for rep in range(1, a.reps + 1):
        for t in thr:
            rows.append([a.tool, "matched", a.dataset, "mzML", a.path, t, rep, extra])
for r in rows:
    print("\t".join(str(x) for x in r))
