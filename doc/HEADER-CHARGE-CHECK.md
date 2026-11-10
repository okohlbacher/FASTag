# Header charge check (`-check_header_charge`, FASTag 1.13, experimental)

FASTag tags a spectrum at the precursor charge the file gives. A wrong header charge breaks the precursor cut and the
complement pairs, and it gives every tag's `nterm_mass` the wrong flank. `-check_header_charge` checks each header
charge `h` against two kinds of evidence. The default is `off`, and with it nothing in this section runs.

## The evidence

1. **MS1 isotope spacing.** In the nearest preceding MS1 scan (at most 512 spectra back) the check looks for the
   isotope pattern of the precursor, within 10 ppm. The MS1 charge is the highest z in 8..1 with a peak at
   precursor m/z + 1.00335/z of at least 15 % of the precursor peak and a peak at -1.00335/z or +2 x 1.00335/z of at
   least 5 %. Only mzML input has MS1 scans; MGF and mzPeak input skip this step.
2. **Complement pairs.** The call that `-unknown_charge infer` makes for an uncharged precursor
   (src/PrecursorHypotheses.h), over `-charge_min`..`-charge_max` (default 2..4) plus `h`, from the strongest 150
   peaks. For z >= 3 the pairs 1+/(z-1)+ count as well as 1+/1+. `h`'s own excess is always computed at `h`.
   Peaks above a charge's fragment ceiling narrow the candidates but are no ground for a disagreement.

## The verdict

When the MS1 scan gives a charge, it decides (`flag_basis` `ms1_isotope`):

| MS1 charge | verdict |
|---|---|
| equals `h` | `agree` |
| differs, but the header's own peak at precursor m/z + 1.00335/`h` reaches 15 % of the precursor peak | `agree` (two overlapping patterns; the header's is present) |
| differs, and that peak is missing | `disagree`, at the MS1 charge |

Otherwise the complement call decides:

| verdict | when |
|---|---|
| `agree` | the call is `h`, or one of the two charges of an ambiguous call, and rests on evidence |
| `disagree` | the call's complement-pair excess is above 0 and beats `h`'s by at least `-check_header_margin` (default 6); for an ambiguous call without `h`, both charges must beat it; or the 1+ test calls 1 |
| `ambiguous` | two close charges, neither `h`, without evidence against `h` |
| `nocall` | no charge evidence either way |

## Modes

- `warn` tags every spectrum at `h`, exactly as `off` does. It writes one summary line per run (a WARN when anything
  disagrees) with the counts by verdict and by evidence kind, and the moves (e.g. `2+ -> 3+: 20`). The reports that
  carry the run rows of format 5 (census summary, alkylation report) gain the run rows `check_header_charge` and
  `header_charge_agree|disagree|ambiguous|nocall|both`. Every other output is byte-identical to `off`.
- `both` tags a `disagree` spectrum twice: at `h` (`charge_src` `header`, `selected` 1) and at the charge the check
  found (`charge_src` `check_call`, `selected` 0); the m/z is unchanged. The tag TSV gains the four hypothesis
  columns (`prec_charge`, `charge_src`, `iso_offset`, `selected`, as under `-unknown_charge`). The E-values of a
  spectrum tagged under two charges are doubled. The aggregating reports read the selected row, so a false flag
  costs a factor of 2 in E-value and no correct tag.
- `-check_header_out <tsv>` writes one row per header-charged MS2 spectrum in input order. The 18 columns are
  `index`, `native_id`, `precursor_mz`, `header_charge`, `call_charge`, `call_src` (`inferred`, `ambiguous` or
  `assumed`), `basis` (`complement`, `range`, `one_plus` or `none`), `runner_up`, `header_excess`, `call_excess`,
  `header_ruled_out`, `header_peaks_above`, `ms1_charge` (0 without a call), `ms1_peaks`, `flag_basis`
  (`ms1_isotope`, `complement`, `one_plus` or `none`), `flag_charge`, `verdict` and `tagged_charge`.

## Options and limits

The complement window follows `-complement_tolerance`. Precursors without a charge are not checked;
`-unknown_charge` handles them. `-stream` refuses all three options, and `-dump_spectrum` refuses `both`.

## Results on DEV

Truth: Sage on a charge-stripped copy, q <= 0.001. "Perturbed" is a copy with every fifth charge changed by 1.

| run | wrong headers / truth spectra | flagged | sensitivity | precision | right headers flagged |
|---|---|---|---|---|---|
| PXD003531 (Q Exactive), as given | 144 / 6,363 | 73 | 0.31 | 0.62 | 0.45 % |
| PXD003531, perturbed | 1,353 / 6,339 | 1,186 | 0.86 | 0.98 | 0.44 % |
| PXD001819 (LTQ Orbitrap), as given | 0 / 1,369 | 0 | - | - | 0 % |
| PXD001819, perturbed | 265 / 1,369 | 257 | 0.97 | 1.00 | 0 % |
| PXD030418 (Q Exactive), as given | 99 / 10,555 | 49 | 0.39 | 0.80 | 0.10 % |
| PXD031485 (Q Exactive), as given | 145 / 6,713 | 59 | 0.34 | 0.83 | 0.15 % |
| PXD006882 (Q Exactive Plus), as given | 84 / 11,398 | 57 | 0.61 | 0.89 | 0.05 % |
| PXD082249 (Orbitrap Astral Zoom), as given | 62 / 2,331 | 36 | 0.50 | 0.86 | 0.22 % |
| PXD058340 (Orbitrap Astral), as given | 1,241 / 39,400 | 525 | 0.30 | 0.71 | 0.40 % |
| the five runs above, perturbed | 14,928 / 70,043 | 11,921 | 0.79 | 0.99 | 0.27 % |

Over the six runs with real wrong headers (1,775), the check finds one in three, and three flags in four are
right. The MS1 scan gives a charge for 73-97 % of the truth spectra, and that charge equals Sage's in 95-99 %. The previous rule found 6 % of the real wrong headers on PXD003531.

## Validation

**The current rule has no held-out result.** It was developed on PXD003531 and PXD001819 and then run unchanged on the other five DEV runs; a held-out test
needs new runs (the five runs below are spent).

Record of the previous rule (complement pairs with 1+/1+ pairs only, range evidence as a ground, `override` instead
of `both`; protocol `acceptance/1.13/PREREG-item14.md`, results in `acceptance/1.13/hdrcharge/results/`): 5 held-out
runs, scored once, **INCONCLUSIVE** (two Astral runs had fewer than 500 Sage truth spectra). On the three Q Exactive
runs as given it flagged 138 of 31,891 spectra, of which 40 were wrong headers, and `override` would have fixed 35
charges and broken 98. On the perturbed copies it found 28 % of the changed headers at precision 0.95. On Orbitrap
Astral (PXD070049) all 9 flags as given and all 8 on the perturbed copy were false. These numbers do not describe
the current rule.

The option stays experimental. Until the held-out test, read `warn`'s disagreements as candidates, not as wrong
charges.
