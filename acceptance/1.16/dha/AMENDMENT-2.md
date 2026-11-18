# AMENDMENT-2 to PREREG-dha (frozen 2026-11-18)

Completes AMENDMENT-1 §4 under the author's approval of 2026-11-18; numbers from development data only (HARDENING.md). No held-out output exists at this freeze. Frozen in `freeze2/` (SHA256SUMS).

**1. Build and arguments.**
- FASTag `feat/deep-exam` at `425f16b2` or a later commit that leaves the survey outputs of the six development runs byte-identical.
- Defaults: `-delta_loc_model strict`, `-delta_loc_min_evidence 2`, `-delta_select min_delta`, `-delta_isotope_flank precursor`, `-delta_group 0.004`, `-recon_sub_tolerance 5` ppm, `-delta_name_tolerance 10` ppm, `-delta_isobar_tolerance 0.001`.
- Every run adds `-delta_spectra_out -delta_counts_out -delta_loc_null 7.3`.
- **Two arms:**
  - **blind** (no `-variable_modifications`): **gating**;
  - **informed** (Oxidation (M), Deamidated (N/Q), as frozen): reported.
  - Reason: on dev the blind arm agrees better with the reference (shift agreement 0.789 vs 0.721, missed shifts 0.4 % vs 9.0 %), and it is the blind survey the paper claims. *Alternative for the author: gate on the informed arm. Then the floors of §3 fail on dev for unalkylated Cys (precision lower bound 0.65).*
- MSFragger and the join as frozen. Analysis: `hardening/harden_analysis.py`, frozen with the held-out run list.

**2. Units.**
- A *call* is a `-delta_spectra_out` line with |delta − shift| ≤ 0.01 Da and `loc_class` = `fragment`, on the expected residue: C, N-term|C or C-term|C for Cys; S/T, including terminal-ambiguous, for −18.011.
- Spectra with `charge_source` = `assumed` are excluded from every gating count and reported separately (dev: 7.6 % of samples, gap precision 0.10).
- A run whose `-delta_counts_out` has a `check_*` row that is not `ok` is excluded and reported.
- All intervals are exact Clopper–Pearson 95 %; a criterion passes on its lower bound (LB).

**3. Gating criteria (blind arm).**
- **G1 Shift precision**, per common shift: of FASTag samples within 0.01 Da of the shift that have a joined MSFragger PSM, those whose massdiff is within 0.01 Da. LB ≥ 0.80 for each of oxidation +15.9949, Na +21.9819, dioxidation +31.9898, Methyl@C −43.0058, acetyl +42.0106, carbamyl +43.0058, carbamidomethyl +57.0215 and unalkylated Cys −57.0215. Dev LBs: 0.938, 0.935, 0.971, 0.917, 0.861, 0.844, 0.946, 0.869.
- **G2 Recovery**, per common shift: of joined MSFragger PSMs at the shift, those FASTag places there. LB ≥ 0.60. Dev LBs: 0.694 (carbamyl) to 0.935. Recovery against all MSFragger positives (dev 0.31 overall, placement-limited) is reported, not gating.
- **G3 Site precision:** fragment-localized calls of all shifts that MSFragger localizes, same peptide and shift. Agreement with MSFragger's localized residues LB ≥ 0.80 (dev 845/978 = 0.864 [0.841, 0.885]). The moved-peak null (`null_class` = `fragment`) must not exceed 2 % of the fragment-localized calls (dev 0.1 %).
- **G4 Hand-check, common shifts:** 100 fragment-localized calls, stratified over the eight G1 shifts in proportion to their calls, at least 8 each, drawn with `random.Random(20261118)` over the calls sorted by (run, scan). Protocol §4 unchanged; ambiguous counts against. Pass: ≥ 80 correct (LB ≥ 0.70).
- **G5 Rare shifts, all calls hand-checked:** Cys→Dha at −91.009 (and at −33.988 if any) on C; −18.011 on S/T. Per shift, with ≥ 20 calls: LB ≥ 0.50 (e.g. ≥ 15/20). With fewer: INCONCLUSIVE for that shift. Dev (blind): 0 fragment-localized −91.009 calls (2 ambiguous on C), 2 S/T −18.011 calls.
- **G6 S/T enrichment of −18.011:** observed S/T calls against the shuffled-site null (each call's site redrawn uniformly in its region, 10,000 draws, `random.Random(20261118)`), one-sided p ≤ 0.05, with ≥ 10 calls. Fewer: INCONCLUSIVE (dev: 3 calls, p = 0.11).
- **G7 Naming:** of the 20 largest nonzero pooled rows (charge-given spectra), a row counts when both hold:
  - (a) its majority observation class is not `unknown` and it carries a name, an `isotope_error` reading or a class detail (extension residues, adduct, fixed-mod loss);
  - (b) MSFragger confirms the mass (≥ 50 % of joined spectra within 0.01 Da).

  Unnamed or unknown rows count as failures. A row whose name has isobars counts as its isobar class, not as one chemistry. Pass: ≥ 14 of 20 (dev, informed arm: 18 of 20; +156.102 and +269.187 fail b).

**4. Outcome.**
- B passes when G1–G7 pass.
- B fails when any criterion fails on its LB with enough data.
- Otherwise B is INCONCLUSIVE. A per-shift criterion with < 30 joined MSFragger positives is INCONCLUSIVE for that shift.

**5. Reported, not gating.**
- The informed arm.
- Deamidation and 13C+1 precision and recovery (overlapping windows; MSFragger does not localize < 1.5 Da).
- The precursor-flank share of the +1.003 / +2.007 rows (dev 0.98 / 1.00).
- The entrapment share in a separate entrapment run (dev 0.4 % of gaps).
- The reconciliation table, the loss funnel and the charge-assumed stratum.

**6. Unchanged.** The 171-run held-out split, MSFragger 4.4.1, scoring once.

## Author confirmation

2026-11-18: the author confirmed the blind arm as the gating arm and released scoring as frozen in AMENDMENT-1/-2.
