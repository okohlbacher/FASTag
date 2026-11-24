Output of the development CLI after 1.15.7 (worktree consol-wizard, built
on 2026-11-24 from commit 79af58cb plus the uncommitted Unreleased changes
of CHANGELOG.md), for the formats that release adds: the -fasta_proteins
columns of the tags table, qc_version 3 (the isobaric kit call and the
reporter channel counts) and census_version 2 (max_len, res_cover and the
run row max_tags). The released fixtures (cli-1.12, cli-1.15) stay as they
are: they are what older runs in a user's history read like.

Never hand-edited. To re-record, build the CLI and run, with FASTag the
built binary:

ecoli-fasta-proteins/: examples/Ecoli_MS2_small.mzML copied as run01.mzML,
examples/Ecoli_MS2_small.fasta as ecoli.fasta:

  FASTag -in run01.mzML -out run01.tags.tsv -threads 0 -fragment_tolerance 0.3 \
    -fragment_tolerance_unit Da -fasta ecoli.fasta -fasta_proteins 3 -extension 3

ecoli-dimethyl-k/ (same input, Dimethyl (K) fixed besides Carbamidomethyl
(C): K is then 156.126 Da, within 0.04 Da of G + V, so the CLI's isobaric
rules read K for GV and VG instead of GA and AG; the log says 13 isobaric
rules):

  FASTag -in run01.mzML -out run01.tags.tsv -threads 0 -fragment_tolerance 0.3 \
    -fragment_tolerance_unit Da -fasta ecoli.fasta -fasta_proteins 3 -extension 3 \
    -min_filter_length 3 -fixed_modifications "Carbamidomethyl (C)" "Dimethyl (K)"

ecoli-run-qc/ (same input):

  FASTag -in run01.mzML -out run01.tags.tsv -threads 0 -fragment_tolerance 0.3 \
    -fragment_tolerance_unit Da -qc_out run01.qc.tsv

ecoli-triage/ (same input; kept are the ranking run01.census_sorted.tsv
and the run summary run01.tags.census_summary.tsv; the per-spectrum census
table run01.tags.census.tsv is left out, the ranking holds the same rows):

  FASTag -in run01.mzML -out run01.tags.tsv -threads 0 -fragment_tolerance 0.3 \
    -fragment_tolerance_unit Da -census -census_score -census_sorted_out run01.census_sorted.tsv

pxd000001-census-lengths/ (census_version 3, res_cover_exact; the
ecoli-triage census above is format 2): PXD000001's mzML below, 60 of its
7534 input spectra, two seed lengths:

  FASTag -in TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML \
    -out run.tags.tsv -threads 8 -tag_lengths 3 4 -max_tags 7 -subsample_spectra 60 \
    -subsample_seed 1 -census -census_out run.census.tsv -census_summary_out run.census_summary.tsv

Its summary has run/tag_length 3,4 and run/max_tags 7 (the cap 14), and
n_found reaches 14; no -fasta, so res_cover_exact is 0.

pxd000001-qc/: the public PRIDE data set PXD000001 (TMT 6-plex labelled
Erwinia carotovora, original reagent with 127C/129C; LTQ Orbitrap Velos
HCD), its mzML
TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML:

  FASTag -in TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML \
    -out qc.tags.tsv -threads 8 -qc_out run.qc.tsv

The kit call there is tmt6plex, decided by the TMT label mass (229.162932 Da
on 2251 tag ends): the run shows the original TMT 6-plex channels 126, 127C,
128C, 129C, 130C and 131 (written 131N), as in MSnbase TMT6; 127N and 128N
are seen in one MS2 each, 129N, 130N and 131C in none.
