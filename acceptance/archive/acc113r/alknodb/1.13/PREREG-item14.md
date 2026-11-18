# PREREG item 14: backlog 14 (hdrcharge), header-charge check against a Sage charge truth

This file was committed before any FASTag or Sage run on a file of `manifests/item14-hdrcharge.tsv`. The only
runs so far are on the DEV runs (`hdrcharge/dev/`). Files of this item:

- `hdrcharge/` (scripts, DEV results, `SHA256SUMS`);
- `manifests/item14-hdrcharge.tsv`;
- `disjointness/item14-hdrcharge.tsv`;
- the `CFG-14-warn` row of `frozen-configs.tsv`;
- the `HO-14-*` and `DEV-14-*` rows of `validation-registry.tsv`.

## What is evaluated

`-check_header_charge` of `feat/b113-hdrcharge` at c1a6607 (FASTag 1.12.1 base, origin/main 702b45c). It was built
on node data (OpenMS 70cebcd144, env fastag-omsdev) and copied to `data:/scratch/kohlbach/b113/hdrcharge/frozen/FASTag`
(sha256 `d88dc29b393533008f1059d35e8417f5dba19807f0cb0aeb042822bb0c411660`).

Frozen config `CFG-14-warn`, with param_hash = sha256 of the options string:

    -check_header_charge warn -check_header_margin 6 -check_header_out hc.tsv -threads 16

The rule of the build:

- range evidence counts only with at least 3 of the 150 strongest peaks above the header's fragment ceiling;
- the margin is 6 (complement-pair excess over the header's);
- the candidates are `-charge_min` 2 .. `-charge_max` 4 plus the header.

Every other option is at its default. `warn` tags at the header charge; `override` tags a `disagree` spectrum at the
call. The verdicts of the two modes are identical (same `checkHeaderCharge`, same table), so the override effect on
charges is scored from the warn table: a disagreeing spectrum's charge becomes the call.

`hdrcharge/scripts/run_heldout.sh` runs it. The script refuses:

- another binary;
- a config that is not `frozen`;
- a script whose sha256 differs from `hdrcharge/SHA256SUMS`;
- an input whose sha256 differs from the manifest;
- an existing `score/`.

## Data and split

`manifests/item14-hdrcharge.tsv` was built by `hdrcharge/scripts/select_heldout.py`; the rule is in its header. It
holds 5 high-resolution DDA runs, all public PRIDE data (no AGXT/Sxx). They are already staged and hashed under
`data:/scratch/kohlbach/fastag-heldout-1.12`.

- **qe (3):** drawn with `random.Random('fastag-1.13:hdrcharge:heldout:qe').sample(3)` from the 6 Q Exactive-family,
  tryptic, label-free, CAM, panel-organism rows of the 1.12 #3 held-out manifest. Those rows were scored for the
  chemistry call only; their charges were never looked at. The draw:
  - PXD001769 (Q Exactive Plus, human);
  - PXD003850 (Q Exactive, mouse);
  - PXD009815 (Q Exactive Plus, yeast).
- **astral (2):** the Astral rows of the 1.12 #2 `item02-H1-r2` manifest that no charge item (#6) used: PXD070049
  (E. coli) and PXD074582 (bovine).

DEV is PXD003531 (Q Exactive) and PXD001819 (LTQ), the #6 DEV runs. The held-out runs are disjoint from DEV by PXD
and by file sha256 (`disjointness/item14-hdrcharge.tsv`). Low-resolution runs are left out, as for #6 in round 4.

## Truth

Sage 0.14.7 (`/ceph/ibmi/abi/oliver/opt/sage-0.14.7`) searches the charge-stripped copy (`strip_charge.py`, the #6
derivation: every `MS:1000041` line dropped). Sage never sees the header charge. The search:

- precursor_charge [1, 4], isotope_errors [-1, 3];
- trypsin KR/P, 2 missed cleavages, length 7-50, b/y, min ion index 2;
- C+57.021464 fixed (PXD074582: variable, as in its #2 truth row), M+15.994915 variable, max 2;
- 10 ppm precursor, 20 ppm fragment, deisotope on, 15-150 peaks;
- the panel FASTA of the run's organism (`/ceph/ibmi/abi/oliver/prose-auto-20261029/panel`, sha256 in the
  manifest's source tables), with Sage's own `rev_` decoys.

Truth spectra are target, rank 1, `spectrum_q` <= 0.01 PSMs. The Sage charge labels the spectrum. The run script
writes the configuration, the same style as the DEV truth (`hdrcharge/dev/sage_*.json`).

## Denominator

A truth spectrum counts when it is in the `-check_header_out` table and carries a header charge in 1..4 (Sage's
charge range). A header is `right` when it equals the Sage charge, else `wrong`. `flagged` means verdict
`disagree`.

## Arms

- **as given:** the staged mzML; real header charges.
- **perturbed:** `perturb_charge.py` changes the charge of every scan with scan % 5 == 0 (2 becomes 3, z >= 3
  becomes z - 1). The truth is the original header, wherever Sage confirms it. Perturbed spectra whose original
  header Sage does not confirm are left out.

## Endpoints and criteria

All endpoints are pooled over the 5 runs and computed by `score_hdrcharge.py` and `verdict_hdrcharge.py`.

| | Endpoint | Criterion | DEV (in-sample) |
|---|---|---|---|
| E1 | as given: false-alarm rate = flagged right headers / right headers | <= 0.005, and its Wilson 95 % upper bound <= 0.005 | 0.0004 (hi 0.0010) |
| E2 | as given: override net = (wrong headers whose call is the Sage charge - flagged right headers) per 1000 truth spectra | bootstrap (2000 draws over spectra, seed 1) 2.5 % bound >= -1.0 | +0.40 (-0.30 .. 1.09) |
| E3 | perturbed: precision = flagged wrong / flagged; sensitivity = flagged wrong / wrong | precision >= 0.90 and sensitivity >= 0.10 | 0.991, 0.158 |
| E4 | validity | every run FASTAG_RC 0 (both arms), SAGE_RC 0, and >= 500 truth spectra in each arm | met |

The verdict is PASS when E1, E2 and E3 pass and E4 holds. It is FAIL when E4 holds and any of E1-E3 fails, and
INCONCLUSIVE when E4 does not hold. These are also reported, but not gated:

- sensitivity and precision as given;
- `call_precision`;
- per run and per stratum.

What PASS means: on real headers the check rarely flags a right one, overriding costs at most 1 correct charge per
1000 identified spectra (non-inferiority), and a systematically wrong header charge is found with high precision.
It does not mean the option becomes a default. The option stays experimental whatever the result; the user decides.

## Scorer

| File | sha256 |
|---|---|
| `hdrcharge/scripts/score_hdrcharge.py` | `SHA256SUMS` |
| `hdrcharge/scripts/verdict_hdrcharge.py` | `SHA256SUMS` |
| `strip_charge.py`, `perturb_charge.py`, `run_heldout.sh`, `select_heldout.py` | `SHA256SUMS` |

`SHA256SUMS` sha256 is in registry row `HO-14-heldout-PREREG`. Interpreter: Python 3 of
`/ceph/ibmi/abi/oliver/jpr-bench/envs/py` (standard library only), run with `-I`.

Command:

    bash acceptance/1.13/hdrcharge/scripts/run_heldout.sh acceptance/1.13 /scratch/kohlbach/b113/hdrcharge/heldout

Scored exactly once. Nothing is tuned on these runs, and no criterion is relaxed. A FAIL is a valid result.

## DEV, and what was chosen on it

DEV truth is the same Sage style on the stripped DEV copies; the DEV runs used the DEV tolerances (PXD001819: 5 ppm,
0.8 Da, no deisotoping). The DEV evidence is in `hdrcharge/dev/`:

- `dev_variants.txt`: verdicts recomputed from the check table for margins 3-8 and range peak minimums 1-999;
- `dev_asgiven.tsv` and `dev_perturbed.tsv`: the frozen binary;
- `dev_verdict.json`.

The first rule (margin 2, one peak above the ceiling enough) flagged 2.7 % of the right headers on PXD003531. Three
in four of its disagreements were false, and the override net was -18.8 per 1000. Both values were chosen on DEV:

- margin 6 maximises the as-given override net on PXD003531 among margins 3, 4, 5, 6 and 8, for every range
  minimum of 2 or more (k = 3: -5.65, -0.74, 0.15, 0.60, 0.15 per 1000). PXD001819 flags nothing from margin 5 on;
- a range minimum of 3 rather than 2 roughly halves the false-alarm rate on PXD003531 (0.0006 vs 0.0011), at a
  lower sensitivity on the perturbed LTQ copy.
