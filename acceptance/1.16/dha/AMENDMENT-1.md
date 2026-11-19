# AMENDMENT-1 to PREREG-dha (2026-11-18)

Approved by the author on 2026-11-18, after the adversarial review of 2026-11-18 (GPT-6.2-Sol, Kimi, Vibe; summary in `output/features-1.16/REVIEW-path-2026-11-18.md`, not in the repository).
At this amendment no FASTag or MSFragger run has been made on, and no output opened for, any held-out run. The held-out RAW files are being downloaded and converted only.

## What changes

1. **Build and evidence rule.** The FASTag build is no longer `47181587`. It becomes the `feat/deep-exam` commit that implements review steps 2–4 on the development runs:
   - placement provenance and count reconciliation;
   - localization evidence classes, with neutral-loss satellites excluded and a false-localization null;
   - an isotope flag on precursor-derived flanks only;
   - charge-source stratification;
   - isobar equivalence classes and observation classes.

   The localization evidence rule is the one chosen on development data in `item1-dev/HARDENING.md`. Only *fragment-localized* calls count as localized; sequence-constrained, ambiguous and unlocalized calls do not.
2. **Cys reference.** With fixed carbamidomethyl-Cys, Cys→Dha is scored at −91.009 Da; −33.988 Da applies only to runs without fixed CAM.
3. **Gating criteria** replace B1–B4:
   - per-shift precision floors with exact (Clopper–Pearson) 95 % intervals; a criterion passes on the lower bound, not the point estimate;
   - recovery against the independent reference;
   - hand-check of about 100 spectra for the common shifts, plus all calls of the rare shifts (Cys→Dha, Ser/Thr −18.011);
   - S/T enrichment of −18.011 calls against a shuffled-site null;
   - naming scored as correct assignment and coverage together (unnamed and ambiguous rows count);
   - an explicit INCONCLUSIVE outcome when a shift has too few independent positives.
4. **Fixed later, before scoring.** The numeric floors, sample sizes and the null procedure are taken from `HARDENING.md`'s proposed amendment text. They are frozen in `freeze2/` (SHA256SUMS) **before** any held-out output exists, and reported to the author with the reasons for each number.

## What does not change

- The held-out split: 171 runs, every PXD045734 run not from the 57-year-old development donor (`runs.tsv`).
- The independent reference engine: MSFragger 4.4.1 open search.
- The rule to score once.
