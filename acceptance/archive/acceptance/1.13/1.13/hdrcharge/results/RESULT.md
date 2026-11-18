# #14 hdrcharge held-out: scored once, INCONCLUSIVE

- Protocol: `PREREG-item14.md` (73841d1).
- Run: `run_heldout.sh` from a git archive of 73841d1 on node data, finished 2026-11-09 21:11 CET.
- Status: FASTAG_RC 0 for all 10 runs (5 inputs, 2 arms each), SAGE_RC 0 for all 5.
- Files here: `asgiven.tsv`, `perturbed.tsv`, `verdict.json`, `outputs.sha256`, `scorer.sha256`.

**Verdict: INCONCLUSIVE.** E4 is not met: two of the five runs have fewer than 500 truth spectra.

- **PXD070049** (Astral, 5 min, 250 pg): Sage found only 480 PSMs, of which 345 are targets at q <= 0.01.
- **PXD074582** (Astral, bovine): Sage found 0 targets at 1 % FDR. Its search used the `item02-H1-r2` truth row
  (C+57 as a variable modification). The cause was not investigated, and nothing is re-run or re-scored.

E1-E3 are reported below. Under the PREREG they are descriptive only, because E4 does not hold.

| | Endpoint | Criterion | Result | |
|---|---|---|---|---|
| E1 | false alarm, as given (pooled) | <= 0.005, hi95 <= 0.005 | 0.0034 (hi95 0.0041) | would pass |
| E2 | override net per 1000, as given | lo95 >= -1.0 | -2.23 (-2.95 to -1.52) | **would fail** |
| E3 | perturbed precision / sensitivity | >= 0.90 / >= 0.10 | 0.951 / 0.281 | would pass |
| E4 | validity | RC 0, >= 500 truth spectra per run and arm | RC 0; PXD070049 345, PXD074582 0 | **not met** |

## As given: the real header charges

Only the three QE runs carry the result here; the two Astral runs have too few truth spectra.

- Real headers disagree with Sage on 720 of 31,891 truth spectra (2.3 %).
- The check flags 138 spectra. 40 of them are wrong headers (precision 0.29) and 98 are right headers (false alarm
  0.0031).
- Override would fix 35 wrong headers and break 98 right ones: -1.98 per 1000 (-2.67 to -1.25).
- All three QE runs are net negative:
  - PXD001769: -1.34
  - PXD003850: -3.46
  - PXD009815: -1.15
- PXD070049 (Astral) flags 9 of its 345 truth spectra, all right headers.

On held-out data, overriding real header charges does more harm than good. On DEV (in-sample) the net was +0.40.

## Perturbed copy (every 5th scan's charge changed)

- QE: 1,763 of 6,208 changed headers found (sensitivity 0.284) at precision 0.955. The per-run precision is 0.967,
  0.912 and 0.970.
- PXD070049: 8 flagged, all false.
- Pooled: precision 0.951, sensitivity 0.281.

## Reading

`warn` detects systematic header-charge errors with high precision on QE data. Overriding real (vendor) header
charges is net harmful: about 2 more charges broken than fixed per 1000 identified spectra. `-check_header_charge`
stays experimental, and `override` is not recommended. No criterion is relaxed, and no held-out tuning follows.
