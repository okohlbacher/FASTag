# e2e fixtures

`ecoli.tags.tsv`: the tags FASTag 1.11.0 (OpenMS 3.7.0-pre-HEAD-2026-11-02)
writes for the repository's public test fixture
`test/fixtures/Ecoli_MS2_small.mzML` with default parameters:

    FASTag -in test/fixtures/Ecoli_MS2_small.mzML -out ecoli.tags.tsv -threads 1

2,028 tags from 139 MS2 spectra; sha256
`479a03605721ca9e0a4da10301edcb09f2982f43bdbf09193b05f7ba016fa3f7`. The mzML is
OpenMS's own example (BSD-3-Clause, see `test/fixtures/README.md`). Only the
Playwright e2e build reads it (`src/testing/e2eBridge.ts`); a release build
must not contain it (`scripts/check-dist-clean.mjs`).

The `denovo` scenario serves `src/fixtures/denovo/ecoli.res_conf.tags.tsv`
instead: the same mzML with `-res_conf -usi_collection` (see the README
there), whose Stitch/ALPS reads `specs/p3b.spec.ts` compares with the golden
files `tools/tags_to_denovo.py` writes. Its first spectrum ID is the same,
so the release-dist check above covers it as well.
