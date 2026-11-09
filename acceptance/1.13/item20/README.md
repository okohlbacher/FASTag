# Item 20 (non-tryptic shortlists): DEV exclusion

`dev-exclusion.tsv` lists every file of the item-20 DEV check (branch
feat/b113-nontryptic, report output/backlog-1.13/nontryptic/RESULTS.md). The
check used these runs to choose and justify the rules, so they are DEV data
for item 20. **Any item-20 held-out manifest must be disjoint from all five
PXDs (PXD040407, PXD031700, PXD000900, PXD053116, PXD054186), not only from
the listed files.**

Three files also belong to FASTag 1.12 held-out or gate sets (column
`overlap_1.12`): PXD031700 Lumos_HGS_F1_R1 and PXD000900 HeLa_AspN_HCD_3 are
the nontryptic stratum of the item01 held-out manifest; PXD040407 is gate case
P0-03 and the PXD of item05's negative held-out set. Those 1.12 results are
not affected; for item 20 the files are spent.

No item-20 PREREG, manifest or frozen config exists yet. Until one is
committed before any run and scored once, `-shortlist_protease` and
`-shortlist_specificity` stay experimental and the DEV recall numbers are not
evidence beyond DEV.
