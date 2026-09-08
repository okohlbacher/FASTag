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
FASTag -in run.mzML -out tags.tsv -tag_length 7 \
       -taxdb ref.taxdb -taxonomy_nodes nodes.dmp -taxonomy_names names.dmp \
       -species_out taxa.tsv -species_rank genus -subsample_fraction 0.2
```

`species_out` columns: rank, taxid, name, observed (spectra supporting the
taxon), **adjusted** (observed once sequence shared with other taxa has been
subtracted -- equal to observed unless `-species_deconvolve` is given), expected
(from the taxon's index breadth), log_pvalue, qvalue. Rows are ordered by
adjusted. Tags shorter than the index `k` are ignored (`-species_min_len`).

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
  (intersection), so a longer tag is more specific. Each taxon is counted ONCE
  per spectrum, not per tag, so correlated tags cannot manufacture evidence.
- Per-leaf counts and the index breadth are both rolled up the NCBI tree, and
  each node is tested against its subtree breadth (binomial + Benjamini-Hochberg
  in `TaxStats`). Reported per `-species_rank`.

## Validated end-to-end

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
  background is a proxy and the chimeric-null problem (F4 in `BACKLOG.md`)
  applies. Trust the top-ranked evidence, not the absolute q.
- **Reduced reference = genus/family only.** Species calls are out of scope by
  construction, and a taxon absent from the reference cannot be called (it will
  present as its nearest represented relative).
- Contaminants (trypsin=Sus, serum=Bos, keratin=Homo) are real signal, not
  noise — they show up because they are in the sample.
