| criterion | value | pass |
|---|---|---|
| S1 wrong calls on label-free runs | 1 of 62 (one-sided 95 % bound 0.0742) | False |
| A1 weighted accuracy | 0.8694 (label-free 0.9032, labelled 0.7342) | True |
| R recall TMT (>= 0.8) | 8 of 8 = 1.0; no call 0, wrong 0 | True |
| R recall TMTpro (>= 0.8) | 7 of 7 = 1.0; no call 0, wrong 0 | True |
| R recall iTRAQ4+iTRAQ8 (>= 0.8) | 5 of 5 = 1.0; no call 0, wrong 0 | True |
| R recall SILAC (>= 0.6) | 23 of 43 = 0.5349; no call 16, wrong 4 | False |
| R recall dimethyl (>= 0.5) | 15 of 16 = 0.9375; no call 0, wrong 1 | True |
| F labelled runs called label-free (<= 0.05) | 5 of 79 = 0.0633 | False |

All runs

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 62 | 56 | 5 | 1 | - |
| TMT | 8 | 8 | 0 | 0 | 0 |
| TMTpro | 7 | 7 | 0 | 0 | 0 |
| iTRAQ8 | 5 | 5 | 0 | 0 | 0 |
| SILAC | 43 | 23 | 16 | 4 | 4 |
| dimethyl | 16 | 15 | 0 | 1 | 1 |

ms2_analyzer = FT

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 28 | 27 | 0 | 1 | - |
| TMT | 4 | 4 | 0 | 0 | 0 |
| TMTpro | 6 | 6 | 0 | 0 | 0 |
| iTRAQ8 | 5 | 5 | 0 | 0 | 0 |
| SILAC | 14 | 13 | 0 | 1 | 1 |
| dimethyl | 6 | 6 | 0 | 0 | 0 |

ms2_analyzer = IT

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 33 | 29 | 4 | 0 | - |
| TMT | 4 | 4 | 0 | 0 | 0 |
| TMTpro | 1 | 1 | 0 | 0 | 0 |
| SILAC | 29 | 10 | 16 | 3 | 3 |
| dimethyl | 8 | 7 | 0 | 1 | 1 |

ms2_analyzer = mixed

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 1 | 0 | 1 | 0 | - |
| dimethyl | 2 | 2 | 0 | 0 | 0 |

acquisition = MS2

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 62 | 56 | 5 | 1 | - |
| TMT | 4 | 4 | 0 | 0 | 0 |
| TMTpro | 6 | 6 | 0 | 0 | 0 |
| iTRAQ8 | 5 | 5 | 0 | 0 | 0 |
| SILAC | 42 | 23 | 15 | 4 | 4 |
| dimethyl | 16 | 15 | 0 | 1 | 1 |

acquisition = MS3

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| TMT | 4 | 4 | 0 | 0 | 0 |
| TMTpro | 1 | 1 | 0 | 0 | 0 |
| SILAC | 1 | 0 | 1 | 0 | 0 |

digestion = mixed

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 2 | 2 | 0 | 0 | - |
| dimethyl | 1 | 1 | 0 | 0 | 0 |

digestion = other

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 1 | 0 | 1 | 0 | - |

digestion = tryptic

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 43 | 38 | 4 | 1 | - |
| TMT | 5 | 5 | 0 | 0 | 0 |
| TMTpro | 7 | 7 | 0 | 0 | 0 |
| iTRAQ8 | 5 | 5 | 0 | 0 | 0 |
| SILAC | 32 | 16 | 12 | 4 | 4 |
| dimethyl | 12 | 11 | 0 | 1 | 1 |

digestion = unstated

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 16 | 16 | 0 | 0 | - |
| TMT | 3 | 3 | 0 | 0 | 0 |
| SILAC | 11 | 7 | 4 | 0 | 0 |
| dimethyl | 3 | 3 | 0 | 0 | 0 |

cell = HYB

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 33 | 29 | 4 | 0 | - |
| TMT | 1 | 1 | 0 | 0 | 0 |
| iTRAQ8 | 2 | 2 | 0 | 0 | 0 |
| SILAC | 29 | 12 | 14 | 3 | 3 |
| dimethyl | 12 | 11 | 0 | 1 | 1 |

cell = QE

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 15 | 14 | 0 | 1 | - |
| TMT | 3 | 3 | 0 | 0 | 0 |
| TMTpro | 3 | 3 | 0 | 0 | 0 |
| iTRAQ8 | 2 | 2 | 0 | 0 | 0 |
| SILAC | 8 | 8 | 0 | 0 | 0 |
| dimethyl | 2 | 2 | 0 | 0 | 0 |

cell = TRI

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 14 | 13 | 1 | 0 | - |
| TMT | 4 | 4 | 0 | 0 | 0 |
| TMTpro | 4 | 4 | 0 | 0 | 0 |
| iTRAQ8 | 1 | 1 | 0 | 0 | 0 |
| SILAC | 6 | 3 | 2 | 1 | 1 |
| dimethyl | 2 | 2 | 0 | 0 | 0 |
