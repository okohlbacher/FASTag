| criterion | value | pass |
|---|---|---|
| S1 wrong calls on label-free runs | 0 of 42 (one-sided 95 % bound 0.0688) | True |
| A1 weighted accuracy | 0.4532 (label-free 0.4048, labelled 0.6471) | False |
| A2 family-correct, FASTag vs Param-Medic | 91 vs 125 of 144 | False |
| R recall TMT (>= 0.8) | 17 of 17 = 1.0; no call 0, wrong 0 | True |
| R recall TMTpro (>= 0.8) | 12 of 20 = 0.6; no call 0, wrong 8 | False |
| R recall iTRAQ4+iTRAQ8 (>= 0.8) | 13 of 15 = 0.8667; no call 0, wrong 2 | True |
| R recall SILAC (>= 0.6) | 14 of 22 = 0.6364; no call 6, wrong 2 | True |
| R recall dimethyl (>= 0.5) | 10 of 28 = 0.3571; no call 17, wrong 1 | False |
| F labelled runs called label-free (<= 0.05) | 3 of 102 = 0.0294 | True |

All runs

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 42 | 17 | 25 | 0 | - |
| TMT | 17 | 17 | 0 | 0 | 0 |
| TMTpro | 20 | 12 | 0 | 8 | 0 |
| iTRAQ4 | 6 | 5 | 0 | 1 | 0 |
| iTRAQ8 | 9 | 8 | 0 | 1 | 0 |
| SILAC | 22 | 14 | 6 | 2 | 2 |
| dimethyl | 28 | 10 | 17 | 1 | 1 |

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
| label-free | 25 | 0 | 25 | 0 | - |
| TMT | 4 | 4 | 0 | 0 | 0 |
| TMTpro | 8 | 0 | 0 | 8 | 0 |
| SILAC | 13 | 7 | 6 | 0 | 0 |
| dimethyl | 16 | 0 | 16 | 0 | 0 |

ms2_analyzer = mixed

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| TMT | 1 | 1 | 0 | 0 | 0 |
| dimethyl | 2 | 1 | 1 | 0 | 0 |

acquisition = MS2

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 42 | 17 | 25 | 0 | - |
| TMT | 13 | 13 | 0 | 0 | 0 |
| TMTpro | 12 | 12 | 0 | 0 | 0 |
| iTRAQ4 | 6 | 5 | 0 | 1 | 0 |
| iTRAQ8 | 9 | 8 | 0 | 1 | 0 |
| SILAC | 22 | 14 | 6 | 2 | 2 |
| dimethyl | 27 | 10 | 16 | 1 | 1 |

acquisition = MS3

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| TMT | 4 | 4 | 0 | 0 | 0 |
| TMTpro | 8 | 0 | 0 | 8 | 0 |
| dimethyl | 1 | 0 | 1 | 0 | 0 |

digestion = mixed

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 2 | 1 | 1 | 0 | - |

digestion = other

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| dimethyl | 1 | 0 | 1 | 0 | 0 |

digestion = tryptic

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 35 | 12 | 23 | 0 | - |
| TMT | 16 | 16 | 0 | 0 | 0 |
| TMTpro | 19 | 12 | 0 | 7 | 0 |
| iTRAQ4 | 5 | 5 | 0 | 0 | 0 |
| iTRAQ8 | 9 | 8 | 0 | 1 | 0 |
| SILAC | 21 | 14 | 5 | 2 | 2 |
| dimethyl | 25 | 10 | 15 | 0 | 0 |

digestion = unstated

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 5 | 4 | 1 | 0 | - |
| TMT | 1 | 1 | 0 | 0 | 0 |
| TMTpro | 1 | 0 | 0 | 1 | 0 |
| iTRAQ4 | 1 | 0 | 0 | 1 | 0 |
| SILAC | 1 | 0 | 1 | 0 | 0 |
| dimethyl | 2 | 0 | 1 | 1 | 1 |

cell = HYB

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 23 | 3 | 20 | 0 | - |
| TMT | 6 | 6 | 0 | 0 | 0 |
| TMTpro | 2 | 0 | 0 | 2 | 0 |
| iTRAQ4 | 5 | 4 | 0 | 1 | 0 |
| iTRAQ8 | 3 | 2 | 0 | 1 | 0 |
| SILAC | 12 | 4 | 6 | 2 | 2 |
| dimethyl | 14 | 1 | 13 | 0 | 0 |

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
| label-free | 9 | 4 | 5 | 0 | - |
| TMT | 5 | 5 | 0 | 0 | 0 |
| TMTpro | 11 | 5 | 0 | 6 | 0 |
| iTRAQ8 | 2 | 2 | 0 | 0 | 0 |
| SILAC | 5 | 5 | 0 | 0 | 0 |
| dimethyl | 7 | 3 | 4 | 0 | 0 |
