# #14 hdrcharge: post-result review notes (added after the held-out result; nothing re-run or re-scored)

This file adds to `PREREG-item14.md` and `hdrcharge/results/RESULT.md`. It changes no endpoint, criterion,
table or verdict. The verdict stays **INCONCLUSIVE**.

## 1. The DEV grid scored a simplified rule

`dev/dev_variants.py` (the grid that chose `-check_header_margin` 6 and the 3-peak range minimum) re-scores the
check table with `dis()`. That function returns False whenever `call_src` is not `inferred`, so it never flags an
ambiguous call. The binary (`checkHeaderCharge`) does flag an ambiguous call without the header when the range
evidence rules the header out or both charges beat its excess by the margin.

At the frozen defaults (margin 6, 3 peaks), the binary's verdicts (`dev/dev_asgiven.tsv`, `dev/dev_perturbed.tsv`)
and the grid row `k=3 m=6` compare as follows:

| DEV run | binary flags (tp/fp) | grid flags (tp/fp) |
|---|---|---|
| PXD003531 as given | 12 (8/4) | 12 (8/4) |
| PXD001819 as given | 0 | 0 |
| PXD003531 perturbed | 280 (277/3) | 266 (263/3) |
| PXD001819 perturbed | 38 (38/0) | 27 (27/0) |

The counts are identical as given. On the perturbed copies the binary flags 14 and 11 more, all of them changed
headers. The other grid points were scored by the simplified rule only, so the selection rests on a rule that
differs from the frozen one. This is a DEV-side limitation. The PREREG phrase "verdicts recomputed from the check
table" covers only the DEV grid. The held-out score read the binary's verdict column.

For a later round: the DEV variant script must reproduce `checkHeaderCharge` exactly, including the ambiguous
branch, and must match the binary's verdict column at the frozen parameters (identical counts) before it is used
for selection.

## 2. A rule change after the held-out run

Review found that a header left out of the call's excess table (ruled out by range on 1 or 2 strong peaks above its
ceiling, too few for range evidence, or above the charge cap of 8) was compared with an excess of 0 in the
complement and ambiguous margins. feat/b113-hdrcharge now computes the header's own excess in that case. The merged
binary therefore differs from the held-out binary (c1a6607, sha256 d88dc29b...).

In the held-out check tables (`data:/scratch/kohlbach/b113/hdrcharge/heldout/*/*/hc.tsv`) this case gave these
disagreements:

| Run | as given | perturbed |
|---|---|---|
| PXD001769 | 0 | 11 |
| PXD003850 | 0 | 6 |
| PXD009815 | 0 | 7 |
| PXD070049 | 0 | 0 |
| PXD074582 | 0 | 6 |

All 30 are 2+ headers called 3+, with call excess 6.0 to 10.0. The DEV tables have 0 as given and 1 perturbed
(PXD003531). With the fix these 30 may no longer disagree. E1 and E2 (as given) cannot change. E3 (perturbed) can
lose at most 30 flags. Held-out is not re-run or re-scored for this change.

## 3. Scope of the evidence

E1-E3 are QE-driven. On Orbitrap Astral (PXD070049) all 9 flags as given are right headers (false alarm 0.026), and
all 8 on the perturbed copy are false, with no changed header found. PXD074582 gives 275 disagreements as given with
no truth to judge them. The documentation now says that the evidence holds for Q Exactive data only.
