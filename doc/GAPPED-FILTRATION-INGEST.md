# Ingest: `t0mdavid-m/GappedFiltration`

Read-only clone at `../GappedFiltration` (push remote disabled). 714 LOC of
Python across 3 files, 5 commits, HEAD `c41424c`. First commit names the intent:
*"Gapped filtration prototype for top-down proteomics database filtration"*.

This note is what the prototype actually does, how it differs from the gapped
tags FASTag already ships, and which parts are worth taking.

## What it is

A **top-down** database-filtration prototype. Input is FLASHDeconv output
(`out_spec2_with_ids.tsv`) — one row per deconvolved *monoisotopic fragment
mass* of an intact protein, with a `Qscore`. Output is, per scan, a shortlist of
candidate proteins from a FASTA (plus the supporting tags). It is scored against
TopPIC identifications via an `identified` flag; `plot_results.py` plots
recovery vs. e-value, hit count, and per-spectrum runtime.

It is **not** a tagger in FASTag's sense: it never spells a residue.

## The algorithm, in five ideas

1. **Mass-only gapped tags.** Build a DAG over the scan's deconvolved masses
   (ascending). An edge `i→j` exists iff the difference is a *plausible
   sub-peptide mass*: `57 ≤ Δ ≤ 2000` Da. Every edge is a gap of unknown
   composition — up to ~35 residues (2000/57, polyglycine worst case). A "tag"
   of size `n` is a chain of `n` masses, i.e. `n-1` such gaps.

2. **Plausibility index.** Precompute `achievable[u]`, a boolean over masses on a
   1/10000 Da grid, marking every mass reachable as a sum of amino-acid masses
   (DP over `max_length` residues). A prefix sum `ach_csum` then answers "is any
   achievable mass inside this ±ppm window?" in O(1). This prunes edges whose gap
   mass no peptide can have.

3. **Bitset database index — the interesting part.**
   `mass_dict[mass_key] → bitarray(total_residues)`, one bit per residue position
   over the *concatenated* database (sentinels between proteins), set iff a window
   starting at that position has that mass. Built by sliding every window length
   `1..max_length` over a cumulative-sum array.
   Matching a tag is then a **bitwise AND**:
   ```python
   n_matched |= reduce(and_, (mass_dict[key(m - base)] for m in path[1:]))   # N-terminal
   c_matched |= reduce(and_, (mass_dict[key(top - m)] for m in reversed(...)))# C-terminal
   ```
   The AND of the prefix-mass bitsets is exactly the set of positions where the
   whole gapped tag lands. Per-protein score = popcount over the protein's range.

4. **Beam search with reachability pruning** (`beam.py`). Top-`W` paths by summed
   Qscore. `fdepth[i]` = longest forward path from node `i`, computed once by a
   backward sweep; a child is kept only if `fdepth[child] >= n - k`, so the beam
   never explores a prefix that cannot reach length `n`. Sources are restricted to
   nodes with `fdepth >= n-1`.

5. **Descending tag size, early exit.** Try `n = max_tag_size … min_tag_size`
   (7→3) and stop at the first size that matches anything — prefer the longest,
   most specific tag that still lands.

## How this differs from FASTag's gapped tags

FASTag already has gaps, and they are a *much* narrower construct.

| | FASTag (`-gaps`) | GappedFiltration |
|---|---|---|
| Domain | bottom-up peptide MS/MS | top-down, FLASHDeconv intact-protein masses |
| Gap width | **exactly 2 residues**, from a 190-entry pair table | **any mass 57–2000 Da** (~1–35 residues) |
| Gaps per tag | at most **one** | **every edge is a gap** |
| Output | a spelled residue string (`QAA`) | no residues at all — a chain of masses |
| Scoring | E-value, with `-gap_penalty 100` for over-scoring | summed FLASHDeconv Qscore |
| DB lookup | (open backlog item **F2**: substring/FM-index) | bitset AND over a mass-window index |
| Purpose | produce tags to filter/identify spectra | shortlist candidate proteins per scan |

The key conceptual split: **FASTag's tags are strings; these are mass paths.**
FASTag's gap penalty exists precisely because a gap edge is chosen as the best
fit from a 190-entry table and so is over-scored. Here that problem is structural,
not incidental — no edge is ever spelled, so nothing is over-scored *relative* to
anything else, and specificity has to come from tag length and the DB index
instead.

## What is worth taking

- **The bitset-AND matching (idea 3) is a real answer to backlog F2**, from an
  unexpected direction. F2 is framed as "FM-/substring index for tag→DB lookup",
  i.e. search for spelled tags. This sidesteps spelling entirely: index the DB by
  *mass window* and intersect. Worth evaluating on its own merits for FASTag's
  `-fasta` filtering path.
- **The plausibility index (idea 2)** is directly reusable and cheap: FASTag could
  use it to reject implausible gap masses before scoring, independent of anything
  else here.
- **`fdepth` reachability pruning (idea 4)** is a clean, transferable trick for
  any DAG path enumeration, including FASTag's own extension search.

## What does not transfer as-is

- **Top-down vs bottom-up.** The input is deconvolved intact-protein fragment
  masses. FASTag consumes peptide MS/MS peaks. The *filtration concept* ports; the
  data does not.
- **Memory.** `mass_dict` is `(scaled_max - scaled_min + 1)` bitarrays of
  `total_residues` bits. At the defaults (57–2000 Da, 0.1 Da bins → 19,431 keys):
  - *E. coli* (~1.45 M residues) ≈ **3.5 GB**
  - human (~11 M residues) ≈ **27 GB**
  This is the scaling wall, and it is inherent to the dense-bitset design, not an
  implementation detail. Any integration needs a sparser structure (postings lists,
  roaring bitmaps, or an FM-index over masses) before it touches a real proteome.
- **Early-exit on first matching size** biases toward whichever size happens to
  hit first; it is a prototype heuristic, not a calibrated rule.

## Open questions before integrating

1. Do we want mass-only tags in FASTag at all, or only the *index* idea applied to
   the spelled tags we already produce? These are separable.
2. If mass-only: what is the output contract? Today a tag row carries a residue
   string; a mass path has none.
3. What is the false-positive rate of a 3-node mass path against a real proteome?
   Unspelled gaps are far less specific than spelled residues — the prototype's
   own `num_hits` distribution is the place to look.
4. Bottom-up port: on peptide MS/MS the mass range 57–2000 Da spans most of the
   precursor, so the DAG is much denser than top-down. Does the beam survive it?
