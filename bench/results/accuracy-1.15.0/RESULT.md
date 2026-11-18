# accuracy-1.15.0: tag accuracy of FASTag 1.15.0 at its defaults and at DirecTag's settings

Measured on 2026-11-18 on ibminode05 with the release `FASTag-1.15.0-linux-x64.tar.gz` (sha256 `804d5168…872c`,
matches the GitHub release digest), 32 threads. Script: `run.sh`; table: `summarize.py` → `summary.tsv`.

## Settings

| setting | FASTag arguments |
|---|---|
| matched | `-tag_length 3 -max_tags 50 -max_peaks 100 -peaks_per_window 0 -gaps 0 -no_deisotope -fragment_tolerance 0.02 -fragment_tolerance_unit Da` (DirecTag's published settings) |
| default | none: tag length 3, one gap (`-gap_penalty 100`), deisotoping, 50 tags, 400 peaks with 10 per 100 Da, 20 ppm, fixed `Carbamidomethyl (C)` |
| default_samplemods | defaults with the sample's fixed modifications (PXD000001: `Methylthio (C)`, `TMT6plex (K)`, `TMT6plex (N-term)`) |

On PXD000001 the matched run also sets `-fixed_modifications ""` (as in site-why-1.14.0), and its tag file is
byte-identical to the 1.14.0 one. On PXD054073 and PXD076528 both settings keep FASTag's default fixed
`Carbamidomethyl (C)`, which matches the samples; the default runs have no arguments besides `-threads`.

## Truth and scoring

- **PXD000001** (LTQ Orbitrap Velos HCD, TMT6): the deposited Mascot search `F063721.dat`, 2,254 PSMs at 1% FDR,
  scored with `tools/pxd000001_truth.py` (one flank checked per orientation; variable modifications not decoded;
  tags ranked by `evalue`).
- **PXD054073** (timsTOF Pro ddaPASEF, HeLa; AlphaTims MGF → OpenMS FileConverter mzML, 130,611 spectra) and
  **PXD076528** (Orbitrap Astral DDA, human): Sage 0.14.7 (release binary), target PSMs at 1% spectrum-level FDR,
  human UniProt UP000005640; settings in `truth/<data set>/sage.json`. The Sage runs are those of the FASTag 1.9.0
  accuracy run (2026-11-03), copied, not re-run (`sage-truth.sha256`). Scored with the fastag-bench `accuracy`
  harness (`bench/fastag-bench`, config `accuracy-ibminode05-v1150.yaml`), rule `flank`: the tag or its reverse
  occurs in the peptide (I = L) and either flanking mass agrees within 0.05 Da, with all modifications of the PSM
  decoded.
- rank-1 / top 5 / top 50: share of truth spectra with at least one tag whose first / first five / all tags
  include a valid one. Any valid tag: share of all truth spectra (tagged or not) with a valid tag.

Inputs and sha256: `pxd000001/inputs.sha256`, `inputs-sage.sha256`. Tag files are not committed; their sha256 and
row counts are in `pxd000001/*/tags.sha256_rows` and `harness/tags.sha256_rows.tsv`.

## Results

| data set | truth | setting | truth spectra | tagged | rank-1 % | top 5 % | top 50 % | any valid tag % |
|---|---|---|---|---|---|---|---|---|
| PXD000001 | Mascot | matched | 2,254 | 2,254 | 90.91 | 97.91 | 98.62 | 98.62 |
| PXD000001 | Mascot | default | 2,254 | 2,254 | **93.12** | 97.96 | 98.71 | **98.71** |
| PXD000001 | Mascot | default_samplemods | 2,254 | 2,254 | 93.35 | 97.96 | 98.71 | 98.71 |
| PXD054073 timsTOF | Sage | matched | 72,067 | 71,278 | 64.70 | 80.68 | 85.89 | 84.95 |
| PXD054073 timsTOF | Sage | default | 72,067 | 72,034 | **67.34** | 83.07 | 90.13 | **90.09** |
| PXD076528 Astral | Sage | matched | 44,015 | 43,623 | 47.97 | 60.87 | 67.09 | 66.50 |
| PXD076528 Astral | Sage | default | 44,015 | 44,003 | **53.84** | 67.39 | 79.65 | **79.63** |

At the defaults gapped tags take 3 of 2,254 rank-1 slots on PXD000001 (0.13%; `pxd000001/default/score.txt`).

`summary.tsv` also lists PXD000001 scored by the harness against Mascot and against Sage 0.14.7 (2,642 PSMs);
there both settings carry the sample's fixed modifications (`harness/tag_accuracy_runs_v1150.tsv`). The harness
rule is more lenient than `tools/pxd000001_truth.py` (either flank, modifications decoded), so its Mascot numbers
are 1.4 to 1.5 points higher at rank-1 and 1.1 points higher at top 50. Under both scorers and both truths the
defaults rank a valid tag first more often than the matched settings.
