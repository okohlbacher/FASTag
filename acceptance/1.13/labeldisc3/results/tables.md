| criterion | value | pass |
|---|---|---|
| S1 wrong calls on label-free runs | 0 of 64 (one-sided 95 % bound 0.0457) | True |
| A1 weighted accuracy | 0.5721 (label-free 0.5156, labelled 0.798) | False |
| A2 family-correct, FASTag vs Param-Medic | 119 vs 149 of 163 | False |
| R recall TMT (>= 0.8) | 18 of 18 = 1.0; no call 0, wrong 0 | True |
| R recall TMTpro (>= 0.8) | 11 of 18 = 0.6111; no call 0, wrong 7 | False |
| R recall iTRAQ4+iTRAQ8 (>= 0.8) | 19 of 19 = 1.0; no call 0, wrong 0 | True |
| R recall SILAC (>= 0.6) | 18 of 22 = 0.8182; no call 4, wrong 0 | True |
| R recall dimethyl (>= 0.5) | 13 of 22 = 0.5909; no call 8, wrong 1 | True |
| F labelled runs called label-free (<= 0.05) | 1 of 99 = 0.0101 | True |

All runs

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 64 | 33 | 31 | 0 | - |
| TMT | 18 | 18 | 0 | 0 | 0 |
| TMTpro | 18 | 11 | 0 | 7 | 0 |
| iTRAQ4 | 8 | 8 | 0 | 0 | 0 |
| iTRAQ8 | 11 | 11 | 0 | 0 | 0 |
| SILAC | 22 | 18 | 4 | 0 | 0 |
| dimethyl | 22 | 13 | 8 | 1 | 1 |

ms2_analyzer = FT

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 33 | 33 | 0 | 0 | - |
| TMT | 10 | 10 | 0 | 0 | 0 |
| TMTpro | 11 | 11 | 0 | 0 | 0 |
| iTRAQ4 | 6 | 6 | 0 | 0 | 0 |
| iTRAQ8 | 10 | 10 | 0 | 0 | 0 |
| SILAC | 12 | 12 | 0 | 0 | 0 |
| dimethyl | 14 | 13 | 0 | 1 | 1 |

ms2_analyzer = IT

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 31 | 0 | 31 | 0 | - |
| TMT | 8 | 8 | 0 | 0 | 0 |
| TMTpro | 7 | 0 | 0 | 7 | 0 |
| iTRAQ8 | 1 | 1 | 0 | 0 | 0 |
| SILAC | 10 | 6 | 4 | 0 | 0 |
| dimethyl | 8 | 0 | 8 | 0 | 0 |

ms2_analyzer = mixed

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| iTRAQ4 | 2 | 2 | 0 | 0 | 0 |

acquisition = MS2

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 64 | 33 | 31 | 0 | - |
| TMT | 10 | 10 | 0 | 0 | 0 |
| TMTpro | 11 | 11 | 0 | 0 | 0 |
| iTRAQ4 | 8 | 8 | 0 | 0 | 0 |
| iTRAQ8 | 10 | 10 | 0 | 0 | 0 |
| SILAC | 22 | 18 | 4 | 0 | 0 |
| dimethyl | 22 | 13 | 8 | 1 | 1 |

acquisition = MS3

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| TMT | 8 | 8 | 0 | 0 | 0 |
| TMTpro | 7 | 0 | 0 | 7 | 0 |
| iTRAQ8 | 1 | 1 | 0 | 0 | 0 |

digestion = mixed

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| iTRAQ8 | 1 | 1 | 0 | 0 | 0 |
| dimethyl | 1 | 0 | 0 | 1 | 1 |

digestion = other

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 12 | 7 | 5 | 0 | - |
| dimethyl | 1 | 1 | 0 | 0 | 0 |

digestion = tryptic

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 47 | 22 | 25 | 0 | - |
| TMT | 15 | 15 | 0 | 0 | 0 |
| TMTpro | 17 | 10 | 0 | 7 | 0 |
| iTRAQ4 | 8 | 8 | 0 | 0 | 0 |
| iTRAQ8 | 10 | 10 | 0 | 0 | 0 |
| SILAC | 18 | 14 | 4 | 0 | 0 |
| dimethyl | 17 | 10 | 7 | 0 | 0 |

digestion = unstated

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 5 | 4 | 1 | 0 | - |
| TMT | 3 | 3 | 0 | 0 | 0 |
| TMTpro | 1 | 1 | 0 | 0 | 0 |
| SILAC | 4 | 4 | 0 | 0 | 0 |
| dimethyl | 3 | 2 | 1 | 0 | 0 |

cell = HYB

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 16 | 1 | 15 | 0 | - |
| TMT | 3 | 3 | 0 | 0 | 0 |
| iTRAQ4 | 3 | 3 | 0 | 0 | 0 |
| iTRAQ8 | 1 | 1 | 0 | 0 | 0 |
| SILAC | 11 | 8 | 3 | 0 | 0 |
| dimethyl | 8 | 3 | 5 | 0 | 0 |

cell = NT

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 12 | 7 | 5 | 0 | - |

cell = QE

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 24 | 22 | 2 | 0 | - |
| TMT | 6 | 6 | 0 | 0 | 0 |
| TMTpro | 8 | 8 | 0 | 0 | 0 |
| iTRAQ4 | 5 | 5 | 0 | 0 | 0 |
| iTRAQ8 | 8 | 8 | 0 | 0 | 0 |
| SILAC | 8 | 8 | 0 | 0 | 0 |
| dimethyl | 10 | 9 | 0 | 1 | 1 |

cell = TRI

| truth | runs | correct | no call | wrong | called label-free |
|---|---|---|---|---|---|
| label-free | 12 | 3 | 9 | 0 | - |
| TMT | 9 | 9 | 0 | 0 | 0 |
| TMTpro | 10 | 3 | 0 | 7 | 0 |
| iTRAQ8 | 2 | 2 | 0 | 0 | 0 |
| SILAC | 3 | 2 | 1 | 0 | 0 |
| dimethyl | 4 | 1 | 3 | 0 | 0 |
