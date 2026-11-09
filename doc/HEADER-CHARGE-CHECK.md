# Header charge check (`-check_header_charge`, FASTag 1.13, experimental)

FASTag tags a spectrum at the precursor charge the file gives. A wrong header charge breaks the precursor cut and the
complement pairs, and it gives every tag's `nterm_mass` the wrong flank. `-check_header_charge` checks each header
charge against the spectrum's own fragments. The default is `off`, and with it nothing in this section runs.

## The call

Every MS2 spectrum that carries a precursor charge `h` gets the same call that `-unknown_charge infer` makes for an
uncharged precursor (src/PrecursorHypotheses.h). It uses the strongest 150 peaks, the 1+ test, range evidence and
the complement-pair excess. The candidates are `-charge_min`..`-charge_max` (default 2..4) plus `h`. The verdict
(`checkHeaderCharge`) is one of four:

| verdict | when |
|---|---|
| `agree` | the call is `h`, or one of the two charges of an ambiguous call, and rests on evidence |
| `disagree` | the call differs from `h` and the evidence is against `h`: (range) the range evidence rules `h` out and at least 3 of the strongest 150 peaks lie above `h`'s 1+ fragment ceiling M_h + p + 1.5 Da; (complement) the call's complement-pair excess is above 0 and beats `h`'s by at least `-check_header_margin` (default 6); for an ambiguous call without `h`, both charges must beat it; or (1+ test) the call is 1 |
| `ambiguous` | two close charges, neither `h`, without evidence against `h` |
| `nocall` | no charge evidence either way |

## Modes

- `warn` tags every spectrum at `h`, exactly as `off` does. It writes one summary line per run (a WARN when anything
  disagrees) with the counts by verdict and by evidence kind, and the moves (e.g. `2+ -> 3+: 20`). The reports that
  carry the run rows of format 5 (census summary, alkylation report) gain the run rows `charge_overridden`,
  `check_header_charge` and `header_charge_agree|disagree|ambiguous|nocall|overridden`. Every other output is
  byte-identical to `off`.
- `override` tags a `disagree` spectrum at the call instead of `h`; the m/z is unchanged. The tag TSV gains the four
  hypothesis columns (`prec_charge`, `charge_src`, `iso_offset`, `selected`, as under `-unknown_charge`). A replaced
  charge has `charge_src` `overridden`, every other charged spectrum `header`. The reports that aggregate over
  spectra read the charge the spectrum was tagged at.
- `-check_header_out <tsv>` writes one row per header-charged MS2 spectrum in input order. The columns are `index`,
  `native_id`, `precursor_mz`, `header_charge`, `call_charge`, `call_src` (`inferred`, `ambiguous` or `assumed`),
  `basis` (`complement`, `range`, `one_plus` or `none`), `runner_up`, `header_excess`, `call_excess`,
  `header_ruled_out`, `header_peaks_above`, `verdict` and `tagged_charge`.

## Defaults (chosen on DEV)

On the DEV runs PXD003531 (Q Exactive) and PXD001819 (LTQ), scored against a Sage charge truth on the charge-stripped
copy, single stray peaks above the ceiling (a co-isolated precursor's fragments) and complement excesses of 2-4
flagged right headers far more often than wrong ones. A margin of 2 with any one peak flagged 2.7 % of the right
headers on PXD003531, and three in four of its disagreements were false. With 6 and 3 peaks it flags 0.06 %, with
8 true and 4 false disagreements among 6,720 truth spectra. On a copy with every fifth charge changed it finds
20 % of the changed headers (QE) at a precision of 0.99. The numbers are in
`output/backlog-1.13/hdrcharge/RESULTS.md`.

## Options and limits

The check needs a fragment tolerance that suits the data: the complement window follows `-complement_tolerance`.
Precursors without a charge are not checked; `-unknown_charge` handles them.

`-stream` refuses all three options, and `-dump_spectrum` refuses `override`.

## Validation

The protocol is `acceptance/1.13/PREREG-item14.md` and the results are in `acceptance/1.13/hdrcharge/results/`. The
held-out set was 5 runs, scored once. **Verdict: INCONCLUSIVE.** Two Astral runs had fewer than 500 Sage truth
spectra: PXD070049 has 345, and PXD074582 has 0 targets at 1 % FDR.

On the three Q Exactive runs, as given:

- real headers disagree with Sage on 2.3 % of the identified spectra;
- the check flags 138 of 31,891, of which 40 are wrong headers;
- `override` would fix 35 charges and break 98, so it is net harmful (-2.0 per 1000).

On a copy with every fifth charge changed, the check finds 28 % of the changed headers at precision 0.95.

What follows:

- `warn` is a diagnostic for systematically wrong charges, such as a converter or export error.
- `override` is not recommended on vendor charges.
- The option stays experimental.
