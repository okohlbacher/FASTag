# Performance review — the long-running jobs (2026-09-02, v1.0.0)

An adversarial look at where wall time actually goes in FASTag's slow
configurations, measured rather than reasoned, with fixes ranked by the seconds
they would return. Everything below was measured on the v1.0.0 build on a
16-logical-core Apple machine (12 performance + 4 efficiency cores, 128 GB),
warm page cache, one job at a time.

**Method.** (1) The cross-version benchmark (`doc/V1.0-READINESS.md`): five
datasets from 40 MB to 13 GB, four configurations, three versions. (2) A thread
scaling run at 1/4/8/16 threads. (3) macOS `sample` stack profiles taken at
fixed wall offsets inside each long configuration (3 s windows, all threads).
(4) Setup-only runs (`-subsample_spectra 1`, which processes one spectrum) to
isolate fixed costs. (5) A micro-benchmark of the one parser that turned out to
matter. Numbers quoted as "samples" are `sample` hit counts summed over threads.

## The headline

**The tagger is not the bottleneck. Reading mzML is — and its slowest part is
single-threaded.** On the 13 GB ddaPASEF file, 25.8 s of a 47 s run are spent
before the first spectrum is tagged, on one core, parsing the file's own index
with a DOM parser. Another ~75% of the parallel phase is per-spectrum XML
decoding, again DOM-based. `tagSpectrum` itself is roughly 15% of the loop.

Thread scaling makes the same point without a profiler (astral_lf, 1.9 GB):

| threads | wall | speed-up |
|---|---|---|
| 1 | 44.1 s | 1.0× |
| 4 | 15.9 s | 2.8× |
| 8 | 11.2 s | 3.9× |
| 16 | 9.2 s | 4.8× |

Amdahl's law fits a serial fraction of ~6.5 s on this file and **~32 s on the
13 GB file** (8 → 16 threads: 47.2 → 39.4 s). The setup-only runs measure that
serial phase directly: **7.4 s (astral_lf) and 25.8 s (hela)** — nothing a
`-threads` value can touch.

## Findings, ranked by wall time returned

### 1. The indexedmzML offset list is parsed with a full XML DOM — 25.8 s of 47 s

`OnDiscMSExperiment::openFile` → `IndexedMzMLHandler::parseFooter_` →
`IndexedMzMLDecoder::parseOffsets`, which reads the entire `<indexList>` into
a buffer, copies it into an `OpenMS::String`, prepends `<indexedmzML>`, and
hands the result to `domParseIndexedEnd_` — a Xerces DOM parse. The list is
33.1 MB with 371,189 `<offset>` elements for the 13 GB file (8.6 MB / 102,237
for astral_lf), and Xerces builds a DOM node per element at roughly 70 µs each
(DOM node construction is RTTI-heavy: the profile's `dynamic_cast` and
`type_info::operator==` frames live under `DOMAttrImpl::setValueFast`).

The sample at t=8 s into the hela run shows exactly this: one thread in
`IGXMLScanner::scanCharData`/`transcodeFrom`/`scanStartTag`, seven workers
parked in `__workq_kernreturn`.

Measured alternative: a regex scan of the same 33 MB buffer in **Python** finds
all 371,189 offsets in **97 ms**. A `memchr`/`strtoull` scan in C++ would be a
few tens of milliseconds. The DOM parse is ~250× slower than it needs to be.

**Fix.** Replace the DOM parse of the index list with a linear scan, keeping the
DOM path as the fallback when the scan does not find a well-formed list (the
scan validates by count and monotonic offsets; any anomaly → old path). Two
places it could live:
- *OpenMS overlay* (preferred): this repo already ships a patched OpenMS for
  mzPeak; adding ~40 lines to `IndexedMzMLDecoder::parseOffsets` is the same
  mechanism and benefits every OpenMS consumer. Worth offering upstream.
- *FASTag-side*: read the footer ourselves and feed offsets to a reader we
  own — only sensible together with finding 2.

Adversarial notes: ids in `<offset idRef="…">` may carry XML entities
(`&amp;`); FASTag addresses spectra by integer index, never by id, so the scan
can keep ids verbatim. Chromatogram offsets must be scanned too (the writer
uses their presence to detect list order). A file whose index is absent or
lies already falls back to a full load today; that path is untouched.

**Expected:** hela 47 → ~21 s at 8 threads, astral_lf 11.2 → ~4.5 s, and
`-threads` scales again (serial 32 s → ~6 s).

### 2. Every spectrum is decoded through a per-spectrum DOM parse — ~60% of read cost, read is ~75% of the loop

Traced chain (hela, t=25 s, per thread): `OnDiscMSExperiment::getSpectrum`
1980 samples → `getMSSpectrumById` 1861 → `MzMLSpectrumDecoder::domParseSpectrum`
1171 → `XercesDOMParser::parse` 977 → `DOMAttrImpl::setValueFast` 227 →
`dynamic_cast` 55. The remainder of the read is `decodeBase64Arrays` /
`inflate_fast` + `adler32_z` (the zlib checksum alone is 10–15% of inflate).
`tagSpectrum` accounts for ~300–1400 samples depending on the window — a
minority of the loop's time.

Per spectrum, the patched decoder builds a complete DOM of the `<spectrum>`
element to extract five things: MS level, precursor m/z and charge, and two
binary arrays with their compression/precision flags.

**Fix (the big one).** A lean spectrum scanner owned by FASTag: given the byte
slice from the index, find the handful of `cvParam` accessions it needs
(MS:1000511 ms level, MS:1000744 selected ion m/z, MS:1000041 charge, the
`<binaryDataArray>` blocks with MS:1000574/MS:1000576 compression and
MS:1000523/MS:1000521 precision) by string search — no DOM, no RTTI, no
`OpenMS::String` churn — then base64-decode and inflate. `libdeflate` is
already present in both the Homebrew and conda build environments and inflates
2–3× faster than zlib on this data shape. Keep the OpenMS decoder as the
fallback for anything the scanner does not recognise (numpress, unusual
writers, chromatograms), and gate the switch on byte-identical output across
the whole `doc/TEST-DATA.md` corpus.

Cheaper interim to verify first: whether `domParseString_` constructs a new
`XercesDOMParser` per call. If so, reusing one parser per thread is a small
patch worth ~20% of the parse cost. (Not verified in this pass.)

**Expected:** per-spectrum read −60–70%; with finding 1 landed, hela ~10 s
total at 8 threads, astral_lf ~3 s.

### 3. `-out_spectra` pass 2 is a single-threaded re-decode — 25 s of 36 s

The two-pass writer bounded memory (5,272 → 748 MB on astral_lf) by re-reading
kept spectra serially. The profile at t=20 s splits the single active thread as
`getSpectrum` 2168 samples (decode: DOM 1498 + base64/inflate 570) versus
`consumeSpectrum` 374 (encode + write). **85% of pass 2 is decoding the same
spectra the parallel loop already decoded once**, on one core, while seven idle
(`__psynch_cvwait` ≈ 17,900 samples). Threads 8 → 16 changed pass 2 by 1.4 s.

**Fix.** A bounded read-ahead ring: N workers decode kept spectra into
order-numbered slots; the main thread consumes them in order (the consumer
must stay serial — it bakes the count into the header at the first spectrum).
Memory stays O(ring). Expected pass 2: 25 → ~5 s (write-bound).

Larger, riskier option once finding 2's scanner exists: copy each kept
spectrum's XML slice byte-for-byte from the input (no decode, no re-encode),
rewriting only the `index="N"` attributes, the `spectrumList count`, and the
trailing index. I/O-bound — but fragile against writer variance; not before
the scanner has proven itself on the corpus.

### 4. The default is one thread, on a 16-core machine

`-threads` defaults to **1** (the TOPP standard), in the CLI and in the GUI's
generated manifest. The README calls it "the core performance lever" and never
states the default; one example passes it. A user following the docs runs
astral_lf in 44 s instead of 9 s — a 5× loss before any code changes.

**Fix (hours):** GUI manifest default → `0` (all cores); README examples and
the option table say `-threads 0` and state the default; consider overriding
the tool-level default to 0 as well. Note the E-core mix: 8 → 16 threads buys
17% today, bounded by the serial phase (finding 1), not by the cores.

### 5. Block writes stall the pool

`write_block` runs between parallel regions: every 64k spectra the workers
park while the main thread `fwrite`s ~6 MB of rows (2.4M rows / 240 MB on
hela), collects species pairs, and the OpenMP region re-forks. The Amdahl
residual after subtracting the measured setup (~32 − 25.8 ≈ 6 s on hela) is
this plus the 64-spectrum probe. **Fix:** double-buffer — hand block N's rows
to a writer thread while block N+1 tags — or simply raise `BLOCK` to 256k and
measure. Worth ~2–4 s on hela; only meaningful after findings 1–2.

### 6. Filter and index builds are serial and sort-bound

`FastaFilter::build` runs one length at a time; the profile during the build
shows `std::__introsort<Kmer128>` as the only hot non-idle frame (emission is
cheap). Each extra length costs ~1.4 s on human: the multi-length filter
(`-extension 2`, lengths 3–7) takes 19.6 s against 14.1 s single-length. In
the collapse-rules branch, `std::string cur` is constructed inside the
per-position loop — one heap allocation per residue per length (≈57M on human
× 5 lengths).

With `-entrapment_fasta` the second filter is built strictly after the first
(`FASTag.cpp` ~983), and `-recon_fasta`'s suffix-array sort (1.7 s) after that:
three independent builds, ~6 s serial at startup.

**Fix:** `omp parallel for` over lengths (they are independent; tighten
`projectBytes` to the parallel peak), hoist `cur` out of the loop, and build
the entrapment filter / proteome index concurrently with the target filter
(`omp sections`). A 128-bit LSD radix sort would beat introsort ~5× on these
packed keys if the sort still dominates afterwards. Expected: multi-length
build 7 → ~2 s; startup with all three databases 6 → ~2.5 s.

### 7. The species stage is serial but cheap — not a bottleneck

`-species` adds 0.9 s over a same-length run (12.44 vs 11.51 s). It is
allocation-heavy (a `substr` per k-mer, `std::set` per spectrum, fresh vectors
in the intersection loop) and fully serial, but at this size it does not
matter. Parallelising per spectrum with per-thread hit maps is easy if inputs
grow 10×; otherwise leave it.

### 8. Reconciliation is bounded and cacheable

`-recon_out` adds ~3.2 s on astral_lf for 130k filtered tags (locate is not in
the top frames). Tag strings repeat 1.7× at length 7 (78k distinct of 130k),
so a per-thread locate cache saves ≤40%; a 16-bit prefix bucket table (as
FastaFilter already has) skips the first three of ~eight refine steps. Useful,
not urgent. Note the default `tag_length 3` corpus is 260× repetitive — the
gate at the derived minimum length is what keeps recon affordable.

### 9. The tagging math, for later

`MSSpectrum::findNearest` is ~10% of the loop: `buildGraph` performs n × 19
binary searches per charge. A merge-style sweep (residue masses sorted; one
advancing pointer per residue as the source peak index rises) turns those into
sequential accesses. ~2× on the tagging share, i.e. ~5% of wall today —
relevant once findings 1 and 2 have removed the reading cost in front of it.

## Prioritised plan

| # | change | effort | expected (8 threads) |
|---|---|---|---|
| 1 | linear index-list scan, DOM as fallback | ½ day | hela 47 → ~21 s; astral_lf 11.2 → ~4.5 s; `-threads` scales again |
| 4 | `-threads` default 0 in GUI + docs | hours | 5× for anyone running the documented defaults |
| 3 | read-ahead ring for `-out_spectra` pass 2 | 1 day | 36 → ~16 s on astral_lf |
| 2 | lean spectrum scanner + libdeflate, OpenMS fallback | 3–5 days | loop −60–70%; hela ~10 s with #1 |
| 6 | parallel filter/index builds, allocation hoist | 1 day | multi-length filter −5 s; startup −3 s |
| 5 | double-buffered block writes | ½ day | −2–4 s on hela |
| 8/9 | recon buckets + cache; merge-sweep buildGraph | 1–2 days | −20–40% of recon; −5% of the loop |

Findings 1 and 4 together turn the 13 GB run from 47 s into roughly 20 s with
two small changes, and only then does anything inside FASTag's own algorithms
become the next thing worth measuring.

## Where this review could be wrong

- Serial fractions come from two independent routes — Amdahl on 8 → 16
  threads and direct setup-only runs — which agree to within the block-write
  residual (31.6 inferred vs 25.8 measured on hela). The profiles were sampled
  at three offsets per configuration, not continuously; a phase shorter than a
  window could be under-represented, which is why the setup-only runs exist.
- The DOM-parse costs are attributed from stack samples of a release build
  without frame pointers in every library; inlined frames inside Xerces may
  shift blame between `scanContent`/`scanStartTag` siblings, not between
  phases.
- Finding 2's fix is the only one with real correctness risk (mzML dialect
  variance); it is gated on a byte-identity corpus test and a permanent
  fallback for that reason. Finding 1's fix has a trivial fallback.
- All numbers are from one machine class (Apple silicon, fast NVMe, warm
  cache). On spinning disks or a cold cache the 13 GB read itself becomes a
  term (~1–2 min at 100–200 MB/s) that none of these changes address.
