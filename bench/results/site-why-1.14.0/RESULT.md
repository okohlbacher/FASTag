# site-why-1.14.0: "Why use it" numbers for FASTag 1.14.0

Measured on 2026-11-15 on **ibminode05** (1x AMD EPYC 7763, 128 logical CPUs, 995 GB RAM, node-local NVMe).
Before the start, `ibmi-nodes.sh` reported load 0.11, which is 0.00 per core, with 0 users. Every run was
gated on a 1-minute load per core below 0.25. The recorded load per core before each run ranged from 0.002 to
0.248; the residue comes from the previous run of this series. The original page numbers came from kim on
2026-09-08, so both tools were re-run here.

- FASTag 1.14.0: the release `FASTag-linux-x64.tar.gz`, sha256 `46f31768…0822`, which matches the GitHub digest.
  `FASTag.bin` has sha256 `dbf30d817a100729d361871ec95d377b3bf608df3cf6d5f8902f2523b202c295`. This differs from
  the data build `f7e2ec8d…`, which is a single binary and was not used.
- DirecTag 1.4.21142: `/ceph/ibmi/abi/oliver/jpr-bench/envs/bumbershoot/bin/directag`, run with `LC_ALL=C`
  and the rank-sum cache copied into the run directory. This is the binary of the ibminode05 1.9.0 study. The
  kim runs used the bumbershoot container instead.
- Inputs:
  - PXD047793: `/scratch/kohlbach/rt047793/in/4223_TIMS2_006_2_Slot2-6_1_2877_diatracer.mzML`, sha256 `8f199c90…7e77`.
  - PXD028735: `/scratch/kohlbach/fastag-carryover-1.12/timing/in/PXD028735_Gamma_01.mzML`, the copy of the
    Ceph `sachsenb/DIA/PXD028735/…Gamma_01.mzML` with stored sha256 `72045ead…8ee1`. The re-hash of this
    copy belongs to the follow-up run.
  - PXD000001: `/scratch/kohlbach/jpr-acc/data/PXD000001/…-20141210.mzML`, sha256 `038dd847…fa67`, with
    `F063721.dat` sha256 `286c1677…bab6`.
- Harness: `ibminode05:/scratch/kohlbach/site-why-1.14.0/bench.sh`, with per-run rows in `raw.tsv` and run
  directories under `runs/`.
  - The page cache was warmed with `cat` before each file.
  - FASTag had one warm-up run per file that is not counted.
  - Each file then had 3 reps, alternating F,D / D,F / F,D.
  - Measurement: `/usr/bin/time -v`, giving wall time and ru_maxrss in kB/1024.
  - The tag files were hashed and then deleted.

Commands:

```
FASTag -in X -out tags.tsv -tag_length 3 -max_tags 50 -max_peaks 100 -peaks_per_window 0 -gaps 0 -no_deisotope \
       -fragment_tolerance 0.02 -fragment_tolerance_unit Da -fixed_modifications "" -threads 128 \
       [PXD028735 only: -acquisition_check warn]
directag -TagLength 3 -MaxTagCount 50 -MaxPeakCount 100 -FragmentMzTolerance 0.02 -PrecursorMzTolerance 1.5 -cpus 128 X
```

## Per-run results (wall s, ru_maxrss kB)

| tool | data | rep | wall | maxrss kB | output |
|---|---|---|---|---|---|
| FASTag | PXD047793 | 1 / 2 / 3 | 7.14 / 7.07 / 7.09 | 552,128 / 566,732 / 560,928 | 62,347,705 tags, sha `2440d7db…` (= Table 5 digest), all reps |
| DirecTag | PXD047793 | 1 / 2 / 3 | 732.69 / 732.45 / 734.71 | 71,970,212 / 71,968,320 / 71,963,196 | read 3,086,644 spectra; 60,579,050 lines |
| FASTag (warn) | PXD028735 | 1 / 2 / 3 | 7.67 / 7.67 / 7.67 | 1,335,328 / 1,327,208 / 1,342,480 | 864,815 tags, sha `1a8913d0…`, all reps |
| DirecTag | PXD028735 | 1 / 2 / 3 | 479.90 / 479.30 / 479.99 | 155,420 / 155,652 / 155,164 | `Read 0 spectra with 0 peaks`, exit 0 |

The warm-up runs were FASTag PXD047793 at 7.22 s and FASTag PXD028735 at 7.67 s.

**Medians:**

| data | FASTag | DirecTag |
|---|---|---|
| PXD047793 | 7.09 s, 548 MB | 732.69 s, 70.3 GB (70,282 MB) |
| PXD028735 | 7.67 s, 1.31 GB | 479.90 s, 0 spectra |

## PXD000001 accuracy

FASTag 1.14.0 tagged PXD000001 at the matched settings and 128 threads, giving 181,963 tags. The tag file is
`pxd000001_fastag-1.14.0_matched.tsv` here, sha256 `fcdd1822…bfc32`. It was scored with the original scorer:

```
python3 -I tools/pxd000001_truth.py --tsv pxd000001_fastag-1.14.0_matched.tsv --no-assert
```

The scorer is from the FASTag repo, `doc/BENCHMARK-DirecTag.md`. It reported 2,254 accepted PSMs:

- rank-1: 2,049 (**90.91%**)
- top 5: 97.91%
- total (top 50): 2,223 (**98.62%**)

These are identical to the 2026-09-07 values. DirecTag's 88.69% and 98.62% are kept from 2026-09-07. They are
not re-scored, because accuracy does not depend on the node.

## Old vs new (page)

| row | old: kim, 2026-09-08, FASTag build of the v1.3.0 tree (9b085ed), min of 3/2 | new: ibminode05, 2026-11-15, 1.14.0, median of 3 |
|---|---|---|
| PXD047793 FASTag | 15.65 s, 280 MB | 7.09 s, 548 MB |
| PXD047793 DirecTag | 746.61 s, 69.4 GB | 732.69 s, 70.3 GB |
| PXD028735 FASTag | 5.79 s, 864,815 tags | 7.67 s, 864,815 tags (`-acquisition_check warn`) |
| PXD028735 DirecTag | 541.5 s, 0 spectra | 479.9 s, 0 spectra |
| PXD000001 rank-1 / top 50 | 90.91 / 98.62 vs 88.69 / 98.62 | unchanged |

The FASTag peak memory roughly doubles, from 280 to 548 MB. Part of this is the measurement:

- ru_maxrss reads the kernel's per-CPU-batched RSS counter.
- On kim's 384 CPUs that counter hides up to 1.15 GB; on ibminode05 it hides up to 128 MB
  (`jpr-paper/runtime-pxd047793.md`).
- Table 5 on ibminode05 also gives about 500 MB at 32 threads.

So the 280 MB on kim is not comparable.

## Follow-up (pending at hand-back)

`followup.sh` queues three more FASTag runs on PXD028735:

- The original command with no `-acquisition_check`, 3 times. Expected result: exit 11 with `FASTAG_REFUSED reason=raw_dia`.
- `-acquisition_check off`, 3 times after a warm-up.

The script writes its rows to the same `raw.tsv` and touches `DONE2` when it finishes. It started at
16:43Z with the sha256 of the input.
