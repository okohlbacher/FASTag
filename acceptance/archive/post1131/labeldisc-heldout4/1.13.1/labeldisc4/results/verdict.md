| criterion | verdict | numbers |
|---|---|---|
| S1 | PASS | 0 wrong calls on 42 label-free runs (25 with ion-trap MS2) |
| A1 | PASS | weighted accuracy 0.9535 (label-free 0.9762, labelled 0.8627) |
| A2 | PASS | family-correct FASTag 129 against Param-Medic 125 of 144 |
| R TMT | PASS | 17 of 17 (threshold 0.8; no call 0, wrong 0) |
| R TMTpro | PASS | 20 of 20 (threshold 0.8; no call 0, wrong 0); 8 with MS3 |
| R iTRAQ4+iTRAQ8 | PASS | 13 of 15 (threshold 0.8; no call 0, wrong 2) |
| R SILAC | PASS | 14 of 22 (threshold 0.6; no call 5, wrong 3) |
| R dimethyl | PASS | 24 of 28 (threshold 0.5; no call 2, wrong 2) |
| F | PASS | 5 of 102 labelled runs called label-free |
| arm 1 overall | PASS |  |
| P-S1 | FAIL | 1 runs wrong with arm 2 and not with arm 1, of 144: PXD000148__IP_3 |
| P-S2 | FAIL | 3 of 26 labelled runs with region_recorded = no called label-free (2 of them also with arm 1): PXD009424__20150724_RT_4NHF_2D_vs_3D_8_10_2_4 PXD009190__Seq31296_E2O2 PXD000148__IP_3 |
| PR #66 verdict (P-S1, P-S2) | FAIL |  |
| P-E1 (reported) | INCONCLUSIVE | 0 of 1 label-free runs without an arm-1 call are called label-free |
| P-I1 (reported) | PASS | 0 of 136 runs with an arm-1 call change class:  |

Runs: 144; technical failures (counted as no call in arm 1, left out of the arm-2 criteria): 0 
