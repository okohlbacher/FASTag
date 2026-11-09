# PREREG-item07, amendment 1 (acceptance/1.13): #7 raw-DIA refusal, release test E7-03 (CFG-07)

Status 2026-11-09: **CFG-07 `frozen`; not run, not scored.** This amends `acceptance/1.12/PREREG-item07.md`
in the way that file names itself: "if the missing files are converted and added, the manifest changes and this file
is amended before any run". It is committed and pushed before any FASTag run on any E7-03 file. CFG-07 has never
been run on E7-03, never been scored, and is scored exactly once. On failure the rule is not re-tuned on this set.
Everything the 1.12 protocol fixes and this amendment does not name stays as written there.

## What changes: 27 of the 28 missing files are staged

In 1.12, 28 drawn files had no conversion on Linux. They are converted now on the Windows workstation flash with
ProteoWizard msconvert 3.0.22187 (a58d608; the OpenMS 3.5.0 THIRDPARTY build with the SCIEX, Agilent, Bruker BAF and
Waters readers). The raw inputs are the staged copies on node data. The 44 SCIEX .wiff/.wiff.scan files were
re-hashed on flash and match the manifest sha256 (44/44). The zipped .d and .raw directories were unpacked on data from
the staged, hash-checked archives. One fixed command (`scripts/conv.ps1`):

    msconvert <raw> --mzML --zlib --filter "peakPicking vendor msLevel=1-" --outfile <stem>.mzML

with one fallback retry using `peakPicking cwt`. One more retry was added after the first pass and before any run.
For files that fail with pwiz's "unknown instrument type", the vendor command is run again with
`--ignoreUnknownInstrumentError` (`scripts/conv_zeno.ps1`). This applied to one file, E7-03.DIA_swath.11
(ZenoTOF 7600, a model pwiz 3.0.22187 does not list). The output name is the stem of the raw file. For an archive
it is the stem of the inner directory. E7-03.DDA_qtof.10's directory is `20190423_Alex7.d - Copy`, renamed to
`20190423_Alex7.d` before conversion. Per-file results: `inputs/staged/e703_win_conv.tsv`.

| Stratum | 1.12 staged | Converted now | Still NOT_STAGED |
|---|---|---|---|
| DIA_swath (DIA) | 1 (DIA_swath.04, timsTOF .d) | 11 SCIEX .wiff (TripleTOF 5600/6600/6600+, ZenoTOF 7600) | 0 |
| DDA_qtof (nonDIA) | 1 | 15 (10 SCIEX .wiff, 3 Agilent .d, 1 Bruker maXis .baf, 1 Waters Synapt .raw) | 0 |
| DDA_qexactive (nonDIA) | 25 | 1 (DDA_qexactive.03, a SCIEX .wiff in a project listed as Q Exactive) | 0 |
| DDA_ddapasef (nonDIA) | 19 | 0 | 1: DDA_ddapasef.08 (Bruker solarix .d; the deposited archive holds analysis.baf only, msconvert: `analysis.baf_xtr` not found) |

The new manifest is `acceptance/1.13/manifests/item07-E7-03.tsv` (sha256 in the registry row HO-07-E7-03-a1). It is
the 1.12 manifest with only the conversion columns of those 28 rows filled in (conv_rc, fastag_input,
fastag_input_bytes, fastag_input_sha256, conversion_note; `scripts/e703_amend_manifest.py`). The drawn sample (214
files, 214 PXDs), the strata, the `class` column (the truth labels), the raw files and their sha256, and all 186 rows
staged in 1.12 are unchanged. Disjointness from DEV (acceptance/1.12/disjointness/item07-E7-03.tsv) is a property of the
drawn files and is unchanged.

**Pseudo-DDA:** no pseudo-DDA file is made for the new SWATH conversions. The pseudo-DDA units stay the 37 of 1.12
(DIAspeXtract 1.7.0 for Thermo DIA, diaTracer 2.2.1 for timsTOF). The plan's release test does not require
pseudo-DDA of every DIA file, and the 1.12 pipeline has no SCIEX route.

**Design check, as staged (before any run):** must-pass units 149 + 16 + 37 = 202 (conversions plus pseudo-DDA)
(>= 150); DIA conversions 37 + 11 = 48 (>= 40); every DIA stratum has 12 staged files (>= 5, so all four gate). If
every run completes, the design is met, and the scorer prints no `SAMPLE_SHORTFALL` prefix.

## Frozen software and config (unchanged)

| What | Value |
|---|---|
| RC | a117801; FASTag.bin `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`; bundle SHA256SUMS `93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051` (data:/scratch/kohlbach/fastag-heldout-1.12/rc-a117801) |
| CFG-07 | `RC defaults (-acquisition_check refuse, probe 4000; thresholds frozen at 62abb64, E7-09)`, param_hash `07d12e1e8f712977793055988c1127914972a3e9c5a478d6b29fb42276d9f550`, status now `frozen` |
| Scorer | `acceptance/1.12/scorers/score_item07.py` `b135aa9b5b9db5af7507ab81b5abd3f770c30590af7542789e3ad7ac6b0b750e` (unchanged); `acceptance/1.12/scorers/acclib.py` now `fe387a3455a52678f78c20c3156b63c251e08daa5b92da2f3e205d1d9ab2b1c1` (see below) |

`src/` is identical between a117801 and origin/main (1.12.1, 702b45c). The changes since are GUI, docs and the
version only. So the result also holds for the acquisition check that main ships.

acclib.py changed after the 1.12 PREREG (d2342eb4 -> fe387a34, rounds 3 and 4 for #2/#6). The diff adds `arm_dir`,
`native_key`, `use_native_keys` and a floor argument to `holm_ni`. It leaves `read_tsv`, `run_rel`, `run_rc`,
`cp_upper`, `write_rows` and `provenance` unchanged, and those are the only functions score_item07.py uses.
The committed fe387a34 is the one used.

## Runs (node data)

`results/item07/jobs/run_item07.sh acceptance/1.13/manifests/item07-E7-03.tsv /scratch/kohlbach/b113/e703/runs 4 8`.
It makes one run per unit (every staged `fastag_input`, and the `pseudo_input` of every DIA row that has one):
`FASTag -in <unit> -out tags.tsv -threads 8`, RC binary through its wrapper, no option added, at most 4 runs at
once. Before each run it checks the input sha256 against the manifest. A mismatch is not run and is recorded as
FASTAG_RC=99, which makes it RUN_FAILED. `FASTAG_RC=<rc>` is appended to run.log. A run directory that already
holds a run.log is never re-run.

## Truth, outcomes, denominators, acceptance (unchanged)

As in the 1.12 PREREG: the label is the drawn stratum's class, with no relabelling. nonDIA units and all pseudo-DDA
units must pass. DIA conversions must be refused. A run is `refused` when it has FASTAG_RC 11 and
`FASTAG_REFUSED reason=raw_dia`. It is `passed` when it has FASTAG_RC 0. Anything else is RUN_FAILED. A NOT_STAGED
file is never counted.

- (a) 0 refusals among the must-pass units, with the one-sided exact 95% upper bound reported;
- (b) >= 90% refused in each DIA stratum with >= 5 scored files;
- any RUN_FAILED makes the verdict INCONCLUSIVE.

## Scoring command (once; without -I, per the round-4 erratum)

    python3 acceptance/1.12/scorers/score_item07.py acceptance/1.13/results/item07 \
        --acc acceptance/1.13 --runs /scratch/kohlbach/b113/e703/runs

Output: `acceptance/1.13/results/item07/result.json` and `units.tsv`, plus one registry result row.

## Reuse check (acceptance/1.13 README rule of 2026-11-09)

The 214 drawn files were checked against every manifest in acceptance/1.12 and acceptance/1.13, matching on PXD,
raw file name and sha256. No raw file and no sha256 is shared. One project is shared at PXD level only:
PXD009815. E7-03.DDA_qexactive.09 is QEKAC160601_69.raw. item03-heldout (1.12), item08-heldout and
item14-hdrcharge (1.13) use QEKAC160601_38.raw, a different run. Those items do not touch the #7 rule. Its thresholds
were frozen at 62abb64 on the E7-02 sweep, and E7-03 is disjoint from it (acceptance/1.12/disjointness/item07-E7-03.tsv).
So the reuse is declared, and the file stays in.
