# aspn held-out: freeze 2 (staging result, truth audit, mzML header check)

2026-11-13, before any FASTag run of this test. No FASTag output exists (`$H/out` absent).

## Staging (PREREG "Staging and technical failures")
`staged.tsv` (stage.sh), `manifest.tsv` (make_manifest.py). All 21 slots in the test: 12 Asp-N slots from 4 projects
(A1-A4 x 3), 9 control slots from 6 projects (K1-K9). K5.1: file 1 failed (no PRIDE SHA-1, second download differed),
file 2 passed, as the rule prescribes. Every MS2 FTMS HCD, >= 2,000 charged MS2 per file (min 3,080, A1.2).
E0 staging minimum (>= 6 Asp-N slots / 3 projects, >= 6 controls / 3 projects) met. Databases: `db_sha256.tsv`.
Frozen copy `$H/frozen/aspn` on data verified against SHA256SUMS and scorers/SHA256SUMS of freeze 1 (all OK).

## Truth audit (PRIDE sampleProcessingProtocol in inputs/proj/*.project.json; paper text via Europe PMC where open)
| run | PXD | truth | evidence |
|---|---|---|---|
| A1 | PXD001111 | Asp-N | protocol: "AspN digests were obtained by incubating the sample first with AspN (Roche)" (FASP lysate, Jurkat/HeLa); files `*_SCX_AspN_R_F*`; trypsin and IP parts of the project are other files. Paper (PMID 25485597) has no open full text. |
| A2 | PXD027242 | Asp-N | protocol: lysate split and digested with trypsin, GluC or AspN (Promega); files `*AspN*HCD*` DDA; mixtures not in the test. |
| A3 | PXD050612 | Asp-N | protocol: trypsin or Asp-N (Promega), culture filtrate; paper PMC11395111 "used endoproteinase AspN and trypsin". |
| A4 | PXD059041 | Asp-N | protocol: three aliquots, chymotrypsin / thermolysin / "sequencing-grade Asp-N"; files `*_AspN_R*`. No paper reference in PRIDE. |
| K1 | PXD027242 | Glu-C | as A2, `*_GluC_HCD30`. |
| K2 | PXD027242 | Trypsin | as A2, `*_Tr_HCD27`. |
| K3 | PXD050612 | Trypsin | as A3, `Typsin_CF_1`. |
| K4 | PXD059041 | Chymotrypsin | as A4, `*_Chemotrypsine_R2`. |
| K5 | PXD067401 | Trypsin | SDRF trypsin; data protocol "tryptic digestion ... after Lysine (K) and Arginine (R)". |
| K6 | PXD022469 | Trypsin | SDRF trypsin; MaxQuant "Enzyme specificity was set to trypsin" (ProteoMiner-enriched plasma: protein-level, not peptide enrichment). |
| K7 | PXD044780 | Trypsin | SDRF trypsin; paper PMC11181659 "subsequent Trypsin digestion" (in-gel, Shevchenko). |
| K8 | PXD049174 | Trypsin | protocol: "1:100 ratio of Trypsin and LysC" (non-Asp-N; truth label Trypsin as in the SDRF). |
| K9 | PXD017391 | Trypsin | protocol: "Trypsin was added ... 1:20". |
All truth labels of picks.tsv confirmed; no change.

## mzML header check (`mzml_header_check.tsv`)
All 21 mzML: ThermoRawFileParser 2.0.0.0, Orbitrap instrument, MS2 activation beam-type CID (HCD). K6 and K7 carry no
activation term in the first 3 MB; in the first 60 MB only beam-type CID (460 and 4,861). K6 header instrument
"Q Exactive Plus" where the PRIDE record lists "Q Exactive HF" (immaterial: Orbitrap HCD either way).
