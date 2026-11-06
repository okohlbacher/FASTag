# Captured CLI output for progress.rs

Each file is what FASTag 1.11.1 (OpenMS 3.7.0-pre-HEAD-2026-11-02, macOS arm64,
the Homebrew build) wrote to stderr and stdout together (`2>&1`), run with
`-progress` on the public fixture `test/fixtures/Ecoli_MS2_small.mzML`
(139 MS2 spectra) from a folder that holds the outputs:

| File | Command after `FASTag -in Ecoli_MS2_small.mzML -progress` |
|---|---|
| ecoli-plain.txt | `-out e.tags.tsv` |
| ecoli-filter-reports.txt | `-out f.tags.tsv -fasta Ecoli_MS2_small.fasta -digest_out f.digest.tsv -label_out f.label.tsv -species -tag_length 7` |
| ecoli-recon-glyco-spectra.txt | `-out g.tags.tsv -glyco -recon_out g.recon.tsv -recon_fasta Ecoli_MS2_small.fasta -massgap_out g.massgap.tsv -out_spectra g.spectra.mzML` |
| missing-input.txt | the whole command is `FASTag -in /nonexistent.mzML -out x.tsv -progress` (exit code 1) |

progress.rs maps these lines to phase labels; its tests pin the phase sequence
of each file. Recapture them when the CLI's messages change.
