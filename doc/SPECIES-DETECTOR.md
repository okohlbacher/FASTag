# Species / taxonomic detection

FASTag can infer the taxa present in a run directly from its tags — no database
search — by matching tag k-mers against a prebuilt tag→taxon index and ranking
taxa by lowest-common-ancestor evidence. Kraken-2-for-peptide-tags, over a
**reduced** reference set so the resolution is honestly genus/family.

## Use

```bash
# 1. Build the index once, from a directory of <taxid>.fasta files
buildtaxdb proteomes/ ref.taxdb 7        # k=7

# 2. Detect, alongside normal tagging (subsample for speed on big runs)
FASTag -in run.mzML -out tags.tsv -tag_length 7 -species \
       -taxdb ref.taxdb -taxonomy_nodes nodes.dmp -taxonomy_names names.dmp \
       -species_out taxa.tsv -species_rank genus -subsample_fraction 0.2
```

`-species` with no `-taxdb`/`-taxonomy_*` uses the bundled taxonomy.

`species_out` columns: rank, taxid, name, observed (spectra supporting the
taxon), **adjusted** (observed once sequence shared with other taxa has been
subtracted -- equal to observed unless `-species_deconvolve` is given), expected
(from the taxon's index breadth), log_pvalue, qvalue. Rows are ordered by
adjusted. Only taxa supported by at least 5 spectra are tested and listed, and
at most 50 rows are written. Tags shorter than the index `k` are ignored (`-species_min_len`).

`adjusted` replaced `enrichment`, which was never usable for ranking: a small
proteome gives a tiny expectation and therefore a huge ratio, and this document
already told readers to ignore it.

## How

- **Only ungapped tags count.** A gap spells two residues from one summed mass,
  which is an inference, and an exact k-mer lookup cannot tell an inferred
  residue from an observed one. `-species_use_gapped` restores the old
  behaviour. This matters from v1.4.0 on, where `-gaps 1` became the tagging
  default -- v1.4.0 shipped with the defect and v1.4.1 repairs it.

  Rank of the expected genus, four samples, admitting gapped tags against
  excluding them:

  | sample | expected | gapped admitted (v1.4.0) | excluded (v1.4.1) |
  |---|---|---|---|
  | PXD000001, LTQ Velos | Pectobacterium | **20** | **1** |
  | CPTAC, Fusion Lumos | Homo | 1 | 1 |
  | PXD076528, Astral | Homo | 1 | 1 |
  | Eclipse, ion-trap MS2 | Homo | **6** | **2** |

  Decisive on two, neutral on two, harmful on none. The two it rescues are the
  hard cases: a bacterial sample, and low-resolution ion-trap MS2.
- The index maps each I/L-folded k-mer to the SET of taxa whose proteins carry
  it (breadth, not abundance). A **reduced** reference — one representative
  proteome per genus/family — is deliberate: short peptide k-mers cannot resolve
  species, and a curated set keeps the LCA honest and the index small.
- A tag supports a taxon only if EVERY one of its k-mers is in that taxon
  (intersection), so a longer tag is more specific.
- **Which tags count** (`-species_evidence`). With `best` (the default), a
  spectrum counts once for the taxa of its lowest-E-value tag that maps into the
  index, and ties are united. With `all`, it counts once for the union over every
  reported tag, which was the only rule up to 1.9.0. A spectrum is one peptide,
  but up to `-max_tags` tags are reported for it, and under the union each wrong
  tag added the taxa its k-mers hit by chance. See the README section "A spectrum
  counts for the taxa of its best tag".
- Each spectrum counts once for every node on the lineages of its taxa, so a
  genus with two supported species still counts that spectrum once. The index
  breadth is summed up the NCBI tree as the background, and each node is tested
  against its subtree breadth (binomial + Benjamini-Hochberg in `TaxStats`).
  With `-species_deconvolve`, the adjusted leaf estimates are summed up the tree
  for the `adjusted` column. Reported per `-species_rank`.

## Validated end-to-end

All counts and ranks in this document were measured before 1.10.0 with the
union rule, which is now `-species_evidence all`. The default `best` gives
different counts.

Two real runs, a reduced 17-taxon reference (target + Enterobacterales
near-neighbours + background bacteria + the spike/contaminant animals):

- **PXD000001** (*Erwinia/Pectobacterium carotovora*, the ECA=*P. atrosepticum*
  SCRI1043 proteome in the index): **Pectobacterium ranks #1** by evidence
  (1807 spectra), and the spikes/contaminants surface — **Bos** (BSA +
  cytochrome C), **Oryctolagus** (rabbit PYGM), **Sus** (trypsin).
- **Human CPTAC (Thermo Lumos)**: **Homo ranks #1** (3326), no bacterial genus
  near the top — the detector identifies the sample organism and does not
  spuriously call the bacterial target. A clean discrimination control.

## Correcting for shared sequence (`-species_deconvolve`, opt-in)

Counting cannot separate near neighbours: the counts really are there, they are
just not independent evidence. The index knows how much any two taxa share, so
the shared part can be subtracted. With `P[i][j] = |kmers(i) & kmers(j)| /
|kmers(j)|` the observed counts are `E = P N`, and the wanted quantity is
`N = P^-1 E` under `N >= 0` -- solved by non-negative least squares in
`TaxDeconv`. The approach is MARLOWE's (Sci Rep 2026), which introduced it for
de novo tags, the same input class FASTag has.

**Measured on PXD000001** (Pectobacterium, ungapped tags):

| | #1 | #2 | #3 |
|---|---|---|---|
| off | Pectobacterium 1768 | Oryza 1351 | Zea 1300 |
| on | **Pectobacterium 1131** | **Dickeya 481** | **Yersinia 475** |

Rice and maize are replaced by Pectobacterium's actual relatives, which is the
correction working exactly as intended.

**It is opt-in, and four samples say why.** Rank of the expected genus, and
what sits behind it:

| sample | expected | off | on |
|---|---|---|---|
| PXD000001 | Pectobacterium | 1, tail Oryza/Zea | 1, tail **Dickeya/Yersinia** |
| CPTAC | Homo | 1, tail Macaca/Equus | 1, tail Chlamydomonas/Drosophila |
| PXD076528 Astral | Homo | 1, tail Macaca/Bos | 1, tail Xenopus/Oryctolagus |
| Eclipse ion-trap | Homo | **2** | **38** |

One decisive win, two where the tail merely changes which implausible genus it
names, and one where the answer is destroyed: on noisy ion-trap MS2 the
correction amplifies noise and Homo falls from rank 2 to 38. A matrix inverse
cannot distinguish shared sequence from bad tags.

It also suppresses genuine low-abundance taxa: the PXD000001 spike-ins fall
from Sus 1176 -> 0.0 and Bos 1199 -> 8.2, when trypsin and BSA really are in
that sample -- the failure MARLOWE reports against MiCId on low-abundance
secondary contributors.

Use it on high-resolution MS2 when the sample's likely relatives are in the
reference and the question is "which of these related taxa". Leave it off for
ion-trap data, and when low-abundance components matter. Both counts are always
in the report, so nothing is hidden either way.

## MiCId's 1/r weighting: tried, measured, NOT adopted

MiCId weights a peptide by `w = 1/r`, r being how many database proteins it maps
to, and combines them as `tau = prod_k [prod_j p_kj]^(w_k)` (Alves & Yu,
*Bioinformatics* 2015). It is the one genuine IDF-style scheme in this
literature, and it outperforms MARLOWE on exactly the low-abundance
contributors that deconvolution suppresses -- so it looked like the better
answer.

It was implemented here and it is worse. Rank of the expected genus:

| sample | no correction | deconvolution | 1/r (max) | 1/r (summed) |
|---|---|---|---|---|
| PXD000001 | 1 | 1 | 1 | 1 |
| CPTAC Lumos | 1 | 1 | 1 | 1 |
| PXD076528 Astral | 1 | 1 | 1 | 1 |
| Eclipse ion-trap | **2** | 38 | **20** | **19** |

Both aggregations were tried -- max per spectrum, which preserves the
one-spectrum-one-vote invariant, and the sum MiCId actually uses. They agree.
Neither improves the near-neighbour tail either: PXD000001 keeps
Chlamydomonas and Oryza behind Pectobacterium, where deconvolution replaces
them with Dickeya and Yersinia.

**The reason is structural, and it is the useful part of this result.** `1/r` is
SYMMETRIC: when Homo and Macaca share a tag, r = 2 and both get 0.5, so their
relative order is untouched. A weight that treats two taxa identically cannot
separate them, and separating near neighbours is the whole problem.
Deconvolution works precisely because its matrix is ASYMMETRIC --
`P[i][j] = shared(i,j)/|kmers(j)|` differs from `P[j][i]` whenever the two taxa
have different proteome sizes, which is what lets one explain the other away.

Two further reasons it transfers badly: FASTag already requires a taxon to carry
EVERY k-mer of a tag, which is itself a strong specificity filter, so r has
little dynamic range left to exploit; and MiCId weights confidently identified
peptides of 8-25 residues against a large protein database, a completely
different r distribution from 7-mer tags against 50 genera.

Do not re-explore this without changing one of those three things.

## Two filters that are implemented but did nothing here

`-species_max_kmer_share` ignores k-mers carried by more than a given fraction
of the reference (they cannot discriminate). `-species_min_margin` drops tags
whose best taxa carry no more of the tag than the runner-up -- MARLOWE's
contrastive rule, adapted, since one proteome per genus leaves no within-genus
fraction to compare with.

Both default to their identity settings, and honestly so: at
`-species_max_kmer_share 0.5` only **212 k-mers** were skipped on PXD000001 and
**no tag** failed the margin test at 0.2, leaving the ranking unchanged. The
whole-tag intersection rule is evidently already doing most of this work. They
are kept because they cost nothing when off and the numbers above are one data
set, not a proof.

## Calibrated presence or abstention (`-species_call decoy`, opt-in, 1.12)

`-species_call decoy` adds a call to every row of the report: `present`,
`no_call` or `not_detected`. The report never says "absent". The default,
`none`, writes the report as before, byte for byte.

**The null.** Every evaluated target tag is also looked up as
`-species_call_decoys` (D, default 5) deterministic decoy tags through the same
filters. A decoy tag keeps the composition and length of its tag (I/L folded)
and is never the forward or reversed sequence. With d_g decoy spectra for
taxon g, summed over the D replicates, and N trials (spectra with at least
one evaluated target tag), the expected count is

    lambda_g = spill_g + (d_g + 0.5) / D

The second term is the random part. The first, `spill_g`, is the homology part:
the sum over the taxa h that rank above g (more observed spectra) and are
called present of C[g][h] * N_h. Here N_h is the deconvolved count of h, and
C[g][h] = P(k-mer in g | k-mer in h) comes from the number of DISTINCT
indexed k-mers shared by the two report-rank groups (`TaxIndex::groupOverlap`).
A k-mer shared by several members of one group counts once, so C stays a
probability at family or order rank and for an index with several strains
per genus. The p-value is the Poisson tail P(X >= o_g | lambda_g). q-values
are Benjamini-Hochberg over the taxa with at least 5 spectra, or Storey with
`-species_pi0` below 1 (0 estimates pi0).

**The decision**, in this order:

| call | call_reason | when |
|---|---|---|
| no_call | low_resolution | `-fragment_tolerance_unit Da` (every row) |
| no_call | few_spectra | fewer than `-species_call_min_units` (200) spectra with taxon evidence (every row) |
| present | pass | q <= alpha, share >= tau, observed >= n_min, consistently with the spill (below) |
| no_call | unstable | qualifies with spill from the present set, but cannot join it consistently |
| no_call | near_neighbour | spill > 0, and q <= alpha on the random part alone but not with the spill |
| not_detected | not_significant, low_share, few_genus_spectra | otherwise, with a detection limit `lod` |

**The present set is self-consistent.** Spill only comes from taxa called
present, and presence depends on the q-values of all taxa, so the present set S
has to reproduce itself: S = F(S), where F(S) is the set of taxa that qualify
with spill from S. Benjamini-Hochberg couples the taxa, so F can cycle. For
example, taxon X explains Y through its spill, which ranks X first and lifts
q_X over alpha; without X present the spill is gone and both qualify again.
FASTag iterates F from the empty set until a set repeats. On a fixed point,
that set is S. On a cycle, S is the intersection of the sets in the cycle,
shrunk until every member qualifies on spill from S alone. A taxon that
qualifies on spill from S but is not in S is `no_call unstable`. The reported
statistics are always those computed with spill from the final S. Neither the
number of untested taxa nor any iteration bound changes a call.

**Columns** (appended after `qvalue`, only with `decoy`): `call`,
`call_reason`, `decoy_spectra` (d_g), `decoy_expected` (lambda_g; named so
because `expected` already holds the 1.10 binomial expectation), `decoy_qvalue`,
`share` (the deconvolved count over the run's units, or observed over units)
and `lod` (the smallest share that would have been called present in this run;
-1 where it does not apply). Downstream readers (the GUI, fastag-bench species
scoring) must read `decoy_expected`, not `expected`, for the call's null.

**Parameters.** alpha, tau and n_min are read from `species_call.tsv` in the
taxonomy directory (installed beside the index, and restored there by the
release workflows after the index tarball is unpacked), or from
`-species_call_params`. The shipped values (alpha 0.01, tau 0, n_min 10,
calibrated for D = 5) are PROVISIONAL: they are not fitted yet, and
`-species_call` stays opt-in until the held-out acceptance passes. A different
`-species_call_decoys` from the one the file states gives a warning.
`-species_call` refuses `-stream`.

## Honest limitations

- **Conserved proteins inflate near-neighbours.** Bacterial genera (Escherichia,
  Salmonella, Yersinia) appear on the Erwinia run because conserved bacterial
  proteins share k-mers; the true genus still wins on evidence, but the tail is
  not clean. `-species_deconvolve` addresses this directly -- see above for what
  it costs.
- **Any specificity measured here is an upper bound.** A k-mer looks unique
  because there are only ~50 proteomes available to contradict it. The
  deconvolution inherits that: it is a correction, not a calibrated abundance.
- **The q-value is a ranking aid, not a calibrated FDR.** The per-k-mer
  background is a stand-in for the true chance rate, and no simple null model
  reproduces tags from mixed (chimeric) spectra. Trust the top-ranked evidence,
  not the absolute q.
- **Reduced reference = genus/family only.** Species calls are out of scope by
  construction, and a taxon absent from the reference cannot be called (it will
  present as its nearest represented relative).
- Contaminants (trypsin=Sus, serum=Bos, keratin=Homo) are real signal, not
  noise — they show up because they are in the sample.
