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
  residue from an observed one. Admitting gapped tags is not a small effect: on
  PXD000001 it drops the true genus from **rank 1 to rank 20** and puts Oryza,
  Zea and Chlamydomonas on top of a bacterial sample. `-species_use_gapped`
  restores the old behaviour. This matters from v1.4.0 on, where `-gaps 1`
  became the tagging default.
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

**It is opt-in anyway, because a second control does not agree.** On a human
CPTAC run the mammalian block (Macaca at 93% of Homo) is indeed dispersed, but
what replaces it is no better: Chlamydomonas at 92% of Homo. The #1/#2 margin
moves from 1.07 to 1.09 -- no real gain. And it suppresses genuine
low-abundance taxa: the PXD000001 spike-ins fall from Sus 1176 -> 0.0 and
Bos 1199 -> 8.2, when trypsin and BSA really are in that sample. That is the
failure MARLOWE reports against MiCId on low-abundance secondary contributors.

Use it when the sample's likely relatives are in the reference and the question
is "which of these related taxa"; leave it off when low-abundance components
matter. Both counts are always in the report, so nothing is hidden either way.

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
