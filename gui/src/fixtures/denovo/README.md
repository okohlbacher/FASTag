# De novo golden files

The Stitch/ALPS export (`src/export/denovo.ts`) must write what the
repository's `tools/tags_to_denovo.py` writes, byte for byte. Each case of
`cases.json` names an input, the script's `--format`, `--top-n` and
`--min-length`, and the golden file the script writes for it.

- `ecoli.res_conf.tags.tsv`: FASTag 1.11.1 (OpenMS 3.7.0-pre-HEAD-2026-11-02)
  on the repository's public test fixture (OpenMS's own example, BSD-3-Clause,
  see `test/fixtures/README.md`):

      FASTag -in test/fixtures/Ecoli_MS2_small.mzML -out ecoli.res_conf.tags.tsv \
        -res_conf -usi_collection USI000000 -tag_lengths 6 8 -max_tags 10 \
        -fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 1

  2,322 tags of length 6 and 8 from 134 spectra; sha256
  `93afdd0423421301bcca64e7caa551d02f5d56b617434ae62c55cee857ff2db8`.
  The Playwright `denovo` fixture serves it too (`src/testing/e2eBridge.ts`).
- `edge.tags.tsv`: written by hand. Ties, an unparsable and infinite
  E-values (`-`, `inf`, `1e400`, `-inf`, `Infinity`, `1_0`, surrounding
  spaces), known, unknown and empty mod annotations, every kind of malformed
  row the script skips, a comma, a semicolon and a quote in a spectrum ID,
  charges `+3`, `02` and `x`, half-even ALC rounding, CRLF and lone CR line
  ends, blank lines, extra fields and columns in another order.

Check (CI, the `gui` job) and regenerate, from `gui/`:

    node scripts/denovo-golden.mjs          # compare with what the script writes now
    node scripts/denovo-golden.mjs --write  # rewrite the golden files

`.gitattributes` keeps every file here byte-exact (no line-end conversion).
