# Independent detector challenge

All 31 invocations completed successfully. On the 22 primary files, the gate enabled for 4/4 TMT runs with Orbitrap MS2, abstained for 3/3 TMT runs with ion-trap MS2, and stayed off for 15/15 other-label or label-free runs. All nine deliberately mismatched 20-ppm ion-trap probes also stayed off.

This is a metadata-selected convenience challenge of an existing corpus, not an unbiased population estimate or a newly held-out verdict. The four high-resolution TMT successes must not be reported as 100% sensitivity across acquisition modes.

| Project | Label | MS2 | Gate | Reason | TMT N/K | ~304-Da N/K |
|---|---|---|---|---|---|---|
| PXD014616 | TMT | FT | on | TMT6_10_two_site_evidence | 749/502 | 2/1 |
| PXD017216 | TMT | FT | on | TMT6_10_two_site_evidence | 281/364 | 0/0 |
| PXD021560 | TMT | FT | on | TMT6_10_two_site_evidence | 500/308 | 0/0 |
| PXD007694 | TMT | IT | off | Da_tolerance | 0/0 | 0/0 |
| PXD014001 | TMT | IT | off | Da_tolerance | 0/0 | 0/0 |
| PXD029808 | TMT | FT | on | TMT6_10_two_site_evidence | 262/153 | 0/0 |
| PXD015559 | TMT | IT | off | Da_tolerance | 0/0 | 0/0 |
| PXD081776 | TMTpro | FT | off | few_eligible_spectra | 0/0 | 28/17 |
| PXD055089 | TMTpro | FT | off | TMTpro_or_mixed_evidence | 1/0 | 179/162 |
| PXD039509 | TMTpro | FT | off | TMTpro_or_mixed_evidence | 2/0 | 292/204 |
| PXD024282 | TMTpro | IT | off | Da_tolerance | 0/0 | 0/0 |
| PXD074090 | TMTpro | IT | off | Da_tolerance | 0/0 | 0/0 |
| PXD038900 | TMTpro | IT | off | Da_tolerance | 0/0 | 0/0 |
| PXD000869 | iTRAQ4 | mixed | off | insufficient_two_site_TMT_evidence | 0/0 | 0/0 |
| PXD019532 | iTRAQ8 | FT | off | TMTpro_or_mixed_evidence | 1/0 | 151/72 |
| PXD051941 | SILAC | FT | off | insufficient_two_site_TMT_evidence | 0/0 | 0/0 |
| PXD051521 | dimethyl | FT | off | insufficient_two_site_TMT_evidence | 2/0 | 0/0 |
| PXD022181 | dimethyl | IT | off | Da_tolerance | 0/0 | 0/0 |
| PXD014274 | label-free | FT | off | insufficient_two_site_TMT_evidence | 0/0 | 0/0 |
| PXD006321 | label-free | IT | off | Da_tolerance | 0/0 | 0/0 |
| PXD028364 | label-free | FT | off | insufficient_two_site_TMT_evidence | 0/0 | 0/0 |
| PXD031534 | label-free | IT | off | Da_tolerance | 0/0 | 0/0 |

The iTRAQ8 run PXD019532 produces the TMTpro_or_mixed_evidence veto. Its independently recorded truth is iTRAQ8. The existing broader label-discovery implementation documents iTRAQ8 compositions at 304.199040–304.205360 Da and TMTpro at 304.207146 Da (src/LabelDiscovery.cpp:1188). The narrow gate uses windows too broad to identify these as distinct chemistries. The veto is correct for the TMT6/10 filter; its reason must not be interpreted as a TMTpro classification.

Low-resolution results support a documented abstention boundary, not a lower support threshold. Using 20 ppm on ion-trap spectra leaves 0–176 eligible spectra and negligible site evidence here. The correct Da-mode runs intentionally skip the high-resolution mass-signature detector.

All source SHA-256 values matched the archived manifest. Every primary label has its cached PRIDE record and independent acquisition/reporter scan in this folder. Scripts, commands, original log files and structured results are preserved.

## Initial controlled file mixtures

The original gate correctly handles all three pure controls. It vetoes the 50:50 TMT:TMTpro mixture but enables on the 90:10 mixture: pro_N=29 and pro_K=16, below the old two-site minimum of 20 at one site. Both mixtures of TMT with label-free spectra also enable the filter, even with only 10% TMT spectra. A positive result establishes TMT evidence, not homogeneous labelling or file purity.

| Composition (spectra) | Original gate | TMT N/K | ~304-Da N/K |
|---|---|---|---|
| pure_TMT | on | 770/480 | 1/0 |
| pure_TMTpro | off | 0/0 | 181/154 |
| pure_LF | off | 0/0 | 0/0 |
| TMT_pro_50_50 | off | 393/242 | 100/74 |
| TMT_pro_90_10 | on | 689/431 | 29/16 |
| TMT_LF_50_50 | on | 393/242 | 1/0 |
| TMT_LF_10_90 | on | 80/54 | 0/0 |

These are synthetic files of independently acquired real spectra, not chemical mixtures or co-isolated spectra. They are developmental evidence; the new candidate rule and separate follow-up validation are frozen in MINORITY-VALIDATION-PROTOCOL.txt. The candidate retains the original TMT-positive threshold and lowers only the conflicting two-site veto minimum from 20 to 5, while retaining the 1% eligible-spectrum term.

## Frozen candidate validation

The proposed two-site minority veto passes all four required checks on the new source pair and new sampling seeds: pure TMT remains enabled, pure TMTpro stays off, and the 50:50 and 90:10 mixtures are vetoed. The original gate again misses the 90:10 mixture. The exploratory 95:5 mixture is still enabled because pro_K=7 is below the candidate threshold of 8. No further threshold adjustment was made.

| New mixture | Old gate | Candidate gate | Veto threshold | ~304-Da N/K |
|---|---|---|---|---|
| pure_TMT | on | on | 8 | 0/0 |
| pure_TMTpro | off | off | 6 | 300/194 |
| TMT_pro_50_50 | off | off | 7 | 147/87 |
| TMT_pro_90_10 | on | off | 8 | 31/11 |
| TMT_pro_95_5 | on | on | 8 | 10/7 |

The candidate creates no additional abstentions in four independent high-resolution TMT files or eight original benchmark TMT chemistry panels. Across all 52 observed diagnostic records (9 main panels, 31 challenge probes, 7 developmental mixtures, 5 new mixtures), the only changed decisions are the two 90:10 TMT:TMTpro mixtures. The final compiled binary was subsequently validated on all 43 frozen challenge cases (see below).

## Final compiled-binary validation

FASTag-ga-v2 (SHA-256 `2b03654a786c5a1ac267a9b1c53615481a2f329afa2ace71faf3e9d869a68d32`) passed all 43 executions: the 22 empirical inputs, 9 additional low-resolution tolerance stresses, and 12 synthetic file mixtures. Every input checksum matched. All pre-filter probe counts matched the original binary exactly, and every actual enable/disable decision matched the frozen candidate rule. The iTRAQ8 and TMTpro veto message now reads `conflicting_304Da_label_evidence`.

This confirms implementation of the intended rule. It does not change the coverage limits: no activation on low-resolution TMT MS2, no guarantee of 5% minority-label detection, and no proof of uniform labelling when TMT is detected in a partially label-free file. The complete per-case checks and logs are in `final-binary-validation/summary.json` and its case folders.
