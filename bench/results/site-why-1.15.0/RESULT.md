# site-why-1.15.0: FASTag 1.15.0 against DirecTag 1.4.21142

Measured on 2026-11-18 on **ibminode05** (1x AMD EPYC 7763, 128 logical CPUs, 995 GB RAM, node-local NVMe),
with the protocol of [site-why-1.14.0](../site-why-1.14.0/RESULT.md). Only the FASTag side was re-run.
DirecTag's numbers are those of the 1.14.0 record: same node, same inputs, same settings, measured on 2026-11-15.

- FASTag 1.15.0: release asset `FASTag-1.15.0-linux-x64.tar.gz`, sha256 `804d5168…872c`, which matches the
  GitHub release digest; `FASTag.bin` sha256 `a0680653…dff3` (`binary.sha256`, `release.sha256`).
- Inputs and their sha256: `INPUTS.tsv`. Harness: `bench.sh`; one row per run in `raw.tsv`.
- Protocol: 128 threads; each run waits until the 1-minute load per core is below 0.25 (recorded before
  each run: 0.0045 to 0.2403); the input is read once (sha256) to warm the page cache; one uncounted warm-up;
  3 reps; `/usr/bin/time -v` (wall time, ru_maxrss in kB, MB = kB/1024). Tag files are hashed, then deleted.

```
FASTag -in X -out tags.tsv -tag_length 3 -max_tags 50 -max_peaks 100 -peaks_per_window 0 -gaps 0 -no_deisotope \
       -fragment_tolerance 0.02 -fragment_tolerance_unit Da -fixed_modifications "" -threads 128 \
       [PXD028735 only: -acquisition_check warn]
directag -TagLength 3 -MaxTagCount 50 -MaxPeakCount 100 -FragmentMzTolerance 0.02 -PrecursorMzTolerance 1.5 -cpus 128 X
```

## Per-run results (FASTag 1.15.0)

| data | rep | wall s | maxrss kB | output |
|---|---|---|---|---|
| PXD047793 | 1 / 2 / 3 | 7.13 / 7.12 / 7.23 | 557,520 / 557,208 / 562,228 | 62,347,705 tags, sha `2440d7db…` (as 1.14.0), all reps |
| PXD028735 (warn) | 1 / 2 / 3 | 7.70 / 7.70 / 7.69 | 1,336,312 / 1,336,420 / 1,319,488 | 864,815 tags, sha `1a8913d0…` (as 1.14.0), all reps |

Warm-ups: PXD047793 7.18 s, PXD028735 7.67 s.

## Medians

| data | FASTag 1.15.0 | DirecTag 1.4.21142 (2026-11-15) | ratio |
|---|---|---|---|
| PXD047793 (timsTOF diaTracer pseudo-DDA, 24.7 GB) | 7.13 s, 544 MB | 732.69 s, 70,282 MB | 103x faster, 129x less memory |
| PXD028735 (raw diaPASEF, 32.3 GB) | 7.70 s, 1,305 MB | 479.90 s, read 0 spectra | DirecTag returns no tags |

## PXD000001 accuracy

At the matched settings and 128 threads FASTag 1.15.0 writes 181,963 tags, sha256 `fcdd1822…bfc32`, the same
file as 1.14.0. Scored with `tools/pxd000001_truth.py` against the 2,254 Mascot PSMs at 1% FDR: rank-1
**90.91%** (2,049), top 5 97.91% (2,207), top 50 **98.62%** (2,223). DirecTag 1.4.21142 at the same settings:
88.69% and 98.62% (2026-09-07, [doc/BENCHMARK-DirecTag.md](../../../doc/BENCHMARK-DirecTag.md)).
Accuracy at FASTag's defaults: [accuracy-1.15.0](../accuracy-1.15.0/RESULT.md).
