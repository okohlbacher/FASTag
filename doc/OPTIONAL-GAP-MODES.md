# Optional modified-pair and triplet gaps

This feature branch extends FASTag 1.13.1 (`d16328b4a7f9746055dcc1623918867ff7ee6b93`).
Neither new mode is enabled by default. A gap is one graph edge between observed
peaks; its length is the number of residues assigned to their mass difference.
A pair spans one missing intermediate peak and a triplet spans two.

## Usage

```sh
# Existing search: ordinary variable-modified residues are still available,
# but gaps contain only base/fixed-modified residues.
FASTag -in run.mzML -out baseline.tsv -variable_modifications 'Oxidation (M)'

# Also allow one configured variable-modified residue inside a pair gap.
FASTag -in run.mzML -out modified-pairs.tsv -gap_variable_mods \
  -variable_modifications 'Oxidation (M)'

# Also allow base/fixed-modified triplets.
FASTag -in run.mzML -out triplets.tsv -max_gap_residues 3 \
  -variable_modifications 'Oxidation (M)'

# Both extensions, with common modifications for phospho-enriched samples.
FASTag -in run.mzML -out both.tsv -gap_variable_mods -max_gap_residues 3 \
  -variable_modifications 'Oxidation (M)' 'Phospho (S)' 'Phospho (T)' 'Phospho (Y)'
```

The modification list is explicit and uses the existing OpenMS resolver. No
sample-independent modification list is silently added. Fixed modifications
already apply to pairs in the existing algorithm. The library adds variable
deltas to the fixed-modified residue mass, preserving its previous semantics.
`-gap_variable_mods` without variable modifications is a no-op. `-gaps 0`
disables all gap edges. `-max_gap_residues` accepts only 2 or 3.

## Algorithm

1. Build the existing ordinary-residue alphabet, including configured variable
   alternatives. Build the existing unordered base/fixed pair compositions.
2. With `gap_variable_mods`, add pairs containing one base/fixed residue and one
   variable alternative. With `max_gap_residues=3`, add unordered base/fixed
   triplets. I/L remain folded. No pair contains two variable alternatives;
   no triplet contains a variable alternative.
3. For each fragment charge, match observed peak differences against the gap
   mass table. Keep separate pair and triplet edges when the same endpoints
   support both lengths. Suppress a pair when an ordinary two-edge route
   connects its endpoints. Suppress a triplet when an ordinary three-edge
   route, or an ordinary edge plus a pair gap in either order, connects them.
   This is an endpoint-level redundancy rule, consistent with the existing
   pair rule; it does not establish a unique underlying sequence.
4. Walk paths spending one, two, or three residues per edge, admitting at most
   one gap and requiring the exact seed residue budget. Greedily extend each
   seed at either end using ordinary edges only, as before.
5. Enumerate compatible compositions and their distinct residue orders,
   retaining each composition's complete permutation group. The existing pair
   cap is 8 spellings; the triplet cap is 48. Compositions are visited in mass
   order with a deterministic spelling order for isobars. Stop before a group
   would exceed the cap. These caps can exclude valid heavier compositions.
6. Rescore each spelling with its own composition mass. Null tables use the
   number of observed peaks, including two-peak, three-residue seeds. Each
   residue in a gap shares the confidence of the same unresolved edge.
   Candidate multiplicity, the existing gap penalty (100 by default), and
   the output cap apply as before.

The larger alphabet increases ambiguous candidates. A triplet at seed length
3 can have only two observed peaks; the two missing internal cleavages do not
support any particular order. The new modes do not add a new calibration of
the E-value score or gap penalty. Results below use the existing penalty and
evaluate seed lengths 3 and 5 separately.

## Benchmark

The controlled comparison uses two public runs already present in the paper's
benchmark collection. The input mzML checksums are verified against that
collection. Reference identifications are the existing Sage target rank-1 PSMs
at spectrum q-value <= 0.01; they were not regenerated or selected using these
gap-mode outputs.

| Dataset / run | Reference spectra | Configured variable modifications | Fragment tolerance |
| --- | ---: | --- | --- |
| PXD003531 / `20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML` | 8,254 | Oxidation (M), Phospho (S/T/Y) | 20 ppm |
| PXD001819 / `UPS1_25000amol_R1.mzML` | 13,342 | Oxidation (M) | 0.5 Da |

Both use fixed Carbamidomethyl (C). Of the reference spectra, 4,358 in PXD003531
carry at least one configured variable modification (1,891 oxidation, 2,924
phosphorylation, with overlap), and 205 in PXD001819 carry oxidation. The Sage
search also allowed N-terminal acetylation, and N/Q deamidation in PXD003531;
these remain in the reference set but are not added to the tested FASTag
variable alphabet. The exact Sage configuration and provenance are retained
beside the local input files.

Five arms compare the release binary, the feature binary with both modes off,
modified pairs, triplets, and both. Every arm has the same fixed/variable
modification lists, seed length, gap limit (1), extension (0), peak selection
(400 maximum; 10 per window), score cutoff (20), gap penalty (100), and output
cap (50). Seed lengths 3 and 5 are evaluated separately. This isolates the new
gap search from the already-existing support for ordinary modified residues.

The paper's primary correctness rule requires an I/L-folded tag sequence (or
its reverse) to occur in the reference peptide and at least one flanking mass
to agree at that occurrence within 0.05 Da. It ignores modification labels.
The supplementary **strict mass** rule additionally requires each residue's
fixed-plus-variable mass to match the reference at the same occurrence within
0.02 Da, respecting orientation. It measures agreement with Sage's modification
assignment, not independently established phosphosite localization.

**Recall@50** is the fraction of all reference spectra with at least one correct
tag among the reported top 50. **Rank-1 accuracy** is the fraction of all
reference spectra whose first tag is correct. A spectrum with no returned tag
is a miss under both measures. Conditional rank-1 precision among spectra with
tags is also retained in the machine-readable results. Per-spectrum paired
gains/losses distinguish new recoveries from lost correct tags.

Timing uses three sequential repetitions per arm and length, with reproducibly
shuffled arm order within each repetition. Runs use one FASTag thread on the
same Apple M4 Max (16 cores, 128 GiB RAM). File hashing warms the input cache;
wall times include process startup, reading the complete input, tagging all
spectra, and writing the tag TSV. They are end-to-end times, not isolated graph
search times. Both binaries use AppleClang 21.0.0.21000401, Release optimization,
OpenMP, and the same OpenMS 3.7.0 development SDK
(`3.7.0-pre-exported-20261104`). No builds or tests run concurrently with timing.

## Validation

- 85 C++/CLI tests passed. Four optional integration tests were skipped because
  external search engines, mzPeak inputs/validator, or a pyteomics environment
  were unavailable. Two filesystem-sensitive tests passed when rerun outside
  the sandbox.
- The release compatibility test passed 126 comparisons: 123 unchanged and
  three expected option additions. Two taxonomic index outputs were identical.
- New tests exercise modified-pair opt-in and exclusion, all triplet orders,
  isobaric pair/triplet endpoints, approximate-isobar mass closure, observed-peak
  nulls, residue budgets, extension, redundant-gap suppression, multiple seed
  lengths, and invalid gap limits.
- GUI type checking and 26 parameter-contract/dependency tests passed. The GUI
  parameter manifest was regenerated from the built CLI.
