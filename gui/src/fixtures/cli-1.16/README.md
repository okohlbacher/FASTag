Output of the released FASTag 1.16.2 CLI (Homebrew build, macOS arm64,
OpenMS 3.7.0-pre-HEAD-2026-11-02), recorded on 2026-11-26. Never
hand-edited.

pxd000001-survey/: a Mass-shift survey (the Setup workflow's -recon_out,
-delta_out and -extension 3, no fixed modification but the CLI's
Carbamidomethyl (C)) of the public PRIDE data set PXD000001 (TMT 6-plex
labelled Erwinia carotovora, LTQ Orbitrap Velos HCD), its mzML and the
FASTA of the submission:

  FASTag -in TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML \
    -out run.tags.tsv -threads 0 -extension 3 -recon_fasta erwinia_carotovora.fasta \
    -recon_out run.recon.tsv -delta_out run.delta.tsv > run.stdout 2> run.stderr

Kept: run.delta.tsv (222 rows, 847 spectra; 27 rows with localized
spectra, 151 localized and 449 unlocalized in all), run.stdout and
run.stderr; the tags and placements are left out. Every localized site is
terminal-ambiguous (N-term|K, C-term|K, Protein N-term|M, Protein
C-term|K): the TMT label (+229.16 Da, not given as a fixed modification)
sits on the peptide N-terminus or the K side chain. The residues column
holds ties of equal count (229.1620: N-term|A:3, N-term|I:3, N-term|T:3,
by name), and its counts sum to localized on every row.
