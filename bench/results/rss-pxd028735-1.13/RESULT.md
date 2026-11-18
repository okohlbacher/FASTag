# rss-pxd028735: why FASTag 1.13.1 peak RSS grows with threads on PXD028735 (mzML)

Status: mechanism established; three output-identical changes kept on branch `post1131/rss-pxd028735` (head 7c08642): PXD028735 peak RSS -2 % / -8 % / -10 % and wall -4 % / -5 % / -3 % at 16 / 64 / 128 threads (see Implementation).

## Result

The growth is per-thread working memory whose size follows the number of peaks in the largest spectra a thread
handles. Each worker keeps its reader buffers and tagger scratch vectors at their high-water size, and the
OpenMS fallback decoder adds transient vectors of the same order. PXD028735 has MS2 spectra with a median of
24,175 and up to 121,494 peaks (un-centroided diaPASEF frames), about 20 to 240 times more than the other data sets,
so the per-thread set is 12-15 MB instead of about 1 MB. About 70 % of the growth is live memory, about 30 % is
glibc per-thread-arena overhead. No allocator setting removes it without a large run-time cost. It is not a leak
and not queueing: 15 MB x 128 threads = 1.9 GB.

## 1. What is different about the file

Source: `mzml_stats.py` over the mzML index and spectrum headers, `data:/scratch/kohlbach/post1131/rss-pxd028735/stats/*.txt`.

| | PXD028735 (Gamma_01) | PXD076528 | PXD047793 |
|---|---|---|---|
| MS2 spectra | 151,648 | 100,438 | 3,086,644 |
| representation | neither centroid nor profile term (raw frames) | centroid | centroid (diaTracer pseudo-spectra) |
| peaks per MS2: mean / median / p99 / max | 27,611 / 24,175 / 89,604 / 121,494 | 1,236 / 1,347 / 2,418 / 6,481 | 488.5 / 500 / 500 / 500 |
| XML bytes per MS2: median / max | 162,127 / 701,571 | 19,187 / 70,714 | 7,949 (mean) / 8,727 |
| binary arrays | 3 (m/z, intensity, ion mobility), MS-Numpress + zlib | 2, zlib | 2 |
| peak m/z range | 95-1705 (301 sampled MS2, `stats/PXD028735.mzrange.txt`) | 100-1998 | 95-1701 |
| file size | 32.3 GB | 1.87 GB | 24.7 GB |

PXD028735: timsTOF Pro diaPASEF (32 isolation windows of 26 Th, 400-1201 m/z), written by an OpenMS-style
converter (ids `frame=N_scan=M`, instrument cv only MS:1000031, `<spectrumList count="0">` in the original).
FASTag's direct decoder declines Numpress and more than two arrays, so every MS2 spectrum of this file goes
through `MzMLSpectrumDecoder::domParseSpectrum` (src/IndexedMzMLReader.cpp:1042-1043). Reading takes 343 of
1,152 thread-seconds (FASTAG_THREADS line, run d1_base).

## 2. Where the per-thread memory is

Build of origin/main d16328b with symbols on `data` (same tag sha256 as the release in every run), default profile.

- RSS rises gradually over the whole run and the growth is all RssAnon (RssFile stays at 25 MB). At 48 threads
  `smaps` shows 48 anonymous mappings of 21-25 MB, one glibc arena per worker, fully resident (run d48_base).
- Peak RSS on `data`: 419 MB (1 t), 501 (8), 558 (16), 790 (32), 1,024 (48): 12-15 MB per thread.
  Control PXD076528, same build: 673 MB (1 t), 685 (16), 690 (48): 0.4 MB per thread (runs ctl_*).
- Live heap at the moment of its peak (own LD_PRELOAD counter, `runs/lp1.txt`, `lp8b.txt`, `lp32b.txt`):
  460 MB (1 t), 527 MB (8 t), 716 MB (32 t) = 8.3 MB live per added thread, against 12.0 MB RSS per added thread.
  Allocations of 16 kB or more: 30 MB, 105 MB, 298 MB = 8.7 MB per thread.
- The 298 MB at 32 threads by call site (one block per thread, n = 31):

| MB | per thread | what |
|---|---|---|
| 144 | 4.6 MB | tagger scratch kept between spectra: `tagPrepared` 48, `tagSpectrum` (FASTagger.cpp:1364) 52, `prepare` (FASTagger.cpp:377, 452) 44 |
| 62 | 2.0 MB | reader: `raw` buffer (IndexedMzMLReader.cpp:432) 32.5 and its `std::string` copy for the OpenMS decoder (:1042) 29.5 |
| 44 | 1.4 MB | OpenMS decoder transients (Numpress decode, `decodeBinaryDataMSSpectrum_`, `handleBinaryDataArray_`) |
| 13 | - | writer string and row vectors (not per thread) |

- The reader queue and output buffering are not the cause: rows of all spectra are held at any thread count
  (three blocks of 65,536 spectra cover the file); that is the 420-490 MB baseline at 1 thread.
- Matched profile (100 peaks per spectrum reach the tagger) still grows (127 MB to 1,455 MB, BinAC2), because the
  reader, the decoder and `prepare` see the full spectrum.

## 3. Interventions

Dose-response on the same file (unindexed subsets written by `subset.py`, 37.7 k MS2 spectra each, default profile, `data`):

| subset | 1 t | 16 t | 48 t | per thread |
|---|---|---|---|---|
| MS2 with at most 3,000 peaks (37,712 spectra) | 91 MB | 92 MB | 123 MB | 0.7 MB |
| MS2 with at least 46,000 peaks (37,734 spectra) | 175 MB | 342 MB | 827 MB | 13.9 MB |

Removing the large spectra removes the growth; this confirms the mechanism.

Allocator settings, 32 threads, PXD028735 default, `data` (base 790 MB, 35-38 s; 1 thread 419 MB). All outputs
sha256 455eb877...42e6 (identical to the release).

| setting | peak RSS (MB) | wall |
|---|---|---|
| base (2 runs) | 790 / 789 | 0:35 / 0:38 |
| MALLOC_ARENA_MAX=1 | 655 | 1:52 |
| MALLOC_ARENA_MAX=2 | 700 | 0:59 |
| MALLOC_MMAP_THRESHOLD_=131072 | 712 | 1:56 |
| MALLOC_TOP_PAD_=0 MALLOC_TRIM_THRESHOLD_=131072 | 685 | 2:13 |
| MALLOC_ARENA_MAX=1 + mmap and trim thresholds 131072 | 770 | 3:49 |
| tcmalloc (minimal) | 849 | 0:46 |
| jemalloc | 935 | 0:39 |
| jemalloc, dirty and muzzy decay 0 | 778 | 1:03 |
| jemalloc, narenas:1, decay 0 | 639 | 0:52 |

Wall times on `data` are indicative only (shared node, load 110-210 of 224 CPUs). The lowest value, 639 MB, is
the live floor: 6.9 MB per thread above the 1-thread run.

Paired runs, released binary 1.13.1 (FASTag.bin sha256 4260...3f1c), BinAC2 job 6567221, one exclusive node
(node1-061, 2 x EPYC 7543), inputs on node-local NVMe, default profile, base and MALLOC_ARENA_MAX=1 alternating:

| data set | threads | RSS base (MB) | RSS arena=1 (MB) | wall base (s) | wall arena=1 (s) |
|---|---|---|---|---|---|
| PXD028735 | 1 | 485 | 476 | 956.1 | 954.4 |
| PXD028735 | 16 | 684 | 639 | 62.3 | 102.3 |
| PXD028735 | 64 | 1,376 | 1,120 | 17.3 | 104.1 |
| PXD028735 | 128 | 2,369 | 1,789 | 22.5 | 128.1 |
| PXD076528 | 1 | 670 | 663 | 80.2 | 80.4 |
| PXD076528 | 16 | 690 | 697 | 5.5 | 10.3 |
| PXD076528 | 64 | 759 | 750 | 1.7 | 11.3 |
| PXD076528 | 128 | 843 | 846 | 1.3 | 10.0 |

One run per cell (ru_maxrss / 1024). The 128-thread base run of PXD028735 was the first run after staging; the
reference ladder has 12.2 s for it.

Tag output is byte-identical in all runs (PXD028735 sha256 455eb877...42e6, 5,377,305 tags; PXD076528 6e69e83b...9732,
3,905,212 tags). A single arena removes a quarter of the RSS at 128 threads (31 % of the growth
over 1 thread) and costs a factor of 6 in wall time at 64 and 128 threads (1.6 at 16); on the control it changes
nothing in RSS and costs a factor of 7 to 8. It is not a usable setting. The control grows by 1.4 MB per thread.

No code change was kept. Candidates and why not: freeing the `std::string` copy and shrinking the reader and
tagger buffers after each spectrum saves at most the retained share, but 75 % of the spectra have more than
3,000 peaks, so the buffers are refilled at once, and the trim and mmap settings above show that returning
freed pages to the system costs more time than any setting saves memory. A real
reduction needs a smaller footprint per spectrum: Numpress and three-array support in the direct decoder
(removes the copy and the OpenMS transients, about 2.4 MB per thread, and should also shorten the 30 % of the
run time spent reading), and fewer full-size scratch vectors in `prepare`/`tagSpectrum`. Neither is a small
change; neither was implemented or measured.

## 4. Will users meet it elsewhere

Yes, with any input whose spectra are very large: profile-mode or un-centroided data and whole ion-mobility
frames written as one spectrum (tens of thousands of peaks, hundreds of kB of XML per spectrum). Rule from the
measurements: about 0.1-0.2 kB of RSS per peak of the largest spectra, per thread (0.7 MB at up to 3,000 peaks, 1.4 MB
for PXD076528 with at most 6,481 peaks, 14-15 MB with 46,000-121,494 peaks). Centroided DDA and DIA files stay
near 1 MB per thread. Numpress or a third array adds the OpenMS decoder path but is not the main term.

## Not done

- 64 and 128 threads only on BinAC2 (one run each); `data` runs are limited to 48 threads.
- Whether DirecTag reads 0 spectra because of `count="0"` was not tested.

## Files

- `data:/scratch/kohlbach/post1131/rss-pxd028735/`: `runs/results.tsv` (all runs), `runs/<tag>/` (time, RSS samples,
  smaps at peak), `runs/lp*.txt` (live heap by call site), `stats/`, `sub/` (subsets), scripts `run1.sh`,
  `mzml_stats.py`, `mzrange.py`, `subset.py`, `liveprof.c`, `lpres.py`.
- BinAC2: `/pfs/10/project/bw26g016/fastag-1.12/post1131/rss-pxd028735/` (`rss.slurm`, `out/base/raw.tsv`, `out/arena1/raw.tsv`; `impl.slurm`, `bin/<arm>/`, `out-run1/`).
- Reference ladder: `output/jpr-paper/final-benchmarks/rerun-1.13.1/results/ladder_raw_v1131.tsv`.

## Implementation

Source: BinAC2 job 6572445 (exclusive node1-020, AMD EPYC 7543, 128 logical CPUs, inputs on `$TMPDIR`),
`/pfs/10/project/bw26g016/fastag-1.12/post1131/rss-pxd028735/out-run1/<arm>/raw.tsv`; 3 repetitions after one warm-up,
arms interleaved per repetition; median [min-max]. `main` = own build of d16328b (v1.13.1 source, same toolchain
and libOpenMS as the candidates); `rel` = released 1.13.1 bundle (FASTag.bin 42603818..., system glibc). 1-thread
runs ran concurrently (all arms at once, gate off).

Kept commits (all three, in this order on d16328b):

| commit | change | files |
|---|---|---|
| 5165420 | direct decoder handles MS-Numpress (linear, pic, slof; zlib on/off, via OpenMS `MSNumpressCoder::decodeNPRaw`) and extra float arrays (e.g. ion mobility); these spectra no longer take the OpenMS DOM path | `src/MzMLDirectDecoder.cpp`, `src/MzMLDirectDecoder.h`, `test/indexed_mzml_test.cpp` |
| cbff524 | tagger `prepare()`: dedup and merge peaks in place, 32-bit rank indices (smaller retained per-thread scratch) | `src/FASTagger.cpp` |
| 7c08642 | indexed reader: the `std::string` copy for `domParseSpectrum` is a local, not a retained member | `src/IndexedMzMLReader.cpp` |

PXD028735 (default profile, `-acquisition_check warn`), baseline `main` vs kept build `abc`:

| threads | RSS MB main | RSS MB abc | wall s main | wall s abc | rel RSS / wall | digest equal |
|---|---|---|---|---|---|---|
| 1 | 482 [479-483] | 488 [485-488] | 1017.6 [1017.5-1024.4] | 972.3 [970.1-977.1] | 485 / 1005.3 | yes |
| 16 | 682 [682-686] | 667 [664-675] | 63.42 [63.41-63.90] | 60.69 [60.63-61.33] | 685 / 62.31 | yes |
| 64 | 1,392 [1,377-1,395] | 1,282 [1,274-1,290] | 17.58 [17.50-17.93] | 16.75 [16.71-16.82] | 1,376 / 17.33 | yes |
| 128 | 2,362 [2,351-2,363] | 2,114 [2,113-2,120] | 12.41 [12.38-12.52] | 12.01 [11.88-12.26] | 2,363 / 12.51 | yes |

Reader thread-seconds (`thr_read_s`) at 16 t: 255.7 (main) vs 229.1 (abc).

Each arm on its own vs `main` (PXD028735, median RSS MB / wall s at 16, 64, 128 t):

| arm | 16 t | 64 t | 128 t | verdict |
|---|---|---|---|---|
| a (5165420) | 688 / 61.68 | 1,387 / 17.09 | 2,335 / 12.34 | kept: wall better outside spread at 1/16/64 t, RSS within spread |
| c (cbff524) | 668 / 62.39 | 1,312 / 17.36 | 2,195 / 12.26 | kept: RSS better outside spread at 16/64/128 t, wall better at 1/16 t |
| b (7c08642) | 675 / 63.37 | 1,359 / 17.64 | 2,293 / 12.44 | kept: RSS better outside spread at 16/64/128 t, wall within spread |
| ac | 676 / 60.63 | 1,290 / 16.72 | 2,120 / 12.03 | (abc minus b: b adds no measurable gain once a is in, abc and ac overlap) |
| a, first version (np buffers as retained members; data, 32 t, 1 run) | 1,051 MB vs main 845 MB | | | not kept in that form; replaced by 5165420 (locals) |

Other data sets, all arms: digests equal to the 1.13.1 references (PXD003531 f10fd8eb 1,226,728 tags;
PXD054073 b382710c 7,309,985; PXD076528 6e69e83b 3,905,212; 16 and 128 t, 1 run each; PXD047793 895a960a
90,420,700 tags at 1/16/64/128 t). PXD047793 main vs abc: 16 t 612 / 88.62 vs 611 / 88.20; 64 t 671 / 24.38 vs
669 / 24.16; 128 t 746 / 17.13 vs 739 / 17.15; 1 t 1412 vs 1397 s (no regression; `rel` 609 / 87.39, 677 / 23.89,
743 / 17.60).

Numpress bit-identity: `indexed_mzml_test` (7 cases: linear/pic/slof x zlib on/off, plus an extra "Ion Mobility"
array) compares direct-path arrays with the OpenMS DOM path bit for bit. ctest on `data` for the kept tree
(`build-abc`, sources sha256-identical to 7c08642): 89/89 passed; 5 tests disabled by ctest in that environment
(baseline_identity_test, search_engine_smoke_test, mzpeak_e2e, mzpeak_validate, mzml_to_mgf_test).

Reverted: none of the three; the first form of (a) was replaced before commit.
