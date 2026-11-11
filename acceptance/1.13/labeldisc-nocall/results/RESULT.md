## Held-out test (scored once): FAIL

Protocol `acceptance/1.13/PREREG-labeldisc-nocall.md` on branch `acc113r/labeldisc-nocall`: freeze 2da0b5f, audited manifest a6ce3a2 (before any FASTag run), results 16152a5. Candidate a709e62 against the baseline binary, 70 runs from 70 new PRIDE projects (79 selected, 4 excluded by the text check, 5 by the reporter-scan audit); no technical failure.

| criterion | verdict | numbers |
|---|---|---|
| S1 new wrong calls = 0 | FAIL | 1 of 70 runs |
| S2 labelled runs without recorded reporter region called label-free = 0 | FAIL | 1 of 15 |
| E1 label-free runs without baseline call now called label-free >= 40 % | PASS | 22 of 30 (73 %) |
| I1 runs with a baseline call that change class = 0 | PASS | 0 of 33 |

| | right | no call | wrong |
|---|---|---|---|
| baseline | 30 | 37 | 3 |
| candidate | 52 | 14 | 4 |

The new wrong call is PXD063777 (dimethyl, ion-trap MS2, 601 counted spectra): no call before, `label-free` by absence now. The other five dimethyl and the three SILAC ion-trap runs without a call stay without a call. The pair test of the absence rule does not see the dimethyl spacings in this run. The rule was not changed after the result.

Consequence: PR #66 should not be merged as it is. A label-free call by absence on ion-trap runs needs a pair test that covers dimethyl, and a new held-out test.

Deviations: staging started before the freeze commit (stated in the PREREG; no FASTag run before the second freeze). 49 of 79 downloads were refused by the PRIDE mirror in the first pass and fetched in a second pass (same files, checksums verified); no backup file was used.
