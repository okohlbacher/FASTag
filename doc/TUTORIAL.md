# FASTag tutorial

Part 1 takes about ten minutes: tags, a protein filter and a placement report on a small
*E. coli* run that ships with FASTag. Part 2 repeats the main steps on PXD000001, a public
450 MB run with a published database search to compare against.

You need the FASTag command line (README, Install). Check the version:

```bash
FASTag --help | grep Version
# Version: 1.15.0 (OpenMS 3.7.0-pre-HEAD-2026-11-02)
```

The numbers below were produced with FASTag 1.15.0. Another version can give other counts.

## Part 1: a small *E. coli* run

### The example files

| File | What it is |
|---|---|
| `examples/Ecoli_MS2_small.mzML` | 139 MS2 spectra of an *E. coli* digest, LTQ Orbitrap XL, CID with ion-trap MS2 (OpenMS's example file; 1.1 MB, sha256 `30717211f2a832e281604a4cdc12d13d74f484d9fb51a5d94a62f80713c16f6e`) |
| `examples/Ecoli_MS2_small.fasta` | three *E. coli* K-12 proteins the run's peptides come from: prsA, metK, rplF (sha256 `8f4fac71178db2a0d968ea5a05e5334faf75e22af3392861f9b6526e8446de9e`) |

`examples/` is in the release downloads (the `FASTag/` folder of the CLI archive or disk
image). In the source tree the same files are `test/fixtures/Ecoli_MS2_small.mzML` and
`test/fixtures/Ecoli_MS2_small.fasta`. Copy them to a working folder and run the commands
there; every run below takes well under a second.

### Step 1: tags for every spectrum

FASTag's default fragment tolerance is **20 ppm**, for high-resolution MS2 (Orbitrap,
timsTOF, Astral). This run's MS2 spectra were recorded in the ion trap, which resolves far
less, so the tolerance has to be set in Da. See what the default does first:

```bash
FASTag -in examples/Ecoli_MS2_small.mzML -out tags_20ppm.tsv
```

```
No two peaks anywhere in this file are closer than 0.600342 Th, yet the fragment tolerance is
0.00722706 Th near m/z 361.353. That is what low-resolution (ion trap) MS2 read with a
high-resolution tolerance looks like, ... If the MS2 is ion trap, try -fragment_tolerance 0.3
-fragment_tolerance_unit Da.
139 MS2 spectra, 2028 tags
```

FASTag cannot know the analyser, but it notices that the peak spacing does not fit the
tolerance. (The desktop app shows the same warning and offers "Re-run with 0.3 Da".) Run
again with the ion-trap tolerance:

```bash
FASTag -in examples/Ecoli_MS2_small.mzML -out tags.tsv \
       -fragment_tolerance 0.3 -fragment_tolerance_unit Da
```

```
139 MS2 spectra, 5937 tags
FASTag took 0.04 s (wall), ...
```

Expected: `tags.tsv` has 5,937 rows plus a header, from all 139 spectra (at most 50 tags per
spectrum, `-max_tags`). Wall time on an Apple M4 Max was 0.04 s (about 0.1 s including
start-up). The first rows:

```
spectrum                                        tag  length charge nterm_mass cterm_mass extended gapped evalue     min_conf mean_conf fasta_hit
controllerType=0 controllerNumber=1 scan=11461  CVA  3      1      321.2195   563.2563   0        0      0.0248664  0.618    0.768     -
controllerType=0 controllerNumber=1 scan=11461  VAE  3      1      481.2719   434.1920   0        0      0.0560095  0.639    0.775     -
controllerType=0 controllerNumber=1 scan=11461  VAD  3      1      481.2681   448.2114   0        0      0.0644321  0.607    0.765     -
controllerType=0 controllerNumber=1 scan=11461  SVA  3      1      394.1951   563.2793   0        0      0.11226    0.413    0.700     -
```

(The file is tab-separated; it is aligned here for reading.)

| Column | Meaning |
|---|---|
| `spectrum` | the spectrum's native ID in the input |
| `tag` | the residues read from the fragment ladder (I is written as L; they have the same mass) |
| `length` | residues in the tag (seed length 3 by default, longer with `-extension`) |
| `charge` | fragment charge the ladder was read at |
| `nterm_mass`, `cterm_mass` | the unexplained masses before and after the tag, in Da: tag residues plus both flanks plus water give the precursor's neutral mass. A tag read off b ions appears reversed. |
| `extended`, `gapped` | 1 when the tag was extended beyond the seed, or crosses one missing peak |
| `evalue` | how often a tag this good is expected by chance in this spectrum; lower is better. Rows of a spectrum are sorted by it. A gapped row's E-value is multiplied by `-gap_penalty` (100). |
| `min_conf`, `mean_conf` | per-residue support, 0 to 1, higher is better; `min_conf` points at the weakest residue |
| `fasta_hit` | `-` here; with `-fasta` it says how the tag matched (step 2) |

The best-ranked tag per spectrum is the first one; it is the row to look at first. The README
(Output) has the full schema.

### Step 2: keep only tags from your proteins

`-fasta` keeps the tags that occur in the given sequences, and `-out_spectra` writes the
spectra carrying them. A tag of 3 residues occurs in almost any protein by chance, so extend
the tags (`-extension 1` gives tags of up to 5 residues; README, Usage, explains the rule):

```bash
FASTag -in examples/Ecoli_MS2_small.mzML -out hits.tsv \
       -fragment_tolerance 0.3 -fragment_tolerance_unit Da \
       -fasta examples/Ecoli_MS2_small.fasta -extension 1 -out_spectra hits.mzML
```

```
Filter: 3 sequences, 876 residues; minimum tag length 4 (derived); 13 isobaric rules
139 MS2 spectra, 6671 tags -> 105 after filtering
  len         tags      matched    by chance enrichment
    3          182            0           77          -
    4         2450           70           90       0.8x  <- at chance
    5         4039           40           10       3.9x
Wrote 57 spectra to hits.mzML (two-pass, O(1) memory)
```

Expected: 105 tag rows from 57 spectra in `hits.tsv` (59 `fwd`, 46 `rev`), and 57 spectra in
`hits.mzML`. Tags shorter than 4 are not matched at all (the derived minimum). The table is the
most useful part of the log: for each length it compares the matches with the number expected
by chance against these sequences. Length 4 matches no more often than chance (0.8x), so those
rows say little; length-5 matches are 3.9 times more frequent than chance. To keep only the
informative lengths, add `-min_filter_length 5` (40 rows from 13 spectra), or extend further
(`-extension 2` reaches length 7, at 641x enrichment).

`fasta_hit` is `fwd` when the tag occurs as written and `rev` when it occurs reversed (read
off b ions). The rows with the lowest E-value are length-5 tags of rplF from one spectrum
(`DGWAQ`, E = 4.29e-11; `ADGWA` and `GWAQA`, E = 1.10928e-10), then metK (`VDTYG`).

To see which protein a tag matched and where, add `-fasta_proteins 3`: three more columns,
`db_proteins` (`VIMSS17368@61-65` for `GWAQA`: the protein and the 1-based positions of the
match), `db_genes` (the `GN=` of the FASTA header, `-` here because this FASTA has none) and
`db_protein_count` (how many proteins hold the tag).

### Step 3: where do the tags lie in the proteins?

`-recon_out` places each reported tag on tryptic peptides of the database and checks both
flanking masses; `-census` adds one row per spectrum saying what became of it.

```bash
FASTag -in examples/Ecoli_MS2_small.mzML -out place.tsv \
       -fragment_tolerance 0.3 -fragment_tolerance_unit Da \
       -fasta examples/Ecoli_MS2_small.fasta -extension 1 \
       -recon_out place.recon.tsv -census
```

```
Census: 139 MS2 spectra read, 54 with a reported tag (6 placed), 0 no_tags -> place.census.tsv, ...
```

Expected: `place.recon.tsv` has 102 placement rows from 6 spectra; `place.census.tsv` has 139
rows: 6 `placed`, 48 `tagged` (a tag passed the filter but its flanks fit no peptide) and 85
`filtered` (no tag matched the proteins). The first rows of the placement report:

```
spectrum                                       tag    protein     peptide                         pos reversed nterm_match cterm_match delta_mass region delta_interp
controllerType=0 controllerNumber=1 scan=11482 GAQAW  VIMSS17368  DGYADGWAQAGTAR                  6   1        1           1           0.0000
controllerType=0 controllerNumber=1 scan=11482 GAQAW  VIMSS17368  DGYADGWAQAGTARALLNSMVIGVTEGFTK  6   1        1           0           -1660.9280 11-29  ?
controllerType=0 controllerNumber=1 scan=11482 GAQAW  VIMSS17368  HADNTLTFGPRDGYADGWAQAGTAR       17  1        0           1           -1209.5422 0-16   ?
```

A row with both `nterm_match` and `cterm_match` 1 places the whole spectrum on that peptide:
the tag and both flanking masses fit. Here the 6 placed spectra fall on three peptides, one
per protein: `DGYADGWAQAGTAR` (rplF, 2 spectra), `IIVDTYGGMAR` (metK, 2) and
`LYTSLGDAAVGR` (prsA, 2). When one flank does not fit, `delta_mass` is the mass difference on
that side, `region` the residues it lies in, and `delta_interp` a candidate explanation
(`mod:...`, `sub:...` or `?`). Large differences such as -1660.9 Da mean only that the tag sits
in another, overlapping peptide; a small difference that recurs over many spectra (summarised by
`-delta_out`) points at a modification. None of this is FDR-controlled: it is a reason to look
closer, not an identification. All columns: README, Output, Report schemas.

In the census, `status` and `best_evalue` per spectrum show at a glance how much of a run
FASTag could read and how much of it your proteins explain.

### Next steps

- High-resolution data: keep the 20 ppm default (`-fragment_tolerance 20`).
- A proteome-sized database needs longer tags: `-extension 3` (README, Usage), as in Part 2.
- `-species` names the organisms in a run (needs the taxonomy index; README, Species detection).
- `-shortlist_out` and `-fasta_out` reduce a database for a search engine (README, Protein
  shortlist and search hand-off).

## Part 2: PXD000001

PXD000001 is the ProteomeXchange demonstration data set: *Erwinia carotovora* (now
*Pectobacterium*), TMT6-labelled, LTQ Orbitrap Velos with HCD (high-resolution MS2). It
includes the authors' Mascot search, which serves as the reference: 2,254 peptide-spectrum
matches at 1 % FDR (the scorer in `tools/pxd000001_truth.py`).

### Download

From the PRIDE archive, `https://ftp.pride.ebi.ac.uk/pride/data/archive/2012/03/PXD000001/`:

| File | Size (bytes) | sha256 |
|---|---|---|
| `TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML` | 450,032,788 | `038dd84702b01463b1aadfae09cecc4176f319376ff85e9dba883cdc3208fa67` |
| `erwinia_carotovora.fasta` | 1,657,668 | `1fdce9b5150c024533657453c79e3a9e10bce84068a1467545ca6417da61d16b` |
| `F063721.dat` (Mascot search, only for scoring) | 21,185,462 | `286c1677e40f0084469603b7fc0b2b13d7653373047f8982cb6d806de476bab6` |

```bash
B=https://ftp.pride.ebi.ac.uk/pride/data/archive/2012/03/PXD000001
for f in TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML \
         erwinia_carotovora.fasta F063721.dat; do curl -fLO "$B/$f"; done
shasum -a 256 TMT_Erwinia_* erwinia_carotovora.fasta F063721.dat    # Linux: sha256sum
mv TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML PXD000001.mzML
```

PRIDE publishes no checksums for these files; the sha256 values above are of the copies used
for FASTag's benchmarks, whose sizes match the archive.

### Tag the run with its chemistry

The search used fixed TMT6plex on lysine and the peptide N-terminus and methylthio on
cysteine; give FASTag the same, instead of its default carbamidomethyl. The MS2 is
high-resolution, so the 20 ppm default applies.

```bash
FASTag -in PXD000001.mzML -out pxd1.tsv \
       -fixed_modifications "Methylthio (C)" "TMT6plex (K)" "TMT6plex (N-term)"
```

```
Modification 'TMT6plex (N-term)' is terminal; it is absorbed into the reported flanking masses and not annotated per-residue.
Modifications: Methylthio (C, fixed), TMT6plex (K, fixed)
Acquisition check: DDA (...)
6103 MS2 spectra, 215527 tags
```

Expected: 6,103 MS2 spectra (of 7,534 spectra in the file), 215,527 tags from 5,590 spectra.
On a 224-core Linux node with `-threads 8` and the file in the page cache this took 0.4 s and
84 MB.

### Check the tags against the published search

At DirecTag's published settings (tag length 3, 100 peaks, 50 tags, no gaps, no
deisotoping, 0.02 Da, no modifications), FASTag's tags can be scored against the Mascot
identifications:

```bash
FASTag -in PXD000001.mzML -out matched.tsv -tag_length 3 -max_tags 50 -max_peaks 100 \
       -peaks_per_window 0 -gaps 0 -no_deisotope \
       -fragment_tolerance 0.02 -fragment_tolerance_unit Da -fixed_modifications ""
python3 tools/pxd000001_truth.py --dat F063721.dat --tsv matched.tsv --no-assert
```

Expected: 181,963 tags, and from the scorer:

```
FDR<=1%: score >= 16.85  ->  2254 accepted target PSMs
rank-1:  2049  (90.91%)
top-5 :  2207  (97.91%)
total :  2223  (98.62%)
```

A tag counts as correct when its sequence occurs in the identified peptide and one flanking
mass agrees within 0.05 Da. So the best-ranked tag is correct for 90.91 % of the identified
spectra, and 98.62 % have a correct tag among their 50. DirecTag 1.4.21142 reaches 88.69 % and
98.62 % on the same run (README, Validation; doc/BENCHMARK-DirecTag.md). The scorer is in the
source tree, not in the release downloads.

### Filter by the proteome and place the tags

```bash
FASTag -in PXD000001.mzML -out pxd1.hits.tsv \
       -fixed_modifications "Methylthio (C)" "TMT6plex (K)" "TMT6plex (N-term)" \
       -fasta erwinia_carotovora.fasta -extension 3 \
       -recon_out pxd1.recon.tsv -shortlist_out pxd1.shortlist.tsv -census
```

```
Recon index: 4499 proteins, 1455924 residues, 11 isobaric rules; min tag length 7 (derived)
Census: 6103 MS2 spectra read, 2747 with a reported tag (2221 placed), 512 no_tags -> ...
Shortlist protease check: Trypsin fits the tag ends best.
Shortlist: 189 of 331 proteins with evidence kept, not FDR-controlled -> pxd1.shortlist.tsv
6103 MS2 spectra, 222468 tags -> 15938 after filtering
  len         tags      matched    by chance enrichment
    ...
    7        30495         7214          593      12.2x
    8        17788         4179           24     176.0x
    9        18003         4545            2    2779.0x
```

Expected: against 4,499 proteins only tags of 7 residues or more are matched; 15,938 tag rows
from 2,747 spectra pass, 2,221 spectra are placed on a peptide (`pxd1.recon.tsv`, 24,722
placements), and the shortlist keeps 189 of the 331 proteins with tag evidence (at least 2
spectra each). The run took 1.8 s and 213 MB on the same node. The shortlist is a search-space
reduction, not protein identification (README, Protein shortlist and search hand-off).

## Desktop app

The same Part 1 run in the desktop app, with screenshots: [MANUAL.md](MANUAL.md). In the app,
**File > Open Example Data** selects `Ecoli_MS2_small.mzML`; choose the **Ion trap CID 0.3 Da**
preset and run.
