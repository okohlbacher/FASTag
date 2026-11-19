# rss-perthread: where the per-thread memory of FASTag goes on PXD028735, and what was cut

Branch `post1131/rss-perthread` (stacked on 7c08642 = PR #76, merged into main). Default profile,
`-acquisition_check warn`, all runs byte-identical (PXD028735 sha256 455eb877...42e6, 5,377,305 tags; PXD047793
895a960a..., 90,420,700 tags; PXD003531 f10fd8eb..., PXD054073 b382710c..., PXD076528 6e69e83b..., every arm and
thread count).

## 1. Attribution (build 7c08642)

Source: BinAC2 job 6575161 (exclusive node1-077, `/pfs/10/project/bw26g016/fastag-1.12/post1131/rss-pxd028735/out-attr/`):
`ru_maxrss`, `/proc/pid/smaps` at the highest RSS (1 s sampling), live heap at the moment of its peak by call site
(LD_PRELOAD counter `liveprof.so`, blocks >= 16 kB, resolved with addr2line). Slope = (128 t - 16 t) / 112.

| component | PXD028735 MB/thread | PXD047793 MB/thread |
|---|---|---|
| peak RSS (ru_maxrss) 671 -> 2,115 MB | **12.9** | 1.2 (base 128 t 743 MB) |
| thread arenas in smaps 553 -> 2,062 MB | 13.5 | 2.1 |
| live heap at peak, all blocks | 9.1 | 1.1 |
| - reader XML buffer (`IndexedMzMLReader.cpp:432`) | 1.00 | 0.06 |
| - direct decoder m/z value buffer, also extra arrays (`MzMLDirectDecoder.cpp:811`) | 1.74 | 0 |
| - direct decoder intensity value buffer (`:829`) | 1.00 | 0 |
| - base64 / inflate buffers (`:495`) | 0.25 | 0 |
| - spectrum being tagged: peaks (`:571`) + ion-mobility float array (`:814`) | 0.82 | 0 |
| - tagger `prepare()` working copy and `before` (`FASTagger.cpp:1362`) | 1.19 | 0 |
| - deisotoper scratch (`FASTagger.cpp:450`, AveragineDeisotoper) | 1.11 | 0 |
| - `tagPrepared()` candidate list `scored` (`FASTagger.cpp:1368`) | 1.48 | 0.71 |
| - graph scratch, other >= 16 kB | 0.07 | 0.13 |
| - blocks < 16 kB (rows, strings) | 0.37 | 0.14 |
| glibc arena overhead (arena RSS - live: free chunks, fragmentation) | **4.4** | 1.0 |
| thread stacks + OpenMP (anonymous mappings outside arenas) | 0.08 | 0.08 |
| input file (RssFile; read with pread, not mapped) | 0 (27 MB at every count) | 0 |
| output rows / writer buffers | 0 (bounded by 3 blocks of 65,536 spectra; 443 MiB live at 1 t) | 0 |

On `data` (16/32/46 t, `data:/scratch/kohlbach/post1131/rss-pxd028735/pt/`) the same split: RSS 12.2, live 9.4,
of it >= 16 kB 9.2 MB/thread, arena overhead about 3 MB/thread.

Why PXD028735 grows and PXD047793 does not: every buffer above is sized by the peaks of the spectrum a thread
handles, kept at its high water per thread. PXD028735 MS2 are un-centroided diaPASEF frames, median 24,175, p95
72,178, max 121,494 peaks, 3 arrays (Numpress linear m/z, slof intensity, slof ion mobility); about 60-70 bytes per
peak are held or in flight per thread. PXD047793 has at most 500 peaks per spectrum, so the same structures are
< 50 kB per thread; what remains there (0.7 MB `scored`) does not depend on peaks. Numpress itself costs little
(decodeNPRaw transients 0-0.17 MB/thread at peak); the third array 0.2 MB/thread.

## 2. Hypotheses tested

| hypothesis | refuting measurement | result |
|---|---|---|
| H1 (earlier): per-thread reader buffers plus arena overhead | per-site live slope, arena RSS - live | partly: reader/decoder buffers 4.0 MB/thread (31 %), arena overhead 4.4 (34 %), tagger scratch 3.8 (29 %) |
| immutable tables duplicated per thread | slope of the control (same tables, small spectra) | refuted: PXD047793 1.1 MB/thread live in total, 0.7 of it `scored` |
| thread stacks | smaps stack/anon mappings | refuted: 0.08 MB/thread |
| input mapping / file cache | RssFile vs threads | refuted: 27-29 MB at 1-128 t |
| output buffers grow with threads | writer and row sites, blocks < 16 kB | refuted: writer 7.7 MB constant, small blocks 0.37 MB/thread |
| one arena per thread is the overhead | MALLOC_ARENA_MAX=1/2/8, data 32 t (base 825/839 MB, 30.9/31.1 s) | refuted: 999 / 952 / 893 MB, 39.0 / 35.4 / 33.0 s; fewer arenas, more RSS |
| a different allocator removes the overhead | jemalloc, tcmalloc (LD_PRELOAD, data 32 t) | refuted: 927 / 929 MB at 30.5 / 34.1 s; jemalloc narenas:1 + decay 0: 737 MB at 37.8 s (+22 %) |
| returning freed pages (trim / mmap thresholds) | MALLOC_TRIM_THRESHOLD_=128k + TOP_PAD_=0; MMAP_THRESHOLD_=128k | works but costly: 739 / 765 MB at 54.2 / 53.1 s (+75 %) |
| rare outlier spectra set the high water (shrink after outliers) | MS2 size distribution vs buffer rounding | refuted: p95 = 72k peaks already fills the 1 MiB power-of-two buffers; at 128 t each thread sees ~60 spectra above p95 |
| reading is a quarter of a thread's time, so a pool needs far fewer scratch sets than threads | pool size at peak (reader buffer blocks live) | refuted: 115 sets at 128 t, 45 at 46 t (the start and block hand-overs read in bursts); the pool still lowered RSS because idle sets stay small |
| Numpress decode transients (decodeNPRaw zero-fills 16 B per input byte) | live at peak of `decodeNPInternal_` | refuted as a main term: 0-0.17 MB/thread |

## 3. Changes

Nothing kept: both candidates cut RSS but cost wall time beyond the repetition spread. They are reverted
(4299439, 12ef620), and the branch carries no code change against main. Evidence: BinAC2 exclusive node, PXD028735 and
PXD047793 at 16/64/128 t. Jobs 6575149 (run2) and 6576352 (run3) ran 3 reps in a fixed order. The deciding job
6577077 (run4) ran 4 reps with the arm order rotated each rep. Output `/pfs/10/project/bw26g016/fastag-1.12/post1131/rss-pxd028735/out-run{2,3,4}`,
summary `ana.py`. Median [min-max]; "main" = d16328b build (run2).

PXD028735, peak RSS MB / wall s:

| t | main d16328b | 7c08642 (run4) | + eb03139 (run4) | + eb03139 + a965091 (run4) |
|---|---|---|---|---|
| 128 | 2,356 / 12.5 | 2,120 [2,107-2,123] / 11.9 [11.9-11.9] | 1,987 [1,982-1,996] / 11.9 [11.8-12.0] | 1,943 [1,884-1,957] / 11.9 [11.9-12.0] |
| 64 | 1,379 / 17.6 | 1,284 [1,271-1,294] / 16.7 [16.6-16.7] | 1,226 [1,205-1,236] / **17.4 [16.8-19.0]** | 1,196 [1,169-1,225] / **17.0 [16.8-17.4]** |
| 16 | 680 / 63.5 | 674 [665-678] / 60.8 [60.7-61.0] | 656 [648-658] / 60.9 [60.8-61.0] | 648 [642-663] / 61.1 [60.9-61.8] |

PXD047793 wall s (RSS unchanged, 607-612 / 666-672 / 737-740 MB in every arm):

| t | 7c08642 | + eb03139 | + eb03139 + a965091 |
|---|---|---|---|
| 128 | 17.2 [17.1-17.3] | 17.2 [17.1-17.3] | **17.4 [17.4-17.4]** |
| 64 | 24.2 [24.1-25.0] | 24.2 [24.1-24.3] | 24.5 [24.5-24.7] |
| 16 | 88.1 [87.9-88.1] | 88.3 [88.1-88.3] | **88.8 [88.4-88.9]** |

- eb03139 (intensities through the m/z buffer): RSS -6 % / -5 % / -3 % at 128/64/16 t, outside the spread. Wall at
  64 t is above the 7c08642 spread in all three jobs (run3 17.3 vs 16.8, run4 17.4 vs 16.7). Reverted.
- a965091 (pooled scratch sets, own set first), on top of eb03139: RSS a further -2 to -3 %. Wall on PXD047793
  above the spread at 16 and 128 t (+0.8 %, +1.2 %), and at 64 t on PXD028735. Reverted. 895baac (pool per read) was
  lower still (1,816 MB at 128 t, run2) but 3 % slower at 16 t; already reverted (9547606).
- Other three data sets (run3, 16/128 t, one run): no RSS or wall difference beyond 0.1 s; digests identical.
- glibc knob on the 7c08642 build (run4, environment only):
  - `MALLOC_MMAP_THRESHOLD_=33554432 MALLOC_TRIM_THRESHOLD_=131072 MALLOC_TOP_PAD_=0`: PXD028735 RSS 1,747 / 1,098 / 614 MB
    (-18 % / -14 % / -9 %), wall 13.1 / 17.9 / 64.3 s (+10 % / +7 % / +6 %). PXD047793 unchanged.
    It avoids most of the earlier +75 % (that cost came from the fixed 128 kB mmap threshold), but it still costs time.
    It is a documented opt-in for memory-bound runs, not a default.
  - Same with `TRIM_THRESHOLD_=4194304`: -1 % / -2 % / -2 % RSS at no measurable wall cost. Too small to be worth it.

## 4. Remaining slope and next steps

The slope stays at 12.9 MB/thread on PXD028735 (7c08642: 2,120 MB at 128 t on BinAC2). Ranked by share (section 1):

1. glibc arena overhead, 4.4 MB/thread (34 %). The only measured lever is the trim setting above: -18 % RSS at
   128 t for +6-10 % wall. The next step is to document it for users who are short of memory; a code-side fix would
   need a bounded allocation pattern (fixed-size per-thread pools) for the buffers in 2 and 3.
2. reader and decoder buffers, 4.0 MB/thread (31 %). Measured: -6 to -8 % RSS at 2-4 % wall cost at 64 t, and
   up to 1 % on PXD047793. Reconsider only together with a cheaper hand-off (no lock per read, no second pass over
   the peaks).
3. tagger scratch, 3.8 MB/thread (29 %): `scored` 1.48, `prepare()` copy 1.19, deisotoper 1.11. Not tried. Of all
   the terms, only `scored` also grows on small spectra (0.71 MB/thread on PXD047793). Next is to bound or reserve it by
   candidate count, then measure with the same rotated protocol.
