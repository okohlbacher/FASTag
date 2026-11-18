# PREREG item 23: backlog 23 (digqual), digestion quality vs Sage (descriptive)

Committed before any `-digest_quality` run on an `eval` file of `manifests/item23-digqual.tsv`. The only
run so far is the DEV run (`item23/dev/`), on the one `dev` row, which is a gate input. Files of this item:
`item23/` (scripts, scorer, DEV result, `SHA256SUMS`), `manifests/item23-digqual.tsv`, the `CFG-23-digqual`
row of `frozen-configs.tsv` and the `HO-23-*` rows of `validation-registry.tsv`.

## What is evaluated

`-digest_quality Trypsin` of `feat/b113-digqual` at 2fd1297 (FASTag 1.12.1 base, origin/main 702b45c),
built on node data (OpenMS 70cebcd144, env fastag-omsdev). Frozen config `CFG-23-digqual`
(`frozen-configs.tsv`, param_hash `0518cecc...77b0` = sha256 of the options string): binary sha256 `852fec5dbefc5361e6fb17de499818e0ad6ca7733fe5626c70fb196c43f50f78`
(copied to `data:/scratch/kohlbach/b113/digqual/eval/frozen/FASTag`), shipped `digest_models.tsv`
sha256 `b486bbb2...7c36` (background: shipped human composition), options

    -tag_length 4 -threads 8 -subsample_fraction 0.25 -fragment_tolerance 20.0 -fragment_tolerance_unit ppm
    -digest_out digest.tsv -digest_quality Trypsin

(the termini pass of the 1.9.0 digest validation, plus the new option), run by `item23/scripts/run_eval.sh`
(sha256 `8e8f9e27...0f`), which refuses another binary and checks each mzML's sha256.

## Data and split

`manifests/item23-digqual.tsv` (sha256 `52aab216fe63bcef9b6fc26da491f5e132f2aacf5b52e544ba4ccf84301e96be`), built by
`item23/scripts/build_manifest.py` (rule in its header): the 48 runs of
`/ceph/ibmi/abi/oliver/jpr-bench/species/runs_v190` with a Sage search. All public PRIDE data; no
AGXT/Sxx. Split: `dev` 1 (PXD003531_QE_NO_03, the gate's dda_default input), `eval` 35 (FTMS MS2),
`excluded_itms` 11 (ion-trap MS2: Da tolerance, the 0.008 Da tag-end windows do not hold). The DEV
run is disjoint from `eval` by run and file (sha256 in the manifest).

## Truth (reference)

The run's existing Sage 0.14.7 search (`sage/results.sage.tsv` and `sage.json`, sha256 per row in the
manifest): trypsin KR/P, up to 2 missed cleavages, length 7-50, C+57.021465 fixed, M+15.994915
variable, 10 ppm precursor, 20 ppm fragment, ref50 multi-species FASTA, Sage's own decoys. Used as
is; nothing is re-searched. PSMs: `label == 1` and `spectrum_q <= 0.01`.

Sage retention per run: of those PSMs, the ones whose peptide (mods stripped, I as L) ends in K or R;
their P2..P4 residues; sites = K or R (no proline rule, as in FASTag);
`(sites / (positions - sites)) / (b / (1 - b))` with b = FASTag's `quality C.mc_background_share`
of that run (the same background on both sides). Sage MC share = share of the PSMs with
`missed_cleavages >= 1`. Known bias, stated now: Sage caps missed cleavages at 2, FASTag does not.

## Endpoints (descriptive; no margin, no pass/fail)

Over the `eval` runs whose `quality status` is `measured` with a finite `C.mc_retention` and a
finite Sage retention (the denominator; the others are listed as `runs_not_scored`):

- E1: Spearman (and Pearson) correlation of FASTag `C.mc_retention` with the Sage retention;
- E2: Spearman correlation of FASTag `C.mc_retention` with the Sage MC share;
- E3: median of FASTag / Sage retention per run, and median |FASTag − Sage| site share;
- also reported: medians of both retentions, of the Sage MC share and of FASTag `C.nonspecific_mle`
  (no reference: Sage searched fully tryptic).

No cells, pooling, bootstrap or multiplicity correction. Scorer `item23/scorer/score_digqual.py` (sha256
`7ed431b9b88b819f60b8b98c93b5c9596779f953b0733036001c29fe81dcec7d`, Python 3.12.3 standard library),
run as `python3 -I score_digqual.py <manifest> eval <runs> <out>`; it refuses an existing
`<out>`. Scored exactly once. Nothing is tuned on `eval`; the option stays experimental whatever
the result.
