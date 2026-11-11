| criterion | value | pass |
|---|---|---|
| S1 wrong calls on label-free runs | 0 of 42 (one-sided 95 % bound 0.0688) | True |
| A1 weighted accuracy | 0.9535 (label-free 0.9762, labelled 0.8627) | True |
| A2 family-correct, FASTag vs Param-Medic | 129 vs 125 of 144 | True |
| R recall TMT (>= 0.8) | 17 of 17 = 1.0; no call 0, wrong 0 | True |
| R recall TMTpro (>= 0.8) | 20 of 20 = 1.0; no call 0, wrong 0 | True |
| R recall iTRAQ4+iTRAQ8 (>= 0.8) | 13 of 15 = 0.8667; no call 0, wrong 2 | True |
| R recall SILAC (>= 0.6) | 14 of 22 = 0.6364; no call 5, wrong 3 | True |
| R recall dimethyl (>= 0.5) | 24 of 28 = 0.8571; no call 2, wrong 2 | True |
| F labelled runs called label-free (<= 0.05) | 5 of 102 = 0.049 | True |

All runs

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 42 | 41 | 1 | 0 | - |
| TMT | 17 | 17 | 0 | 0 | 0 |
| TMTpro | 20 | 20 | 0 | 0 | 0 |
| iTRAQ4 | 6 | 5 | 0 | 1 | 0 |
| iTRAQ8 | 9 | 8 | 0 | 1 | 0 |
| SILAC | 22 | 14 | 5 | 3 | 3 |
| dimethyl | 28 | 24 | 2 | 2 | 2 |

ms2_analyzer = FT

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 17 | 17 | 0 | 0 | - |
| TMT | 12 | 12 | 0 | 0 | 0 |
| TMTpro | 12 | 12 | 0 | 0 | 0 |
| iTRAQ4 | 6 | 5 | 0 | 1 | 0 |
| iTRAQ8 | 9 | 8 | 0 | 1 | 0 |
| SILAC | 9 | 7 | 0 | 2 | 2 |
| dimethyl | 10 | 9 | 0 | 1 | 1 |

ms2_analyzer = IT

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 25 | 24 | 1 | 0 | - |
| TMT | 4 | 4 | 0 | 0 | 0 |
| TMTpro | 8 | 8 | 0 | 0 | 0 |
| SILAC | 13 | 7 | 5 | 1 | 1 |
| dimethyl | 16 | 14 | 1 | 1 | 1 |

ms2_analyzer = mixed

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| TMT | 1 | 1 | 0 | 0 | 0 |
| dimethyl | 2 | 1 | 1 | 0 | 0 |

acquisition = MS2

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 42 | 41 | 1 | 0 | - |
| TMT | 13 | 13 | 0 | 0 | 0 |
| TMTpro | 12 | 12 | 0 | 0 | 0 |
| iTRAQ4 | 6 | 5 | 0 | 1 | 0 |
| iTRAQ8 | 9 | 8 | 0 | 1 | 0 |
| SILAC | 22 | 14 | 5 | 3 | 3 |
| dimethyl | 27 | 24 | 1 | 2 | 2 |

acquisition = MS3

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| TMT | 4 | 4 | 0 | 0 | 0 |
| TMTpro | 8 | 8 | 0 | 0 | 0 |
| dimethyl | 1 | 0 | 1 | 0 | 0 |

digestion = mixed

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 2 | 2 | 0 | 0 | - |

digestion = other

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| dimethyl | 1 | 1 | 0 | 0 | 0 |

digestion = tryptic

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 35 | 34 | 1 | 0 | - |
| TMT | 16 | 16 | 0 | 0 | 0 |
| TMTpro | 19 | 19 | 0 | 0 | 0 |
| iTRAQ4 | 5 | 5 | 0 | 0 | 0 |
| iTRAQ8 | 9 | 8 | 0 | 1 | 0 |
| SILAC | 21 | 14 | 5 | 2 | 2 |
| dimethyl | 25 | 23 | 1 | 1 | 1 |

digestion = unstated

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 5 | 5 | 0 | 0 | - |
| TMT | 1 | 1 | 0 | 0 | 0 |
| TMTpro | 1 | 1 | 0 | 0 | 0 |
| iTRAQ4 | 1 | 0 | 0 | 1 | 0 |
| SILAC | 1 | 0 | 0 | 1 | 1 |
| dimethyl | 2 | 0 | 1 | 1 | 1 |

cell = HYB

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 23 | 22 | 1 | 0 | - |
| TMT | 6 | 6 | 0 | 0 | 0 |
| TMTpro | 2 | 2 | 0 | 0 | 0 |
| iTRAQ4 | 5 | 4 | 0 | 1 | 0 |
| iTRAQ8 | 3 | 2 | 0 | 1 | 0 |
| SILAC | 12 | 4 | 5 | 3 | 3 |
| dimethyl | 14 | 11 | 2 | 1 | 1 |

cell = QE

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 10 | 10 | 0 | 0 | - |
| TMT | 6 | 6 | 0 | 0 | 0 |
| TMTpro | 7 | 7 | 0 | 0 | 0 |
| iTRAQ4 | 1 | 1 | 0 | 0 | 0 |
| iTRAQ8 | 4 | 4 | 0 | 0 | 0 |
| SILAC | 5 | 5 | 0 | 0 | 0 |
| dimethyl | 7 | 6 | 0 | 1 | 1 |

cell = TRI

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 9 | 9 | 0 | 0 | - |
| TMT | 5 | 5 | 0 | 0 | 0 |
| TMTpro | 11 | 11 | 0 | 0 | 0 |
| iTRAQ8 | 2 | 2 | 0 | 0 | 0 |
| SILAC | 5 | 5 | 0 | 0 | 0 |
| dimethyl | 7 | 7 | 0 | 0 | 0 |
